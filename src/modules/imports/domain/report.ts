import type { RowIssue } from "@/modules/imports/domain/rows";

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export type ReportRow = { rowNumber: number; action: string | null; key: string | null; errors: RowIssue[]; warnings: RowIssue[] };

export function issuesReportCsv(rows: readonly ReportRow[], keyHeader = "employee_id"): string {
  const lines = [["row", keyHeader, "outcome", "severity", "field", "problem"].join(",")];
  for (const row of rows) {
    const issues = [...row.errors.map((issue) => ({ ...issue, severity: "error" })), ...row.warnings.map((issue) => ({ ...issue, severity: "warning" }))];
    for (const issue of issues) {
      lines.push([row.rowNumber, row.key, row.action ?? "", issue.severity, issue.field, issue.message].map(csvCell).join(","));
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
