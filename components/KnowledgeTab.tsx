"use client";

import { useRef, useState } from "react";
import { useSdr } from "@/lib/store";
import { CHUNK_KINDS, type Campaign, type ChunkKind, type KnowledgeChunk } from "@/lib/types";
import { Button, Card, EmptyState } from "./ui";

/**
 * The corpus the agents retrieve from, per campaign.
 *
 * The campaign already owned its prompts, policy and targeting; this is the
 * knowledge those prompts kept referring to. Everything here is scoped to one
 * campaign, with the platform-wide corpus listed read-only underneath so an
 * operator can see what a campaign inherits before adding to it.
 *
 * Uploads are parsed in the browser and only their text is sent: no file is
 * ever stored, which is why this needs no blob storage and works unchanged on
 * a serverless deploy.
 */

const KIND_LABEL: Record<ChunkKind, string> = {
  product: "Product",
  case_study: "Case study",
  playbook: "Playbook",
  objection: "Objection",
  example_email: "Example email",
  voice_script: "Voice script",
  icp_definition: "ICP definition",
};

const KIND_STYLE: Record<ChunkKind, string> = {
  product: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  case_study: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
  playbook: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  objection: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  example_email: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  voice_script: "border-teal-500/30 bg-teal-500/10 text-teal-300",
  icp_definition: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
};

/** Which agents draw on each kind, so an operator knows what they are feeding. */
const KIND_CONSUMERS: Record<ChunkKind, string> = {
  product: "Personalisation, Research",
  case_study: "Personalisation",
  playbook: "Follow-up, Personalisation",
  objection: "Conversation",
  example_email: "Personalisation, Follow-up",
  voice_script: "Voice SDR",
  icp_definition: "Research",
};

export default function KnowledgeTab({ campaign }: { campaign: Campaign }) {
  const knowledge = useSdr((s) => s.knowledge);
  const addKnowledge = useSdr((s) => s.addKnowledge);
  const deleteKnowledge = useSdr((s) => s.deleteKnowledge);

  const mine = knowledge.filter((k) => k.campaignId === campaign.id);
  const platform = knowledge.filter((k) => k.campaignId === null);

  return (
    <div className="space-y-5">
      <AddChunk
        onAdd={(input) => addKnowledge({ ...input, campaignId: campaign.id })}
        campaignName={campaign.name}
      />

      <Card title={`Campaign knowledge · ${mine.length} ${mine.length === 1 ? "entry" : "entries"}`}>
        {mine.length ? (
          <div className="space-y-2">
            {mine.map((k) => (
              <ChunkRow key={k.id} chunk={k} onDelete={() => deleteKnowledge(k.id)} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No campaign knowledge yet"
            hint="Agents fall back to their own DronaHQ knowledge bases until something is added here."
          />
        )}
      </Card>

      {platform.length > 0 && (
        <Card title={`Platform knowledge · ${platform.length} shared by every campaign`}>
          <div className="space-y-2">
            {platform.map((k) => (
              <ChunkRow key={k.id} chunk={k} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ChunkRow({ chunk, onDelete }: { chunk: KnowledgeChunk; onDelete?: () => void }) {
  return (
    <details className="group rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${KIND_STYLE[chunk.kind]}`}
        >
          {KIND_LABEL[chunk.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-slate-300">{chunk.title}</span>
        <span className="hidden text-[10px] text-slate-600 sm:inline">{chunk.source}</span>
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onDelete();
            }}
            title="Remove from the campaign knowledge base"
            className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition-colors hover:border-rose-500/50 hover:text-rose-300"
          >
            Remove
          </button>
        )}
      </summary>
      <pre className="mt-2 whitespace-pre-wrap border-t border-slate-800 pt-2 font-sans text-[12px] leading-relaxed text-slate-400">
        {chunk.content}
      </pre>
      <p className="mt-1.5 text-[10px] text-slate-600">
        Retrieved by: {KIND_CONSUMERS[chunk.kind]} · source: {chunk.source}
      </p>
    </details>
  );
}

function AddChunk({
  onAdd,
  campaignName,
}: {
  onAdd: (input: { kind: ChunkKind; title: string; content: string; source: string }) => void;
  campaignName: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ChunkKind>("objection");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const valid = title.trim() && content.trim();

  function reset() {
    setTitle("");
    setContent("");
    setSource("");
    setKind("objection");
  }

  /**
   * Read a text file in the browser and keep only its contents.
   *
   * The file itself is never uploaded or stored anywhere: the corpus holds
   * text, so there is nothing to gain from keeping the original and a blob
   * store to run if we did.
   */
  async function onFile(file: File) {
    const text = await file.text();
    setContent(text);
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
    setSource(`uploaded · ${file.name}`);
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          + Add knowledge
        </Button>
        <span className="text-[11px] text-slate-600">
          Retrieved by agents before they write anything for {campaignName}.
        </span>
      </div>
    );
  }

  return (
    <Card title="Add to campaign knowledge">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-slate-500">Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ChunkKind)}
              className={inputCls}
            >
              {CHUNK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]} — {KIND_CONSUMERS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-slate-500">
              Title<span className="ml-0.5 text-rose-400">*</span>
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. DACH data residency objection"
              className={inputCls}
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] text-slate-500">
            Content<span className="ml-0.5 text-rose-400">*</span>
            <span className="ml-2 text-slate-700">Paste, or upload a .md / .txt file</span>
          </span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={7}
            placeholder="What should an agent know before it writes or replies?"
            className={`${inputCls} resize-y font-sans leading-relaxed`}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".md,.txt,.markdown,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
            ↑ Upload .md / .txt
          </Button>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Source (optional) — e.g. sales playbook v3"
            className={`${inputCls} max-w-xs`}
          />
        </div>

        <div className="flex items-center gap-3 border-t border-slate-800 pt-3">
          <Button
            variant="primary"
            size="sm"
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              onAdd({ kind, title, content, source });
              reset();
              setOpen(false);
            }}
          >
            Save to knowledge base
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          {!valid && <span className="text-[11px] text-slate-600">Title and content required.</span>}
        </div>
      </div>
    </Card>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300 outline-none placeholder:text-slate-700 focus:border-emerald-500/40";
