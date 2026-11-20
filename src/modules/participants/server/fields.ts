import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import type { CustomFieldDefinition, FieldDefinitionInput, FieldType } from "@/modules/participants/domain/fields";
import { assertRosterEditable } from "@/modules/raffle/server/roster-lock";

export class FieldError extends Error {
  constructor(readonly code: "DUPLICATE_KEY" | "NOT_FOUND" | "TYPE_LOCKED") {
    super(code);
  }
}

export async function listFieldDefinitions(database: Db | Prisma.TransactionClient, eventId: string) {
  const rows = await database.participantField.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type as FieldType,
    required: row.required,
    isPublic: row.isPublic,
    options: Array.isArray(row.options) ? row.options.map(String) : [],
  }));
}

export function toDefinitions(rows: Awaited<ReturnType<typeof listFieldDefinitions>>): CustomFieldDefinition[] {
  return rows.map(({ key, label, type, required, options }) => ({ key, label, type, required, options }));
}

export async function createFieldDefinition(database: Db, eventId: string, input: FieldDefinitionInput) {
  try {
    return await database.$transaction(async (tx) => {
      await assertRosterEditable(tx, eventId);
      const last = await tx.participantField.aggregate({ where: { eventId }, _max: { sortOrder: true } });
      const field = await tx.participantField.create({ data: { eventId, ...input, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
      await appendAudit(tx, { eventId, actor: "admin", action: "participant_field.created", entityType: "participant_field", entityId: field.id, payload: { ...input } });
      return field;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new FieldError("DUPLICATE_KEY");
    throw error;
  }
}

export async function updateFieldDefinition(database: Db, eventId: string, fieldId: string, input: FieldDefinitionInput) {
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    const existing = await tx.participantField.findFirst({ where: { id: fieldId, eventId } });
    if (!existing) throw new FieldError("NOT_FOUND");
    if (existing.key !== input.key || existing.type !== input.type) throw new FieldError("TYPE_LOCKED");
    const field = await tx.participantField.update({
      where: { id: fieldId },
      data: { label: input.label, required: input.required, isPublic: input.isPublic, options: input.options },
    });
    await appendAudit(tx, { eventId, actor: "admin", action: "participant_field.updated", entityType: "participant_field", entityId: fieldId, payload: { ...input } });
    return field;
  });
}

export async function deleteFieldDefinition(database: Db, eventId: string, fieldId: string) {
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    const existing = await tx.participantField.findFirst({ where: { id: fieldId, eventId } });
    if (!existing) throw new FieldError("NOT_FOUND");
    const cleared = await tx.$executeRaw`UPDATE participant SET custom_values = custom_values - ${existing.key} WHERE event_id = ${eventId}::uuid AND custom_values ? ${existing.key}`;
    await tx.participantField.delete({ where: { id: fieldId } });
    await appendAudit(tx, { eventId, actor: "admin", action: "participant_field.deleted", entityType: "participant_field", entityId: fieldId, payload: { key: existing.key, clearedValues: cleared } });
  });
}
