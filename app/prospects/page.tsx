"use client";

import Link from "next/link";
import { useState } from "react";
import { findConflicts, useSdr } from "@/lib/store";
import { STAGES } from "@/lib/types";
import type { Prospect } from "@/lib/types";
import { Card, ChannelTag, EmptyState } from "@/components/ui";

export default function ProspectsPage() {
  const campaigns = useSdr((s) => s.campaigns);
  const prospects = useSdr((s) => s.prospects);
  const [query, setQuery] = useState("");
  const [campaignId, setCampaignId] = useState("all");

  const conflicts = findConflicts(prospects, campaigns);
  const conflictedEmails = new Set(conflicts.map((c) => c.email));

  const q = query.trim().toLowerCase();
  const rows = prospects
    .filter((p) => campaignId === "all" || p.campaignId === campaignId)
    .filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.company.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q),
    )
    .sort((a, b) => rank(b) - rank(a));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Prospects</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every prospect across every campaign. {conflicts.length} appear in more than one
          campaign.
        </p>
      </div>

      <Card
        title={`${rows.length} prospects`}
        action={
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, company, title…"
              className="w-56 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-300 outline-none placeholder:text-slate-700 focus:border-emerald-500/40"
            />
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
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No prospects match this filter" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-4 font-medium">Prospect</th>
                  <th className="py-2 pr-4 font-medium">Company</th>
                  <th className="py-2 pr-4 font-medium">Campaign</th>
                  <th className="py-2 pr-4 font-medium">Stage</th>
                  <th className="py-2 pr-4 font-medium">Fit</th>
                  <th className="py-2 pr-4 font-medium">Touched</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const campaign = campaigns.find((c) => c.id === p.campaignId);
                  return (
                    <tr key={p.id} className="border-b border-slate-800/50 last:border-0">
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-200">{p.name}</span>
                          {conflictedEmails.has(p.email) && (
                            <span
                              title="This person is targeted by more than one campaign"
                              className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-300"
                            >
                              DUPLICATE
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-600">{p.title}</div>
                      </td>
                      <td className="py-2 pr-4 text-slate-300">{p.company}</td>
                      <td className="py-2 pr-4">
                        {campaign && (
                          <Link
                            href={`/campaigns/${campaign.id}`}
                            className="text-xs text-slate-400 hover:text-emerald-300"
                          >
                            {campaign.name}
                          </Link>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-400 capitalize">{p.state}</td>
                      <td className="py-2 pr-4 tabular-nums text-slate-400">
                        {p.fitScore || "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex gap-1">
                          {p.touched.length ? (
                            p.touched.map((c) => <ChannelTag key={c} channel={c} />)
                          ) : (
                            <span className="text-xs text-slate-700">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function rank(p: Prospect) {
  return p.state === "rejected" ? -1 : STAGES.indexOf(p.state);
}
