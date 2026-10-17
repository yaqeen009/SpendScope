import { describe, expect, it } from 'vitest';

import { assertProductionConfiguration, productionConfigProblems, type ProductionConfig } from './env.ts';

/**
 * Production configuration guardrails.
 *
 * These are the checks that stand between a misconfigured deployment and live
 * financial data, so each rule is asserted directly. The guard takes its config
 * as an argument, which is what makes this possible without touching the real
 * environment.
 */

const SAFE: ProductionConfig = {
  isProduction: true,
  corsOrigins: ['https://app.spendscope.example'],
  DATABASE_URL: 'postgresql://user:pw@db.internal:5432/spendscope?schema=public',
  sessionCookieSecure: true,
  ALLOW_LOCAL_DATABASE_IN_PRODUCTION: false,
  ALLOW_INSECURE_COOKIES: false,
  BOOTSTRAP_DEFAULT_WORKSPACE: false,
};

function problems(overrides: Partial<ProductionConfig>): string[] {
  return productionConfigProblems({ ...SAFE, ...overrides });
}

describe('production configuration guardrails', () => {
  it('accepts a fully configured production environment', () => {
    expect(productionConfigProblems(SAFE)).toEqual([]);
  });

  it('does not apply to development or test', () => {
    expect(problems({ isProduction: false, corsOrigins: ['http://localhost:5173'] })).toEqual([]);
  });

  it('requires at least one CORS origin', () => {
    expect(problems({ corsOrigins: [] })).toHaveLength(1);
  });

  it('rejects a local origin', () => {
    const found = problems({ corsOrigins: ['https://localhost:5173'] });
    expect(found.join('\n')).toContain('local origin');
  });

  it('requires https for every origin', () => {
    const found = problems({ corsOrigins: ['http://app.spendscope.example'] });
    expect(found.join('\n')).toContain('must use https://');
  });

  it('reports each unsafe origin separately', () => {
    expect(problems({ corsOrigins: ['http://localhost:5173', 'http://a.example'] })).toHaveLength(3);
  });

  it('rejects a local database unless explicitly allowed', () => {
    const found = problems({ DATABASE_URL: 'postgresql://postgres@localhost:5433/spendscope' });
    expect(found.join('\n')).toContain('local database');

    expect(
      problems({
        DATABASE_URL: 'postgresql://postgres@localhost:5433/spendscope',
        ALLOW_LOCAL_DATABASE_IN_PRODUCTION: true,
        ALLOW_INSECURE_COOKIES: true,
        BOOTSTRAP_DEFAULT_WORKSPACE: true,
        corsOrigins: ['http://localhost:5173'],
      }),
    ).toEqual([]);
  });

  it('rejects an insecure session cookie unless explicitly allowed', () => {
    expect(problems({ sessionCookieSecure: false }).join('\n')).toContain('Secure');

    expect(problems({ sessionCookieSecure: false, ALLOW_INSECURE_COOKIES: true })).toEqual([]);
  });

  it('rejects automatic workspace bootstrapping outside an acknowledged local run', () => {
    const found = problems({ BOOTSTRAP_DEFAULT_WORKSPACE: true });
    expect(found.join('\n')).toContain('BOOTSTRAP_DEFAULT_WORKSPACE');
  });

  it('allows bootstrapping only when every local override is acknowledged', () => {
    // Local database and local origin acknowledged, but not insecure cookies.
    expect(
      problems({
        BOOTSTRAP_DEFAULT_WORKSPACE: true,
        ALLOW_LOCAL_DATABASE_IN_PRODUCTION: true,
        corsOrigins: ['http://localhost:5173'],
      }).join('\n'),
    ).toContain('BOOTSTRAP_DEFAULT_WORKSPACE');

    // All of them acknowledged: this is a deliberate local production-shaped run.
    expect(
      problems({
        BOOTSTRAP_DEFAULT_WORKSPACE: true,
        ALLOW_LOCAL_DATABASE_IN_PRODUCTION: true,
        ALLOW_INSECURE_COOKIES: true,
        sessionCookieSecure: false,
        DATABASE_URL: 'postgresql://postgres@localhost:5433/spendscope',
        corsOrigins: ['http://localhost:5173'],
      }),
    ).toEqual([]);
  });

  it('throws with an actionable message listing every problem', () => {
    expect(() =>
      assertProductionConfiguration({
        ...SAFE,
        corsOrigins: ['http://localhost:5173'],
        DATABASE_URL: 'postgresql://postgres@localhost:5433/spendscope',
        sessionCookieSecure: false,
        BOOTSTRAP_DEFAULT_WORKSPACE: true,
      }),
    ).toThrowError(/production configuration is unsafe/);
  });
});
