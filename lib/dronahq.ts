/**
 * DronaHQ Agents integration — SERVER ONLY.
 *
 * Never import this from a client component: it reads API keys from the
 * environment. The browser talks to `/api/agents/<agent>` instead, which
 * proxies to DronaHQ so the secret never leaves the server.
 *
 * Integration shape, verified against the live DronaHQ endpoints:
 *   - Each published agent exposes a unique Webhook Trigger URL.
 *   - Auth is the `api-key: <secret>` header, NOT `Authorization: Bearer`.
 *   - Every agent declares its own Webhook Input fields, and those names are
 *     load-bearing: leaving one unbound makes the agent's own guard fire
 *     (the ICP agent answers "input binding failed" rather than guessing).
 *     The per-agent shapes live in lib/agentContracts.ts.
 *   - Responses arrive as
 *     `{ success, thread_id, run_id, message, response }` with the agent's
 *     output in `response` - JSON when the trigger's Response is configured
 *     as Standard with the agent's schema, prose otherwise. Both are parsed.
 *   - An unpublished agent returns HTTP 500 "this agent's data hasn't been
 *     published or is unavailable".
 *
 * The Voice SDR agent is deliberately not wired; it stays simulated.
 */

import { isEmptyResponse, parseResponse, type AgentOutcome } from "./agentContracts";
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

/**
 * Agents deliberately routed to a local implementation instead of DronaHQ.
 *
 * The published ICP Fitment agent returns a completed run with no output on
 * most calls. Rather than spend credits on a call that usually fails and then
 * fall back anyway, that stage runs lib/icpScorer.ts directly. The webhook URL
 * stays in the environment so this is a one-line revert once it is fixed.
 */
const ROUTED_LOCALLY: readonly LiveAgentKey[] = ["icp_fitment"];

/** Which agents are actually wired right now. Safe to expose — no secrets. */
export function wiredAgents(): LiveAgentKey[] {
  return LIVE_CAPABLE_AGENTS.filter(
    (a) => !ROUTED_LOCALLY.includes(a) && endpointFor(a) !== null,
  );
}

// ---------------------------------------------------------------------------
// Request / response contracts
// ---------------------------------------------------------------------------
//
// The per-agent shapes live in lib/agentContracts.ts, which is free of any
// environment access so both the server route and the browser can import it.

export type { AgentOutcome, Decision } from "./agentContracts";

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type AgentCallOutcome =
  | { ok: true; result: AgentOutcome; ms: number }
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
    // Not JSON - fall through to markup stripping.
  }
  const stripped = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "empty response body";
  return stripped.slice(0, 160) + (stripped.length > 160 ? "…" : "");
}

/**
 * Minimum gap between calls to the *same* agent.
 *
 * The loop can ask one agent to work several times in a few seconds, and the
 * agents return empty runs under that pressure. Spacing calls per agent costs
 * a little latency and removes most of the empty responses.
 */
const MIN_GAP_PER_AGENT_MS = 3_000;
const lastCallAt = new Map<LiveAgentKey, number>();

/** Attempts per call, including the first. */
const MAX_ATTEMPTS = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call one DronaHQ agent.
 *
 * Retries on three conditions, because each is transient: a network error, a
 * 5xx, and a completed run that returned no output. That last one is the
 * common case — the same payload can return null twice and then succeed — so
 * treating it as a failure would stall prospects that nothing is wrong with.
 *
 * A 4xx is not retried: a bad key, unknown agent or malformed payload will
 * fail identically every time.
 */
export async function callAgent(
  agent: LiveAgentKey,
  payload: Record<string, unknown>,
): Promise<AgentCallOutcome> {
  const endpoint = endpointFor(agent);
  const started = Date.now();

  if (!endpoint) {
    return { ok: false, error: `No DronaHQ webhook configured for "${agent}"`, ms: 0 };
  }

  // Space calls to this agent, whoever asked for them.
  const since = Date.now() - (lastCallAt.get(agent) ?? 0);
  if (since < MIN_GAP_PER_AGENT_MS) await sleep(MIN_GAP_PER_AGENT_MS - since);
  lastCallAt.set(agent, Date.now());

  let lastError = "Unknown error";
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      // Linear backoff. The agents take ~5s each, so this stays inside the
      // request timeout while giving them room to recover.
      await sleep(attempt * 2_000);
      lastCallAt.set(agent, Date.now());
    }

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
        if (res.status < 500) break;
        continue;
      }

      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Agent returned prose instead of JSON. parseResponse handles that.
      }

      if (isEmptyResponse(parsed)) {
        lastError = `DronaHQ completed the run but returned no output (${attempt}/${MAX_ATTEMPTS} attempts)`;
        continue;
      }

      return {
        ok: true,
        result: parseResponse(agent, parsed),
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
