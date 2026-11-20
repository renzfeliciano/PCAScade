import { z } from "zod";

export const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

export const ZIP_LIMITS = {
  maxEntries: 5000,
  maxEntryBytes: 15 * 1024 * 1024,
  maxTotalBytes: 600 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxNameLength: 200,
} as const;

export const SOURCE_IMAGE_LIMITS = { maxPixels: 40_000_000, maxSide: 12_000, minSide: 64 } as const;
export const STORED_PHOTO_MAX_SIDE = 640;

export const photoRuleSchema = z.object({
  match: z.enum(["COLUMN", "EMPLOYEE_ID"]),
  required: z.boolean(),
});
export type PhotoRule = z.infer<typeof photoRuleSchema>;

export type ZipEntryVerdict =
  | { ok: true; name: string; key: string }
  | { ok: false; name: string; reason: "DIRECTORY" | "SYSTEM_FILE" | "UNSAFE_PATH" | "UNSUPPORTED_TYPE" | "NAME_TOO_LONG" };

export function inspectZipEntryName(rawName: string): ZipEntryVerdict {
  const name = rawName.normalize("NFC");
  if (name.endsWith("/") || name.endsWith("\\")) return { ok: false, name, reason: "DIRECTORY" };
  if (name.length > ZIP_LIMITS.maxNameLength) return { ok: false, name: name.slice(0, 60), reason: "NAME_TOO_LONG" };
  if (/[\u0000-\u001f\u007f]/.test(name) || /^([a-zA-Z]:|[\\/])/.test(name)) return { ok: false, name, reason: "UNSAFE_PATH" };
  const segments = name.split(/[\\/]+/);
  if (segments.some((segment) => segment === ".." || segment === ".")) return { ok: false, name, reason: "UNSAFE_PATH" };
  const base = segments.at(-1) ?? "";
  if (segments.includes("__MACOSX") || base.startsWith(".") || base.toLowerCase() === "thumbs.db" || base.toLowerCase() === "desktop.ini") {
    return { ok: false, name, reason: "SYSTEM_FILE" };
  }
  const lower = base.toLowerCase();
  if (!PHOTO_EXTENSIONS.some((extension) => lower.endsWith(extension))) return { ok: false, name, reason: "UNSUPPORTED_TYPE" };
  return { ok: true, name, key: lower };
}

export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export function photoKeyForRow(rule: PhotoRule, photoRef: string | null, externalId: string): { key: string; byStem: boolean } | null {
  if (rule.match === "EMPLOYEE_ID") return externalId ? { key: externalId.trim().toLowerCase(), byStem: true } : null;
  if (!photoRef) return null;
  const base = photoRef.split(/[\\/]+/).at(-1)?.trim().toLowerCase() ?? "";
  return base ? { key: base, byStem: false } : null;
}

export type PhotoMatch = { rowNumber: number; entryName: string | null; problem: "MISSING_PHOTO" | "DUPLICATE_PHOTO" | "AMBIGUOUS_PHOTO" | null };

export function matchPhotos(
  rows: readonly { rowNumber: number; photoRef: string | null; externalId: string }[],
  entries: readonly { name: string; key: string }[],
  rule: PhotoRule,
): PhotoMatch[] {
  const byName = new Map<string, string[]>();
  const byStem = new Map<string, string[]>();
  for (const entry of entries) {
    byName.set(entry.key, [...(byName.get(entry.key) ?? []), entry.name]);
    const stem = stripExtension(entry.key);
    byStem.set(stem, [...(byStem.get(stem) ?? []), entry.name]);
  }
  const results = rows.map((row): PhotoMatch => {
    const wanted = photoKeyForRow(rule, row.photoRef, row.externalId);
    if (!wanted) return { rowNumber: row.rowNumber, entryName: null, problem: "MISSING_PHOTO" };
    const found = wanted.byStem ? byStem.get(wanted.key) : byName.get(wanted.key) ?? byStem.get(stripExtension(wanted.key));
    if (!found || found.length === 0) return { rowNumber: row.rowNumber, entryName: null, problem: "MISSING_PHOTO" };
    if (found.length > 1) return { rowNumber: row.rowNumber, entryName: null, problem: "AMBIGUOUS_PHOTO" };
    return { rowNumber: row.rowNumber, entryName: found[0] ?? null, problem: null };
  });
  const usage = new Map<string, number>();
  for (const result of results) if (result.entryName) usage.set(result.entryName, (usage.get(result.entryName) ?? 0) + 1);
  return results.map((result) => (result.entryName && (usage.get(result.entryName) ?? 0) > 1 ? { ...result, problem: "DUPLICATE_PHOTO" } : result));
}

export function photoProblemMessage(problem: NonNullable<PhotoMatch["problem"]>, entryName: string | null): string {
  if (problem === "MISSING_PHOTO") return "No matching photo was found in the ZIP file.";
  if (problem === "AMBIGUOUS_PHOTO") return "More than one photo in the ZIP file matches this row.";
  return `${entryName ?? "The same photo"} is used by more than one row.`;
}
