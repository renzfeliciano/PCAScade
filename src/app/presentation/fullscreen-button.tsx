"use client";

import { useEffect, useState } from "react";

export function FullscreenButton() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const update = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setActive(Boolean(document.fullscreenElement));
    }
  }

  if (active) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-md border border-border bg-background/70 px-4 py-2 text-sm font-medium text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
    >
      Enter full screen
    </button>
  );
}
