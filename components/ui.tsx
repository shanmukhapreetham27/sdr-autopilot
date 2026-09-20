"use client";

import type { ReactNode } from "react";
import type { AgentKey, CampaignStatus, Channel, EventStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Small shared primitives. Kept in one file on purpose: these are layout
// helpers, not a design system, and scattering them makes the app harder to read.
// ---------------------------------------------------------------------------

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-800 bg-slate-900/40 ${className}`}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    default: "text-slate-100",
    good: "text-emerald-400",
    warn: "text-amber-400",
    bad: "text-rose-400",
  }[tone];
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<CampaignStatus, { dot: string; text: string; bg: string; label: string }> = {
  live: { dot: "bg-emerald-400", text: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/30", label: "Live" },
  paused: { dot: "bg-amber-400", text: "text-amber-300", bg: "bg-amber-500/10 border-amber-500/30", label: "Paused" },
  draft: { dot: "bg-slate-500", text: "text-slate-400", bg: "bg-slate-500/10 border-slate-600/40", label: "Draft" },
  completed: { dot: "bg-sky-400", text: "text-sky-300", bg: "bg-sky-500/10 border-sky-500/30", label: "Completed" },
  archived: { dot: "bg-slate-600", text: "text-slate-500", bg: "bg-slate-800/40 border-slate-700", label: "Archived" },
};

export function StatusPill({ status, size = "md" }: { status: CampaignStatus; size?: "sm" | "md" }) {
  const s = STATUS_STYLE[status];
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${pad} ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${status === "live" ? "live-dot" : ""}`} />
      {s.label}
    </span>
  );
}

export const CHANNEL_META: Record<Channel, { label: string; icon: string; color: string }> = {
  email: { label: "Email", icon: "✉", color: "text-sky-300 border-sky-500/30 bg-sky-500/10" },
  linkedin: { label: "LinkedIn", icon: "in", color: "text-indigo-300 border-indigo-500/30 bg-indigo-500/10" },
  sms: { label: "SMS", icon: "✆", color: "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-500/10" },
  voice: { label: "Voice", icon: "☎", color: "text-teal-300 border-teal-500/30 bg-teal-500/10" },
};

export function ChannelTag({ channel, muted = false }: { channel: Channel; muted?: boolean }) {
  const m = CHANNEL_META[channel];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
        muted ? "border-slate-700 bg-slate-800/40 text-slate-500" : m.color
      }`}
    >
      <span className="text-[9px] leading-none">{m.icon}</span>
      {m.label}
    </span>
  );
}

export const AGENT_LABEL: Record<AgentKey | "system", string> = {
  icp_fitment: "ICP Fitment",
  research: "Research",
  outreach_strategy: "Strategy",
  personalisation: "Personalisation",
  conversation: "Conversation",
  voice: "Voice SDR",
  followup: "Follow-up",
  system: "System",
};

const AGENT_COLOR: Record<AgentKey | "system", string> = {
  icp_fitment: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  research: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  outreach_strategy: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  personalisation: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  conversation: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  voice: "bg-teal-500/10 text-teal-300 border-teal-500/30",
  followup: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  system: "bg-slate-700/30 text-slate-400 border-slate-600/40",
};

export function AgentTag({ agent }: { agent: AgentKey | "system" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${AGENT_COLOR[agent]}`}
    >
      {AGENT_LABEL[agent]}
    </span>
  );
}

export function EventStatusDot({ status }: { status: EventStatus }) {
  const map: Record<EventStatus, { cls: string; title: string }> = {
    success: { cls: "bg-emerald-400", title: "Completed" },
    failed: { cls: "bg-rose-400", title: "Failed" },
    pending_approval: { cls: "bg-amber-400", title: "Waiting on human approval" },
  };
  const m = map[status];
  return <span title={m.title} className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${m.cls}`} />;
}

export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "warn" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
}) {
  const variants = {
    default: "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700",
    primary: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25",
    warn: "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25",
    danger: "border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25",
    ghost: "border-transparent bg-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200",
  }[variant];
  const sizes = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants} ${sizes}`}
    >
      {children}
    </button>
  );
}

/** Relative timestamp. Client-only, so it never mismatches server markup. */
export function timeAgo(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 px-6 py-10 text-center">
      <p className="text-sm text-slate-400">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
    </div>
  );
}
