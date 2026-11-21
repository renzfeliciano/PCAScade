import { bytesToHex } from "@noble/hashes/utils.js";
import type { Db } from "@/lib/db";
import { mediaUrl, parseParticipantDisplay, publicPerson } from "@/modules/presentation/domain/display";
import type { CurrentReveal, PresentationState } from "@/modules/presentation/domain/state-types";
import { DEFAULT_SCENE_KEY } from "@/modules/raffle/domain/snapshot";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRESENTABLE = ["PUBLISHED", "LIVE"] as const;
const ACTIVE_PREPARATION = ["FROZEN", "DRAWING", "COMPLETED"] as const;

export async function activePreparation(database: Db, eventId: string) {
  return database.rafflePreparation.findFirst({
    where: { eventId, status: { in: [...ACTIVE_PREPARATION] } },
    orderBy: { version: "desc" },
    select: { id: true, status: true, version: true, slotCount: true, manifestSha256: true },
  });
}

const personSelect = { fullName: true, department: true, jobTitle: true, bio: true, photoId: true } as const;

export async function visibleWinners(database: Db, preparationId: string, display: unknown, now: Date) {
  const settings = parseParticipantDisplay(display);
  const draws = await database.draw.findMany({
    where: { preparationId, status: "COMMITTED", winner: { voidedAt: null }, reveal: { visibleAt: { lte: now } } },
    orderBy: [{ slotNumber: "asc" }],
    select: { id: true, prizeId: true, slotNumber: true, reveal: { select: { visibleAt: true } }, winner: { select: { participant: { select: personSelect } } } },
  });
  return draws.flatMap((draw) =>
    draw.winner
      ? [{ drawId: draw.id, prizeId: draw.prizeId, slotNumber: draw.slotNumber, visibleAt: draw.reveal?.visibleAt ?? now, person: { ...publicPerson(draw.winner.participant, settings), bio: null } }]
      : [],
  );
}

export async function presentationState(database: Db, eventKey: string, now: Date = new Date()): Promise<PresentationState | null> {
  const event = await database.event.findFirst({
    where: { OR: [{ slug: eventKey }, ...(UUID.test(eventKey) ? [{ id: eventKey }] : [])], status: { in: [...PRESENTABLE] } },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      accent: true,
      venue: true,
      welcomeMessage: true,
      startsAt: true,
      participantDisplay: true,
      cursor: true,
    },
  });
  if (!event) return null;
  const display = parseParticipantDisplay(event.participantDisplay);
  const [prizes, preparation] = await Promise.all([
    database.prize.findMany({
      where: { eventId: event.id, status: "AVAILABLE" },
      orderBy: [{ drawOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, description: true, quantity: true, drawOrder: true, photoId: true, category: { select: { name: true, sceneKey: true } } },
    }),
    activePreparation(database, event.id),
  ]);
  const winners = preparation ? await visibleWinners(database, preparation.id, display, now) : [];
  const resets = preparation ? await database.winnerCorrection.count({ where: { preparationId: preparation.id } }) : 0;

  const cursor = event.cursor;
  let current: CurrentReveal | null = null;
  if (cursor?.screen === "DRAW" && cursor.prizeId) {
    current = {
      prizeId: cursor.prizeId,
      phase: cursor.phase,
      phaseStartedAt: cursor.phaseStartedAt.getTime(),
      countdownMs: cursor.countdownMs,
      sceneMs: cursor.sceneMs,
      drawId: null,
      slotNumber: null,
      winner: null,
    };
    if ((cursor.phase === "READY" || cursor.phase === "REVEALING") && cursor.drawId) {
      const draw = await database.draw.findUnique({
        where: { id: cursor.drawId },
        select: { id: true, status: true, slotNumber: true, preparationId: true, reveal: { select: { drawId: true } }, winner: { select: { voidedAt: true, participant: { select: personSelect } } } },
      });
      const live = draw && draw.status === "COMMITTED" && draw.winner && !draw.winner.voidedAt && draw.preparationId === preparation?.id;
      if (!live) {
        current = { ...current, phase: "IDLE", countdownMs: 0, sceneMs: 0 };
      } else {
        current.drawId = draw.id;
        current.slotNumber = draw.slotNumber;
        if (cursor.phase === "REVEALING" && draw.reveal && draw.winner) current.winner = publicPerson(draw.winner.participant, display);
        if (cursor.phase === "REVEALING" && !draw.reveal) current = { ...current, phase: "READY", countdownMs: 0, sceneMs: 0 };
      }
    }
  }

  return {
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      status: event.status,
      accent: event.accent,
      venue: event.venue,
      welcomeMessage: event.welcomeMessage,
      startsAt: event.startsAt?.toISOString() ?? null,
    },
    screen: cursor?.screen ?? "LOBBY",
    revision: cursor?.revision ?? 0,
    current,
    prizes: prizes.map((prize) => ({
      id: prize.id,
      code: prize.code,
      name: prize.name,
      description: prize.description,
      quantity: prize.quantity,
      drawOrder: prize.drawOrder,
      categoryName: prize.category?.name ?? null,
      sceneKey: prize.category?.sceneKey ?? DEFAULT_SCENE_KEY,
      photoUrl: mediaUrl(prize.photoId),
      winners: winners.filter((winner) => winner.prizeId === prize.id).map(({ drawId, slotNumber, person }) => ({ drawId, slotNumber, person })),
    })),
    raffle: preparation
      ? {
          id: preparation.id,
          status: preparation.status,
          version: preparation.version,
          slotCount: preparation.slotCount ?? 0,
          winnersShown: winners.length,
          resets,
          manifestSha256: preparation.manifestSha256 ? bytesToHex(new Uint8Array(preparation.manifestSha256)) : "",
        }
      : null,
  };
}
