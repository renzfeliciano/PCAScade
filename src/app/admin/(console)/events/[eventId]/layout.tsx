import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { EventTabs } from "./event-tabs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function EventSectionLayout({ children, params }: LayoutProps<"/admin/events/[eventId]">) {
  await requireAdmin();
  const { eventId } = await params;
  if (!UUID.test(eventId)) notFound();
  const event = await db().event.findUnique({ where: { id: eventId }, select: { name: true } });
  if (!event) notFound();
  return (
    <div className="grid gap-6">
      <EventTabs eventId={eventId} eventName={event.name} />
      {children}
    </div>
  );
}
