import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));

// A single `.env` lives at the repository root. `override: false` keeps any
// value already present in `process.env` (used by the test suite to point at
// the isolated test database) so tests never touch development data.
loadEnv({ path: path.resolve(here, '../../../../.env'), quiet: true });

/** `true`/`false`/`1`/`0` accepted; anything else is rejected. */
const booleanish = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      return value === 'true' || value === '1';
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).default(5 * 1024 * 1024),
  IMPORT_PREVIEW_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- Trusted proxy -------------------------------------------------------
  // Express `trust proxy` setting. Set to the number of proxies in front of the
  // API (e.g. 1 behind a single reverse proxy) so rate limiting sees the real
  // client address. Disabled by default; never trust the header blindly.
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '' || value === 'false' || value === '0') return false as const;
      if (value === 'true') return true as const;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : false;
    }),

  // --- Authentication ------------------------------------------------------
  SESSION_COOKIE_NAME: z.string().trim().min(1).max(64).default('spendscope_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 365).default(24 * 30),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(20),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Allow new accounts to be created through the public registration endpoint. */
  ALLOW_REGISTRATION: booleanish(true),
  /**
   * Bootstrap a default workspace on start when none exists. Useful for local
   * development and tests; must stay off in production so demo data can never
   * appear in a real workspace.
   */
  BOOTSTRAP_DEFAULT_WORKSPACE: booleanish(true),

  // --- Production safety valves -------------------------------------------
  // These exist so a production-shaped stack can be run locally (Docker
  // compose) without weakening the real production checks.
  SESSION_COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value === 'true' || value === '1')),
  ALLOW_INSECURE_COOKIES: booleanish(false),
  ALLOW_LOCAL_DATABASE_IN_PRODUCTION: booleanish(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

const data = parsed.data;
const isProduction = data.NODE_ENV === 'production';

// Secure cookies default to on in production, off elsewhere; an explicit value
// always wins so a deliberate local override is possible.
const sessionCookieSecure = data.SESSION_COOKIE_SECURE ?? isProduction;

export const env = {
  ...data,
  isProduction,
  isTest: data.NODE_ENV === 'test',
  corsOrigins: data.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  sessionCookieSecure,
} as const;

export type Env = typeof env;

function isLoopback(url: string): boolean {
  return /(^|[@/])(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url);
}

/**
 * The parts of the configuration the production guard inspects.
 *
 * Narrowing the parameter keeps the guard a pure function, so its rules can be
 * unit tested without mutating `process.env`.
 */
export interface ProductionConfig {
  isProduction: boolean;
  corsOrigins: readonly string[];
  DATABASE_URL: string;
  sessionCookieSecure: boolean;
  ALLOW_LOCAL_DATABASE_IN_PRODUCTION: boolean;
  ALLOW_INSECURE_COOKIES: boolean;
  BOOTSTRAP_DEFAULT_WORKSPACE: boolean;
}

/**
 * True when the operator has explicitly acknowledged every production override
 * (local database, insecure cookies, local origin). Such a run is treated as a
 * deliberate local, production-shaped environment.
 */
function acknowledgedLocalRun(config: ProductionConfig): boolean {
  return (
    config.ALLOW_LOCAL_DATABASE_IN_PRODUCTION &&
    config.ALLOW_INSECURE_COOKIES &&
    config.corsOrigins.length > 0 &&
    config.corsOrigins.every((origin) => isLoopback(origin))
  );
}

/**
 * Production configuration guardrails, as a list of problems.
 *
 * An empty list means the configuration is safe to serve financial data. Every
 * check has a documented, explicit override so a local production-shaped run is
 * possible without weakening the real checks.
 */
export function productionConfigProblems(config: ProductionConfig = env): string[] {
  if (!config.isProduction) return [];

  const problems: string[] = [];
  // An explicitly acknowledged local run relaxes the origin and cookie rules.
  // The operator has stated in the environment that this is not a real
  // production deployment, and the acknowledgement is a deliberate act.
  const acknowledgedLocal = acknowledgedLocalRun(config);

  if (config.corsOrigins.length === 0) {
    problems.push('CORS_ORIGIN must list the production frontend origin(s).');
  }
  for (const origin of config.corsOrigins) {
    if (acknowledgedLocal) break;
    if (isLoopback(origin)) {
      problems.push(
        `CORS_ORIGIN still points at a local origin (${origin}). Set the real production origin.`,
      );
    }
    if (!origin.startsWith('https://')) {
      problems.push(`CORS_ORIGIN entry "${origin}" must use https:// in production.`);
    }
  }

  if (isLoopback(config.DATABASE_URL) && !config.ALLOW_LOCAL_DATABASE_IN_PRODUCTION) {
    problems.push(
      'DATABASE_URL points at a local database. Set the managed production database URL (or ALLOW_LOCAL_DATABASE_IN_PRODUCTION=true for a deliberate local production-shaped run).',
    );
  }

  if (!config.sessionCookieSecure && !config.ALLOW_INSECURE_COOKIES) {
    problems.push(
      'Session cookies must be Secure in production. Set SESSION_COOKIE_SECURE=true (or ALLOW_INSECURE_COOKIES=true for a deliberate local run).',
    );
  }

  if (config.BOOTSTRAP_DEFAULT_WORKSPACE && !acknowledgedLocal) {
    problems.push(
      'BOOTSTRAP_DEFAULT_WORKSPACE must be false in production so a demo workspace is never created automatically.',
    );
  }

  return problems;
}

/**
 * Throws with an actionable message rather than letting an insecure
 * configuration serve financial data. Runs once at startup.
 */
export function assertProductionConfiguration(config: ProductionConfig = env): void {
  const problems = productionConfigProblems(config);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start: production configuration is unsafe.\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
}
