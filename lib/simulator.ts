"use client";

import type { AgentKey, Campaign, Channel, Prospect, Stage } from "./types";
import { useSdr } from "./store";
import { buildAgentRequest, invokeAgent, type LiveAgentKey } from "./agentClient";
import { summarise } from "./agentBrief";

/**
 * Agent execution loop.
 *
 * Each tick, every Live campaign gets one chance to act. `decideStep` picks
 * which prospect moves, which agent owns the move, and which channel is open
 * — enforcing campaign status, per-agent pause, per-channel pause and the
 * global kill switch before any action can be produced.
 *
 * How the step is then executed depends on configuration:
 *   - If the owning agent has a DronaHQ webhook configured, the real agent is
 *     called and its structured response drives the outcome.
 *   - Otherwise the step falls back to a locally generated narration, so the
 *     control plane is fully demonstrable without every agent wired.
 *
 * Every activity event records which of the two actually happened, so the UI
 * never claims a DronaHQ agent ran when it did not.
 */

export interface AgentStep {
  campaignId: string;
  prospect: Prospect;
  agent: AgentKey;
  channel?: Channel;
  nextState: Prospect["state"];
  summary: string;
  lastAction: string;
  status: "success" | "failed" | "pending_approval";
  tokens: number;
  fitScore?: number;
}

/** Which agent owns the transition out of each stage. */
const STAGE_OWNER: Record<Stage, AgentKey> = {
  discovered: "research",
  researched: "icp_fitment",
  qualified: "personalisation",
  contacted: "followup",
  engaged: "conversation",
  meeting: "conversation",
  opportunity: "conversation",
};

const NEXT_STATE: Record<Stage, Stage | null> = {
  discovered: "researched",
  researched: "qualified",
  qualified: "contacted",
  contacted: "engaged",
  engaged: "meeting",
  meeting: "opportunity",
  opportunity: null,
};

/**
 * Probability that a prospect actually moves forward out of each stage.
 *
 * Top-of-funnel work is deterministic: research and qualification always
 * produce a verdict. Everything downstream depends on a human replying, so
 * most attempts do not advance the prospect — they produce a follow-up
 * instead. This is what gives the funnel its taper.
 */
const ADVANCE_PROB: Record<Stage, number> = {
  discovered: 1,
  researched: 1,
  qualified: 1,
  contacted: 0.3,
  engaged: 0.25,
  meeting: 0.3,
  opportunity: 0,
};

/** Upper bound on prospects per campaign, so a long demo stays responsive. */
const MAX_PROSPECTS_PER_CAMPAIGN = 45;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Message templates per agent, filled with real prospect context. */
function narrate(agent: AgentKey, p: Prospect, channel?: Channel): string {
  // Not every stage touches a prospect, so `channel` can legitimately be
  // absent (e.g. meeting -> opportunity). Copy must never name "undefined".
  const via = channel ? ` on ${channel}` : "";
  const noun = channel ?? "outreach";
  switch (agent) {
    case "research":
      return pick([
        `Built research brief for ${p.company}: headcount, funding stage and current stack signals`,
        `Enriched ${p.name} — confirmed ${p.title} at ${p.company}, found a public hook worth using`,
        `Researched ${p.company}: pulled recent news and one specific engineering signal`,
      ]);
    case "icp_fitment":
      return pick([
        `Scored ${p.name} against campaign ICP — ${p.title} at ${p.company} clears the role and size floor`,
        `Qualified ${p.company}: matches company criteria, no exclusion rule triggered`,
        `ICP check passed for ${p.name}, structured verdict returned with 3 supporting reasons`,
      ]);
    case "personalisation":
      return pick([
        `Drafted ${noun} opener for ${p.name}, grounded in the research brief`,
        `Wrote ${noun} message to ${p.name} at ${p.company} — one specific hook, no invented claims`,
        `Generated ${noun} message for ${p.name}, retrieved 2 playbook examples first`,
      ]);
    case "outreach_strategy":
      return `Selected ${noun} as first touch for ${p.name} based on engagement signal`;
    case "followup":
      return pick([
        `Scheduled follow-up${via} for ${p.name}, angle changed from touch 1`,
        `${p.name} opened but did not reply — queued touch 2${via}`,
      ]);
    case "conversation":
      return pick([
        `${p.name} replied${via} — classified as interested, proposed call slots`,
        `Read reply from ${p.name}, intent = interested, moved forward`,
        `${p.name} confirmed a slot — meeting booked and logged to CRM`,
      ]);
    case "voice":
      return `Completed qualification call with ${p.name}, budget and timeline captured`;
  }
}

