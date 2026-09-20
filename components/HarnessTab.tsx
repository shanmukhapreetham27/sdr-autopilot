"use client";

import { useMemo, useState } from "react";
import { useSdr } from "@/lib/store";
import { AGENTS } from "@/lib/types";
import type { AgentKey, Campaign } from "@/lib/types";
import { Button, Card } from "./ui";

/**
 * Prompt / harness management.
 *
 * Versions are immutable. Editing fills a local draft; saving writes a new
 * version and activates it. Older versions stay available for rollback, and
 * every agent action in the activity log records the version that produced it.
 */
export default function HarnessTab({ campaign }: { campaign: Campaign }) {
  const saveVersion = useSdr((s) => s.saveVersion);
  const activateVersion = useSdr((s) => s.activateVersion);

  const [selectedId, setSelectedId] = useState(campaign.activeVersionId);
  const [agentKey, setAgentKey] = useState<AgentKey>("personalisation");
  const [note, setNote] = useState("");

  const selected = useMemo(
    () => campaign.versions.find((v) => v.id === selectedId) ?? campaign.versions.at(-1)!,
    [campaign.versions, selectedId],
  );

  const [systemPrompt, setSystemPrompt] = useState(selected.systemPrompt);
  const [agentPrompts, setAgentPrompts] = useState<Record<AgentKey, string>>(selected.agentPrompts);

  // Loading a different version replaces the draft. Adjusted during render
  // rather than in an effect, so the editor never paints the old version's
  // text for a frame after switching.
  const [loadedId, setLoadedId] = useState(selected.id);
  if (loadedId !== selected.id) {
    setLoadedId(selected.id);
    setSystemPrompt(selected.systemPrompt);
    setAgentPrompts(selected.agentPrompts);
    setNote("");
  }

  const dirty =
    systemPrompt !== selected.systemPrompt ||
    AGENTS.some((a) => agentPrompts[a.key] !== selected.agentPrompts[a.key]);

  const isActive = selected.id === campaign.activeVersionId;
  const active = campaign.versions.find((v) => v.id === campaign.activeVersionId);

  const changedAgents = active
    ? AGENTS.filter((a) => agentPrompts[a.key] !== active.agentPrompts[a.key]).map((a) => a.key)
    : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card title="Versions">
        <div className="space-y-1.5">
          {[...campaign.versions].reverse().map((v) => {
            const isSel = v.id === selected.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedId(v.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  isSel
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-200">v{v.version}</span>
                  {v.id === campaign.activeVersionId && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-300">
                      Active
                    </span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">
                  {v.note}
                </p>
                <p className="mt-1 text-[10px] text-slate-600">
                  {v.author} · {new Date(v.createdAt).toLocaleString()}
                </p>
              </button>
            );
          })}
        </div>

        {!isActive && (
          <div className="mt-3 border-t border-slate-800 pt-3">
            <Button
              variant="primary"
              size="sm"
              onClick={() => activateVersion(campaign.id, selected.id)}
            >
              ↺ Roll back to v{selected.version}
            </Button>
            <p className="mt-1.5 text-[10px] leading-snug text-slate-600">
              Agents pick up the change on their next step. No other campaign is affected.
            </p>
          </div>
        )}
      </Card>

      <div className="space-y-4">
        {!isActive && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
            You are viewing <span className="font-medium">v{selected.version}</span>, which is not
            the active harness. Agents are currently running v{active?.version}.
          </div>
        )}

        <Card
          title="Campaign system prompt"
          action={
            <span className="text-[10px] text-slate-600">
              Applies to every agent in this campaign only
            </span>
          }
        >
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[12px] leading-relaxed text-slate-300 outline-none focus:border-emerald-500/40"
          />
        </Card>

        <Card title="Agent prompts">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {AGENTS.map((a) => {
              const enabled = campaign.agents.find((x) => x.key === a.key)?.enabled;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAgentKey(a.key)}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    agentKey === a.key
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700"
                  } ${enabled ? "" : "opacity-50"}`}
                >
                  {a.name.replace(" Agent", "")}
                  {changedAgents.includes(a.key) && (
                    <span className="ml-1 text-amber-400" title="Differs from the active version">
                      •
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="mb-2 text-[11px] text-slate-600">
            {AGENTS.find((a) => a.key === agentKey)?.responsibility}
          </p>

          <textarea
            value={agentPrompts[agentKey]}
            onChange={(e) => setAgentPrompts({ ...agentPrompts, [agentKey]: e.target.value })}
            rows={8}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[12px] leading-relaxed text-slate-300 outline-none focus:border-emerald-500/40"
          />
        </Card>

        <Card title="Save changes">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] flex-1">
              <label className="mb-1 block text-[11px] text-slate-500" htmlFor="version-note">
                What changed, and why
              </label>
              <input
                id="version-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Shortened the opener, banned invented metrics"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300 outline-none placeholder:text-slate-700 focus:border-emerald-500/40"
              />
            </div>
            <Button
              variant="primary"
              disabled={!dirty}
              onClick={() => {
                saveVersion(campaign.id, {
                  systemPrompt,
                  agentPrompts,
                  note,
                  author: "Priya Nair",
                });
                setNote("");
              }}
            >
              Save as v{Math.max(...campaign.versions.map((v) => v.version)) + 1} and activate
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-600">
            {dirty
              ? "Unsaved changes. Saving creates a new immutable version — the current one stays available for rollback."
              : "No changes to save."}
          </p>
        </Card>
      </div>
    </div>
  );
}
