import type { ColumnMapping, ImportDetectionDTO } from '@spendscope/shared';

import type { RawCsvRecord } from './import-parse.ts';
import { prisma } from './prisma.ts';
import type { Prisma } from './prisma.ts';

/**
 * Database-backed store for parsed import previews.
 *
 * The wizard previews a file, then commits it in a second request. The commit
 * must not trust rows the browser sends back, so the server keeps the **parsed
 * records** (never the raw CSV file) and re-validates on commit.
 *
 * Properties this store guarantees:
 *
 *  - **Survives a restart** and is shared by every API instance (it is a table,
 *    not a process-local map).
 *  - **Bounded retention.** Rows expire after `IMPORT_PREVIEW_TTL_MINUTES` and
 *    are swept on start and on a timer, so no parsed file content is kept beyond
 *    the preview window.
 *  - **Idempotent commit.** `status` moves PENDING → COMMITTING → COMMITTED, and
 *    the create-result is recorded. Replaying the same preview id returns the
 *    recorded result instead of importing the rows again.
 */
export interface StoredPreview {
  id: string;
  workspaceId: string;
  filename: string;
  fileSizeBytes: number;
  headers: string[];
  records: RawCsvRecord[];
  detection: ImportDetectionDTO;
  mapping: Partial<ColumnMapping> | null;
  warnings: string[];
  status: string;
  result: unknown | null;
  createdAt: number;
  expiresAt: number;
}

export interface ImportPreviewStoreOptions {
  ttlMs: number;
  /** Maximum number of live previews per workspace. */
  maxEntriesPerWorkspace?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

type Client = Prisma.TransactionClient | typeof prisma;

export class ImportPreviewStore {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: ImportPreviewStoreOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntriesPerWorkspace ?? 25;
    this.now = options.now ?? (() => Date.now());
  }

  /** Starts the background sweep. Unref'd so it never blocks process exit. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.purgeExpired();
    }, Math.max(60_000, this.ttlMs / 2));
    this.timer.unref?.();
  }

  /** Stops the sweep. Rows are removed by expiry, not by shutdown. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Deletes previews whose TTL has passed. Returns the number removed. */
  async purgeExpired(): Promise<number> {
    const result = await prisma.importPreview.deleteMany({
      where: { expiresAt: { lt: new Date(this.now()) } },
    });
    return result.count;
  }

  async create(
    input: Omit<StoredPreview, 'id' | 'createdAt' | 'expiresAt' | 'status' | 'result'>,
  ): Promise<StoredPreview> {
    const now = this.now();
    const expiresAt = new Date(now + this.ttlMs);

    const row = await prisma.importPreview.create({
      data: {
        workspaceId: input.workspaceId,
        filename: input.filename,
        fileSizeBytes: input.fileSizeBytes,
        headers: input.headers as unknown as Prisma.InputJsonValue,
        records: input.records as unknown as Prisma.InputJsonValue,
        detection: input.detection as unknown as Prisma.InputJsonValue,
        mapping: (input.mapping ?? null) as unknown as Prisma.InputJsonValue,
        warnings: input.warnings as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
    });

    // Bound the number of live previews per workspace.
    const extra = await prisma.importPreview.findMany({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'desc' },
      skip: this.maxEntries,
      select: { id: true },
    });
    if (extra.length > 0) {
      await prisma.importPreview.deleteMany({ where: { id: { in: extra.map((item) => item.id) } } });
    }

    return toStoredPreview(row);
  }

  async get(id: string): Promise<StoredPreview | null> {
    const row = await prisma.importPreview.findFirst({ where: { id } });
    if (!row) return null;
    if (row.expiresAt.getTime() < this.now()) return null;
    return toStoredPreview(row);
  }

  async delete(id: string): Promise<void> {
    await prisma.importPreview.deleteMany({ where: { id } });
  }

  /**
   * Atomically claims a preview for commit.
   *
   * Returns `claimed: true` when this caller won the race. When another caller
   * already committed it, returns `claimed: false` with the recorded row so the
   * response can be replayed.
   */
  async claim(
    client: Client,
    id: string,
    workspaceId: string,
  ): Promise<{ claimed: boolean; existing: StoredPreview | null }> {
    const updated = await client.importPreview.updateMany({
      where: { id, workspaceId, status: 'PENDING' },
      data: { status: 'COMMITTING' },
    });
    if (updated.count > 0) return { claimed: true, existing: null };

    const row = await client.importPreview.findFirst({ where: { id, workspaceId } });
    return { claimed: false, existing: row ? toStoredPreview(row) : null };
  }

  /** Records the create-result and marks the preview committed. */
  async complete(client: Client, id: string, result: unknown): Promise<void> {
    await client.importPreview.updateMany({
      where: { id },
      data: {
        status: 'COMMITTED',
        committedAt: new Date(this.now()),
        result: result as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

interface PreviewRow {
  id: string;
  workspaceId: string;
  filename: string;
  fileSizeBytes: number;
  headers: Prisma.JsonValue;
  records: Prisma.JsonValue;
  detection: Prisma.JsonValue;
  mapping: Prisma.JsonValue;
  warnings: Prisma.JsonValue;
  status: string;
  result: Prisma.JsonValue;
  createdAt: Date;
  expiresAt: Date;
}

function toStoredPreview(row: PreviewRow): StoredPreview {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    filename: row.filename,
    fileSizeBytes: row.fileSizeBytes,
    headers: row.headers as unknown as string[],
    records: row.records as unknown as RawCsvRecord[],
    detection: row.detection as unknown as ImportDetectionDTO,
    mapping: row.mapping as unknown as Partial<ColumnMapping> | null,
    warnings: row.warnings as unknown as string[],
    status: row.status,
    result: row.result ?? null,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
  };
}
