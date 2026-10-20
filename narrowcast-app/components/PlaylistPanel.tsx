"use client";

import { useState } from "react";
import type { MediaType, PlaylistItem } from "@/lib/types";

interface Props {
  items: PlaylistItem[];
  onAdd: (item: { type: MediaType; url: string; duration_seconds: number }) => Promise<void>;
  onToggle: (item: PlaylistItem) => Promise<void>;
  onDelete: (item: PlaylistItem) => Promise<void>;
  onMove: (item: PlaylistItem, dir: -1 | 1) => Promise<void>;
}

const TYPE_STYLE: Record<MediaType, string> = {
  image: "bg-blue-50 text-blue-700",
  video: "bg-violet-50 text-violet-700",
  url: "bg-amber-50 text-amber-700",
};

export default function PlaylistPanel({ items, onAdd, onToggle, onDelete, onMove }: Props) {
  const [type, setType] = useState<MediaType>("image");
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(10);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      await onAdd({ type, url: url.trim(), duration_seconds: duration });
      setUrl("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Afspeellijst</h2>
        <span className="text-xs text-slate-400">{items.filter((i) => i.is_active).length} actief</span>
      </div>

      <ul className="divide-y divide-slate-100">
        {items.length === 0 && <li className="py-6 text-center text-sm text-slate-400">Nog geen items.</li>}
        {items.map((it, i) => (
          <li key={it.id} className={`flex items-center gap-3 py-3 ${it.is_active ? "" : "opacity-50"}`}>
            <span className="w-5 text-center text-xs tabular-nums text-slate-400">{i + 1}</span>
            <div className="h-12 w-20 shrink-0 overflow-hidden rounded-md bg-slate-900">
              {it.type === "image" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{it.url}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                <span className={`rounded px-1.5 py-0.5 font-medium ${TYPE_STYLE[it.type]}`}>{it.type}</span>
                {it.duration_seconds}s
              </div>
            </div>
            <div className="flex items-center gap-1">
              <IconBtn label="Omhoog" disabled={i === 0} onClick={() => onMove(it, -1)}>↑</IconBtn>
              <IconBtn label="Omlaag" disabled={i === items.length - 1} onClick={() => onMove(it, 1)}>↓</IconBtn>
              <button
                type="button"
                onClick={() => onToggle(it)}
                className={`ml-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
                  it.is_active ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {it.is_active ? "Actief" : "Uit"}
              </button>
              <IconBtn label="Verwijderen" onClick={() => onDelete(it)}>✕</IconBtn>
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="mt-5 grid gap-2 border-t border-slate-100 pt-5 sm:grid-cols-[140px_1fr_90px_auto]">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as MediaType)}
          aria-label="Type"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="image">Afbeelding</option>
          <option value="video">Video</option>
          <option value="url">Webpagina</option>
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/afbeelding.jpg"
          aria-label="URL"
          required
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <input
          type="number"
          min={1}
          value={duration}
          onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))}
          aria-label="Duur in seconden"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <button
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Toevoegen
        </button>
      </form>
    </section>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="h-7 w-7 rounded-md text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
