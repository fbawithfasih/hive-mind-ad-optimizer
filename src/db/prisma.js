import { PrismaClient } from '@prisma/client';
import { tenantGuardExtension } from './tenant-guard.js';

const globalForPrisma = globalThis;

// Base (unextended) client — used internally by the tenant guard for ownership
// pre-checks so those lookups don't recurse back through the guard.
const base =
  globalForPrisma.prismaBase ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  });

// Exported client has tenant isolation enforced at the data layer. Every import
// site gets the guarded client, so a forgotten orgId filter can't leak data.
export const prisma =
  globalForPrisma.prisma || base.$extends(tenantGuardExtension(base));

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaBase = base;
  globalForPrisma.prisma = prisma;
}

export default prisma;
