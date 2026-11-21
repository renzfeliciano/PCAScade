import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import { type CachePurger, mediaCacheTag, storeImage } from "@/modules/media/server/photo-store";
import { MAX_PRIZES_PER_EVENT, normalizePrizeValues } from "@/modules/prizes/domain/prizes";
import { parseEligibilityRule } from "@/modules/raffle/domain/snapshot";
import { assertRosterEditable } from "@/modules/raffle/server/roster-lock";

export type PrizeErrorCode = "NOT_FOUND" | "DUPLICATE_CODE" | "INVALID" | "HAS_DRAWS" | "TOO_MANY";

export class PrizeError extends Error {
  constructor(
    readonly code: PrizeErrorCode,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(code);
  }
}

type Tx = Prisma.TransactionClient;

export type PrizeInput = { code: unknown; name: unknown; description: unknown; quantity: unknown; categoryId: string | null };

const DUPLICATE_CODE = { code: "Another prize already uses this code." };

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function validated(tx: Tx, eventId: string, input: PrizeInput, exceptId?: string) {
  const { values, errors } = normalizePrizeValues(input);
  if (input.categoryId && !(await tx.prizeCategory.findFirst({ where: { id: input.categoryId, eventId }, select: { id: true } }))) {
    errors.categoryId = "That category no longer exists.";
  }
  if (Object.keys(errors).length > 0) throw new PrizeError("INVALID", errors);
  const clash = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM prize WHERE event_id = ${eventId}::uuid AND lower(code) = lower(${values.code}) AND id::text <> ${exceptId ?? ""}`;
  if (clash.length > 0) throw new PrizeError("DUPLICATE_CODE", DUPLICATE_CODE);
  return { ...values, categoryId: input.categoryId };
}

export async function renumberPrizes(tx: Tx, eventId: string) {
  await tx.$executeRaw`
    UPDATE prize p SET draw_order = r.n
    FROM (SELECT id, row_number() OVER (ORDER BY draw_order, created_at, id) AS n FROM prize WHERE event_id = ${eventId}::uuid) r
    WHERE p.id = r.id AND p.draw_order <> r.n`;
}

async function removeUnusedPhoto(tx: Tx, photoId: string | null) {
  if (!photoId) return false;
  const stillUsed = (await tx.prize.count({ where: { photoId } })) + (await tx.participant.count({ where: { photoId } }));
  if (stillUsed > 0) return false;
  await tx.mediaAsset.deleteMany({ where: { id: photoId } });
  return true;
}

export async function listPrizes(database: Db, eventId: string) {
  return database.prize.findMany({
    where: { eventId },
    orderBy: [{ drawOrder: "asc" }, { createdAt: "asc" }],
    take: MAX_PRIZES_PER_EVENT,
    select: {
      id: true,
      code: true,
      name: true,
      quantity: true,
      drawOrder: true,
      status: true,
      photoId: true,
      category: { select: { id: true, name: true, sceneKey: true } },
    },
  });
}

export async function getPrize(database: Db, eventId: string, prizeId: string) {
  return database.prize.findFirst({ where: { id: prizeId, eventId }, include: { _count: { select: { draws: true } } } });
}

export async function createPrize(database: Db, eventId: string, input: PrizeInput) {
  try {
    return await database.$transaction(async (tx) => {
      await assertRosterEditable(tx, eventId);
      if ((await tx.prize.count({ where: { eventId } })) >= MAX_PRIZES_PER_EVENT) throw new PrizeError("TOO_MANY");
      const values = await validated(tx, eventId, input);
      const last = await tx.prize.aggregate({ where: { eventId }, _max: { drawOrder: true } });
      const prize = await tx.prize.create({ data: { eventId, ...values, drawOrder: (last._max.drawOrder ?? 0) + 1 } });
      await appendAudit(tx, {
        eventId,
        actor: "admin",
        action: "prize.created",
        entityType: "prize",
        entityId: prize.id,
        payload: { code: prize.code, name: prize.name, quantity: prize.quantity, categoryId: prize.categoryId, drawOrder: prize.drawOrder },
      });
      return prize;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PrizeError("DUPLICATE_CODE", DUPLICATE_CODE);
    throw error;
  }
}

export async function updatePrize(database: Db, eventId: string, prizeId: string, input: PrizeInput) {
  try {
    return await database.$transaction(async (tx) => {
      await assertRosterEditable(tx, eventId);
      const existing = await tx.prize.findFirst({ where: { id: prizeId, eventId } });
      if (!existing) throw new PrizeError("NOT_FOUND");
      const values = await validated(tx, eventId, input, prizeId);
      const updated = await tx.prize.update({ where: { id: prizeId }, data: values });
      const changes = Object.fromEntries(
        (["code", "name", "description", "quantity", "categoryId"] as const)
          .filter((key) => existing[key] !== updated[key])
          .map((key) => [key, key === "description" ? { changed: true } : { from: existing[key], to: updated[key] }]),
      );
      await appendAudit(tx, { eventId, actor: "admin", action: "prize.updated", entityType: "prize", entityId: prizeId, payload: { code: updated.code, changes } });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PrizeError("DUPLICATE_CODE", DUPLICATE_CODE);
    throw error;
  }
}

export async function setPrizeStatus(database: Db, eventId: string, prizeId: string, status: "AVAILABLE" | "WITHDRAWN") {
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    const existing = await tx.prize.findFirst({ where: { id: prizeId, eventId }, select: { code: true, status: true } });
    if (!existing) throw new PrizeError("NOT_FOUND");
    if (existing.status === status) return;
    await tx.prize.update({ where: { id: prizeId }, data: { status } });
    await appendAudit(tx, { eventId, actor: "admin", action: "prize.status_changed", entityType: "prize", entityId: prizeId, payload: { code: existing.code, from: existing.status, to: status } });
  });
}

export async function setPrizeEligibility(database: Db, eventId: string, prizeId: string, departments: readonly string[]) {
  const rule = parseEligibilityRule({ departments: departments.map((department) => department.trim()).filter(Boolean) });
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    const existing = await tx.prize.findFirst({ where: { id: prizeId, eventId }, select: { code: true, eligibilityRule: true } });
    if (!existing) throw new PrizeError("NOT_FOUND");
    const before = parseEligibilityRule(existing.eligibilityRule);
    if (JSON.stringify(before) === JSON.stringify(rule)) return rule;
    await tx.prize.update({ where: { id: prizeId }, data: { eligibilityRule: rule } });
    await appendAudit(tx, {
      eventId,
      actor: "admin",
      action: "prize.eligibility_changed",
      entityType: "prize",
      entityId: prizeId,
      payload: { code: existing.code, from: before.departments, to: rule.departments },
    });
    return rule;
  });
}

export async function movePrize(database: Db, eventId: string, prizeId: string, direction: "up" | "down") {
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    await renumberPrizes(tx, eventId);
    const ordered = await tx.prize.findMany({ where: { eventId }, orderBy: { drawOrder: "asc" }, select: { id: true, code: true, drawOrder: true } });
    const index = ordered.findIndex((row) => row.id === prizeId);
    if (index < 0) throw new PrizeError("NOT_FOUND");
    const current = ordered[index];
    const neighbour = ordered[direction === "up" ? index - 1 : index + 1];
    if (!current || !neighbour) return false;
    await tx.$executeRaw`
      UPDATE prize SET draw_order = CASE id WHEN ${current.id}::uuid THEN ${neighbour.drawOrder}::int ELSE ${current.drawOrder}::int END
      WHERE id IN (${current.id}::uuid, ${neighbour.id}::uuid)`;
    await appendAudit(tx, {
      eventId,
      actor: "admin",
      action: "prize.reordered",
      entityType: "prize",
      entityId: prizeId,
      payload: { code: current.code, from: current.drawOrder, to: neighbour.drawOrder },
    });
    return true;
  });
}

export async function deletePrize(database: Db, eventId: string, prizeId: string, purge: CachePurger) {
  const removedPhoto = await database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    const existing = await tx.prize.findFirst({ where: { id: prizeId, eventId }, include: { _count: { select: { draws: true } } } });
    if (!existing) throw new PrizeError("NOT_FOUND");
    if (existing._count.draws > 0) throw new PrizeError("HAS_DRAWS");
    await tx.prize.delete({ where: { id: prizeId } });
    const photoRemoved = await removeUnusedPhoto(tx, existing.photoId);
    await renumberPrizes(tx, eventId);
    await appendAudit(tx, { eventId, actor: "admin", action: "prize.deleted", entityType: "prize", entityId: prizeId, payload: { code: existing.code, name: existing.name } });
    return photoRemoved ? existing.photoId : null;
  });
  if (removedPhoto) await purge([mediaCacheTag(removedPhoto)]);
}

export async function replacePrizePhoto(database: Db, eventId: string, prizeId: string, bytes: Uint8Array | null, purge: CachePurger) {
  const stored = bytes ? await storeImage(database, { eventId, kind: "PRIZE_PHOTO", bytes }) : null;
  try {
    const removed = await database.$transaction(async (tx) => {
      await assertRosterEditable(tx, eventId);
      const existing = await tx.prize.findFirst({ where: { id: prizeId, eventId }, select: { code: true, photoId: true } });
      if (!existing) throw new PrizeError("NOT_FOUND");
      await tx.prize.update({ where: { id: prizeId }, data: { photoId: stored?.id ?? null } });
      const photoRemoved = await removeUnusedPhoto(tx, existing.photoId);
      await appendAudit(tx, {
        eventId,
        actor: "admin",
        action: stored ? "prize.photo_replaced" : "prize.photo_removed",
        entityType: "prize",
        entityId: prizeId,
        payload: { code: existing.code, photoSha256: stored?.sha256Hex ?? null },
      });
      return photoRemoved ? existing.photoId : null;
    });
    if (removed) await purge([mediaCacheTag(removed)]);
    return stored;
  } catch (error) {
    if (stored) await database.mediaAsset.deleteMany({ where: { id: stored.id } });
    throw error;
  }
}
