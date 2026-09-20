"use client";

import { buildRequest, type AgentOutcome } from "./agentContracts";
import type { Campaign, LiveAgentKey, Prospect } from "./types";

/**
 * Browser-side bridge to the DronaHQ agents.
 *
 * Nothing is imported from `lib/dronahq` - that module reads API keys and must
 * never be bundled for the client. All traffic goes through the
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

/** Build the exact body the given agent's Webhook Input declares. */
export function buildAgentRequest(
  task: LiveAgentKey,
  campaign: Campaign,
  prospect: Prospect,
): Record<string, unknown> {
  return buildRequest(task, campaign, prospect);
}

export type InvokeOutcome =
  | { ok: true; result: AgentOutcome; ms: number }
  | { ok: false; error: string; ms: number };

/** Call one agent through the server proxy. Never throws. */
export async function invokeAgent(
  agent: LiveAgentKey,
  payload: Record<string, unknown>,
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
