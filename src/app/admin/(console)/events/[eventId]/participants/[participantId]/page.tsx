import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { listFieldDefinitions, toDefinitions } from "@/modules/participants/server/fields";
import { getParticipant } from "@/modules/participants/server/participants";
import { updateParticipantAction } from "../actions";
import { ParticipantForm } from "../participant-form";
import { PhotoPanel, StatusAndDelete } from "./participant-controls";

export const metadata: Metadata = { title: "Participant" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function toFormValues(custom: unknown): Record<string, string | string[]> {
  if (!custom || typeof custom !== "object") return {};
  return Object.fromEntries(
    Object.entries(custom as Record<string, unknown>).map(([key, value]) => [
      `custom:${key}`,
      Array.isArray(value) ? value.map(String) : typeof value === "boolean" ? (value ? "yes" : "no") : String(value),
    ]),
  );
}

export default async function ParticipantPage({ params }: PageProps<"/admin/events/[eventId]/participants/[participantId]">) {
  await requireAdmin();
  const { eventId, participantId } = await params;
  if (!UUID.test(participantId)) notFound();
  const database = db();
  const [participant, definitions] = await Promise.all([getParticipant(database, eventId, participantId), listFieldDefinitions(database, eventId)]);
  if (!participant) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <Link href={`/admin/events/${eventId}/participants`} className="text-sm text-muted-foreground hover:underline">
          ← Participants
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{participant.fullName}</h1>
        <p className="font-mono text-xs text-muted-foreground">{participant.externalId}</p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ParticipantForm
          action={updateParticipantAction.bind(null, eventId, participantId)}
          definitions={toDefinitions(definitions)}
          submitLabel="Save changes"
          initial={{
            externalId: participant.externalId,
            fullName: participant.fullName,
            department: participant.department ?? "",
            jobTitle: participant.jobTitle ?? "",
            bio: participant.bio ?? "",
            email: participant.email ?? "",
            eligible: participant.eligible ? "yes" : "no",
            ...toFormValues(participant.customValues),
          }}
        />
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Photo</CardTitle>
            </CardHeader>
            <CardContent>
              <PhotoPanel key={participant.photoId ?? "none"} eventId={eventId} participantId={participantId} photoId={participant.photoId} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Draw status</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusAndDelete key={participant.status} eventId={eventId} participantId={participantId} active={participant.status === "ACTIVE"} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
