import { createApp } from './app.ts';
import { assertProductionConfiguration, env } from './config/env.ts';
import { logger } from './lib/logger.ts';
import { prisma } from './lib/prisma.ts';
import { pruneExpiredSessions } from './modules/auth/auth.service.ts';
import { importPreviewStore } from './modules/imports/preview-store.instance.ts';
import { ensureWorkspace } from './modules/workspace/workspace.service.ts';

/**
 * Entry point.
 *
 * Startup order matters: the production configuration guard runs first and
 * fails fast, then the database is touched. A workspace is only bootstrapped
 * when explicitly enabled (`BOOTSTRAP_DEFAULT_WORKSPACE`), so a production
 * installation never contains an automatically created, unowned workspace.
 */
async function main(): Promise<void> {
  assertProductionConfiguration();

  const app = createApp();

  try {
    if (env.BOOTSTRAP_DEFAULT_WORKSPACE) {
      const workspace = await ensureWorkspace();
      logger.info({ workspaceId: workspace.id, created: workspace.created }, 'default workspace ready');
    }
  } catch (error) {
    logger.error({ err: error }, 'failed to bootstrap workspace — is the database migrated?');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  // Remove sessions that expired while the process was down, then keep pruning.
  try {
    const removed = await pruneExpiredSessions();
    if (removed > 0) logger.info({ removed }, 'pruned expired sessions');
    const previews = await importPreviewStore.purgeExpired();
    if (previews > 0) logger.info({ removed: previews }, 'pruned expired import previews');
  } catch (error) {
    logger.warn({ err: error }, 'could not prune expired rows at startup');
  }
  const pruneTimer = setInterval(
    () => {
      void pruneExpiredSessions().catch((error: unknown) => logger.warn({ err: error }, 'session prune failed'));
      // Parsed CSV previews expire too; sweeping them here keeps the table small.
      void importPreviewStore
        .purgeExpired()
        .catch((error: unknown) => logger.warn({ err: error }, 'import preview prune failed'));
    },
    60 * 60 * 1000,
  );
  pruneTimer.unref?.();

  const server = env.HOST
    ? app.listen(env.PORT, env.HOST, () => {
        logger.info({ port: env.PORT, host: env.HOST, env: env.NODE_ENV }, 'SpendScope API listening');
      })
    : // No host given: bind every interface. Node picks `::` (dual-stack) when
      // IPv6 is available, so both the platform's IPv4 proxy and an IPv6
      // private network can reach the process.
      app.listen(env.PORT, () => {
        logger.info({ port: env.PORT, env: env.NODE_ENV }, 'SpendScope API listening');
      });

  // Explicit timeouts. Without them a stalled client or a slow CSV parse can hold
  // a connection open indefinitely, and an idle keep-alive connection can outlive
  // the proxy in front of it (which produces intermittent 502s).
  server.requestTimeout = 120_000; // an upload plus parse must finish in two minutes
  server.headersTimeout = 20_000; // a slow header set is not a real client
  server.keepAliveTimeout = 65_000; // longer than a typical 60s proxy idle timeout

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    // Stop accepting new connections, and release idle keep-alive sockets so the
    // process can actually exit during a rolling deploy.
    server.closeIdleConnections();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    // Force-exit if connections do not drain in time.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