/** Channel the campaign is actually allowed to use right now. */
function availableChannel(campaign: Campaign): Channel | null {
  const usable = (Object.keys(campaign.channels) as Channel[]).filter(
    (c) => campaign.channels[c].enabled && !campaign.channels[c].paused,
  );
  return usable.length ? pick(usable) : null;
}

function agentAllowed(campaign: Campaign, agent: AgentKey): boolean {
  const cfg = campaign.agents.find((a) => a.key === agent);
  return !!cfg && cfg.enabled && !cfg.paused;
}

/**
 * Decide the next step for one campaign, or return null if nothing is
 * permitted right now (paused campaign, paused agent, no open channel,
 * or no prospect left to move).
 */
export function decideStep(campaign: Campaign, prospects: Prospect[]): AgentStep | null {
  if (campaign.status !== "live") return null;

  const mine = prospects.filter(
    (p) => p.campaignId === campaign.id && p.state !== "rejected" && p.state !== "opportunity",
  );
  if (!mine.length) return null;

  // Build the set of prospects that are actually actionable right now: the
  // owning agent is running, and any channel the step needs is open.
  const eligible: Array<{ prospect: Prospect; stage: Stage; agent: AgentKey; channel?: Channel }> = [];

  for (const prospect of mine) {
    const stage = prospect.state as Stage;
    const agent = STAGE_OWNER[stage];
    if (!NEXT_STATE[stage]) continue;
    if (!agentAllowed(campaign, agent)) continue;

    // Only the stages that actually touch a prospect need an open channel.
    const needsChannel = stage === "qualified" || stage === "contacted" || stage === "engaged";
    let channel: Channel | undefined;
    if (needsChannel) {
      const open = availableChannel(campaign);
      if (!open) continue;
      channel = open;
    }
    eligible.push({ prospect, stage, agent, channel });
  }

  if (!eligible.length) return null;

  // Pick at random rather than always taking the top of the funnel. Discovery
  // adds new leads continuously, so a strict top-first order would starve
  // every prospect further down and the funnel would never progress.
  const chosen = pick(eligible);

  {
    const { prospect, stage, agent, channel } = chosen;
    const nextState = NEXT_STATE[stage]!;

    // The ICP agent genuinely rejects a slice of prospects rather than
    // marching everyone down the funnel.
    if (stage === "researched" && Math.random() < 0.18) {
      return {
        campaignId: campaign.id,
        prospect,
        agent,
        nextState: "rejected",
        summary: `Rejected ${prospect.name} — ${prospect.company} fails campaign exclusion criteria`,
        lastAction: "Rejected by ICP Fitment Agent",
        status: "success",
        tokens: 300 + Math.floor(Math.random() * 400),
        fitScore: 30 + Math.floor(Math.random() * 20),
      };
    }

    // A small share of replies are things an agent must not answer alone.
    if (stage === "contacted" && Math.random() < 0.15) {
      return {
        campaignId: campaign.id,
        prospect,
        agent: "conversation",
        channel,
        nextState: "engaged",
        summary: `${prospect.name} asked about pricing — escalated to the human rep, no autonomous reply sent`,
        lastAction: "Escalated to human: pricing question",
        status: "pending_approval",
        tokens: 500 + Math.floor(Math.random() * 400),
      };
    }

    // Real integrations fail sometimes; the loop has to survive it.
    if (Math.random() < 0.06) {
      return {
        campaignId: campaign.id,
        prospect,
        agent,
        channel,
        nextState: prospect.state,
        summary: `${channel ?? "Enrichment"} call failed for ${prospect.name} — retrying on next cycle`,
        lastAction: "Transient failure, will retry",
        status: "failed",
        tokens: 120,
      };
    }

    // Most downstream attempts do not move the prospect: the agent works the
    // account and waits. This keeps the funnel shaped like a funnel.
    if (Math.random() > ADVANCE_PROB[stage]) {
      // Stages that don't touch a prospect (e.g. meeting -> opportunity) have
      // no channel, so the copy must not name one.
      const via = channel ? ` on ${channel}` : "";
      const waiting = pick([
        `No reply from ${prospect.name} yet — follow-up queued${via}, angle changed`,
        `${prospect.name} opened but did not reply. Holding for 2 days before touch ${prospect.touched.length + 1}`,
        `Re-checked ${prospect.company} for new signals before following up with ${prospect.name}`,
      ]);
      return {
        campaignId: campaign.id,
        prospect,
        agent: "followup",
        channel,
        nextState: prospect.state,
        summary: waiting,
        lastAction: waiting,
        status: "success",
        tokens: 200 + Math.floor(Math.random() * 300),
      };
    }

    const line = narrate(agent, prospect, channel);
    return {
      campaignId: campaign.id,
      prospect,
      agent,
      channel,
      nextState,
      summary: line,
      lastAction: line,
      status: "success",
      tokens: 400 + Math.floor(Math.random() * 900),
      fitScore:
        stage === "researched"
          ? 60 + Math.floor(Math.random() * 38)
          : undefined,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Lead discovery: keeps the top of the funnel filling while a campaign is live
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Alex", "Priya", "Jordan", "Meera", "Sam", "Ananya", "Chris", "Rohan", "Taylor",
  "Nisha", "Morgan", "Kabir", "Casey", "Divya", "Riley", "Arun", "Quinn", "Leila",
];
const LAST_NAMES = [
  "Hart", "Kapoor", "Mercer", "Shah", "Novak", "Reddy", "Blake", "Menon", "Castellan",
  "Verma", "Orwell", "Bhatt", "Lindgren", "Saxena", "Rowe", "Chandra", "Vance", "Dutta",
];

interface DiscoveryPool {
  titles: string[];
  companies: string[];
  locations: string[];
  source: string;
}

const DISCOVERY_POOLS: Record<string, DiscoveryPool> = {
  camp_ussaas: {
    titles: ["CTO", "VP Engineering", "Head of Platform", "Director of Engineering"],
    companies: ["Hollowpoint", "Runway Metrics", "Kestrel Cloud", "Vantage Ops", "Brambleworks", "Signalpost", "Northgate SaaS"],
    locations: ["Austin, TX", "San Francisco, CA", "New York, NY", "Boston, MA", "Denver, CO", "Seattle, WA"],
    source: "Apollo search: US B2B SaaS, 50-1000 employees",
  },
  camp_bfsi: {
    titles: ["CIO", "CTO", "Head of Digital Transformation", "Head of Technology"],
    companies: ["Sahyadri Bank", "Konark Finserv", "Deccan Mutual", "Brahmaputra Capital", "Vindhya Insurance", "Kaveri NBFC"],
    locations: ["Mumbai", "Bengaluru", "Delhi", "Chennai", "Pune", "Hyderabad"],
    source: "Apollo search: India BFSI, 500+ employees",
  },
  camp_voiceai: {
    titles: ["Founder", "Co-founder & CEO", "CTO & Co-founder", "CEO"],
    companies: ["Timbre AI", "Resonant", "Vox Systems", "Chorus Labs", "Sotto Voce", "Quietloud AI"],
    locations: ["San Francisco, CA", "New York, NY", "Palo Alto, CA", "Austin, TX", "Remote, US"],
    source: "LinkedIn + Crunchbase: seed/Series A voice AI",
  },
};

const DEFAULT_POOL: DiscoveryPool = {
  titles: ["VP Engineering", "Director of Platform", "Head of Technology"],
  companies: ["Meridian Systems", "Alderway", "Pinehurst Digital", "Copperline"],
  locations: ["Remote", "London", "Singapore", "Toronto"],
  source: "Apollo search matching campaign ICP",
};

function discoverProspect(campaign: Campaign): { prospect: Prospect; source: string } {
  const pool = DISCOVERY_POOLS[campaign.id] ?? DEFAULT_POOL;
  const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const company = pick(pool.companies);
  const handle = name.toLowerCase().replace(/[^a-z]+/g, ".");
  const domain = company.toLowerCase().replace(/[^a-z0-9]+/g, "") + ".com";

  return {
    source: pool.source,
    prospect: {
      id: `p_${Math.random().toString(36).slice(2, 9)}`,
      campaignId: campaign.id,
      name,
      title: pick(pool.titles),
      company,
      location: pick(pool.locations),
      email: `${handle}@${domain}`,
      linkedin: `linkedin.com/in/${handle.replace(/\./g, "-")}`,
      state: "discovered",
      fitScore: 0,
      touched: [],
      lastAction: "Discovered, awaiting ICP scoring",
      lastActionAt: new Date().toISOString(),
      research: [],
    },
  };
}

/** Channels this campaign may currently use, for the agent payload. */
function openChannels(campaign: Campaign): Channel[] {
  return (Object.keys(campaign.channels) as Channel[]).filter(
    (c) => campaign.channels[c].enabled && !campaign.channels[c].paused,
  );
}

/**
 * Execute one decided step, calling the real DronaHQ agent when that agent is
 * wired. Returns the event to log and the prospect patch to apply.
 */
async function executeStep(campaign: Campaign, step: AgentStep, liveAgents: AgentKey[]) {
  const { prospect } = step;

  const useLive =
    liveAgents.includes(step.agent) &&
    // A locally-decided failure or escalation is part of the simulation and
    // must not be passed off as a DronaHQ result.
    step.status === "success";

  if (!useLive) {
    return {
      source: "simulated" as const,
      summary: step.summary,
      lastAction: step.lastAction,
      status: step.status,
      nextState: step.nextState,
      tokens: step.tokens,
      fitScore: step.fitScore,
      message: undefined as string | undefined,
      latencyMs: undefined as number | undefined,
      researchBrief: undefined as string | undefined,
    };
  }

  const payload = buildAgentRequest(
    step.agent as LiveAgentKey,
    campaign,
    prospect,
    openChannels(campaign),
  );
  const outcome = await invokeAgent(step.agent as LiveAgentKey, payload);

  if (!outcome.ok) {
    // A failed DronaHQ call is a real operational failure: log it honestly and
    // leave the prospect where it is so the next tick retries.
    return {
      source: "dronahq" as const,
      summary: `DronaHQ ${step.agent} call failed for ${prospect.name}: ${outcome.error}`,
      lastAction: "DronaHQ call failed, will retry",
      status: "failed" as const,
      nextState: prospect.state,
      tokens: 0,
      fitScore: undefined,
      message: undefined,
      latencyMs: outcome.ms,
      researchBrief: undefined,
    };
  }

  const r = outcome.result;

  // The agent's own verdict overrides the locally decided outcome.
  const rejected = r.advance === false && step.agent === "icp_fitment";
  const held = r.advance === false && step.agent !== "icp_fitment";

  const nextState = rejected
    ? ("rejected" as const)
    : held
      ? prospect.state
      : step.nextState;

  const headline = summarise(r.text);
  const scoreNote = r.score !== undefined ? ` (${r.score}/100)` : "";
  const verdictNote = r.verdict ? ` — ${r.verdict}` : "";

  return {
    source: "dronahq" as const,
    summary: `${prospect.name}${scoreNote}${verdictNote}: ${headline}`,
    lastAction: headline,
    status: r.escalate ? ("pending_approval" as const) : ("success" as const),
    nextState,
    // DronaHQ does not return token usage on the webhook response, and
    // attributing a simulated number to a real agent run would make the cost
    // figures fiction. Latency is recorded instead; usage lives in DronaHQ's
    // own credit dashboard.
    tokens: 0,
    fitScore: r.score ?? step.fitScore,
    // Keep the agent's full output so a manager can read exactly what it
    // produced, not just the one-line summary.
    message: r.text,
    latencyMs: outcome.ms,
    // Persist the Research Agent's brief on the prospect so downstream
    // agents write from verified context rather than inventing facts.
    researchBrief: step.agent === "research" ? r.text : undefined,
  };
}

/**
 * Campaigns currently mid-step.
 *
 * Tracked per campaign, not globally: a live DronaHQ call can take tens of
 * seconds, and a single global lock would let one slow campaign stall every
 * other campaign on the platform.
 */
const inFlight = new Set<string>();

/** One tick of the whole platform: every live campaign gets a chance to act. */
export async function runTick() {
  const state = useSdr.getState();
  if (state.killSwitch) return;

  await Promise.all(
    state.campaigns
      .filter((c) => !inFlight.has(c.id))
      .map(async (campaign) => {
        inFlight.add(campaign.id);
        try {
          await runCampaignTick(campaign);
        } catch {
          // A campaign must never be able to wedge the loop for the others.
        } finally {
          inFlight.delete(campaign.id);
        }
      }),
  );
}

async function runCampaignTick(campaign: Campaign) {
  const store = useSdr.getState();

  // --- lead discovery ---
  if (campaign.status === "live") {
    const count = store.prospects.filter((p) => p.campaignId === campaign.id).length;
    if (count < MAX_PROSPECTS_PER_CAMPAIGN && Math.random() < 0.4) {
      const { prospect, source } = discoverProspect(campaign);
      store.addProspect(prospect);
      store.pushEvent({
        campaignId: campaign.id,
        agent: "research",
        prospectId: prospect.id,
        prospectName: prospect.name,
        summary: `Discovered ${prospect.name}, ${prospect.title} at ${prospect.company} — ${source}`,
        status: "success",
        versionId: campaign.activeVersionId,
        tokens: 150 + Math.floor(Math.random() * 200),
        source: "simulated",
      });
    }
  }

  // --- one agent step ---
  const step = decideStep(campaign, useSdr.getState().prospects);
  if (!step) return;

  const outcome = await executeStep(campaign, step, useSdr.getState().liveAgents);
  const { prospect } = step;

  const touched =
    step.channel && !prospect.touched.includes(step.channel) && outcome.status === "success"
      ? [...prospect.touched, step.channel]
      : prospect.touched;

  // Re-read the store: a live call may have taken seconds, and the operator
  // could have paused the campaign in the meantime.
  const latest = useSdr.getState();
  const current = latest.campaigns.find((c) => c.id === campaign.id);
  if (!current || current.status !== "live" || latest.killSwitch) return;

  latest.advanceProspect(prospect.id, {
    state: outcome.nextState,
    lastAction: outcome.lastAction,
    touched,
    ...(outcome.fitScore !== undefined ? { fitScore: outcome.fitScore } : {}),
    ...(outcome.researchBrief ? { researchBrief: outcome.researchBrief } : {}),
  });

  latest.pushEvent({
    campaignId: campaign.id,
    agent: step.agent,
    channel: step.channel,
    prospectId: prospect.id,
    prospectName: prospect.name,
    summary: outcome.summary,
    status: outcome.status,
    versionId: campaign.activeVersionId,
    tokens: outcome.tokens,
    source: outcome.source,
    message: outcome.message,
    latencyMs: outcome.latencyMs,
  });
}
