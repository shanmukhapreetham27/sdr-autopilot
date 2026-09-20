"use client";

import type { AgentKey, Campaign, Channel, Prospect, Stage } from "./types";
import { useSdr } from "./store";
import { factsFor } from "./companies";
import { describeVerdict, scoreProspect } from "./icpScorer";
import {
  buildAgentRequest,
  invokeAgent,
  sendAgentEmail,
  type LiveAgentKey,
} from "./agentClient";

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

/**
 * Channel for this prospect's next touch.
 *
 * Follows the Outreach Strategy agent's documented preference order rather
 * than picking at random: email, linkedin, email, voice, sms by sequence
 * step. Voice and SMS are never a first touch, whatever is enabled — that is
 * the agent's own rule, and a cold call before any written contact is exactly
 * the behaviour it exists to prevent.
 *
 * Returns null when nothing is permitted, which the caller treats the way the
 * agent would: skip, no eligible channel.
 */
const CHANNEL_ORDER: Channel[][] = [
  ["email", "linkedin"], // touch 1
  ["linkedin", "email"], // touch 2, change the medium
  ["email", "linkedin"], // touch 3
  ["voice", "email", "linkedin"], // touch 4, earned by persistence
  ["sms", "email", "linkedin"], // touch 5 and beyond
];

