"use client";

import { useState } from "react";
import ActivityFeed from "@/components/ActivityFeed";
import { useSdr } from "@/lib/store";
import { Card, Stat } from "@/components/ui";

type Filter = "all" | "escalations" | "failures";

export default function ActivityPage() {
  const campaigns = useSdr((s) => s.campaigns);
  const activity = useSdr((s) => s.activity);
  const [campaignId, setCampaignId] = useState("all");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = activity.filter((e) => {
    if (campaignId !== "all" && e.campaignId !== campaignId) return false;
    if (filter === "escalations") return e.status === "pending_approval";
    if (filter === "failures") return e.status === "failed";
    return true;
  });

  const escalations = activity.filter((e) => e.status === "pending_approval").length;
  const failures = activity.filter((e) => e.status === "failed").length;
  const tokens = activity.reduce((s, e) => s + e.tokens, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Activity</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every meaningful agent action across every campaign, with the harness version that
          produced it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total actions" value={activity.length} />
        <Stat label="Awaiting human" value={escalations} tone={escalations ? "warn" : "default"} />
        <Stat label="Failures" value={failures} tone={failures ? "bad" : "default"} />
        <Stat
          label="Tokens used"
          value={tokens.toLocaleString()}
          hint={`≈ $${((tokens / 1_000_000) * 3).toFixed(2)} at $3/M input`}
        />
      </div>

      <Card
        title={`${filtered.length} events`}
        action={
          <div className="flex gap-2">
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-300 outline-none"
            >
              <option value="all">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-300 outline-none"
            >
              <option value="all">All events</option>
              <option value="escalations">Escalations only</option>
              <option value="failures">Failures only</option>
            </select>
          </div>
        }
      >
        <ActivityFeed events={filtered} campaigns={campaigns} showCampaign height="h-[600px]" />
      </Card>
    </div>
  );
}
