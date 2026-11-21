import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";

function field(bytes: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, bytes.length);
  return concatBytes(length, bytes);
}

export function seedCommitment(serverSeed: Uint8Array): Uint8Array {
  return sha256(concatBytes(field(utf8ToBytes("PCASCADE/seed/v1")), field(serverSeed)));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}
