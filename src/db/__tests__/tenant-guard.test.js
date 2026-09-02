/**
 * Tenant guard unit tests.
 *
 * Exercises the Prisma extension callback directly (no real database) to prove
 * that a forgotten orgId filter cannot read or write another organization's data.
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
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


describe('findUnique with a narrowed select', () => {
  /**
   * The post-filter compares row.orgId, so orgId has to survive the caller's
   * projection. It did not: a `select` that omitted orgId left the field
   * undefined, which compares unequal to every real orgId, so the guard nulled
   * rows the tenant owned.
   *
   * In production that was requireActiveSubscription, which selects exactly
   * { status, subscriptionId, currentPeriodEnd }. The paywall therefore saw no
   * subscription for ANY org and refused every gated feature — including to
   * fully paid customers.
   *
   * The harness above returns a fixed row whatever it is asked for, which is
   * precisely why it could not see this. These tests use a query mock that
   * honours `select` the way Prisma does.
   */
  const FULL = { id: 'r1', orgId: ORG, status: 'ACTIVE', subscriptionId: null };

  /** A query mock that projects like Prisma: only selected fields come back. */
  function projectingQuery(row = FULL) {
    return jest.fn(async (args) => {
      if (!row) return null;
      if (args?.select) {
        const out = {};
        for (const [k, want] of Object.entries(args.select)) if (want) out[k] = row[k];
        return out;
      }
      if (args?.omit) {
        const out = { ...row };
        for (const [k, drop] of Object.entries(args.omit)) if (drop) delete out[k];
        return out;
      }
      return { ...row };
    });
  }

  async function run({ operation = 'findUnique', args, row = FULL }) {
    const { client } = makeBase(null);
    const ext = tenantGuardExtension(client);
    const op = ext.query.$allModels.$allOperations;
    const query = projectingQuery(row);
    const result = await runWithTenant(ORG, () =>
      op({ model: 'Subscription', operation, args, query }));
    return { result, query };
  }

  it('returns the row even though the caller never asked for orgId', async () => {
    // The exact shape requireActiveSubscription uses.
    const { result } = await run({
      args: { where: { orgId: ORG }, select: { status: true, subscriptionId: true } },
    });

    expect(result).not.toBeNull();
    expect(result.status).toBe('ACTIVE');
  });

  it('asks the database for orgId so the check has something to compare', async () => {
    const { query } = await run({
      args: { where: { orgId: ORG }, select: { status: true } },
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ select: { status: true, orgId: true } })
    );
  });

  it('strips the injected orgId, so the caller gets the shape it asked for', async () => {
    // Handing back a field nobody selected would leak the guard's mechanics
    // into every caller's result object.
    const { result } = await run({
      args: { where: { orgId: ORG }, select: { status: true } },
    });

    expect(result).toEqual({ status: 'ACTIVE' });
    expect('orgId' in result).toBe(false);
  });

  it('still refuses another org\'s row when the select omits orgId', async () => {
    // The isolation guarantee must survive the fix — this is the whole point of
    // the post-filter.
    const { result } = await run({
      args: { where: { id: 'r1' }, select: { status: true } },
      row: { id: 'r1', orgId: OTHER, status: 'ACTIVE' },
    });

    expect(result).toBeNull();
  });

  it('still throws for findUniqueOrThrow on a foreign row with a narrowed select', async () => {
    await expect(run({
      operation: 'findUniqueOrThrow',
      args: { where: { id: 'r1' }, select: { status: true } },
      row: { id: 'r1', orgId: OTHER, status: 'ACTIVE' },
    })).rejects.toThrow(/tenant scope/);
  });

  it('leaves a select that already asks for orgId untouched', async () => {
    const { result, query } = await run({
      args: { where: { orgId: ORG }, select: { status: true, orgId: true } },
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ select: { status: true, orgId: true } })
    );
    // Explicitly requested, so it must survive into the result.
    expect(result).toEqual({ status: 'ACTIVE', orgId: ORG });
  });

  it('leaves a call with no select alone', async () => {
    const { result, query } = await run({ args: { where: { orgId: ORG } } });

    expect(query).toHaveBeenCalledWith({ where: { orgId: ORG } });
    expect(result.orgId).toBe(ORG);
  });

  it('handles omit: { orgId: true } the same way', async () => {
    const { result } = await run({
      args: { where: { orgId: ORG }, omit: { orgId: true } },
    });

    expect(result).not.toBeNull();
    expect(result.status).toBe('ACTIVE');
    expect('orgId' in result).toBe(false);
  });

  it('returns null for a genuinely missing row', async () => {
    const { result } = await run({
      args: { where: { orgId: ORG }, select: { status: true } },
      row: null,
    });

    expect(result).toBeNull();
  });
});


describe('every org-scoped model is actually guarded', () => {
  /**
   * Read the schema rather than trusting a hand-kept list.
   *
   * TENANT_MODELS is the entire isolation boundary: a model carrying orgId that
   * is missing from it is not merely unscoped, it is invisible to the guard —
   * no filter, no warning, in either mode. Adding three tables and forgetting
   * to register them is a one-line omission with no symptom until someone reads
   * another tenant's rows, which is exactly what happened while writing the
   * agent models.
   *
   * This derives the expected set from prisma/schema.prisma, so the next model
   * with an orgId column fails here instead of shipping unguarded.
   */
  // Jest runs these through babel as CJS, so import.meta is unavailable.
  // Repo-root-relative, matching deploy-image-contents.test.js.
  const schema = readFileSync('prisma/schema.prisma', 'utf8');

  /** Models declaring a direct `orgId` scalar field. */
  function modelsWithOrgId(src) {
    const found = [];
    const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
    let m;
    while ((m = re.exec(src)) !== null) {
      const [, name, body] = m;
      if (/^\s*orgId\s+String/m.test(body)) found.push(name);
    }
    return found;
  }

  it('finds the models in the schema at all', () => {
    // Guard against the regex silently matching nothing, which would make every
    // assertion below vacuously pass.
    const models = modelsWithOrgId(schema);

    expect(models.length).toBeGreaterThan(10);
    expect(models).toContain('Subscription');
  });

  it('registers every model that carries an orgId', () => {
    const missing = modelsWithOrgId(schema).filter(name => !TENANT_MODELS.has(name));

    expect(missing).toEqual([]);
  });

  it('does not register a model the schema no longer has', () => {
    const declared = new Set(modelsWithOrgId(schema));
    const stale = [...TENANT_MODELS].filter(name => !declared.has(name));

    expect(stale).toEqual([]);
  });

  it('includes the agent models', () => {
    for (const model of ['AgentRun', 'AgentDecision', 'ProfileObjective']) {
      expect(TENANT_MODELS.has(model)).toBe(true);
    }
  });
});
