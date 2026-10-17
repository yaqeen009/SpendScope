import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import {
  changePasswordSchema,
  deleteAccountSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  type DeleteAccountInput,
} from '@spendscope/shared';

import { env } from '../../config/env.ts';
import { authOf, clearSessionCookie, requireAuth, sessionTokenOf, setSessionCookie } from '../../middleware/auth.ts';
import { paramsOf, validateBody, validateParams } from '../../middleware/validate.ts';
import {
  changePassword,
  deleteAccount,
  listSessions,
  login,
  logout,
  register,
  revokeOtherSessions,
  revokeSession,
  toUserDTO,
  updateProfile,
} from './auth.service.ts';

const idParamsSchema = z.object({ id: z.string().uuid('Expected a UUID') });

/**
 * Authentication routes.
 *
 * Built per app instance so the rate limiters are not shared between
 * instances (relevant for tests, and for any future multi-app setup).
 */
export function createAuthRouter(): Router {
  /**
   * Brute-force protection. Keyed by client address; behind a proxy set
   * `TRUST_PROXY` so the real address is used. Failed and successful attempts
   * both count, which is what limits credential stuffing.
   *
   * Registration and login have separate buckets so that filling in the
   * sign-up form cannot lock a user out of signing in, and vice versa.
   */
  const loginLimiter = rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' },
    },
  });

  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: { code: 'RATE_LIMITED', message: 'Too many accounts created from this address. Try again later.' },
    },
  });

  const authRouter: Router = Router();

  /** Public configuration the sign-in screen needs. Contains no secrets. */
  authRouter.get('/config', (_req, res) => {
    res.json({
      data: {
        registrationEnabled: env.ALLOW_REGISTRATION,
        minPasswordLength: 12,
        sessionTtlHours: env.SESSION_TTL_HOURS,
      },
    });
  });

  authRouter.post('/register', registerLimiter, validateBody(registerSchema), async (req, res) => {
    const { state, token } = await register(req.body, { userAgent: req.get('user-agent') ?? null });
    setSessionCookie(res, token);
    res.status(201).json({ data: state });
  });

  authRouter.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
    const { state, token } = await login(req.body, { userAgent: req.get('user-agent') ?? null });
    setSessionCookie(res, token);
    res.json({ data: state });
  });

  authRouter.post('/logout', async (req, res) => {
    await logout(sessionTokenOf(req));
    clearSessionCookie(res);
    res.status(204).end();
  });

  authRouter.get('/me', requireAuth, (_req, res) => {
    const { user, workspace } = authOf(res);
    res.json({ data: { user: toUserDTO(user), workspace: { id: workspace.id, name: workspace.name, isDemo: workspace.isDemo } } });
  });

  authRouter.patch('/me', requireAuth, validateBody(updateProfileSchema), async (req, res) => {
    const user = await updateProfile(authOf(res).user.id, req.body);
    res.json({ data: user });
  });

  authRouter.post('/me/password', requireAuth, validateBody(changePasswordSchema), async (req, res) => {
    const result = await changePassword(authOf(res).user.id, req.body, authOf(res).session.id);
    res.json({ data: result });
  });

  authRouter.get('/sessions', requireAuth, async (_req, res) => {
    const { user, session } = authOf(res);
    res.json({ data: await listSessions(user.id, session.id) });
  });

  authRouter.delete('/sessions/:id', requireAuth, validateParams(idParamsSchema), async (_req, res) => {
    const { id } = paramsOf<{ id: string }>(res);
    await revokeSession(authOf(res).user.id, id);
    res.status(204).end();
  });

  authRouter.post('/sessions/revoke-others', requireAuth, async (_req, res) => {
    const { user, session } = authOf(res);
    res.json({ data: { revoked: await revokeOtherSessions(user.id, session.id) } });
  });

  /** Irreversible: deletes the account and every workspace it owns. */
  authRouter.delete('/me', requireAuth, validateBody(deleteAccountSchema), async (req, res) => {
    const userId = authOf(res).user.id;
    const body = req.body as DeleteAccountInput;
    const result = await deleteAccount(userId, body);
    clearSessionCookie(res);
    res.json({ data: result });
  });
  return authRouter;
}
