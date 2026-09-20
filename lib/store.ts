"use client";

import { create } from "zustand";
import { SEED_CAMPAIGNS } from "./seed";
import type { Command, StateSnapshot } from "./commands";
import type {
  ActivityEvent,
  AgentKey,
  Campaign,
  CampaignStatus,
  Channel,
  Funnel,
  Prospect,
  ProspectState,
  PromptVersion,
} from "./types";
import { STAGES } from "./types";

/**
 * Client-side view of platform state.
 *
 * Postgres is the source of truth. This store holds a working copy so the UI
 * stays responsive: every action updates locally first, then posts a command
 * to `/api/state`. The optimistic copy and the database receive the same
 * entity — ids and timestamps included — because commands carry whole objects
 * rather than asking the server to invent them.
 *
 * Nothing is persisted to localStorage. State that outlives a reload lives in
 * the database, which is also what lets two people open the deployed URL and
 * see the same campaigns.
 */

/** Keep the in-memory feed bounded; the server trims its own copy too. */
const MAX_EVENTS = 400;

export type SyncState = "loading" | "ready" | "offline";

export interface SdrState {
  campaigns: Campaign[];
  prospects: Prospect[];
  activity: ActivityEvent[];
  /** Global kill switch: halts every autonomous external action, platform-wide. */
  killSwitch: boolean;

  /** Whether the snapshot has loaded, and whether writes are reaching the database. */
  sync: SyncState;
  lastError: string | null;

  /**
   * Agents backed by a real DronaHQ webhook, as reported by the server.
   * Environment-derived, so it is re-read on every load.
   */
  liveAgents: AgentKey[];
  setLiveAgents: (agents: AgentKey[]) => void;

  /**
   * Whether this browser tab is allowed to step campaigns.
   *
   * Deliberately local and unpersisted, unlike the kill switch. Every step is
   * a billable agent call, and a tab left open keeps spending whether or not
   * anyone is watching. This is one operator saying "not right now"; the kill
   * switch is "stop the platform", which is global, durable and logged.
   */
  loopEnabled: boolean;
  setLoopEnabled: (on: boolean) => void;

  // --- campaign lifecycle ---
  hydrate: () => Promise<void>;
  reconcile: () => Promise<void>;
  createCampaign: (input: NewCampaignInput) => string;
  setCampaignStatus: (campaignId: string, status: CampaignStatus) => void;
  duplicateCampaign: (campaignId: string) => string | null;

  // --- granular operational control ---
  toggleAgentPause: (campaignId: string, agent: AgentKey) => void;
  toggleChannelPause: (campaignId: string, channel: Channel) => void;
  setKillSwitch: (on: boolean) => void;

  // --- prompt / harness management ---
  saveVersion: (
    campaignId: string,
    payload: { systemPrompt: string; agentPrompts: Record<AgentKey, string>; note: string; author: string },
  ) => void;
  activateVersion: (campaignId: string, versionId: string) => void;

  // --- agent execution ---
  pushEvent: (event: Omit<ActivityEvent, "id" | "ts">) => void;
  advanceProspect: (prospectId: string, patch: Partial<Prospect>) => void;
  addProspect: (prospect: Prospect) => void;

  // --- human in the loop ---
  resolveEscalation: (eventId: string, decision: EscalationDecision) => void;

}

/**
 * What a reviewer decided about an escalation.
 *
 * 'acknowledged' exists because not every escalation holds a prospect: an
 * agent that handed a pricing question to a human left the prospect moving,
 * so there is nothing to release — only a note to clear.
 */
export type EscalationDecision = "approved" | "rejected" | "acknowledged";

/** Whoever is driving the console. Single-operator build; see README. */
const OPERATOR = "Priya Nair";

/** One step further down the funnel, or the same state at the end of it. */
function nextStage(state: ProspectState): ProspectState {
  const i = (STAGES as readonly string[]).indexOf(state);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : state;
}

