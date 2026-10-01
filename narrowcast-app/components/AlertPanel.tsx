"use client";

import { useState } from "react";
import type { Alert } from "@/lib/types";

const PRESETS = [
  "SGBO UPDATE: PERSALARM",
  "PERSCO UITGESTELD",
  "RUIMTE ONMIDDELLIJK VERLATEN",
];

interface Props {
  active: Alert | null;
  onPush: (message: string) => Promise<void>;
  onDeactivate: () => Promise<void>;
}

export default function AlertPanel({ active, onPush, onDeactivate }: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`rounded-2xl border p-6 transition-colors ${
        active ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Acuut alarm</h2>
        {active ? (
          <span className="flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> LIVE OP SCHERMEN
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">Geen alarm actief</span>
        )}
      </div>

      {active && (
        <p className="mb-4 rounded-lg bg-white px-4 py-3 text-lg font-bold uppercase text-red-700 ring-1 ring-red-200">
          {active.message}
        </p>
      )}

      <label htmlFor="alert-msg" className="sr-only">
        Alarmbericht
      </label>
      <input
        id="alert-msg"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Typ het alarmbericht…"
        maxLength={120}
        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200"
      />

      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setMessage(p)}
            className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
          >
            {p}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
        <button
          type="button"
          disabled={busy || !message.trim()}
          onClick={() =>
            run(async () => {
              await onPush(message.trim());
              setMessage("");
            })
          }
          className="rounded-xl bg-red-600 px-6 py-5 text-xl font-black uppercase tracking-wide text-white shadow-lg shadow-red-600/30 transition hover:bg-red-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          Verstuur alarm naar alle schermen
        </button>
        <button
          type="button"
          disabled={busy || !active}
          onClick={() => run(onDeactivate)}
          className="rounded-xl border border-slate-300 bg-white px-6 py-5 text-base font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Alarm uitzetten
        </button>
      </div>
    </section>
  );
}
