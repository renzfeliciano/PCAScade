import { describe, expect, it } from "vitest";
import { mappingProblems, participantTargets, suggestMapping } from "@/modules/imports/domain/mapping";
import { inspectZipEntryName, matchPhotos } from "@/modules/imports/domain/photos";
import { csvCell, issuesReportCsv } from "@/modules/imports/domain/report";
import { normalizeRow, planRows } from "@/modules/imports/domain/rows";
import { type CustomFieldDefinition, fieldDefinitionSchema, normalizeCustomValue } from "@/modules/participants/domain/fields";

const shirt: CustomFieldDefinition = { key: "shirt_size", label: "Shirt size", type: "SINGLE_SELECT", required: true, options: ["S", "M", "L"] };
const interests: CustomFieldDefinition = { key: "interests", label: "Interests", type: "MULTI_SELECT", required: false, options: ["Golf", "Chess", "Running"] };
const started: CustomFieldDefinition = { key: "start_date", label: "Start date", type: "DATE", required: false, options: [] };
const years: CustomFieldDefinition = { key: "years", label: "Years of service", type: "NUMBER", required: false, options: [] };
const vegetarian: CustomFieldDefinition = { key: "vegetarian", label: "Vegetarian", type: "BOOLEAN", required: false, options: [] };
const definitions = [shirt, interests, started, years, vegetarian];

describe("column mapping", () => {
  it("recognises common header spellings in any order", () => {
    const headers = ["Dept.", "Complete Name", "Shirt Size", "EMP NO", "Position", "Photo", "Unrelated"];
    expect(suggestMapping(headers, definitions)).toEqual(["department", "fullName", "custom:shirt_size", "externalId", "jobTitle", "photoFilename", null]);
  });

  it("reports missing required targets and columns mapped twice", () => {
    const targets = participantTargets(definitions);
    const problems = mappingProblems(["fullName", "fullName", null], targets);
    expect(problems.join(" ")).toMatch(/Full name is mapped from 2 columns/);
    expect(problems.join(" ")).toMatch(/Employee ID; it is required/);
    expect(problems.join(" ")).toMatch(/Shirt size; it is required/);
    expect(mappingProblems(["externalId", "fullName", "custom:shirt_size", "custom:nope"], targets).join(" ")).toMatch(/unknown field/);
  });
});

describe("custom field values", () => {
  it("normalises each field type and explains rejections", () => {
    expect(normalizeCustomValue(shirt, " m ")).toEqual({ ok: true, value: "M" });
    expect(normalizeCustomValue(shirt, "XL")).toMatchObject({ ok: false, message: expect.stringMatching(/one of: S, M, L/) });
    expect(normalizeCustomValue(shirt, "")).toMatchObject({ ok: false, message: "Shirt size is required." });
    expect(normalizeCustomValue(interests, "golf; RUNNING, golf")).toEqual({ ok: true, value: ["Golf", "Running"] });
    expect(normalizeCustomValue(interests, "golf; swimming")).toMatchObject({ ok: false });
    expect(normalizeCustomValue(started, "2024-02-29")).toEqual({ ok: true, value: "2024-02-29" });
    expect(normalizeCustomValue(started, "2023-02-29")).toMatchObject({ ok: false, message: expect.stringMatching(/real calendar date/) });
    expect(normalizeCustomValue(started, "02/03/2024")).toMatchObject({ ok: false, message: expect.stringMatching(/YYYY-MM-DD/) });
    expect(normalizeCustomValue(years, "1,250.5")).toEqual({ ok: true, value: 1250.5 });
    expect(normalizeCustomValue(years, "ten")).toMatchObject({ ok: false });
    expect(normalizeCustomValue(vegetarian, "Yes")).toEqual({ ok: true, value: true });
    expect(normalizeCustomValue(vegetarian, "maybe")).toMatchObject({ ok: false });
  });

  it("validates field definitions", () => {
    const base = { key: "shirt_size", label: "Shirt size", type: "SINGLE_SELECT" as const, required: false, isPublic: false, options: ["S"] };
    expect(fieldDefinitionSchema.safeParse(base).success).toBe(true);
    expect(fieldDefinitionSchema.safeParse({ ...base, options: [] }).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse({ ...base, options: ["S", "s"] }).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse({ ...base, key: "Shirt Size" }).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse({ ...base, key: "email" }).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse({ ...base, type: "TEXT" }).success).toBe(false);
  });
});

