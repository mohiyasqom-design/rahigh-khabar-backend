import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

// Argon2id baseline; tune upwards after measuring deployment latency/memory.
const options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try { return await argon2.verify(hash, password); }
  catch { return false; } // Never expose corrupted hash details.
}
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHash;
}
