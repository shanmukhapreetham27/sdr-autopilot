"use client";

import type { AgentRequest, AgentResult } from "./dronahq";
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

/** Build the payload a DronaHQ agent's webhook input is configured against. */
export function buildAgentRequest(
  task: LiveAgentKey,
  campaign: Campaign,
  prospect: Prospect,
  openChannels: Channel[],
): AgentRequest {
  const version = campaign.versions.find((v) => v.id === campaign.activeVersionId);
  return {
    task,
    // One thread per prospect per campaign, so the agent keeps context across
    // touches without leaking one campaign's history into another.
    thread_id: `${campaign.id}:${prospect.id}`,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      system_prompt: version?.systemPrompt ?? "",
      agent_prompt: version?.agentPrompts[task] ?? "",
      icp_label: campaign.icp.label,
      geography: campaign.icp.geography,
      target_roles: campaign.icp.targetRoles,
      company_criteria: campaign.icp.companyCriteria,
      exclusions: campaign.icp.exclusions,
      open_channels: openChannels,
    },
    prospect: {
      id: prospect.id,
      name: prospect.name,
      title: prospect.title,
      company: prospect.company,
      location: prospect.location,
      email: prospect.email,
      linkedin: prospect.linkedin,
      stage: prospect.state,
      fit_score: prospect.fitScore,
      channels_touched: prospect.touched,
      last_action: prospect.lastAction,
    },
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
