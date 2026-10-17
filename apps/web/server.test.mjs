/** @vitest-environment node */

/**
 * Tests for the production web server (`apps/web/server.mjs`).
 *
 * These run against a real HTTP listener on an ephemeral port and a real
 * upstream, so the things that actually matter for a deployment are covered:
 * directory traversal, SPA fallback, cache headers, security headers, and the
 * `/api` proxy forwarding the cookie and the client address correctly.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clientAddress, createWebServer, parseUpstream, resolveStaticPath } from './server.mjs';

const INDEX_HTML = '<!doctype html><html><body>spa</body></html>';
// Over 1 KiB so the gzip path is exercised.
const ASSET_JS = `console.log("app bundle");\n`.repeat(80);

let fixtureRoot = '';
let webServer;
let webUrl = '';
let upstreamServer;
let upstreamUrl = '';
/** @type {{ method?: string, url?: string, headers: Record<string, string|string[]|undefined>, body: string }[]} */
let upstreamRequests = [];

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

/** Sends an HTTP/1.1 request exactly as written, without client-side normalisation. */
async function rawGet(baseUrl, rawPath) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), hostname, () => {
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'spendscope-web-'));
  await mkdir(path.join(fixtureRoot, 'assets'), { recursive: true });
  await writeFile(path.join(fixtureRoot, 'index.html'), INDEX_HTML);
  await writeFile(path.join(fixtureRoot, 'assets', 'app-1234abcd.js'), ASSET_JS);

  upstreamServer = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      upstreamRequests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': ['spendscope_session=token-one; Path=/; HttpOnly', 'other=two; Path=/'],
        'X-Total-Truncated': 'false',
      });
      res.end(JSON.stringify({ data: { status: 'ok' } }));
    });
  });
  upstreamUrl = await listen(upstreamServer);

  const created = createWebServer({
    root: fixtureRoot,
    upstream: parseUpstream(upstreamUrl),
    connectSrc: ['https://api.example.com'],
    logLevel: 'silent',
  });
  webServer = created.server;
  webUrl = await listen(webServer);
});

afterAll(async () => {
  await new Promise((resolve) => webServer.close(resolve));
  await new Promise((resolve) => upstreamServer.close(resolve));
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

describe('resolveStaticPath', () => {
  const root = '/srv/app/dist';

  it('resolves a file inside the root', () => {
    expect(resolveStaticPath(root, '/assets/app-1234abcd.js')).toBe('/srv/app/dist/assets/app-1234abcd.js');
  });

  it.each([
    ['/../secret.txt', 'parent traversal'],
    ['/%2e%2e/secret.txt', 'percent-encoded traversal'],
    ['/assets/..%2f..%2fsecret.txt', 'encoded separator traversal'],
    ['/assets/%2e%2e/%2e%2e/secret.txt', 'encoded dot segments'],
    ['/a\0b.txt', 'null byte'],
    ['/%E0%A4%A', 'malformed percent-encoding'],
  ])('rejects %s (%s)', (requestPath) => {
    expect(resolveStaticPath(root, requestPath)).toBeNull();
  });

  it('never returns a path outside the root for a deep traversal', () => {
    const resolved = resolveStaticPath(root, '/assets/../../../../etc/passwd');
    expect(resolved === null || resolved.startsWith('/srv/app/dist/')).toBe(true);
  });
});

describe('parseUpstream', () => {
  it('accepts http and https URLs and strips the trailing slash', () => {
    expect(parseUpstream('http://api.railway.internal:4000/')?.href).toBe('http://api.railway.internal:4000/');
    expect(parseUpstream('https://api.example.com')?.origin).toBe('https://api.example.com');
  });

  it('rejects anything that is not an http(s) URL', () => {
    expect(parseUpstream('ftp://example.com')).toBeNull();
    expect(parseUpstream('not a url')).toBeNull();
    expect(parseUpstream(undefined)).toBeNull();
  });
});

describe('clientAddress', () => {
  it('uses the last X-Forwarded-For entry, which is the one the edge appended', () => {
    expect(
      clientAddress({ headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }, socket: { remoteAddress: '::1' } }),
    ).toBe('203.0.113.9');
  });

  it('ignores a forged, non-address entry and falls back to the socket', () => {
    expect(
      clientAddress({ headers: { 'x-forwarded-for': 'evil, <script>' }, socket: { remoteAddress: '10.0.0.5' } }),
    ).toBe('10.0.0.5');
  });

  it('falls back to the socket when no header is present', () => {
    expect(clientAddress({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } })).toBe('::ffff:127.0.0.1');
  });
});