describe("row normalisation and planning", () => {
  const mapping = ["externalId", "fullName", "department", "custom:shirt_size", "eligible", "email", "photoFilename"];

  it("normalises whitespace, case and eligibility and keeps the photo reference", () => {
    const row = normalizeRow({ rowNumber: 2, cells: ["  EMP-001 ", "Juan   Dela Cruz", "IT", "m", "no", "Juan@PCAS.example", "photos/EMP-001.JPG"] }, mapping, definitions);
    expect(row.errors).toEqual([]);
    expect(row.draft).toMatchObject({ externalId: "EMP-001", fullName: "Juan Dela Cruz", department: "IT", eligible: false, email: "juan@pcas.example", customValues: { shirt_size: "M" } });
    expect(row.photoRef).toBe("photos/EMP-001.JPG");
  });

  it("collects every problem in a row with the field it belongs to", () => {
    const row = normalizeRow({ rowNumber: 3, cells: ["", "", "IT", "XXL", "perhaps", "not-an-email", null] }, mapping, definitions);
    expect(row.errors.map((issue) => issue.field).sort()).toEqual(["custom:shirt_size", "eligible", "email", "externalId", "fullName"]);
  });

  it("flags empty rows", () => {
    expect(normalizeRow({ rowNumber: 4, cells: [null, " ", null] }, mapping, definitions).errors[0]?.code).toBe("EMPTY_ROW");
  });

  it("plans creates, duplicates and existing participants for each duplicate mode", () => {
    const rows = [
      normalizeRow({ rowNumber: 2, cells: ["EMP-1", "Ana Reyes", "", "S"] }, mapping, definitions),
      normalizeRow({ rowNumber: 3, cells: ["emp-1", "Ana R.", "", "S"] }, mapping, definitions),
      normalizeRow({ rowNumber: 4, cells: ["EMP-2", "Ben Cruz", "", "S"] }, mapping, definitions),
      normalizeRow({ rowNumber: 5, cells: ["EMP-3", "Carla Lim", "", "S"] }, mapping, definitions),
    ];
    const existing = [{ id: "p-2", externalId: "EMP-2", fullName: "Ben Cruz" }, { id: "p-9", externalId: "EMP-9", fullName: "Carla Lim" }];

    const skip = planRows(rows, existing, "SKIP");
    expect(skip.map((row) => row.action)).toEqual(["INVALID", "INVALID", "SKIP", "CREATE"]);
    expect(skip[0]?.errors[0]?.code).toBe("DUPLICATE_IN_FILE");
    expect(skip[3]?.warnings[0]?.code).toBe("POSSIBLE_DUPLICATE_NAME");

    expect(planRows(rows, existing, "UPDATE")[2]).toMatchObject({ action: "UPDATE", participantId: "p-2" });
    expect(planRows(rows, existing, "REJECT")[2]).toMatchObject({ action: "INVALID", participantId: null });
  });
});

describe("ZIP and photo matching", () => {
  it("refuses unsafe, hidden, system and unsupported entries", () => {
    expect(inspectZipEntryName("photos/EMP-001.jpg")).toEqual({ ok: true, name: "photos/EMP-001.jpg", key: "emp-001.jpg" });
    expect(inspectZipEntryName("../../etc/passwd.jpg")).toMatchObject({ ok: false, reason: "UNSAFE_PATH" });
    expect(inspectZipEntryName("/abs/EMP.jpg")).toMatchObject({ ok: false, reason: "UNSAFE_PATH" });
    expect(inspectZipEntryName("C:\\Users\\x.jpg")).toMatchObject({ ok: false, reason: "UNSAFE_PATH" });
    expect(inspectZipEntryName("a\u0000b.jpg")).toMatchObject({ ok: false, reason: "UNSAFE_PATH" });
    expect(inspectZipEntryName("__MACOSX/photos/._EMP-001.jpg")).toMatchObject({ ok: false, reason: "SYSTEM_FILE" });
    expect(inspectZipEntryName("photos/.hidden.jpg")).toMatchObject({ ok: false, reason: "SYSTEM_FILE" });
    expect(inspectZipEntryName("photos/")).toMatchObject({ ok: false, reason: "DIRECTORY" });
    expect(inspectZipEntryName("photos/EMP-001.heic")).toMatchObject({ ok: false, reason: "UNSUPPORTED_TYPE" });
    expect(inspectZipEntryName("photos/EMP-001.jpg.exe")).toMatchObject({ ok: false, reason: "UNSUPPORTED_TYPE" });
  });

  it("matches by file name column or by employee ID and reports missing, ambiguous and shared photos", () => {
    const entries = ["photos/EMP-001.jpg", "EMP-002.png", "dup/EMP-003.jpg", "other/EMP-003.png", "shared.jpg"].map((name) => {
      const verdict = inspectZipEntryName(name);
      if (!verdict.ok) throw new Error(name);
      return { name: verdict.name, key: verdict.key };
    });
    const byColumn = matchPhotos(
      [
        { rowNumber: 2, photoRef: "EMP-001.JPG", externalId: "EMP-001" },
        { rowNumber: 3, photoRef: "missing.jpg", externalId: "EMP-404" },
        { rowNumber: 4, photoRef: "shared.jpg", externalId: "A" },
        { rowNumber: 5, photoRef: "shared.jpg", externalId: "B" },
        { rowNumber: 6, photoRef: null, externalId: "C" },
      ],
      entries,
      { match: "COLUMN", required: false },
    );
    expect(byColumn.map((match) => match.problem)).toEqual([null, "MISSING_PHOTO", "DUPLICATE_PHOTO", "DUPLICATE_PHOTO", "MISSING_PHOTO"]);
    expect(byColumn[0]?.entryName).toBe("photos/EMP-001.jpg");

    const byId = matchPhotos(
      [
        { rowNumber: 2, photoRef: null, externalId: "emp-002" },
        { rowNumber: 3, photoRef: null, externalId: "EMP-003" },
      ],
      entries,
      { match: "EMPLOYEE_ID", required: true },
    );
    expect(byId).toEqual([
      { rowNumber: 2, entryName: "EMP-002.png", problem: null },
      { rowNumber: 3, entryName: null, problem: "AMBIGUOUS_PHOTO" },
    ]);
  });
});

describe("error report", () => {
  it("neutralises spreadsheet formulas and quotes properly", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+639171234567")).toBe("'+639171234567");
    expect(csvCell("plain")).toBe("plain");
    const csv = issuesReportCsv([{ rowNumber: 7, action: "INVALID", externalId: "@SUM(A1)", errors: [{ field: "email", code: "X", message: "Bad, really" }], warnings: [] }]);
    expect(csv.startsWith("\uFEFFrow,employee_id")).toBe(true);
    expect(csv).toContain("7,'@SUM(A1),INVALID,error,email,\"Bad, really\"");
  });
});
