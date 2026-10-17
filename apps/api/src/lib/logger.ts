import { pino } from 'pino';

import { env } from '../config/env.ts';

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
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
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
    ],
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
