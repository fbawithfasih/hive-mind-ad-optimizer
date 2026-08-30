/**
 * Instrumentation for the warn → strict migration.
 *
 * The guard defaults to `warn` outside tests, which means an unscoped query
 * logs and passes through: the isolation guarantee is advisory in production.
 * Flipping to `strict` blind risks turning a silent gap into an outage, so this
 * counts what actually happens. total === 0 under real traffic is the evidence
 * that flipping is safe.
 *
 * Uses the same direct-extension harness as tenant-guard.test.js — no database.
 */
import { jest } from '@jest/globals';
import {
  tenantGuardExtension, tenantGuardStats, resetTenantGuardStats,
} from '../tenant-guard.js';
import { runWithTenant } from '../tenant-context.js';

const ORG = 'org-A';

/** Invoke the guard for one operation. `ctx: 'none'` means no tenant context. */
async function runOp({ model, operation = 'findMany', ctx = 'none' }) {
  const base = new Proxy({}, { get: () => ({ findUnique: jest.fn() }) });
  const op = tenantGuardExtension(base).query.$allModels.$allOperations;
  const query = jest.fn().mockResolvedValue([]);
  const invoke = () => op({ model, operation, args: {}, query });
  return ctx === 'none' ? invoke() : runWithTenant(ORG, invoke);
}

beforeEach(() => {
  resetTenantGuardStats();
  process.env.TENANT_GUARD_MODE = 'warn';
});
afterEach(() => {
  delete process.env.TENANT_GUARD_MODE;
});

describe('unscoped access counter', () => {
  it('reports zero when every query carries tenant context', async () => {
    await runOp({ model: 'SellerProfile', ctx: 'tenant' });

    const stats = tenantGuardStats();
    expect(stats.total).toBe(0);
    expect(stats.distinct).toBe(0);
  });

  it('counts a query that ran with no tenant context', async () => {
    await runOp({ model: 'SellerProfile' });

    const stats = tenantGuardStats();
    expect(stats.total).toBe(1);
    // Not toHaveProperty — it reads the dot as a path separator.
    expect(Object.keys(stats.sites)).toContain('SellerProfile.findMany');
  });

  it('aggregates repeats per call site rather than per call', async () => {
    await runOp({ model: 'SellerProfile' });
    await runOp({ model: 'SellerProfile' });
    await runOp({ model: 'ReportJob', operation: 'count' });

    const stats = tenantGuardStats();
    expect(stats.total).toBe(3);
    expect(stats.distinct).toBe(2);
    expect(stats.sites['SellerProfile.findMany'].count).toBe(2);
    expect(stats.sites['ReportJob.count'].count).toBe(1);
  });

  it('does not count models that are not tenant-scoped', async () => {
    await runOp({ model: 'WebhookEvent' });
    expect(tenantGuardStats().total).toBe(0);
  });

  it('records a call site that is not the guard itself', async () => {
    await runOp({ model: 'SellerProfile' });

    const { from } = tenantGuardStats().sites['SellerProfile.findMany'];
    expect(Array.isArray(from)).toBe(true);
    // The point of capturing it is finding the caller; frames naming the guard
    // would be useless.
    expect(from.join('\n')).not.toMatch(/tenant-guard\.js/);
  });

  it('timestamps first and last occurrence', async () => {
    await runOp({ model: 'SellerProfile' });
    const e = tenantGuardStats().sites['SellerProfile.findMany'];
    expect(typeof e.firstSeen).toBe('string');
    expect(typeof e.lastSeen).toBe('string');
  });

  it('reports the mode it is running in', () => {
    expect(tenantGuardStats().mode).toBe('warn');
    process.env.TENANT_GUARD_MODE = 'strict';
    expect(tenantGuardStats().mode).toBe('strict');
  });

  it('counts nothing in strict mode — the query throws instead', async () => {
    process.env.TENANT_GUARD_MODE = 'strict';

    await expect(runOp({ model: 'SellerProfile' })).rejects.toThrow(/no tenant context/);
    expect(tenantGuardStats().total).toBe(0);
  });
});
