import { api, request } from './helpers/api.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { pino } from 'pino';

import { createApp } from '../src/app.ts';
import { REDACT_PATHS } from '../src/lib/logger.ts';
import { resetDatabase } from './helpers/db.ts';

/**
 * Observability.
 *
 * Every response carries a request id, so a user can quote one line and an
 * operator can find the matching log entry. Nothing else internal is exposed.
 */

const app = createApp();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('request ids', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('assigns an id to every response and accepts an inbound one', async () => {
    const generated = await api(app).get('/api/v1/transactions').expect(200);
    expect(generated.headers['x-request-id']).toMatch(UUID_PATTERN);

    // A trusted edge can pass its own id through, and it is echoed unchanged.
    const supplied = await request(app).get('/api/v1/health').set('x-request-id', 'edge-trace-42').expect(200);
    expect(supplied.headers['x-request-id']).toBe('edge-trace-42');
  });

  it('ignores an inbound id that is not a safe token', async () => {
    const spaced = await request(app).get('/api/v1/health').set('x-request-id', 'bad id here').expect(200);
    expect(spaced.headers['x-request-id']).toMatch(UUID_PATTERN);

    const tooLong = await request(app).get('/api/v1/health').set('x-request-id', 'x'.repeat(200)).expect(200);
    expect(tooLong.headers['x-request-id']).toMatch(UUID_PATTERN);
  });

  it('includes the request id on errors so it can be reported', async () => {
    const response = await api(app).get('/api/v1/transactions/not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('returns a request id for an unknown endpoint', async () => {
    const response = await api(app).get('/api/v1/nope').expect(404);
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });
});

/**
 * Log redaction.
 *
 * The request-completion line includes the request and response headers. That
 * makes the session token — issued in `Set-Cookie` — one missing rule away from
 * being written to the platform's log sink, where anyone with log access could
 * replay it. This asserts the rules against a real Pino instance rather than
 * inspecting the list.
 */
describe('log redaction', () => {
  it('never writes a session token, a cookie header or a CSV row to the log', () => {
    const lines: string[] = [];
    const capture = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const log = pino({ redact: { paths: [...REDACT_PATHS], censor: '[redacted]' } }, capture);

    log.info(
      {
        req: { id: 'abc', headers: { cookie: 'spendscope_session=live-session-token', authorization: 'Bearer x' } },
        res: { statusCode: 201, headers: { 'set-cookie': 'spendscope_session=live-session-token; Path=/; HttpOnly' } },
        transaction: { description: 'Private merchant', notes: 'private note' },
        body: { content: 'date,amount\n2026-01-01,10.00' },
      },
      'request completed',
    );

    const output = lines.join('');
    expect(output).not.toContain('live-session-token');
    expect(output).not.toContain('Private merchant');
    expect(output).not.toContain('private note');
    expect(output).not.toContain('2026-01-01,10.00');
    expect(output).toContain('[redacted]');
    // The useful parts of the line survive: an operator can still trace a request.
    expect(output).toContain('"statusCode":201');
  });
});
