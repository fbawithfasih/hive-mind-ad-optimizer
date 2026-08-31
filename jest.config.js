/**
 * Jest configuration for backend tests
 * Tests for Node.js/Express services and middleware
 */

// Set environment variables for tests
process.env.SESSION_SECRET  = process.env.SESSION_SECRET  || 'test-secret-key-for-testing-only';
process.env.ENCRYPTION_KEY  = process.env.ENCRYPTION_KEY  || 'test-encryption-key-32-chars-ok!';
process.env.NODE_ENV        = 'test';

// The module-level Ads client in services/amazon-ads.js is built at import time
// from these. Tests mock axios so the values never reach Amazon, but the token
// manager now refuses to call out with blank credentials, so they have to exist.
// Without them the suite passes locally (a developer .env supplies them) and
// fails in CI, which is exactly how this was missed.
process.env.AMAZON_ADS_CLIENT_ID     = process.env.AMAZON_ADS_CLIENT_ID     || 'test-ads-client-id';
process.env.AMAZON_ADS_CLIENT_SECRET = process.env.AMAZON_ADS_CLIENT_SECRET || 'test-ads-client-secret';
process.env.AMAZON_ADS_REFRESH_TOKEN = process.env.AMAZON_ADS_REFRESH_TOKEN || 'test-ads-refresh-token';

export default {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/server.js',
    '!src/data/**',
  ],
  testMatch: [
    '**/src/**/__tests__/**/*.test.js',
    '**/src/**/*.test.js',
  ],
  // The global floor stays low deliberately — most of src/ is Amazon API glue
  // that is covered by integration testing, and raising it wholesale would just
  // invite filler tests. What matters is that the money and credential paths
  // cannot silently regress, so those carry their own per-file floors.
  //
  // Per-file thresholds are set just under current measured coverage: they are
  // a ratchet against regression, not a target. Raise them as coverage improves.
  coverageThreshold: {
    global: {
      branches: 15,
      functions: 15,
      lines: 15,
      statements: 15,
    },
    // ── Credentials & tenant isolation ──────────────────────────────────────
    'src/db/encryption.js':      { statements: 95, branches: 90, functions: 100 },
    'src/db/password.js':        { statements: 95, branches: 90, functions: 100 },
    'src/db/tenant-guard.js':    { statements: 85, branches: 80, functions: 85 },
    'src/db/tenant-context.js':  { statements: 80, branches: 50, functions: 100 },
    'src/services/credentials.js': { statements: 75, branches: 75, functions: 60 },
    // ── Auth gates ──────────────────────────────────────────────────────────
    'src/api/middleware/requireAuth.js':   { statements: 85, branches: 80, functions: 100 },
    'src/api/middleware/requireRole.js':   { statements: 100, branches: 100, functions: 100 },
    'src/api/middleware/withTenant.js':    { statements: 100, branches: 100, functions: 100 },
    'src/api/middleware/requireActiveSubscription.js': { statements: 100, branches: 100, functions: 100 },
    // ── Money ───────────────────────────────────────────────────────────────
    'src/services/razorpay.js':  { statements: 60, branches: 60, functions: 55 },
    'src/workers/billing-reconcile.worker.js': { statements: 100, branches: 100, functions: 100 },
    // ── Writes to live advertiser accounts ──────────────────────────────────
    // This worker changes real campaign budgets on a schedule, unattended.
    'src/workers/automation.worker.js': { statements: 100, branches: 85, functions: 80 },
    // ── Customer-visible batch progress ─────────────────────────────────────
    'src/workers/bulk-listing.worker.js': { statements: 100, branches: 75, functions: 100 },
  },
  transform: {
    '^.+\\.(js|ts)$': ['babel-jest', {
      presets: ['@babel/preset-env', '@babel/preset-typescript'],
    }],
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.claude/worktrees/',
  ],
};
