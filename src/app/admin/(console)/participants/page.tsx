import type { Metadata } from "next";
import { EventPicker } from "@/components/admin/event-picker";
import { requireAdmin } from "@/modules/auth/server/request-context";

export const metadata: Metadata = { title: "Participants" };

export default async function ParticipantsIndexPage() {
  await requireAdmin();
  return <EventPicker title="Participants" description="Participants belong to one event. Choose the event to manage." suffix="/participants" />;
}
