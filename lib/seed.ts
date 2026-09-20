import type {
  AgentKey,
  Campaign,
  Channel,
  ChannelConfig,
  Prospect,
  PromptVersion,
} from "./types";
import { AGENTS } from "./types";

/**
 * Deterministic seed data. No Date.now() or Math.random() at module scope:
 * the server and client must render identical markup on first paint.
 */

const ch = (enabled: boolean): ChannelConfig => ({ enabled, paused: false });

function channels(list: Channel[]): Record<Channel, ChannelConfig> {
  return {
    email: ch(list.includes("email")),
    linkedin: ch(list.includes("linkedin")),
    sms: ch(list.includes("sms")),
    voice: ch(list.includes("voice")),
  };
}

function agentConfigs(disabled: AgentKey[] = []) {
  return AGENTS.map((a) => ({
    key: a.key,
    enabled: !disabled.includes(a.key),
    paused: false,
  }));
}

/** Baseline agent instructions. Each campaign overrides the ones that matter. */
function baseAgentPrompts(overrides: Partial<Record<AgentKey, string>>): Record<AgentKey, string> {
  const base: Record<AgentKey, string> = {
    icp_fitment:
      "Score this prospect 0-100 against the campaign ICP. Return structured JSON: {score, verdict, reasons[]}. Reject below 55. Never invent facts about the company; if evidence is missing, lower confidence instead of guessing.",
    research:
      "Build a structured brief on the company and the person: what they sell, recent funding or news, tech stack signals, team size, and one specific hook worth referencing. Cite the source of every claim. Leave a field blank rather than fabricating it.",
    outreach_strategy:
      "Decide whether to contact this prospect, on which channel, and when. Respect campaign daily limits, working hours and the global suppression list. Prefer the channel with the strongest signal. If the prospect is already in another live campaign, defer.",
    personalisation:
      "Write the outreach message. Ground every claim in the research brief and the retrieved playbook examples. One specific, verifiable personalisation hook in the first line. No superlatives, no invented metrics, under 120 words, plain sentences.",
    conversation:
      "Read the reply and classify intent: interested / objection / not-now / referral / unsubscribe. Pick the next action. Escalate to a human on pricing, legal, security review, or anything you are not confident about.",
    voice:
      "Run a qualification call. Open with the reason for calling, ask the qualification questions, handle objections from the playbook, and book a meeting or exit politely. Escalate to a human rep on any commitment or pricing question.",
    followup:
      "Decide the next follow-up: timing, channel and angle. Never more than 4 touches total. Change the angle each time rather than repeating. Stop immediately on any negative signal.",
  };
  return { ...base, ...overrides };
}

