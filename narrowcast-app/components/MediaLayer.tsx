"use client";

import { useEffect, useRef } from "react";
import type { PlaylistItem } from "@/lib/types";

/**
 * One slide. Every layer stays mounted while it is "current" or "next", so the
 * browser has already fetched/decoded the media when it becomes visible.
 */
export default function MediaLayer({ item, active }: { item: PlaylistItem; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [active]);

  return (
    <div
      className="absolute inset-0 transition-opacity duration-500"
      style={{ opacity: active ? 1 : 0 }}
      aria-hidden={!active}
    >
      {item.type === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" decoding="async" className="h-full w-full object-contain" />
      )}
      {item.type === "video" && (
        <video
          ref={videoRef}
          src={item.url}
          muted
          loop
          playsInline
          preload="auto"
          className="h-full w-full object-contain"
        />
      )}
      {item.type === "url" && (
        <iframe src={item.url} title={item.id} className="h-full w-full border-0 bg-white" tabIndex={-1} />
      )}
    </div>
  );
}
