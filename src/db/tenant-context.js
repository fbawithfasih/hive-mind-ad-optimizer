/**
 * Tenant context — request-scoped organization isolation.
 *
 * Carries the "current tenant" (org) through the async call stack using
 * AsyncLocalStorage, so the Prisma tenant guard (see tenant-guard.js) can
 * auto-scope every query to the right organization WITHOUT each call site
 * having to remember an `orgId` filter.
 *
 * Three modes:
 *   - tenant: a real org context. Queries on tenant-scoped models are forced
 *             to that org. Established per request by withTenant middleware.
 *   - system: trusted code that legitimately spans organizations (BullMQ
 *             workers, schedulers, webhook handlers). The guard does NOT inject
 *             an org filter — these callers pass explicit orgId themselves.
 *   - (none): no context active. The guard treats this as a programming error
 *             on tenant-scoped models (throws in strict mode, warns otherwise).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Run `fn` with an active tenant (organization) context.
 * @param {string} orgId
 * @param {Function} fn
 * @returns {*} whatever `fn` returns
 */
export function runWithTenant(orgId, fn) {
  if (!orgId) {
    throw new Error('runWithTenant requires an orgId');
  }
  return storage.run({ mode: 'tenant', orgId }, fn);
}

/**
 * Run `fn` as trusted system code that may span organizations.
 * The tenant guard will not inject an org filter inside this scope.
 * @param {Function} fn
 * @returns {*} whatever `fn` returns
 */
export function runAsSystem(fn) {
  return storage.run({ mode: 'system' }, fn);
}

/**
 * Get the current tenant context, or undefined if none is active.
 * @returns {{ mode: 'tenant', orgId: string } | { mode: 'system' } | undefined}
 */
export function getTenantContext() {
  return storage.getStore();
}

export default { runWithTenant, runAsSystem, getTenantContext };
