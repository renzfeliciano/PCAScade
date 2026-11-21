import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { sceneLabel } from "@/modules/prizes/domain/prizes";
import { listPrizes } from "@/modules/prizes/server/prizes";
import { movePrizeAction } from "./actions";

export const metadata: Metadata = { title: "Prizes" };

const PROBLEMS: Record<string, string> = {
  locked: "The prize list is frozen for an active raffle. Cancel the raffle preparation to change the draw order.",
  missing: "That prize no longer exists.",
};

export default async function PrizesPage({ params, searchParams }: PageProps<"/admin/events/[eventId]/prizes">) {
  await requireAdmin();
  const { eventId } = await params;
  const query = await searchParams;
  const problem = typeof query.problem === "string" ? PROBLEMS[query.problem] : undefined;
  const prizes = await listPrizes(db(), eventId);
  const available = prizes.filter((prize) => prize.status === "AVAILABLE");
  const winners = available.reduce((sum, prize) => sum + prize.quantity, 0);
  const base = `/admin/events/${eventId}/prizes`;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Prizes</h1>
          <p className="text-sm text-muted-foreground">
            {prizes.length} {prizes.length === 1 ? "prize" : "prizes"}, {winners} {winners === 1 ? "winner" : "winners"} to draw
            {prizes.length > available.length ? ` (${prizes.length - available.length} withdrawn)` : ""}. Prizes are drawn from the top of this list.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/categories`} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-secondary">
            Categories and scenes
          </Link>
          <Link href={`/admin/events/${eventId}/imports/new?kind=prizes`} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-secondary">
            Import from Excel or CSV
          </Link>
          <Link href={`${base}/new`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Add prize
          </Link>
        </div>
      </div>

      {problem ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}

      {prizes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          No prizes yet. Create the categories first, then add prizes one by one or import a spreadsheet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-right">#</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Photo</span>
                </TableHead>
                <TableHead>Prize</TableHead>
                <TableHead>Category and scene</TableHead>
                <TableHead className="text-right">Winners</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">Draw order</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prizes.map((prize, index) => (
                <TableRow key={prize.id} className={prize.status === "WITHDRAWN" ? "text-muted-foreground" : undefined}>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{prize.drawOrder}</TableCell>
                  <TableCell>
                    {prize.photoId ? (
                      <img src={`/api/admin/media/${prize.photoId}`} alt="" width={32} height={32} className="size-8 rounded-sm object-cover" loading="lazy" />
                    ) : (
                      <span className="block size-8 rounded-sm bg-muted" aria-hidden="true" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`${base}/${prize.id}`} className="font-medium hover:underline">
                      {prize.name}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">{prize.code}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {prize.category ? (
                      <>
                        <span className="block">{prize.category.name}</span>
                        <span className="block text-xs text-muted-foreground">{sceneLabel(prize.category.sceneKey)}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No category</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{prize.quantity}</TableCell>
                  <TableCell>{prize.status === "WITHDRAWN" ? <Badge variant="outline">Withdrawn</Badge> : <Badge variant="secondary">Available</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <form action={movePrizeAction.bind(null, eventId, prize.id, "up")}>
                        <button
                          type="submit"
                          disabled={index === 0}
                          aria-label={`Draw ${prize.name} earlier`}
                          className="inline-flex size-8 items-center justify-center rounded-md border border-border hover:bg-secondary disabled:opacity-30"
                        >
                          <ArrowUp className="size-4" aria-hidden="true" />
                        </button>
                      </form>
                      <form action={movePrizeAction.bind(null, eventId, prize.id, "down")}>
                        <button
                          type="submit"
                          disabled={index === prizes.length - 1}
                          aria-label={`Draw ${prize.name} later`}
                          className="inline-flex size-8 items-center justify-center rounded-md border border-border hover:bg-secondary disabled:opacity-30"
                        >
                          <ArrowDown className="size-4" aria-hidden="true" />
                        </button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
