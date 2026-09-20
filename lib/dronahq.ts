/**
 * DronaHQ Agents integration — SERVER ONLY.
 *
 * Never import this from a client component: it reads API keys from the
 * environment. The browser talks to `/api/agents/<agent>` instead, which
 * proxies to DronaHQ so the secret never leaves the server.
 *
 * Integration shape, verified against the live DronaHQ endpoints:
 *   - Each published agent exposes a unique Webhook Trigger URL.
 *   - Auth is the `api-key: <secret>` header — NOT `Authorization: Bearer`.
 *   - The agents bind on a single top-level `message` string. Posting nested
 *     JSON instead returns "Input binding failed", so the app renders its
 *     state into a natural-language brief (see lib/agentBrief.ts).
 *   - Responses come back as
 *     `{ success, thread_id, run_id, message, response }`, with the agent's
 *     own output in `response` — today a string, not structured JSON.
 *   - An unpublished agent returns HTTP 500 "this agent's data hasn't been
 *     published or is unavailable".
 *
 * The Voice SDR agent is deliberately not wired; it stays simulated.
 */

import { LIVE_CAPABLE_AGENTS } from "./types";
import type { LiveAgentKey } from "./types";

export { LIVE_CAPABLE_AGENTS };
export type { LiveAgentKey };

export function isLiveCapable(agent: string): agent is LiveAgentKey {
  return (LIVE_CAPABLE_AGENTS as readonly string[]).includes(agent);
}

/**
 * Internal agent key -> environment variable prefix.
 *
 * Explicit rather than derived from the key name, because the DronaHQ agents
 * are named after what they do ("qualify", "personalise") while the app names
 * them after the problem statement's agent list ("icp_fitment",
 * "personalisation"). Keeping the map here means neither side has to rename.
 */
const ENV_PREFIX: Record<LiveAgentKey, string> = {
  icp_fitment: "DRONAHQ_AGENT_QUALIFY",
  research: "DRONAHQ_AGENT_RESEARCH",
  outreach_strategy: "DRONAHQ_AGENT_OUTREACH",
  personalisation: "DRONAHQ_AGENT_PERSONALISE",
  conversation: "DRONAHQ_AGENT_CONVERSE",
  followup: "DRONAHQ_AGENT_FOLLOWUP",
};

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
  const prefix = ENV_PREFIX[agent];
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
 * What a DronaHQ agent webhook accepts.
 *
 * Verified against the live endpoints: the agents bind on the top-level
 * `message` string. Extra keys are accepted and ignored by the binding, so
 * they are sent for traceability in DronaHQ's Request Logs.
 *
 * `thread_id` is deliberately NOT sent. DronaHQ issues its own thread UUIDs
 * per assistant; passing an arbitrary id fails with "Assistant ID does not
 * match thread". Every call carries full context instead.
 */
export interface AgentRequest {
  message: string;
  task: LiveAgentKey;
  campaign_id: string;
  prospect_id: string;
}

// ---------------------------------------------------------------------------
// Response handling
// ---------------------------------------------------------------------------

/**
 * DronaHQ's webhook envelope:
 *   { success, thread_id, run_id, message, response }
 * where `response` holds the agent's own output — usually a string.
 */
export interface AgentResult {
  /** The agent's full output text, shown expandable in the activity feed. */
  text: string;
  /** ICP score, when the agent returned one. */
  score?: number;
  /** Raw verdict token, e.g. QUALIFIED, REJECTED, ESCALATE, HOLD, STOP. */
  verdict?: string;
  /** false means "do not advance this prospect". */
  advance?: boolean;
  /** true means a human must take over. */
  escalate?: boolean;
  /** Channel the agent chose, when it made that decision. */
  channel?: string;
  /** DronaHQ run identifier, for cross-referencing their Request Logs. */
  runId?: string;
  raw: unknown;
}

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});

/**
 * Map an agent's output onto `AgentResult`.
 *
 * Handles both shapes: a plain string (what the live agents return today) and
 * structured JSON (what they would return if Structured Output were enabled).
 * A response that matches neither degrades to a logged event rather than
 * crashing the run.
 */
export function normaliseAgentResult(agent: LiveAgentKey, raw: unknown): AgentResult {
  const root = asDict(raw);
  const runId = typeof root.run_id === "string" ? root.run_id : undefined;
  const payload = root.response ?? root.result ?? root.data ?? root.output ?? raw;

  // --- structured output path ---
  if (payload && typeof payload === "object") {
    const body = asDict(payload);
    const text =
      typeof body.message === "string"
        ? body.message
        : typeof body.summary === "string"
          ? body.summary
          : JSON.stringify(body, null, 2);
    const verdict = typeof body.verdict === "string" ? body.verdict.toUpperCase() : undefined;
    return {
      text,
      score: typeof body.score === "number" ? body.score : undefined,
      verdict,
      advance: typeof body.advance === "boolean" ? body.advance : verdictAdvance(verdict),
      escalate: typeof body.escalate === "boolean" ? body.escalate : verdictEscalate(verdict),
      channel: typeof body.channel === "string" ? body.channel : undefined,
      runId,
      raw,
    };
  }

  // --- text path (what the live agents return) ---
  const text = typeof payload === "string" ? payload.trim() : "";

  // Some agents return JSON *as a string* — `{"verdict": "QUALIFIED", ...}`.
  // Parse it so the structured path handles it, rather than regexing JSON.
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const reparsed: unknown = JSON.parse(text);
      if (reparsed && typeof reparsed === "object") {
        const inner = normaliseAgentResult(agent, { response: reparsed, run_id: runId });
        return { ...inner, raw };
      }
    } catch {
      // Looked like JSON but wasn't. Fall through to plain-text parsing.
    }
  }

  if (!text) {
    return {
      text: `${agent} returned an empty response`,
      advance: false,
      runId,
      raw,
    };
  }

  const scoreMatch = text.match(/fit[_\s]?score\s*[:=]?\s*(\d{1,3})/i) ?? text.match(/\bscore\s*[:=]\s*(\d{1,3})/i);
  const score = scoreMatch ? Math.min(100, Number(scoreMatch[1])) : undefined;

  const verdictMatch = text.match(/verdict\s*[:=]?\s*([A-Za-z_]+)/i);
  const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : undefined;

  const channelMatch = text.match(/channel\s*[:=]\s*([a-z]+)/i);

  return {
    text,
    score,
    verdict,
    advance: verdictAdvance(verdict),
    escalate: verdictEscalate(verdict),
    channel: channelMatch ? channelMatch[1].toLowerCase() : undefined,
    runId,
    raw,
  };
}

/** Verdict tokens that mean "do not move this prospect forward". */
function verdictAdvance(verdict?: string): boolean | undefined {
  if (!verdict) return undefined;
  if (/REJECT|DISQUALIF|STOP|HOLD|NEEDS_REVIEW/.test(verdict)) return false;
  if (/QUALIFIED|CONTACT|PROCEED|FOLLOW_UP|APPROVE/.test(verdict)) return true;
  return undefined;
}

function verdictEscalate(verdict?: string): boolean | undefined {
  if (!verdict) return undefined;
  return /ESCALATE|NEEDS_REVIEW|REVIEW/.test(verdict);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type AgentCallOutcome =
  | { ok: true; result: AgentResult; ms: number }
  | { ok: false; error: string; status?: number; ms: number };

const TIMEOUT_MS = 60_000;

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
