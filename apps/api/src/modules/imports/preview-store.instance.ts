import { env } from '../../config/env.ts';
import { ImportPreviewStore } from '../../lib/import-preview-store.ts';

/** Process-wide preview store; started once when the module is first imported. */
export const importPreviewStore = new ImportPreviewStore({
  ttlMs: env.IMPORT_PREVIEW_TTL_MINUTES * 60_000,
});
importPreviewStore.start();
