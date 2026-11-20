import { z } from "zod";
import {
  type BuiltinFieldKey,
  type BuiltinValues,
  type CustomFieldDefinition,
  type CustomValue,
  normalizeBuiltinValues,
  validateCustomValues,
} from "@/modules/participants/domain/fields";
import { PHOTO_TARGET, type ImportTarget } from "@/modules/imports/domain/mapping";

export const cellSchema = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]);
export const rawRowSchema = z.object({
  rowNumber: z.number().int().min(1).max(1_000_000),
  cells: z.array(cellSchema).max(200),
});
export type RawRow = z.infer<typeof rawRowSchema>;

export type RowIssue = { field: string; code: string; message: string };

export type ParticipantDraft = BuiltinValues & { customValues: Record<string, CustomValue> };

export type NormalizedRow = {
  rowNumber: number;
  draft: ParticipantDraft | null;
  photoRef: string | null;
  errors: RowIssue[];
  warnings: RowIssue[];
};

export function normalizeRow(row: RawRow, mapping: readonly (ImportTarget | null)[], definitions: readonly CustomFieldDefinition[]): NormalizedRow {
  const builtin: Partial<Record<BuiltinFieldKey, unknown>> = {};
  const custom: Record<string, unknown> = {};
  let photoRef: string | null = null;

  mapping.forEach((target, column) => {
    if (!target) return;
    const cell = row.cells[column] ?? null;
    if (target === PHOTO_TARGET) {
      const text = cell === null ? "" : String(cell).trim();
      photoRef = text || null;
    } else if (target.startsWith("custom:")) {
      custom[target.slice(7)] = cell;
    } else {
      builtin[target as BuiltinFieldKey] = cell;
    }
  });

  const errors: RowIssue[] = [];
  const builtinResult = normalizeBuiltinValues(builtin);
  for (const [field, message] of Object.entries(builtinResult.errors)) errors.push({ field, code: "INVALID_VALUE", message });
  const customResult = validateCustomValues(definitions, custom);
  for (const [field, message] of Object.entries(customResult.errors)) errors.push({ field: `custom:${field}`, code: "INVALID_VALUE", message });

  const isEmpty = row.cells.every((cell) => cell === null || (typeof cell === "string" && cell.trim() === ""));
  if (isEmpty) return { rowNumber: row.rowNumber, draft: null, photoRef: null, errors: [{ field: "row", code: "EMPTY_ROW", message: "The row is empty." }], warnings: [] };

  return {
    rowNumber: row.rowNumber,
    draft: { ...builtinResult.values, customValues: customResult.values },
    photoRef,
    errors,
    warnings: [],
  };
}

export type ExistingParticipant = { id: string; externalId: string; fullName: string };

export type PlannedRow = NormalizedRow & { action: "CREATE" | "UPDATE" | "SKIP" | "INVALID"; participantId: string | null };

export function planRows(rows: readonly NormalizedRow[], existing: readonly ExistingParticipant[], mode: "SKIP" | "UPDATE" | "REJECT"): PlannedRow[] {
  const existingById = new Map(existing.map((participant) => [participant.externalId.toLowerCase(), participant]));
  const existingNames = new Map<string, string>();
  for (const participant of existing) existingNames.set(participant.fullName.toLowerCase(), participant.externalId);

  const idCounts = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.draft) continue;
    const id = row.draft.externalId.toLowerCase();
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    const name = row.draft.fullName.toLowerCase();
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return rows.map((row) => {
    const errors = [...row.errors];
    const warnings = [...row.warnings];
    let participantId: string | null = null;
    let action: PlannedRow["action"] = "CREATE";

    if (row.draft) {
      const id = row.draft.externalId.toLowerCase();
      if (id && (idCounts.get(id) ?? 0) > 1) {
        errors.push({ field: "externalId", code: "DUPLICATE_IN_FILE", message: `Employee ID ${row.draft.externalId} appears ${idCounts.get(id)} times in this file.` });
      }
      const match = id ? existingById.get(id) : undefined;
      if (match) {
        participantId = match.id;
        if (mode === "REJECT") errors.push({ field: "externalId", code: "DUPLICATE_EXISTING", message: `Employee ID ${row.draft.externalId} is already registered.` });
        else if (mode === "SKIP") {
          action = "SKIP";
          warnings.push({ field: "externalId", code: "SKIPPED_EXISTING", message: `Employee ID ${row.draft.externalId} is already registered and will be left unchanged.` });
        } else action = "UPDATE";
      }
      const name = row.draft.fullName.toLowerCase();
      if (name && (nameCounts.get(name) ?? 0) > 1) {
        warnings.push({ field: "fullName", code: "POSSIBLE_DUPLICATE_NAME", message: `${row.draft.fullName} appears more than once in this file with different employee IDs.` });
      } else if (name && !match && existingNames.has(name)) {
        warnings.push({ field: "fullName", code: "POSSIBLE_DUPLICATE_NAME", message: `${row.draft.fullName} is already registered as ${existingNames.get(name)}.` });
      }
    }

    if (errors.length > 0) action = "INVALID";
    return { ...row, errors, warnings, action, participantId: action === "UPDATE" || action === "SKIP" ? participantId : null };
  });
}
