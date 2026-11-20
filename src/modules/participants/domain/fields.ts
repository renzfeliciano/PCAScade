import { z } from "zod";

export const FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SINGLE_SELECT", "MULTI_SELECT"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  BOOLEAN: "Yes / no",
  SINGLE_SELECT: "Single choice",
  MULTI_SELECT: "Multiple choice",
};

export type CustomFieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
};

export type CustomValue = string | number | boolean | string[];

export const BUILTIN_PARTICIPANT_FIELDS = [
  { key: "externalId", column: "employee_id", label: "Employee ID", required: true, maxLength: 64 },
  { key: "fullName", column: "full_name", label: "Full name", required: true, maxLength: 160 },
  { key: "department", column: "department", label: "Department", required: false, maxLength: 120 },
  { key: "jobTitle", column: "job_title", label: "Position", required: false, maxLength: 120 },
  { key: "bio", column: "description", label: "Description", required: false, maxLength: 1000 },
  { key: "email", column: "email", label: "Email", required: false, maxLength: 254 },
  { key: "eligible", column: "eligible", label: "Eligible", required: false, maxLength: 10 },
] as const;

export type BuiltinFieldKey = (typeof BUILTIN_PARTICIPANT_FIELDS)[number]["key"];

const RESERVED_KEYS = new Set(["external_id", "employee_id", "full_name", "department", "job_title", "bio", "description", "email", "eligible", "photo_filename"]);

const optionList = z
  .array(z.string().trim().min(1, "Options cannot be blank.").max(100, "Keep each option under 100 characters."))
  .max(100, "Use at most 100 options.")
  .refine((options) => new Set(options.map((option) => option.toLowerCase())).size === options.length, "Options must be unique.");

export const fieldDefinitionSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, "Use lowercase letters, digits and underscores, starting with a letter.")
      .refine((key) => !RESERVED_KEYS.has(key), "That key is reserved for a built-in field."),
    label: z.string().trim().min(1, "Enter a label.").max(80, "Use at most 80 characters."),
    type: z.enum(FIELD_TYPES),
    required: z.boolean(),
    isPublic: z.boolean(),
    options: optionList,
  })
  .superRefine((value, context) => {
    const isSelect = value.type === "SINGLE_SELECT" || value.type === "MULTI_SELECT";
    if (isSelect && value.options.length === 0) context.addIssue({ code: "custom", path: ["options"], message: "Add at least one option." });
    if (!isSelect && value.options.length > 0) context.addIssue({ code: "custom", path: ["options"], message: "Only choice fields have options." });
  });

export type FieldDefinitionInput = z.infer<typeof fieldDefinitionSchema>;

const TRUE_WORDS = new Set(["yes", "y", "true", "1", "oo", "x"]);
const FALSE_WORDS = new Set(["no", "n", "false", "0", "hindi"]);

export function parseBooleanCell(raw: unknown): boolean | null | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1 ? true : raw === 0 ? false : null;
  const word = String(raw).trim().toLowerCase();
  if (word === "") return undefined;
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  return null;
}

function isBlank(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "") || (Array.isArray(raw) && raw.length === 0);
}

export type ValueResult = { ok: true; value: CustomValue | undefined } | { ok: false; message: string };

export function normalizeCustomValue(definition: CustomFieldDefinition, raw: unknown): ValueResult {
  if (isBlank(raw)) {
    return definition.required ? { ok: false, message: `${definition.label} is required.` } : { ok: true, value: undefined };
  }
  switch (definition.type) {
    case "TEXT": {
      const text = String(raw).replace(/\s+/g, " ").trim();
      if (text.length > 500) return { ok: false, message: `${definition.label} must be at most 500 characters.` };
      return { ok: true, value: text };
    }
    case "NUMBER": {
      const number = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").trim());
      if (!Number.isFinite(number)) return { ok: false, message: `${definition.label} must be a number.` };
      return { ok: true, value: number };
    }
    case "DATE": {
      const text = String(raw).trim();
      const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
      if (!match) return { ok: false, message: `${definition.label} must be a date written as YYYY-MM-DD.` };
      const [, year, month, day] = match;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
        return { ok: false, message: `${definition.label} is not a real calendar date.` };
      }
      return { ok: true, value: `${year}-${month}-${day}` };
    }
    case "BOOLEAN": {
      const value = parseBooleanCell(raw);
      if (value === null || value === undefined) return { ok: false, message: `${definition.label} must be yes or no.` };
      return { ok: true, value };
    }
    case "SINGLE_SELECT": {
      const wanted = String(raw).trim().toLowerCase();
      const option = definition.options.find((candidate) => candidate.toLowerCase() === wanted);
      if (!option) return { ok: false, message: `${definition.label} must be one of: ${definition.options.join(", ")}.` };
      return { ok: true, value: option };
    }
    case "MULTI_SELECT": {
      const parts = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[;,]/);
      const chosen: string[] = [];
      for (const part of parts.map((piece) => piece.trim()).filter(Boolean)) {
        const option = definition.options.find((candidate) => candidate.toLowerCase() === part.toLowerCase());
        if (!option) return { ok: false, message: `${definition.label}: "${part.slice(0, 40)}" is not one of ${definition.options.join(", ")}.` };
        if (!chosen.includes(option)) chosen.push(option);
      }
      if (chosen.length === 0 && definition.required) return { ok: false, message: `${definition.label} is required.` };
      return { ok: true, value: chosen.length ? chosen : undefined };
    }
  }
}

export function validateCustomValues(definitions: readonly CustomFieldDefinition[], raw: Record<string, unknown>) {
  const values: Record<string, CustomValue> = {};
  const errors: Record<string, string> = {};
  for (const definition of definitions) {
    const result = normalizeCustomValue(definition, raw[definition.key]);
    if (!result.ok) errors[definition.key] = result.message;
    else if (result.value !== undefined) values[definition.key] = result.value;
  }
  return { values, errors };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type BuiltinValues = {
  externalId: string;
  fullName: string;
  department: string | null;
  jobTitle: string | null;
  bio: string | null;
  email: string | null;
  eligible: boolean;
};

export function normalizeBuiltinValues(raw: Partial<Record<BuiltinFieldKey, unknown>>) {
  const errors: Record<string, string> = {};
  const text = (key: BuiltinFieldKey, maxLength: number, collapse = true): string | null => {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    const string = collapse ? String(value).replace(/\s+/g, " ").trim() : String(value).replace(/\r\n/g, "\n").trim();
    if (!string) return null;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(string)) {
      errors[key] = "Contains control characters.";
      return null;
    }
    if (string.length > maxLength) {
      errors[key] = `Use at most ${maxLength} characters.`;
      return null;
    }
    return string;
  };

  const externalId = text("externalId", 64);
  const fullName = text("fullName", 160);
  const department = text("department", 120);
  const jobTitle = text("jobTitle", 120);
  const bio = text("bio", 1000, false);
  const emailRaw = text("email", 254);
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  if (!externalId && !errors.externalId) errors.externalId = "Employee ID is required.";
  if (!fullName && !errors.fullName) errors.fullName = "Full name is required.";
  if (email && !EMAIL.test(email)) errors.email = "Enter a valid email address.";
  const eligibleParsed = parseBooleanCell(raw.eligible);
  if (eligibleParsed === null) errors.eligible = "Eligible must be yes or no.";

  const values: BuiltinValues = {
    externalId: externalId ?? "",
    fullName: fullName ?? "",
    department,
    jobTitle,
    bio,
    email: email && !errors.email ? email : null,
    eligible: eligibleParsed ?? true,
  };
  return { values, errors };
}
