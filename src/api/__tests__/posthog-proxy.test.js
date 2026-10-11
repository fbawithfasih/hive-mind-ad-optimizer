/**
 * The /ingest forward to PostHog.
 *
 * Two local servers stand in for PostHog's ingest and asset hosts and record
 * what reached them, so these tests see exactly what PostHog would.
 */
import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import request from 'supertest';
import { sharedServer } from '../../test/http-server.js';

import { createPostHogProxy } from '../posthog-proxy.js';

const serve = sharedServer();

function fakeHost(name) {
  const host = { name, seen: [] };
  host.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      host.seen.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.setHeader('set-cookie', 'upstream=1');
      res.setHeader('x-upstream', name);
      res.end(JSON.stringify({ status: 1 }));
    });
  });
  return host;
}

const api    = fakeHost('api');
const assets = fakeHost('assets');

const listen = (s) => new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
const close  = (s) => new Promise((resolve) => s.close(resolve));
const origin = (s) => `http://127.0.0.1:${s.address().port}`;

beforeAll(async () => {
  await Promise.all([listen(api.server), listen(assets.server)]);
});
afterAll(async () => {
  await Promise.all([close(api.server), close(assets.server)]);
});
beforeEach(() => {
  api.seen.length = 0;
  assets.seen.length = 0;
});

function app(origins = { apiOrigin: origin(api.server), assetsOrigin: origin(assets.server) }) {
  const a = express();
  a.set('trust proxy', 1);
  a.use('/ingest', createPostHogProxy(origins));
  return serve(a);
}

it('sends event captures to the ingest host with the path and query intact', async () => {
  const res = await request(app()).post('/ingest/e/?ip=0&ver=1.438.2').send({ event: '$pageview' });

  expect(res.status).toBe(200);
  expect(res.headers['x-upstream']).toBe('api');
  expect(api.seen).toHaveLength(1);
  expect(api.seen[0].url).toBe('/e/?ip=0&ver=1.438.2');
  expect(JSON.parse(api.seen[0].body)).toEqual({ event: '$pageview' });
});

it('sends the SDK bundles to the asset host', async () => {
  await request(app()).get('/ingest/static/recorder.js');
  await request(app()).get('/ingest/array/phc_abc/config.js');

  expect(api.seen).toHaveLength(0);
  expect(assets.seen.map((r) => r.url)).toEqual(['/static/recorder.js', '/array/phc_abc/config.js']);
});

it('passes a gzip body through byte for byte', async () => {
  const gz = zlib.gzipSync(JSON.stringify({ batch: [{ event: '$autocapture' }] }));

  await request(app())
    .post('/ingest/batch/?compression=gzip-js')
    .set('content-type', 'text/plain')
    .send(gz);

  expect(Buffer.compare(api.seen[0].body, gz)).toBe(0);
});

it('never hands PostHog the session cookie, and never sets a cookie on this host', async () => {
  const res = await request(app())
    .post('/ingest/e/')
    .set('cookie', 'session=secret')
    .set('authorization', 'Bearer secret')
    .send({});

  expect(api.seen[0].headers.cookie).toBeUndefined();
  expect(api.seen[0].headers.authorization).toBeUndefined();
  expect(res.headers['set-cookie']).toBeUndefined();
});

it('names the upstream host and the seller IP, not this server', async () => {
  await request(app()).post('/ingest/e/').set('x-forwarded-for', '203.0.113.7').send({});

  const { headers } = api.seen[0];
  expect(headers.host).toBe(new URL(origin(api.server)).host);
  expect(headers['x-forwarded-for']).toBe('203.0.113.7');
});

it('drops the edge-added cf-connecting-ip, which PostHog\'s Cloudflare rejects with a 403', async () => {
  await request(app()).get('/ingest/static/array.js').set('cf-connecting-ip', '203.0.113.7');

  expect(assets.seen[0].headers['cf-connecting-ip']).toBeUndefined();
});

it('keeps a protocol-relative path on the PostHog host', async () => {
  const res = await request(app()).get('/ingest//evil.example/x');

  expect(res.status).toBe(200);
  expect(api.seen[0].url).toBe('//evil.example/x');
});

it('answers 502 when PostHog cannot be reached', async () => {
  const res = await request(app({ apiOrigin: 'http://127.0.0.1:1', assetsOrigin: 'http://127.0.0.1:1' }))
    .post('/ingest/e/')
    .send({});

  expect(res.status).toBe(502);
});
