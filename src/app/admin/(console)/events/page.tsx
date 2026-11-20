import type { Metadata } from "next";
import Link from "next/link";
import { accentHex, formatEventDate } from "@/components/brand/event-accent";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { EVENT_STATUS_LABELS, isPublicStatus } from "@/modules/events/domain/event-rules";
import { listEventsForAdmin } from "@/modules/events/server/events";

export const metadata: Metadata = { title: "Events" };

export default async function AdminEventsPage() {
  await requireAdmin();
  const events = await listEventsForAdmin(db());
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-sm text-muted-foreground">Each event owns its participants, prizes, draws and presentation settings.</p>
        </div>
        <Link href="/admin/events/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          New event
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          No events yet. Create the first one to start preparing a raffle.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Visibility</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Link href={`/admin/events/${event.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: accentHex(event.accent) }} aria-hidden="true" />
                      {event.name}
                    </Link>
                    {event.venue ? <span className="block text-xs text-muted-foreground">{event.venue}</span> : null}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{formatEventDate(event.startsAt) ?? "Not set"}</TableCell>
                  <TableCell>
                    <Badge variant={event.status === "LIVE" ? "default" : "secondary"}>{EVENT_STATUS_LABELS[event.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{isPublicStatus(event.status) ? "Public" : "Hidden"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
