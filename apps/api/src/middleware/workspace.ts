import type { NextFunction, Request, Response } from 'express';

import { getWorkspaceId } from '../modules/workspace/workspace.service.ts';

/**
 * Resolves the active workspace for the request.
 *
 * The MVP has a single workspace, but every service call is scoped by the id
 * resolved here, so authentication can later replace this one function.
 */
export async function resolveWorkspace(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.locals.workspaceId = await getWorkspaceId();
    next();
  } catch (error) {
    next(error);
  }
}

export function workspaceIdOf(res: Response): string {
  return res.locals.workspaceId as string;
}
