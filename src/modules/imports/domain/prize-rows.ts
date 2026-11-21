import { PHOTO_TARGET, type ImportTarget } from "@/modules/imports/domain/mapping";
import type { RawRow, RowIssue } from "@/modules/imports/domain/rows";
import { type CategoryRef, type PrizeFieldKey, type PrizeValues, normalizePrizeValues, resolveCategory } from "@/modules/prizes/domain/prizes";

export type PrizeDraft = PrizeValues & { categoryId: string | null; mapped: PrizeFieldKey[] };

export type NormalizedPrizeRow = {
  rowNumber: number;
  draft: PrizeDraft | null;
  photoRef: string | null;
  errors: RowIssue[];
  warnings: RowIssue[];
};

export function normalizePrizeRow(row: RawRow, mapping: readonly (ImportTarget | null)[], categories: readonly CategoryRef[]): NormalizedPrizeRow {
  const raw: Partial<Record<PrizeFieldKey, unknown>> = {};
  const mapped: PrizeFieldKey[] = [];
  let photoRef: string | null = null;
  mapping.forEach((target, column) => {
    if (!target) return;
    const cell = row.cells[column] ?? null;
    if (target === PHOTO_TARGET) {
      const text = cell === null ? "" : String(cell).trim();
      photoRef = text || null;
      return;
    }
    raw[target as PrizeFieldKey] = cell;
    mapped.push(target as PrizeFieldKey);
  });

  const isEmpty = row.cells.every((cell) => cell === null || (typeof cell === "string" && cell.trim() === ""));
  if (isEmpty) return { rowNumber: row.rowNumber, draft: null, photoRef: null, errors: [{ field: "row", code: "EMPTY_ROW", message: "The row is empty." }], warnings: [] };

  const { values, errors: fieldErrors } = normalizePrizeValues(raw);
  const errors: RowIssue[] = Object.entries(fieldErrors).map(([field, message]) => ({ field, code: "INVALID_VALUE", message }));
  const category = resolveCategory(raw.category, categories);
  if (!category.ok) errors.push({ field: "category", code: "UNKNOWN_CATEGORY", message: category.message });

  return {
    rowNumber: row.rowNumber,
    draft: { ...values, categoryId: category.ok ? category.id : null, mapped },
    photoRef,
    errors,
    warnings: [],
  };
}

export type ExistingPrize = { id: string; code: string; name: string };

export type PlannedPrizeRow = NormalizedPrizeRow & { action: "CREATE" | "UPDATE" | "SKIP" | "INVALID"; prizeId: string | null };

export function planPrizeRows(rows: readonly NormalizedPrizeRow[], existing: readonly ExistingPrize[], mode: "SKIP" | "UPDATE" | "REJECT"): PlannedPrizeRow[] {
  const existingByCode = new Map(existing.map((prize) => [prize.code.toLowerCase(), prize]));
  const codeCounts = new Map<string, number>();
  for (const row of rows) {
    const code = row.draft?.code.toLowerCase();
    if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  }

  return rows.map((row) => {
    const errors = [...row.errors];
    const warnings = [...row.warnings];
    let action: PlannedPrizeRow["action"] = "CREATE";
    let prizeId: string | null = null;
    if (row.draft) {
      const code = row.draft.code.toLowerCase();
      if (code && (codeCounts.get(code) ?? 0) > 1) {
        errors.push({ field: "code", code: "DUPLICATE_IN_FILE", message: `Prize code ${row.draft.code} appears ${codeCounts.get(code)} times in this file.` });
      }
      const match = code ? existingByCode.get(code) : undefined;
      if (match) {
        prizeId = match.id;
        if (mode === "REJECT") errors.push({ field: "code", code: "DUPLICATE_EXISTING", message: `Prize code ${row.draft.code} already exists.` });
        else if (mode === "SKIP") {
          action = "SKIP";
          warnings.push({ field: "code", code: "SKIPPED_EXISTING", message: `Prize code ${row.draft.code} already exists and will be left unchanged.` });
        } else action = "UPDATE";
      }
    }
    if (errors.length > 0) action = "INVALID";
    return { ...row, errors, warnings, action, prizeId: action === "UPDATE" || action === "SKIP" ? prizeId : null };
  });
}
