"use client";

import { useCallback, useEffect, useState } from "react";
import AlertPanel from "@/components/AlertPanel";
import DeviceStatus from "@/components/DeviceStatus";
import PlaylistPanel from "@/components/PlaylistPanel";
import { DEMO_PLAYLIST } from "@/lib/demo";
import { isDemo, supabase } from "@/lib/supabase";
import type { Alert, MediaType, PlaylistItem } from "@/lib/types";

export default function Dashboard() {
  const [items, setItems] = useState<PlaylistItem[]>(isDemo ? DEMO_PLAYLIST : []);
  const [active, setActive] = useState<Alert | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [pl, al] = await Promise.all([
      supabase.from("playlist").select("*").order("order_index", { ascending: true }),
      supabase.from("alerts").select("*").eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (pl.error || al.error) setError((pl.error ?? al.error)!.message);
    else setError(null);
    if (pl.data) setItems(pl.data as PlaylistItem[]);
    setActive((al.data as Alert) ?? null);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    load();
    const channel = supabase
      .channel("dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, load)
      .subscribe();
    return () => {
      supabase!.removeChannel(channel);
    };
  }, [load]);

  /** Runs a Supabase write, surfaces errors; demo mode is read-only. */
  async function write(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    if (!supabase) {
      setError("Demo-modus: configureer Supabase in .env.local om wijzigingen op te slaan.");
      return;
    }
    const { error } = await fn();
    setError(error ? error.message : null);
    if (!error) load();
  }

  const pushAlert = (message: string) =>
    write(() => supabase!.from("alerts").insert({ message, is_active: true }));

  const deactivate = () =>
    write(() => supabase!.from("alerts").update({ is_active: false }).eq("is_active", true));

  const addItem = (i: { type: MediaType; url: string; duration_seconds: number }) =>
    write(() =>
      supabase!.from("playlist").insert({
        ...i,
        order_index: items.reduce((m, x) => Math.max(m, x.order_index), 0) + 1,
        is_active: true,
      }),
    );

  const toggle = (it: PlaylistItem) =>
    write(() => supabase!.from("playlist").update({ is_active: !it.is_active }).eq("id", it.id));

  const remove = (it: PlaylistItem) => write(() => supabase!.from("playlist").delete().eq("id", it.id));

  const move = async (it: PlaylistItem, dir: -1 | 1) => {
    const i = items.findIndex((x) => x.id === it.id);
    const other = items[i + dir];
    if (!other) return;
    // Swap order_index; if equal (legacy data) fall back to positional values.
    const a = it.order_index === other.order_index ? i + 1 : it.order_index;
    const b = it.order_index === other.order_index ? i + 1 + dir : other.order_index;
    await write(() => supabase!.from("playlist").update({ order_index: b }).eq("id", it.id));
    await write(() => supabase!.from("playlist").update({ order_index: a }).eq("id", other.id));
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-sm font-black text-white">N</div>
            <h1 className="text-lg font-semibold tracking-tight">Command Center</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <a href="/receiver" target="_blank" className="text-slate-500 hover:text-slate-900">
              Receiver openen ↗
            </a>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                isDemo ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {isDemo ? "Demo-modus" : "Supabase live"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[300px_1fr]">
        <aside>
          <DeviceStatus />
        </aside>
        <div className="space-y-6">
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}
          <AlertPanel active={active} onPush={pushAlert} onDeactivate={deactivate} />
          <PlaylistPanel items={items} onAdd={addItem} onToggle={toggle} onDelete={remove} onMove={move} />
        </div>
      </main>
    </div>
  );
}
