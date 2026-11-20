import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { listFieldDefinitions, toDefinitions } from "@/modules/participants/server/fields";
import { createParticipantAction } from "../actions";
import { ParticipantForm } from "../participant-form";

export const metadata: Metadata = { title: "Add participant" };

export default async function NewParticipantPage({ params }: PageProps<"/admin/events/[eventId]/participants/new">) {
  await requireAdmin();
  const { eventId } = await params;
  const definitions = toDefinitions(await listFieldDefinitions(db(), eventId));
  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-bold">Add participant</h1>
      <ParticipantForm action={createParticipantAction.bind(null, eventId)} definitions={definitions} initial={{ eligible: "yes" }} submitLabel="Add participant" />
    </div>
  );
}
