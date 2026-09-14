/**
 * One sign-in, one event — whichever way the seller signed in.
 */
jest.mock('../posthog.js', () => ({ captureEvent: jest.fn(), identifyUser: jest.fn() }));

import { captureEvent, identifyUser } from '../posthog.js';
import { recordSessionStart } from '../auth-events.js';

const USER = { id: 'u-1', email: 'seller@example.com', firstName: 'Asha', lastName: 'Rao' };

beforeEach(() => {
  jest.clearAllMocks();
  captureEvent.mockResolvedValue();
  identifyUser.mockResolvedValue();
});

it('identifies the user before sending the event', async () => {
  await recordSessionStart(USER, { method: 'google' });

  expect(identifyUser).toHaveBeenCalledWith({
    distinctId: 'u-1',
    properties: { email: 'seller@example.com', first_name: 'Asha', last_name: 'Rao' },
  });
  expect(identifyUser.mock.invocationCallOrder[0]).toBeLessThan(captureEvent.mock.invocationCallOrder[0]);
});

it('reports a returning SSO user as a login, grouped by their org', async () => {
  await recordSessionStart(USER, { method: 'apple', orgId: 'org-1' });

  expect(captureEvent).toHaveBeenCalledWith({
    distinctId: 'u-1',
    event: 'user_logged_in',
    properties: { auth_method: 'apple' },
    groups: { organization: 'org-1' },
  });
});

it('reports an account made by this request as a signup, with no org yet', async () => {
  await recordSessionStart(USER, { method: 'google', created: true });

  expect(captureEvent).toHaveBeenCalledWith({
    distinctId: 'u-1',
    event: 'user_signed_up',
    properties: { auth_method: 'google' },
    groups: undefined,
  });
});

it('carries extra properties, but never lets them overwrite the auth method', async () => {
  await recordSessionStart(USER, {
    method: 'password', created: true, props: { claimed_organization: true, auth_method: 'forged' },
  });

  expect(captureEvent.mock.calls[0][0].properties).toEqual({ claimed_organization: true, auth_method: 'password' });
});
