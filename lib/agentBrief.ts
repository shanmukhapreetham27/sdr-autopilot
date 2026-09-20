import type { Campaign, Channel, LiveAgentKey, Prospect } from "./types";

/**
 * Builds the natural-language brief sent to a DronaHQ agent.
 *
 * The agents bind on a single top-level `message` string — that is how their
 * Webhook Triggers are configured, verified against the live endpoints. So
 * the app's structured campaign and prospect state is rendered into a brief
 * rather than posted as nested JSON.
 *
 * The campaign's own system prompt and agent prompt are included in every
 * brief. That is what makes one set of shared agents behave differently per
 * campaign: editing a prompt in the control plane changes the next call.
 */

const TASK_INSTRUCTION: Record<LiveAgentKey, string> = {
  icp_fitment:
    "Score this prospect against the campaign ICP. Reply with `fit_score: <0-100>` on the first line, then `verdict: QUALIFIED` or `verdict: REJECTED`, then a short criteria breakdown. Do not invent facts about the company; if evidence is missing, lower the score rather than guessing.",
  research:
    "Build a research brief on this prospect: company overview, headcount, funding stage, tech stack signals, one specific hook worth referencing in outreach, and pain hypotheses. Mark anything you cannot verify as `Unknown, not confirmed` rather than guessing.",
  outreach_strategy:
    "Decide whether to contact this prospect now, on which channel, and when. Reply with `channel: <one of the open channels>` and `verdict: CONTACT` or `verdict: HOLD`, then one short paragraph of reasoning. Respect the campaign's channel policy and daily limit.",
  personalisation:
    "Write the outreach message for this prospect. Ground every claim in the context given; invent nothing. Reply with the message body only, ready to send.",
  conversation:
    "Read the prospect's latest reply and decide the next action. Reply with `intent: <interested|objection|not_now|referral|unsubscribe>`, then `verdict: PROCEED` or `verdict: ESCALATE`, then the suggested next message or the reason for escalation. Escalate anything about pricing, legal or security review.",
  followup:
    "Decide the next follow-up for this prospect: timing, channel and a different angle from the last touch. Reply with `verdict: FOLLOW_UP` or `verdict: STOP`, then the follow-up message. Never exceed four touches in total.",
};

function bullet(label: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  return `- ${label}: ${value}\n`;
}

export function buildBrief(
  task: LiveAgentKey,
  campaign: Campaign,
  prospect: Prospect,
  openChannels: Channel[],
): string {
  const version = campaign.versions.find((v) => v.id === campaign.activeVersionId);

  return [
    `TASK: ${TASK_INSTRUCTION[task]}`,
    "",
    "CAMPAIGN OPERATING INSTRUCTIONS:",
    version?.systemPrompt ?? "",
    "",
    "AGENT INSTRUCTIONS FOR THIS TASK:",
    version?.agentPrompts[task] ?? "",
    "",
    "CAMPAIGN CONTEXT:",
    bullet("Campaign", campaign.name) +
      bullet("Ideal customer profile", campaign.icp.label) +
      bullet("Geography", campaign.icp.geography) +
      bullet("Target roles", campaign.icp.targetRoles.join(", ")) +
      bullet("Company criteria", campaign.icp.companyCriteria) +
      bullet("Exclusion criteria", campaign.icp.exclusions) +
      bullet("Channels currently open", openChannels.join(", ") || "none") +
      bullet("Daily outreach limit", campaign.dailyLimit),
    "PROSPECT:",
    bullet("Name", prospect.name) +
      bullet("Title", prospect.title) +
      bullet("Company", prospect.company) +
      bullet("Location", prospect.location) +
      bullet("Email", prospect.email) +
      bullet("LinkedIn", prospect.linkedin) +
      bullet("Current funnel stage", prospect.state) +
      bullet("Current fit score", prospect.fitScore || "not scored yet") +
      bullet("Channels already used", prospect.touched.join(", ") || "none") +
      bullet("Last action taken", prospect.lastAction),
  ]
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}

/**
 * Machine-readable control lines the agents emit, e.g. `fit_score: 80`.
 * These are parsed separately and shown as their own badges, so using one as
 * the activity-log headline would just repeat the score back at the reader.
 */
const CONTROL_LINE =
  /^["']?(fit[_\s]?score|score|verdict|channel|intent|criteria[_\s]?breakdown|status)["']?\s*[:=]/i;

/** First line that carries real prose, clipped for the activity log. */
export function summarise(text: string, max = 180): string {
  const line = text
    .split(/\n+/)
    .map((l) => l.replace(/^[#\-*>\s]+/, "").trim())
    .filter((l) => l.length > 12 && !CONTROL_LINE.test(l))
    .find(Boolean);

  // Some agents reply with nothing but control lines. Rather than render a
  // blank row, fall back to the whole response flattened onto one line.
  const fallback = text.replace(/\s+/g, " ").trim();
  const chosen = line ?? fallback;
  if (!chosen) return "Agent returned no readable output";
  return chosen.length > max ? chosen.slice(0, max - 1) + "…" : chosen;
}
