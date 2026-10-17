import type {
  AuthSessionDTO,
  AuthStateDTO,
  AuthUserDTO,
  ChangePasswordInput,
  DeleteAccountInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
  WorkspaceDTO,
} from '@spendscope/shared';

import { env } from '../../config/env.ts';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../../lib/errors.ts';
import { fakeVerify, hashPassword, verifyPassword } from '../../lib/password.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Prisma } from '../../lib/prisma.ts';
import { generateSessionToken, hashSessionToken } from '../../lib/tokens.ts';
import { ensureDefaultCategories } from '../workspace/workspace.service.ts';

/** Request metadata recorded with a session (never the client IP's full history). */
export interface SessionMeta {
  userAgent?: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  disabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface SessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
  userAgent: string | null;
}

interface WorkspaceRow {
  id: string;
  name: string;
  isDemo: boolean;
}

export interface AuthContext {
  user: UserRow;
  session: SessionRow;
  workspace: WorkspaceRow;
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  disabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

function sessionExpiry(): Date {
  return new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
}

export function toUserDTO(user: UserRow): AuthUserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toWorkspaceDTO(workspace: WorkspaceRow): WorkspaceDTO {
  return { id: workspace.id, name: workspace.name, isDemo: workspace.isDemo };
}

export function toSessionDTO(session: SessionRow, currentSessionId: string): AuthSessionDTO {
  return {
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    userAgent: session.userAgent ? session.userAgent.slice(0, 200) : null,
    current: session.id === currentSessionId,
  };
}

async function createSession(
  userId: string,
  meta: SessionMeta,
): Promise<{ token: string; session: SessionRow }> {
  const token = generateSessionToken();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: sessionExpiry(),
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 200) : null,
    },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      expiresAt: true,
      lastUsedAt: true,
      userAgent: true,
    },
  });
  return { token, session };
}

/**
 * Returns the user's workspace, creating one (with the default category
 * catalogue and a settings row) the first time. Every workspace is owned.
 */
async function resolveWorkspaceForUser(
  db: Prisma.TransactionClient | typeof prisma,
  userId: string,
  defaultName = 'Personal',
): Promise<WorkspaceRow> {
  const existing = await db.workspace.findFirst({
    where: { ownerUserId: userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, isDemo: true },
  });
  if (existing) return existing;

  const created = await db.workspace.create({
    data: { name: defaultName, ownerUserId: userId },
    select: { id: true, name: true, isDemo: true },
  });
  await ensureDefaultCategories(db, created.id);
  await db.settings.create({ data: { workspaceId: created.id } });
  return created;
}

/**
 * Claims a pre-authentication workspace (created by the development bootstrap
 * or the seed) for the first account, so existing local data is not lost. Only
 * ever performed when `BOOTSTRAP_DEFAULT_WORKSPACE` is enabled — i.e. never in
 * production.
 */
async function claimUnownedWorkspace(
  db: Prisma.TransactionClient,
  userId: string,
): Promise<WorkspaceRow | null> {
  if (!env.BOOTSTRAP_DEFAULT_WORKSPACE) return null;

  const unowned = await db.workspace.findFirst({
    where: { ownerUserId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, isDemo: true },
  });
  if (!unowned) return null;

  await db.workspace.update({ where: { id: unowned.id }, data: { ownerUserId: userId } });
  await ensureDefaultCategories(db, unowned.id);
  await db.settings.upsert({ where: { workspaceId: unowned.id }, update: {}, create: { workspaceId: unowned.id } });
  return unowned;
}

