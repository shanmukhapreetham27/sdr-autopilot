"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSdr } from "@/lib/store";
import type { Channel } from "@/lib/types";
import { Button, Card, CHANNEL_META } from "@/components/ui";

const ALL_CHANNELS: Channel[] = ["email", "linkedin", "sms", "voice"];

export default function NewCampaignPage() {
  const router = useRouter();
  const createCampaign = useSdr((s) => s.createCampaign);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icpLabel, setIcpLabel] = useState("");
  const [geography, setGeography] = useState("");
  const [roles, setRoles] = useState("");
  const [companyCriteria, setCompanyCriteria] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [channels, setChannels] = useState<Channel[]>(["email"]);
  const [dailyLimit, setDailyLimit] = useState(40);
  const [systemPrompt, setSystemPrompt] = useState(
    "You are an autonomous SDR. Be specific and concise. Never claim anything you cannot source from the campaign knowledge base. Escalate pricing, legal and security questions to a human rep.",
  );

  const valid = name.trim() && icpLabel.trim() && channels.length > 0;

  function submit() {
    if (!valid) return;
    const id = createCampaign({
      name: name.trim(),
      description: description.trim() || "No description provided.",
      owner: "Priya Nair",
      icp: {
        label: icpLabel.trim(),
        geography: geography.trim() || "Global",
        targetRoles: roles
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        companyCriteria: companyCriteria.trim() || "Not specified",
        exclusions: exclusions.trim() || "None",
      },
      channels,
      dailyLimit,
      systemPrompt,
    });
    router.push(`/campaigns/${id}`);
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/campaigns" className="text-xs text-slate-500 hover:text-slate-300">
          ← All campaigns
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-100">New campaign</h1>
        <p className="mt-1 text-sm text-slate-500">
          Campaigns are created in Draft. Agents will not contact anyone until you activate it.
        </p>
      </div>

      <Card title="Identity">
        <div className="space-y-3">
          <Field label="Campaign name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. EU Fintech CTO Outreach"
              className={inputCls}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What is this campaign trying to achieve?"
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      <Card title="Targeting (ICP)">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ICP label" required>
              <input
                value={icpLabel}
                onChange={(e) => setIcpLabel(e.target.value)}
                placeholder="e.g. EU Fintech CTO"
                className={inputCls}
              />
            </Field>
            <Field label="Geography">
              <input
                value={geography}
                onChange={(e) => setGeography(e.target.value)}
                placeholder="e.g. Germany, France, Netherlands"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Target roles" hint="Comma separated">
            <input
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
              placeholder="CTO, VP Engineering, Head of Platform"
              className={inputCls}
            />
          </Field>
          <Field label="Company criteria">
            <input
              value={companyCriteria}
              onChange={(e) => setCompanyCriteria(e.target.value)}
              placeholder="e.g. Fintech, 100-2000 employees, Series B+"
              className={inputCls}
            />
          </Field>
          <Field label="Exclusion criteria" hint="The ICP agent rejects anything matching this">
            <input
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              placeholder="e.g. Crypto, agencies, existing customers"
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      <Card title="Channels & limits">
        <div className="space-y-3">
          <Field label="Channels" required>
            <div className="flex flex-wrap gap-2">
              {ALL_CHANNELS.map((ch) => {
                const on = channels.includes(ch);
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() =>
                      setChannels(on ? channels.filter((c) => c !== ch) : [...channels, ch])
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      on
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-800 bg-slate-950 text-slate-500 hover:border-slate-700"
                    }`}
                  >
                    {CHANNEL_META[ch].icon} {CHANNEL_META[ch].label}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Daily limit" hint="Maximum autonomous actions per day">
            <input
              type="number"
              min={1}
              max={500}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Number(e.target.value) || 1)}
              className={`${inputCls} max-w-32`}
            />
          </Field>
        </div>
      </Card>

      <Card title="Campaign system prompt">
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          spellCheck={false}
          className="w-full resize-y rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[12px] leading-relaxed text-slate-300 outline-none focus:border-emerald-500/40"
        />
        <p className="mt-2 text-[11px] text-slate-600">
          Saved as harness v1. Per-agent prompts start from the platform baseline and can be
          edited on the campaign&apos;s AI Harness tab.
        </p>
      </Card>

      <div className="flex items-center gap-3 pb-6">
        <Button variant="primary" onClick={submit} disabled={!valid}>
          Create campaign as Draft
        </Button>
        <Link href="/campaigns">
          <Button variant="ghost">Cancel</Button>
        </Link>
        {!valid && (
          <span className="text-xs text-slate-600">
            Name, ICP label and at least one channel are required.
          </span>
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300 outline-none placeholder:text-slate-700 focus:border-emerald-500/40";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-slate-500">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
        {hint && <span className="ml-2 text-slate-700">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
