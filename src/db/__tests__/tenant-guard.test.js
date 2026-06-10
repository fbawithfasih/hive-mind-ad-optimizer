/**
 * Tenant guard unit tests.
 *
 * Exercises the Prisma extension callback directly (no real database) to prove
 * that a forgotten orgId filter cannot read or write another organization's data.
 */

import { jest } from '@jest/globals';
import { tenantGuardExtension, TENANT_MODELS } from '../tenant-guard.js';
import { runWithTenant, runAsSystem } from '../tenant-context.js';

const ORG = 'org-A';
const OTHER = 'org-B';

// A mock "base client" for the ownership pre-check used by update/delete/upsert.
// `target` is what findUnique returns for the pre-check.
function makeBase(target) {
  const findUnique = jest.fn().mockResolvedValue(target);
  return {
    client: new Proxy({}, { get: () => ({ findUnique }) }),
    findUnique,
  };
}

/** Invoke the guard for one operation, returning { result, query } for asserts. */
async function runOp({ model, operation, args, ctx, baseTarget, queryReturn }) {
  const { client } = makeBase(baseTarget);
  const ext = tenantGuardExtension(client);
  const op = ext.query.$allModels.$allOperations;
  const query = jest.fn().mockResolvedValue(queryReturn);

  const invoke = () => op({ model, operation, args, query });
  let result;
  if (ctx === 'system') result = await runAsSystem(invoke);
  else if (ctx === 'none') result = await invoke();
  else result = await runWithTenant(ORG, invoke);

  return { result, query };
}

afterEach(() => {
  delete process.env.TENANT_GUARD_MODE;
});

describe('TENANT_MODELS', () => {
  it('includes the directly org-scoped models and excludes global ones', () => {
    expect(TENANT_MODELS.has('ReportJob')).toBe(true);
    expect(TENANT_MODELS.has('Subscription')).toBe(true);
    expect(TENANT_MODELS.has('User')).toBe(false);
    expect(TENANT_MODELS.has('Invoice')).toBe(false); // scoped via Subscription
    expect(TENANT_MODELS.has('ApiKey')).toBe(false);  // scoped via User
  });
});

describe('non-tenant models pass through untouched', () => {
  it('does not inject orgId for User', async () => {
    const args = { where: { email: 'a@b.com' } };
    const { query } = await runOp({ model: 'User', operation: 'findFirst', args, ctx: 'tenant' });
    expect(query).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
  });
});

describe('system context bypasses injection', () => {
  it('leaves args unchanged for a tenant model', async () => {
    const args = { where: { orgId: OTHER } };
    const { query } = await runOp({ model: 'ReportJob', operation: 'findMany', args, ctx: 'system' });
    expect(query).toHaveBeenCalledWith({ where: { orgId: OTHER } });
  });
});

describe('tenant context — reads & bulk ops', () => {
  it('AND-injects orgId into findMany', async () => {
    const { query } = await runOp({
      model: 'CampaignRule', operation: 'findMany', args: { where: { enabled: true } }, ctx: 'tenant',
    });
    expect(query).toHaveBeenCalledWith({ where: { AND: [{ enabled: true }, { orgId: ORG }] } });
  });

  it('injects orgId when no where is provided (count)', async () => {
    const { query } = await runOp({ model: 'AlertFire', operation: 'count', args: undefined, ctx: 'tenant' });
    expect(query).toHaveBeenCalledWith({ where: { AND: [{}, { orgId: ORG }] } });
  });

  it('a caller-supplied foreign orgId cannot widen scope (ANDed away)', async () => {
    const { query } = await runOp({
      model: 'ReportJob', operation: 'findMany', args: { where: { orgId: OTHER } }, ctx: 'tenant',
    });
    // Result is orgId === OTHER AND orgId === ORG → impossible → no leak.
    expect(query).toHaveBeenCalledWith({ where: { AND: [{ orgId: OTHER }, { orgId: ORG }] } });
  });

  it('injects orgId into updateMany', async () => {
    const { query } = await runOp({
      model: 'SellerProfile', operation: 'updateMany', args: { where: { isDefault: true }, data: { isDefault: false } }, ctx: 'tenant',
    });
    expect(query).toHaveBeenCalledWith({ where: { AND: [{ isDefault: true }, { orgId: ORG }] }, data: { isDefault: false } });
  });
});

describe('tenant context — creates', () => {
  it('stamps orgId on create', async () => {
    const { query } = await runOp({
      model: 'CampaignAlert', operation: 'create', args: { data: { alertType: 'ACOS' } }, ctx: 'tenant',
    });
    expect(query).toHaveBeenCalledWith({ data: { alertType: 'ACOS', orgId: ORG } });
  });

  it('stamps orgId on every row of createMany', async () => {
    const { query } = await runOp({
      model: 'AlertFire', operation: 'createMany', args: { data: [{ x: 1 }, { x: 2 }] }, ctx: 'tenant',
    });
    expect(query).toHaveBeenCalledWith({ data: [{ x: 1, orgId: ORG }, { x: 2, orgId: ORG }] });
  });
});

describe('tenant context — findUnique post-filter', () => {
  it('returns null when the row belongs to another org', async () => {
    const { result, query } = await runOp({
      model: 'ReportJob', operation: 'findUnique', args: { where: { id: 'r1' } }, ctx: 'tenant',
      queryReturn: { id: 'r1', orgId: OTHER },
    });
    expect(query).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns the row when it belongs to the current org', async () => {
    const row = { id: 'r1', orgId: ORG };
    const { result } = await runOp({
      model: 'ReportJob', operation: 'findUnique', args: { where: { id: 'r1' } }, ctx: 'tenant', queryReturn: row,
    });
    expect(result).toBe(row);
  });

  it('throws for findUniqueOrThrow on a foreign row', async () => {
    await expect(runOp({
      model: 'ReportJob', operation: 'findUniqueOrThrow', args: { where: { id: 'r1' } }, ctx: 'tenant',
      queryReturn: { id: 'r1', orgId: OTHER },
    })).rejects.toThrow(/tenant scope/);
  });
});

describe('tenant context — update/delete ownership pre-check', () => {
  it('blocks update of a row owned by another org', async () => {
    await expect(runOp({
      model: 'CampaignRule', operation: 'update', args: { where: { id: 'c1' }, data: { enabled: false } },
      ctx: 'tenant', baseTarget: { orgId: OTHER },
    })).rejects.toThrow(/another organization/);
  });

  it('allows update of a row owned by the current org', async () => {
    const { query } = await runOp({
      model: 'CampaignRule', operation: 'update', args: { where: { id: 'c1' }, data: { enabled: false } },
      ctx: 'tenant', baseTarget: { orgId: ORG },
    });
    expect(query).toHaveBeenCalled();
  });

  it('blocks delete of a foreign row', async () => {
    await expect(runOp({
      model: 'SellerProfile', operation: 'delete', args: { where: { id: 's1' } },
      ctx: 'tenant', baseTarget: { orgId: OTHER },
    })).rejects.toThrow(/another organization/);
  });
});

describe('no context behaviour', () => {
  it('throws in strict mode on a tenant model', async () => {
    process.env.TENANT_GUARD_MODE = 'strict';
    await expect(runOp({
      model: 'ReportJob', operation: 'findMany', args: {}, ctx: 'none',
    })).rejects.toThrow(/no tenant context/);
  });

  it('passes through in warn mode', async () => {
    process.env.TENANT_GUARD_MODE = 'warn';
    const { query } = await runOp({
      model: 'ReportJob', operation: 'findMany', args: { where: { id: 'r1' } }, ctx: 'none',
    });
    expect(query).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });
});
