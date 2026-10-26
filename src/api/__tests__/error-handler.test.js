/**
 * The global error handler reports server faults to PostHog and nothing else.
 *
 * A request for a path Express cannot decode (GET /%c0) throws a URIError with
 * status 400. Reporting that opened a new error tracking issue for each probe,
 * which buries the real 5xx failures.
 */
jest.mock('../../services/posthog.js', () => ({
  capturePostHogException: jest.fn().mockResolvedValue(),
}));

import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../test/http-server.js';
import { capturePostHogException } from '../../services/posthog.js';

import { errorHandler } from '../error-handler.js';

const serve = sharedServer();

function app(err) {
  const a = express();
  a.get('/boom', () => { throw err; });
  a.use(errorHandler);
  return a;
}

const withStatus = (message, status) => Object.assign(new Error(message), { status });

beforeEach(() => { jest.clearAllMocks(); });

it('does not report a malformed path to PostHog, and still answers 400', async () => {
  // The production SPA catch-all. Express decodes its param, and the decode fails.
  const a = express();
  a.get('/*path', (_req, res) => res.end());
  a.use(errorHandler);

  const res = await request(serve(a)).get('/%c0');

  expect(res.status).toBe(400);
  expect(capturePostHogException).not.toHaveBeenCalled();
});

it('does not report a 4xx error to PostHog', async () => {
  const res = await request(serve(app(withStatus('Bad input', 400)))).get('/boom');

  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Bad input' } });
  expect(capturePostHogException).not.toHaveBeenCalled();
});

it('reports an error with no status to PostHog as a 500', async () => {
  const err = new Error('Database went away');

  const res = await request(serve(app(err))).get('/boom');

  expect(res.status).toBe(500);
  expect(capturePostHogException).toHaveBeenCalledWith(err, undefined, {
    status: 500,
    request_path: '/boom',
    request_method: 'GET',
  });
});

it('reports a 5xx error to PostHog', async () => {
  const res = await request(serve(app(withStatus('Upstream failed', 502)))).get('/boom');

  expect(res.status).toBe(502);
  expect(capturePostHogException).toHaveBeenCalledTimes(1);
});

it('still answers when the PostHog capture fails', async () => {
  capturePostHogException.mockRejectedValueOnce(new Error('PostHog down'));

  const res = await request(serve(app(new Error('boom')))).get('/boom');

  expect(res.status).toBe(500);
});
