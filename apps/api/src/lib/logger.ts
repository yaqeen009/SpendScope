import { pino } from 'pino';

import { env } from '../config/env.ts';

/**
 * Fields that must never reach the log sink.
 *
 * Exported so a test can assert the rules against a real Pino instance: a rule
 * deleted from this list would otherwise be noticed only in production.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  // The response side matters just as much: the session token is issued in
  // `Set-Cookie`, and logging the response headers without this rule writes a
  // live session token to the log sink. `*` covers nested shapes such as an
  // error object that carries a headers map.
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'res.headers.cookie',
  '*.headers["set-cookie"]',
  '*.headers.cookie',
  'req.body.description',
  'req.body.notes',
  'req.body.merchant',
  'req.body.content',
  'req.body.categoryOverrides',
  'res.body',
  'transaction.description',
  'transaction.notes',
  '*.description',
  '*.notes',
  '*.merchant',
  '*.content',
] as const;

/**
 * Structured logger.
 *
 * Redaction rules deliberately cover the fields that could carry private
 * financial data (transaction descriptions, notes, whole CSV rows) so they are
 * never written to logs. Only ids, counts and error codes are logged.
 */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [...REDACT_PATHS],
    censor: '[redacted]',
  },
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

export type Logger = typeof logger;
