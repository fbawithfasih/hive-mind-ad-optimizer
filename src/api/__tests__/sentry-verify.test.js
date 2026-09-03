/**
 * The Sentry verification endpoint.
 *
 * Its whole job is to be inert by default and to throw when deliberately
 * enabled, so both halves are worth pinning: an endpoint that quietly stopped
 * throwing would report "verified" while proving nothing, which is the exact
 * failure mode it exists to rule out.
 */
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../test/http-server.js';

import { sentryVerifyHandler } from '../sentry-verify.js';

const TOKEN = 'test-verify-token-abc123';

/** One server for this file — see src/test/http-server.js. */
const serve = sharedServer();

/** Mounts the handler with a catch-all 404 and an error middleware behind it. */
function app() {
  const a = express();
  a.get('/api/_sentry-verify', sentryVerifyHandler);
  a.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // Stands in for Sentry's handler plus the app's own — records what it saw.
  a.use((err, _req, res, _next) => {
    a.locals.captured = err;
    res.status(err.status || 500).json({ error: err.message });
  });
  return a;
}

beforeEach(() => { delete process.env.SENTRY_VERIFY_TOKEN; });
afterEach(() => { delete process.env.SENTRY_VERIFY_TOKEN; });

describe('when no token is configured', () => {
  it('is indistinguishable from an unknown path', async () => {
    const res = await request(serve(app())).get('/api/_sentry-verify');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('does not throw even when a token is supplied', async () => {
    // Otherwise a caller could confirm the endpoint exists by the difference
    // between its response and a real 404.
    const res = await request(serve(app()))
      .get('/api/_sentry-verify')
      .set('x-verify-token', 'anything');

    expect(res.status).toBe(404);
  });
});

describe('when a token is configured', () => {
  beforeEach(() => { process.env.SENTRY_VERIFY_TOKEN = TOKEN; });

  it('throws for a caller presenting the right token', async () => {
    const a = app();

    const res = await request(serve(a)).get('/api/_sentry-verify').set('x-verify-token', TOKEN);

    expect(res.status).toBe(500);
    expect(a.locals.captured).toBeInstanceOf(Error);
    expect(a.locals.captured.message).toMatch(/SENTRY VERIFY \(backend/);
  });

  it('accepts the token as a query parameter too', async () => {
    const res = await request(serve(app())).get(`/api/_sentry-verify?token=${TOKEN}`);
    expect(res.status).toBe(500);
  });

  it('sets no status on the error, so Sentry treats it as a 5xx', async () => {
    // Sentry's default shouldHandleError only captures status >= 500 or none.
    // An error carrying a 4xx would be silently skipped and the check would
    // pass while proving nothing.
    const a = app();
    await request(serve(a)).get('/api/_sentry-verify').set('x-verify-token', TOKEN);

    expect(a.locals.captured.status).toBeUndefined();
  });

  it.each([
    ['a wrong token',   'nope'],
    ['an empty token',  ''],
    ['a prefix of it',  TOKEN.slice(0, 10)],
    ['a longer string', `${TOKEN}x`],
  ])('404s for %s', async (_label, token) => {
    const res = await request(serve(app())).get('/api/_sentry-verify').set('x-verify-token', token);
    expect(res.status).toBe(404);
  });

  it('404s when no token is presented at all', async () => {
    expect((await request(serve(app())).get('/api/_sentry-verify')).status).toBe(404);
  });

  it('names itself in the error, so nobody mistakes it for a real fault', async () => {
    const a = app();
    await request(serve(a)).get('/api/_sentry-verify').set('x-verify-token', TOKEN);

    expect(a.locals.captured.message).toMatch(/deliberate test error/i);
    expect(a.locals.captured.message).toMatch(/_sentry-verify/);
  });

  it('varies the id per call, so repeat checks are distinguishable', async () => {
    const a1 = app(); const a2 = app();
    await request(a1).get('/api/_sentry-verify').set('x-verify-token', TOKEN);
    await request(a2).get('/api/_sentry-verify').set('x-verify-token', TOKEN);

    expect(a1.locals.captured.message).not.toBe(a2.locals.captured.message);
  });
});
