"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  SEED_CAMPAIGNS,
  SEED_PROSPECTS,
  buildSeedActivity,
} from "./seed";
import type {
  ActivityEvent,
  AgentKey,
  Campaign,
  CampaignStatus,
  Channel,
  Funnel,
  Prospect,
  PromptVersion,
} from "./types";
import { STAGES } from "./types";

/** Keep the feed bounded so localStorage never blows up during a long demo. */
const MAX_EVENTS = 400;

export interface SdrState {
  campaigns: Campaign[];
  prospects: Prospect[];
  activity: ActivityEvent[];
  /** Global kill switch: halts every autonomous external action, platform-wide. */
  killSwitch: boolean;

  // --- campaign lifecycle ---
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

  // --- agent execution (called by the simulator, later by the real backend) ---
  pushEvent: (event: Omit<ActivityEvent, "id" | "ts">) => void;
  advanceProspect: (prospectId: string, patch: Partial<Prospect>) => void;
  addProspect: (prospect: Prospect) => void;

  resetDemo: () => void;
}

function now() {
  return new Date().toISOString();
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function initialState() {
  return {
    campaigns: SEED_CAMPAIGNS,
    prospects: SEED_PROSPECTS,
    activity: buildSeedActivity(Date.parse("2026-09-20T09:00:00.000Z")),
    killSwitch: false,
  };
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

export const useSdr = create<SdrState>()(
  persist(
    (set, get) => ({
      ...initialState(),

      createCampaign: (input) => {
        const id = uid("camp");
        // New campaigns inherit the baseline agent prompts from the seed
        // catalogue, so a fresh campaign is usable before anyone edits it.
        const template = SEED_CAMPAIGNS[0].versions[0];
        const campaign: Campaign = {
          id,
          name: input.name,
          description: input.description,
          owner: input.owner,
          // Always Draft: a brand-new campaign must never send outreach
          // before a human has reviewed it.
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
          agents: SEED_CAMPAIGNS[0].agents.map((a) => ({ ...a, enabled: true, paused: false })),
          dailyLimit: input.dailyLimit,
          versions: [
            {
              id: `${id}_v1`,
              version: 1,
              createdAt: now(),
              author: input.owner,
              note: "Initial harness",
              systemPrompt: input.systemPrompt,
              agentPrompts: template.agentPrompts,
            },
          ],
          activeVersionId: `${id}_v1`,
        };
        set((s) => ({ campaigns: [...s.campaigns, campaign] }));
        return id;
      },

      setCampaignStatus: (campaignId, status) =>
        set((s) => {
          const campaign = s.campaigns.find((c) => c.id === campaignId);
          if (!campaign) return s;
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
          };
          return {
            campaigns: s.campaigns.map((c) =>
              c.id === campaignId ? { ...c, status, updatedAt: now() } : c,
            ),
            activity: [event, ...s.activity].slice(0, MAX_EVENTS),
          };
        }),

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
        return newId;
      },

      toggleAgentPause: (campaignId, agent) =>
        set((s) => ({
          campaigns: s.campaigns.map((c) =>
            c.id === campaignId
              ? {
                  ...c,
                  updatedAt: now(),
                  agents: c.agents.map((a) =>
                    a.key === agent ? { ...a, paused: !a.paused } : a,
                  ),
                }
              : c,
          ),
        })),

      toggleChannelPause: (campaignId, channel) =>
        set((s) => ({
          campaigns: s.campaigns.map((c) =>
            c.id === campaignId
              ? {
                  ...c,
                  updatedAt: now(),
                  channels: {
                    ...c.channels,
                    [channel]: { ...c.channels[channel], paused: !c.channels[channel].paused },
                  },
                }
              : c,
          ),
        })),

      setKillSwitch: (on) =>
        set((s) => ({
          killSwitch: on,
          activity: [
            {
              id: uid("evt"),
              campaignId: "*",
              ts: now(),
              agent: "system" as const,
              summary: on
                ? "GLOBAL KILL SWITCH ENGAGED — all autonomous external actions halted platform-wide"
                : "Global kill switch released — campaigns resume their own states",
              status: "success" as const,
              versionId: "-",
              tokens: 0,
            },
            ...s.activity,
          ].slice(0, MAX_EVENTS),
        })),

      saveVersion: (campaignId, payload) =>
        set((s) => ({
          campaigns: s.campaigns.map((c) => {
            if (c.id !== campaignId) return c;
            const nextNumber = Math.max(...c.versions.map((v) => v.version)) + 1;
            const newVersion: PromptVersion = {
              id: uid("v"),
              version: nextNumber,
              createdAt: now(),
              author: payload.author,
              note: payload.note || "No note",
              systemPrompt: payload.systemPrompt,
              agentPrompts: payload.agentPrompts,
            };
            // New versions activate immediately; older ones stay for rollback.
            return {
              ...c,
              updatedAt: now(),
              versions: [...c.versions, newVersion],
              activeVersionId: newVersion.id,
            };
          }),
        })),

      activateVersion: (campaignId, versionId) =>
        set((s) => {
          const campaign = s.campaigns.find((c) => c.id === campaignId);
          const target = campaign?.versions.find((v) => v.id === versionId);
          if (!campaign || !target) return s;
          return {
            campaigns: s.campaigns.map((c) =>
              c.id === campaignId ? { ...c, activeVersionId: versionId, updatedAt: now() } : c,
            ),
            activity: [
              {
                id: uid("evt"),
                campaignId,
                ts: now(),
                agent: "system" as const,
                summary: `Rolled back to harness v${target.version} — "${target.note}"`,
                status: "success" as const,
                versionId,
                tokens: 0,
              },
              ...s.activity,
            ].slice(0, MAX_EVENTS),
          };
        }),

      pushEvent: (event) =>
        set((s) => ({
          activity: [{ ...event, id: uid("evt"), ts: now() }, ...s.activity].slice(0, MAX_EVENTS),
        })),

      advanceProspect: (prospectId, patch) =>
        set((s) => ({
          prospects: s.prospects.map((p) =>
            p.id === prospectId ? { ...p, ...patch, lastActionAt: now() } : p,
          ),
        })),

      addProspect: (prospect) => set((s) => ({ prospects: [...s.prospects, prospect] })),

      resetDemo: () => set(initialState()),
    }),
    {
      name: "sdr-autopilot-v1",
      version: 1,
    },
  ),
);

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

/** Channels an outreach action can actually be sent on. */
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
    escalations: events.filter((e) => e.status === "pending_approval").length,
    tokens: events.reduce((sum, e) => sum + e.tokens, 0),
    funnel,
  };
}

/**
 * Cross-campaign conflict detection: the same human being targeted by more
 * than one campaign at the same time. Keyed on email, which is the only
 * identifier that is stable across sources.
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
    .filter((group) => group.length > 1)
    .map((group) => ({
      email: group[0].email,
      name: group[0].name,
      entries: group,
      /** Only a real problem when more than one of those campaigns is Live. */
      bothLive: group.filter((p) => liveIds.has(p.campaignId)).length > 1,
    }));
}
