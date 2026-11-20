import Link from "next/link";
import { accentHex, formatEventDate } from "@/components/brand/event-accent";
import { db } from "@/lib/db";
import { EVENT_STATUS_LABELS } from "@/modules/events/domain/event-rules";
import { listEventsForAdmin } from "@/modules/events/server/events";

export async function EventPicker({ title, description, suffix }: { title: string; description: string; suffix: string }) {
  const events = await listEventsForAdmin(db());
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {events.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          Create an event first. <Link href="/admin/events/new" className="font-semibold underline">New event</Link>
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/admin/events/${event.id}${suffix}`} className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card p-4 hover:border-foreground/30">
                <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: accentHex(event.accent) }} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{event.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {EVENT_STATUS_LABELS[event.status]} · {formatEventDate(event.startsAt) ?? "No date"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
