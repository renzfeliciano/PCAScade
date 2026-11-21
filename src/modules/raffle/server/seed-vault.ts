import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SeedVaultError extends Error {
  readonly code = "SEED_UNREADABLE";
}

function checkKey(key: Uint8Array): void {
  if (key.length !== 32) throw new SeedVaultError("the seed encryption key must be 32 bytes");
}

export function newServerSeed(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(randomBytes(32));
}

export function encryptSeed(key: Uint8Array, preparationId: string, seed: Uint8Array): Uint8Array<ArrayBuffer> {
  checkKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`PCASCADE/seed-vault/v1:${preparationId}`, "utf8"));
  const body = Buffer.concat([cipher.update(seed), cipher.final()]);
  return new Uint8Array(Buffer.concat([iv, body, cipher.getAuthTag()]));
}

export function decryptSeed(key: Uint8Array, preparationId: string, sealed: Uint8Array): Uint8Array<ArrayBuffer> {
  checkKey(key);
  if (sealed.length <= IV_BYTES + TAG_BYTES) throw new SeedVaultError("the stored seed is truncated");
  const bytes = Buffer.from(sealed);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(`PCASCADE/seed-vault/v1:${preparationId}`, "utf8"));
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    return new Uint8Array(Buffer.concat([decipher.update(bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES)), decipher.final()]));
  } catch {
    throw new SeedVaultError("the stored seed could not be decrypted with the configured key");
  }
}

export function seedKeyFromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}
