import { z } from "zod";

const DEFAULT_DRAND_RELAYS = "https://api.drand.sh,https://api2.drand.sh,https://drand.cloudflare.com";

const base64Key32 = z
  .string()
  .min(1, "is required")
  .regex(/^[A-Za-z0-9+/]{43}=$/, "must be 32 random bytes encoded as base64")
  .refine((value) => new Set(Buffer.from(value, "base64")).size > 4, "must be random bytes, not a repeated pattern");

const relayUrl = z
  .url({ protocol: /^https$/ })
  .refine((value) => {
    const parsed = new URL(value);
    return parsed.username === "" && parsed.password === "" && parsed.search === "" && parsed.hash === "";
  }, "must be a plain https origin without credentials, query or fragment");

const serverEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DIRECT_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional().or(z.literal("").transform(() => undefined)),
  RAFFLE_SEED_ENCRYPTION_KEY: base64Key32,
  APP_URL: z.url(),
  DRAND_RELAYS: z
    .string()
    .default(DEFAULT_DRAND_RELAYS)
    .transform((value) => (value.trim() === "" ? DEFAULT_DRAND_RELAYS : value))
    .transform((value) => value.split(",").map((relay) => relay.trim()).filter(Boolean))
    .pipe(z.array(relayUrl).min(1)),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid server environment. ${problems}`);
  }
  return result.data;
}

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
