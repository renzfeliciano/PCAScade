import type { Metadata } from "next";
import { EventPicker } from "@/components/admin/event-picker";
import { requireAdmin } from "@/modules/auth/server/request-context";

export const metadata: Metadata = { title: "Prizes" };

export default async function PrizesIndexPage() {
  await requireAdmin();
  return <EventPicker title="Prizes" description="Prizes and their categories belong to one event. Choose the event to manage." suffix="/prizes" />;
}
