/**
 * Gmail sending — SERVER ONLY.
 *
 * Never import this from a client component: it reads OAuth credentials from
 * the environment.
 *
 * SAFETY INVARIANT
 * ----------------
 * Prospects in this system are synthetic personas at REAL company domains
 * (dana.whitfield@linear.app). Delivering to those addresses would bounce off
 * real corporate mail servers and could reach a real person if an address
 * happened to resolve.
 *
 * So every message is redirected to DEMO_EMAIL_REDIRECT_TO, and the intended
 * recipient is preserved in the subject and in an X-Intended-To header. There
 * is deliberately no code path that sends to `prospect.email`: if the redirect
 * address is not configured, sending is refused outright rather than falling
 * back to the real address.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/**
 * Guard rails on volume. The agent loop can produce a message every few
 * seconds, which would exhaust Gmail's daily quota and bury the demo inbox.
 * Counters are per server instance, which is enough for a demo; a durable
 * limit would live in the database.
 */
const MAX_SENDS_PER_INSTANCE = Number(process.env.EMAIL_MAX_SENDS ?? 25);
const MIN_MS_BETWEEN_SENDS = Number(process.env.EMAIL_MIN_INTERVAL_MS ?? 15_000);

let sentCount = 0;
let lastSentAt = 0;

export interface MailerStatus {
  configured: boolean;
  redirectTo: string | null;
  sent: number;
  remaining: number;
}

export function redirectAddress(): string | null {
  return process.env.DEMO_EMAIL_REDIRECT_TO?.trim() || null;
}

export function mailerConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN &&
      redirectAddress(),
  );
}

export function mailerStatus(): MailerStatus {
  return {
    configured: mailerConfigured(),
    redirectTo: redirectAddress(),
    sent: sentCount,
    remaining: Math.max(0, MAX_SENDS_PER_INSTANCE - sentCount),
  };
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Access tokens last an hour, so mint one and reuse it. The refresh token is
 * what makes this survive a deployment; an access token alone would expire
 * mid-demo.
 */
async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID ?? "",
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? "",
      refresh_token: process.env.GMAIL_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });

  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description ?? `Token refresh failed (${res.status})`);
  }

  cachedToken = {
    value: json.access_token,
    // Refresh a minute early rather than racing the expiry.
    expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.value;
}

// ---------------------------------------------------------------------------
// Message construction
// ---------------------------------------------------------------------------

/** RFC 2047 encode a header value when it is not plain ASCII. */
function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Strip anything that could inject extra headers into the message. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function base64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface SendRequest {
  /** Who the agent actually wrote to. Used for labelling, never for delivery. */
  intendedTo: string;
  intendedName: string;
  subject: string;
  body: string;
  campaignName: string;
}

export type SendResult =
  | { ok: true; messageId: string; redirectedTo: string }
  | { ok: false; error: string };

export async function sendEmail(req: SendRequest): Promise<SendResult> {
  const to = redirectAddress();

  if (!to) {
    return {
      ok: false,
      error:
        "DEMO_EMAIL_REDIRECT_TO is not set. Refusing to send rather than delivering to a prospect address.",
    };
  }
  if (!mailerConfigured()) {
    return { ok: false, error: "Gmail is not configured (missing client id, secret or refresh token)." };
  }
  if (sentCount >= MAX_SENDS_PER_INSTANCE) {
    return { ok: false, error: `Send cap reached (${MAX_SENDS_PER_INSTANCE}). Raise EMAIL_MAX_SENDS to continue.` };
  }
  const since = Date.now() - lastSentAt;
  if (lastSentAt && since < MIN_MS_BETWEEN_SENDS) {
    return { ok: false, error: `Rate limited: ${Math.ceil((MIN_MS_BETWEEN_SENDS - since) / 1000)}s until the next send.` };
  }

  // Reserve the slot before the network call so concurrent campaign ticks
  // cannot both slip past the cap.
  sentCount += 1;
  lastSentAt = Date.now();

  try {
    const token = await accessToken();

    const intendedTo = headerSafe(req.intendedTo);
    const subject = headerSafe(`[DEMO → ${req.intendedName}] ${req.subject}`);

    const mime = [
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      // Preserved so the real target is auditable without ever being used
      // as a delivery address.
      `X-Intended-To: ${intendedTo}`,
      `X-SDR-Campaign: ${headerSafe(req.campaignName)}`,
      "Content-Type: text/plain; charset=UTF-8",
      "MIME-Version: 1.0",
      "",
      req.body,
      "",
      "---",
      `This message was generated by an autonomous SDR agent for campaign "${req.campaignName}".`,
      `It was addressed to ${intendedTo} and redirected here for demonstration.`,
      "No outreach was delivered to the intended recipient.",
    ].join("\r\n");

    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64Url(mime) }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });

    const json = (await res.json()) as { id?: string; error?: { message?: string } };
    if (!res.ok || !json.id) {
      sentCount -= 1; // the slot was not actually used
      return { ok: false, error: json.error?.message ?? `Gmail returned ${res.status}` };
    }

    return { ok: true, messageId: json.id, redirectedTo: to };
  } catch (err) {
    sentCount -= 1;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
