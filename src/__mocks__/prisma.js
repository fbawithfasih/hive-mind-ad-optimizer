// Shared Prisma mock — importable via jest.mock('../../db/prisma.js', ...)
// Each test file gets its own fresh mock so tests are isolated.

export const prismaMock = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  orgMember: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  amazonCredential: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  bulkListingBatch: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  listingOptimization: {
    create: jest.fn(),
  },
  subscription: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  invoice: {
    upsert: jest.fn(),
  },
  usageMetric: {
    upsert: jest.fn(),
  },
  sellerProfile: {
    count: jest.fn(),
  },
  reportJob: {
    count: jest.fn(),
  },
  $disconnect: jest.fn(),
};
