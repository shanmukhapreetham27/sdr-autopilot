import type {
  Campaign,
  Channel,
  LiveAgentKey,
  Prospect,
  ProspectDossier,
} from "./types";

/**
 * Request and response contracts for the DronaHQ agents.
 *
 * Each agent declares its own Webhook Input fields, and the field names are
 * load-bearing: an unbound variable makes the agent's own guard fire (the ICP
 * agent returns "input binding failed" when `campaign_name` or `prospect` is
 * empty, rather than guessing). So every builder below mirrors one agent's
 * declared input exactly.
 *
 * Responses are read structured-first. The agents define JSON Schemas for
 * their output, but a Webhook Trigger only returns JSON when its Response is
 * configured as Standard with that schema attached; otherwise the same content
 * arrives as prose. Both are handled, and anything unparseable degrades to a
 * logged event rather than stalling the campaign.
 */

// ---------------------------------------------------------------------------
// Common outcome the rest of the app consumes
// ---------------------------------------------------------------------------

/** What the app does with a prospect after an agent has spoken. */
export type Decision =
  /** Move to the next funnel stage. */
  | "advance"
  /** Keep the prospect where it is and retry later. */
  | "hold"
  /** Remove from the funnel. */
  | "reject"
  /** Needs a human before anything else happens. */
  | "escalate";

