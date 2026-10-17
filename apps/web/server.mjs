/**
 * Production web server for the built SpendScope single-page app.
 *
 * On a platform that injects `PORT` (Railway, Heroku, Fly, a container) the SPA
 * needs something to answer HTTP on that port. This is that "something": a
 * dependency-free static file server, plus an optional reverse proxy for `/api`.
 *
 * Why a hand-written server instead of `nginx` or `serve`:
 *   - it needs no extra runtime dependency and no Docker image;
 *   - the built SPA is a handful of files, so the feature set is small;
 *   - the security headers stay identical to `apps/web/nginx.conf`, which is
 *     what the local production-shaped stack uses, so both deployments serve
 *     the same headers.
 *
 * Two deployment shapes are supported, and the difference is one variable:
 *
 *   1. Single origin (recommended). `API_INTERNAL_URL` points at the API —
 *      for example `http://api.railway.internal:4000` on Railway's private
 *      network — and `/api/*` requests are proxied to it. The browser only ever
 *      talks to this origin, so the session cookie stays same-site, no CORS
 *      configuration is exercised, and the API never needs a public domain.
 *   2. Split origin. `API_INTERNAL_URL` is unset and the SPA calls the API
 *      directly, because `VITE_API_URL` was set when the SPA was built. Then
 *      the API's `CORS_ORIGIN` must list this origin, `CSP_CONNECT_SRC` must
 *      list the API origin, and the deployment should be on the same
 *      registrable domain so the `SameSite=Lax` cookie is still sent.
 *
 * Configuration (all optional except on a platform that requires `PORT`):
 *
 *   PORT               port to listen on (default 3000)
 *   HOST               interface to bind (default: all interfaces)
 *   WEB_DIST           directory of the built SPA (default: ./dist)
 *   API_INTERNAL_URL   upstream origin for `/api/*`, e.g. http://api.railway.internal:4000
 *   CSP_CONNECT_SRC    extra `connect-src` origins, comma separated (default: none)
 *   HSTS_MAX_AGE       send `Strict-Transport-Security` once TLS is settled (default: off)
 *   LOG_LEVEL          "silent" disables the access log (default: info)
 *
 * Requests are logged as one JSON line each: method, path (never the query
 * string — it can contain user-entered search terms), status and duration. No
 * cookie, header value or body is ever logged.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Raised when a request cannot be forwarded to the API. */
class ProxyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Compressible text types — mirrors `gzip_types` in `apps/web/nginx.conf`. */
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg\+xml)/;

/** Headers that describe this hop and must never be forwarded. */
const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Request headers forwarded to the API. Everything else is dropped. */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'cookie',
  'if-none-match',
  'origin',
  'referer',
  'user-agent',
  'x-request-id',
];

/** Response headers copied back from the API. Everything else is dropped. */
const FORWARDED_RESPONSE_HEADERS = [
  'cache-control',
  'content-disposition',
  'content-type',
  'etag',
  'last-modified',
  'location',
  'retry-after',
  'vary',
  'www-authenticate',
];

