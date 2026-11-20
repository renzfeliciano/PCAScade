import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { getImportBatch, listImportRows } from "@/modules/imports/server/imports";
import { IMPORT_STATUS_LABELS } from "../labels";
import { BatchActions } from "./batch-actions";

export const metadata: Metadata = { title: "Import review" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILTERS = { all: "All rows", problems: "Errors and warnings", invalid: "Errors only" } as const;
const ACTION_LABELS: Record<string, string> = { CREATE: "New", UPDATE: "Update", SKIP: "Skip", INVALID: "Error" };

type Draft = { externalId?: string; fullName?: string; department?: string | null };

export default async function ImportBatchPage({ params, searchParams }: PageProps<"/admin/events/[eventId]/imports/[batchId]">) {
  await requireAdmin();
  const { eventId, batchId } = await params;
  if (!UUID.test(batchId)) notFound();
  const query = await searchParams;
  const filter = (typeof query.filter === "string" && query.filter in FILTERS ? query.filter : "problems") as keyof typeof FILTERS;
  const page = Math.max(1, Number(typeof query.page === "string" ? query.page : 1) || 1);
  const database = db();
  const batch = await getImportBatch(database, eventId, batchId);
  if (!batch) notFound();
  const rows = await listImportRows(database, batchId, { filter, page });
  const pages = Math.max(1, Math.ceil(rows.total / rows.pageSize));
  const base = `/admin/events/${eventId}/imports/${batchId}`;
  const summary = [
    ["Rows", batch.rowCount],
    ["New", batch.createCount],
    ["Updates", batch.updateCount],
    ["Skipped", batch.skipCount],
    ["Errors", batch.invalidCount],
    ["With warnings", batch.warningCount],
  ] as const;

  return (
    <div className="grid gap-6">
      <div>
        <Link href={`/admin/events/${eventId}/imports`} className="text-sm text-muted-foreground hover:underline">
          ← Imports
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{batch.fileName}</h1>
          <Badge variant={batch.status === "COMMITTED" ? "default" : "secondary"}>{IMPORT_STATUS_LABELS[batch.status] ?? batch.status}</Badge>
        </div>
        <p className="font-mono text-xs break-all text-muted-foreground">SHA-256 {batch.fileSha256Hex}</p>
      </div>

      <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {summary.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-card p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <BatchActions
        key={batch.status}
        eventId={eventId}
        batchId={batchId}
        status={batch.status}
        createCount={batch.createCount}
        updateCount={batch.updateCount}
        invalidCount={batch.invalidCount}
      />

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Row filter" className="flex gap-1">
            {Object.entries(FILTERS).map(([key, label]) => (
              <Link
                key={key}
                href={`${base}?filter=${key}`}
                aria-current={filter === key ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm ${filter === key ? "bg-secondary font-semibold" : "text-muted-foreground hover:bg-secondary"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          {batch.invalidCount + batch.warningCount > 0 ? (
            <a href={`/api/admin/events/${eventId}/imports/${batchId}/report`} className="text-sm font-semibold hover:underline">
              Download error report (CSV)
            </a>
          ) : null}
        </div>
        {rows.rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {filter === "all" ? "No rows." : "No rows with problems."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Photo</TableHead>
                  <TableHead>Participant</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Problems</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.rows.map((row) => {
                  const draft = (row.normalized ?? {}) as Draft;
                  return (
                    <TableRow key={row.rowNumber}>
                      <TableCell className="font-mono text-xs tabular-nums">{row.rowNumber}</TableCell>
                      <TableCell>
                        {row.photoAssetId ? (
                          <img src={`/api/admin/media/${row.photoAssetId}`} alt="" width={40} height={40} className="size-10 rounded-sm object-cover" loading="lazy" />
                        ) : (
                          <span className="block size-10 rounded-sm bg-muted" aria-hidden="true" />
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="block font-medium">{draft.fullName || "—"}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{draft.externalId || "no employee ID"}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.action === "INVALID" ? "destructive" : row.action === "SKIP" ? "outline" : "secondary"}>{ACTION_LABELS[row.action ?? ""] ?? "Pending"}</Badge>
                      </TableCell>
                      <TableCell className="min-w-64 text-sm whitespace-normal">
                        <ul className="grid gap-1">
                          {row.errors.map((issue, index) => (
                            <li key={`e-${index}`} className="text-destructive">
                              {issue.message}
                            </li>
                          ))}
                          {row.warnings.map((issue, index) => (
                            <li key={`w-${index}`} className="text-amber-700">
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center gap-4 text-sm">
            {page > 1 ? (
              <Link href={`${base}?filter=${filter}&page=${page - 1}`} className="font-semibold hover:underline">
                Previous
              </Link>
            ) : null}
            <span className="text-muted-foreground tabular-nums">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={`${base}?filter=${filter}&page=${page + 1}`} className="font-semibold hover:underline">
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