export interface AgentOutcome {
  /** Full agent output, shown expandable in the activity feed. */
  text: string;
  /** One line for the activity log. */
  headline: string;
  decision: Decision;
  /** ICP fit score, normalised to 0-100. */
  score?: number;
  /** The agent's own verdict/action token, for the audit trail. */
  verdict?: string;
  channel?: Channel;
  /** Personalisation agent output. */
  subject?: string;
  body?: string;
  /** The signal the next message should lead on. */
  angle?: string;
  /** Structured dossier from the Research Agent. */
  dossier?: ProspectDossier;
  requiresReview: boolean;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

function openChannels(campaign: Campaign): Channel[] {
  return (Object.keys(campaign.channels) as Channel[]).filter(
    (c) => campaign.channels[c].enabled && !campaign.channels[c].paused,
  );
}

function channelConfig(campaign: Campaign): Record<Channel, boolean> {
  const open = openChannels(campaign);
  return {
    email: open.includes("email"),
    linkedin: open.includes("linkedin"),
    sms: open.includes("sms"),
    voice: open.includes("voice"),
  };
}

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

/** Compact prospect record, the shape the agents' dossiers and guards expect. */
function prospectRecord(p: Prospect) {
  return {
    name: p.name,
    title: p.title,
    company: p.company,
    domain: p.email.split("@")[1] ?? "",
    location: p.location,
    email: p.email,
    linkedin: p.linkedin,
    stage: p.state,
    fit_score: p.fitScore || null,
  };
}

/** Touch history, the state the strategy and follow-up agents reason over. */
function touchState(p: Prospect) {
  return {
    touches: p.touchCount,
    last_channel: p.touched.at(-1) ?? "",
    last_touch_date: p.lastTouchAt ?? "",
    days_since_last_touch: daysSince(p.lastTouchAt),
    angles_used: p.anglesUsed,
    replied: false,
    email_flagged_invalid: false,
  };
}

export function buildRequest(
  task: LiveAgentKey,
  campaign: Campaign,
  prospect: Prospect,
): Record<string, unknown> {
  const version = campaign.versions.find((v) => v.id === campaign.activeVersionId);
  const policy = campaign.policy;

  // Every agent receives these three. `system` and `prompt_version` are what
  // make one shared set of agents behave differently per campaign, and let an
  // action be traced back to the harness version that produced it.
  const base = {
    system: version?.systemPrompt ?? "",
    campaign_name: campaign.name,
    prompt_version: version ? `v${version.version}` : "v1",
  };

  switch (task) {
    case "icp_fitment":
      return {
        ...base,
        message: version?.agentPrompts.icp_fitment ?? "Score this prospect against the campaign ICP.",
        prospect: prospectRecord(prospect),
        research: prospect.dossier ?? null,
        icp_criteria: {
          target_roles: campaign.icp.targetRoles,
          company_criteria: campaign.icp.companyCriteria,
          geography: campaign.icp.geography,
        },
        exclusion_criteria: campaign.icp.exclusions
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
        min_score_threshold: policy.minScoreThreshold,
      };

    case "research":
      return {
        ...base,
        message: [
          version?.agentPrompts.research ?? "",
          "",
          "PROSPECT RECORD:",
          JSON.stringify(prospectRecord(prospect), null, 2),
        ].join("\n"),
        research_focus: policy.researchFocus,
      };

    case "outreach_strategy":
      return {
        ...base,
        message: [
          version?.agentPrompts.outreach_strategy ?? "",
          "",
          "TOUCH STATE:",
          JSON.stringify(touchState(prospect), null, 2),
          "",
          "ICP FIT SCORE (0-1):",
          String((prospect.fitScore || 0) / 100),
          "",
          "DOSSIER:",
          prospect.researchBrief || "null",
        ].join("\n"),
        rep_context: `${policy.senderIdentity.name}, ${policy.senderIdentity.title}, owns campaign ${campaign.name}`,
        channel_config: channelConfig(campaign),
        outreach_policy: {
          max_touches: policy.maxTouches,
          min_days_between_touches: policy.minDaysBetweenTouches,
          daily_limit: campaign.dailyLimit,
        },
      };

    case "personalisation":
      return {
        ...base,
        message: [
          version?.agentPrompts.personalisation ?? "",
          "",
          `Angle chosen by the outreach agent for this step: ${prospect.anglesUsed.at(-1) ?? "generic"}`,
          `Sequence step: ${prospect.touchCount + 1}`,
          "",
          "DOSSIER:",
          prospect.researchBrief || "null",
          "",
          "PROSPECT RECORD:",
          JSON.stringify(prospectRecord(prospect), null, 2),
        ].join("\n"),
        channel_rules: {
          enabled_channels: openChannels(campaign),
          // Later touches get shorter, as the agent's own rules require.
          limit: prospect.touchCount >= 2 ? 40 : 90,
        },
        sender_identity: policy.senderIdentity,
        product_positioning: policy.productPositioning,
      };

    case "conversation":
      return {
        ...base,
        message: [
          version?.agentPrompts.conversation ?? "",
          "",
          "INBOUND REPLY:",
          prospect.lastAction,
          "",
          "THREAD:",
          `${prospect.touchCount} prior touch(es) on ${prospect.touched.join(", ") || "no channel"}.`,
        ].join("\n"),
        stop_policy: policy.stopPolicy,
        escalation_policy: policy.escalationPolicy,
      };

    case "followup":
      return {
        ...base,
        message: [
          version?.agentPrompts.followup ?? "",
          "",
          "TOUCH HISTORY:",
          JSON.stringify(touchState(prospect), null, 2),
          "",
          "DOSSIER:",
          prospect.researchBrief || "null",
        ].join("\n"),
        stop_rules: policy.stopPolicy,
        revival_policy: "Revive only on a dossier signal that was not present when the sequence paused.",
        follow_up_cadence: `Minimum ${policy.minDaysBetweenTouches} days between touches, widening as the sequence progresses. Maximum ${policy.maxTouches} touches.`,
      };
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === "object" && !Array.isArray(v) ? (v as Dict) : {});
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * Pull the agent's own output out of DronaHQ's envelope
 * `{ success, thread_id, run_id, message, response }`, parsing a JSON string
 * payload if that is what came back.
 */
export function unwrapEnvelope(raw: unknown): { payload: unknown; runId?: string; empty?: boolean } {
  const root = asDict(raw);
  const runId = str(root.run_id);

  // A DronaHQ envelope with a null `response` means the run completed but
  // produced no output — usually an unbound input variable. Falling through
  // to `raw` would stringify the envelope and report `"success": true` as if
  // it were the agent's answer.
  const isEnvelope = "success" in root || "run_id" in root;
  if (isEnvelope && root.response == null) {
    return { payload: null, runId, empty: true };
  }

  let payload = root.response ?? root.result ?? root.data ?? root.output ?? raw;

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    // Structured output sometimes arrives as JSON inside a string.
    const start = trimmed.search(/[{[]/);
    if (start !== -1) {
      try {
        const parsed: unknown = JSON.parse(trimmed.slice(start));
        if (parsed && typeof parsed === "object") payload = parsed;
      } catch {
        // Prose, not JSON. Handled by the text fallbacks below.
      }
    }
  }
  return { payload, runId };
}

/** Normalise a fit score to an integer 0-100. */
function normaliseScore(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  // The agents are instructed to return 0-100, but occasionally emit the
  // 0-1 decimal they were told never to use. Treat <= 1 as a fraction.
  const scaled = n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/** First line of real prose, for the activity log. */
function headlineFrom(text: string, fallback: string): string {
  const line = text
    .split(/\n+/)
    .map((l) => l.replace(/^[#\-*>\d.\s]+/, "").replace(/\*\*/g, "").trim())
    .find((l) => l.length > 15 && !/^[a-z_]+\s*[:=]/i.test(l));
  const chosen = line ?? fallback;
  return chosen.length > 180 ? chosen.slice(0, 179) + "…" : chosen;
}

function textOf(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

/**
 * Prose fallbacks, used when a Webhook Trigger's Response is not configured
 * with the agent's JSON schema and the same content arrives as text.
 *
 * The agents format freely, so these tolerate markdown emphasis, surrounding
 * quotes and leading list markers.
 */
/** Markdown emphasis, quotes and whitespace that may wrap a key or a value. */
const EMPH = String.raw`[*_\`"'\s]*`;

function fromProse(text: string, key: string): string | undefined {
  const m = text.match(
    new RegExp(`${EMPH}${key}${EMPH}\\s*[:=]${EMPH}([A-Za-z_0-9.]+)`, "i"),
  );
  return m ? m[1] : undefined;
}

/** The whole remainder of a `key: ...` line, for prose fields like reasoning. */
function proseLine(text: string, key: string): string | undefined {
  const m = text.match(
    new RegExp(String.raw`^[\s*#>-]*` + EMPH + key + EMPH + String.raw`\s*[:=]\s*(.+)$`, "im"),
  );
  const value = m?.[1]
    ?.replace(/\*\*/g, "")
    .replace(/[",]\s*$/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return value && value.length > 3 ? value : undefined;
}

/**
 * The action token an agent returned. Schemas name this `action`, but the
 * live agents often emit `verdict:` instead, so both are accepted.
 */
function actionToken(d: Record<string, unknown>, text: string): string {
  const raw =
    (typeof d.action === "string" ? d.action : undefined) ??
    (typeof d.verdict === "string" ? d.verdict : undefined) ??
    fromProse(text, "action") ??
    fromProse(text, "verdict") ??
    "";
  return raw.toUpperCase();
}

/**
 * True when DronaHQ returned a completed run with no output at all.
 *
 * Observed to be intermittent and to worsen under rapid successive calls:
 * the identical payload can return null twice and then succeed. Treated as
 * retryable rather than as the agent's answer.
 */
export function isEmptyResponse(raw: unknown): boolean {
  return unwrapEnvelope(raw).empty === true;
}

export function parseResponse(task: LiveAgentKey, raw: unknown): AgentOutcome {
  const { payload, empty } = unwrapEnvelope(raw);

  // The run completed but returned nothing. Hold the prospect and say so
  // plainly, rather than inventing a decision from an empty answer.
  if (empty) {
    return {
      text: `The ${task} agent completed but returned no output. Most likely an unbound input variable on its Webhook Trigger.`,
      headline: `${task} returned no output`,
      decision: "hold",
      requiresReview: true,
      raw,
    };
  }

  const d = asDict(payload);
  const text = textOf(payload);
  const structured = Object.keys(d).length > 0;

  const base = { text, raw, requiresReview: false } as const;

  switch (task) {
    case "icp_fitment": {
      const verdict = (str(d.verdict) ?? fromProse(text, "verdict") ?? "").toUpperCase();
      const score = normaliseScore(d.fit_score ?? fromProse(text, "fit_score"));
      const breakdown = arr(d.criteria_breakdown);
      const reasoning = str(d.reasoning) ?? proseLine(text, "reasoning");
      const decision: Decision =
        verdict === "QUALIFIED" ? "advance" : verdict === "REJECTED" ? "reject" : "escalate";
      return {
        ...base,
        decision,
        score,
        verdict: verdict || undefined,
        requiresReview: verdict === "NEEDS_REVIEW",
        headline:
          reasoning ??
          (breakdown.length ? breakdown.join("; ") : headlineFrom(text, `ICP verdict ${verdict || "unknown"}`)),
      };
    }

    case "research": {
      const dossier: ProspectDossier | undefined = structured
        ? {
            company: asDict(d.company),
            person: asDict(d.person),
            signals: arr(d.signals),
            talking_points: arr(d.talking_points),
            pain_hypotheses: arr(d.pain_hypotheses),
            tech_stack: arr(d.tech_stack),
            unknowns: arr(d.unknowns),
            flags: arr(d.flags),
            overall_confidence: str(d.overall_confidence),
          }
        : undefined;
      const signals = dossier?.signals ?? [];
      // A dossier that verified nothing is not a reason to stop, but it is
      // worth surfacing: everything downstream will be thin.
      const lowConfidence = dossier?.overall_confidence === "low";
      return {
        ...base,
        decision: "advance",
        dossier,
        requiresReview: lowConfidence,
        headline: signals.length
          ? `Dossier built (${dossier?.overall_confidence ?? "unknown"} confidence): ${signals[0]}`
          : headlineFrom(text, "Research dossier built"),
      };
    }

    case "outreach_strategy": {
      const action = actionToken(d, text);
      const channel = (str(d.channel) ?? fromProse(text, "channel"))?.toLowerCase();
      const decision: Decision =
        action === "CONTACT"
          ? "advance"
          : action === "ESCALATE"
            ? "escalate"
            : "hold"; // WAIT and SKIP both leave the prospect where it is
      return {
        ...base,
        decision,
        verdict: action || undefined,
        channel: (["email", "linkedin", "sms", "voice"] as Channel[]).find((c) => c === channel),
        angle: str(d.angle),
        requiresReview: d.human_approval_required === true,
        headline:
          str(d.reasoning) ??
          proseLine(text, "reasoning") ??
          headlineFrom(text, `Outreach decision ${action || "unknown"}`),
      };
    }

    case "personalisation": {
      const error = str(d.error);
      if (error) {
        return { ...base, decision: "hold", requiresReview: true, headline: `Declined to write: ${error}` };
      }
      const body = str(d.body);
      const subject = str(d.subject);
      const unverified = arr(d.unverified_claims);
      const sources = arr(d.knowledge_sources);
      const requiresReview = d.requires_review === true || unverified.length > 0;
      return {
        ...base,
        // Structured output gives us the body on its own; prose responses are
        // the message itself, so the whole text is the body.
        text: body ?? text,
        body: body ?? text,
        subject,
        decision: "advance",
        requiresReview,
        headline: str(d.personalisation_basis)
          ? `Opened on: ${str(d.personalisation_basis)}`
          : headlineFrom(body ?? text, "Outreach message drafted"),
        angle: str(d.personalisation_basis),
        verdict: sources.length ? `grounded in ${sources.length} source(s)` : undefined,
      };
    }

    case "conversation": {
      const action = actionToken(d, text);
      const intent = (str(d.intent) ?? fromProse(text, "intent") ?? "").toUpperCase();
      // Only an explicit positive reply moves the prospect forward. Everything
      // else either waits or goes to a human — the agent is built to prefer
      // escalating over guessing, and the app must not override that.
      const decision: Decision =
        action === "BOOK"
          ? "advance"
          : action === "SUPPRESS"
            ? "reject"
            : action === "ESCALATE"
              ? "escalate"
              : "hold";
      return {
        ...base,
        decision,
        verdict: [intent, action].filter(Boolean).join(" / ") || undefined,
        requiresReview: d.human_review === true || decision === "escalate",
        headline: (() => {
          const phrase = str(d.trigger_phrase) ?? proseLine(text, "trigger_phrase");
          return phrase
            ? `${intent || "reply"} on "${phrase}"`
            : headlineFrom(text, `Reply classified ${intent || "unknown"}`);
        })(),
      };
    }

    case "followup": {
      const action = actionToken(d, text);
      const decision: Decision =
        action === "FOLLOW_UP" || action === "REVIVE"
          ? "advance"
          : action === "STOP"
            ? "reject"
            : action === "ESCALATE"
              ? "escalate"
              : "hold";
      return {
        ...base,
        decision,
        verdict: action || undefined,
        channel: undefined, // the strategy agent owns channel choice, not this one
        angle: str(d.angle),
        requiresReview: d.human_review === true,
        headline:
          str(d.reasoning) ??
          proseLine(text, "reasoning") ??
          headlineFrom(text, `Follow-up decision ${action || "unknown"}`),
      };
    }
  }
}
