import type { Metadata } from "next";
import { EventCard } from "@/components/events/event-card";
import { db } from "@/lib/db";
import { listPublicEvents } from "@/modules/events/server/events";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Events" };

export default async function EventsPage() {
  const events = await listPublicEvents(db());
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 text-3xl font-extrabold">Events</h1>
      <p className="mb-8 text-muted-foreground">Raffle events that are published, live or recently closed.</p>
      {events.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">No events are published yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventCard key={event.slug} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
