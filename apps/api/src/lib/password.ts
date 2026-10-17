import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing.
 *
 * Uses Node's built-in `scrypt` — a memory-hard password KDF from the standard
 * library — rather than hand-rolled cryptography or a native addon. Parameters
 * are stored with each hash so they can be raised later without invalidating
 * existing passwords:
 *
 *   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 *
 * Verification is constant-time (`timingSafeEqual`) and never throws for a
 * malformed stored value: it returns `false`.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const SCRYPT_N = 16_384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
/** 128 * N * r bytes plus headroom (scrypt needs ~16 MiB at these parameters). */
const MAX_MEM = 128 * SCRYPT_N * SCRYPT_R * 2;

/** Minimum accepted password length. Enforced by the request schema too. */
export const MIN_PASSWORD_LENGTH = 12;
/** Maximum accepted length: scrypt work grows with input, so cap it. */
export const MAX_PASSWORD_LENGTH = 200;

function normalise(password: string): string {
  // Unicode normalisation so the same typed password always hashes the same.
  return password.normalize('NFKC');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(normalise(password), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [string, string, string, string, string, string];
    const N = Number.parseInt(nRaw, 10);
    const r = Number.parseInt(rRaw, 10);
    const p = Number.parseInt(pRaw, 10);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
    if (N <= 0 || r <= 0 || p <= 0 || N > 1_048_576) return false;

    const salt = Buffer.from(saltRaw, 'base64');
    const expected = Buffer.from(hashRaw, 'base64');
    if (salt.length === 0 || expected.length === 0) return false;

    // maxmem must cover the *stored* parameters, not just the current ones.
    const derived = await scrypt(normalise(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(MAX_MEM, 128 * N * r * 2),
    });

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same CPU as a real verification so that "unknown email"
 * and "wrong password" take comparable time (reduces user enumeration).
 */
export async function fakeVerify(): Promise<void> {
  await hashPassword('spendscope-timing-equaliser');
}
