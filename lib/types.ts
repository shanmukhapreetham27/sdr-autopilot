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
  versions: PromptVersion[];
  activeVersionId: string;
}

export interface ResearchNote {
  label: string;
  value: string;
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
  state: ProspectState;
  /** 0-100 ICP fit score produced by the ICP Fitment Agent. */
  fitScore: number;
  /** Channels this prospect has actually been contacted on. */
  touched: Channel[];
  lastAction: string;
  lastActionAt: string;
  research: ResearchNote[];
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
