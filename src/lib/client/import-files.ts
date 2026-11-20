import { unzip } from "fflate";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
import { ZIP_LIMITS, inspectZipEntryName } from "@/modules/imports/domain/photos";

export type Cell = string | number | boolean | null;

export type ParsedSheet = { headers: string[]; rows: { rowNumber: number; cells: Cell[] }[]; sheetNames: string[]; sheetName: string | null };

export const MAX_SPREADSHEET_BYTES = 20 * 1024 * 1024;
export const MAX_ZIP_BYTES = 300 * 1024 * 1024;

function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "string") return value.slice(0, 4000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 4000);
}

function isEmpty(row: readonly unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === ""));
}

function fromGrid(grid: readonly (readonly unknown[])[], sheetNames: string[], sheetName: string | null): ParsedSheet {
  const headerIndex = grid.findIndex((row) => !isEmpty(row));
  if (headerIndex === -1) return { headers: [], rows: [], sheetNames, sheetName };
  const headerRow = grid[headerIndex] ?? [];
  let width = headerRow.length;
  while (width > 0 && toCell(headerRow[width - 1]) === null) width--;
  const headers = Array.from({ length: width }, (_, index) => {
    const value = toCell(headerRow[index]);
    return value === null ? `Column ${index + 1}` : String(value).trim().slice(0, 120);
  });
  const rows: ParsedSheet["rows"] = [];
  for (let index = headerIndex + 1; index < grid.length; index++) {
    const source = grid[index] ?? [];
    const cells = Array.from({ length: width }, (_, column) => toCell(source[column]));
    rows.push({ rowNumber: index + 1, cells });
  }
  while (rows.length > 0 && isEmpty(rows.at(-1)?.cells ?? [])) rows.pop();
  return { headers, rows, sheetNames, sheetName };
}

export async function parseSpreadsheet(file: File, sheetName?: string): Promise<ParsedSheet> {
  if (file.size > MAX_SPREADSHEET_BYTES) throw new Error("The spreadsheet is larger than 20 MB.");
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = (await file.text()).replace(/^﻿/, "");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    if (parsed.errors.some((error) => error.type === "Quotes")) throw new Error("The CSV file has unbalanced quotes.");
    return fromGrid(parsed.data, [], null);
  }
  if (lower.endsWith(".xlsx")) {
    const sheets = await readXlsxFile(file);
    const names = sheets.map((sheet) => sheet.sheet);
    const chosen = sheetName && names.includes(sheetName) ? sheetName : (names.find((_name, index) => !isEmpty((sheets[index]?.data ?? []).flat())) ?? names[0]);
    const data = sheets.find((sheet) => sheet.sheet === chosen)?.data ?? [];
    return fromGrid(data, names, chosen ?? null);
  }
  throw new Error("Choose an .xlsx or .csv file.");
}

export type ZipPhoto = { name: string; key: string; data: Uint8Array };
export type ZipResult = { photos: ZipPhoto[]; skipped: { name: string; reason: string }[] };

const REASONS: Record<string, string> = {
  SYSTEM_FILE: "system file",
  UNSAFE_PATH: "unsafe file path",
  UNSUPPORTED_TYPE: "not a JPEG, PNG or WebP file",
  NAME_TOO_LONG: "file name too long",
  TOO_LARGE: "larger than 15 MB",
  SUSPICIOUS_COMPRESSION: "suspicious compression ratio",
};

export async function readPhotoZip(file: File): Promise<ZipResult> {
  if (file.size > MAX_ZIP_BYTES) throw new Error("The ZIP file is larger than 300 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const skipped: ZipResult["skipped"] = [];
  let entries = 0;
  let total = 0;
  const accepted = new Map<string, string>();
  const unzipped = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      bytes,
      {
        filter(info) {
          const verdict = inspectZipEntryName(info.name);
          if (!verdict.ok) {
            if (verdict.reason !== "DIRECTORY") skipped.push({ name: verdict.name, reason: REASONS[verdict.reason] ?? verdict.reason });
            return false;
          }
          entries++;
          if (entries > ZIP_LIMITS.maxEntries) return false;
          if (info.originalSize > ZIP_LIMITS.maxEntryBytes) {
            skipped.push({ name: verdict.name, reason: REASONS.TOO_LARGE ?? "too large" });
            return false;
          }
          if (info.size > 0 && info.originalSize / info.size > ZIP_LIMITS.maxCompressionRatio) {
            skipped.push({ name: verdict.name, reason: REASONS.SUSPICIOUS_COMPRESSION ?? "suspicious" });
            return false;
          }
          total += info.originalSize;
          if (total > ZIP_LIMITS.maxTotalBytes) return false;
          accepted.set(info.name, verdict.key);
          return true;
        },
      },
      (error, data) => (error ? reject(new Error("The ZIP file is damaged or not a ZIP archive.")) : resolve(data)),
    );
  });
  if (entries > ZIP_LIMITS.maxEntries) throw new Error(`The ZIP file has more than ${ZIP_LIMITS.maxEntries} photos.`);
  if (total > ZIP_LIMITS.maxTotalBytes) throw new Error("The photos in the ZIP file are too large in total.");
  const photos = Object.entries(unzipped)
    .filter(([name, data]) => accepted.has(name) && data.length <= ZIP_LIMITS.maxEntryBytes)
    .map(([name, data]) => ({ name: name.normalize("NFC"), key: accepted.get(name) ?? name.toLowerCase(), data }));
  return { photos, skipped };
}
