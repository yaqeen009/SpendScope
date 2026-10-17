import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Opaque session tokens.
 *
 * The token handed to the browser is 256 bits of randomness. Only its SHA-256
 * hash is stored, so the database (or a backup of it) cannot be used to
 * impersonate a user. SHA-256 is the right primitive here because the input is
 * already high-entropy — there is nothing to brute-force — so a password KDF
 * would add cost without adding security.
 */

export const SESSION_TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateId(): string {
  return randomUUID();
}
