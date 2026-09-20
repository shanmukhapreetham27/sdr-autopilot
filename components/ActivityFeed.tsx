"use client";

import { useEffect, useState } from "react";
import type { ActivityEvent, Campaign } from "@/lib/types";
import { AgentTag, ChannelTag, EmptyState, EventStatusDot, timeAgo } from "./ui";

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
                {e.status === "pending_approval" && (
                  <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                    Needs human
                  </span>
                )}
                {e.status === "failed" && (
                  <span className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
                    Failed
                  </span>
                )}
              </div>

              <p className="mt-1 text-[13px] leading-snug text-slate-300">{e.summary}</p>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-600">
                <span>{timeAgo(e.ts, now)}</span>
                {/* Audit trail: which harness version produced this action. */}
                {version && <span>harness v{version.version}</span>}
                {e.tokens > 0 && <span>{e.tokens.toLocaleString()} tokens</span>}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
