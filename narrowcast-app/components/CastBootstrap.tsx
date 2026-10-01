"use client";

import { useEffect } from "react";

/**
 * Starts the Google Cast Web Receiver SDK, but only on an actual Cast device
 * (user agent contains "CrKey"), so the page also works in a normal browser.
 */
export default function CastBootstrap() {
  useEffect(() => {
    if (!/CrKey/i.test(navigator.userAgent)) return;
    const s = document.createElement("script");
    s.src = "//www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js";
    s.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cast = (window as any).cast;
      cast?.framework.CastReceiverContext.getInstance().start({ disableIdleTimeout: true });
    };
    document.head.appendChild(s);
  }, []);
  return null;
}
