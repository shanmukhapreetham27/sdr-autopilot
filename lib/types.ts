/**
 * Core domain model for the Autonomous SDR platform.
 *
 * Two halves of one system:
 *  - Control plane: Campaign, PromptVersion, channel/agent toggles, kill switch.
 *  - Intelligence layer: Agent, Prospect, ActivityEvent.
 */

export type CampaignStatus = "draft" | "live" | "paused" | "completed" | "archived";

export type Channel = "email" | "linkedin" | "sms" | "voice";

/** Prospect funnel, in order. Index in this array == funnel depth. */
export const STAGES = [
  "discovered",
  "researched",
  "qualified",
  "contacted",
  "engaged",
  "meeting",
  "opportunity",
] as const;
export type Stage = (typeof STAGES)[number];

/** Prospects the ICP agent rejected leave the funnel entirely. */
export type ProspectState = Stage | "rejected";

export type AgentKey =
  | "icp_fitment"
  | "research"
  | "outreach_strategy"
  | "personalisation"
  | "conversation"
  | "voice"
  | "followup";

export interface AgentDef {
  key: AgentKey;
  name: string;
  responsibility: string;
}

/** Static catalogue of the seven agents from the problem statement. */
export const AGENTS: AgentDef[] = [
  { key: "icp_fitment", name: "ICP Fitment Agent", responsibility: "Scores and qualifies or rejects prospects against campaign ICP criteria." },
  { key: "research", name: "Lead Research Agent", responsibility: "Researches the company and person, builds structured prospect context." },
  { key: "outreach_strategy", name: "Outreach Strategy Agent", responsibility: "Decides whether, when, on which channel and how to make contact." },
  { key: "personalisation", name: "Personalisation Agent", responsibility: "Writes the contextual message using prospect research and playbook examples." },
  { key: "conversation", name: "Conversation Agent", responsibility: "Reads replies across channels and decides the next action." },
  { key: "voice", name: "Voice SDR Agent", responsibility: "Runs qualification calls, handles objections, escalates to a human." },
  { key: "followup", name: "Follow-up Agent", responsibility: "Decides when and how to follow up, or when to stop." },
];

/**
 * Agents that can be driven by a real DronaHQ webhook today.
 *
 * Lives here rather than in `lib/dronahq.ts` so client components can import
 * it without pulling the env-reading server module into the browser bundle.
 * The Voice SDR agent is deliberately excluded from this build.
 */
export const LIVE_CAPABLE_AGENTS = [
  "icp_fitment",
  "research",
  "outreach_strategy",
  "personalisation",
  "conversation",
  "followup",
] as const satisfies readonly AgentKey[];

export type LiveAgentKey = (typeof LIVE_CAPABLE_AGENTS)[number];

export interface AgentConfig {
  key: AgentKey;
  enabled: boolean;
  /** Agent-level pause: this agent stops, the rest of the campaign continues. */
  paused: boolean;
}

export interface ChannelConfig {
  enabled: boolean;
  /** Channel-level pause: this channel stops, other channels continue. */
  paused: boolean;
}

/**
 * An immutable snapshot of a campaign's whole AI harness.
 * Editing prompts never mutates a version; it creates a new one.
 */
export interface PromptVersion {
  id: string;
  version: number;
  createdAt: string;
  author: string;
  note: string;
  systemPrompt: string;
  agentPrompts: Record<AgentKey, string>;
}

/**
 * Campaign policy, supplied to the DronaHQ agents as their declared input
 * variables. Field names here mirror the agents' own contracts so the mapping
 * in lib/agentContracts.ts stays one-to-one and greppable.
 */
export interface CampaignPolicy {
  /** ICP agent's min_score_threshold. DECIMAL 0-1, not a 0-100 score. */
  minScoreThreshold: number;
  /** Outreach + follow-up agents: sequence ceiling. */
  maxTouches: number;
  /** Outreach + follow-up agents: minimum days between touches. */
  minDaysBetweenTouches: number;
  /** Conversation agent: replies that must suppress the prospect outright. */
  stopPolicy: string;
  /** Conversation agent: replies that must go to a human. */
  escalationPolicy: string;
  /** Research agent: what this campaign wants the dossier to focus on. */
  researchFocus: string;
  /** Personalisation agent: framing only, never quoted at the prospect. */
  productPositioning: string;
  /** Personalisation agent: who the message is from. */
  senderIdentity: { name: string; title: string; company: string };
}

export interface ICP {
  label: string;
  geography: string;
  targetRoles: string[];
  companyCriteria: string;
  exclusions: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  owner: string;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  icp: ICP;
  channels: Record<Channel, ChannelConfig>;
  agents: AgentConfig[];
  /** Max autonomous outreach actions per day for this campaign. */
  dailyLimit: number;
  policy: CampaignPolicy;
  versions: PromptVersion[];
  activeVersionId: string;
}

