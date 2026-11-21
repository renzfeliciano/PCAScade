import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { isPublicStatus, toManilaInputValue } from "@/modules/events/domain/event-rules";
import { getEventForAdmin } from "@/modules/events/server/events";
import { parseParticipantDisplay, parsePresentationSettings } from "@/modules/presentation/domain/display";
import { updateEventAction } from "../actions";
import { DisplayForm } from "../display-form";
import { EventForm } from "../event-form";
import { StatusControls } from "../status-controls";

export const metadata: Metadata = { title: "Event" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function AdminEventPage({ params }: PageProps<"/admin/events/[eventId]">) {
  await requireAdmin();
  const { eventId } = await params;
  if (!UUID.test(eventId)) notFound();
  const event = await getEventForAdmin(db(), eventId);
  if (!event) notFound();

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-2xl font-bold">{event.name}</h1>
        <p className="font-mono text-xs text-muted-foreground">
          /{event.slug} · {event.id}
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Status and visibility</CardTitle>
          <CardDescription>
            {isPublicStatus(event.status) ? (
              <>
                Visible at{" "}
                <Link href={`/events/${event.slug}`} className="underline">
                  /events/{event.slug}
                </Link>
                .
              </>
            ) : (
              "Hidden from the public site."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StatusControls key={event.status} eventId={event.id} status={event.status} />
        </CardContent>
      </Card>

      <section className="grid gap-4">
        <h2 className="text-lg font-bold">Event details</h2>
        <EventForm
          action={updateEventAction.bind(null, event.id)}
          submitLabel="Save changes"
          initial={{
            name: event.name,
            description: event.description ?? "",
            venue: event.venue ?? "",
            welcomeMessage: event.welcomeMessage ?? "",
            accent: event.accent,
            startsAt: toManilaInputValue(event.startsAt),
          }}
        />
      </section>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Winner display and presentation</CardTitle>
          <CardDescription>Applies to the presentation screen, the winner wall and the public winners page.</CardDescription>
        </CardHeader>
        <CardContent>
          <DisplayForm eventId={event.id} display={parseParticipantDisplay(event.participantDisplay)} countdownSeconds={parsePresentationSettings(event.presentation).countdownSeconds} />
        </CardContent>
      </Card>
    </div>
  );
}
