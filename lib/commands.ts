import type {
  ActivityEvent,
  KnowledgeChunk,
  AgentKey,
  Campaign,
  CampaignStatus,
  Channel,
  PromptVersion,
  Prospect,
  ProspectState,
} from "./types";

/**
 * Every state change the control plane can make, as one discriminated union.
 *
 * Deliberately a command set rather than a REST resource per mutation. The
 * operations are not CRUD — "pause this one agent while the campaign keeps
 * running" is not a PATCH on a resource — and keeping them in one typed union
 * means the client and the server cannot drift: adding a case here is a
 * compile error until both sides handle it.
 *
 * Entities are built client-side and sent whole, so the id and timestamps in
 * the optimistic UI update are the same ones that land in the database.
 */
export type Command =
  | { op: "setCampaignStatus"; campaignId: string; status: CampaignStatus }
  | { op: "toggleAgentPause"; campaignId: string; agent: AgentKey; paused: boolean }
  | { op: "toggleChannelPause"; campaignId: string; channel: Channel; paused: boolean }
  | { op: "setKillSwitch"; on: boolean }
  | { op: "upsertCampaign"; campaign: Campaign }
  | { op: "saveVersion"; campaignId: string; version: PromptVersion }
  | { op: "activateVersion"; campaignId: string; versionId: string }
  | { op: "addProspect"; prospect: Prospect }
  | { op: "updateProspect"; prospectId: string; patch: Partial<Prospect> }
  | { op: "pushEvent"; event: ActivityEvent }
  /**
   * A human clears one escalation.
   *
   * One command rather than a resolve-then-update pair, because the two halves
   * must not be separable: an event marked resolved while its prospect stays
   * parked is a prospect nothing will ever pick up again.
   */
  | {
      op: "resolveEscalation";
      eventId: string;
      resolvedBy: string;
      resolvedAt: string;
      /** The parked prospect to release, when the escalation held one. */
      prospectId?: string;
      /** Where the reviewer sent it. Omitted when they only acknowledged. */
      prospectState?: ProspectState;
      lastAction?: string;
    }
  /**
   * Add one chunk to a campaign's knowledge base, or to the platform-wide
   * one when `campaignId` is null.
   */
  | { op: "addKnowledge"; chunk: KnowledgeChunk }
  | { op: "deleteKnowledge"; chunkId: string };

/** Full snapshot of platform state, as returned by GET /api/state. */
export interface StateSnapshot {
  campaigns: Campaign[];
  prospects: Prospect[];
  activity: ActivityEvent[];
  killSwitch: boolean;
  /**
   * The corpus agents retrieve from. Carried in the snapshot so the control
   * plane can show and edit it; retrieval itself never runs in the browser.
   */
  knowledge: KnowledgeChunk[];
}
