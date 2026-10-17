import { prisma } from '../../src/lib/prisma.ts';
import { hashPassword } from '../../src/lib/password.ts';
import { generateSessionToken, hashSessionToken } from '../../src/lib/tokens.ts';
import { env } from '../../src/config/env.ts';
import { importPreviewStore } from '../../src/modules/imports/preview-store.instance.ts';
import { ensureDefaultCategories } from '../../src/modules/workspace/workspace.service.ts';
import { setTestSessionCookie } from './api.ts';

/**
 * Truncates every application table and provisions a fresh account with an
 * owned workspace, its category catalogue and a live session. The session
 * cookie is registered with `tests/helpers/api.ts` so authenticated requests
 * work without repeating login in every spec.
 *
 * This only ever runs against the isolated test database.
 */

export const TEST_USER_EMAIL = 'tester@spendscope.test';
export const TEST_USER_PASSWORD = 'correct-horse-battery-9';
export const TEST_USER_NAME = 'Test Owner';

let cachedPasswordHash: string | null = null;

async function testPasswordHash(): Promise<string> {
  if (cachedPasswordHash === null) {
    cachedPasswordHash = await hashPassword(TEST_USER_PASSWORD);
  }
  return cachedPasswordHash;
}

export async function resetDatabase(): Promise<string> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Transaction", "Budget", "ImportBatch", "ImportPreview", "CategoryRule", "Category", "Settings", "Session", "User", "Workspace" RESTART IDENTITY CASCADE',
  );
  importPreviewStore.stop();
  importPreviewStore.start();

  const user = await prisma.user.create({
    data: {
      email: TEST_USER_EMAIL,
      name: TEST_USER_NAME,
      passwordHash: await testPasswordHash(),
    },
    select: { id: true },
  });

  const workspace = await prisma.workspace.create({
    data: { name: 'Personal', ownerUserId: user.id },
    select: { id: true },
  });

  await ensureDefaultCategories(prisma, workspace.id);
  await prisma.settings.create({ data: { workspaceId: workspace.id } });

  const token = generateSessionToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  setTestSessionCookie(`${env.SESSION_COOKIE_NAME}=${token}`);

  return workspace.id;
}

/** Creates a second, fully isolated account and returns its credentials. */
export async function createSecondUser(
  email = 'other@spendscope.test',
): Promise<{ userId: string; workspaceId: string; email: string; password: string }> {
  const user = await prisma.user.create({
    data: { email, name: 'Other Owner', passwordHash: await testPasswordHash() },
    select: { id: true },
  });
  const workspace = await prisma.workspace.create({
    data: { name: 'Other', ownerUserId: user.id },
    select: { id: true },
  });
  await ensureDefaultCategories(prisma, workspace.id);
  await prisma.settings.create({ data: { workspaceId: workspace.id } });
  return { userId: user.id, workspaceId: workspace.id, email, password: TEST_USER_PASSWORD };
}

export async function countRows(table: 'Transaction' | 'Category' | 'Budget' | 'ImportBatch'): Promise<number> {
  const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*)::bigint AS count FROM "${table}"`);
  return Number(result[0]?.count ?? 0);
}
