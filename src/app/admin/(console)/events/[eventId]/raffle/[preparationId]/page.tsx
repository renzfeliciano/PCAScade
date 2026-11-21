import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { sceneLabel } from "@/modules/prizes/domain/prizes";
import { REPEAT_WINNER_OPTIONS, VOIDED_WINNER_OPTIONS } from "@/modules/raffle/domain/snapshot";
import { getPreparation } from "@/modules/raffle/server/queries";
import { CancelForm, CompleteForm, FreezeForm, FreshStartForm, RulesForm } from "../raffle-forms";
import { PreparationStatusBadge } from "../status-badge";

export const metadata: Metadata = { title: "Raffle manifest" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const dateTime = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Manila" });

function Hash({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-mono text-xs break-all">{value || "not sealed"}</dd>
    </div>
  );
}

export default async function PreparationPage({ params }: PageProps<"/admin/events/[eventId]/raffle/[preparationId]">) {
  await requireAdmin();
  const { eventId, preparationId } = await params;
  if (!UUID.test(preparationId)) notFound();
  const preparation = await getPreparation(db(), preparationId);
  if (!preparation || preparation.eventId !== eventId) notFound();
  const base = `/admin/events/${eventId}/raffle`;
  const rules = preparation.rules ?? { repeatWinners: "never" as const, voidedWinnerRedraw: "excluded" as const };
  const openSlots = preparation.slotCount - preparation.committedDraws;

  return (
    <div className="grid gap-5">
      <Link href={base} className="text-sm text-muted-foreground hover:underline">
        ← Raffle history
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            Raffle v{preparation.version} <PreparationStatusBadge status={preparation.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {preparation.participantCount} eligible {preparation.participantCount === 1 ? "participant" : "participants"}, {preparation.prizes.length}{" "}
            {preparation.prizes.length === 1 ? "prize" : "prizes"}, {preparation.slotCount} {preparation.slotCount === 1 ? "winner" : "winners"} to draw.
            {preparation.status !== "DRAFT" ? ` ${preparation.committedDraws} drawn, ${preparation.resets} ${preparation.resets === 1 ? "reset" : "resets"}.` : ""}
          </p>
          {preparation.statusReason ? <p className="mt-1 text-sm">Reason: {preparation.statusReason}</p> : null}
          {preparation.supersededBy ? (
            <p className="mt-1 text-sm">
              Replaced by{" "}
              <Link href={`${base}/${preparation.supersededBy.id}`} className="underline">
                v{preparation.supersededBy.version}
              </Link>
              .
            </p>
          ) : null}
          {preparation.supersedes ? (
            <p className="mt-1 text-sm">
              Fresh Start of{" "}
              <Link href={`${base}/${preparation.supersedes.id}`} className="underline">
                v{preparation.supersedes.version}
              </Link>
              .
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {preparation.status === "FROZEN" || preparation.status === "DRAWING" ? (
            <Link href={`${base}/${preparation.id}/console`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              Open draw console
            </Link>
          ) : null}
          {preparation.status !== "DRAFT" ? (
            <>
              <Link href={`/verify/${preparation.id}`} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-secondary">
                Public verify page
              </Link>
              <a href={`/verify/${preparation.id}/bundle`} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-secondary">
                Download bundle
              </a>
            </>
          ) : null}
        </div>
      </div>

      <section className="grid gap-3 rounded-md border border-border bg-card p-4">
        <h2 className="font-semibold">{preparation.status === "DRAFT" ? "Manifest preview" : "Pre-draw manifest"}</h2>
        <dl className="grid gap-3">
          <Hash label="Manifest SHA-256" value={preparation.manifestSha256} />
          <Hash label="Seed commitment" value={preparation.seedCommitment} />
          <Hash label="Participants snapshot SHA-256" value={preparation.participantsSha256} />
          <Hash label="Prizes snapshot SHA-256" value={preparation.prizesSha256} />
          <Hash label="Rules snapshot SHA-256" value={preparation.rulesSha256} />
        </dl>
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Prepared</dt>
            <dd>{dateTime.format(preparation.createdAt)}</dd>
          </div>
          {preparation.frozenAt ? (
            <div>
              <dt className="text-muted-foreground">Frozen</dt>
              <dd>{dateTime.format(preparation.frozenAt)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">Prizes per person</dt>
            <dd>{REPEAT_WINNER_OPTIONS.find((option) => option.key === rules.repeatWinners)?.label}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reset winners</dt>
            <dd>{VOIDED_WINNER_OPTIONS.find((option) => option.key === rules.voidedWinnerRedraw)?.label}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Server seed</dt>
            <dd>{preparation.seedRevealed ? "Revealed" : "Secret until the raffle ends"}</dd>
          </div>
        </dl>
      </section>

      {preparation.status === "DRAFT" ? (
        <>
          <FreezeForm eventId={eventId} preparationId={preparation.id} manifest={preparation.manifestSha256} />
          <RulesForm eventId={eventId} preparationId={preparation.id} rules={rules} />
          <CancelForm eventId={eventId} preparationId={preparation.id} frozen={false} />
        </>
      ) : null}
      {preparation.status === "FROZEN" ? (
        <>
          <CancelForm eventId={eventId} preparationId={preparation.id} frozen />
          <FreshStartForm eventId={eventId} preparationId={preparation.id} />
        </>
      ) : null}
      {preparation.status === "DRAWING" ? (
        <>
          <CompleteForm eventId={eventId} preparationId={preparation.id} openSlots={openSlots} />
          <FreshStartForm eventId={eventId} preparationId={preparation.id} />
        </>
      ) : null}

      <section className="grid gap-2">
        <h2 className="font-semibold">Prizes in this snapshot</h2>
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-right">#</TableHead>
                <TableHead>Prize</TableHead>
                <TableHead>Category and scene</TableHead>
                <TableHead>Who can win</TableHead>
                <TableHead className="text-right">Winners</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preparation.prizes.map((prize) => (
                <TableRow key={prize.id}>
                  <TableCell className="text-right font-mono text-xs">{prize.drawOrder}</TableCell>
                  <TableCell>
                    <span className="block font-medium">{prize.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{prize.code}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="block">{prize.categoryName ?? "No category"}</span>
                    <span className="block text-xs text-muted-foreground">{sceneLabel(prize.sceneKey)}</span>
                  </TableCell>
                  <TableCell className="text-sm">{prize.eligibility.departments.length > 0 ? prize.eligibility.departments.join(", ") : "Everyone"}</TableCell>
                  <TableCell className="text-right tabular-nums">{prize.quantity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
