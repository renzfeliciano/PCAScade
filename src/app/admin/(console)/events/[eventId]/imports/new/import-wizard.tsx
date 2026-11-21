"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import writeXlsxFile from "write-excel-file/browser";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { describeImageProblem, ImagePreparationError, prepareWebpPhoto, sha256Hex } from "@/lib/client/images";
import { type ParsedSheet, type ZipResult, parseSpreadsheet, readPhotoZip } from "@/lib/client/import-files";
import { type ImportKind, type ImportTarget, mappingProblems, participantTargets, prizeTargets, suggestMapping, suggestPrizeMapping } from "@/modules/imports/domain/mapping";
import { type PhotoRule, STORED_PHOTO_MAX_SIDE, matchPhotos, photoProblemMessage } from "@/modules/imports/domain/photos";
import { normalizePrizeRow } from "@/modules/imports/domain/prize-rows";
import { type RowIssue, normalizeRow } from "@/modules/imports/domain/rows";
import { BUILTIN_PARTICIPANT_FIELDS, type CustomFieldDefinition, FIELD_TYPE_LABELS } from "@/modules/participants/domain/fields";
import { type CategoryRef, MAX_PRIZE_QUANTITY, PRIZE_IMPORT_FIELDS, PRIZE_PHOTO_MAX_SIDE } from "@/modules/prizes/domain/prizes";
import { appendRowsAction, startImportAction, uploadImportPhotoAction, validateBatchAction } from "../actions";

type Props = { eventId: string; kind: ImportKind; definitions: CustomFieldDefinition[]; categories: CategoryRef[] };
type CheckedRow = { rowNumber: number; photoRef: string | null; key: string; errors: RowIssue[] };

const COPY = {
  PARTICIPANTS: {
    file: "Participant list (.xlsx or .csv)",
    duplicate: "When an employee ID is already registered",
    updateLabel: "Update the participant",
    skipHint: "The existing participant is left unchanged.",
    matchByKey: "Employee ID (photo named like EMP-001.jpg)",
    requirePhoto: "Every participant must have a photo",
    against: "registered participants",
  },
  PRIZES: {
    file: "Prize list (.xlsx or .csv)",
    duplicate: "When a prize code already exists",
    updateLabel: "Update the prize",
    skipHint: "The existing prize is left unchanged.",
    matchByKey: "Prize code (photo named like TV-01.jpg)",
    requirePhoto: "Every prize must have a photo",
    against: "existing prizes",
  },
} as const;
type Progress = { label: string; done: number; total: number };
type PhotoFailure = { rowNumber: number; name: string; message: string };

const MAX_CHUNK_ROWS = 500;
const MAX_CHUNK_BYTES = 600_000;

