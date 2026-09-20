/**
 * DronaHQ Agents integration — SERVER ONLY.
 *
 * Never import this from a client component: it reads API keys from the
 * environment. The browser talks to `/api/agents/<agent>` instead, which
 * proxies to DronaHQ so the secret never leaves the server.
 *
 * Integration shape (per DronaHQ docs, "Webhook Trigger"):
 *   - Each published agent exposes a unique webhook URL.
 *   - Auth is the `api-key: <secret>` header — NOT `Authorization: Bearer`.
 *   - We POST JSON; the agent reads it as {{body.<field>}}.
 *   - The agent's "Response" is configured as Standard + JSON Schema, so we
 *     get structured JSON back rather than prose.
 *   - `thread_id` keeps a conversation continuous across calls.
 *
 * The Voice SDR agent is deliberately not wired yet; it stays simulated.
 */

import { LIVE_CAPABLE_AGENTS } from "./types";
import type { LiveAgentKey } from "./types";

export { LIVE_CAPABLE_AGENTS };
export type { LiveAgentKey };

export function isLiveCapable(agent: string): agent is LiveAgentKey {
  return (LIVE_CAPABLE_AGENTS as readonly string[]).includes(agent);
}

/** `icp_fitment` -> `DRONAHQ_ICP_FITMENT_URL` / `..._KEY` */
function envPrefix(agent: LiveAgentKey) {
  return `DRONAHQ_${agent.toUpperCase()}`;
}

export interface AgentEndpoint {
  url: string;
  apiKey: string;
}

/**
 * Resolve one agent's webhook. A per-agent key wins; otherwise fall back to a
 * single workspace-wide key, which is the common case when one DronaHQ API
 * key covers every agent.
 */
export function endpointFor(agent: LiveAgentKey): AgentEndpoint | null {
  const prefix = envPrefix(agent);
  const url = process.env[`${prefix}_URL`]?.trim();
  const apiKey = (process.env[`${prefix}_KEY`] ?? process.env.DRONAHQ_API_KEY)?.trim();
  if (!url || !apiKey) return null;
  return { url, apiKey };
}

/** Which agents are actually wired right now. Safe to expose — no secrets. */
export function wiredAgents(): LiveAgentKey[] {
  return LIVE_CAPABLE_AGENTS.filter((a) => endpointFor(a) !== null);
}

// ---------------------------------------------------------------------------
// Request contract
// ---------------------------------------------------------------------------

/**
 * The payload every agent receives. Stable on purpose: a DronaHQ agent's
 * webhook input is configured against these field names, so changing them
 * means reconfiguring agents in the DronaHQ console.
 */
export interface AgentRequest {
  task: LiveAgentKey;
  thread_id: string;
  campaign: {
    id: string;
    name: string;
    system_prompt: string;
    agent_prompt: string;
    icp_label: string;
    geography: string;
    target_roles: string[];
    company_criteria: string;
    exclusions: string;
    open_channels: string[];
  };
  prospect: {
    id: string;
    name: string;
    title: string;
    company: string;
    location: string;
    email: string;
    linkedin: string;
    stage: string;
    fit_score: number;
    channels_touched: string[];
    last_action: string;
  };
}

// ---------------------------------------------------------------------------
// Response handling
// ---------------------------------------------------------------------------

/**
 * What the app needs back from any agent. Agents return their own JSON
 * schema, so `normaliseAgentResult` maps common shapes onto this rather than
 * demanding one exact schema from every agent.
 */
export interface AgentResult {
  /** One-line description of what the agent did, for the activity log. */
  summary: string;
  /** Full generated content, when the agent produced something sendable. */
  message?: string;
  /** ICP score, when the agent produced one. */
  score?: number;
  /** false means "do not advance this prospect" (rejected, or hold). */
  advance?: boolean;
  /** Set when the agent decided a human must take over. */
  escalate?: boolean;
  /** Channel the agent chose, when it made that decision. */
  channel?: string;
  /** Anything else the agent returned, kept for debugging. */
  raw: unknown;
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function firstNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function firstBool(...vals: unknown[]): boolean | undefined {
  for (const v of vals) {
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
}

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});

