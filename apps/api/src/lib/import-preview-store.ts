import { randomUUID } from 'node:crypto';

import type { ColumnMapping, ImportDetectionDTO } from '@spendscope/shared';

import type { RawCsvRecord } from './import-parse.ts';

/**
 * Server-side store for parsed import previews.
 *
 * Why it exists: the import wizard previews a file, then commits it in a second
 * request. The commit request must not trust rows the browser sends back, so the
 * server keeps the **parsed records** (never the raw CSV file) for a short time
 * and re-validates on commit.
 *
 * Retention: entries expire after `IMPORT_PREVIEW_TTL_MINUTES` (default 30) and
 * are swept on a timer, so no CSV content is retained beyond the preview
 * window. Because the store is in-process, a server restart simply invalidates
 * outstanding previews (the user re-uploads) — documented as a limitation.
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
  createdAt: number;
  expiresAt: number;
}

export interface ImportPreviewStoreOptions {
  ttlMs: number;
  maxEntries?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export class ImportPreviewStore {
  private readonly entries = new Map<string, StoredPreview>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: ImportPreviewStoreOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 25;
    this.now = options.now ?? (() => Date.now());
  }

  /** Starts the background sweep. The timer is unref'd so it never blocks exit. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.purgeExpired(), Math.max(60_000, this.ttlMs / 2));
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.entries.clear();
  }

  create(
    input: Omit<StoredPreview, 'id' | 'createdAt' | 'expiresAt'>,
  ): StoredPreview {
    this.purgeExpired();
    // Bound memory: drop the oldest preview when the cap is reached.
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const now = this.now();
    const preview: StoredPreview = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.entries.set(preview.id, preview);
    return preview;
  }

  get(id: string): StoredPreview | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(id);
      return null;
    }
    return entry;
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  purgeExpired(): number {
    const now = this.now();
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }
}
