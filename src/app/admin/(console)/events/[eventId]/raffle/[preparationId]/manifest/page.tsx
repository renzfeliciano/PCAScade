import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND_ASSOCIATION } from "@/components/brand/brand-mark";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { QUICKNET } from "@/modules/beacon/drand";
import { sceneLabel } from "@/modules/prizes/domain/prizes";
import { REPEAT_WINNER_OPTIONS, VOIDED_WINNER_OPTIONS } from "@/modules/raffle/domain/snapshot";
import { getPreparation } from "@/modules/raffle/server/queries";
import { PrintButton } from "../../print-button";

export const metadata: Metadata = { title: "Pre-draw manifest" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const dateTime = new Intl.DateTimeFormat("en-PH", { dateStyle: "long", timeStyle: "medium", timeZone: "Asia/Manila" });

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-0.5 border-b border-border py-2 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-sm font-semibold">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : "text-sm"}>{value}</dd>
    </div>
  );
}

export default async function ManifestPrintPage({ params }: PageProps<"/admin/events/[eventId]/raffle/[preparationId]/manifest">) {
  await requireAdmin();
  const { eventId, preparationId } = await params;
  if (!UUID.test(preparationId)) notFound();
  const preparation = await getPreparation(db(), preparationId);
  if (!preparation || preparation.eventId !== eventId) notFound();
  const rules = preparation.rules;
  const sealed = preparation.status !== "DRAFT";
  const base = `/admin/events/${eventId}/raffle/${preparationId}`;

  return (
    <article className="mx-auto grid max-w-3xl gap-6 print:max-w-none print:text-black">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={base} className="text-sm text-muted-foreground hover:underline">
          ← Manifest and controls
        </Link>
        <div className="flex gap-2">
          <a href={`/api/admin/raffles/${preparationId}/snapshot/participants`} className="text-sm font-semibold text-primary hover:underline">
            Participant snapshot
          </a>
          <a href={`/api/admin/raffles/${preparationId}/snapshot/prizes`} className="text-sm font-semibold text-primary hover:underline">
            Prize snapshot
          </a>
          <PrintButton label="Print manifest" />
        </div>
      </div>

      <header className="grid gap-1">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase">PCASCADE · pre-draw manifest</p>
        <h1 className="text-2xl font-bold">{preparation.event.name}</h1>
        <p className="text-sm">
          Raffle v{preparation.version} · {sealed ? `frozen ${preparation.frozenAt ? dateTime.format(preparation.frozenAt) : ""}` : "DRAFT, not frozen yet"}
        </p>
        {!sealed ? <p className="text-sm font-semibold">This is a draft. Its hashes change if participants, prizes or rules change. Freeze before sharing.</p> : null}
      </header>

      <section className="grid">
        <h2 className="mb-1 text-lg font-bold">Fingerprints</h2>
        <dl>
          <Row label="Manifest SHA-256" value={preparation.manifestSha256} mono />
          <Row label="Participants SHA-256" value={preparation.participantsSha256} mono />
          <Row label="Prizes SHA-256" value={preparation.prizesSha256} mono />
          <Row label="Rules SHA-256" value={preparation.rulesSha256} mono />
          <Row label="Server seed commitment" value={preparation.seedCommitment} mono />
          <Row label="Preparation ID" value={preparation.id} mono />
        </dl>
      </section>

      <section className="grid">
        <h2 className="mb-1 text-lg font-bold">What was frozen</h2>
        <dl>
          <Row label="Eligible participants" value={String(preparation.participantCount)} />
          <Row label="Prizes" value={String(preparation.prizes.length)} />
          <Row label="Winners to draw" value={String(preparation.slotCount)} />
          <Row label="Prizes per person" value={REPEAT_WINNER_OPTIONS.find((option) => option.key === rules?.repeatWinners)?.label ?? "—"} />
          <Row label="After a reset" value={VOIDED_WINNER_OPTIONS.find((option) => option.key === rules?.voidedWinnerRedraw)?.label ?? "—"} />
          <Row label="Selection algorithm" value="pcascade-select-v1 (HMAC-SHA256 stream, rejection sampling)" />
          <Row label="Public randomness" value={`drand quicknet, chain ${QUICKNET.chainHash}`} mono />
        </dl>
      </section>

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Prizes in draw order</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-foreground text-left">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Code</th>
              <th className="py-1 pr-2">Prize</th>
              <th className="py-1 pr-2">Category</th>
              <th className="py-1 pr-2 text-right">Winners</th>
              <th className="py-1">Who can win</th>
            </tr>
          </thead>
          <tbody>
            {preparation.prizes.map((prize) => (
              <tr key={prize.id} className="border-b border-border align-top">
                <td className="py-1 pr-2">{prize.drawOrder}</td>
                <td className="py-1 pr-2 font-mono text-xs">{prize.code}</td>
                <td className="py-1 pr-2">
                  {prize.name}
                  <span className="block text-xs text-muted-foreground print:text-black">{sceneLabel(prize.sceneKey)}</span>
                </td>
                <td className="py-1 pr-2">{prize.categoryName ?? "—"}</td>
                <td className="py-1 pr-2 text-right">{prize.quantity}</td>
                <td className="py-1">{prize.eligibility.departments.length > 0 ? prize.eligibility.departments.join(", ") : "Everyone eligible"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-2 text-sm">
        <h2 className="text-lg font-bold">How to check it later</h2>
        <p>
          Keep this sheet. After the raffle, open <span className="font-mono">/verify/{preparation.id}</span> on the PCASCADE site. The manifest hash shown there must
          match the one above. That page reproduces every draw from the frozen data, the revealed server seed and the public drand rounds, and lists every reset
          with its reason.
        </p>
      </section>

      <section className="grid gap-8 pt-4 sm:grid-cols-2">
        {["Witness", "Witness"].map((role, index) => (
          <div key={index} className="grid gap-1 text-sm">
            <div className="h-10 border-b border-foreground" />
            <p>{role}: name, signature and time</p>
          </div>
        ))}
      </section>

      <footer className="text-xs text-muted-foreground print:text-black">{BRAND_ASSOCIATION}</footer>
    </article>
  );
}
