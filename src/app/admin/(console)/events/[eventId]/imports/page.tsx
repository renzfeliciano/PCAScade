import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { listImportBatches, sweepStaleImports } from "@/modules/imports/server/imports";
import { IMPORT_STATUS_LABELS } from "./labels";

export const metadata: Metadata = { title: "Imports" };

const timeFormat = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default async function ImportsPage({ params }: PageProps<"/admin/events/[eventId]/imports">) {
  await requireAdmin();
  const { eventId } = await params;
  const database = db();
  await sweepStaleImports(database, eventId, new Date());
  const batches = await listImportBatches(database, eventId);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Imports</h1>
          <p className="text-sm text-muted-foreground">Every import is kept here with its outcome. Unfinished imports are cancelled after 24 hours.</p>
        </div>
        <Link href={`/admin/events/${eventId}/imports/new`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          New import
        </Link>
      </div>
      {batches.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">No imports yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Updated</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead className="text-right">Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="text-sm whitespace-nowrap tabular-nums">
                    <Link href={`/admin/events/${eventId}/imports/${batch.id}`} className="hover:underline">
                      {timeFormat.format(batch.createdAt)}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm">{batch.fileName}</TableCell>
                  <TableCell>
                    <Badge variant={batch.status === "COMMITTED" ? "default" : "secondary"}>{IMPORT_STATUS_LABELS[batch.status] ?? batch.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{batch.rowCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{batch.createCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{batch.updateCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{batch.skipCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{batch.invalidCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
