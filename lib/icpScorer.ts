import { factsFor } from "./companies";
import type { Campaign, Prospect } from "./types";

/**
 * Local ICP qualification.
 *
 * The published DronaHQ ICP Fitment agent returns a completed run with no
 * output on most calls, and retries do not reliably recover it. Rather than
 * leave that funnel stage running on a random narration, this implements the
 * agent's own documented rules against the real prospect data.
 *
 * It is a faithful port, not an approximation:
 *   - the same four weighted dimensions, summing to exactly 100
 *   - the same decision order, stopping at the first match
 *   - the same verdict and rejection_reason vocabulary
 *   - the same threshold arithmetic: threshold_100 = min_score_threshold x 100
 *
 * It also fixes the arithmetic bug the live agent exhibits. The agent scored
 * industry and employee_count as two separate 30-point dimensions and then
 * divided by an invented denominator of 200, producing `0.7` where its own
 * schema requires an integer 0-100. Here COMPANY is one dimension worth 30,
 * and fit_score IS the sum.
 *
 * Deterministic: the same prospect and campaign always produce the same
 * verdict. Nothing here is random.
 *
 * Results are attributed to the local fallback in the activity log, never to
 * DronaHQ. Swapping back to the live agent means deleting the call site.
 */

export type IcpVerdict = "QUALIFIED" | "REJECTED" | "NEEDS_REVIEW";
export type RejectionReason =
  | "EXCLUSION_MATCH"
  | "PERSONA_MISMATCH"
  | "CRITERIA_MISS"
  | "BELOW_THRESHOLD";

export interface IcpResult {
  fitScore: number;
  verdict: IcpVerdict;
  rejectionReason?: RejectionReason;
  criteriaBreakdown: string[];
  reasoning: string;
}

/**
 * Reduce a word to a crude stem so singular and plural forms match.
 *
 * Campaign criteria and company records rarely agree on form: the exclusion
 * reads "consultancies" while the industry reads "Consultancy". Comparing
 * literally missed Accenture entirely.
 */
function stem(word: string): string {
  const w = word.toLowerCase().trim();
  if (w.endsWith("ies")) return w.slice(0, -3);
  if (w.endsWith("es")) return w.slice(0, -2);
  if (w.endsWith("y")) return w.slice(0, -1);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

const words = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];

/** True when any word in `text` shares a stem with any word in `term`. */
function mentionsTerm(text: string, term: string): boolean {
  const termStems = words(term).filter((w) => w.length > 3).map(stem);
  if (!termStems.length) return false;
  const textStems = new Set(words(text).map(stem));
  return termStems.some((t) => textStems.has(t));
}

/** Pull "50-1000 employees" or "500+ employees" out of the criteria text. */
function employeeBand(criteria: string): { min?: number; max?: number } {
  const range = criteria.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)/);
  if (range) {
    return { min: Number(range[1].replace(/,/g, "")), max: Number(range[2].replace(/,/g, "")) };
  }
  const atLeast = criteria.match(/(\d[\d,]*)\s*\+/);
  if (atLeast) return { min: Number(atLeast[1].replace(/,/g, "")) };
  const under = criteria.match(/(?:under|below|<)\s*(\d[\d,]*)/i);
  if (under) return { max: Number(under[1].replace(/,/g, "")) };
  return {};
}

