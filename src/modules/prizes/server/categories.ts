import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import { slugify } from "@/modules/events/domain/event-rules";
import { type CategoryInput, MAX_CATEGORIES_PER_EVENT } from "@/modules/prizes/domain/prizes";
import { assertRosterEditable } from "@/modules/raffle/server/roster-lock";

export type CategoryErrorCode = "NOT_FOUND" | "DUPLICATE_NAME" | "HAS_PRIZES" | "TOO_MANY";

export class CategoryError extends Error {
  constructor(readonly code: CategoryErrorCode) {
    super(code);
  }
}

type Tx = Prisma.TransactionClient;

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function assertNameFree(tx: Tx, eventId: string, name: string, exceptId?: string) {
  const clash = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM prize_category WHERE event_id = ${eventId}::uuid AND lower(name) = lower(${name}) AND id::text <> ${exceptId ?? ""}`;
  if (clash.length > 0) throw new CategoryError("DUPLICATE_NAME");
}

async function uniqueSlug(tx: Tx, eventId: string, name: string, exceptId?: string) {
  const sluggified = slugify(name);
  const base = sluggified === "event" && !/event/i.test(name) ? "category" : sluggified;
  const taken = new Set(
    (await tx.prizeCategory.findMany({ where: { eventId, slug: { startsWith: base }, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { slug: true } })).map(
      (row) => row.slug,
    ),
  );
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) if (!taken.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
}

async function renumberCategories(tx: Tx, eventId: string) {
  await tx.$executeRaw`
    UPDATE prize_category c SET sort_order = r.n
    FROM (SELECT id, row_number() OVER (ORDER BY sort_order, created_at, id) AS n FROM prize_category WHERE event_id = ${eventId}::uuid) r
    WHERE c.id = r.id AND c.sort_order <> r.n`;
}

export async function listCategories(database: Db | Tx, eventId: string) {
  return database.prizeCategory.findMany({
    where: { eventId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, slug: true, description: true, sceneKey: true, sortOrder: true, _count: { select: { prizes: true } } },
  });
}

export async function createCategory(database: Db, eventId: string, input: CategoryInput) {
  try {
    return await database.$transaction(async (tx) => {
      await assertRosterEditable(tx, eventId);
      if ((await tx.prizeCategory.count({ where: { eventId } })) >= MAX_CATEGORIES_PER_EVENT) throw new CategoryError("TOO_MANY");
      await assertNameFree(tx, eventId, input.name);
      const last = await tx.prizeCategory.aggregate({ where: { eventId }, _max: { sortOrder: true } });
      const category = await tx.prizeCategory.create({
        data: { eventId, ...input, slug: await uniqueSlug(tx, eventId, input.name), sortOrder: (last._max.sortOrder ?? 0) + 1 },
      });
      await appendAudit(tx, { eventId, actor: "admin", action: "prize_category.created", entityType: "prize_category", entityId: category.id, payload: { ...input, slug: category.slug } });
      return category;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CategoryError("DUPLICATE_NAME");
    throw error;
  }
}

export async function updateCategory(database: Db, eventId: string, categoryId: string, input: CategoryInput) {
  try {
    return await database.$transaction(async (tx) => {
      await assertRosterEditable(tx, eventId);
      const existing = await tx.prizeCategory.findFirst({ where: { id: categoryId, eventId } });
      if (!existing) throw new CategoryError("NOT_FOUND");
      await assertNameFree(tx, eventId, input.name, categoryId);
      const slug = existing.name === input.name ? existing.slug : await uniqueSlug(tx, eventId, input.name, categoryId);
      const updated = await tx.prizeCategory.update({ where: { id: categoryId }, data: { ...input, slug } });
      const changes = Object.fromEntries(
        (["name", "description", "sceneKey"] as const).filter((key) => existing[key] !== updated[key]).map((key) => [key, { from: existing[key], to: updated[key] }]),
      );
      await appendAudit(tx, { eventId, actor: "admin", action: "prize_category.updated", entityType: "prize_category", entityId: categoryId, payload: { changes } });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CategoryError("DUPLICATE_NAME");
    throw error;
  }
}

export async function deleteCategory(database: Db, eventId: string, categoryId: string) {
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    const existing = await tx.prizeCategory.findFirst({ where: { id: categoryId, eventId }, include: { _count: { select: { prizes: true } } } });
    if (!existing) throw new CategoryError("NOT_FOUND");
    if (existing._count.prizes > 0) throw new CategoryError("HAS_PRIZES");
    await tx.prizeCategory.delete({ where: { id: categoryId } });
    await renumberCategories(tx, eventId);
    await appendAudit(tx, { eventId, actor: "admin", action: "prize_category.deleted", entityType: "prize_category", entityId: categoryId, payload: { name: existing.name } });
  });
}

export async function moveCategory(database: Db, eventId: string, categoryId: string, direction: "up" | "down") {
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    await renumberCategories(tx, eventId);
    const ordered = await tx.prizeCategory.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" }, select: { id: true, sortOrder: true } });
    const index = ordered.findIndex((row) => row.id === categoryId);
    if (index < 0) throw new CategoryError("NOT_FOUND");
    const neighbour = ordered[direction === "up" ? index - 1 : index + 1];
    const current = ordered[index];
    if (!neighbour || !current) return false;
    await tx.$executeRaw`
      UPDATE prize_category SET sort_order = CASE id WHEN ${current.id}::uuid THEN ${neighbour.sortOrder}::int ELSE ${current.sortOrder}::int END
      WHERE id IN (${current.id}::uuid, ${neighbour.id}::uuid)`;
    await appendAudit(tx, {
      eventId,
      actor: "admin",
      action: "prize_category.reordered",
      entityType: "prize_category",
      entityId: categoryId,
      payload: { from: current.sortOrder, to: neighbour.sortOrder },
    });
    return true;
  });
}
