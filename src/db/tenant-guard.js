/**
 * Prisma tenant guard — default-secure organization isolation at the data layer.
 *
 * A Prisma client extension that intercepts every operation on a tenant-scoped
 * model and forces it into the current organization's scope (see tenant-context.js):
 *
 *   - reads / bulk ops  → inject `{ orgId }` into the where clause
 *   - create / createMany → stamp `orgId` onto the data
 *   - findUnique(OrThrow) → post-filter the result by orgId (a unique where
 *                           can't carry a non-unique orgId field)
 *   - update / delete / upsert → pre-check the target row's orgId and block
 *                                writes that target another org's record
 *
 * This means a route that forgets its `orgId` filter still CANNOT read or write
 * another tenant's data. The legacy getTenantScope()/extendTenantFilter() helpers
 * remain valid as defense-in-depth (re-asserting the same orgId is a no-op).
 *
 * Behaviour when no tenant context is active on a tenant-scoped model is governed
 * by TENANT_GUARD_MODE: "strict" throws, "warn" logs and lets it through.
 * Default: strict in tests, warn elsewhere (flip prod to strict after a clean deploy).
 */

import { getTenantContext } from './tenant-context.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('TENANT_GUARD');

/** Models that carry a direct `orgId` column and must be org-scoped. */
export const TENANT_MODELS = new Set([
  'AgentDecision',
  'AgentRun',
  'AlertFire',
  'AmazonCredential',
  'AuditLog',
  'BrandAnalyticsReport',
  'BulkListingBatch',
  'CampaignAlert',
  'CampaignRule',
  'ListingOptimization',
  'OrgInvitation',
  'OrgMember',
  'ProfileObjective',
  'ReportJob',
  'RuleExecution',
  'SellerProfile',
  'Subscription',
  'UsageMetric',
]);

const READ_OR_BULK = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy',
  'updateMany', 'updateManyAndReturn', 'deleteMany',
]);
const CREATE_OPS = new Set(['create']);
const CREATE_MANY_OPS = new Set(['createMany', 'createManyAndReturn']);
const UNIQUE_READ = new Set(['findUnique', 'findUniqueOrThrow']);
const UNIQUE_WRITE = new Set(['update', 'delete']);

/** Resolve the configured behaviour for a tenant-scoped op with no context. */
function guardMode() {
  const mode = process.env.TENANT_GUARD_MODE;
  if (mode === 'strict' || mode === 'warn') return mode;
  return process.env.NODE_ENV === 'test' ? 'strict' : 'warn';
}