function securityHeaders(extraConnectSrc = []) {
  const connectSrc = ["'self'", ...extraConnectSrc].join(' ');
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      `connect-src ${connectSrc}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  };
}

/** Parses `API_INTERNAL_URL` into a URL with no trailing slash, or `null`. */
export function parseUpstream(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

/**
 * Maps a request path to a file inside `root`, or `null` when the path escapes
 * the root. The decoded path is rejected if it contains a null byte or any
 * `..` segment, then the resolved path is re-checked against the root so a
 * double-encoded traversal cannot survive.
 */
export function resolveStaticPath(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;

  const segments = decoded.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..')) return null;

  const resolved = path.resolve(root, ...segments);
  const rootWithSeparator = path.resolve(root) + path.sep;
  if (resolved !== path.resolve(root) && !resolved.startsWith(rootWithSeparator)) return null;
  return resolved;
}

/**
 * The address of the client that reached the platform's edge.
 *
 * The edge *appends* the peer address to `X-Forwarded-For`, so the last entry
 * is the only one it vouched for; anything to its left is client-controlled and
 * must not be trusted. Forwarding a single verified entry to the API is what
 * makes `TRUST_PROXY=1` correct there.
 */
export function clientAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  const candidates = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const last = candidates.at(-1);
  if (last && /^[0-9a-fA-F:.]+$/.test(last)) return last;
  return req.socket.remoteAddress ?? 'unknown';
}

async function readBody(req, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new ProxyError(413, 'Request body is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function createWebServer(options = {}) {
  const root = path.resolve(options.root ?? path.join(HERE, 'dist'));
  const upstream = options.upstream ?? null;
  const maxBodyBytes = options.maxBodyBytes ?? 12 * 1024 * 1024;
  const upstreamTimeoutMs = options.upstreamTimeoutMs ?? 120_000;
  const logLevel = options.logLevel ?? 'info';
  const log = (level, fields) => {
    if (logLevel === 'silent') return;
    process.stdout.write(`${JSON.stringify({ level, time: new Date().toISOString(), ...fields })}\n`);
  };

  const baseHeaders = securityHeaders(options.connectSrc ?? []);
  if (options.hstsMaxAge) {
    baseHeaders['Strict-Transport-Security'] = `max-age=${options.hstsMaxAge}; includeSubDomains`;
  }

  async function serveStatic(req, res, pathname, requestId) {
    // `/assets/` holds content-hashed file names, so a miss is a real 404: it
    // must never fall back to index.html, or a stale bundle would be masked.
    const isAsset = pathname.startsWith('/assets/');
    const notFound = () => {
      res.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found\n');
    };

    const candidates = isAsset ? [pathname] : [pathname, '/index.html'];
    for (const candidate of candidates) {
      const filePath = resolveStaticPath(root, candidate);
      if (!filePath) break;

      let info;
      try {
        info = await stat(filePath);
      } catch {
        continue;
      }
      if (!info.isFile()) continue;

      const extension = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
      const headers = { ...baseHeaders, 'Content-Type': contentType };

      if (candidate === '/index.html' || extension === '.html') {
        // A cached index.html would keep browsers on an old bundle after a
        // deploy, pointing at assets that no longer exist.
        headers['Cache-Control'] = 'no-store';
      } else if (isAsset) {
        headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      }

      const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
      const compress = acceptsGzip && info.size >= 1024 && COMPRESSIBLE.test(contentType);
      if (compress) {
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
      } else {
        headers['Content-Length'] = String(info.size);
      }

      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(filePath);
      if (compress) {
        stream.pipe(createGzip()).pipe(res);
      } else {
        stream.pipe(res);
      }
      stream.on('error', () => {
        log('error', { requestId, message: 'static read failed', file: candidate });
        res.destroy();
      });
      return;
    }

    notFound();
  }

  async function proxy(req, res, pathname, requestId) {
    if (!upstream) {
      // The SPA was built with `VITE_API_URL` set, so the browser is not
      // supposed to call `/api` here at all. Say so instead of serving HTML.
      sendJson(res, 404, {
        error: {
          code: 'NO_API_UPSTREAM',
          message: 'This service does not proxy the API. Set API_INTERNAL_URL or call the API directly.',
          details: { requestId },
        },
      });
      return;
    }

    const target = new URL(pathname + (req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), upstream);
    const headers = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.headers[name];
      if (value === undefined) continue;
      // A trailer with an invalid request id is harmless: the API validates
      // and replaces it.
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
    headers['x-forwarded-for'] = clientAddress(req);
    headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] ?? 'https';
    headers['x-forwarded-host'] = req.headers.host ?? '';
    if (!headers['x-request-id']) headers['x-request-id'] = requestId;

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await readBody(req, maxBodyBytes);
    }

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(target, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      });
    } catch (error) {
      log('error', { requestId, message: 'API upstream unreachable', err: String(error) });
      sendJson(res, 502, {
        error: { code: 'BAD_GATEWAY', message: 'The API is not reachable.', details: { requestId } },
      });
      return;
    }

    const responseHeaders = {};
    for (const [name, value] of upstreamResponse.headers) {
      if (HOP_BY_HOP.has(name)) continue;
      if (name === 'set-cookie') continue; // handled below, one header per cookie
      if (FORWARDED_RESPONSE_HEADERS.includes(name) || name.startsWith('x-')) responseHeaders[name] = value;
    }
    res.statusCode = upstreamResponse.status;
    for (const [name, value] of Object.entries(responseHeaders)) res.setHeader(name, value);
    // Every `Set-Cookie` must survive as its own header: joining them would
    // corrupt the session cookie the API just issued.
    const cookies = upstreamResponse.headers.getSetCookie?.() ?? [];
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);

    if (req.method === 'HEAD' || !upstreamResponse.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstreamResponse.body).pipe(res);
  }

  const server = createServer((req, res) => {
    const started = Date.now();
    const requestId = `web-${started.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    res.setHeader('X-Request-Id', requestId);

    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0] ?? '/';

    const finish = (message) => {
      log(message ? 'error' : 'info', {
        requestId,
        method: req.method,
        path: pathname,
        status: res.statusCode,
        durationMs: Date.now() - started,
        ...(message ? { message } : {}),
      });
    };
    // 'close' fires once, after 'finish' on a complete response or on an
    // aborted connection, so it is the single place an access line is written.
    res.on('close', () => finish(res.writableEnded ? null : 'connection closed before the response completed'));

    void (async () => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD' && !pathname.startsWith('/api/')) {
          res.writeHead(405, { ...baseHeaders, Allow: 'GET, HEAD' });
          res.end('Method not allowed\n');
          return;
        }
        if (pathname === '/health' || pathname === '/healthz') {
          sendJson(res, 200, { status: 'ok' });
          return;
        }
        if (pathname.startsWith('/api/')) {
          await proxy(req, res, pathname, requestId);
          return;
        }
        await serveStatic(req, res, pathname, requestId);
      } catch (error) {
        const status = error instanceof ProxyError ? error.status : 500;
        log('error', { requestId, message: String(error) });
        if (!res.headersSent) {
          sendJson(res, status, {
            error: {
              code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR',
              message: status === 413 ? 'Request body is too large.' : 'Something went wrong.',
              details: { requestId },
            },
          });
        } else {
          res.destroy();
        }
      }
    })();
  });

  return { server, root, upstream };
}

function start() {
  const connectSrc = (process.env.CSP_CONNECT_SRC ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const upstream = parseUpstream(process.env.API_INTERNAL_URL);
  const root = process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : undefined;
  const hstsMaxAge = process.env.HSTS_MAX_AGE ? Number.parseInt(process.env.HSTS_MAX_AGE, 10) : 0;

  if (process.env.API_INTERNAL_URL && !upstream) {
    process.stderr.write('API_INTERNAL_URL is not a valid http(s) URL; refusing to start.\n');
    process.exit(1);
  }

  const { server } = createWebServer({
    root,
    upstream,
    connectSrc,
    hstsMaxAge: Number.isFinite(hstsMaxAge) && hstsMaxAge > 0 ? hstsMaxAge : 0,
    logLevel: process.env.LOG_LEVEL ?? 'info',
  });

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST;
  const onListening = () => {
    process.stdout.write(
      `${JSON.stringify({
        level: 'info',
        msg: 'SpendScope web server listening',
        port,
        mode: upstream ? 'single-origin (proxying /api)' : 'split-origin (static only)',
      })}\n`,
    );
  };
  if (host) server.listen(port, host, onListening);
  else server.listen(port, onListening);

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only start when executed directly, so tests can import the factory.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start();
}
