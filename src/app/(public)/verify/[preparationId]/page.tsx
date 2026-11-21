import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { parsePrizesSnapshot, parseRulesSnapshot } from "@/modules/raffle/domain/snapshot";
import { CORRECTION_REASONS } from "@/modules/raffle/server/preparations";
import { buildBundle, publicPreparation, publicWinnerNames } from "@/modules/raffle/server/queries";
import { BrowserVerifier } from "./browser-verifier";

export const metadata: Metadata = { title: "Verify a raffle" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const dateTime = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Manila" });

const STATUS: Record<string, string> = {
  FROZEN: "Frozen, drawing not started",
  DRAWING: "Drawing in progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled before any draw",
  SUPERSEDED: "Replaced by a Fresh Start",
};

function Hash({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-mono text-xs break-all">{value ?? "not revealed yet"}</dd>
    </div>
  );
}

export default async function VerifyPage({ params }: PageProps<"/verify/[preparationId]">) {
  const { preparationId } = await params;
  if (!UUID.test(preparationId)) notFound();
  const database = db();
  const visible = await publicPreparation(database, preparationId);
  if (!visible) notFound();
  const bundle = await buildBundle(database, preparationId);
  if (!bundle) notFound();
  const closed = ["COMPLETED", "CANCELLED", "SUPERSEDED"].includes(visible.status);
  const names = closed ? await publicWinnerNames(database, preparationId) : {};
  const prizes = new Map(parsePrizesSnapshot(bundle.snapshots.prizes).prizes.map((prize) => [prize.id, prize]));
  const rules = parseRulesSnapshot(bundle.snapshots.rules).rules;
  const corrections = new Map(bundle.corrections.map((correction) => [correction.drawId, correction]));
  const resets = bundle.corrections.length;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-10">
      <header className="grid gap-1">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{visible.event.name}</p>
        <h1 className="text-3xl font-bold">Raffle v{bundle.preparation.version} verification</h1>
        <p className="text-muted-foreground">{STATUS[visible.status] ?? visible.status}</p>
        {bundle.preparation.statusReason ? <p>Reason given: {bundle.preparation.statusReason}</p> : null}
      </header>

      <section className="grid gap-2 rounded-md border border-border bg-card p-4 text-sm">
        <h2 className="text-base font-semibold">What this page can and cannot prove</h2>
        <p>
          Before the first draw the participant list, prize list and rules were frozen and hashed, and the server committed to a secret seed. Each winner was then chosen from
          that frozen list using the seed together with a public drand beacon round that did not exist yet when the draw was requested. Nobody, including the organiser,
          could know that round in advance.
        </p>
        <p>
          <strong>Resets are allowed and unlimited.</strong> The organiser can void a winner (for example, if they are absent) and draw again. Every reset is listed below
          with its reason, so the fairness of this raffle depends on that reset history. This raffle has <strong>{resets}</strong> {resets === 1 ? "reset" : "resets"}.
        </p>
        <p className="text-muted-foreground">
          This page relies on the drand network not colluding, and on the hosting and database accounts not being taken over. It does not claim the raffle is impossible to
          rig.
        </p>
      </section>

      <section className="grid gap-3 rounded-md border border-border bg-card p-4">
        <h2 className="font-semibold">Pre-draw manifest</h2>
        <dl className="grid gap-3">
          <Hash label="Manifest SHA-256" value={bundle.preparation.manifestSha256} />
          <Hash label="Seed commitment" value={bundle.preparation.seedCommitment} />
          <Hash label="Revealed server seed" value={bundle.preparation.revealedSeed} />
        </dl>
        <p className="text-sm text-muted-foreground">
          {bundle.preparation.participantCount} participants, {prizes.size} prizes, {bundle.preparation.slotCount} winners.
          {bundle.preparation.frozenAt ? ` Frozen ${dateTime.format(new Date(bundle.preparation.frozenAt))}.` : ""} One prize per person:{" "}
          {rules.repeatWinners === "never" ? "yes" : rules.repeatWinners === "per_category" ? "per category" : "no limit"}. Reset winners{" "}
          {rules.voidedWinnerRedraw === "excluded" ? "cannot" : "can"} win the same prize again.
        </p>
        <p className="text-sm">
          <a href={`/verify/${bundle.preparation.id}/bundle`} className="font-semibold underline">
            Download the verification bundle
          </a>{" "}
          to check it offline with <code className="font-mono text-xs">npm run verify:bundle -- bundle.json</code>.
        </p>
      </section>

      <section className="grid gap-2">
        <h2 className="font-semibold">Draw record</h2>
        {bundle.draws.length === 0 ? (
          <p className="text-sm text-muted-foreground">No draws yet.</p>
        ) : (
          <ol className="grid gap-2">
            {bundle.draws.map((draw) => {
              const prize = prizes.get(draw.prizeId);
              const correction = corrections.get(draw.id);
              const reason = correction ? (CORRECTION_REASONS.find((entry) => entry.key === correction.reasonCategory)?.label ?? correction.reasonCategory) : null;
              return (
                <li key={draw.id} className={`grid gap-1 rounded-md border p-3 text-sm ${correction ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}>
                  <p>
                    <span className="font-mono text-xs text-muted-foreground">#{draw.sequence}</span> <span className="font-semibold">{prize?.name ?? "Unknown prize"}</span>, slot{" "}
                    {draw.slotNumber}
                    {draw.participantId ? (
                      <>
                        {" "}
                        → {names[draw.participantId] ?? <span className="font-mono text-xs">{draw.participantId}</span>}
                      </>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    drand round {draw.beaconRound}
                    {draw.candidateCount !== null ? `, ${draw.candidateCount} candidates, index ${draw.selectedIndex}` : ""}
                    {draw.status === "PENDING_BEACON" ? ", waiting for the beacon" : ""}
                  </p>
                  {correction ? (
                    <p className="text-xs">
                      <strong>Reset</strong> ({reason}): {correction.reasonText}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        {!closed && bundle.draws.length > 0 ? <p className="text-xs text-muted-foreground">Winner names appear here once the raffle is closed.</p> : null}
      </section>

      <BrowserVerifier bundle={bundle} />
    </div>
  );
}
