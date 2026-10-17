import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { logger } from './lib/logger.ts';
import { prisma } from './lib/prisma.ts';
import { ensureWorkspace } from './modules/workspace/workspace.service.ts';

/**
 * Entry point. Bootstraps the default workspace (idempotently) before listening
 * so the first request already has a workspace, categories and settings.
 */
async function main(): Promise<void> {
  const app = createApp();

  try {
    const workspace = await ensureWorkspace();
    logger.info(
      { workspaceId: workspace.id, created: workspace.created },
      'workspace ready',
    );
  } catch (error) {
    logger.error({ err: error }, 'failed to bootstrap workspace — is the database migrated?');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'SpendScope API listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
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
