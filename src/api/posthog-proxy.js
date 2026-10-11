/**
 * Same-origin forwarding for the browser's PostHog traffic.
 *
 * Ad blockers match requests to *.posthog.com, so a seller with one installed
 * sent no pageviews, autocapture or recordings at all. The browser SDK now
 * talks to /ingest on this host (VITE_POSTHOG_HOST in the Dockerfile), and
 * this streams each request on to PostHog unchanged.
 *
 * Mounted above express.json() on purpose: the SDK sends gzip bodies, and a
 * parsed body cannot be piped on.
 *
 * The browser sends this host's cookies with every same-origin request,
 * including the session cookie. Those are dropped here, so PostHog never
 * receives them.
 */
import http from 'node:http';
import https from 'node:https';
import { createLogger } from './utils/logger.js';

const logger = createLogger('POSTHOG_PROXY');

const API_ORIGIN    = 'https://us.i.posthog.com';
const ASSETS_ORIGIN = 'https://us-assets.i.posthog.com';

/** The SDK loads its lazy bundles (recorder, surveys, remote config) from these. */
const ASSET_PATH = /^\/(static|array)\//;

const DROP_REQUEST_HEADERS = new Set([
  'cookie', 'authorization', 'host', 'connection', 'keep-alive',
  'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip',
]);
const DROP_RESPONSE_HEADERS = new Set(['set-cookie', 'connection', 'keep-alive', 'transfer-encoding']);

function pick(headers, drop) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!drop.has(name)) out[name] = value;
  }
  return out;
}

/**
 * @param {{ apiOrigin?: string, assetsOrigin?: string }} [origins] overridable for tests
 * @returns {import('express').RequestHandler}
 */
export function createPostHogProxy({ apiOrigin = API_ORIGIN, assetsOrigin = ASSETS_ORIGIN } = {}) {
  return (req, res) => {
    const origin = ASSET_PATH.test(req.url) ? assetsOrigin : apiOrigin;
    // Concatenated, not resolved: new URL('//elsewhere/x', origin) would leave
    // PostHog's host for whatever the path names.
    const target = new URL(origin + req.url);

    const headers = pick(req.headers, DROP_REQUEST_HEADERS);
    headers.host = target.host;
    // Without this PostHog geolocates every seller to this server.
    if (req.ip) headers['x-forwarded-for'] = req.ip;

    const client = target.protocol === 'https:' ? https : http;
    const upstream = client.request(target, { method: req.method, headers, timeout: 30_000 }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, pick(upstreamRes.headers, DROP_RESPONSE_HEADERS));
      upstreamRes.pipe(res);
    });

    upstream.on('timeout', () => upstream.destroy(new Error('upstream timed out')));
    upstream.on('error', (err) => {
      logger.warn(`PostHog forward failed: ${req.method} ${target.pathname}: ${err.message}`);
      if (res.headersSent) res.destroy();
      else res.status(502).end();
    });
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });

    req.pipe(upstream);
  };
}

export const posthogProxy = createPostHogProxy();
