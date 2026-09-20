"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { findConflicts, metricsFor, useSdr } from "@/lib/store";
import type { Campaign, Channel } from "@/lib/types";
import { Button, ChannelTag, Stat, StatusPill } from "@/components/ui";

export default function CampaignsPage() {
  const router = useRouter();
  const campaigns = useSdr((s) => s.campaigns);
  const prospects = useSdr((s) => s.prospects);
  const activity = useSdr((s) => s.activity);
  const killSwitch = useSdr((s) => s.killSwitch);
  const setCampaignStatus = useSdr((s) => s.setCampaignStatus);
  const duplicateCampaign = useSdr((s) => s.duplicateCampaign);

  // Archived campaigns are kept, not deleted — their history and analytics
  // stay available — but they are not operational, so they are out of the way
  // by default. The toggle names the count so nothing silently disappears.
  const [showArchived, setShowArchived] = useState(false);
  const archived = campaigns.filter((c) => c.status === "archived");
  const visible = showArchived ? campaigns : campaigns.filter((c) => c.status !== "archived");

  const conflicts = findConflicts(prospects, campaigns).filter((c) => c.bothLive);

  const totals = campaigns.reduce(
    (acc, c) => {
      const m = metricsFor(prospects, activity, c.id);
      acc.prospects += m.prospects;
      acc.outreach += m.outreach;
      acc.meetings += m.meetings;
      acc.escalations += m.escalations;
      return acc;
    },
    { prospects: 0, outreach: 0, meetings: 0, escalations: 0 },
  );

  const liveCount = campaigns.filter((c) => c.status === "live").length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Campaigns</h1>
          <p className="mt-1 text-sm text-slate-500">
            {visible.length} campaigns · {liveCount} executing right now. Each runs its own
            ICP, prompts, agents and channels independently.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {archived.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowArchived(!showArchived)}>
              {showArchived
                ? `Hide ${archived.length} archived`
                : `Show ${archived.length} archived`}
            </Button>
          )}
          <Link href="/campaigns/new">
            <Button variant="primary">+ New campaign</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Prospects in play" value={totals.prospects} />
        <Stat label="Outreach sent" value={totals.outreach} />
        <Stat label="Meetings booked" value={totals.meetings} tone="good" />
        <Stat
          label="Awaiting human"
          value={totals.escalations}
          tone={totals.escalations > 0 ? "warn" : "default"}
          hint="Agent escalations needing a reply"
        />
      </div>

      {/* Duplicate prospects across campaigns are expected, not a fault: the
          same person can match two ICPs. Styled as a resolved status rather
          than a warning, because the platform has already acted — the point
          is that contacting someone twice was prevented. */}
      {conflicts.length > 0 && (
        <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-indigo-300">⧉</span>
            <span className="text-sm font-medium text-slate-200">
              Duplicate prospect handled
            </span>
            <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-300">
              Resolved
            </span>
          </div>
          <div className="mt-2 space-y-1.5">
            {conflicts.map((c) => (
              <p key={c.email} className="text-xs leading-relaxed text-slate-400">
                <span className="font-medium text-slate-200">{c.name}</span> ({c.email}) matches
                the ICP of{" "}
                {c.entries
                  .map((e) => campaigns.find((x) => x.id === e.campaignId)?.name ?? e.campaignId)
                  .join(" and ")}
                . Outreach is running on the higher-priority campaign only, so they are not
                contacted twice.
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/60 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5 font-medium">Campaign</th>
              <th className="px-4 py-2.5 font-medium">ICP</th>
              <th className="px-4 py-2.5 font-medium">Channels</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Prospects</th>
              <th className="px-4 py-2.5 text-right font-medium">Outreach</th>
              <th className="px-4 py-2.5 text-right font-medium">Meetings</th>
              <th className="px-4 py-2.5 text-right font-medium">Control</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <CampaignRow
                key={c.id}
                campaign={c}
                killSwitch={killSwitch}
                metrics={metricsFor(prospects, activity, c.id)}
                onToggle={() =>
                  setCampaignStatus(c.id, c.status === "live" ? "paused" : "live")
                }
                onDuplicate={() => {
                  const id = duplicateCampaign(c.id);
                  if (id) router.push(`/campaigns/${id}`);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-600">
        Pausing one campaign stops only that campaign&apos;s autonomous execution. Every other
        campaign keeps running, and paused campaigns retain all prospect and conversation data.
      </p>
    </div>
  );
}

function CampaignRow({
  campaign,
  metrics,
  killSwitch,
  onToggle,
  onDuplicate,
}: {
  campaign: Campaign;
  metrics: ReturnType<typeof metricsFor>;
  killSwitch: boolean;
  onToggle: () => void;
  onDuplicate: () => void;
}) {
  const c = campaign;
  const enabledChannels = (Object.keys(c.channels) as Channel[]).filter(
    (ch) => c.channels[ch].enabled,
  );
  const isDraft = c.status === "draft";

  return (
    <tr className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/40">
      <td className="px-4 py-3">
        <Link href={`/campaigns/${c.id}`} className="group block">
          <div className="font-medium text-slate-100 group-hover:text-emerald-300">{c.name}</div>
          <div className="mt-0.5 line-clamp-1 max-w-md text-xs text-slate-500">
            {c.description}
          </div>
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="text-slate-300">{c.icp.label}</div>
        <div className="text-xs text-slate-600">{c.icp.geography}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {enabledChannels.map((ch) => (
            <ChannelTag key={ch} channel={ch} muted={c.channels[ch].paused || c.status !== "live"} />
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusPill status={killSwitch && c.status === "live" ? "paused" : c.status} />
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-slate-300">{metrics.prospects}</td>
      <td className="px-4 py-3 text-right tabular-nums text-slate-300">{metrics.outreach}</td>
      <td className="px-4 py-3 text-right tabular-nums font-medium text-emerald-400">
        {metrics.meetings}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant={c.status === "live" ? "warn" : "primary"}
            onClick={onToggle}
            disabled={isDraft}
            title={isDraft ? "Draft campaigns cannot send outreach until activated" : undefined}
          >
            {c.status === "live" ? "❚❚ Pause" : "▶ Resume"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDuplicate} title="Duplicate into an A/B variant">
            ⧉
          </Button>
          <Link href={`/campaigns/${c.id}`}>
            <Button size="sm" variant="ghost">
              Open →
            </Button>
          </Link>
        </div>
      </td>
    </tr>
  );
}