export async function register(
  input: RegisterInput,
  meta: SessionMeta,
): Promise<{ state: AuthStateDTO; token: string }> {
  if (!env.ALLOW_REGISTRATION) {
    throw new NotFoundError('Registration is disabled on this installation');
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw new ConflictError('An account with that email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const { user, workspace } = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash },
        select: USER_SELECT,
      });

      const claimed = await claimUnownedWorkspace(tx, created.id);
      const owned = claimed ?? (await resolveWorkspaceForUser(tx, created.id, input.workspaceName ?? 'Personal'));

      return { user: created, workspace: owned };
    });

    const { token } = await createSession(user.id, meta);
    return {
      state: { user: toUserDTO(user), workspace: toWorkspaceDTO(workspace) },
      token,
    };
  } catch (error) {
    // A concurrent registration with the same email loses the unique race.
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
      throw new ConflictError('An account with that email already exists');
    }
    throw error;
  }
}

export async function login(
  input: LoginInput,
  meta: SessionMeta,
): Promise<{ state: AuthStateDTO; token: string }> {
  const user = await prisma.user.findUnique({ where: { email: input.email }, select: USER_SELECT });

  // Always run a comparable amount of work so "unknown email" and "wrong
  // password" are not distinguishable by timing.
  if (!user) {
    await fakeVerify();
    throw new UnauthorizedError('Email or password is incorrect');
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Email or password is incorrect');
  }
  if (user.disabled) {
    throw new UnauthorizedError('This account is disabled');
  }

  const workspace = await resolveWorkspaceForUser(prisma, user.id);
  const { token } = await createSession(user.id, meta);
  return { state: { user: toUserDTO(user), workspace: toWorkspaceDTO(workspace) }, token };}

/** Resolves a raw session token into its user, session and workspace. */
export async function resolveSession(token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      expiresAt: true,
      lastUsedAt: true,
      userAgent: true,
    },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: USER_SELECT });
  if (!user || user.disabled) return null;

  const workspace = await resolveWorkspaceForUser(prisma, user.id);

  // Slide `lastUsedAt` at most once every five minutes to avoid a write per request.
  if (Date.now() - session.lastUsedAt.getTime() > 5 * 60 * 1000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  return { user, session, workspace };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export async function listSessions(userId: string, currentSessionId: string): Promise<AuthSessionDTO[]> {
  const sessions = await prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, userId: true, createdAt: true, expiresAt: true, lastUsedAt: true, userAgent: true },
  });
  return sessions.map((session) => toSessionDTO(session, currentSessionId));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const result = await prisma.session.deleteMany({ where: { id: sessionId, userId } });
  if (result.count === 0) throw new NotFoundError('Session');
}

export async function revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { userId, id: { not: currentSessionId } },
  });
  return result.count;
}

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<AuthUserDTO> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { ...(input.name !== undefined ? { name: input.name } : {}) },
    select: USER_SELECT,
  });
  return toUserDTO(user);
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  currentSessionId: string,
): Promise<{ revokedSessions: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!user) throw new NotFoundError('Account');

  const valid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) throw new UnauthorizedError('Your current password is incorrect');

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  // Changing a password invalidates every other session.
  const revoked = await prisma.session.deleteMany({ where: { userId, id: { not: currentSessionId } } });
  return { revokedSessions: revoked.count };
}

/**
 * Deletes the account and every workspace it owns. All financial data cascades
 * from the workspace deletions; the user row cascades the sessions.
 *
 * Requires the password as well as the confirmation token: this is the one
 * irreversible operation in the product, and a session cookie alone must not be
 * enough to destroy a user's history.
 */
export async function deleteAccount(userId: string, input: DeleteAccountInput): Promise<{ workspaces: number }> {
  if (input.confirm !== 'DELETE') {
    throw new BadRequestError('Confirmation token is incorrect. Type DELETE to confirm.');
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) throw new NotFoundError('Account');

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw new UnauthorizedError('Your password is incorrect, so the account was not deleted');

  return prisma.$transaction(async (tx) => {
    const workspaces = await tx.workspace.deleteMany({ where: { ownerUserId: userId } });
    await tx.user.delete({ where: { id: userId } });
    return { workspaces: workspaces.count };
  });
}

/** Deletes expired sessions. Called at startup and on a timer. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}
