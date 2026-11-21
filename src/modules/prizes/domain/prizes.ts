import { z } from "zod";

export const SCENES = [
  { key: "brick-by-brick", label: "Brick by Brick", hint: "Quick reveal for minor prizes. Bricks stack up into the winner's name." },
  { key: "build-it-up", label: "Build It Up", hint: "Scaffolding rises floor by floor. Suits mid-tier prizes." },
  { key: "big-lift", label: "The Big Lift", hint: "A tower crane lifts the winner into view. Suits major prizes." },
  { key: "grand-finale", label: "The Grand Finale", hint: "The whole site lights up. Reserved for the grand prize." },
] as const;

export type SceneKey = (typeof SCENES)[number]["key"];
export const SCENE_KEYS = SCENES.map((scene) => scene.key) as [SceneKey, ...SceneKey[]];

export function sceneLabel(key: string): string {
  return SCENES.find((scene) => scene.key === key)?.label ?? key;
}

export const MAX_PRIZE_QUANTITY = 1000;
export const MAX_PRIZES_PER_EVENT = 500;
export const MAX_CATEGORIES_PER_EVENT = 50;
export const PRIZE_PHOTO_MAX_SIDE = 1280;
export const PRIZE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export const PRIZE_IMPORT_FIELDS = [
  { key: "code", column: "prize_code", label: "Prize code", required: true },
  { key: "name", column: "prize_name", label: "Prize name", required: true },
  { key: "description", column: "description", label: "Description", required: false },
  { key: "quantity", column: "winners", label: "Number of winners", required: false },
  { key: "category", column: "category", label: "Category", required: false },
] as const;

export type PrizeFieldKey = (typeof PRIZE_IMPORT_FIELDS)[number]["key"];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(60, "Use at most 60 characters."),
  description: optionalText(300),
  sceneKey: z.enum(SCENE_KEYS, { message: "Pick one of the four reveal scenes." }),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;

export type PrizeValues = { code: string; name: string; description: string | null; quantity: number };

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function normalizePrizeValues(raw: Partial<Record<"code" | "name" | "description" | "quantity", unknown>>) {
  const errors: Record<string, string> = {};
  const text = (key: "code" | "name" | "description", maxLength: number, collapse = true): string | null => {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    const string = collapse ? String(value).replace(/\s+/g, " ").trim() : String(value).replace(/\r\n/g, "\n").trim();
    if (!string) return null;
    if (CONTROL.test(string)) {
      errors[key] = "Contains control characters.";
      return null;
    }
    if (string.length > maxLength) {
      errors[key] = `Use at most ${maxLength} characters.`;
      return null;
    }
    return string;
  };

  const code = text("code", 40);
  const name = text("name", 120);
  const description = text("description", 1000, false);
  if (!code && !errors.code) errors.code = "Prize code is required.";
  else if (code && !PRIZE_CODE_PATTERN.test(code)) errors.code = "Use letters, digits, dots, dashes and underscores, starting with a letter or digit.";
  if (!name && !errors.name) errors.name = "Prize name is required.";

  let quantity = 1;
  const rawQuantity = raw.quantity;
  const blank = rawQuantity === null || rawQuantity === undefined || (typeof rawQuantity === "string" && rawQuantity.trim() === "");
  if (!blank) {
    const parsed = typeof rawQuantity === "number" ? rawQuantity : Number(String(rawQuantity).replace(/,/g, "").trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PRIZE_QUANTITY) errors.quantity = `Number of winners must be a whole number from 1 to ${MAX_PRIZE_QUANTITY}.`;
    else quantity = parsed;
  }

  const values: PrizeValues = { code: code ?? "", name: name ?? "", description, quantity };
  return { values, errors };
}

export type CategoryRef = { id: string; name: string; slug: string };

export type CategoryResolution = { ok: true; id: string | null } | { ok: false; message: string };

export function resolveCategory(raw: unknown, categories: readonly CategoryRef[]): CategoryResolution {
  const text = raw === null || raw === undefined ? "" : String(raw).replace(/\s+/g, " ").trim();
  if (!text) return { ok: true, id: null };
  const wanted = text.toLowerCase();
  const match = categories.find((category) => category.name.toLowerCase() === wanted || category.slug === wanted);
  if (!match) {
    const names = categories.map((category) => category.name);
    return {
      ok: false,
      message: names.length
        ? `Category "${text.slice(0, 60)}" does not exist. Use one of: ${names.join(", ")}.`
        : `Category "${text.slice(0, 60)}" does not exist. Create the prize categories first.`,
    };
  }
  return { ok: true, id: match.id };
}
