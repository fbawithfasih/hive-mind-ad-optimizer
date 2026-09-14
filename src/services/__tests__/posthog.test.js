/**
 * Which environment variables turn PostHog on. Production carries POSTHOG_KEY
 * and no host, so that pair must be enough on its own.
 */
jest.mock('posthog-node', () => ({
  PostHog: jest.fn().mockImplementation(() => ({ shutdown: jest.fn().mockResolvedValue() })),
}));

import { PostHog } from 'posthog-node';
import { initPostHog, shutdownPostHog } from '../posthog.js';

const ENV = { ...process.env };

beforeEach(async () => {
  await shutdownPostHog();
  jest.clearAllMocks();
  process.env = { ...ENV };
  delete process.env.POSTHOG_PROJECT_TOKEN;
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
});

afterAll(() => { process.env = ENV; });

it('starts from POSTHOG_KEY alone, on the US host', () => {
  process.env.POSTHOG_KEY = 'phc_legacy';
  expect(initPostHog()).not.toBeNull();
  expect(PostHog).toHaveBeenCalledWith('phc_legacy', expect.objectContaining({ host: 'https://us.i.posthog.com' }));
});

it('prefers POSTHOG_PROJECT_TOKEN and an explicit host', () => {
  process.env.POSTHOG_KEY = 'phc_legacy';
  process.env.POSTHOG_PROJECT_TOKEN = 'phc_new';
  process.env.POSTHOG_HOST = 'https://eu.i.posthog.com';
  initPostHog();
  expect(PostHog).toHaveBeenCalledWith('phc_new', expect.objectContaining({ host: 'https://eu.i.posthog.com' }));
});

it('stays off in production without a token, instead of failing boot', () => {
  process.env.NODE_ENV = 'production';
  expect(initPostHog()).toBeNull();
  expect(PostHog).not.toHaveBeenCalled();
});

it('refuses to start outside production without a token', () => {
  process.env.NODE_ENV = 'development';
  expect(() => initPostHog()).toThrow(/POSTHOG_PROJECT_TOKEN/);
});