export function scoreProspect(campaign: Campaign, prospect: Prospect): IcpResult {
  const { icp, policy } = campaign;
  const threshold100 = Math.round(policy.minScoreThreshold * 100);
  const facts = factsFor(prospect.company);
  const breakdown: string[] = [];

  const searchable = [
    prospect.title,
    prospect.company,
    facts?.industry ?? "",
    prospect.location,
  ]
    .join(" ")
    .toLowerCase();

  // --- 1. Exclusions win over everything -----------------------------------
  const exclusions = icp.exclusions.split(",").map((e) => e.trim()).filter(Boolean);
  for (const term of exclusions) {
    if (mentionsTerm(searchable, term)) {
      return {
        fitScore: 0,
        verdict: "REJECTED",
        rejectionReason: "EXCLUSION_MATCH",
        criteriaBreakdown: [`exclusion: matched "${term}" -> REJECTED`],
        reasoning: `${prospect.company} matches the campaign exclusion "${term}", which overrides every other dimension.`,
      };
    }
  }

  // --- 2. PERSONA, max 40 ---------------------------------------------------
  const title = prospect.title.toLowerCase();
  const exact = icp.targetRoles.find((r) => title.includes(r.toLowerCase()));
  // Never summed across two partial matches: the higher one wins.
  const seniorityHit = /\b(cto|cio|vp|head of|chief|founder|director)\b/.test(title);
  const persona = exact ? 40 : seniorityHit ? 20 : 0;
  breakdown.push(
    exact
      ? `persona: title "${prospect.title}" matches target role "${exact}" -> 40/40`
      : seniorityHit
        ? `persona: "${prospect.title}" is senior but not a listed target role -> 20/40`
        : `persona: "${prospect.title}" matches no target role -> 0/40`,
  );

  if (persona === 0) {
    return {
      fitScore: 0,
      verdict: "REJECTED",
      rejectionReason: "PERSONA_MISMATCH",
      criteriaBreakdown: breakdown,
      reasoning: `"${prospect.title}" is not one of this campaign's target roles (${icp.targetRoles.join(", ")}).`,
    };
  }

  // --- 3. COMPANY, max 30: industry AND size together ----------------------
  const band = employeeBand(icp.companyCriteria);
  let company = 0;
  let sizeMiss = false;

  if (!facts) {
    breakdown.push("company: no verified industry or headcount available -> 0/30");
  } else {
    const industryHit = mentionsTerm(icp.companyCriteria, facts.industry);
    const sizeOk =
      (band.min === undefined || facts.employees >= band.min) &&
      (band.max === undefined || facts.employees <= band.max);
    sizeMiss = !sizeOk;

    company = (industryHit ? 18 : 6) + (sizeOk ? 12 : 0);
    breakdown.push(
      `company: industry "${facts.industry}"${industryHit ? " matches" : " is adjacent to"} the criteria, ` +
        `headcount ${facts.employees.toLocaleString()} ${sizeOk ? "within" : "outside"} the required band -> ${company}/30`,
    );
  }

  // --- 4. GEOGRAPHY, max 20 -------------------------------------------------
  // Matched on the company's resolved country, because a location string like
  // "Mumbai" does not contain "India" and a naive substring test scored every
  // Indian bank at zero.
  const geoTokens = icp.geography.split(/[,/]/).map((g) => g.trim().toLowerCase()).filter(Boolean);
  const geoHaystack = `${facts?.country ?? ""} ${prospect.location}`.toLowerCase();
  const geoHit = geoTokens.some((g) => geoHaystack.includes(g));
  const geography = geoHit ? 20 : 0;
  breakdown.push(
    `geography: ${facts?.country ?? prospect.location} ${geoHit ? "is within" : "is outside"} ${icp.geography} -> ${geography}/20`,
  );

  // --- 5. SIGNALS, max 10 ---------------------------------------------------
  const signalCount = prospect.dossier?.signals?.length ?? 0;
  const hasBrief = Boolean(prospect.researchBrief);
  const signals = signalCount > 0 ? 10 : hasBrief ? 6 : 0;
  breakdown.push(
    signalCount > 0
      ? `signals: ${signalCount} dated signal(s) in the dossier -> 10/10`
      : hasBrief
        ? "signals: research brief present but no dated signals -> 6/10"
        : "signals: research has not run for this prospect -> 0/10",
  );

  // fit_score IS the sum. It is never divided.
  const fitScore = persona + company + geography + signals;

  // --- 6. Decision order ----------------------------------------------------
  if (sizeMiss) {
    return {
      fitScore,
      verdict: "NEEDS_REVIEW",
      rejectionReason: "CRITERIA_MISS",
      criteriaBreakdown: breakdown,
      reasoning: `${prospect.company} scores ${fitScore}/100 but its headcount falls outside "${icp.companyCriteria}". An objective miss is a human's call.`,
    };
  }
  if (fitScore >= threshold100) {
    return {
      fitScore,
      verdict: "QUALIFIED",
      criteriaBreakdown: breakdown,
      // `exact` is undefined when the title scored on seniority rather than
      // an exact role match, so fall back to the title itself.
      reasoning: `${prospect.name} scores ${fitScore}/100 against a threshold of ${threshold100}: ${exact ?? prospect.title} at a ${facts?.industry ?? "matching"} company in ${icp.geography}.`,
    };
  }
  if (fitScore >= threshold100 - 10) {
    return {
      fitScore,
      verdict: "NEEDS_REVIEW",
      rejectionReason: "CRITERIA_MISS",
      criteriaBreakdown: breakdown,
      reasoning: `${prospect.name} scores ${fitScore}/100, a near miss on the ${threshold100} threshold. Worth a human glance.`,
    };
  }
  return {
    fitScore,
    verdict: "REJECTED",
    rejectionReason: "BELOW_THRESHOLD",
    criteriaBreakdown: breakdown,
    reasoning: `${prospect.name} scores ${fitScore}/100, below the ${threshold100} threshold for this campaign.`,
  };
}

/** One line for the activity log, mirroring the live agent's output shape. */
export function describeVerdict(r: IcpResult): string {
  const reason = r.rejectionReason ? `, ${r.rejectionReason}` : "";
  return `fit_score ${r.fitScore}, verdict ${r.verdict}${reason} — ${r.reasoning}`;
}
