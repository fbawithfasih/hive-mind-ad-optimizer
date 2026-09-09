/**
 * Events are recorded, forwarded, and never in the way.
 *
 * The property that matters most is the last one: track() is called from
 * the signup, checkout and OAuth paths, fire-and-forget, and a failure in
 * the database or at PostHog must not become a failure in any of them.
 */
jest.mock('../../db/prisma.js', () => ({ prisma: { auditLog: { create: jest.fn() } } }));
jest.mock('../http.js', () => ({ fetchWithTimeout: jest.fn() }));

import { prisma } from '../../db/prisma.js';
import { fetchWithTimeout } from '../http.js';
import { track, EVENTS } from '../events.js';

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
  prisma.auditLog.create.mockResolvedValue({});
  fetchWithTimeout.mockResolvedValue({ ok: true, status: 200 });
});

it('records an event as a SYSTEM audit row, org-scoped, with its properties', async () => {
  await track('amazon_connected', { orgId: 'org-1', userId: 'u-1', props: { profiles: 3 } });

  expect(prisma.auditLog.create).toHaveBeenCalledWith({
    data: {
      orgId: 'org-1', userId: 'u-1', actor: 'SYSTEM',
      action: 'event.amazon_connected', resource: 'event', changes: { profiles: 3 },
    },
  });
});

it('does not touch PostHog when no key is configured', async () => {
  await track('subscribed', { orgId: 'org-1' });
  expect(fetchWithTimeout).not.toHaveBeenCalled();
});

it('forwards to PostHog, keyed by org, when a key is configured', async () => {
  process.env.POSTHOG_KEY = 'phc_test';
  process.env.POSTHOG_HOST = 'https://eu.i.posthog.com/';

  await track('subscribed', { orgId: 'org-1', userId: 'u-1', props: { tier: 'PRO' } });

  const [url, init, timeout] = fetchWithTimeout.mock.calls[0];
  expect(url).toBe('https://eu.i.posthog.com/capture/');
  expect(timeout).toBe(3000);
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ api_key: 'phc_test', event: 'subscribed', distinct_id: 'org-1' });
  expect(body.properties).toMatchObject({ tier: 'PRO', orgId: 'org-1', userId: 'u-1' });
});

it('refuses an event name it does not know, so a typo cannot create a phantom funnel step', async () => {
  await track('subscrbed', { orgId: 'org-1' });
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
});

it('refuses an event with no org, since the audit table is org-scoped', async () => {
  await track('subscribed', {});
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
});

describe('never in the way', () => {
  it('resolves when the database write fails', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('db gone'));
    await expect(track('org_created', { orgId: 'org-1' })).resolves.toBeUndefined();
  });

  it('resolves when PostHog is down or slow', async () => {
    process.env.POSTHOG_KEY = 'phc_test';
    fetchWithTimeout.mockRejectedValue(new Error('Request to us.i.posthog.com timed out after 3000ms'));
    await expect(track('org_created', { orgId: 'org-1' })).resolves.toBeUndefined();
  });

  it('still records locally when PostHog rejects the payload', async () => {
    process.env.POSTHOG_KEY = 'phc_test';
    fetchWithTimeout.mockResolvedValue({ ok: false, status: 401 });
    await track('org_created', { orgId: 'org-1' });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

it('names exactly the funnel steps', () => {
  expect(EVENTS).toEqual(['org_created', 'amazon_connected', 'agent_enrolled', 'checkout_started', 'subscribed', 'cancelled']);
});
