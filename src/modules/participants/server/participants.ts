import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import { type BuiltinFieldKey, normalizeBuiltinValues, validateCustomValues } from "@/modules/participants/domain/fields";
import { listFieldDefinitions, toDefinitions } from "@/modules/participants/server/fields";
import { type CachePurger, mediaCacheTag, storeImage } from "@/modules/media/server/photo-store";
import { assertRosterEditable } from "@/modules/raffle/server/roster-lock";

export type ParticipantErrorCode = "NOT_FOUND" | "DUPLICATE_EXTERNAL_ID" | "INVALID" | "HAS_WINS";

export class ParticipantError extends Error {
  constructor(
    readonly code: ParticipantErrorCode,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(code);
  }
}

export type ParticipantInput = { builtin: Partial<Record<BuiltinFieldKey, unknown>>; custom: Record<string, unknown> };

async function validated(database: Db | Prisma.TransactionClient, eventId: string, input: ParticipantInput) {
  const definitions = toDefinitions(await listFieldDefinitions(database, eventId));
  const builtin = normalizeBuiltinValues(input.builtin);
  const custom = validateCustomValues(definitions, input.custom);
  const fieldErrors = { ...builtin.errors, ...Object.fromEntries(Object.entries(custom.errors).map(([key, message]) => [`custom:${key}`, message])) };
  if (Object.keys(fieldErrors).length > 0) throw new ParticipantError("INVALID", fieldErrors);
  return { ...builtin.values, customValues: custom.values };
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function listParticipants(database: Db, eventId: string, options: { query?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const page = Math.max(options.page ?? 1, 1);
  const query = options.query?.trim().slice(0, 100);
  const where: Prisma.ParticipantWhereInput = {
    eventId,
    ...(query
      ? {
          OR: [
            { fullName: { contains: query, mode: "insensitive" } },
            { externalId: { contains: query, mode: "insensitive" } },
            { department: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    database.participant.findMany({
      where,
      orderBy: [{ fullName: "asc" }, { externalId: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, externalId: true, fullName: true, department: true, jobTitle: true, eligible: true, status: true, photoId: true },
    }),
    database.participant.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getParticipant(database: Db, eventId: string, participantId: string) {
  return database.participant.findFirst({ where: { id: participantId, eventId } });
}

export async function createParticipant(database: Db, eventId: string, input: ParticipantInput) {
  try {
    return await database.$transaction(async (tx) => {
      await assertRosterEditable(tx, eventId);
      const values = await validated(tx, eventId, input);
      const participant = await tx.participant.create({ data: { eventId, ...values } });
      await appendAudit(tx, { eventId, actor: "admin", action: "participant.created", entityType: "participant", entityId: participant.id, payload: { externalId: values.externalId } });
      return participant;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ParticipantError("DUPLICATE_EXTERNAL_ID", { externalId: "Another participant already uses this employee ID." });
    throw error;
  }
}

export async function updateParticipant(database: Db, eventId: string, participantId: string, input: ParticipantInput) {
  try {
    return await database.$transaction(async (tx) => {
      await assertRosterEditable(tx, eventId);
      const existing = await tx.participant.findFirst({ where: { id: participantId, eventId } });
      if (!existing) throw new ParticipantError("NOT_FOUND");
      const values = await validated(tx, eventId, input);
      const updated = await tx.participant.update({ where: { id: participantId }, data: values });
      const changed = (["externalId", "fullName", "department", "jobTitle", "bio", "email", "eligible"] as const).filter((key) => existing[key] !== updated[key]);
      const customChanged = JSON.stringify(existing.customValues) !== JSON.stringify(updated.customValues);
      await appendAudit(tx, {
        eventId,
        actor: "admin",
        action: "participant.updated",
        entityType: "participant",
        entityId: participantId,
        payload: { changedFields: customChanged ? [...changed, "customValues"] : changed },
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ParticipantError("DUPLICATE_EXTERNAL_ID", { externalId: "Another participant already uses this employee ID." });
    throw error;
  }
}

export async function setParticipantStatus(database: Db, eventId: string, participantId: string, status: "ACTIVE" | "INACTIVE") {
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    const result = await tx.participant.updateMany({ where: { id: participantId, eventId }, data: { status } });
    if (result.count !== 1) throw new ParticipantError("NOT_FOUND");
    await appendAudit(tx, { eventId, actor: "admin", action: "participant.status_changed", entityType: "participant", entityId: participantId, payload: { status } });
  });
}

export async function deleteParticipant(database: Db, eventId: string, participantId: string, purge: CachePurger) {
  const photoId = await database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    const existing = await tx.participant.findFirst({ where: { id: participantId, eventId }, include: { _count: { select: { wins: true } } } });
    if (!existing) throw new ParticipantError("NOT_FOUND");
    if (existing._count.wins > 0) throw new ParticipantError("HAS_WINS");
    await tx.participant.delete({ where: { id: participantId } });
    if (existing.photoId) {
      const stillUsed = await tx.participant.count({ where: { photoId: existing.photoId } });
      if (stillUsed === 0) await tx.mediaAsset.deleteMany({ where: { id: existing.photoId } });
    }
    await appendAudit(tx, { eventId, actor: "admin", action: "participant.deleted", entityType: "participant", entityId: participantId, payload: { externalId: existing.externalId } });
    return existing.photoId;
  });
  if (photoId) await purge([mediaCacheTag(photoId)]);
}

export async function replaceParticipantPhoto(database: Db, eventId: string, participantId: string, bytes: Uint8Array | null, purge: CachePurger) {
  const stored = bytes ? await storeImage(database, { eventId, kind: "PARTICIPANT_PHOTO", bytes }) : null;
  try {
    const previous = await database.$transaction(async (tx) => {
      await assertRosterEditable(tx, eventId);
      const existing = await tx.participant.findFirst({ where: { id: participantId, eventId }, select: { photoId: true } });
      if (!existing) throw new ParticipantError("NOT_FOUND");
      await tx.participant.update({ where: { id: participantId }, data: { photoId: stored?.id ?? null } });
      if (existing.photoId) {
        const stillUsed = await tx.participant.count({ where: { photoId: existing.photoId } });
        if (stillUsed === 0) await tx.mediaAsset.deleteMany({ where: { id: existing.photoId } });
      }
      await appendAudit(tx, {
        eventId,
        actor: "admin",
        action: stored ? "participant.photo_replaced" : "participant.photo_removed",
        entityType: "participant",
        entityId: participantId,
        payload: { photoSha256: stored?.sha256Hex ?? null },
      });
      return existing.photoId;
    });
    if (previous) await purge([mediaCacheTag(previous)]);
    return stored;
  } catch (error) {
    if (stored) await database.mediaAsset.deleteMany({ where: { id: stored.id } });
    throw error;
  }
}