function version(
  id: string,
  v: number,
  createdAt: string,
  author: string,
  note: string,
  systemPrompt: string,
  agentPrompts: Record<AgentKey, string>,
): PromptVersion {
  return { id, version: v, createdAt, author, note, systemPrompt, agentPrompts };
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const c1Prompts = baseAgentPrompts({
  personalisation:
    "Write a cold email to a US SaaS CTO. Lead with an engineering-credible observation about their stack or scaling problem from the research brief. No marketing language. Max 90 words. One clear ask: a 20-minute technical call. Sign off as the assigned rep.",
  icp_fitment:
    "Score against: US-headquartered B2B SaaS, 50-1000 employees, Series A through D, CTO/VP Engineering/Head of Platform title. Reject agencies, consultancies, and anything under 50 employees. Reject below 60.",
});

const c2Prompts = baseAgentPrompts({
  personalisation:
    "Write to an India BFSI CIO. Formal register, full honorific, no first-name familiarity. Lead with a compliance or core-banking modernisation angle grounded in the research brief. Reference RBI guidance only if the brief cites it. Max 110 words.",
  outreach_strategy:
    "BFSI buyers respond on email and LinkedIn, not SMS. Never SMS this segment. Contact only between 10:00 and 18:00 IST on working days. Maximum one touch per week per prospect.",
  icp_fitment:
    "Score against: India-headquartered banks, NBFCs, insurers and capital markets firms, 500+ employees, CIO/CTO/Head of Digital title. Reject fintech startups under 500 people. Reject below 60.",
});

const c3Prompts = baseAgentPrompts({
  personalisation:
    "Write to a founder of a voice AI company. Peer-to-peer tone, short sentences, founder-to-founder. Lead with something specific they shipped or said publicly, from the research brief. Max 70 words. Ask for 15 minutes.",
  voice:
    "These prospects build voice AI for a living and will notice a bad call. Be brief, be transparent that this is an AI call, and get to the point within 15 seconds. Escalate to a human the moment they ask a technical question about our stack.",
  outreach_strategy:
    "Founders are fastest on LinkedIn and voice. Prefer LinkedIn first touch, voice on second touch if there is any engagement signal. Email last.",
});

const c4Prompts = baseAgentPrompts({
  personalisation:
    "This is an existing customer. Never pitch as if they are new. Reference their current usage from the account brief, and frame the expansion around a problem they have already told us about. Max 100 words.",
  outreach_strategy:
    "Existing customers are covered by an account manager. Never contact without checking the suppression list and the account owner. Always route the first touch through human approval.",
});

export const SEED_CAMPAIGNS: Campaign[] = [
  {
    id: "camp_ussaas",
    name: "US SaaS CTO Outreach",
    description:
      "Land technical evaluation calls with CTOs at US mid-market B2B SaaS companies scaling past their first platform rewrite.",
    owner: "Priya Nair",
    status: "live",
    createdAt: "2026-09-18T21:10:00.000Z",
    updatedAt: "2026-09-20T06:30:00.000Z",
    icp: {
      label: "US SaaS CTO",
      geography: "United States",
      targetRoles: ["CTO", "VP Engineering", "Head of Platform"],
      companyCriteria: "B2B SaaS, 50-1000 employees, Series A-D, US HQ",
      exclusions: "Agencies, consultancies, <50 employees, existing customers",
    },
    channels: channels(["email", "linkedin"]),
    agents: agentConfigs(["voice"]),
    dailyLimit: 60,
    activeVersionId: "v_ussaas_2",
    versions: [
      version(
        "v_ussaas_1",
        1,
        "2026-09-18T21:10:00.000Z",
        "Priya Nair",
        "Initial harness",
        "You are an autonomous SDR for a developer infrastructure company selling to US B2B SaaS engineering leaders. Be technically credible and concise.",
        baseAgentPrompts({}),
      ),
      version(
        "v_ussaas_2",
        2,
        "2026-09-20T06:30:00.000Z",
        "Priya Nair",
        "Tightened personalisation: engineering-credible opener, dropped marketing tone, max 90 words.",
        "You are an autonomous SDR for a developer infrastructure company selling to US B2B SaaS engineering leaders.\n\nYou are talking to people who write code and will spot vagueness instantly. Be specific, be short, and never claim a result you cannot source from the knowledge base. If you are unsure whether a claim is true, leave it out.\n\nNever promise pricing, contract terms, or a security review outcome. Escalate those to the human rep.",
        c1Prompts,
      ),
    ],
  },
  {
    id: "camp_bfsi",
    name: "India BFSI CIO Outreach",
    description:
      "Open conversations with CIOs at Indian banks, NBFCs and insurers about core system modernisation.",
    owner: "Arjun Mehta",
    status: "paused",
    createdAt: "2026-09-19T04:00:00.000Z",
    updatedAt: "2026-09-20T05:15:00.000Z",
    icp: {
      label: "India BFSI CIO",
      geography: "India",
      targetRoles: ["CIO", "CTO", "Head of Digital Transformation"],
      companyCriteria: "Banks, NBFCs, insurers, capital markets. 500+ employees. India HQ",
      exclusions: "Fintech startups <500 employees, crypto, existing customers",
    },
    channels: channels(["email", "linkedin"]),
    agents: agentConfigs(["voice", "conversation"]),
    dailyLimit: 25,
    activeVersionId: "v_bfsi_1",
    versions: [
      version(
        "v_bfsi_1",
        1,
        "2026-09-19T04:00:00.000Z",
        "Arjun Mehta",
        "Initial harness, compliance-first tone",
        "You are an autonomous SDR selling core system modernisation into Indian BFSI institutions.\n\nThis is a regulated, relationship-driven, formal market. Tone is formal and respectful. Compliance and auditability matter more than speed. Never reference a regulation unless it appears in the retrieved knowledge base.\n\nNever contact anyone outside 10:00-18:00 IST. Never use SMS for this segment.",
        c2Prompts,
      ),
    ],
  },
  {
    id: "camp_voiceai",
    name: "US Voice AI Founders",
    description:
      "Founder-to-founder outreach to seed and Series A voice AI companies, testing LinkedIn-first then voice.",
    owner: "Priya Nair",
    status: "live",
    createdAt: "2026-09-19T11:45:00.000Z",
    updatedAt: "2026-09-20T07:05:00.000Z",
    icp: {
      label: "Voice AI Founders",
      geography: "United States",
      targetRoles: ["Founder", "Co-founder", "CEO", "CTO"],
      companyCriteria: "Voice AI / conversational AI companies, Seed-Series A, <80 employees",
      exclusions: "Non-AI companies, enterprises >200 employees, existing customers",
    },
    channels: channels(["linkedin", "voice", "email"]),
    agents: agentConfigs([]),
    dailyLimit: 40,
    activeVersionId: "v_voice_1",
    versions: [
      version(
        "v_voice_1",
        1,
        "2026-09-19T11:45:00.000Z",
        "Priya Nair",
        "Initial harness, founder peer tone",
        "You are an autonomous SDR reaching founders who build voice AI products.\n\nThese people build exactly this kind of system for a living. Anything generic reads as spam to them and will be screenshotted. Be short, be specific, be honest that you are an AI.\n\nNever oversell. If they push on technical detail, hand off to a human immediately.",
        c3Prompts,
      ),
    ],
  },
  {
    id: "camp_expansion",
    name: "Enterprise Expansion",
    description:
      "Expansion plays into existing enterprise accounts. Every first touch requires human approval.",
    owner: "Arjun Mehta",
    status: "draft",
    createdAt: "2026-09-20T08:00:00.000Z",
    updatedAt: "2026-09-20T08:00:00.000Z",
    icp: {
      label: "Existing Customers",
      geography: "Global",
      targetRoles: ["VP Engineering", "Director of Platform", "Procurement"],
      companyCriteria: "Existing accounts with >6 months tenure and >70% seat utilisation",
      exclusions: "Accounts in active renewal negotiation, accounts with open P1 tickets",
    },
    channels: channels(["email"]),
    agents: agentConfigs(["voice", "conversation", "followup"]),
    dailyLimit: 10,
    activeVersionId: "v_exp_1",
    versions: [
      version(
        "v_exp_1",
        1,
        "2026-09-20T08:00:00.000Z",
        "Arjun Mehta",
        "Draft harness, not yet reviewed",
        "You are an autonomous SDR running expansion plays into existing customer accounts.\n\nThese are people who already pay us. Getting this wrong damages a live relationship, so the bar for sending anything is high. Every first touch goes to human approval.",
        c4Prompts,
      ),
    ],
  },
];

// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

/**
 * Seeded prospects.
 *
 * Companies are REAL and publicly known, chosen to genuinely match (or
 * genuinely miss) each campaign's ICP. That matters: the Research Agent does
 * live web lookups, so an invented company name gets silently matched to some
 * unrelated real business and the agent returns a confident, sourced brief
 * about the wrong company.
 *
 * Contact names, titles and email addresses are synthetic personas. Real
 * people's contact details are deliberately not used in a system that models
 * outbound outreach.
 */
type SeedProspect = [
  name: string,
  title: string,
  company: string,
  domain: string,
  location: string,
  state: Prospect["state"],
  fit: number,
  touched: Channel[],
  lastAction: string,
];

function mkProspects(campaignId: string, prefix: string, rows: SeedProspect[]): Prospect[] {
  return rows.map(([name, title, company, domain, location, state, fitScore, touched, lastAction], i) => {
    const handle = name.toLowerCase().replace(/[^a-z]+/g, ".");
    return {
      id: `${prefix}_${i + 1}`,
      campaignId,
      name,
      title,
      company,
      location,
      email: `${handle}@${domain}`,
      linkedin: `linkedin.com/in/${handle.replace(/\./g, "-")}`,
      state,
      fitScore,
      touched,
      lastAction,
      lastActionAt: "2026-09-20T07:00:00.000Z",
    };
  });
}

export const SEED_PROSPECTS: Prospect[] = [
  ...mkProspects("camp_ussaas", "p_us", [
    ["Dana Whitfield", "CTO", "Linear", "linear.app", "San Francisco, CA", "meeting", 91, ["email", "linkedin"], "Booked 20-min technical call for Tue"],
    ["Marcus Ellery", "VP Engineering", "Retool", "retool.com", "San Francisco, CA", "engaged", 84, ["email"], "Replied asking about self-hosting"],
    ["Sofia Ramirez", "CTO", "Render", "render.com", "San Francisco, CA", "engaged", 88, ["linkedin", "email"], "Accepted LinkedIn connection, opened email 3x"],
    ["Tom Iyer", "Head of Platform", "Temporal", "temporal.io", "Seattle, WA", "contacted", 79, ["email"], "First touch sent, no reply yet"],
    ["Rachel Okonkwo", "CTO", "Vanta", "vanta.com", "San Francisco, CA", "contacted", 82, ["linkedin"], "LinkedIn message delivered"],
    ["Ben Straus", "VP Engineering", "Airbyte", "airbyte.com", "San Francisco, CA", "qualified", 76, [], "Qualified, queued for first touch"],
    ["Amara Singh", "CTO", "WorkOS", "workos.com", "San Francisco, CA", "qualified", 85, [], "Qualified, scheduled for 14:00 send"],
    ["Colin Fraser", "Head of Platform", "Honeycomb", "honeycomb.io", "San Francisco, CA", "researched", 71, [], "Research brief complete"],
    ["Yuki Tanaka", "VP Engineering", "Clerk", "clerk.com", "San Francisco, CA", "researched", 80, [], "Research brief complete"],
    ["Priyanka Rao", "CTO", "Sentry", "sentry.io", "San Francisco, CA", "discovered", 0, [], "Awaiting ICP scoring"],
    ["Derek Olsen", "CTO", "PostHog", "posthog.com", "San Francisco, CA", "discovered", 0, [], "Awaiting ICP scoring"],
    // A genuine, verifiable ICP miss: the campaign excludes consultancies.
    ["Hannah Lowe", "Director of Engineering", "Accenture", "accenture.com", "Dublin", "rejected", 38, [], "Rejected: consultancy, excluded by campaign criteria"],
    // Deliberate cross-campaign duplicate: also targeted by "US Voice AI Founders".
    // Both campaigns are Live, so the conflict panel should flag this one.
    ["Ravi Anand", "CTO & Co-founder", "Vapi", "vapi.ai", "San Francisco, CA", "qualified", 80, [], "Qualified - held, duplicate detected in another live campaign"],
  ]),
  ...mkProspects("camp_bfsi", "p_in", [
    ["Vikram Desai", "CIO", "HDFC Bank", "hdfcbank.com", "Mumbai", "meeting", 89, ["email", "linkedin"], "Intro call confirmed with two architects"],
    ["Lakshmi Iyer", "Head of Digital", "Bajaj Finserv", "bajajfinserv.in", "Pune", "engaged", 83, ["email"], "Asked for a compliance one-pager"],
    ["Rohit Bansal", "CTO", "Shriram Finance", "shriramfinance.in", "Chennai", "contacted", 78, ["email"], "First touch sent before pause"],
    ["Neha Kulkarni", "CIO", "SBI Life Insurance", "sbilife.co.in", "Mumbai", "contacted", 81, ["linkedin"], "LinkedIn note delivered"],
    ["Sanjay Menon", "Head of Technology", "Muthoot Finance", "muthootfinance.com", "Kochi", "qualified", 74, [], "Qualified, held by campaign pause"],
    ["Ananya Gupta", "CIO", "Kotak Mahindra Bank", "kotak.com", "Mumbai", "qualified", 80, [], "Qualified, held by campaign pause"],
    ["Imran Sheikh", "CTO", "IDFC First Bank", "idfcfirstbank.com", "Mumbai", "researched", 77, [], "Research brief complete"],
    ["Deepa Raghavan", "Head of Digital", "HDFC Life", "hdfclife.com", "Mumbai", "researched", 69, [], "Research brief complete"],
    ["Kartik Joshi", "CIO", "Axis Bank", "axisbank.com", "Mumbai", "discovered", 0, [], "Awaiting ICP scoring"],
    // Verifiable ICP miss: the campaign excludes crypto.
    ["Sunita Pillai", "CTO", "CoinDCX", "coindcx.com", "Mumbai", "rejected", 34, [], "Rejected: crypto exchange, excluded by campaign criteria"],
  ]),
  ...mkProspects("camp_voiceai", "p_va", [
    ["Elena Marsh", "Co-founder & CEO", "Cartesia", "cartesia.ai", "San Francisco, CA", "opportunity", 94, ["linkedin", "voice"], "Moved to opportunity after 18-min call"],
    ["Jonah Kim", "Founder", "Rime", "rime.ai", "San Francisco, CA", "meeting", 90, ["linkedin"], "Booked founder call Thursday"],
    ["Ravi Anand", "CTO & Co-founder", "Vapi", "vapi.ai", "San Francisco, CA", "engaged", 86, ["linkedin", "voice"], "Voice call completed, asked for docs"],
    ["Mia Delacroix", "Founder", "Retell AI", "retellai.com", "San Francisco, CA", "engaged", 81, ["linkedin"], "Replied on LinkedIn, curious"],
    ["Owen Brady", "Co-founder", "Bland AI", "bland.ai", "San Francisco, CA", "contacted", 77, ["linkedin"], "LinkedIn first touch delivered"],
    ["Chiara Rossi", "CEO", "LiveKit", "livekit.io", "San Francisco, CA", "contacted", 79, ["linkedin"], "LinkedIn first touch delivered"],
    ["Felix Nwosu", "Founder & CTO", "Vocode", "vocode.dev", "San Francisco, CA", "qualified", 83, [], "Qualified, queued for LinkedIn touch"],
    ["Grace Lindqvist", "Co-founder", "Hume AI", "hume.ai", "New York, NY", "qualified", 75, [], "Qualified, queued"],
    ["Aditya Varma", "Founder", "Deepgram", "deepgram.com", "San Francisco, CA", "researched", 72, [], "Research brief complete"],
    ["Noor Haddad", "CEO", "AssemblyAI", "assemblyai.com", "San Francisco, CA", "discovered", 0, [], "Awaiting ICP scoring"],
    // Verifiable ICP miss: robotics, not a voice AI company.
    ["Peter Halloran", "Founder", "Boston Dynamics", "bostondynamics.com", "Waltham, MA", "rejected", 21, [], "Rejected: robotics company, no voice AI product"],
  ]),
];

// ---------------------------------------------------------------------------
// Seed activity: what the agents did before the manager opened the dashboard
// ---------------------------------------------------------------------------

type SeedEvent = [
  campaignId: string,
  minutesAgo: number,
  agent: AgentKey | "system",
  summary: string,
  status: "success" | "failed" | "pending_approval",
  channel?: Channel,
  prospectName?: string,
];

const SEED_EVENT_ROWS: SeedEvent[] = [
  ["camp_voiceai", 3, "personalisation", "Drafted LinkedIn opener referencing their Series A announcement", "success", "linkedin", "Owen Brady"],
  ["camp_ussaas", 6, "outreach_strategy", "Chose email over LinkedIn: 3 opens, no LinkedIn activity in 90 days", "success", "email", "Tom Iyer"],
  ["camp_voiceai", 9, "voice", "Completed 18-min qualification call, budget and timeline confirmed", "success", "voice", "Elena Marsh"],
  ["camp_ussaas", 14, "conversation", "Classified reply as objection: self-hosting requirement. Escalated to rep.", "pending_approval", "email", "Marcus Ellery"],
  ["camp_voiceai", 18, "icp_fitment", "Rejected: hardware robotics company, no voice AI product", "success", undefined, "Peter Halloran"],
  ["camp_ussaas", 23, "research", "Built brief: 140 employees, Series B, migrating off a monolith", "success", undefined, "Colin Fraser"],
  ["camp_bfsi", 31, "system", "Campaign paused by Arjun Mehta. 2 queued sends held.", "success", undefined, undefined],
  ["camp_bfsi", 34, "personalisation", "Drafted compliance-led email, held pending campaign pause", "success", "email", "Sanjay Menon"],
  ["camp_ussaas", 38, "personalisation", "Drafted cold email referencing their platform rewrite blog post", "success", "email", "Rachel Okonkwo"],
  ["camp_voiceai", 45, "outreach_strategy", "Deferred: prospect already active in US SaaS CTO campaign", "success", undefined, "Felix Nwosu"],
  ["camp_ussaas", 52, "followup", "Scheduled touch 2 for Monday 09:00, angle changed to cost", "success", "email", "Ben Straus"],
  ["camp_voiceai", 58, "research", "Enrichment API returned no data, retried once, then skipped", "failed", undefined, "Noor Haddad"],
  ["camp_ussaas", 66, "icp_fitment", "Scored 91/100: US SaaS, 300 employees, Series C, CTO title", "success", undefined, "Dana Whitfield"],
  ["camp_voiceai", 71, "conversation", "Classified reply as interested, proposed three call slots", "success", "linkedin", "Mia Delacroix"],
  ["camp_bfsi", 80, "research", "Built brief: core banking on legacy mainframe, RBI audit due Q1", "success", undefined, "Imran Sheikh"],
];

/** Built at runtime relative to `now` so the feed always looks fresh. */
export function buildSeedActivity(now: number) {
  const activeVersion: Record<string, string> = {};
  for (const c of SEED_CAMPAIGNS) activeVersion[c.id] = c.activeVersionId;

  return SEED_EVENT_ROWS.map((row, i) => {
    const [campaignId, minutesAgo, agent, summary, status, channel, prospectName] = row;
    return {
      id: `seed_evt_${i + 1}`,
      campaignId,
      ts: new Date(now - minutesAgo * 60_000).toISOString(),
      agent,
      channel,
      prospectName,
      summary,
      status,
      versionId: activeVersion[campaignId],
      tokens: 400 + ((i * 137) % 900),
      source: "simulated" as const,
    };
  });
}