function preferredChannel(campaign: Campaign, prospect: Prospect): Channel | null {
  const open = (Object.keys(campaign.channels) as Channel[]).filter(
    (c) => campaign.channels[c].enabled && !campaign.channels[c].paused,
  );
  const allowed =
    prospect.touchCount === 0 ? open.filter((c) => c !== "voice" && c !== "sms") : open;
  if (!allowed.length) return null;

  const step = Math.min(prospect.touchCount, CHANNEL_ORDER.length - 1);
  return CHANNEL_ORDER[step].find((c) => allowed.includes(c)) ?? allowed[0];
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
      const open = preferredChannel(campaign, prospect);
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

interface PoolCompany {
  name: string;
  domain: string;
  location: string;
}

interface DiscoveryPool {
  titles: string[];
  companies: PoolCompany[];
}

/**
 * Discovery pools.
 *
 * These are REAL, publicly known companies. That is deliberate and it matters:
 * the Research Agent performs live web lookups, so an invented company name
 * does not come back empty — it gets matched to some unrelated real business
 * and the agent returns a confident, sourced brief about the wrong company.
 * Real names mean the research, the ICP score and the personalisation are all
 * checkable against reality.
 *
 * Each pool mixes companies that clearly fit the campaign ICP with a few that
 * genuinely do not, so the ICP Fitment Agent has real decisions to make rather
 * than rubber-stamping everything.
 *
 * Contact names are synthetic. Real individuals' details are deliberately not
 * used in a system that models outbound outreach.
 */
const DISCOVERY_POOLS: Record<string, DiscoveryPool> = {
  camp_ussaas: {
    titles: ["CTO", "VP Engineering", "Head of Platform", "Director of Engineering"],
    companies: [
      { name: "Linear", domain: "linear.app", location: "San Francisco, CA" },
      { name: "Retool", domain: "retool.com", location: "San Francisco, CA" },
      { name: "Render", domain: "render.com", location: "San Francisco, CA" },
      { name: "Temporal", domain: "temporal.io", location: "Seattle, WA" },
      { name: "Vanta", domain: "vanta.com", location: "San Francisco, CA" },
      { name: "Airbyte", domain: "airbyte.com", location: "San Francisco, CA" },
      { name: "WorkOS", domain: "workos.com", location: "San Francisco, CA" },
      { name: "Honeycomb", domain: "honeycomb.io", location: "San Francisco, CA" },
      { name: "Clerk", domain: "clerk.com", location: "San Francisco, CA" },
      { name: "Sentry", domain: "sentry.io", location: "San Francisco, CA" },
      // Consultancy — excluded by this campaign's criteria, so the ICP agent
      // should reject it.
      { name: "Accenture", domain: "accenture.com", location: "Dublin" },
    ],
  },
  camp_bfsi: {
    titles: ["CIO", "CTO", "Head of Digital Transformation", "Head of Technology"],
    companies: [
      { name: "HDFC Bank", domain: "hdfcbank.com", location: "Mumbai" },
      { name: "ICICI Bank", domain: "icicibank.com", location: "Mumbai" },
      { name: "Axis Bank", domain: "axisbank.com", location: "Mumbai" },
      { name: "Kotak Mahindra Bank", domain: "kotak.com", location: "Mumbai" },
      { name: "Bajaj Finserv", domain: "bajajfinserv.in", location: "Pune" },
      { name: "SBI Life Insurance", domain: "sbilife.co.in", location: "Mumbai" },
      { name: "Muthoot Finance", domain: "muthootfinance.com", location: "Kochi" },
      { name: "Shriram Finance", domain: "shriramfinance.in", location: "Chennai" },
      { name: "IDFC First Bank", domain: "idfcfirstbank.com", location: "Mumbai" },
      // Crypto — excluded by this campaign's criteria.
      { name: "CoinDCX", domain: "coindcx.com", location: "Mumbai" },
    ],
  },
  camp_voiceai: {
    titles: ["Founder", "Co-founder & CEO", "CTO & Co-founder", "CEO"],
    companies: [
      { name: "Vapi", domain: "vapi.ai", location: "San Francisco, CA" },
      { name: "Retell AI", domain: "retellai.com", location: "San Francisco, CA" },
      { name: "Cartesia", domain: "cartesia.ai", location: "San Francisco, CA" },
      { name: "Rime", domain: "rime.ai", location: "San Francisco, CA" },
      { name: "Bland AI", domain: "bland.ai", location: "San Francisco, CA" },
      { name: "LiveKit", domain: "livekit.io", location: "San Francisco, CA" },
      { name: "Vocode", domain: "vocode.dev", location: "San Francisco, CA" },
      { name: "Hume AI", domain: "hume.ai", location: "New York, NY" },
      // Well past the campaign's headcount ceiling — a real judgement call
      // for the ICP agent rather than an obvious pass.
      { name: "Deepgram", domain: "deepgram.com", location: "San Francisco, CA" },
      { name: "AssemblyAI", domain: "assemblyai.com", location: "San Francisco, CA" },
    ],
  },
};

const DEFAULT_POOL: DiscoveryPool = {
  titles: ["VP Engineering", "Director of Platform", "Head of Technology"],
  companies: [
    { name: "Stripe", domain: "stripe.com", location: "San Francisco, CA" },
    { name: "Datadog", domain: "datadoghq.com", location: "New York, NY" },
    { name: "Snowflake", domain: "snowflake.com", location: "Bozeman, MT" },
  ],
};

/**
 * Honest provenance. There is no Apollo, Crunchbase or LinkedIn integration in
 * this build, so the activity log must not imply one.
 */
const DISCOVERY_SOURCE = "seeded demo pool — no lead-source integration connected";

function discoverProspect(campaign: Campaign): { prospect: Prospect; source: string } {
  const pool = DISCOVERY_POOLS[campaign.id] ?? DEFAULT_POOL;
  const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const company = pick(pool.companies);
  const handle = name.toLowerCase().replace(/[^a-z]+/g, ".");

  return {
    source: DISCOVERY_SOURCE,
    prospect: {
      id: `p_${Math.random().toString(36).slice(2, 9)}`,
      campaignId: campaign.id,
      name,
      title: pick(pool.titles),
      company: company.name,
      location: company.location,
      email: `${handle}@${company.domain}`,
      linkedin: `linkedin.com/in/${handle.replace(/\./g, "-")}`,
      industry: factsFor(company.name)?.industry,
      employeeCount: factsFor(company.name)?.employees,
      state: "discovered",
      fitScore: 0,
      touched: [],
      lastAction: "Discovered, awaiting ICP scoring",
      lastActionAt: new Date().toISOString(),
      touchCount: 0,
      anglesUsed: [],
    },
  };
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
    // The ICP stage runs a faithful local port of the agent's own rules
    // rather than a generic narration, so its verdicts are real, derived
    // from the prospect data and reproducible. Still attributed to the
    // fallback, never to DronaHQ.
    if (step.agent === "icp_fitment" && step.status === "success") {
      const verdict = scoreProspect(campaign, prospect);
      const line = describeVerdict(verdict);
      return {
        source: "simulated" as const,
        summary: `${prospect.name} [${verdict.verdict}] ${verdict.reasoning}`,
        lastAction: line,
        status: verdict.verdict === "NEEDS_REVIEW" ? ("pending_approval" as const) : step.status,
        nextState:
          verdict.verdict === "QUALIFIED"
            ? step.nextState
            : verdict.verdict === "REJECTED"
              ? ("rejected" as const)
              : prospect.state,
        tokens: step.tokens,
        fitScore: verdict.fitScore,
        message: [line, "", "CRITERIA BREAKDOWN:", ...verdict.criteriaBreakdown.map((b) => `- ${b}`)].join("\n"),
        latencyMs: undefined as number | undefined,
        researchBrief: undefined as string | undefined,
        dossier: undefined as Prospect["dossier"],
        countsAsTouch: false,
        angle: undefined as string | undefined,
      };
    }

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
      dossier: undefined as Prospect["dossier"],
      countsAsTouch: step.agent === "personalisation" && step.status === "success",
      angle: undefined as string | undefined,
    };
  }

  const payload = buildAgentRequest(step.agent as LiveAgentKey, campaign, prospect);
  const outcome = await invokeAgent(step.agent as LiveAgentKey, payload);

  if (!outcome.ok) {
    // The agent is unreachable or returned nothing after its retries. Holding
    // the prospect here would jam the funnel behind one unreliable agent, so
    // fall back to the local step and let the campaign continue.
    //
    // The event is attributed to the fallback, not to DronaHQ, and names the
    // failure in the summary: the log must never imply an agent produced a
    // result it did not.
    return {
      source: "simulated" as const,
      summary: `DronaHQ ${step.agent} unavailable (${outcome.error}) — local fallback: ${step.summary}`,
      lastAction: step.lastAction,
      status: step.status,
      nextState: step.nextState,
      tokens: step.tokens,
      fitScore: step.fitScore,
      message: undefined,
      latencyMs: outcome.ms,
      researchBrief: undefined,
      dossier: undefined,
      countsAsTouch: step.agent === "personalisation" && step.status === "success",
      angle: undefined,
    };
  }

  const r = outcome.result;

  // The agent's decision is authoritative. These agents are built to prefer
  // escalating over guessing, and the app must not quietly override that.
  const nextState =
    r.decision === "reject"
      ? ("rejected" as const)
      : r.decision === "advance"
        ? step.nextState
        : prospect.state;

  const escalated = r.decision === "escalate" || r.requiresReview;

  return {
    source: "dronahq" as const,
    summary: r.verdict ? `${prospect.name} [${r.verdict}] ${r.headline}` : `${prospect.name}: ${r.headline}`,
    lastAction: r.headline,
    status: escalated ? ("pending_approval" as const) : ("success" as const),
    nextState,
    tokens: 0,
    fitScore: r.score ?? step.fitScore,
    // The agent's full output, so a manager can read exactly what it produced.
    message: r.subject ? `Subject: ${r.subject}\n\n${r.body ?? r.text}` : r.text,
    latencyMs: outcome.ms,
    researchBrief: step.agent === "research" ? r.text : undefined,
    dossier: r.dossier,
    // A drafted message is an outbound touch; the sequence agents count these.
    countsAsTouch: step.agent === "personalisation" && r.decision === "advance",
    angle: r.angle,
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

/**
 * Deliver an agent-written email, when there is a real one to deliver.
 *
 * Only fires for a live Personalisation Agent result on the email channel:
 * a simulated step has no real copy to send, and a message the agent flagged
 * for review must not go out before a human has seen it.
 *
 * Delivery is redirected server-side to the demo inbox; nothing reaches the
 * prospect's address. Returns a line to append to the activity summary, or
 * null when no send was attempted.
 */
async function maybeSendEmail(
  campaign: Campaign,
  step: AgentStep,
  outcome: { source: "dronahq" | "simulated"; message?: string; status: string },
): Promise<string | null> {
  if (outcome.source !== "dronahq") return null;
  if (step.agent !== "personalisation" || step.channel !== "email") return null;
  if (outcome.status !== "success") return null;
  if (!outcome.message?.trim()) return null;

  // The agent's output carries "Subject: ..." on the first line when it
  // produced one; split it back out for the real message headers.
  const text = outcome.message;
  const match = text.match(/^Subject:\s*(.+?)\n\n([\s\S]+)$/);
  const subject = match ? match[1].trim() : `note for ${step.prospect.name}`;
  const body = match ? match[2].trim() : text;

  const result = await sendAgentEmail({
    intendedTo: step.prospect.email,
    intendedName: step.prospect.name,
    subject,
    body,
    campaignName: campaign.name,
  });

  return result.ok
    ? ` · email sent (${result.messageId.slice(0, 8)})`
    : ` · email not sent: ${result.error}`;
}

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

      // Names and companies come from finite pools, so the same person can
      // surface twice. Rediscovering someone already in this campaign is a
      // no-op: a real lead source deduplicates before handing a lead over,
      // and a duplicate here would be contacted twice.
      const alreadyKnown = store.prospects.some(
        (p) => p.campaignId === campaign.id && p.email === prospect.email,
      );

      // Skip only the duplicate, not the rest of this campaign's tick.
      if (!alreadyKnown) {
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

  // Deliver the message, if this step produced a real one.
  const deliveryNote = await maybeSendEmail(campaign, step, outcome);

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
    ...(outcome.dossier ? { dossier: outcome.dossier } : {}),
    ...(outcome.countsAsTouch
      ? {
          touchCount: prospect.touchCount + 1,
          lastTouchAt: new Date().toISOString(),
          anglesUsed: outcome.angle
            ? [...prospect.anglesUsed, outcome.angle]
            : prospect.anglesUsed,
        }
      : {}),
  });

  latest.pushEvent({
    campaignId: campaign.id,
    agent: step.agent,
    channel: step.channel,
    prospectId: prospect.id,
    prospectName: prospect.name,
    summary: outcome.summary + (deliveryNote ?? ""),
    status: outcome.status,
    versionId: campaign.activeVersionId,
    tokens: outcome.tokens,
    source: outcome.source,
    message: outcome.message,
    latencyMs: outcome.latencyMs,
  });
}
