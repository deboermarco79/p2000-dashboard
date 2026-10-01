"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import CastBootstrap from "@/components/CastBootstrap";
import MediaLayer from "@/components/MediaLayer";
import { DEMO_PLAYLIST } from "@/lib/demo";
import { isDemo, supabase } from "@/lib/supabase";
import type { Alert, PlaylistItem } from "@/lib/types";

const POLL_MS = 15_000; // safety net next to Realtime

function Receiver() {
  const params = useSearchParams();
  const [items, setItems] = useState<PlaylistItem[]>(isDemo ? DEMO_PLAYLIST : []);
  const [currentId, setCurrentId] = useState<string | null>(null);

  // Alert overlay: message is kept while fading out.
  const [alertMsg, setAlertMsg] = useState("");
  const [alertOn, setAlertOn] = useState(false);
  const alertId = useRef<string | null>(null);

  const showAlert = useCallback((a: Pick<Alert, "id" | "message">) => {
    alertId.current = a.id;
    setAlertMsg(a.message);
    setAlertOn(true);
  }, []);
  const hideAlert = useCallback(() => {
    alertId.current = null;
    setAlertOn(false);
  }, []);

  // ── data ────────────────────────────────────────────────────────────
  const loadPlaylist = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("playlist")
      .select("*")
      .eq("is_active", true)
      .order("order_index", { ascending: true });
    if (data) setItems(data as PlaylistItem[]);
  }, []);

  const loadAlert = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("alerts")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return;
    if (data) showAlert(data as Alert);
    else hideAlert();
  }, [showAlert, hideAlert]);

  useEffect(() => {
    // Demo preview: /receiver?alert=SGBO%20UPDATE:%20PERSALARM
    const demoAlert = params.get("alert");
    if (isDemo && demoAlert) showAlert({ id: "demo", message: demoAlert });
  }, [params, showAlert]);

  useEffect(() => {
    if (!supabase) return;
    loadPlaylist();
    loadAlert();

    const channel = supabase
      .channel("receiver")
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist" }, () => loadPlaylist())
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, (payload) => {
        // Apply the payload directly for zero latency; no round trip needed.
        const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Partial<Alert>;
        if (payload.eventType !== "DELETE" && row.is_active && row.id && row.message != null) {
          showAlert({ id: row.id, message: row.message });
        } else if (row.id && row.id === alertId.current) {
          hideAlert();
        } else {
          loadAlert(); // e.g. DELETE payload without full row
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          loadPlaylist(); // resync after (re)connect
          loadAlert();
        }
      });

    const poll = setInterval(() => {
      loadPlaylist();
      loadAlert();
    }, POLL_MS);

    return () => {
      clearInterval(poll);
      supabase!.removeChannel(channel);
    };
  }, [loadPlaylist, loadAlert, showAlert, hideAlert]);

  // ── loop ────────────────────────────────────────────────────────────
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const idx = useMemo(() => {
    const i = items.findIndex((it) => it.id === currentId);
    return i >= 0 ? i : 0;
  }, [items, currentId]);

  const current = items[idx];
  const next = items.length > 1 ? items[(idx + 1) % items.length] : undefined;

  useEffect(() => {
    if (alertOn || !current) return; // loop is paused during an alert
    const t = setTimeout(() => {
      const list = itemsRef.current;
      const i = Math.max(0, list.findIndex((it) => it.id === current.id));
      setCurrentId(list[(i + 1) % list.length].id);
    }, current.duration_seconds * 1000);
    return () => clearTimeout(t);
  }, [current?.id, current?.duration_seconds, alertOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── render ──────────────────────────────────────────────────────────
  return (
    <main className="fixed inset-0 flex items-center justify-center bg-black">
      <CastBootstrap />
      <div
        className="relative overflow-hidden bg-black"
        style={{ width: "min(100vw, calc(100vh * 16 / 9))", aspectRatio: "16 / 9", containerType: "inline-size" }}
      >
        {/* current + next stay mounted; next is hidden but already loading */}
        {next && <MediaLayer key={next.id} item={next} active={false} />}
        {current && <MediaLayer key={current.id} item={current} active={!alertOn} />}

        {!current && (
          <div className="flex h-full items-center justify-center text-[2cqw] tracking-widest text-white/20">
            GEEN ACTIEVE ITEMS
          </div>
        )}

        {/* Alert overlay */}
        <div
          className={`alert-pulse absolute inset-0 z-10 flex flex-col items-center justify-center px-[6cqw] text-center transition-opacity duration-500 ${
            alertOn ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          role="alert"
          aria-hidden={!alertOn}
        >
          <div className="mb-[2cqw] text-[2.2cqw] font-bold uppercase tracking-[0.5cqw] text-white/80">
            ⚠ Alarm
          </div>
          <div className="alert-text-pulse text-[6.5cqw] font-black uppercase leading-[1.1] text-white">
            {alertMsg}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function ReceiverPage() {
  return (
    <Suspense fallback={<main className="fixed inset-0 bg-black" />}>
      <Receiver />
    </Suspense>
  );
}
