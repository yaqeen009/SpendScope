import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.ts';
import { ForbiddenError } from '../lib/errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Origin-based CSRF defence for cookie-authenticated requests.
 *
 * The session cookie is `SameSite=Lax`, which already prevents it from being
 * attached to a cross-site POST. This is defence in depth: for any
 * state-changing request that carries an `Origin` (or `Referer`) header, the
 * origin must be one of the configured frontend origins.
 *
 * Requests with neither header (server-to-server callers, curl, the test suite)
 * are allowed — they cannot be triggered by a victim's browser, which is the
 * only thing CSRF exploits. `credentials: false` CORS is a third layer.
 */
export function requireTrustedOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin') ?? originFromReferer(req.get('referer'));
  if (!origin) {
    next();
    return;
  }

  if (env.corsOrigins.includes(origin)) {
    next();
    return;
  }

  next(new ForbiddenError('The request origin is not allowed'));
}

function originFromReferer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
