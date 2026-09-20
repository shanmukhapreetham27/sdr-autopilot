import { NextResponse } from "next/server";
import { LIVE_CAPABLE_AGENTS, wiredAgents } from "@/lib/dronahq";

export const dynamic = "force-dynamic";

/**
 * Which agents are backed by a real DronaHQ webhook right now.
 *
 * Returns only agent names and booleans — never a URL or a key. The UI uses
 * this to label each agent "DronaHQ live" or "Simulated", so what the judge
 * sees on screen always matches what is actually configured.
 */
export async function GET() {
  const wired = wiredAgents();
  return NextResponse.json({
    agents: LIVE_CAPABLE_AGENTS.map((agent) => ({ agent, live: wired.includes(agent) })),
    liveCount: wired.length,
    totalCapable: LIVE_CAPABLE_AGENTS.length,
  });
}
