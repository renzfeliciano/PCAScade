import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND_ASSOCIATION } from "@/components/brand/brand-mark";
import { db } from "@/lib/db";
import { verifyAuditChain } from "@/modules/audit/server/audit-log";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { type CheckResult, verifyBundle } from "@/modules/raffle/domain/verify";
import { CORRECTION_REASONS } from "@/modules/raffle/server/preparations";
import { buildBundle, getPreparation } from "@/modules/raffle/server/queries";
import { PrintButton } from "../../print-button";

export const metadata: Metadata = { title: "Post-draw report" };
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const dateTime = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Manila" });
const time = new Intl.DateTimeFormat("en-PH", { timeStyle: "medium", timeZone: "Asia/Manila" });

function verdict(check: CheckResult): string {
  if (check.ok === true) return "Passed";
  if (check.ok === false) return `FAILED: ${check.reason}`;
  return `Not checked yet: ${check.reason}`;
}

function reasonLabel(key: string) {
  return CORRECTION_REASONS.find((reason) => reason.key === key)?.label ?? key;
}

export default async function ReportPage({ params }: PageProps<"/admin/events/[eventId]/raffle/[preparationId]/report">) {
  await requireAdmin();
  const { eventId, preparationId } = await params;
  if (!UUID.test(preparationId)) notFound();
  const database = db();
  const preparation = await getPreparation(database, preparationId);
  if (!preparation || preparation.eventId !== eventId) notFound();
  const bundle = await buildBundle(database, preparationId);
  const [report, chain, draws] = await Promise.all([
    bundle ? Promise.resolve(verifyBundle(bundle)) : Promise.resolve(null),
    verifyAuditChain(database),
    database.draw.findMany({
      where: { preparationId },
      orderBy: { sequence: "asc" },
      include: { winner: { include: { participant: { select: { fullName: true, externalId: true, department: true } } } }, correction: true, reveal: true },
    }),
  ]);
  const prizeName = new Map(preparation.prizes.map((prize) => [prize.id, prize.name]));
  const drawChecks = new Map(report?.draws.map((check) => [check.drawId, check]) ?? []);
  const active = draws.filter((draw) => draw.status === "COMMITTED");
  const base = `/admin/events/${eventId}/raffle/${preparationId}`;
  const checks = report
    ? [
        { label: "Snapshot integrity", value: verdict(report.snapshots) },
        { label: "Manifest", value: verdict(report.manifest) },
        { label: "Server seed against its commitment", value: verdict(report.seed) },
        {
          label: "Randomness (drand signatures)",
          value: report.draws.some((check) => check.beacon.ok === false) ? "FAILED for at least one draw" : `${report.draws.filter((check) => check.beacon.ok === true).length} of ${report.draws.length} draws passed`,
        },
        {
          label: "Draw results recomputed",
          value: report.draws.some((check) => check.result.ok === false)
            ? "FAILED for at least one draw"
            : report.draws.length > 0 && report.draws.every((check) => check.result.ok === null)
              ? "Not checked yet: draws are recomputed once the server seed is revealed"
              : `${report.draws.filter((check) => check.result.ok === true).length} of ${report.draws.length} draws reproduced`,
        },
        { label: "Audit chain", value: chain.ok ? `Passed (${chain.checked} entries)` : `FAILED at entry ${chain.brokenAtSeq.toString()}` },
      ]
    : [];

  return (
    <article className="mx-auto grid max-w-4xl gap-6 print:max-w-none print:text-black">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={base} className="text-sm text-muted-foreground hover:underline">
          ← Manifest and controls
        </Link>
        <PrintButton label="Print report" />
      </div>

      <header className="grid gap-1">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase">PCASCADE · post-draw report</p>
        <h1 className="text-2xl font-bold">{preparation.event.name}</h1>
        <p className="text-sm">
          Raffle v{preparation.version} · status {preparation.status.toLowerCase()} · generated {dateTime.format(new Date())}
        </p>
        <p className="font-mono text-xs break-all">Manifest {preparation.manifestSha256}</p>
        {preparation.status === "DRAWING" ? <p className="text-sm font-semibold">Drawing is still open. The server seed is revealed when the raffle is completed, so the seed check is pending.</p> : null}
      </header>

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Summary</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Winner slots", value: preparation.slotCount },
            { label: "Winners standing", value: active.length },
            { label: "Revealed on screen", value: active.filter((draw) => draw.reveal).length },
            { label: "Resets", value: preparation.resets },
          ].map((item) => (
            <div key={item.label} className="rounded-md border border-border p-3">
              <dt className="text-xs text-muted-foreground print:text-black">{item.label}</dt>
              <dd className="text-2xl font-bold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Verification</h2>
        {report ? (
          <dl className="grid">
            {checks.map((check) => (
              <div key={check.label} className="grid gap-0.5 border-b border-border py-2 sm:grid-cols-[18rem_1fr] sm:gap-4">
                <dt className="text-sm font-semibold">{check.label}</dt>
                <dd data-testid="report-check" className={`text-sm ${check.value.startsWith("FAILED") ? "font-bold text-destructive" : ""}`}>
                  {check.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm">This raffle was never sealed, so there is nothing to verify.</p>
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Every draw, including resets</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-foreground text-left">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Prize · slot</th>
              <th className="py-1 pr-2">Winner</th>
              <th className="py-1 pr-2">Beacon round</th>
              <th className="py-1 pr-2">Pool</th>
              <th className="py-1 pr-2">Revealed</th>
              <th className="py-1">Check</th>
            </tr>
          </thead>
          <tbody>
            {draws.map((draw) => {
              const check = drawChecks.get(draw.id);
              const reproduced = check?.result.ok === true ? "Reproduced" : check?.result.ok === false ? "FAILED" : "—";
              return (
                <tr key={draw.id} className={`border-b border-border align-top ${draw.status === "VOIDED" ? "text-muted-foreground print:text-black" : ""}`}>
                  <td className="py-1 pr-2 tabular-nums">{draw.sequence}</td>
                  <td className="py-1 pr-2">
                    {prizeName.get(draw.prizeId) ?? draw.prizeId} · {draw.slotNumber}
                  </td>
                  <td className="py-1 pr-2">
                    {draw.winner ? (
                      <>
                        <span className={draw.status === "VOIDED" ? "line-through" : "font-semibold"}>{draw.winner.participant.fullName}</span>
                        <span className="ml-1 font-mono text-xs">{draw.winner.participant.externalId}</span>
                      </>
                    ) : (
                      "No winner"
                    )}
                    {draw.correction ? (
                      <span className="block text-xs">
                        Reset ({reasonLabel(draw.correction.reasonCategory)}): {draw.correction.reasonText}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2 font-mono text-xs">{draw.beaconRound?.toString() ?? "—"}</td>
                  <td className="py-1 pr-2 tabular-nums">{draw.candidateCount ?? "—"}</td>
                  <td className="py-1 pr-2">{draw.reveal ? time.format(draw.reveal.revealedAt) : "—"}</td>
                  <td className="py-1">{draw.status === "PENDING_BEACON" ? "Waiting for beacon" : reproduced}</td>
                </tr>
              );
            })}
            {draws.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-3 text-center text-muted-foreground">
                  No draws yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="grid gap-1 text-sm">
        <h2 className="text-lg font-bold">What this report does not prove</h2>
        <p>
          Resets are unlimited. Each one is listed above with its reason, and fairness depends on those reasons being reviewed. Anyone who controls the database
          server could rewrite records, which is why the manifest hash was shared before the first draw. The public page at{" "}
          <span className="font-mono">/verify/{preparation.id}</span> repeats these checks independently.
        </p>
      </section>

      <footer className="text-xs text-muted-foreground print:text-black">{BRAND_ASSOCIATION}</footer>
    </article>
  );
}
