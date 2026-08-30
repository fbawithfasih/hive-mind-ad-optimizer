/**
 * Liveness vs readiness.
 *
 * /health returned {status:'ok'} unconditionally while railway.toml pointed its
 * healthcheck at it, so a deployment whose database was unreachable was declared
 * healthy and took over from a working one.
 *
 * The distinction these tests protect:
 *   liveness  must NOT depend on Postgres/Redis — otherwise a database blip
 *             restarts every instance, which is worse than serving errors.
 *   readiness must depend on both — that is the entire point.
 */
jest.mock('../../db/prisma.js', () => ({
  prisma: { $queryRaw: jest.fn() },
}));
jest.mock('../../services/queue.js', () => ({
  reportingQueue: { client: Promise.resolve({ ping: jest.fn() }) },
}));

import { prisma }        from '../../db/prisma.js';
import { reportingQueue } from '../../services/queue.js';
import { checkReadiness, livenessHandler, readinessHandler } from '../readiness.js';

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn(c => { res.statusCode = c; return res; });
  res.json   = jest.fn(b => { res.body = b; return res; });
  return res;
};

let redisClient;
beforeEach(async () => {
  jest.clearAllMocks();
  prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  redisClient = await reportingQueue.client;
  redisClient.ping.mockResolvedValue('PONG');
});

describe('liveness', () => {
  it('answers ok without touching any dependency', () => {
    const res = mockRes();
    livenessHandler({}, res);

    expect(res.body.status).toBe('ok');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redisClient.ping).not.toHaveBeenCalled();
  });

  it('stays ok even when both dependencies are down', () => {
    // The load-bearing assertion. Restart-on-failure plus a dependency check
    // here would turn a Postgres blip into a restart loop across every instance.
    prisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));
    redisClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = mockRes();
    livenessHandler({}, res);
    expect(res.body.status).toBe('ok');
  });

  it('reports the build so a log line can be tied to a deploy', () => {
    process.env.BUILD_VERSION = '42';
    const res = mockRes();
    livenessHandler({}, res);
    expect(res.body.version).toBe('42');
    expect(typeof res.body.uptime).toBe('number');
    delete process.env.BUILD_VERSION;
  });
});

describe('readiness', () => {
  it('is ready when Postgres and Redis both answer', async () => {
    const res = mockRes();
    await readinessHandler({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.postgres.ok).toBe(true);
    expect(res.body.checks.redis.ok).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(redisClient.ping).toHaveBeenCalled();
  });

  it('503s when Postgres is unreachable, and says so', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED 5432'));

    const res = mockRes();
    await readinessHandler({}, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.checks.postgres.ok).toBe(false);
    expect(res.body.checks.postgres.error).toMatch(/ECONNREFUSED/);
    // Redis is reported independently so the failing dependency is obvious.
    expect(res.body.checks.redis.ok).toBe(true);
  });

  it('503s when Redis is unreachable', async () => {
    redisClient.ping.mockRejectedValue(new Error('ECONNREFUSED 6379'));

    const res = mockRes();
    await readinessHandler({}, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.checks.redis.ok).toBe(false);
    expect(res.body.checks.postgres.ok).toBe(true);
  });

  it('does not hang when a dependency never answers', async () => {
    // A probe that never settles must not make the endpoint itself hang —
    // otherwise the healthcheck times out with no detail about why.
    prisma.$queryRaw.mockReturnValue(new Promise(() => {}));

    const started = Date.now();
    const result  = await checkReadiness();

    expect(result.ok).toBe(false);
    expect(result.checks.postgres.error).toMatch(/exceeded/);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 15_000);

  it('probes both dependencies even when the first fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('down'));
    await checkReadiness();
    expect(redisClient.ping).toHaveBeenCalled();
  });
});

describe('railway healthcheck target', () => {
  it('points at /ready, not /health', async () => {
    const { readFileSync } = await import('node:fs');
    const toml = readFileSync('railway.toml', 'utf8');
    expect(toml).toMatch(/healthcheckPath\s*=\s*"\/ready"/);
  });
});
