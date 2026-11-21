import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { sceneLabel } from "@/modules/prizes/domain/prizes";
import { getCursor } from "@/modules/presentation/server/cursor";
import { CORRECTION_REASONS } from "@/modules/raffle/server/preparations";
import { consoleState, getPreparation } from "@/modules/raffle/server/queries";
import { DrawForm, FinishDrawForm, ResetForm, RevealForm, ScreenForm } from "../../raffle-forms";
import { PreparationStatusBadge } from "../../status-badge";

export const metadata: Metadata = { title: "Draw console" };
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SCREEN_LABELS: Record<string, string> = { LOBBY: "Lobby", PRIZES: "Prize line-up", DRAW: "Prize draw", WINNER_WALL: "Winner wall", RECAP: "Recap" };
const PHASE_LABELS: Record<string, string> = { IDLE: "showing the prize", DRAWING: "drawing", READY: "winner locked in, not revealed", REVEALING: "revealing" };

function reasonLabel(key: string) {
  return CORRECTION_REASONS.find((reason) => reason.key === key)?.label ?? key;
}

export default async function ConsolePage({ params }: PageProps<"/admin/events/[eventId]/raffle/[preparationId]/console">) {
  await requireAdmin();
  const { eventId, preparationId } = await params;
  if (!UUID.test(preparationId)) notFound();
  const database = db();
  const preparation = await getPreparation(database, preparationId);
  if (!preparation || preparation.eventId !== eventId) notFound();
  const [prizes, cursor, event] = await Promise.all([
    consoleState(database, preparationId),
    getCursor(database, eventId),
    database.event.findUnique({ where: { id: eventId }, select: { slug: true, status: true } }),
  ]);
  const presentable = event?.status === "PUBLISHED" || event?.status === "LIVE";
  const screen = cursor?.screen ?? "LOBBY";
  const onScreenPrize = screen === "DRAW" ? prizes.find((prize) => prize.id === cursor?.prizeId) : undefined;
  const drawing = preparation.status === "FROZEN" || preparation.status === "DRAWING";
  const hasPending = preparation.pendingDraws > 0;
  const current = prizes.find((prize) => prize.nextSlot !== null);
  const base = `/admin/events/${eventId}/raffle/${preparationId}`;

  return (
    <div className="grid gap-5">
      <Link href={base} className="text-sm text-muted-foreground hover:underline">
        ← Manifest and controls
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            Draw console <PreparationStatusBadge status={preparation.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            Raffle v{preparation.version}: {preparation.committedDraws} of {preparation.slotCount} winners drawn.{" "}
            <span className={preparation.resets > 0 ? "font-semibold text-foreground" : undefined}>
              {preparation.resets} {preparation.resets === 1 ? "reset" : "resets"} so far, all shown publicly.
            </span>
          </p>
        </div>
      </div>

      <section aria-labelledby="presentation-heading" className="grid gap-3 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="presentation-heading" className="font-semibold">
              Presentation screen
            </h2>
            <p data-testid="on-screen" className="text-sm text-muted-foreground">
              On screen now: <span className="font-medium text-foreground">{SCREEN_LABELS[screen]}</span>
              {onScreenPrize ? ` · ${onScreenPrize.name} · ${PHASE_LABELS[cursor?.phase ?? "IDLE"]}` : ""}
            </p>
          </div>
          {event && presentable ? (
            <a href={`/presentation/${event.slug}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:underline">
              Open the presentation display ↗
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">Publish the event to open the presentation display.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["LOBBY", "PRIZES", "WINNER_WALL", "RECAP"] as const).map((key) => (
            <ScreenForm key={key} eventId={eventId} preparationId={preparationId} screen={key} label={SCREEN_LABELS[key] ?? key} active={screen === key} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Drawing a prize puts it on screen automatically. The winner stays hidden until you press Reveal on screen.
        </p>
      </section>

      {!drawing ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">This raffle is not open for drawing. The record below is read-only.</p>
      ) : null}

      <ol className="grid gap-4">
        {prizes.map((prize) => {
          const isCurrent = drawing && current?.id === prize.id;
          const nextSlot = prize.nextSlot === null ? null : prize.slots[prize.nextSlot - 1];
          return (
            <li key={prize.id} className={`grid gap-3 rounded-md border bg-card p-4 ${isCurrent ? "border-2 border-primary" : "border-border"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    #{prize.drawOrder} · {prize.categoryName ?? "No category"} · {sceneLabel(prize.sceneKey)}
                  </p>
                  <h2 className="text-lg font-semibold">{prize.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {prize.slots.filter((slot) => slot.active?.status === "COMMITTED").length} of {prize.quantity} drawn
                    {prize.eligibility.departments.length > 0 ? ` · only ${prize.eligibility.departments.join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <ScreenForm
                    eventId={eventId}
                    preparationId={preparationId}
                    screen="DRAW"
                    prizeId={prize.id}
                    label="Show on screen"
                    active={screen === "DRAW" && cursor?.prizeId === prize.id}
                  />
                  {drawing && nextSlot && !hasPending ? (
                    <DrawForm
                      key={`${prize.id}-${nextSlot.slotNumber}-${nextSlot.generation}`}
                      eventId={eventId}
                      preparationId={preparationId}
                      prizeId={prize.id}
                      slot={nextSlot.slotNumber}
                      generation={nextSlot.generation}
                      label={nextSlot.generation > 0 ? `Redraw slot ${nextSlot.slotNumber}` : prize.quantity > 1 ? `Draw winner ${nextSlot.slotNumber} of ${prize.quantity}` : "Draw winner"}
                    />
                  ) : null}
                </div>
              </div>
              <ul className="grid gap-2">
                {prize.slots
                  .filter((slot) => slot.active !== null || slot.voided.length > 0)
                  .map((slot) => (
                    <li key={slot.slotNumber} className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm">
                      {slot.active?.status === "COMMITTED" && slot.active.participant ? (
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <span className="mr-2 font-mono text-xs text-muted-foreground">Slot {slot.slotNumber}</span>
                            <span className="font-semibold">{slot.active.participant.fullName}</span>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">{slot.active.participant.externalId}</span>
                            {slot.active.participant.department ? <span className="ml-2 text-xs text-muted-foreground">{slot.active.participant.department}</span> : null}
                            <span className="block text-xs text-muted-foreground">
                              Draw #{slot.active.sequence}, beacon round {slot.active.targetRound} ·{" "}
                              {slot.active.revealedAt ? `revealed ${slot.active.revealedAt.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila" })}` : "not revealed yet"}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-start gap-2">
                            {preparation.status === "DRAWING" || preparation.status === "COMPLETED" ? (
                              <RevealForm eventId={eventId} preparationId={preparationId} drawId={slot.active.drawId} revealed={slot.active.revealedAt !== null} />
                            ) : null}
                            {drawing && !hasPending ? <ResetForm eventId={eventId} preparationId={preparationId} drawId={slot.active.drawId} label="Reset" /> : null}
                          </div>
                        </div>
                      ) : null}
                      {slot.active?.status === "PENDING_BEACON" ? (
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <span className="mr-2 font-mono text-xs text-muted-foreground">Slot {slot.slotNumber}</span>
                            <Badge variant="outline">Waiting for beacon round {slot.active.targetRound}</Badge>
                            <span className="block text-xs text-muted-foreground">The winner is fixed by that future round. Retrying cannot change it.</span>
                          </div>
                          <div className="grid gap-2">
                            <FinishDrawForm eventId={eventId} preparationId={preparationId} drawId={slot.active.drawId} />
                            <ResetForm eventId={eventId} preparationId={preparationId} drawId={slot.active.drawId} label="Reset stuck draw" />
                          </div>
                        </div>
                      ) : null}
                      {slot.voided.map((voided) => (
                        <p key={voided.drawId} className="text-xs text-muted-foreground">
                          <span className="font-mono">Slot {slot.slotNumber}</span> · reset draw #{voided.sequence}
                          {voided.participant ? ` (${voided.participant.fullName})` : " before a winner was chosen"} ·{" "}
                          {voided.correction ? `${reasonLabel(voided.correction.category)}: ${voided.correction.reason}` : ""}
                        </p>
                      ))}
                    </li>
                  ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
