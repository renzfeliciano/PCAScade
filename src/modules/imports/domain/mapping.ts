import { z } from "zod";
import type { CustomFieldDefinition } from "@/modules/participants/domain/fields";
import { BUILTIN_PARTICIPANT_FIELDS } from "@/modules/participants/domain/fields";

export type ImportTarget = string;

export const PHOTO_TARGET = "photoFilename";

export type TargetOption = { target: ImportTarget; label: string; required: boolean };

export function participantTargets(definitions: readonly CustomFieldDefinition[]): TargetOption[] {
  return [
    ...BUILTIN_PARTICIPANT_FIELDS.map((field) => ({ target: field.key, label: field.label, required: field.required })),
    { target: PHOTO_TARGET, label: "Photo file name", required: false },
    ...definitions.map((definition) => ({ target: `custom:${definition.key}`, label: definition.label, required: definition.required })),
  ];
}

const SYNONYMS: Record<string, string[]> = {
  externalId: ["employee id", "employee no", "employee number", "emp id", "emp no", "employee code", "id number", "id no", "staff id", "participant id", "id"],
  fullName: ["full name", "name", "employee name", "participant name", "complete name"],
  department: ["department", "dept", "division", "unit", "team"],
  jobTitle: ["job title", "position", "designation", "title", "role"],
  bio: ["description", "bio", "biography", "about", "profile"],
  email: ["email", "email address", "e mail", "work email"],
  eligible: ["eligible", "eligibility", "is eligible", "qualified"],
  photoFilename: ["photo filename", "photo file name", "photo", "photo file", "picture", "image", "image filename"],
};

export function normalizeHeader(header: string): string {
  return header
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function suggestMapping(headers: readonly string[], definitions: readonly CustomFieldDefinition[]): (ImportTarget | null)[] {
  const used = new Set<ImportTarget>();
  const candidates: Record<string, string[]> = { ...SYNONYMS };
  for (const definition of definitions) {
    candidates[`custom:${definition.key}`] = [normalizeHeader(definition.key.replace(/_/g, " ")), normalizeHeader(definition.label)];
  }
  return headers.map((header) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return null;
    for (const [target, names] of Object.entries(candidates)) {
      if (!used.has(target) && names.includes(normalized)) {
        used.add(target);
        return target;
      }
    }
    return null;
  });
}

export const mappingSchema = z.array(z.string().nullable()).max(200);

export function mappingProblems(mapping: readonly (ImportTarget | null)[], targets: readonly TargetOption[]): string[] {
  const problems: string[] = [];
  const allowed = new Set(targets.map((option) => option.target));
  const seen = new Map<string, number>();
  mapping.forEach((target, column) => {
    if (target === null) return;
    if (!allowed.has(target)) problems.push(`Column ${column + 1} is mapped to an unknown field.`);
    seen.set(target, (seen.get(target) ?? 0) + 1);
  });
  for (const [target, count] of seen) {
    if (count > 1) problems.push(`${targets.find((option) => option.target === target)?.label ?? target} is mapped from ${count} columns. Map it from one column only.`);
  }
  for (const option of targets) {
    if (option.required && !seen.has(option.target)) problems.push(`Map a column to ${option.label}; it is required.`);
  }
  return problems;
}
