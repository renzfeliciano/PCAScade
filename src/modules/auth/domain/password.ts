import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1, keyLength: 32, saltLength: 16 } as const;
const MAXMEM = 256 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

const COMMON_PASSWORDS = new Set([
  "123456789012",
  "password1234",
  "passwordpassword",
  "qwertyuiopas",
  "iloveyou1234",
  "adminadmin123",
  "administrator",
  "welcome12345",
  "letmein12345",
  "changeme1234",
  "pcascade1234",
  "pcascadeadmin",
  "raffleadmin123",
  "qwerty123456",
  "abc123456789",
  "111111111111",
  "000000000000",
  "aaaaaaaaaaaa",
]);

function deriveKey(password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyLength, { N, r, p, maxmem: MAXMEM }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_PARAMS.saltLength);
  const { N, r, p, keyLength } = SCRYPT_PARAMS;
  const key = await deriveKey(password, salt, N, r, p, keyLength);
  return ["scrypt", "v1", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") return false;
  const [, , nText, rText, pText, saltText, keyText] = parts;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (![N, r, p].every((value) => Number.isSafeInteger(value) && value > 0) || N > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(saltText ?? "", "base64");
  const expected = Buffer.from(keyText ?? "", "base64");
  if (salt.length < 16 || expected.length < 32) return false;
  const actual = await deriveKey(password, salt, N, r, p, expected.length);
  return timingSafeEqual(actual, expected);
}

export function needsRehash(stored: string): boolean {
  const [, version, nText, rText, pText] = stored.split("$");
  return version !== "v1" || Number(nText) !== SCRYPT_PARAMS.N || Number(rText) !== SCRYPT_PARAMS.r || Number(pText) !== SCRYPT_PARAMS.p;
}

export function passwordPolicyProblem(password: string): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "This password is too common. Choose another one.";
  if (new Set(password).size < 5) return "Use a password with more variety of characters.";
  return null;
}
