/**
 * Events are recorded, forwarded, and never in the way.
 *
 * The property that matters most is the last one: track() is called from
 * the signup, checkout and OAuth paths, fire-and-forget, and a failure in
 * the database or at PostHog must not become a failure in any of them.
 */
jest.mock('../../db/prisma.js', () => ({ prisma: { auditLog: { create: jest.fn() } } }));
jest.mock('../posthog.js', () => ({ captureEvent: jest.fn() }));

import { prisma } from '../../db/prisma.js';
import { captureEvent } from '../posthog.js';
import { track, EVENTS } from '../events.js';

beforeEach(() => {
  jest.clearAllMocks();
  prisma.auditLog.create.mockResolvedValue({});
  captureEvent.mockResolvedValue();
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

it('forwards to PostHog with user identity and organization grouping', async () => {
  await track('subscribed', { orgId: 'org-1', userId: 'u-1', props: { tier: 'PRO' } });

  expect(captureEvent).toHaveBeenCalledWith({
    distinctId: 'u-1',
    event: 'subscribed',
    properties: { tier: 'PRO', org_id: 'org-1' },
    groups: { organization: 'org-1' },
  });
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
    captureEvent.mockRejectedValue(new Error('PostHog request timed out'));
    await expect(track('org_created', { orgId: 'org-1' })).resolves.toBeUndefined();
  });

  it('still records locally when PostHog rejects the payload', async () => {
    captureEvent.mockRejectedValue(new Error('PostHog rejected the payload'));
    await track('org_created', { orgId: 'org-1' });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

it('names exactly the funnel steps', () => {
  expect(EVENTS).toEqual(['org_created', 'amazon_connected', 'agent_enrolled', 'checkout_started', 'subscribed', 'cancelled']);
});
