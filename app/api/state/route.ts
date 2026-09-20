import { NextResponse } from "next/server";
import { applyCommand, databaseConfigured, readState } from "@/lib/db";
import type { Command } from "@/lib/commands";

export const dynamic = "force-dynamic";

/** Full platform snapshot: campaigns, prospects, activity and the kill switch. */
export async function GET() {
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not set" }, { status: 503 });
  }
  try {
    return NextResponse.json({ ok: true, state: await readState() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * Apply one command from lib/commands.ts.
 *
 * The client updates optimistically and posts here; a failure is reported so
 * the caller can resynchronise rather than silently diverging from the
 * database.
 */
export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not set" }, { status: 503 });
  }

  let cmd: Command;
  try {
    cmd = (await request.json()) as Command;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  if (!cmd?.op) {
    return NextResponse.json({ ok: false, error: "Missing command op" }, { status: 400 });
  }

  try {
    await applyCommand(cmd);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
