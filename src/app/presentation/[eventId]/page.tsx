import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandLockup } from "@/components/brand/brand-mark";
import { accentStyle, formatEventDate } from "@/components/brand/event-accent";
import { db } from "@/lib/db";
import { getPresentableEvent } from "@/modules/events/server/events";
import { FullscreenButton } from "../fullscreen-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/presentation/[eventId]">): Promise<Metadata> {
  const { eventId } = await params;
  const event = await getPresentableEvent(db(), eventId);
  return { title: event?.name ?? "Presentation" };
}

export default async function PresentationLobby({ params }: PageProps<"/presentation/[eventId]">) {
  const { eventId } = await params;
  const event = await getPresentableEvent(db(), eventId);
  if (!event) notFound();
  const when = formatEventDate(event.startsAt);

  return (
    <div style={accentStyle(event.accent)} className="blueprint-grid relative flex flex-1 flex-col">
      <div className="h-3 bg-[repeating-linear-gradient(-45deg,var(--event-accent)_0_18px,oklch(0.18_0.01_250)_18px_36px)]" aria-hidden="true" />
      <header className="flex items-center justify-between px-[4vw] py-[3vh]">
        <BrandLockup />
        <FullscreenButton />
      </header>
      <main className="flex flex-1 flex-col justify-center gap-[3vh] px-[6vw] pb-[10vh]">
        <p className="text-[clamp(1rem,1.6vw,1.75rem)] font-semibold tracking-[0.25em] text-event-accent-ink uppercase">
          {event.status === "LIVE" ? "Live now" : "Starting soon"}
        </p>
        <h1 className="max-w-[18ch] text-[clamp(3rem,7vw,9rem)] leading-[0.95] font-extrabold [font-stretch:112%]">{event.name}</h1>
        {event.welcomeMessage ? <p className="max-w-[40ch] text-[clamp(1.25rem,2.4vw,2.75rem)] text-foreground/85">{event.welcomeMessage}</p> : null}
        <div className="flex flex-wrap gap-x-[4vw] gap-y-2 text-[clamp(1rem,1.5vw,1.75rem)] text-muted-foreground">
          {when ? <span>{when}</span> : null}
          {event.venue ? <span>{event.venue}</span> : null}
        </div>
      </main>
      <div className="absolute inset-x-0 bottom-0 h-[22vh] bg-gradient-to-t from-black/50 to-transparent" aria-hidden="true" />
    </div>
  );
}
