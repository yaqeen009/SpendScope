import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';

import { env } from './config/env.ts';
import { logger } from './lib/logger.ts';
import { attachSession, requireAuth } from './middleware/auth.ts';
import { requireTrustedOrigin } from './middleware/csrf.ts';
import { errorHandler, notFoundHandler } from './middleware/validate.ts';
import { analyticsRouter } from './modules/analytics/analytics.routes.ts';
import { createAuthRouter } from './modules/auth/auth.routes.ts';
import { budgetsRouter } from './modules/budgets/budgets.routes.ts';
import { categoriesRouter } from './modules/categories/categories.routes.ts';
import { categoryRulesRouter } from './modules/category-rules/category-rules.routes.ts';
import { exportsRouter } from './modules/exports/exports.routes.ts';
import { recurringRouter } from './modules/recurring/recurring.routes.ts';
import { healthRouter } from './modules/health/health.routes.ts';
import { importsRouter } from './modules/imports/imports.routes.ts';
import { settingsRouter } from './modules/settings/settings.routes.ts';
import { transactionsRouter } from './modules/transactions/transactions.routes.ts';

/**
 * Express application factory.
 *
 * Security posture:
 *   - CORS is restricted to the configured frontend origin(s); credentials are
 *     only ever allowed for those origins, never for `*`.
 *   - `helmet` safe defaults (CSP disabled: the API serves JSON/CSV, not HTML).
 *   - Session cookie authentication (`HttpOnly`, `SameSite=Lax` by default and
 *     `Secure` in production) resolved once per request by `attachSession`.
 *   - An origin check on state-changing requests (CSRF defence in depth).
 *   - Every data route requires an authenticated session and is scoped to the
 *     workspace that session owns.
 *   - Request bodies are capped at the configured CSV size.
 *   - Sensitive endpoints are rate-limited.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  /**
   * Every response is uncacheable.
   *
   * The API serves one account's financial data and sets or clears the session
   * cookie, so no shared cache may store a response: a single cached `/auth/me`
   * or `/transactions` reply would be served to a different signed-in user.
   * This matters as soon as a proxy or CDN sits in front of the API — the SPA
   * reaches Render through a Vercel rewrite in the split deployment, and Vercel
   * caches an external rewrite when the origin permits it. `no-store` is the
   * strongest directive, so it is set before any route can respond, including
   * 404s and error responses.
   */
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin / curl requests have no Origin header and are allowed.
        // A foreign origin is not an error here: no CORS headers are sent, the
        // browser blocks the response, and `requireTrustedOrigin` turns
        // state-changing requests into a clean 403.
        callback(null, !origin || env.corsOrigins.includes(origin));
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      // The session is a cookie, so a cross-origin frontend (a separate host
      // from the API) can only authenticate when credentials are allowed.
      // This is never `*`: the origin callback above still allow-lists every
      // origin, so only the configured frontend receives these headers, and
      // `requireTrustedOrigin` re-checks the origin on every state-changing
      // request. When the SPA and the API share one origin (the recommended
      // deployment) this setting is simply never exercised.
      credentials: env.corsOrigins.length > 0,
      maxAge: 86_400,
    }),
  );

  app.use(
    pinoHttp({
      logger,
      // Observability: every request carries an id. An inbound `x-request-id`
      // from a trusted edge proxy is reused so a trace spans both layers;
      // otherwise one is generated. The id is echoed in the response and logged
      // with the request, so a user can quote it in a bug report.
      genReqId(req, res) {
        const inbound = req.headers['x-request-id'];
        const id = typeof inbound === 'string' && /^[\w.:-]{1,128}$/.test(inbound) ? inbound : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: {
        ignore: (req) => req.url === '/api/v1/health' || req.url === '/api/v1/ready',
      },
    }),
  );

  app.use(express.json({ limit: env.MAX_UPLOAD_BYTES }));

  const importLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many import requests. Try again shortly.' } },
  });

  const writeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' } },
  });

  // Liveness/readiness does not require a session.
  app.use('/api/v1/health', healthRouter);

  const v1 = express.Router();
  v1.use(attachSession);
  v1.use(requireTrustedOrigin);

  // Authentication endpoints are public (they create or destroy a session).
  v1.use('/auth', createAuthRouter());

  // Everything below requires a live session.
  const protectedApi = express.Router();
  protectedApi.use(requireAuth);
  protectedApi.use('/transactions', writeLimiter, transactionsRouter);
  protectedApi.use('/categories', writeLimiter, categoriesRouter);
  protectedApi.use('/category-rules', writeLimiter, categoryRulesRouter);
  protectedApi.use('/budgets', writeLimiter, budgetsRouter);
  protectedApi.use('/analytics', analyticsRouter);
  protectedApi.use('/imports', importLimiter, importsRouter);
  protectedApi.use('/settings', writeLimiter, settingsRouter);
  protectedApi.use('/exports', exportsRouter);
  protectedApi.use('/recurring', recurringRouter);
  v1.use(protectedApi);

  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