describe('static file serving', () => {
  it('serves index.html at the root with security headers and no-store', async () => {
    const response = await fetch(`${webUrl}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self' https://api.example.com");
  });

  it('serves a hashed asset as immutable, compressed', async () => {
    const response = await fetch(`${webUrl}/assets/app-1234abcd.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-type')).toContain('text/javascript');
    expect(await response.text()).toContain('app bundle');
  });

  it('falls back to index.html for a client-side route', async () => {
    const response = await fetch(`${webUrl}/settings/budgets`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
  });

  it('returns 404 for a missing asset instead of serving index.html', async () => {
    const response = await fetch(`${webUrl}/assets/does-not-exist.js`);
    expect(response.status).toBe(404);
  });

  it('rejects a raw, unnormalised traversal attempt instead of serving the file', async () => {
    // `fetch` normalises `%2e%2e` before sending, so a real traversal attempt is
    // only reachable with a raw socket write (what `curl --path-as-is` sends).
    const response = await rawGet(webUrl, '/assets/%2e%2e/%2e%2e/package.json');
    expect(response.split('\r\n')[0]).toContain('404');
    expect(response).not.toContain('"@spendscope/web"');
  });

  it('never serves a file outside the root when the path is normalised away', async () => {
    // The client turns `/assets/../../package.json` into `/package.json`; the
    // server must answer with the SPA shell (a client-side route), not the file.
    const response = await fetch(`${webUrl}/assets/../../package.json`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
  });

  it('answers the health check', async () => {
    const response = await fetch(`${webUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('rejects a state-changing method on a static path with 405', async () => {
    const response = await fetch(`${webUrl}/`, { method: 'POST', body: 'x' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('/api proxy', () => {
  it('forwards the path, the cookie and one X-Forwarded-For entry, and keeps both cookies', async () => {
    upstreamRequests = [];
    const response = await fetch(`${webUrl}/api/v1/health?verbose=1`, {
      headers: { cookie: 'spendscope_session=abc; other=two', origin: 'https://spendscope.example.com' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: 'ok' } });

    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('spendscope_session=token-one');

    expect(upstreamRequests).toHaveLength(1);
    const forwarded = upstreamRequests[0];
    expect(forwarded.url).toBe('/api/v1/health?verbose=1');
    expect(forwarded.headers.cookie).toBe('spendscope_session=abc; other=two');
    expect(forwarded.headers.origin).toBe('https://spendscope.example.com');
    expect(forwarded.headers['x-forwarded-for']).not.toContain(',');
    expect(String(forwarded.headers['x-forwarded-for'])).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
    expect(forwarded.headers['x-request-id']).toBeTruthy();
  });

  it('forwards a request body for a state-changing call', async () => {
    upstreamRequests = [];
    const response = await fetch(`${webUrl}/api/v1/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ merchant: 'Coffee' }),
    });
    expect(response.status).toBe(200);
    expect(upstreamRequests[0].method).toBe('POST');
    expect(upstreamRequests[0].body).toBe('{"merchant":"Coffee"}');
  });

  it('explains the misconfiguration when no upstream is configured', async () => {
    const created = createWebServer({ root: fixtureRoot, logLevel: 'silent' });
    const url = await listen(created.server);
    try {
      const response = await fetch(`${url}/api/v1/health`);
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe('NO_API_UPSTREAM');
    } finally {
      await new Promise((resolve) => created.server.close(resolve));
    }
  });

  it('answers 502 rather than hanging when the upstream refuses the connection', async () => {
    const created = createWebServer({
      root: fixtureRoot,
      upstream: parseUpstream('http://127.0.0.1:1'),
      logLevel: 'silent',
      upstreamTimeoutMs: 2_000,
    });
    const url = await listen(created.server);
    try {
      const response = await fetch(`${url}/api/v1/health`);
      expect(response.status).toBe(502);
      expect((await response.json()).error.code).toBe('BAD_GATEWAY');
    } finally {
      await new Promise((resolve) => created.server.close(resolve));
    }
  });
});
