import type { Response } from 'express';

import { authOf } from './auth.ts';

/**
 * The active workspace is always the authenticated user's workspace.
 *
 * Every service already scopes its queries by the id returned here, so tenant
 * isolation is enforced in one place: nothing reads a workspace id from the
 * request body, path or query.
 */
export function workspaceIdOf(res: Response): string {
  return authOf(res).workspace.id;
}
