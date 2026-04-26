/**
 * Jest configuration for backend tests
 * Tests for Node.js/Express services and middleware
 */

// Set environment variables for tests
process.env.SESSION_SECRET  = process.env.SESSION_SECRET  || 'test-secret-key-for-testing-only';
process.env.ENCRYPTION_KEY  = process.env.ENCRYPTION_KEY  || 'test-encryption-key-32-chars-ok!';
process.env.NODE_ENV        = 'test';

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
  coverageThreshold: {
    global: {
      branches: 15,
      functions: 15,
      lines: 15,
      statements: 15,
    },
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
