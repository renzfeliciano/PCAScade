import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EventStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { listAudit } from "@/modules/audit/server/audit-log";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { EVENT_STATUS_LABELS } from "@/modules/events/domain/event-rules";

export const metadata: Metadata = { title: "Dashboard" };

const ORDER: EventStatus[] = ["DRAFT", "PUBLISHED", "LIVE", "CLOSED", "ARCHIVED"];

const timeFormat = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default async function DashboardPage() {
  await requireAdmin();
  const database = db();
  const [grouped, recent] = await Promise.all([
    database.event.groupBy({ by: ["status"], _count: { _all: true } }),
    listAudit(database, { take: 8 }),
  ]);
  const counts = new Map(grouped.map((row) => [row.status, row._count._all]));

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of events and the latest recorded actions.</p>
      </div>

      <section aria-labelledby="events-heading" className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 id="events-heading" className="text-lg font-bold">
            Events by status
          </h2>
          <Link href="/admin/events/new" className="text-sm font-semibold hover:underline">
            New event
          </Link>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {ORDER.map((status) => (
            <div key={status} className="rounded-md border border-border bg-card p-4">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{EVENT_STATUS_LABELS[status]}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums">{counts.get(status) ?? 0}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent activity</CardTitle>
          <Link href="/admin/audit-logs" className="text-sm font-semibold hover:underline">
            Full audit log
          </Link>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {recent.map((entry) => (
                <li key={entry.seq.toString()} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <span className="font-mono">{entry.action}</span>
                  <span className="text-muted-foreground tabular-nums">{timeFormat.format(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
