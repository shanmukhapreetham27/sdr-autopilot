"use client";

import type { AgentRequest, AgentResult } from "./dronahq";
import { buildBrief } from "./agentBrief";
import type { Campaign, Channel, LiveAgentKey, Prospect } from "./types";

/**
 * Browser-side bridge to the DronaHQ agents.
 *
 * Only types are imported from `lib/dronahq` — that module reads API keys and
 * must never be bundled for the client. All traffic goes through the
 * `/api/agents/*` routes, which attach the key server-side.
 */

export type { LiveAgentKey } from "./types";

export interface IntegrationStatus {
  agents: Array<{ agent: LiveAgentKey; live: boolean }>;
  liveCount: number;
  totalCapable: number;
}

export async function fetchIntegrationStatus(): Promise<IntegrationStatus | null> {
  try {
    const res = await fetch("/api/integrations/status", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as IntegrationStatus;
  } catch {
    return null;
  }
}

/** Build the payload a DronaHQ agent webhook accepts. */
export function buildAgentRequest(
  task: LiveAgentKey,
  campaign: Campaign,
  prospect: Prospect,
  openChannels: Channel[],
): AgentRequest {
  return {
    // The agents bind on `message`. Everything the agent needs — including
    // the campaign's own system and agent prompts — is rendered into it.
    message: buildBrief(task, campaign, prospect, openChannels),
    // Ignored by the binding, but carried through to DronaHQ's Request Logs
    // so a run can be traced back to a campaign and prospect.
    task,
    campaign_id: campaign.id,
    prospect_id: prospect.id,
  };
}

export type InvokeOutcome =
  | { ok: true; result: AgentResult; ms: number }
  | { ok: false; error: string; ms: number };

/** Call one agent through the server proxy. Never throws. */
export async function invokeAgent(
  agent: LiveAgentKey,
  payload: AgentRequest,
): Promise<InvokeOutcome> {
  const started = Date.now();
  try {
    const res = await fetch(`/api/agents/${agent}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as InvokeOutcome;
    if (typeof json?.ok !== "boolean") {
      return { ok: false, error: "Malformed response from agent proxy", ms: Date.now() - started };
    }
    return json;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  }
}
