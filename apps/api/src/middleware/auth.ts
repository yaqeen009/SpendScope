import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.ts';
import { parseCookies, serializeCookie } from '../lib/cookies.ts';
import { UnauthorizedError } from '../lib/errors.ts';
import { resolveSession, type AuthContext } from '../modules/auth/auth.service.ts';

/**
 * Session cookie handling and the authentication gate.
 *
 * The session is an opaque random token delivered in an `HttpOnly` cookie.
 * `SameSite=Lax` blocks cross-site form/ping requests from carrying it, and the
 * CSRF middleware rejects state-changing requests whose `Origin` is not an
 * allowed origin. There is no `localStorage` token, so XSS cannot read the
 * session.
 */

export function sessionTokenOf(req: Request): string | undefined {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[env.SESSION_COOKIE_NAME];
}

function baseCookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    secure: env.sessionCookieSecure,
    sameSite: env.sessionCookieSameSite,
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.append(
    'Set-Cookie',
    serializeCookie(env.SESSION_COOKIE_NAME, token, {
      ...baseCookieOptions(),
      maxAgeSeconds: env.SESSION_TTL_HOURS * 60 * 60,
    }),
  );
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', serializeCookie(env.SESSION_COOKIE_NAME, '', { ...baseCookieOptions(), clear: true }));
}

/** Resolves the session if one is present, but never rejects the request. */
export async function attachSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const context = await resolveSession(sessionTokenOf(req));
    if (context) res.locals.auth = context;
    next();
  } catch (error) {
    next(error);
  }
}

/** Rejects the request unless `attachSession` resolved a live session. */
export function requireAuth(_req: Request, res: Response, next: NextFunction): void {
  if (!res.locals.auth) {
    next(new UnauthorizedError());
    return;
  }
  next();
}

export function authOf(res: Response): AuthContext {
  const context = res.locals.auth as AuthContext | undefined;
  if (!context) throw new UnauthorizedError();
  return context;
}
