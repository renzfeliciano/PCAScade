"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PresentationState } from "@/modules/presentation/domain/state-types";

const POLL_MS = 1000;
const OFFSET_JITTER_MS = 40;

type Stage = { state: PresentationState; offsetMs: number; online: boolean };

const StageContext = createContext<Stage | null>(null);

export function useStage(): Stage {
  const stage = useContext(StageContext);
  if (!stage) throw new Error("useStage must be used inside StageProvider");
  return stage;
}

export function screenPath(state: PresentationState): string {
  const base = `/presentation/${state.event.slug}`;
  switch (state.screen) {
    case "PRIZES":
      return `${base}/prizes`;
    case "DRAW":
      return state.current ? `${base}/draw/${state.current.prizeId}` : base;
    case "WINNER_WALL":
      return `${base}/winner-wall`;
    case "RECAP":
      return `${base}/recap`;
    default:
      return base;
  }
}

let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | undefined;
const clockListeners = new Set<() => void>();

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  clockNow = Date.now();
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const notify of clockListeners) notify();
    }, 100);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

export function useServerNow(): number | null {
  const { offsetMs } = useStage();
  const now = useSyncExternalStore(
    subscribeClock,
    () => clockNow,
    () => 0,
  );
  return now === 0 ? null : now + offsetMs;
}

export function StageProvider({ initial, children }: { initial: PresentationState; children: ReactNode }) {
  const [state, setState] = useState(initial);
  const [offsetMs, setOffsetMs] = useState(0);
  const [online, setOnline] = useState(true);
  const etag = useRef<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const follow = useSearchParams().get("follow") !== "0";
  const slug = initial.event.slug;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const started = Date.now();
      try {
        const response = await fetch(`/api/presentation/${slug}/state`, {
          cache: "no-store",
          headers: etag.current ? { "If-None-Match": etag.current } : {},
        });
        const ended = Date.now();
        const serverNow = Number(response.headers.get("x-server-now"));
        if (Number.isFinite(serverNow) && serverNow > 0) {
          const measured = serverNow - (started + ended) / 2;
          setOffsetMs((previous) => (Math.abs(previous - measured) > OFFSET_JITTER_MS ? measured : previous));
        }
        if (response.status === 200) {
          etag.current = response.headers.get("etag");
          const next = (await response.json()) as PresentationState;
          if (!stopped) setState(next);
        }
        if (!stopped) setOnline(response.status === 200 || response.status === 304);
      } catch {
        if (!stopped) setOnline(false);
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [slug]);

  const target = screenPath(state);
  useEffect(() => {
    if (follow && target !== pathname) router.replace(target);
  }, [follow, target, pathname, router]);

  return <StageContext.Provider value={{ state, offsetMs, online }}>{children}</StageContext.Provider>;
}

export function ConnectionBadge() {
  const { online } = useStage();
  if (online) return null;
  return (
    <p role="status" className="fixed right-4 bottom-4 z-50 rounded-md border border-border bg-background/85 px-3 py-1.5 text-sm text-muted-foreground backdrop-blur">
      Reconnecting…
    </p>
  );
}