/**
 * Map an agent's JSON onto `AgentResult`.
 *
 * Deliberately forgiving. Each DronaHQ agent defines its own response schema,
 * and a malformed or unexpected response must degrade to "we got something"
 * rather than crash the run — reliability matters more here than strictness.
 */
export function normaliseAgentResult(agent: LiveAgentKey, raw: unknown): AgentResult {
  // DronaHQ wraps structured output under `result` or `data` in some configs.
  const root = asDict(raw);
  const body = asDict(root.result ?? root.data ?? root.output ?? root.response ?? root);

  const summary =
    firstString(
      body.summary,
      body.reason,
      body.rationale,
      body.decision,
      body.verdict,
      body.text,
      body.message,
      root.summary,
      typeof raw === "string" ? raw : undefined,
    ) ?? `${agent} completed`;

  const message = firstString(body.message, body.email, body.body, body.content, body.text);

  const score = firstNumber(body.score, body.fit_score, body.fitScore, body.rating);

  const verdict = firstString(body.verdict, body.decision, body.status)?.toLowerCase();
  const rejected =
    verdict?.includes("reject") ||
    verdict?.includes("disqualif") ||
    firstBool(body.rejected) === true;

  const advance = firstBool(body.advance, body.qualified, body.proceed) ?? (rejected ? false : undefined);

  const escalate =
    firstBool(body.escalate, body.needs_human, body.requires_approval) ??
    (verdict?.includes("escalat") ? true : undefined);

  return {
    summary: summary.slice(0, 400),
    message,
    score,
    advance,
    escalate,
    channel: firstString(body.channel, body.selected_channel),
    raw,
  };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type AgentCallOutcome =
  | { ok: true; result: AgentResult; ms: number }
  | { ok: false; error: string; status?: number; ms: number };

const TIMEOUT_MS = 25_000;

/**
 * Turn an error body into one readable line for the activity log.
 *
 * A misconfigured URL often returns an HTML error page, and dumping that raw
 * into the feed drowns the actual message. Prefer a JSON error field, else
 * strip markup and clamp hard.
 */
function summariseErrorBody(text: string): string {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const msg = json.error ?? json.message ?? json.detail;
    if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 160);
  } catch {
    // Not JSON — fall through to markup stripping.
  }
  const stripped = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "empty response body";
  return stripped.slice(0, 160) + (stripped.length > 160 ? "…" : "");
}

/**
 * Call one DronaHQ agent. Retries once on a network error or 5xx, because a
 * single transient failure should not stall a campaign; anything else is
 * surfaced to the caller so the activity log can record a real failure.
 */
export async function callAgent(
  agent: LiveAgentKey,
  payload: AgentRequest,
): Promise<AgentCallOutcome> {
  const endpoint = endpointFor(agent);
  const started = Date.now();

  if (!endpoint) {
    return { ok: false, error: `No DronaHQ webhook configured for "${agent}"`, ms: 0 };
  }

  let lastError = "Unknown error";
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "api-key": endpoint.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });

      const text = await res.text();

      if (!res.ok) {
        lastStatus = res.status;
        lastError = `DronaHQ returned ${res.status}: ${summariseErrorBody(text)}`;
        // 4xx is our fault (bad key, bad agent, bad payload) — retrying won't help.
        if (res.status < 500) break;
        continue;
      }

      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Agent returned prose instead of JSON. normalise handles that.
      }

      return {
        ok: true,
        result: normaliseAgentResult(agent, parsed),
        ms: Date.now() - started,
      };
    } catch (err) {
      lastError =
        err instanceof Error
          ? err.name === "TimeoutError"
            ? `Timed out after ${TIMEOUT_MS / 1000}s`
            : err.message
          : String(err);
    }
  }

  return { ok: false, error: lastError, status: lastStatus, ms: Date.now() - started };
}
