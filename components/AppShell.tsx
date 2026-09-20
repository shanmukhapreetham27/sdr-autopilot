"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSdr } from "@/lib/store";
import { runTick } from "@/lib/simulator";
import {
  fetchIntegrationStatus,
  fetchMailerStatus,
  type MailerStatus,
} from "@/lib/agentClient";
import { LIVE_CAPABLE_AGENTS } from "@/lib/types";
import { Button } from "./ui";

/** How often the agent loop takes a step, in ms. */
const TICK_MS = 2600;

/**
 * Drives the agent loop for the whole platform. Mounted once, in the shell,
 * so campaigns keep executing while the manager navigates between pages.
 */
function useAgentLoop(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => void runTick(), TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);
}

/**
 * Ask the server which agents have a DronaHQ webhook configured. Runs once
 * per load; the answer comes from environment variables, so it cannot change
 * while the page is open.
 */
function useIntegrationStatus(enabled: boolean) {
  const setLiveAgents = useSdr((s) => s.setLiveAgents);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchIntegrationStatus().then((status) => {
      if (cancelled || !status) return;
      setLiveAgents(status.agents.filter((a) => a.live).map((a) => a.agent));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, setLiveAgents]);
}

/**
 * Load the snapshot from Postgres once the app is on the client.
 *
 * The agent loop is gated on this: stepping a campaign before the snapshot
 * arrives would act on an empty store and write phantom state back.
 */
function useHydrate(enabled: boolean) {
  const hydrate = useSdr((s) => s.hydrate);
  useEffect(() => {
    if (!enabled) return;
    void hydrate();
  }, [enabled, hydrate]);
}

/**
 * Mailer state, polled so the send counter stays current while agents work.
 * Read-only: the recipient is decided server-side and cannot be set here.
 */
function useMailerStatus(enabled: boolean) {
  const [status, setStatus] = useState<MailerStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      fetchMailerStatus().then((s) => {
        if (!cancelled) setStatus(s);
      });
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);
  return status;
}

/**
 * False on the server and on the first client render, true afterwards.
 *
 * The store rehydrates from localStorage synchronously in the browser, so
 * anything reading it would produce different markup than the server sent.
 * Gating on this keeps the first render identical on both sides.
 */
const noopSubscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const NAV = [
  { href: "/campaigns", label: "Campaigns", icon: "◎" },
  { href: "/prospects", label: "Prospects", icon: "◇" },
  { href: "/activity", label: "Activity", icon: "≡" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mounted = useHydrated();

  useHydrate(mounted);
  useIntegrationStatus(mounted);
  const mailer = useMailerStatus(mounted);

  const campaigns = useSdr((s) => s.campaigns);
  const killSwitch = useSdr((s) => s.killSwitch);
  const setKillSwitch = useSdr((s) => s.setKillSwitch);
  const resetDemo = useSdr((s) => s.resetDemo);
  const liveAgents = useSdr((s) => s.liveAgents);
  const sync = useSdr((s) => s.sync);
  const lastError = useSdr((s) => s.lastError);

  // Only step campaigns once real state is loaded.
  useAgentLoop(mounted && sync === "ready");

  const liveCount = campaigns.filter((c) => c.status === "live").length;
  const wiredCount = liveAgents.length;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950/70">
        <div className="border-b border-slate-800 px-4 py-4">
          <Link href="/campaigns" className="block">
            <div className="text-sm font-semibold tracking-tight text-slate-100">SDR Autopilot</div>
            <div className="text-[11px] text-slate-500">Autonomous GTM control plane</div>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-slate-800 font-medium text-slate-100"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`}
              >
                <span className="w-3 text-center text-xs text-slate-500">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-slate-800 p-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Agent loop
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs">
              {mounted && sync === "ready" && !killSwitch && liveCount > 0 ? (
                <>
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="text-emerald-300">
                    Executing · {liveCount} live
                  </span>
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                  <span className="text-slate-500">
                    {killSwitch ? "Halted" : sync === "loading" ? "Loading…" : "Idle"}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Honest integration status: how many agents are actually backed
              by a published DronaHQ agent right now. */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              DronaHQ agents
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  wiredCount > 0 ? "bg-violet-400" : "bg-slate-600"
                }`}
              />
              <span className={wiredCount > 0 ? "text-violet-300" : "text-slate-500"}>
                {wiredCount} / {LIVE_CAPABLE_AGENTS.length} wired
              </span>
            </div>
            {wiredCount === 0 && (
              <p className="mt-1 text-[10px] leading-snug text-slate-600">
                No webhooks configured — agents are running simulated.
              </p>
            )}
          </div>

          {/* Email delivery. Shows the redirect target explicitly: agent mail
              is really sent, but never to a prospect's own address. */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Email delivery
            </div>
            {mailer?.configured ? (
              <>
                <div className="mt-1 flex items-center gap-1.5 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                  <span className="text-sky-300">
                    {mailer.sent} sent · {mailer.remaining} left
                  </span>
                </div>
                <p className="mt-1 break-all text-[10px] leading-snug text-slate-600">
                  All mail redirected to {mailer.redirectTo}
                </p>
              </>
            ) : (
              <div className="mt-1 flex items-center gap-1.5 text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                <span className="text-slate-500">Not configured</span>
              </div>
            )}
          </div>

          <Button variant="ghost" size="sm" onClick={resetDemo}>
            ↺ Reset demo data
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/70 px-6 py-3">
          <div className="text-xs text-slate-500">
            Signed in as <span className="text-slate-300">Priya Nair</span> · Platform admin
          </div>

          {/* Global kill switch: one control that stops every autonomous
              external action across every campaign, instantly. */}
          <button
            type="button"
            onClick={() => setKillSwitch(!killSwitch)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              killSwitch
                ? "border-rose-500 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-rose-500/50 hover:text-rose-300"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${killSwitch ? "bg-rose-400" : "bg-slate-600"}`} />
            {killSwitch ? "KILL SWITCH ENGAGED — click to release" : "Global kill switch"}
          </button>
        </header>

        {sync === "offline" && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-200">
            Not synced to the database — changes on screen are not being saved.
            {lastError ? ` (${lastError})` : ""}
          </div>
        )}

        {killSwitch && (
          <div className="border-b border-rose-500/30 bg-rose-500/10 px-6 py-2 text-xs text-rose-200">
            All autonomous external actions are halted platform-wide. Campaign states are
            preserved and will resume exactly where they stopped when the switch is released.
          </div>
        )}

        <main className="min-w-0 flex-1 px-6 py-6">
          {mounted && sync !== "loading" ? children : <ShellSkeleton />}
        </main>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-7 w-52 animate-pulse rounded bg-slate-800/60" />
      <div className="h-24 animate-pulse rounded-xl bg-slate-900/60" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-900/60" />
    </div>
  );
}
