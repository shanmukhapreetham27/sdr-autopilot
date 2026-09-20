import { NextResponse } from "next/server";
import { callAgent, isLiveCapable } from "@/lib/dronahq";
import { renderForPrompt, retrieve } from "@/lib/knowledge";
import type { ChunkKind } from "@/lib/types";

/**
 * What each agent is allowed to retrieve, and therefore what an operator is
 * feeding when they add a chunk of that kind.
 *
 * Agents absent from this map retrieve nothing: the Research agent is meant
 * to find facts we do not already hold, and handing it our own corpus invites
 * it to recycle that instead of researching.
 */
const RETRIEVES: Partial<Record<string, ChunkKind[]>> = {
  personalisation: ["example_email", "playbook", "product", "case_study"],
  conversation: ["objection", "playbook", "product"],
  followup: ["playbook", "example_email"],
  outreach_strategy: ["playbook"],
};

/**
 * Proxy from the browser to a DronaHQ agent.
 *
 * The browser never sees the API key: it posts the agent payload here, and
 * this route attaches the `api-key` header server-side.
 */
export async function POST(request: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent } = await ctx.params;

  if (!isLiveCapable(agent)) {
    return NextResponse.json(
      { ok: false, error: `Unknown or non-live agent "${agent}"` },
      { status: 404 },
    );
  }

  // `context` is the app's own routing information — which campaign, and what
  // to retrieve against. It is stripped here and never forwarded: DronaHQ
  // declares its input fields, and this is not one of them.
  let payload: Record<string, unknown>;
  let context: { campaignId?: unknown; queryParts?: unknown } | undefined;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    // Older shape: the payload posted bare. Still accepted, just without
    // retrieval, so a stale client cannot break against a new server.
    if (body && typeof body === "object" && "payload" in body) {
      payload = body.payload as Record<string, unknown>;
      context = body.context as typeof context;
    } else {
      payload = body;
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  // Retrieval happens here rather than in the browser: lib/knowledge.ts
  // reaches the database, and the client must never hold credentials.
  //
  // Everything below is best-effort. An agent call that would have worked
  // before this feature existed must still work if the corpus is empty, the
  // query matches nothing, or the table is unreachable — so a failure leaves
  // the payload exactly as the client built it.
  let retrieved: Array<{ title: string; kind: string; source: string }> = [];
  try {
    const kinds = RETRIEVES[agent];
    const campaignId = typeof context?.campaignId === "string" ? context.campaignId : "";
    if (kinds && campaignId && typeof payload.message === "string") {
      const chunks = await retrieve({
        campaignId,
        kinds,
        queryParts: Array.isArray(context?.queryParts) ? context.queryParts : [],
      });
      if (chunks.length) {
        const campaignName =
          typeof payload.campaign_name === "string" ? payload.campaign_name : "this campaign";
        // Appended to `message` rather than sent as a new top-level key.
        // Agent input fields are declared in DronaHQ and an undeclared one is
        // simply never bound, so a new key would be silently dropped.
        payload.message = `${payload.message}

${renderForPrompt(chunks, campaignName)}`;
        retrieved = chunks.map((c) => ({ title: c.title, kind: c.kind, source: c.source }));
      }
    }
  } catch {
    // Corpus unavailable. The agent still runs on its own knowledge base.
  }

  const outcome = await callAgent(agent, payload);

  // A failed agent call is a normal operational event, not a server error:
  // the campaign records it and carries on. 200 with ok:false keeps that
  // distinction clear to the caller.
  // Reported so the activity log can show what grounded the answer, rather
  // than the app claiming retrieval a reader cannot verify.
  return NextResponse.json({ ...outcome, retrieved });
}
