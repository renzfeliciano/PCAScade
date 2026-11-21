import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { listFieldDefinitions, toDefinitions } from "@/modules/participants/server/fields";
import { listCategories } from "@/modules/prizes/server/categories";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "New import" };

export default async function NewImportPage({ params, searchParams }: PageProps<"/admin/events/[eventId]/imports/new">) {
  await requireAdmin();
  const { eventId } = await params;
  const query = await searchParams;
  const kind = query.kind === "prizes" ? "PRIZES" : "PARTICIPANTS";
  const database = db();
  const [definitions, categories] = await Promise.all([
    kind === "PARTICIPANTS" ? listFieldDefinitions(database, eventId).then(toDefinitions) : Promise.resolve([]),
    kind === "PRIZES" ? listCategories(database, eventId) : Promise.resolve([]),
  ]);
  const base = `/admin/events/${eventId}/imports/new`;
  return (
    <div className="grid gap-5">
      <div className="grid gap-3">
        <h1 className="text-2xl font-bold">{kind === "PRIZES" ? "Import prizes" : "Import participants"}</h1>
        <nav aria-label="What to import" className="flex gap-1">
          {(
            [
              ["PARTICIPANTS", "Participants", base],
              ["PRIZES", "Prizes", `${base}?kind=prizes`],
            ] as const
          ).map(([value, label, href]) => (
            <Link
              key={value}
              href={href}
              aria-current={kind === value ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm ${kind === value ? "bg-secondary font-semibold" : "text-muted-foreground hover:bg-secondary"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-muted-foreground">
          Nothing is saved until you review the preview and confirm.
          {kind === "PRIZES" ? " Imported prizes are added after the existing ones in draw order. Categories must exist before they can be used." : ""}
        </p>
      </div>
      <ImportWizard
        key={kind}
        eventId={eventId}
        kind={kind}
        definitions={definitions}
        categories={categories.map((category) => ({ id: category.id, name: category.name, slug: category.slug }))}
      />
    </div>
  );
}
