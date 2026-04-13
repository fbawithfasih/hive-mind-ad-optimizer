/**
 * Jest configuration for backend tests
 * Tests for Node.js/Express services and middleware
 */

// Set environment variables for tests
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-key-for-testing-only';
process.env.NODE_ENV = 'test';

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
      branches: 30,
      functions: 30,
      lines: 30,
      statements: 30,
    },
  },
  transform: {
    '^.+\\.js$': ['babel-jest', { presets: ['@babel/preset-env'] }],
  },
};
