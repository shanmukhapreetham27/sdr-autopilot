import { NextResponse } from "next/server";
import { callAgent, isLiveCapable } from "@/lib/dronahq";

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

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  const outcome = await callAgent(agent, payload);

  // A failed agent call is a normal operational event, not a server error:
  // the campaign records it and carries on. 200 with ok:false keeps that
  // distinction clear to the caller.
  return NextResponse.json(outcome);
}
