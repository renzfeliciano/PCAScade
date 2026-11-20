import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { listAudit, verifyAuditChain } from "@/modules/audit/server/audit-log";
import { requireAdmin } from "@/modules/auth/server/request-context";

export const metadata: Metadata = { title: "Audit log" };

const timeFormat = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Manila" });

function summarize(payload: string): string {
  return payload.length > 140 ? `${payload.slice(0, 140)}…` : payload;
}

export default async function AuditLogPage({ searchParams }: PageProps<"/admin/audit-logs">) {
  await requireAdmin();
  const params = await searchParams;
  const before = typeof params.before === "string" && /^\d{1,19}$/.test(params.before) ? BigInt(params.before) : undefined;
  const database = db();
  const [verification, entries] = await Promise.all([verifyAuditChain(database), listAudit(database, { beforeSeq: before, take: 50 })]);
  const oldest = entries.at(-1);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="max-w-[75ch] text-sm text-muted-foreground">
          Append-only. Each entry stores a SHA-256 hash that covers the previous entry. Entry numbers can skip when an action is cancelled
          before it is saved; the hash links, not the numbers, show that nothing was removed.
        </p>
      </div>

      {verification.ok ? (
        <Alert>
          <AlertTitle>Chain intact</AlertTitle>
          <AlertDescription>
            All {verification.checked} entries verified. Current head <code className="font-mono break-all">{verification.head.slice(0, 16)}…</code>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Chain broken at entry {verification.brokenAtSeq.toString()}</AlertTitle>
          <AlertDescription>
            {verification.reason === "HASH_MISMATCH"
              ? "That entry's contents no longer match its recorded hash."
              : "That entry does not link to the entry before it."}{" "}
            {verification.checked} earlier entries verified. Treat records from this point as untrusted and investigate before running any draw.
          </AlertDescription>
        </Alert>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Time (Manila)</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.seq.toString()}>
                  <TableCell className="font-mono text-xs tabular-nums">{entry.seq.toString()}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap tabular-nums">{timeFormat.format(entry.createdAt)}</TableCell>
                  <TableCell className="text-xs">{entry.actor}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{entry.action}</TableCell>
                  <TableCell className="max-w-md min-w-64 font-mono text-xs whitespace-normal break-all text-muted-foreground">{summarize(entry.payload)}</TableCell>
                  <TableCell className="font-mono text-xs">{Buffer.from(entry.hash).toString("hex").slice(0, 10)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex gap-4 text-sm">
        {before ? (
          <Link href="/admin/audit-logs" className="font-semibold hover:underline">
            Newest entries
          </Link>
        ) : null}
        {oldest && oldest.seq > 1n ? (
          <Link href={`/admin/audit-logs?before=${oldest.seq.toString()}`} className="font-semibold hover:underline">
            Older entries
          </Link>
        ) : null}
      </div>
    </div>
  );
}
