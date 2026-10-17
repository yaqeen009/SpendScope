import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

import { AppError, ValidationError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';

/** Maps a `ZodError` into a compact, safe list of `{ path, message }` issues. */
export function formatZodIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function validate<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`${label} validation failed`, formatZodIssues(result.error));
  }
  return result.data;
}

/** Validates `req.body` in place and replaces it with the parsed value. */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = validate(schema, req.body, 'Request body');
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validates and normalises `req.query`. Express 5 exposes `req.query` as a
 * getter-only property, so the parsed value is stored on `res.locals` instead
 * of being written back to the request.
 */
export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.locals.query = validate(schema, req.query, 'Query parameters');
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateParams<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.locals.params = validate(schema, req.params, 'Route parameters');
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Reads a value stored by the validators above. */
export function queryOf<T>(res: Response): T {
  return res.locals.query as T;
}

export function paramsOf<T>(res: Response): T {
  return res.locals.params as T;
}

/**
 * Centralised error handler. Known `AppError`s keep their status and code;
 * everything else becomes a generic 500 and is logged without the request body.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error({ err: error, path: req.path }, 'request failed');
    } else {
      logger.warn({ code: error.code, path: req.path, status: error.status }, 'request rejected');
    }
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: formatZodIssues(error),
      },
    });
    return;
  }

  // Body-parser raises this when the JSON payload exceeds the configured limit.
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: string }).type === 'entity.too.large'
  ) {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The uploaded file is too large' },
    });
    return;
  }

  logger.error({ err: error, path: req.path }, 'unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist' },
  });
}