export interface Prospect {
  id: string;
  campaignId: string;
  name: string;
  title: string;
  company: string;
  location: string;
  email: string;
  linkedin: string;
  /** Industry and headcount, scored by the COMPANY dimension of the ICP. */
  industry?: string;
  employeeCount?: number;
  state: ProspectState;
  /** 0-100 ICP fit score produced by the ICP Fitment Agent. */
  fitScore: number;
  /** Channels this prospect has actually been contacted on. */
  touched: Channel[];
  /** Sequence position input for the outreach and follow-up agents. */
  touchCount: number;
  /** ISO timestamp of the last outbound touch, for cadence decisions. */
  lastTouchAt?: string;
  /** Angles already used, so the next message leads on something new. */
  anglesUsed: string[];
  lastAction: string;
  lastActionAt: string;
  /**
   * Full brief produced by the Research Agent.
   *
   * Carried forward to every downstream agent so personalisation, strategy
   * and follow-up write from verified context instead of inventing facts
   * about the company.
   */
  researchBrief?: string;
  /** Structured dossier returned by the Research Agent, when it parsed. */
  dossier?: ProspectDossier;
  /**
   * What the prospect last said back, verbatim.
   *
   * Distinct from `lastAction`, which records what our own agents did. The
   * Conversation Agent classifies intent from this and must never be shown
   * the other: "opened but did not reply" is not a reply.
   */
  lastReply?: string;
  lastReplyAt?: string;
  lastReplyChannel?: Channel;
  /**
   * Parked pending a human verdict.
   *
   * Set when an agent escalates without moving the prospect on. The loop skips
   * these entirely: the escalating agent is deterministic, so re-running it
   * would return the same verdict and escalate again on every tick.
   */
  needsReview?: boolean;
}

/** Subset of the Research Agent's Prospect Dossier schema that the app uses. */
export interface ProspectDossier {
  company?: Record<string, unknown>;
  person?: Record<string, unknown>;
  signals?: string[];
  talking_points?: string[];
  pain_hypotheses?: string[];
  tech_stack?: string[];
  unknowns?: string[];
  flags?: string[];
  overall_confidence?: string;
}

/**
 * One retrievable piece of campaign knowledge.
 *
 * The campaign already owned its prompts, policy and targeting; this is the
 * knowledge those prompts kept referring to. Retrieval runs server-side only
 * (lib/knowledge.ts) — this type exists here so the control plane can list
 * and edit the corpus without importing anything that touches the database.
 */
export type ChunkKind =
  | "product"
  | "case_study"
  | "playbook"
  | "objection"
  | "example_email"
  | "voice_script"
  | "icp_definition";

export const CHUNK_KINDS: ChunkKind[] = [
  "product",
  "case_study",
  "playbook",
  "objection",
  "example_email",
  "voice_script",
  "icp_definition",
];

export interface KnowledgeChunk {
  id: string;
  /** null means platform-wide: shared by every campaign. */
  campaignId: string | null;
  kind: ChunkKind;
  title: string;
  content: string;
  /** Provenance, shown in the UI beside the chunk. */
  source: string;
  createdAt: string;
}

export type EventStatus = "success" | "failed" | "pending_approval";

/**
 * One meaningful action taken by an agent. Records the harness version that
 * was active at the time, so a manager can answer "why did the agent do that?".
 */
export interface ActivityEvent {
  id: string;
  campaignId: string;
  ts: string;
  agent: AgentKey | "system";
  channel?: Channel;
  prospectId?: string;
  prospectName?: string;
  summary: string;
  detail?: string;
  status: EventStatus;
  versionId: string;
  /** Rough token cost of the LLM call behind this action. */
  tokens: number;
  /**
   * Where this action actually came from. Recorded so the UI never claims a
   * DronaHQ agent ran when it did not.
   */
  source: "dronahq" | "simulated";
  /** Full content the agent generated, when it produced something sendable. */
  message?: string;
  /** Round-trip time of the DronaHQ call, in ms. */
  latencyMs?: number;
  /**
   * When a human resolved this escalation, and who.
   *
   * `status` stays 'pending_approval' after resolution. The log is an audit
   * trail, and overwriting the status would erase the fact that the agent
   * escalated at all.
   */
  resolvedAt?: string;
  resolvedBy?: string;
  /**
   * Knowledge retrieved before this action, if any.
   *
   * Recorded for the same reason as `source` and `versionId`: so a reader can
   * see what grounded an answer rather than taking the claim on trust.
   */
  retrieved?: RetrievedRef[];
}

/** One knowledge chunk that grounded an agent action. */
export interface RetrievedRef {
  title: string;
  kind: string;
  source: string;
}

/** Derived, never stored: computed from the campaign's prospects. */
export interface Funnel {
  discovered: number;
  researched: number;
  qualified: number;
  contacted: number;
  engaged: number;
  meeting: number;
  opportunity: number;
  rejected: number;
}
