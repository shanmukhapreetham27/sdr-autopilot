"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { metricsFor, useSdr } from "@/lib/store";
import { AGENTS, STAGES } from "@/lib/types";
import type { ActivityEvent, Campaign, Channel, Prospect, Stage } from "@/lib/types";
import ActivityFeed from "@/components/ActivityFeed";
import HarnessTab from "@/components/HarnessTab";
import KnowledgeTab from "@/components/KnowledgeTab";
import { Button, Card, ChannelTag, EmptyState, Stat, StatusPill } from "@/components/ui";

const TABS = ["Overview", "Prospects", "Activity", "AI Harness", "Knowledge", "Settings"] as const;
type Tab = (typeof TABS)[number];

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [tab, setTab] = useState<Tab>("Overview");

  const campaigns = useSdr((s) => s.campaigns);
  const prospects = useSdr((s) => s.prospects);
  const activity = useSdr((s) => s.activity);
  const killSwitch = useSdr((s) => s.killSwitch);
  const setCampaignStatus = useSdr((s) => s.setCampaignStatus);

  const campaign = campaigns.find((c) => c.id === id);

  if (!campaign) {
    return (
      <EmptyState
        title="Campaign not found"
        hint="It may have been removed, or the demo data was reset."
      />
    );
  }

  const metrics = metricsFor(prospects, activity, campaign.id);
  const campaignProspects = prospects.filter((p) => p.campaignId === campaign.id);
  const campaignActivity = activity.filter((e) => e.campaignId === campaign.id);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/campaigns" className="text-xs text-slate-500 hover:text-slate-300">
          ← All campaigns
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-slate-100">{campaign.name}</h1>
              <StatusPill status={killSwitch && campaign.status === "live" ? "paused" : campaign.status} />
            </div>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">{campaign.description}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>Owner: <span className="text-slate-400">{campaign.owner}</span></span>
              <span>ICP: <span className="text-slate-400">{campaign.icp.label}</span></span>
              <span>Daily limit: <span className="text-slate-400">{campaign.dailyLimit} actions</span></span>
            </div>
          </div>

          {/* Prominent pause/resume, per the control-plane requirement. */}
          <Button
            variant={campaign.status === "live" ? "warn" : "primary"}
            onClick={() =>
              setCampaignStatus(campaign.id, campaign.status === "live" ? "paused" : "live")
            }
          >
            {campaign.status === "live" ? "❚❚ Pause campaign" : "▶ Activate campaign"}
          </Button>
        </div>
      </div>

      {campaign.status === "draft" && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-xs text-slate-400">
          This campaign is in <span className="text-slate-200">Draft</span>. Agents will not
          discover, contact or follow up with anyone until it is activated.
        </div>
      )}

      <nav className="flex gap-1 border-b border-slate-800">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm transition-colors ${
              tab === t
                ? "border-emerald-400 font-medium text-slate-100"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Overview" && (
        <OverviewTab campaign={campaign} metrics={metrics} activity={campaignActivity} campaigns={campaigns} />
      )}
      {tab === "Prospects" && <ProspectsTab prospects={campaignProspects} />}
      {tab === "Activity" && (
        <Card title={`Agent activity · ${campaignActivity.length} events`}>
          <ActivityFeed events={campaignActivity} campaigns={campaigns} height="h-[560px]" />
        </Card>
      )}
      {tab === "AI Harness" && <HarnessTab campaign={campaign} />}
      {tab === "Knowledge" && <KnowledgeTab campaign={campaign} />}
      {tab === "Settings" && <SettingsTab campaign={campaign} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function OverviewTab({
  campaign,
  metrics,
  activity,
  campaigns,
}: {
  campaign: Campaign;
  metrics: ReturnType<typeof metricsFor>;
  activity: ActivityEvent[];
  campaigns: Campaign[];
}) {
  const toggleAgentPause = useSdr((s) => s.toggleAgentPause);
  const toggleChannelPause = useSdr((s) => s.toggleChannelPause);
  const liveAgents = useSdr((s) => s.liveAgents);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Prospects" value={metrics.prospects} />
        <Stat label="Outreach sent" value={metrics.outreach} />
        <Stat label="Replies handled" value={metrics.replies} />
        <Stat label="Meetings" value={metrics.meetings} tone="good" />
        <Stat
          label="Escalations"
          value={metrics.escalations}
          tone={metrics.escalations ? "warn" : "default"}
        />
      </div>

      <Card title="Prospect funnel">
        <Funnel funnel={metrics.funnel} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Agents">
          <div className="space-y-2">
            {AGENTS.map((def) => {
              const cfg = campaign.agents.find((a) => a.key === def.key);
              if (!cfg) return null;
              const running = cfg.enabled && !cfg.paused && campaign.status === "live";
              return (
                <div
                  key={def.key}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          running ? "live-dot bg-emerald-400" : cfg.enabled ? "bg-amber-400" : "bg-slate-700"
                        }`}
                      />
                      <span className="text-sm text-slate-200">{def.name}</span>
                      {liveAgents.includes(def.key) ? (
                        <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1 py-0.5 text-[9px] font-medium text-violet-300">
                          DronaHQ
                        </span>
                      ) : (
                        <span className="text-[9px] text-slate-700">simulated</span>
                      )}
                      {!cfg.enabled && (
                        <span className="text-[10px] text-slate-600">disabled for this campaign</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
                      {def.responsibility}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!cfg.enabled}
                    onClick={() => toggleAgentPause(campaign.id, def.key)}
                    title="Pause this agent while the rest of the campaign continues"
                  >
                    {cfg.paused ? "▶" : "❚❚"}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Channels">
            <div className="space-y-2">
              {(Object.keys(campaign.channels) as Channel[]).map((ch) => {
                const cfg = campaign.channels[ch];
                return (
                  <div
                    key={ch}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <ChannelTag channel={ch} muted={!cfg.enabled || cfg.paused} />
                      <span className="text-[11px] text-slate-600">
                        {!cfg.enabled ? "not configured" : cfg.paused ? "paused" : "active"}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!cfg.enabled}
                      onClick={() => toggleChannelPause(campaign.id, ch)}
                      title="Stop activity on this channel only"
                    >
                      {cfg.paused ? "▶" : "❚❚"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Targeting">
            <dl className="space-y-2 text-xs">
              <Row label="Geography" value={campaign.icp.geography} />
              <Row label="Target roles" value={campaign.icp.targetRoles.join(", ")} />
              <Row label="Company criteria" value={campaign.icp.companyCriteria} />
              <Row label="Exclusions" value={campaign.icp.exclusions} />
            </dl>
          </Card>
        </div>
      </div>

      <Card title="Live agent activity">
        <ActivityFeed events={activity.slice(0, 40)} campaigns={campaigns} height="h-[300px]" />
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-slate-600">{label}</dt>
      <dd className="text-slate-300">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

const STAGE_LABEL: Record<Stage, string> = {
  discovered: "Discovered",
  researched: "Researched",
  qualified: "Qualified",
  contacted: "Contacted",
  engaged: "Engaged",
  meeting: "Meeting",
  opportunity: "Opportunity",
};

function Funnel({ funnel }: { funnel: ReturnType<typeof metricsFor>["funnel"] }) {
  const top = Math.max(funnel.discovered, 1);
  return (
    <div className="space-y-1.5">
      {STAGES.map((stage) => {
        const count = funnel[stage];
        const pct = Math.round((count / top) * 100);
        return (
          <div key={stage} className="flex items-center gap-3">
            <div className="w-24 shrink-0 text-xs text-slate-500">{STAGE_LABEL[stage]}</div>
            <div className="h-6 flex-1 overflow-hidden rounded bg-slate-950">
              <div
                className="flex h-full items-center bg-gradient-to-r from-emerald-500/50 to-emerald-400/25 px-2 transition-all duration-500"
                style={{ width: `${Math.max(pct, count > 0 ? 6 : 0)}%` }}
              >
                {count > 0 && (
                  <span className="text-[11px] font-medium tabular-nums text-emerald-100">
                    {count}
                  </span>
                )}
              </div>
            </div>
            <div className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-600">
              {pct}%
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-3 pt-1">
        <div className="w-24 shrink-0 text-xs text-slate-600">Rejected</div>
        <div className="flex-1 text-xs text-slate-600">
          {funnel.rejected} prospects removed by the ICP Fitment Agent
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProspectsTab({ prospects }: { prospects: Prospect[] }) {
  if (!prospects.length) {
    return <EmptyState title="No prospects yet" hint="Activate the campaign to start discovery." />;
  }

  const order = [...prospects].sort((a, b) => {
    const rank = (p: Prospect) => (p.state === "rejected" ? -1 : STAGES.indexOf(p.state));
    return rank(b) - rank(a);
  });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-900/60 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="px-4 py-2.5 font-medium">Prospect</th>
            <th className="px-4 py-2.5 font-medium">Company</th>
            <th className="px-4 py-2.5 font-medium">Stage</th>
            <th className="px-4 py-2.5 font-medium">Fit</th>
            <th className="px-4 py-2.5 font-medium">Channels</th>
            <th className="px-4 py-2.5 font-medium">Last agent action</th>
          </tr>
        </thead>
        <tbody>
          {order.map((p) => (
            <tr key={p.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/40">
              <td className="px-4 py-2.5">
                <div className="text-slate-200">{p.name}</div>
                <div className="text-xs text-slate-600">{p.title}</div>
              </td>
              <td className="px-4 py-2.5">
                <div className="text-slate-300">{p.company}</div>
                <div className="text-xs text-slate-600">{p.location}</div>
              </td>
              <td className="px-4 py-2.5">
                <StageBadge state={p.state} />
              </td>
              <td className="px-4 py-2.5">
                <FitScore score={p.fitScore} />
              </td>
              <td className="px-4 py-2.5">
                <div className="flex gap-1">
                  {p.touched.length ? (
                    p.touched.map((c) => <ChannelTag key={c} channel={c} />)
                  ) : (
                    <span className="text-xs text-slate-700">—</span>
                  )}
                </div>
              </td>
              <td className="max-w-xs px-4 py-2.5">
                {/* Shows the research chain is real: once the Research Agent
                    has produced a brief, every downstream agent writes from it. */}
                {p.researchBrief && (
                  <span
                    title={p.researchBrief.slice(0, 600)}
                    className="mb-1 inline-block cursor-help rounded border border-cyan-500/30 bg-cyan-500/10 px-1 py-0.5 text-[9px] font-medium text-cyan-300"
                  >
                    ⧉ Research brief
                  </span>
                )}
                <span className="line-clamp-2 text-xs text-slate-500">{p.lastAction}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StageBadge({ state }: { state: Prospect["state"] }) {
  if (state === "rejected") {
    return (
      <span className="rounded border border-slate-700 bg-slate-800/40 px-1.5 py-0.5 text-[10px] text-slate-500">
        Rejected
      </span>
    );
  }
  const depth = STAGES.indexOf(state);
  const tone =
    depth >= 5
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : depth >= 3
        ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
        : "border-slate-700 bg-slate-800/50 text-slate-400";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
      {STAGE_LABEL[state]}
    </span>
  );
}

function FitScore({ score }: { score: number }) {
  if (!score) return <span className="text-xs text-slate-700">—</span>;
  const tone = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-rose-400";
  return <span className={`text-sm font-medium tabular-nums ${tone}`}>{score}</span>;
}

// ---------------------------------------------------------------------------

function SettingsTab({ campaign }: { campaign: Campaign }) {
  const setCampaignStatus = useSdr((s) => s.setCampaignStatus);
  const active = campaign.versions.find((v) => v.id === campaign.activeVersionId);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Campaign-level configuration">
        <dl className="space-y-2 text-xs">
          <Row label="Name" value={campaign.name} />
          <Row label="Owner" value={campaign.owner} />
          <Row label="ICP" value={campaign.icp.label} />
          <Row label="Geography" value={campaign.icp.geography} />
          <Row label="Target roles" value={campaign.icp.targetRoles.join(", ")} />
          <Row label="Company criteria" value={campaign.icp.companyCriteria} />
          <Row label="Exclusions" value={campaign.icp.exclusions} />
          <Row label="Daily limit" value={`${campaign.dailyLimit} autonomous actions`} />
          <Row label="Active harness" value={active ? `v${active.version} — ${active.note}` : "—"} />
        </dl>
      </Card>

      <div className="space-y-4">
        <Card title="Lifecycle">
          <p className="mb-3 text-xs text-slate-500">
            Draft → Live → Paused → Completed / Archived. Completed and archived campaigns keep
            their full history, decisions and analytics.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setCampaignStatus(campaign.id, "draft")}>
              Move to Draft
            </Button>
            <Button size="sm" variant="primary" onClick={() => setCampaignStatus(campaign.id, "live")}>
              Activate
            </Button>
            <Button size="sm" variant="warn" onClick={() => setCampaignStatus(campaign.id, "paused")}>
              Pause
            </Button>
            <Button size="sm" onClick={() => setCampaignStatus(campaign.id, "completed")}>
              Mark Completed
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCampaignStatus(campaign.id, "archived")}>
              Archive
            </Button>
          </div>
        </Card>

        <Card title="Global configuration (platform-wide)">
          <p className="text-xs leading-relaxed text-slate-500">
            Authentication, integration credentials, available models and tools, the global
            suppression / do-not-contact list and platform guardrails are managed once at the
            platform level and shared by every campaign. They are intentionally not editable
            here: a campaign owner cannot weaken a platform-wide guardrail.
          </p>
        </Card>
      </div>
    </div>
  );
}
