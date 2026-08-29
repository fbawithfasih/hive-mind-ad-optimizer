/**
 * The per-account limiters skip themselves when NODE_ENV === 'test' (same as
 * every other limiter in the file), so these tests run them under a
 * non-test NODE_ENV to exercise the real behaviour.
 */
import express from 'express';
import request from 'supertest';
import { loginAccountLimiter, passwordResetAccountLimiter } from '../rateLimiter.js';

const ORIGINAL_ENV = process.env.NODE_ENV;
beforeAll(() => { process.env.NODE_ENV = 'development'; });
afterAll(()  => { process.env.NODE_ENV = ORIGINAL_ENV; });

/** App whose handler status is controlled per-request via `x-outcome`. */
function makeApp(limiter) {
  const app = express();
  app.use(express.json());
  app.post('/login', limiter, (req, res) => {
    if (req.get('x-outcome') === 'success') return res.json({ ok: true });
    res.status(401).json({ error: 'Invalid email or password' });
  });
  return app;
}

const fail = (app, email) =>
  request(app).post('/login').send({ email });

describe('loginAccountLimiter', () => {
  it('blocks after 10 failed attempts on the same account', async () => {
    const app = makeApp(loginAccountLimiter);
    const email = 'target-a@corp.com';

    for (let i = 0; i < 10; i++) {
      expect((await fail(app, email)).status).toBe(401);
    }

    const blocked = await fail(app, email);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/failed login attempts for this account/i);
  });

  it('tracks accounts independently — one account cannot lock out another', async () => {
    const app = makeApp(loginAccountLimiter);

    for (let i = 0; i < 11; i++) await fail(app, 'target-b@corp.com');
    expect((await fail(app, 'target-b@corp.com')).status).toBe(429);

    // Different account, same source IP: unaffected.
    expect((await fail(app, 'bystander-b@corp.com')).status).toBe(401);
  });

  it('keys on the normalised address, so casing cannot multiply the budget', async () => {
    const app = makeApp(loginAccountLimiter);

    for (let i = 0; i < 10; i++) await fail(app, 'target-c@corp.com');

    const blocked = await request(app).post('/login').send({ email: 'TARGET-C@Corp.com' });
    expect(blocked.status).toBe(429);
  });

  it('does not count successful logins against the account', async () => {
    const app = makeApp(loginAccountLimiter);
    const email = 'target-d@corp.com';

    for (let i = 0; i < 20; i++) {
      const res = await request(app).post('/login').set('x-outcome', 'success').send({ email });
      expect(res.status).toBe(200);
    }
  });

  it('skips requests with no email rather than pooling them under one key', async () => {
    const app = makeApp(loginAccountLimiter);

    for (let i = 0; i < 15; i++) {
      expect((await request(app).post('/login').send({})).status).toBe(401);
    }
  });
});

describe('passwordResetAccountLimiter', () => {
  it('counts every request, including the 200s /forgot-password always returns', async () => {
    const app = express();
    app.use(express.json());
    // Mirrors the real route: always 200, to avoid email enumeration.
    app.post('/forgot-password', passwordResetAccountLimiter, (req, res) => res.json({ ok: true }));

    const email = 'flood-target@corp.com';
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/forgot-password').send({ email })).status).toBe(200);
    }

    const blocked = await request(app).post('/forgot-password').send({ email });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/password reset requests for this account/i);
  });
});
