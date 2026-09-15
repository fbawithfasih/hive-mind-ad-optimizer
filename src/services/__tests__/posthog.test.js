/**
 * Which environment variables turn PostHog on. Production carries POSTHOG_KEY
 * and no host, so that pair must be enough on its own.
 */
jest.mock('posthog-node', () => ({
  PostHog: jest.fn().mockImplementation(() => ({
    shutdown:         jest.fn().mockResolvedValue(),
    flush:            jest.fn(() => new Promise(() => {})), // a PostHog that never answers
    capture:          jest.fn(),
    identify:         jest.fn(),
    captureException: jest.fn(),
  })),
}));

import { PostHog } from 'posthog-node';
import {
  initPostHog, shutdownPostHog, captureEvent, identifyUser, capturePostHogException, FLUSH_AT, FLUSH_INTERVAL_MS,
} from '../posthog.js';

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

describe('delivery never holds up the caller', () => {
  let client;
  beforeEach(() => {
    process.env.POSTHOG_KEY = 'phc_legacy';
    client = initPostHog();
  });

  it('batches instead of flushing per event', () => {
    expect(PostHog).toHaveBeenCalledWith('phc_legacy', expect.objectContaining({
      flushAt: FLUSH_AT, flushInterval: FLUSH_INTERVAL_MS,
    }));
    expect(FLUSH_AT).toBeGreaterThan(1);
    expect(FLUSH_INTERVAL_MS).toBeGreaterThan(0);
  });

  it('resolves capture, identify and exception capture even when PostHog never answers', async () => {
    await expect(captureEvent({ distinctId: 'u-1', event: 'user_logged_in' })).resolves.toBeUndefined();
    await expect(identifyUser({ distinctId: 'u-1', properties: {} })).resolves.toBeUndefined();
    await expect(capturePostHogException(new Error('boom'), 'u-1')).resolves.toBeUndefined();

    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(client.identify).toHaveBeenCalledTimes(1);
    expect(client.captureException).toHaveBeenCalledTimes(1);
    expect(client.flush).not.toHaveBeenCalled();
  });

  it('swallows an SDK that throws synchronously', async () => {
    client.capture.mockImplementation(() => { throw new Error('bad payload'); });
    client.captureException.mockImplementation(() => { throw new Error('bad payload'); });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(captureEvent({ distinctId: 'u-1', event: 'x' })).resolves.toBeUndefined();
    await expect(capturePostHogException(new Error('boom'))).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('delivers what is queued when the process shuts down', async () => {
    await shutdownPostHog();
    expect(client.shutdown).toHaveBeenCalledTimes(1);
  });
});

it('refuses to start outside production without a token', () => {
  process.env.NODE_ENV = 'development';
  expect(() => initPostHog()).toThrow(/POSTHOG_PROJECT_TOKEN/);
});
