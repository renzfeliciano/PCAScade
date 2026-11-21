import type { Metadata } from "next";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { listPreparations } from "@/modules/raffle/server/queries";
import { PreparationStatusBadge } from "./status-badge";
import { PrepareForm } from "./raffle-forms";

export const metadata: Metadata = { title: "Raffle" };

const dateTime = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default async function RafflePage({ params }: PageProps<"/admin/events/[eventId]/raffle">) {
  await requireAdmin();
  const { eventId } = await params;
  const preparations = await listPreparations(db(), eventId);
  const open = preparations.find((preparation) => ["DRAFT", "FROZEN", "DRAWING"].includes(preparation.status));
  const base = `/admin/events/${eventId}/raffle`;

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-bold">Raffle</h1>
        <p className="text-sm text-muted-foreground">Prepare, freeze and draw. Every raffle, including cancelled and replaced ones, stays in this history and on its public verify page.</p>
      </div>

      {open ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-primary bg-card p-4">
          <div>
            <p className="font-semibold">
              Raffle v{open.version} is <PreparationStatusBadge status={open.status} />
            </p>
            <p className="text-sm text-muted-foreground">
              {open.filledSlots} of {open.slotCount ?? 0} winners drawn{open.resets > 0 ? `, ${open.resets} ${open.resets === 1 ? "reset" : "resets"}` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`${base}/${open.id}`} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-secondary">
              Manifest and controls
            </Link>
            {open.status !== "DRAFT" ? (
              <Link href={`${base}/${open.id}/console`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                Open draw console
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <PrepareForm eventId={eventId} />
      )}

      {preparations.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Participants</TableHead>
                <TableHead className="text-right">Winners</TableHead>
                <TableHead className="text-right">Resets</TableHead>
                <TableHead>Prepared</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preparations.map((preparation) => (
                <TableRow key={preparation.id}>
                  <TableCell>
                    <Link href={`${base}/${preparation.id}`} className="font-medium hover:underline">
                      v{preparation.version}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <PreparationStatusBadge status={preparation.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{preparation.participantCount ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {preparation.filledSlots} / {preparation.slotCount ?? 0}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{preparation.resets}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{dateTime.format(preparation.createdAt)}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{preparation.statusReason ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
