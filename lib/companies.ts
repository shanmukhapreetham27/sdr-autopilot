/**
 * Facts about the real companies used as prospects.
 *
 * The ICP Fitment Agent scores a 30-point COMPANY dimension from industry and
 * employee count, and correctly refuses to guess when they are missing — it
 * returned `CRITERIA_MISS, "company size unknown"` when the app sent neither.
 * So the prospect record carries them.
 *
 * Headcounts are approximate public figures, adequate for scoring against a
 * band like "50-1000 employees" and not presented as verified anywhere in the
 * UI. The Research Agent is what establishes verified facts; this is only
 * enough for the qualification maths to be real rather than arbitrary.
 *
 * Each pool deliberately includes companies that MISS their campaign's ICP,
 * so qualification has genuine decisions to make.
 */

export interface CompanyFacts {
  industry: string;
  employees: number;
  location: string;
  /** Resolved explicitly: "Mumbai" does not contain the substring "India". */
  country: string;
  domain: string;
}

export const COMPANY_FACTS: Record<string, CompanyFacts> = {
  // --- US B2B SaaS / developer infrastructure -----------------------------
  Linear: { industry: "B2B SaaS", employees: 200, location: "San Francisco, CA", country: "United States", domain: "linear.app" },
  Retool: { industry: "B2B SaaS", employees: 350, location: "San Francisco, CA", country: "United States", domain: "retool.com" },
  Render: { industry: "Developer infrastructure", employees: 150, location: "San Francisco, CA", country: "United States", domain: "render.com" },
  Temporal: { industry: "Developer infrastructure", employees: 250, location: "Seattle, WA", country: "United States", domain: "temporal.io" },
  Vanta: { industry: "B2B SaaS", employees: 800, location: "San Francisco, CA", country: "United States", domain: "vanta.com" },
  Airbyte: { industry: "Data infrastructure", employees: 200, location: "San Francisco, CA", country: "United States", domain: "airbyte.com" },
  WorkOS: { industry: "Developer infrastructure", employees: 100, location: "San Francisco, CA", country: "United States", domain: "workos.com" },
  Honeycomb: { industry: "Observability", employees: 200, location: "San Francisco, CA", country: "United States", domain: "honeycomb.io" },
  Clerk: { industry: "Developer infrastructure", employees: 100, location: "San Francisco, CA", country: "United States", domain: "clerk.com" },
  Sentry: { industry: "Observability", employees: 350, location: "San Francisco, CA", country: "United States", domain: "sentry.io" },
  PostHog: { industry: "B2B SaaS", employees: 90, location: "San Francisco, CA", country: "United States", domain: "posthog.com" },
  // Consultancy: excluded by the US SaaS campaign.
  Accenture: { industry: "Consultancy", employees: 750000, location: "Dublin", country: "Ireland", domain: "accenture.com" },

  // --- India BFSI ---------------------------------------------------------
  "HDFC Bank": { industry: "Banking", employees: 180000, location: "Mumbai", country: "India", domain: "hdfcbank.com" },
  "ICICI Bank": { industry: "Banking", employees: 130000, location: "Mumbai", country: "India", domain: "icicibank.com" },
  "Axis Bank": { industry: "Banking", employees: 90000, location: "Mumbai", country: "India", domain: "axisbank.com" },
  "Kotak Mahindra Bank": { industry: "Banking", employees: 100000, location: "Mumbai", country: "India", domain: "kotak.com" },
  "Bajaj Finserv": { industry: "Financial Services", employees: 50000, location: "Pune", country: "India", domain: "bajajfinserv.in" },
  "SBI Life Insurance": { industry: "Insurance", employees: 20000, location: "Mumbai", country: "India", domain: "sbilife.co.in" },
  "HDFC Life": { industry: "Insurance", employees: 22000, location: "Mumbai", country: "India", domain: "hdfclife.com" },
  "Muthoot Finance": { industry: "NBFC", employees: 25000, location: "Kochi", country: "India", domain: "muthootfinance.com" },
  "Shriram Finance": { industry: "NBFC", employees: 60000, location: "Chennai", country: "India", domain: "shriramfinance.in" },
  "IDFC First Bank": { industry: "Banking", employees: 40000, location: "Mumbai", country: "India", domain: "idfcfirstbank.com" },
  // Crypto: excluded by the BFSI campaign.
  CoinDCX: { industry: "Crypto exchange", employees: 500, location: "Mumbai", country: "India", domain: "coindcx.com" },

  // --- Voice AI -----------------------------------------------------------
  Vapi: { industry: "Voice AI", employees: 50, location: "San Francisco, CA", country: "United States", domain: "vapi.ai" },
  "Retell AI": { industry: "Voice AI", employees: 30, location: "San Francisco, CA", country: "United States", domain: "retellai.com" },
  Cartesia: { industry: "Voice AI", employees: 60, location: "San Francisco, CA", country: "United States", domain: "cartesia.ai" },
  Rime: { industry: "Voice AI", employees: 25, location: "San Francisco, CA", country: "United States", domain: "rime.ai" },
  "Bland AI": { industry: "Voice AI", employees: 50, location: "San Francisco, CA", country: "United States", domain: "bland.ai" },
  LiveKit: { industry: "Developer infrastructure", employees: 80, location: "San Francisco, CA", country: "United States", domain: "livekit.io" },
  Vocode: { industry: "Voice AI", employees: 20, location: "San Francisco, CA", country: "United States", domain: "vocode.dev" },
  "Hume AI": { industry: "Voice AI", employees: 70, location: "New York, NY", country: "United States", domain: "hume.ai" },
  // Both well past the campaign's 80-employee ceiling: a real judgement call
  // rather than an obvious pass.
  Deepgram: { industry: "Speech AI", employees: 250, location: "San Francisco, CA", country: "United States", domain: "deepgram.com" },
  AssemblyAI: { industry: "Speech AI", employees: 200, location: "San Francisco, CA", country: "United States", domain: "assemblyai.com" },
  // Robotics, not voice AI: excluded.
  "Boston Dynamics": { industry: "Robotics", employees: 1500, location: "Waltham, MA", country: "United States", domain: "bostondynamics.com" },

  // --- Fallback pool ------------------------------------------------------
  Stripe: { industry: "Fintech", employees: 8000, location: "San Francisco, CA", country: "United States", domain: "stripe.com" },
  Datadog: { industry: "Observability", employees: 5000, location: "New York, NY", country: "United States", domain: "datadoghq.com" },
  Snowflake: { industry: "Data infrastructure", employees: 7000, location: "Bozeman, MT", country: "United States", domain: "snowflake.com" },
};

export function factsFor(company: string): CompanyFacts | undefined {
  return COMPANY_FACTS[company];
}