/** PascalCase model name → Prisma delegate key (lowercase first letter). */
function delegateKey(model) {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

// ─── Instrumentation for the warn → strict migration ────────────────────────
//
// In warn mode an unscoped query passes through, so the isolation guarantee is
// advisory. Flipping to strict blind risks converting a silent gap into a
// visible outage, so this records what actually happens: if the counter stays
// at zero under real traffic, strict is safe.
//
// Per-process and reset by every deploy — deliberately so. It answers "has this
// build, on this instance, seen an unscoped query", which is the question that
// matters before flipping.

/** Bounded so a hot unscoped path cannot grow this without limit. */
const MAX_TRACKED_SITES = 50;
const unscopedSites = new Map(); // "Model.operation" → { count, firstSeen, lastSeen, from }

/** The first few application frames — enough to find the caller, not a novel. */
function callSite() {
  const raw = new Error().stack?.split('\n').slice(1) ?? [];
  return raw
    .filter(l => l.includes('/src/') && !l.includes('/src/db/tenant-guard.js'))
    .slice(0, 3)
    .map(l => l.trim().replace(/^at\s+/, ''));
}

function recordUnscoped(model, operation) {
  const key = `${model}.${operation}`;
  const now = new Date().toISOString();
  let entry = unscopedSites.get(key);
  if (!entry) {
    if (unscopedSites.size >= MAX_TRACKED_SITES) return null;
    entry = { count: 0, firstSeen: now, lastSeen: now, from: callSite() };
    unscopedSites.set(key, entry);
  }
  entry.count += 1;
  entry.lastSeen = now;
  return entry;
}

/**
 * Snapshot of unscoped tenant-model access since this process started.
 * `total: 0` means every query ran inside runWithTenant or runAsSystem, and
 * TENANT_GUARD_MODE=strict can be set without changing behaviour.
 */
export function tenantGuardStats() {
  let total = 0;
  for (const e of unscopedSites.values()) total += e.count;
  return {
    mode:     guardMode(),
    total,
    distinct: unscopedSites.size,
    truncated: unscopedSites.size >= MAX_TRACKED_SITES,
    sites: Object.fromEntries([...unscopedSites.entries()].map(([k, v]) => [k, v])),
  };
}

/** Test seam. */
export function resetTenantGuardStats() {
  unscopedSites.clear();
}

/** Handle the "tenant-scoped query ran with no org context" case. */
function handleNoContext(model, operation) {
  const msg = `${model}.${operation} ran with no tenant context`;
  if (guardMode() === 'strict') {
    throw new Error(`[tenant-guard] ${msg} (wrap in runWithTenant or runAsSystem)`);
  }

  const entry = recordUnscoped(model, operation);
  // Log the first occurrence of each call site in full, then taper. A hot
  // unscoped path would otherwise bury every other line in the log.
  const n = entry?.count ?? 0;
  if (n === 1 || n % 100 === 0) {
    logger.warn(
      `${msg} — passing through (occurrence ${n}; set TENANT_GUARD_MODE=strict to enforce)`,
      { from: entry?.from },
    );
  }
}

/**
 * Build the Prisma client extension. `baseClient` is the UNEXTENDED client,
 * used for ownership pre-checks so we don't recurse through the guard.
 */
export function tenantGuardExtension(baseClient) {
  return {
    name: 'tenant-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);

          const ctx = getTenantContext();
          if (ctx?.mode === 'system') return query(args);

          if (!ctx || ctx.mode !== 'tenant') {
            handleNoContext(model, operation); // throws in strict mode
            return query(args);
          }

          const { orgId } = ctx;
          args = args ?? {};

          if (READ_OR_BULK.has(operation)) {
            args.where = { AND: [args.where ?? {}, { orgId }] };
            return query(args);
          }

          if (CREATE_OPS.has(operation)) {
            args.data = { ...args.data, orgId };
            return query(args);
          }

          if (CREATE_MANY_OPS.has(operation)) {
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            args.data = rows.map((row) => ({ ...row, orgId }));
            return query(args);
          }

          if (UNIQUE_READ.has(operation)) {
            // The post-filter below reads row.orgId, so orgId has to actually
            // come back. A caller's `select` that leaves it out — or an `omit`
            // that removes it — made it `undefined`, which compares unequal to
            // every real orgId, so the guard silently nulled rows the tenant
            // legitimately owned.
            //
            // That is not a hypothetical: requireActiveSubscription selects
            // exactly { status, subscriptionId, currentPeriodEnd }, so the
            // paywall saw no subscription for ANY org and refused every gated
            // feature to paying customers.
            //
            // Fetch it when it is missing and strip it again afterwards, so the
            // caller still gets precisely the shape it asked for.
            const selectsOrgId = args?.select ? Boolean(args.select.orgId) : true;
            const omitsOrgId   = Boolean(args?.omit?.orgId);
            const injected     = !selectsOrgId || omitsOrgId;

            let effective = args;
            if (injected) {
              effective = { ...args };
              // `select` and `omit` are mutually exclusive in Prisma, so at
              // most one of these applies.
              if (args?.select) effective.select = { ...args.select, orgId: true };
              if (args?.omit)   effective.omit   = { ...args.omit, orgId: false };
            }

            const row = await query(effective);
            if (row && row.orgId !== orgId) {
              if (operation === 'findUniqueOrThrow') {
                throw new Error('[tenant-guard] No record found in tenant scope');
              }
              return null;
            }
            if (row && injected) delete row.orgId;
            return row;
          }

          if (UNIQUE_WRITE.has(operation) || operation === 'upsert') {
            const target = await baseClient[delegateKey(model)]
              .findUnique({ where: args.where, select: { orgId: true } })
              .catch(() => null);

            if (target && target.orgId !== orgId) {
              throw new Error(
                `[tenant-guard] ${model}.${operation} blocked: record belongs to another organization`
              );
            }
            if (operation === 'upsert') {
              args.create = { ...args.create, orgId };
            }
            return query(args);
          }

          // Unknown / unhandled operation on a tenant model: we can't prove it's
          // scoped, so fail closed in strict mode and warn otherwise.
          const msg = `${model}.${operation} is not handled by the tenant guard`;
          if (guardMode() === 'strict') throw new Error(`[tenant-guard] ${msg}`);
          logger.warn(`${msg} — passing through`);
          return query(args);
        },
      },
    },
  };
}

export default tenantGuardExtension;
