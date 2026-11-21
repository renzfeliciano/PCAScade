import type { Db } from "@/lib/db";
import { PUBLIC_EVENT_STATUSES } from "@/modules/events/domain/event-rules";
import { type PublicPerson, mediaUrl } from "@/modules/presentation/domain/display";
import { activePreparation, visibleWinners } from "@/modules/presentation/server/state";

const eventSelect = { id: true, slug: true, name: true, status: true, accent: true, startsAt: true, participantDisplay: true } as const;
const prizeSelect = {
  id: true,
  name: true,
  description: true,
  quantity: true,
  drawOrder: true,
  photoId: true,
  category: { select: { name: true, sortOrder: true } },
} as const;

export type CatalogPrize = { id: string; name: string; description: string | null; quantity: number; categoryName: string | null; photoUrl: string | null };

function toCatalogPrize(prize: { id: string; name: string; description: string | null; quantity: number; photoId: string | null; category: { name: string } | null }): CatalogPrize {
  return { id: prize.id, name: prize.name, description: prize.description, quantity: prize.quantity, categoryName: prize.category?.name ?? null, photoUrl: mediaUrl(prize.photoId) };
}

async function eventPrizes(database: Db, eventId: string) {
  const prizes = await database.prize.findMany({ where: { eventId, status: "AVAILABLE" }, orderBy: [{ drawOrder: "asc" }, { code: "asc" }], select: prizeSelect });
  return prizes.map(toCatalogPrize);
}

export async function publicPrizeCatalog(database: Db) {
  const events = await database.event.findMany({
    where: { status: { in: [...PUBLIC_EVENT_STATUSES] } },
    orderBy: [{ startsAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    select: eventSelect,
  });
  const withPrizes = await Promise.all(events.map(async (event) => ({ event, prizes: await eventPrizes(database, event.id) })));
  return withPrizes.filter((entry) => entry.prizes.length > 0);
}

export type GalleryPrize = { id: string; name: string; categoryName: string | null; winners: { drawId: string; slotNumber: number; person: PublicPerson }[] };

async function eventWinners(database: Db, event: { id: string; participantDisplay: unknown }, now: Date) {
  const preparation = await activePreparation(database, event.id);
  if (!preparation) return { preparationId: null, prizes: [] as GalleryPrize[], total: 0 };
  const winners = await visibleWinners(database, preparation.id, event.participantDisplay, now);
  if (winners.length === 0) return { preparationId: preparation.id, prizes: [] as GalleryPrize[], total: 0 };
  const prizes = await database.prize.findMany({ where: { id: { in: [...new Set(winners.map((winner) => winner.prizeId))] } }, orderBy: [{ drawOrder: "asc" }, { code: "asc" }], select: prizeSelect });
  return {
    preparationId: preparation.id,
    total: winners.length,
    prizes: prizes.map((prize) => ({
      id: prize.id,
      name: prize.name,
      categoryName: prize.category?.name ?? null,
      winners: winners.filter((winner) => winner.prizeId === prize.id).map(({ drawId, slotNumber, person }) => ({ drawId, slotNumber, person })),
    })),
  };
}

export async function publicWinnerGallery(database: Db, now: Date = new Date()) {
  const events = await database.event.findMany({
    where: { status: { in: [...PUBLIC_EVENT_STATUSES] } },
    orderBy: [{ startsAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: eventSelect,
  });
  const galleries = await Promise.all(events.map(async (event) => ({ event, ...(await eventWinners(database, event, now)) })));
  return galleries.filter((gallery) => gallery.total > 0);
}

export async function publicEventExtras(database: Db, eventId: string, now: Date = new Date()) {
  const event = await database.event.findUnique({ where: { id: eventId }, select: { id: true, participantDisplay: true } });
  if (!event) return null;
  const [prizes, winners] = await Promise.all([eventPrizes(database, eventId), eventWinners(database, event, now)]);
  return { prizes, winners };
}
