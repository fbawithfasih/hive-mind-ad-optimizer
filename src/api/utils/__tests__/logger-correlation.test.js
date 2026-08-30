/**
 * Correlation IDs must be per-request.
 *
 * The previous implementation was a module-level Map with one fixed key — a
 * single global slot. Every concurrent request overwrote it, so any log line
 * emitted after an `await` carried whichever request had most recently entered
 * the middleware.
 *
 * That is worse than having no ID at all: tracing a bug leads you confidently
 * into a different request's work. The concurrency test below is the one that
 * distinguishes the two implementations; everything else passes either way.
 */
import {
  correlationIdMiddleware, getCorrelationId, runWithCorrelationId, generateCorrelationId,
} from '../logger.js';

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** Drive the middleware the way Express does. */
function handle(headers, handler) {
  return new Promise((resolve, reject) => {
    const req = { headers };
    const res = { setHeader: jest.fn() };
    correlationIdMiddleware(req, res, () => {
      Promise.resolve(handler(res)).then(resolve, reject);
    });
  });
}

describe('per-request isolation', () => {
  it('keeps ids separate across concurrent requests that interleave awaits', async () => {
    // Request A starts, yields, B starts and yields, then both resume. Under the
    // old global slot both would report B's id after the first await.
    const seen = {};

    const a = handle({ 'x-correlation-id': 'req-A' }, async () => {
      seen.aStart = getCorrelationId();
      await tick(20);
      seen.aAfterAwait = getCorrelationId();
      await tick(20);
      seen.aEnd = getCorrelationId();
    });

    const b = handle({ 'x-correlation-id': 'req-B' }, async () => {
      await tick(5);
      seen.bAfterAwait = getCorrelationId();
      await tick(5);
      seen.bEnd = getCorrelationId();
    });

    await Promise.all([a, b]);

    expect(seen.aStart).toBe('req-A');
    expect(seen.aAfterAwait).toBe('req-A');
    expect(seen.aEnd).toBe('req-A');
    expect(seen.bAfterAwait).toBe('req-B');
    expect(seen.bEnd).toBe('req-B');
  });

  it('survives many interleaved requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        handle({ 'x-correlation-id': `req-${i}` }, async () => {
          await tick(Math.random() * 15);
          return getCorrelationId();
        })
      )
    );
    expect(results).toEqual(Array.from({ length: 25 }, (_, i) => `req-${i}`));
  });

  it('does not leak an id outside the request that owns it', async () => {
    await handle({ 'x-correlation-id': 'req-X' }, async () => getCorrelationId());
    expect(getCorrelationId()).toBe('NO-ID');
  });
});

describe('middleware behaviour', () => {
  it('honours an inbound x-correlation-id', async () => {
    const id = await handle({ 'x-correlation-id': 'from-caller' }, () => getCorrelationId());
    expect(id).toBe('from-caller');
  });

  it('generates one when the caller sends none', async () => {
    const id = await handle({}, () => getCorrelationId());
    expect(id).not.toBe('NO-ID');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes the id back on the response', async () => {
    let captured;
    await handle({ 'x-correlation-id': 'echo-me' }, (res) => { captured = res; });
    expect(captured.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'echo-me');
  });
});

describe('runWithCorrelationId — background work', () => {
  it('binds an id to a job and everything it awaits', async () => {
    const seen = await runWithCorrelationId('job:reporting:42', async () => {
      await tick(5);
      return getCorrelationId();
    });
    expect(seen).toBe('job:reporting:42');
  });

  it('keeps concurrent jobs apart', async () => {
    const [x, y] = await Promise.all([
      runWithCorrelationId('job:a:1', async () => { await tick(10); return getCorrelationId(); }),
      runWithCorrelationId('job:b:2', async () => { await tick(2);  return getCorrelationId(); }),
    ]);
    expect(x).toBe('job:a:1');
    expect(y).toBe('job:b:2');
  });

  it('reports NO-ID outside any correlated scope', () => {
    expect(getCorrelationId()).toBe('NO-ID');
  });
});

describe('generateCorrelationId', () => {
  it('produces distinct uuids', () => {
    expect(generateCorrelationId()).not.toBe(generateCorrelationId());
  });
});
