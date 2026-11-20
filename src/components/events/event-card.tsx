import Link from "next/link";
import { accentStyle, formatEventDate } from "@/components/brand/event-accent";
import { Badge } from "@/components/ui/badge";
import { EVENT_STATUS_LABELS } from "@/modules/events/domain/event-rules";
import type { EventStatus } from "@/generated/prisma/enums";

export type PublicEventSummary = {
  slug: string;
  name: string;
  status: EventStatus;
  venue: string | null;
  accent: string;
  startsAt: Date | null;
  description: string | null;
};

export function EventCard({ event }: { event: PublicEventSummary }) {
  const when = formatEventDate(event.startsAt);
  return (
    <Link
      href={`/events/${event.slug}`}
      style={accentStyle(event.accent)}
      className="group relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-md border border-border bg-card p-5 transition-colors hover:border-event-accent/60"
    >
      <span className="absolute inset-x-0 top-0 h-1 bg-event-accent" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-bold leading-tight">{event.name}</h3>
        {event.status === "LIVE" ? <Badge className="bg-event-accent text-event-accent-fg">Live now</Badge> : null}
      </div>
      <dl className="grid gap-1 text-sm text-muted-foreground">
        {when ? (
          <div>
            <dt className="sr-only">Date</dt>
            <dd>{when}</dd>
          </div>
        ) : null}
        {event.venue ? (
          <div>
            <dt className="sr-only">Venue</dt>
            <dd>{event.venue}</dd>
          </div>
        ) : null}
        {event.status !== "LIVE" && event.status !== "PUBLISHED" ? (
          <div>
            <dt className="sr-only">Status</dt>
            <dd>{EVENT_STATUS_LABELS[event.status]}</dd>
          </div>
        ) : null}
      </dl>
      {event.description ? <p className="line-clamp-3 text-sm text-foreground/80">{event.description}</p> : null}
      <span className="mt-auto text-sm font-semibold text-event-accent-ink">View event →</span>
    </Link>
  );
}
