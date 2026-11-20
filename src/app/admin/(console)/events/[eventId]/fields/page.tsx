import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { listFieldDefinitions } from "@/modules/participants/server/fields";
import { ExistingField, NewFieldForm } from "./field-editor";

export const metadata: Metadata = { title: "Custom fields" };

export default async function FieldsPage({ params }: PageProps<"/admin/events/[eventId]/fields">) {
  await requireAdmin();
  const { eventId } = await params;
  const fields = await listFieldDefinitions(db(), eventId);
  return (
    <div className="grid max-w-3xl gap-5">
      <div>
        <h1 className="text-2xl font-bold">Custom fields</h1>
        <p className="text-sm text-muted-foreground">
          Extra participant details for this event. The key is the column name used in the import template. Fields are private unless marked as
          allowed on public pages.
        </p>
      </div>
      {fields.map((field) => (
        <ExistingField key={`${field.id}-${field.label}-${field.required}-${field.isPublic}-${field.options.join("|")}`} eventId={eventId} field={field} />
      ))}
      <NewFieldForm key={fields.length} eventId={eventId} />
    </div>
  );
}
