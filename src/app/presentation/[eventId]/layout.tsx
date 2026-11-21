import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandLockup } from "@/components/brand/brand-mark";
import { accentStyle } from "@/components/brand/event-accent";
import { db } from "@/lib/db";
import { presentationState } from "@/modules/presentation/server/state";
import { FullscreenButton } from "../fullscreen-button";
import { ConnectionBadge, StageProvider } from "./stage-provider";

export const dynamic = "force-dynamic";

const SLUG_OR_ID = /^[a-z0-9-]{1,80}$/;

async function loadState(eventId: string) {
  return SLUG_OR_ID.test(eventId) ? presentationState(db(), eventId) : null;
}

export async function generateMetadata({ params }: LayoutProps<"/presentation/[eventId]">): Promise<Metadata> {
  const { eventId } = await params;
  const state = await loadState(eventId);
  return { title: state?.event.name ?? "Presentation" };
}

export default async function PresentationEventLayout({ params, children }: LayoutProps<"/presentation/[eventId]">) {
  const { eventId } = await params;
  const state = await loadState(eventId);
  if (!state) notFound();

  return (
    <div style={accentStyle(state.event.accent)} className="blueprint-grid relative flex flex-1 flex-col">
      <div className="h-3 bg-[repeating-linear-gradient(-45deg,var(--event-accent)_0_18px,oklch(0.18_0.01_250)_18px_36px)]" aria-hidden="true" />
      <header className="flex items-center justify-between px-[4vw] py-[3vh]">
        <BrandLockup />
        <FullscreenButton />
      </header>
      <StageProvider initial={state}>
        {children}
        <ConnectionBadge />
      </StageProvider>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[22vh] bg-gradient-to-t from-black/50 to-transparent" aria-hidden="true" />
    </div>
  );
}