function now() {
  return new Date().toISOString();
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export interface NewCampaignInput {
  name: string;
  description: string;
  owner: string;
  icp: Campaign["icp"];
  channels: Channel[];
  dailyLimit: number;
  systemPrompt: string;
}

// ---------------------------------------------------------------------------
// Server sync
// ---------------------------------------------------------------------------

/**
 * Writes currently in flight, and when the last one settled.
 *
 * The reconcile poll uses these to stay out of the way: while a write is
 * outstanding the local copy is deliberately ahead of the server, and
 * replacing it with a snapshot taken before that write landed would make the
 * UI flicker backwards.
 */
let writesInFlight = 0;
let lastWriteAt = 0;

/** How long after a write to leave the local copy alone. */
const WRITE_QUIET_MS = 2_000;

/**
 * Post a command without blocking the caller.
 *
 * The UI has already applied the change. If the write fails the store records
 * it and flips to "offline", so an operator can see that what is on screen is
 * no longer backed by the database rather than the failure passing silently.
 */
function dispatch(cmd: Command) {
  writesInFlight += 1;
  lastWriteAt = Date.now();
  void fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  })
    .then(async (res) => {
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      useSdr.setState({ sync: "ready", lastError: null });
    })
    .catch((err: unknown) => {
      useSdr.setState({
        sync: "offline",
        lastError: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      writesInFlight -= 1;
      lastWriteAt = Date.now();
    });
}

async function fetchSnapshot(): Promise<StateSnapshot> {
  const res = await fetch("/api/state", { cache: "no-store" });
  const json = (await res.json()) as { ok: boolean; state?: StateSnapshot; error?: string };
  if (!json.ok || !json.state) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.state;
}

export const useSdr = create<SdrState>()((set, get) => ({
  campaigns: [],
  prospects: [],
  activity: [],
  killSwitch: false,
  sync: "loading",
  lastError: null,
  liveAgents: [],
  loopEnabled: true,

  setLiveAgents: (agents) => set({ liveAgents: agents }),
  setLoopEnabled: (on) => set({ loopEnabled: on }),

  hydrate: async () => {
    try {
      set({ ...(await fetchSnapshot()), sync: "ready", lastError: null });
    } catch (err) {
      set({ sync: "offline", lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  /**
   * Re-read the database and replace the local copy.
   *
   * Without this the browser only ever reads on load, which has two
   * consequences: a tab open across a reseed keeps its deleted records and
   * writes them back, and two people on the same deployment silently diverge
   * because neither sees the other's changes.
   *
   * Skipped while a write is outstanding or has just landed, so an optimistic
   * update is never reverted by a snapshot taken before it reached the server.
   */
  reconcile: async () => {
    if (writesInFlight > 0) return;
    if (Date.now() - lastWriteAt < WRITE_QUIET_MS) return;
    try {
      set({ ...(await fetchSnapshot()), sync: "ready", lastError: null });
    } catch (err) {
      set({ sync: "offline", lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  createCampaign: (input) => {
    const id = uid("camp");
    const versionId = `${id}_v1`;
    // New campaigns inherit the baseline agent prompts and policy, so a fresh
    // campaign is usable before anyone edits it.
    const template = SEED_CAMPAIGNS[0];
    const campaign: Campaign = {
      id,
      name: input.name,
      description: input.description,
      owner: input.owner,
      // Always Draft: a brand-new campaign must never send outreach before a
      // human has reviewed it.
      status: "draft",
      createdAt: now(),
      updatedAt: now(),
      icp: input.icp,
      channels: {
        email: { enabled: input.channels.includes("email"), paused: false },
        linkedin: { enabled: input.channels.includes("linkedin"), paused: false },
        sms: { enabled: input.channels.includes("sms"), paused: false },
        voice: { enabled: input.channels.includes("voice"), paused: false },
      },
      agents: template.agents.map((a) => ({ ...a, enabled: true, paused: false })),
      dailyLimit: input.dailyLimit,
      policy: { ...template.policy },
      versions: [
        {
          id: versionId,
          version: 1,
          createdAt: now(),
          author: input.owner,
          note: "Initial harness",
          systemPrompt: input.systemPrompt,
          agentPrompts: template.versions[0].agentPrompts,
        },
      ],
      activeVersionId: versionId,
    };
    set((s) => ({ campaigns: [...s.campaigns, campaign] }));
    dispatch({ op: "upsertCampaign", campaign });
    return id;
  },

  setCampaignStatus: (campaignId, status) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;
    const label: Record<CampaignStatus, string> = {
      draft: "moved back to Draft",
      live: "activated — autonomous execution resumed",
      paused: "paused — all autonomous execution stopped, data retained",
      completed: "marked Completed",
      archived: "archived",
    };
    const event: ActivityEvent = {
      id: uid("evt"),
      campaignId,
      ts: now(),
      agent: "system",
      summary: `Campaign ${label[status]}`,
      status: "success",
      versionId: campaign.activeVersionId,
      tokens: 0,
      source: "simulated",
    };
    set((s) => ({
      campaigns: s.campaigns.map((c) =>
        c.id === campaignId ? { ...c, status, updatedAt: now() } : c,
      ),
      activity: [event, ...s.activity].slice(0, MAX_EVENTS),
    }));
    dispatch({ op: "setCampaignStatus", campaignId, status });
    dispatch({ op: "pushEvent", event });
  },

  duplicateCampaign: (campaignId) => {
    const source = get().campaigns.find((c) => c.id === campaignId);
    if (!source) return null;
    const newId = uid("camp");
    const copy: Campaign = {
      ...source,
      id: newId,
      name: `${source.name} (Variant B)`,
      status: "draft",
      createdAt: now(),
      updatedAt: now(),
      // Versions are cloned so the variant's prompt history is independent:
      // editing the variant must never touch the original campaign.
      versions: source.versions.map((v) => ({ ...v, id: `${v.id}_${newId}` })),
      activeVersionId: `${source.activeVersionId}_${newId}`,
    };
    set((s) => ({ campaigns: [...s.campaigns, copy] }));
    dispatch({ op: "upsertCampaign", campaign: copy });
    return newId;
  },

  toggleAgentPause: (campaignId, agent) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId);
    const paused = !campaign?.agents.find((a) => a.key === agent)?.paused;
    set((s) => ({
      campaigns: s.campaigns.map((c) =>
        c.id === campaignId
          ? {
              ...c,
              updatedAt: now(),
              agents: c.agents.map((a) => (a.key === agent ? { ...a, paused } : a)),
            }
          : c,
      ),
    }));
    dispatch({ op: "toggleAgentPause", campaignId, agent, paused });
  },

  toggleChannelPause: (campaignId, channel) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId);
    const paused = !campaign?.channels[channel].paused;
    set((s) => ({
      campaigns: s.campaigns.map((c) =>
        c.id === campaignId
          ? {
              ...c,
              updatedAt: now(),
              channels: { ...c.channels, [channel]: { ...c.channels[channel], paused } },
            }
          : c,
      ),
    }));
    dispatch({ op: "toggleChannelPause", campaignId, channel, paused });
  },

  setKillSwitch: (on) => {
    const event: ActivityEvent = {
      id: uid("evt"),
      campaignId: "*",
      ts: now(),
      agent: "system",
      summary: on
        ? "GLOBAL KILL SWITCH ENGAGED — all autonomous external actions halted platform-wide"
        : "Global kill switch released — campaigns resume their own states",
      status: "success",
      versionId: "-",
      tokens: 0,
      source: "simulated",
    };
    set((s) => ({ killSwitch: on, activity: [event, ...s.activity].slice(0, MAX_EVENTS) }));
    dispatch({ op: "setKillSwitch", on });
    dispatch({ op: "pushEvent", event });
  },

  saveVersion: (campaignId, payload) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;
    const version: PromptVersion = {
      id: uid("v"),
      version: Math.max(...campaign.versions.map((v) => v.version)) + 1,
      createdAt: now(),
      author: payload.author,
      note: payload.note || "No note",
      systemPrompt: payload.systemPrompt,
      agentPrompts: payload.agentPrompts,
    };
    // New versions activate immediately; older ones stay for rollback.
    set((s) => ({
      campaigns: s.campaigns.map((c) =>
        c.id === campaignId
          ? {
              ...c,
              updatedAt: now(),
              versions: [...c.versions, version],
              activeVersionId: version.id,
            }
          : c,
      ),
    }));
    dispatch({ op: "saveVersion", campaignId, version });
  },

  activateVersion: (campaignId, versionId) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId);
    const target = campaign?.versions.find((v) => v.id === versionId);
    if (!campaign || !target) return;
    const event: ActivityEvent = {
      id: uid("evt"),
      campaignId,
      ts: now(),
      agent: "system",
      summary: `Rolled back to harness v${target.version} — "${target.note}"`,
      status: "success",
      versionId,
      tokens: 0,
      source: "simulated",
    };
    set((s) => ({
      campaigns: s.campaigns.map((c) =>
        c.id === campaignId ? { ...c, activeVersionId: versionId, updatedAt: now() } : c,
      ),
      activity: [event, ...s.activity].slice(0, MAX_EVENTS),
    }));
    dispatch({ op: "activateVersion", campaignId, versionId });
    dispatch({ op: "pushEvent", event });
  },

  pushEvent: (event) => {
    const full: ActivityEvent = { ...event, id: uid("evt"), ts: now() };
    set((s) => ({ activity: [full, ...s.activity].slice(0, MAX_EVENTS) }));
    dispatch({ op: "pushEvent", event: full });
  },

  advanceProspect: (prospectId, patch) => {
    const full = { ...patch, lastActionAt: now() };
    set((s) => ({
      prospects: s.prospects.map((p) => (p.id === prospectId ? { ...p, ...full } : p)),
    }));
    dispatch({ op: "updateProspect", prospectId, patch: full });
  },

  addProspect: (prospect) => {
    set((s) => ({ prospects: [...s.prospects, prospect] }));
    dispatch({ op: "addProspect", prospect });
  },

  resolveEscalation: (eventId, decision) => {
    const state = get();
    const event = state.activity.find((e) => e.id === eventId);
    // Already resolved, by this operator or another tab. Resolving twice
    // would overwrite the name on the audit record.
    if (!event || event.resolvedAt) return;

    const prospect = event.prospectId
      ? state.prospects.find((p) => p.id === event.prospectId)
      : undefined;

    // Only a parked prospect moves. Acknowledging an escalation on a prospect
    // that kept flowing is a note, not a funnel decision.
    const parked = prospect?.needsReview ? prospect : undefined;
    const prospectState: ProspectState | undefined =
      parked && decision === "approved"
        ? nextStage(parked.state)
        : parked && decision === "rejected"
          ? "rejected"
          : undefined;

    const verb =
      decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "acknowledged";
    const lastAction = parked ? `Escalation ${verb} by ${OPERATOR}` : undefined;
    const resolvedAt = now();

    set((s) => ({
      activity: s.activity.map((e) =>
        e.id === eventId ? { ...e, resolvedAt, resolvedBy: OPERATOR } : e,
      ),
      prospects: s.prospects.map((p) =>
        parked && p.id === parked.id
          ? {
              ...p,
              needsReview: false,
              ...(prospectState ? { state: prospectState } : {}),
              ...(lastAction ? { lastAction, lastActionAt: resolvedAt } : {}),
            }
          : p,
      ),
    }));

    dispatch({
      op: "resolveEscalation",
      eventId,
      resolvedBy: OPERATOR,
      resolvedAt,
      ...(parked ? { prospectId: parked.id } : {}),
      ...(prospectState ? { prospectState } : {}),
      ...(lastAction ? { lastAction } : {}),
    });

    // The decision is itself an auditable action, and the point of the
    // escalation queue is showing that a human made it.
    get().pushEvent({
      campaignId: event.campaignId,
      agent: "system",
      prospectId: parked?.id,
      prospectName: parked?.name ?? event.prospectName,
      summary: parked
        ? `${OPERATOR} ${verb} the escalation on ${parked.name}` +
          (prospectState ? ` — moved to ${prospectState}` : "")
        : `${OPERATOR} ${verb} an escalation`,
      status: "success",
      versionId:
        state.campaigns.find((c) => c.id === event.campaignId)?.activeVersionId ?? "-",
      tokens: 0,
      source: "simulated",
    });
  },
}));

// ---------------------------------------------------------------------------
// Derived selectors — computed, never stored, so the numbers can never drift
// ---------------------------------------------------------------------------

export function funnelFor(prospects: Prospect[], campaignId: string): Funnel {
  const mine = prospects.filter((p) => p.campaignId === campaignId);
  const counts: Funnel = {
    discovered: 0, researched: 0, qualified: 0, contacted: 0,
    engaged: 0, meeting: 0, opportunity: 0, rejected: 0,
  };
  for (const p of mine) {
    if (p.state === "rejected") {
      counts.rejected += 1;
      continue;
    }
    // The funnel is cumulative: someone at "meeting" was also discovered.
    const depth = STAGES.indexOf(p.state);
    for (let i = 0; i <= depth; i++) counts[STAGES[i]] += 1;
  }
  return counts;
}

export interface CampaignMetrics {
  prospects: number;
  outreach: number;
  meetings: number;
  replies: number;
  failures: number;
  escalations: number;
  tokens: number;
  funnel: Funnel;
}

/** Agents whose successful actions represent outreach actually going out. */
const OUTREACH_AGENTS: Array<AgentKey | "system"> = ["personalisation", "voice", "followup"];

export function metricsFor(
  prospects: Prospect[],
  activity: ActivityEvent[],
  campaignId: string,
): CampaignMetrics {
  const funnel = funnelFor(prospects, campaignId);
  const events = activity.filter((e) => e.campaignId === campaignId);
  return {
    prospects: prospects.filter((p) => p.campaignId === campaignId).length,
    outreach: events.filter((e) => OUTREACH_AGENTS.includes(e.agent) && e.status === "success").length,
    meetings: funnel.meeting,
    replies: events.filter((e) => e.agent === "conversation").length,
    failures: events.filter((e) => e.status === "failed").length,
    escalations: events.filter((e) => e.status === "pending_approval" && !e.resolvedAt).length,
    tokens: events.reduce((sum, e) => sum + e.tokens, 0),
    funnel,
  };
}

/**
 * Cross-campaign conflict detection: the same human targeted by more than one
 * campaign at once. Keyed on email, the only identifier stable across sources.
 */
export function findConflicts(prospects: Prospect[], campaigns: Campaign[]) {
  const byEmail = new Map<string, Prospect[]>();
  for (const p of prospects) {
    const list = byEmail.get(p.email) ?? [];
    list.push(p);
    byEmail.set(p.email, list);
  }
  const liveIds = new Set(campaigns.filter((c) => c.status === "live").map((c) => c.id));
  return [...byEmail.values()]
    // Only a conflict when DIFFERENT campaigns target the same person. Two
    // records of one person inside a single campaign is a deduplication bug,
    // not a cross-campaign conflict, and reporting it as one produced
    // "targeted by X and X".
    .filter((group) => new Set(group.map((p) => p.campaignId)).size > 1)
    .map((group) => ({
      email: group[0].email,
      name: group[0].name,
      entries: group,
      /** Only a real problem when more than one of those campaigns is Live. */
      bothLive: group.filter((p) => liveIds.has(p.campaignId)).length > 1,
    }));
}
