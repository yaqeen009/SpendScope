/**
 * Minimal, dependency-free cookie helpers.
 *
 * Only what the session cookie needs: parse the `Cookie` request header and
 * serialise a `Set-Cookie` value with explicit attributes. Cookies are parsed
 * as plain data — no value is ever evaluated.
 */

export interface SerializeCookieOptions {
  /** Lifetime in seconds. Omit for a session cookie that dies with the browser. */
  maxAgeSeconds?: number;
  path?: string;
  httpOnly?: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  /** Emit an already-expired cookie to delete it client-side. */
  clear?: boolean;
}

/** Parses a `Cookie` header into a name→value map. Later duplicates win. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
  }
  return result;
}

export function serializeCookie(
  name: string,
  value: string,
  options: SerializeCookieOptions,
): string {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path ?? '/'}`);
  if (options.maxAgeSeconds !== undefined && !options.clear) {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }
  if (options.clear) {
    segments.push('Max-Age=0');
    segments.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  if (options.httpOnly !== false) segments.push('HttpOnly');
  if (options.secure) segments.push('Secure');
  segments.push(`SameSite=${options.sameSite}`);
  return segments.join('; ');
}