function chunkRows(rows: ParsedSheet["rows"]) {
  const chunks: ParsedSheet["rows"][] = [];
  let current: ParsedSheet["rows"] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (current.length > 0 && (current.length >= MAX_CHUNK_ROWS || bytes + size > MAX_CHUNK_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function prizeTemplateColumns(categories: CategoryRef[]) {
  const accepts: Record<string, string> = {
    code: "Unique code: letters, digits, dots, dashes and underscores, for example TV-01",
    name: "Text, up to 120 characters",
    description: "Text, up to 1000 characters",
    quantity: `Whole number from 1 to ${MAX_PRIZE_QUANTITY} (blank means 1)`,
    category: categories.length ? `One of: ${categories.map((category) => category.name).join(", ")}` : "Create categories first, or leave blank",
  };
  return [
    ...PRIZE_IMPORT_FIELDS.map((field) => ({ name: field.column, required: field.required, accepts: accepts[field.key] ?? "" })),
    { name: "photo_filename", required: false, accepts: "File name of the photo inside the ZIP file, for example TV-01.jpg" },
  ];
}

async function downloadTemplate(kind: ImportKind, definitions: CustomFieldDefinition[], categories: CategoryRef[]) {
  const columns = kind === "PRIZES" ? prizeTemplateColumns(categories) : participantTemplateColumns(definitions);
  const sheet = kind === "PRIZES" ? "Prizes" : "Participants";
  await writeXlsxFile(
    [
      { sheet, data: [columns.map((column) => ({ value: column.name, fontWeight: "bold" as const }))], columns: columns.map(() => ({ width: 22 })), stickyRowsCount: 1 },
      {
        sheet: "Instructions",
        data: [
          [{ value: "Column", fontWeight: "bold" as const }, { value: "Required", fontWeight: "bold" as const }, { value: "Accepted values", fontWeight: "bold" as const }],
          ...columns.map((column) => [{ value: column.name }, { value: column.required ? "Yes" : "No" }, { value: column.accepts }]),
        ],
        columns: [{ width: 22 }, { width: 10 }, { width: 70 }],
      },
    ],
    {},
  ).toFile(`pcascade-${sheet.toLowerCase()}-template.xlsx`);
}

function participantTemplateColumns(definitions: CustomFieldDefinition[]) {
  return [
    ...BUILTIN_PARTICIPANT_FIELDS.map((field) => ({ name: field.column, required: field.required, accepts: field.key === "eligible" ? "yes or no (blank means yes)" : `Text, up to ${field.maxLength} characters` })),
    { name: "photo_filename", required: false, accepts: "File name of the photo inside the ZIP file, for example EMP-001.jpg" },
    ...definitions.map((definition) => ({
      name: definition.key,
      required: definition.required,
      accepts:
        definition.type === "SINGLE_SELECT" || definition.type === "MULTI_SELECT"
          ? `${FIELD_TYPE_LABELS[definition.type]}: ${definition.options.join(", ")}${definition.type === "MULTI_SELECT" ? " (separate with ;)" : ""}`
          : definition.type === "DATE"
            ? "Date as YYYY-MM-DD"
            : FIELD_TYPE_LABELS[definition.type],
    })),
  ];
}

export function ImportWizard({ eventId, kind, definitions, categories }: Props) {
  const router = useRouter();
  const copy = COPY[kind];
  const targets = useMemo(() => (kind === "PRIZES" ? prizeTargets() : participantTargets(definitions)), [kind, definitions]);
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [fileSha, setFileSha] = useState("");
  const [zip, setZip] = useState<ZipResult | null>(null);
  const [mapping, setMapping] = useState<(ImportTarget | null)[]>([]);
  const [duplicateMode, setDuplicateMode] = useState<"SKIP" | "UPDATE" | "REJECT">("REJECT");
  const [rule, setRule] = useState<PhotoRule>({ match: "COLUMN", required: false });
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failures, setFailures] = useState<{ batchId: string; items: PhotoFailure[] } | null>(null);

  const normalized = useMemo((): CheckedRow[] => {
    if (!parsed) return [];
    if (kind === "PRIZES") {
      return parsed.rows.map((row) => {
        const result = normalizePrizeRow(row, mapping, categories);
        return { rowNumber: result.rowNumber, photoRef: result.photoRef, key: result.draft?.code ?? "", errors: result.errors };
      });
    }
    return parsed.rows.map((row) => {
      const result = normalizeRow(row, mapping, definitions);
      return { rowNumber: result.rowNumber, photoRef: result.photoRef, key: result.draft?.externalId ?? "", errors: result.errors };
    });
  }, [parsed, mapping, definitions, categories, kind]);
  const problems = useMemo(() => mappingProblems(mapping, targets), [mapping, targets]);
  const invalidRows = normalized.filter((row) => row.errors.length > 0);
  const matches = useMemo(
    () => (zip ? matchPhotos(normalized.map((row) => ({ rowNumber: row.rowNumber, photoRef: row.photoRef, externalId: row.key })), zip.photos, rule) : []),
    [zip, normalized, rule],
  );
  const matchCounts = {
    matched: matches.filter((match) => match.problem === null).length,
    missing: matches.filter((match) => match.problem === "MISSING_PHOTO").length,
    shared: matches.filter((match) => match.problem === "DUPLICATE_PHOTO").length,
    ambiguous: matches.filter((match) => match.problem === "AMBIGUOUS_PHOTO").length,
  };

  async function chooseSpreadsheet(file: File | undefined, sheetName?: string) {
    if (!file) return;
    setError(null);
    setLoading("Reading the spreadsheet…");
    try {
      const result = await parseSpreadsheet(file, sheetName);
      if (result.headers.length === 0) throw new Error("The sheet is empty.");
      setSheetFile(file);
      setParsed(result);
      setFileSha(await sha256Hex(await file.arrayBuffer()));
      setMapping(kind === "PRIZES" ? suggestPrizeMapping(result.headers) : suggestMapping(result.headers, definitions));
    } catch (problem) {
      setParsed(null);
      setError({ message: problem instanceof Error ? problem.message : "The spreadsheet could not be read." });
    } finally {
      setLoading(null);
    }
  }

  async function chooseZip(file: File | undefined) {
    if (!file) {
      setZip(null);
      return;
    }
    setError(null);
    setLoading("Opening the photo ZIP…");
    try {
      setZip(await readPhotoZip(file));
    } catch (problem) {
      setZip(null);
      setError({ message: problem instanceof Error ? problem.message : "The ZIP file could not be opened." });
    } finally {
      setLoading(null);
    }
  }

  async function run() {
    if (!parsed || !sheetFile) return;
    setError(null);
    const started = await startImportAction(eventId, {
      kind,
      fileName: sheetFile.name,
      fileSha256: fileSha,
      sheetName: parsed.sheetName,
      mapping,
      duplicateMode,
      photoRule: rule,
      photosProvided: Boolean(zip),
    });
    if (!started.ok) {
      setError(started);
      return;
    }
    const batchId = started.data.batchId;
    const chunks = chunkRows(parsed.rows);
    let sent = 0;
    for (const chunk of chunks) {
      setProgress({ label: "Uploading rows", done: sent, total: parsed.rows.length });
      const result = await appendRowsAction(eventId, batchId, chunk);
      if (!result.ok) {
        setError(result);
        setProgress(null);
        return;
      }
      sent += chunk.length;
    }
    setProgress({ label: "Checking rows", done: 0, total: 1 });
    const checked = await validateBatchAction(eventId, batchId);
    if (!checked.ok) {
      setError(checked);
      setProgress(null);
      return;
    }

    const photoFailures: PhotoFailure[] = [];
    if (zip) {
      const invalid = new Set(invalidRows.map((row) => row.rowNumber));
      const jobs = matches.filter((match) => match.entryName && match.problem !== "AMBIGUOUS_PHOTO" && !invalid.has(match.rowNumber));
      const byName = new Map(zip.photos.map((photo) => [photo.name, photo]));
      let done = 0;
      const queue = [...jobs];
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const photo = job.entryName ? byName.get(job.entryName) : undefined;
          if (photo) {
            try {
              const webp = await prepareWebpPhoto(new Blob([new Uint8Array(photo.data)]), kind === "PRIZES" ? PRIZE_PHOTO_MAX_SIDE : STORED_PHOTO_MAX_SIDE);
              const data = new FormData();
              data.set("rowNumber", String(job.rowNumber));
              data.set("name", photo.name);
              data.set("photo", new File([webp], "photo.webp", { type: "image/webp" }));
              const result = await uploadImportPhotoAction(eventId, batchId, data);
              if (!result.ok && result.code !== "ROW_NOT_IMPORTABLE") photoFailures.push({ rowNumber: job.rowNumber, name: photo.name, message: result.message });
            } catch (problem) {
              photoFailures.push({
                rowNumber: job.rowNumber,
                name: photo.name,
                message: problem instanceof ImagePreparationError ? describeImageProblem(problem.reason) : "The photo could not be prepared.",
              });
            }
          }
          done++;
          setProgress({ label: "Uploading photos", done, total: jobs.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
      setProgress({ label: "Checking photos", done: 0, total: 1 });
      const rechecked = await validateBatchAction(eventId, batchId);
      if (!rechecked.ok) {
        setError(rechecked);
        setProgress(null);
        return;
      }
    }
    setProgress(null);
    if (photoFailures.length > 0) {
      setFailures({ batchId, items: photoFailures.sort((a, b) => a.rowNumber - b.rowNumber) });
      return;
    }
    router.push(`/admin/events/${eventId}/imports/${batchId}`);
  }

  if (failures) {
    return (
      <div className="grid max-w-3xl gap-4">
        <Alert>
          <AlertTitle>{failures.items.length === 1 ? "1 photo could not be used" : `${failures.items.length} photos could not be used`}</AlertTitle>
          <AlertDescription>The rows are staged. These rows will show a missing photo in the review.</AlertDescription>
        </Alert>
        <ul className="grid gap-1 text-sm">
          {failures.items.slice(0, 50).map((item) => (
            <li key={`${item.rowNumber}-${item.name}`}>
              Row {item.rowNumber}, <span className="font-mono">{item.name}</span>: {item.message}
            </li>
          ))}
        </ul>
        <div>
          <Button onClick={() => router.push(`/admin/events/${eventId}/imports/${failures.batchId}`)}>Continue to review</Button>
        </div>
      </div>
    );
  }

  const running = progress !== null;
  return (
    <div className="grid max-w-4xl gap-6">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{error.message}</AlertTitle>
          {error.details?.length ? (
            <AlertDescription>
              <ul className="list-disc pl-5">
                {error.details.slice(0, 10).map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      <section className="grid gap-4 rounded-md border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">1. Files</h2>
            <p className="text-sm text-muted-foreground">Files are read in your browser. Only the rows and resized photos are sent.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void downloadTemplate(kind, definitions, categories)}>
            Download Excel template
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="sheet">{copy.file}</Label>
            <input id="sheet" type="file" accept=".xlsx,.csv" disabled={running} onChange={(event) => void chooseSpreadsheet(event.target.files?.[0])} className="text-sm" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="zip">Photos (.zip, optional)</Label>
            <input id="zip" type="file" accept=".zip" disabled={running} onChange={(event) => void chooseZip(event.target.files?.[0])} className="text-sm" />
          </div>
        </div>
        {loading ? <p className="text-sm text-muted-foreground">{loading}</p> : null}
        {parsed ? (
          <p className="text-sm">
            <span className="font-medium">{sheetFile?.name}</span>: {parsed.rows.length} rows, {parsed.headers.length} columns
            {parsed.sheetNames.length > 1 ? (
              <>
                {" "}
                from sheet{" "}
                <select
                  aria-label="Sheet"
                  value={parsed.sheetName ?? ""}
                  onChange={(event) => void chooseSpreadsheet(sheetFile ?? undefined, event.target.value)}
                  className="rounded border border-input bg-transparent px-1"
                >
                  {parsed.sheetNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </>
            ) : null}
            .
          </p>
        ) : null}
        {zip ? (
          <p className="text-sm">
            {zip.photos.length} {zip.photos.length === 1 ? "photo" : "photos"} found in the ZIP file{zip.skipped.length > 0 ? `; ${zip.skipped.length} ${zip.skipped.length === 1 ? "file" : "files"} ignored (${[...new Set(zip.skipped.map((item) => item.reason))].join(", ")})` : ""}.
          </p>
        ) : null}
      </section>

      {parsed ? (
        <section className="grid gap-4 rounded-md border border-border bg-card p-5">
          <h2 className="font-semibold">2. Match columns to fields</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase">
                  <th className="py-2 pr-4">Column in file</th>
                  <th className="py-2 pr-4">First value</th>
                  <th className="py-2">Use as</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((header, index) => (
                  <tr key={`${header}-${index}`} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium">{header}</td>
                    <td className="max-w-48 truncate py-2 pr-4 text-muted-foreground">{String(parsed.rows[0]?.cells[index] ?? "")}</td>
                    <td className="py-2">
                      <select
                        aria-label={`Field for column ${header}`}
                        value={mapping[index] ?? ""}
                        disabled={running}
                        onChange={(event) => setMapping((current) => current.map((value, column) => (column === index ? event.target.value || null : value)))}
                        className="h-8 rounded-md border border-input bg-transparent px-2"
                      >
                        <option value="">Ignore this column</option>
                        {targets.map((target) => (
                          <option key={target.target} value={target.target}>
                            {target.label}
                            {target.required ? " (required)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {problems.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-destructive">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{copy.duplicate}</legend>
            {(
              [
                ["REJECT", "Treat it as an error", "The row is not imported and is listed as an error."],
                ["SKIP", "Skip it", copy.skipHint],
                [
                  "UPDATE",
                  copy.updateLabel,
                  kind === "PRIZES"
                    ? "Values from the mapped columns replace the stored ones; columns you do not map are left as they are. The previous values are kept so the import can be reverted."
                    : "Values from the file replace the stored ones. The previous values are kept so the import can be reverted.",
                ],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input type="radio" name="duplicateMode" value={value} checked={duplicateMode === value} onChange={() => setDuplicateMode(value)} className="mt-1" disabled={running} />
                <span>
                  <span className="font-medium">{label}.</span> <span className="text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {zip ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Match photos by</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={rule.match === "COLUMN"} onChange={() => setRule((current) => ({ ...current, match: "COLUMN" }))} disabled={running} />
                The photo file name column
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={rule.match === "EMPLOYEE_ID"} onChange={() => setRule((current) => ({ ...current, match: "EMPLOYEE_ID" }))} disabled={running} />
                {copy.matchByKey}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={rule.required} onChange={(event) => setRule((current) => ({ ...current, required: event.target.checked }))} disabled={running} />
                {copy.requirePhoto}
              </label>
              <p className="text-sm text-muted-foreground">
                {matchCounts.matched} matched · {matchCounts.missing} without a photo · {matchCounts.shared} sharing a photo · {matchCounts.ambiguous} with more than one match
              </p>
              {matches.filter((match) => match.problem && match.problem !== "MISSING_PHOTO").length > 0 ? (
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
                  {matches
                    .filter((match) => match.problem && match.problem !== "MISSING_PHOTO")
                    .slice(0, 5)
                    .map((match) => (
                      <li key={match.rowNumber}>
                        Row {match.rowNumber}: {photoProblemMessage(match.problem ?? "MISSING_PHOTO", match.entryName)}
                      </li>
                    ))}
                </ul>
              ) : null}
            </fieldset>
          ) : null}

          <div className="rounded-md bg-muted/60 p-3 text-sm">
            {problems.length === 0 ? (
              <>
                Quick check: {parsed.rows.length - invalidRows.length} rows look valid, {invalidRows.length} have problems. The server repeats every check, adds
                duplicate detection against {copy.against}, and shows the full preview before anything is saved.
              </>
            ) : (
              "Fix the column mapping to continue."
            )}
          </div>

          {progress ? (
            <div className="grid gap-2" role="status" aria-live="polite">
              <p className="text-sm font-medium">
                {progress.label}… {progress.total > 1 ? `${progress.done} of ${progress.total}` : ""}
              </p>
              <div className="h-2 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
              </div>
            </div>
          ) : (
            <div>
              <Button onClick={() => void run()} disabled={problems.length > 0 || parsed.rows.length === 0}>
                Check and preview
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
