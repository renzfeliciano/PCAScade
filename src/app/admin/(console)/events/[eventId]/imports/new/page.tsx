import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { listFieldDefinitions, toDefinitions } from "@/modules/participants/server/fields";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "New import" };

export default async function NewImportPage({ params }: PageProps<"/admin/events/[eventId]/imports/new">) {
  await requireAdmin();
  const { eventId } = await params;
  const definitions = toDefinitions(await listFieldDefinitions(db(), eventId));
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-bold">Import participants</h1>
        <p className="text-sm text-muted-foreground">Nothing is saved until you review the preview and confirm.</p>
      </div>
      <ImportWizard eventId={eventId} definitions={definitions} />
    </div>
  );
}
