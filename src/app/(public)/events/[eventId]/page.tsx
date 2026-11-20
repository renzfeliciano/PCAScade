import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { accentStyle, formatEventDate } from "@/components/brand/event-accent";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { EVENT_STATUS_LABELS } from "@/modules/events/domain/event-rules";
import { getPublicEventBySlug } from "@/modules/events/server/events";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/events/[eventId]">): Promise<Metadata> {
  const { eventId } = await params;
  const event = await getPublicEventBySlug(db(), eventId);
  return { title: event?.name ?? "Event not found" };
}

export default async function EventPage({ params }: PageProps<"/events/[eventId]">) {
  const { eventId } = await params;
  const event = await getPublicEventBySlug(db(), eventId);
  if (!event) notFound();
  const when = formatEventDate(event.startsAt);
  const presentable = event.status === "PUBLISHED" || event.status === "LIVE";

  return (
    <div style={accentStyle(event.accent)}>
      <section className="border-b border-border blueprint-grid">
        <div className="mx-auto grid max-w-4xl gap-5 px-4 py-14 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="border-event-accent text-event-accent-ink">
              {EVENT_STATUS_LABELS[event.status]}
            </Badge>
            {when ? <span className="text-sm text-muted-foreground">{when}</span> : null}
          </div>
          <h1 className="text-4xl font-extrabold leading-tight [font-stretch:108%] sm:text-5xl">{event.name}</h1>
          {event.venue ? <p className="text-lg text-muted-foreground">{event.venue}</p> : null}
          <div className="h-1 w-24 bg-event-accent" aria-hidden="true" />
        </div>
      </section>
      <div className="mx-auto grid max-w-4xl gap-8 px-4 py-12 sm:px-6">
        {event.welcomeMessage ? <p className="border-l-4 border-event-accent pl-4 text-xl font-medium">{event.welcomeMessage}</p> : null}
        {event.description ? <p className="max-w-[65ch] whitespace-pre-line text-foreground/85">{event.description}</p> : null}
        <div className="flex flex-wrap gap-3">
          {presentable ? (
            <Link
              href={`/presentation/${event.slug}`}
              className="inline-flex h-10 items-center rounded-md bg-event-accent px-5 text-sm font-semibold text-event-accent-fg hover:opacity-90"
            >
              Open presentation
            </Link>
          ) : null}
          <Link href="/events" className="inline-flex h-10 items-center rounded-md border border-border px-5 text-sm font-semibold hover:bg-secondary">
            All events
          </Link>
        </div>
      </div>
    </div>
  );
}
