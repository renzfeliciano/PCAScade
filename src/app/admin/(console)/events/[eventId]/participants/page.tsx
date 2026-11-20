import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { listParticipants } from "@/modules/participants/server/participants";

export const metadata: Metadata = { title: "Participants" };

export default async function EventParticipantsPage({ params, searchParams }: PageProps<"/admin/events/[eventId]/participants">) {
  await requireAdmin();
  const { eventId } = await params;
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : "";
  const page = Math.max(1, Number(typeof query.page === "string" ? query.page : 1) || 1);
  const result = await listParticipants(db(), eventId, { query: q, page });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const base = `/admin/events/${eventId}/participants`;
  const pageHref = (target: number) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(target) }).toString()}`;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Participants</h1>
          <p className="text-sm text-muted-foreground">
            {result.total} {result.total === 1 ? "participant" : "participants"}
            {q ? ` matching “${q}”` : ""}.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/events/${eventId}/imports/new`} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-secondary">
            Import from Excel or CSV
          </Link>
          <Link href={`${base}/new`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Add participant
          </Link>
        </div>
      </div>

      <form method="get" className="flex max-w-md gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Search participants
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder="Search name, employee ID or department" maxLength={100} />
        <button type="submit" className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-secondary">
          Search
        </button>
      </form>

      {result.rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          {q ? "No participants match that search." : "No participants yet. Add them one by one or import a spreadsheet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <span className="sr-only">Photo</span>
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Employee ID</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Draw status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((participant) => (
                <TableRow key={participant.id}>
                  <TableCell>
                    {participant.photoId ? (
                      <img src={`/api/admin/media/${participant.photoId}`} alt="" width={32} height={32} className="size-8 rounded-sm object-cover" loading="lazy" />
                    ) : (
                      <span className="block size-8 rounded-sm bg-muted" aria-hidden="true" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`${base}/${participant.id}`} className="font-medium hover:underline">
                      {participant.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{participant.externalId}</TableCell>
                  <TableCell className="text-sm">{participant.department ?? "—"}</TableCell>
                  <TableCell className="text-sm">{participant.jobTitle ?? "—"}</TableCell>
                  <TableCell>
                    {participant.status === "INACTIVE" ? (
                      <Badge variant="outline">Inactive</Badge>
                    ) : participant.eligible ? (
                      <Badge variant="secondary">Eligible</Badge>
                    ) : (
                      <Badge variant="outline">Not eligible</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center gap-4 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="font-semibold hover:underline">
              Previous
            </Link>
          ) : null}
          <span className="text-muted-foreground tabular-nums">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="font-semibold hover:underline">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
