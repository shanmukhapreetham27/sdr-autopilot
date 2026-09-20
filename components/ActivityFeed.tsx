"use client";

import { useEffect, useState } from "react";
import type { ActivityEvent, Campaign } from "@/lib/types";
import { useSdr } from "@/lib/store";
import { AgentTag, ChannelTag, EmptyState, EventStatusDot, timeAgo } from "./ui";

/** Labels where an action really came from, so the UI never overclaims. */
function SourceTag({ source }: { source: ActivityEvent["source"] }) {
  if (source === "dronahq") {
    return (
      <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1 py-0.5 font-medium text-violet-300">
        DronaHQ
      </span>
    );
  }
  return <span className="text-slate-700">simulated</span>;
}

/** A ticking clock so relative timestamps stay honest without re-rendering the world. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function ActivityFeed({
  events,
  campaigns,
  showCampaign = false,
  height = "h-[420px]",
}: {
  events: ActivityEvent[];
  campaigns: Campaign[];
  showCampaign?: boolean;
  height?: string;
}) {
  const now = useNow();
  const prospects = useSdr((s) => s.prospects);
  const resolveEscalation = useSdr((s) => s.resolveEscalation);

  if (!events.length) {
    return (
      <EmptyState
        title="No agent activity yet"
        hint="Activate the campaign to let agents start working."
      />
    );
  }

  return (
    <div className={`${height} space-y-0 overflow-y-auto pr-1`}>
      {events.map((e) => {
        const campaign = campaigns.find((c) => c.id === e.campaignId);
        const version = campaign?.versions.find((v) => v.id === e.versionId);
        return (
          <article
            key={e.id}
            className="event-row flex gap-3 border-b border-slate-800/50 py-2.5 last:border-0"
          >
            <EventStatusDot status={e.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <AgentTag agent={e.agent} />
                {e.channel && <ChannelTag channel={e.channel} />}
                {showCampaign && campaign && (
                  <span className="text-[10px] text-slate-500">{campaign.name}</span>
                )}
                {e.status === "pending_approval" &&
                  (e.resolvedAt ? (
                    <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                      Resolved by {e.resolvedBy}
                    </span>
                  ) : (
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      Needs human
                    </span>
                  ))}
                {e.status === "failed" && (
                  <span className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
                    Failed
                  </span>
                )}
              </div>

              <p className="mt-1 text-[13px] leading-snug text-slate-300">{e.summary}</p>

              {/* What the agent actually wrote. Shown collapsed so the feed
                  stays scannable, but available without leaving the page. */}
              {e.message && (
                <details className="mt-1.5 group">
                  <summary className="cursor-pointer list-none text-[10px] text-slate-500 hover:text-slate-300">
                    <span className="group-open:hidden">▸ Show generated message</span>
                    <span className="hidden group-open:inline">▾ Hide generated message</span>
                  </summary>
                  <pre className="mt-1.5 whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-2.5 font-sans text-[12px] leading-relaxed text-slate-300">
                    {e.message}
                  </pre>
                </details>
              )}

              {/* The human half of the loop. A parked prospect needs a
                  verdict to move at all; everything else only needs clearing
                  off the queue. */}
              {e.status === "pending_approval" && !e.resolvedAt && (
                <ResolveActions
                  parked={
                    !!e.prospectId &&
                    prospects.some((p) => p.id === e.prospectId && p.needsReview)
                  }
                  onResolve={(decision) => resolveEscalation(e.id, decision)}
                />
              )}

              {/* What grounded this action. Shown for the same reason as the
                  harness version and the DronaHQ badge: the app should never
                  claim retrieval a reader cannot check. */}
              {!!e.retrieved?.length && (
                <details className="group mt-1.5">
                  <summary className="cursor-pointer list-none text-[10px] text-cyan-400/80 hover:text-cyan-300">
                    <span className="group-open:hidden">
                      ▸ Grounded in {e.retrieved.length} retrieved{" "}
                      {e.retrieved.length === 1 ? "source" : "sources"}
                    </span>
                    <span className="hidden group-open:inline">▾ Hide sources</span>
                  </summary>
                  <ul className="mt-1 space-y-0.5 border-l border-cyan-500/30 pl-2.5">
                    {e.retrieved.map((r, i) => (
                      <li key={i} className="text-[10px] leading-snug text-slate-500">
                        <span className="text-slate-300">{r.title}</span>
                        <span className="text-slate-600"> · {r.kind} · {r.source}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-600">
                <span>{timeAgo(e.ts, now)}</span>
                {/* Audit trail: which harness version produced this action. */}
                {version && <span>harness v{version.version}</span>}
                {e.tokens > 0 && <span>{e.tokens.toLocaleString()} tokens</span>}
                {e.latencyMs !== undefined && <span>{e.latencyMs}ms</span>}
                {e.agent !== "system" && <SourceTag source={e.source} />}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/**
 * Buttons a reviewer actually acts on.
 *
 * Labelled by consequence rather than generic approve/reject: a parked
 * prospect is being sent somewhere specific in the funnel, and saying so
 * stops the reviewer having to guess what the button does.
 */
function ResolveActions({
  parked,
  onResolve,
}: {
  parked: boolean;
  onResolve: (decision: "approved" | "rejected" | "acknowledged") => void;
}) {
  const cls =
    "rounded border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-40";
  return (
    <div className="mt-2 flex items-center gap-2">
      {parked ? (
        <>
          <button
            type="button"
            onClick={() => onResolve("approved")}
            title="Accept the agent's prospect and let it continue down the funnel."
            className={`${cls} border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`}
          >
            Qualify
          </button>
          <button
            type="button"
            onClick={() => onResolve("rejected")}
            title="Remove this prospect from the campaign."
            className={`${cls} border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20`}
          >
            Reject
          </button>
          <span className="text-[10px] text-slate-600">
            Held here until you decide
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={() => onResolve("acknowledged")}
          title="Clear this from the queue. The prospect is already moving."
          className={`${cls} border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600`}
        >
          Mark handled
        </button>
      )}
    </div>
  );
}
