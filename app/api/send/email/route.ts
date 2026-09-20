import { NextResponse } from "next/server";
import { sendEmail, mailerStatus, type SendRequest } from "@/lib/gmail";

export const dynamic = "force-dynamic";

/** Reports whether sending is wired, and where messages are redirected. */
export async function GET() {
  return NextResponse.json(mailerStatus());
}

/**
 * Send one agent-generated email through Gmail.
 *
 * The recipient is decided server-side by lib/gmail.ts, not by the caller —
 * the browser cannot choose who receives a message.
 */
export async function POST(request: Request) {
  let payload: SendRequest;
  try {
    payload = (await request.json()) as SendRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  if (!payload?.body?.trim()) {
    return NextResponse.json({ ok: false, error: "Nothing to send: empty body" }, { status: 400 });
  }

  const result = await sendEmail({
    intendedTo: payload.intendedTo ?? "unknown",
    intendedName: payload.intendedName ?? "prospect",
    subject: payload.subject?.trim() || "(no subject)",
    body: payload.body,
    campaignName: payload.campaignName ?? "unknown campaign",
  });

  // A refused or failed send is a normal operational event the campaign
  // records and carries on from, not a server error.
  return NextResponse.json(result);
}
