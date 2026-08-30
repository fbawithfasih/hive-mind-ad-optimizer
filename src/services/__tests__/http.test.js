/**
 * Outbound HTTP timeouts.
 *
 * Every Amazon, Anthropic and Gemini call was made without a timeout. Node's
 * global fetch and axios both default to none, so a hung socket parked an
 * Express handler indefinitely — in the same process that runs all seven
 * workers. These tests pin the behaviour that stops that.
 */
import { http, TIMEOUT_MS, fetchWithTimeout, isTimeout } from '../http.js';

describe('shared axios instance', () => {
  it('carries a default timeout', () => {
    expect(http.defaults.timeout).toBe(TIMEOUT_MS.api);
    expect(http.defaults.timeout).toBeGreaterThan(0);
  });

  it('budgets slow work above ordinary API calls', () => {
    // Downloads are gzipped report payloads; LLM generation legitimately runs
    // past a minute at max_tokens. Setting these to the API budget would
    // manufacture failures in working paths.
    expect(TIMEOUT_MS.download).toBeGreaterThan(TIMEOUT_MS.api);
    expect(TIMEOUT_MS.llm).toBeGreaterThan(TIMEOUT_MS.api);
    // Token refresh sits on the critical path of every request — fail fast.
    expect(TIMEOUT_MS.token).toBeLessThan(TIMEOUT_MS.api);
  });
});

describe('fetchWithTimeout', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('rejects with a named error when the deadline passes', async () => {
    // Stand in for a hung socket: never settles unless aborted.
    global.fetch = jest.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'TimeoutError'; reject(e);
      });
    }));

    await expect(fetchWithTimeout('https://example.com/hang', {}, 20))
      .rejects.toMatchObject({ name: 'HttpTimeoutError' });
  });

  it('names the host and the budget so logs are actionable', async () => {
    global.fetch = jest.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'TimeoutError'; reject(e);
      });
    }));

    await expect(fetchWithTimeout('https://api.anthropic.com/v1/messages', {}, 20))
      .rejects.toThrow(/api\.anthropic\.com.*20ms/);
  });

  it('passes a successful response straight through', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const res = await fetchWithTimeout('https://example.com', {}, 1000);
    expect(res.status).toBe(200);
  });

  it('does not disguise non-timeout failures', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('DNS'), { name: 'TypeError' }));
    await expect(fetchWithTimeout('https://example.com', {}, 1000))
      .rejects.toMatchObject({ name: 'TypeError' });
  });

  it('preserves caller-supplied init', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    await fetchWithTimeout('https://example.com', { method: 'POST', body: 'x' }, 1000);
    const [, init] = global.fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('x');
    expect(init.signal).toBeDefined();
  });
});

describe('isTimeout', () => {
  it('recognises both the fetch and axios shapes', () => {
    expect(isTimeout({ name: 'HttpTimeoutError' })).toBe(true);
    expect(isTimeout({ code: 'ECONNABORTED' })).toBe(true);   // axios
    expect(isTimeout({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTimeout({ name: 'TypeError' })).toBe(false);
    expect(isTimeout(undefined)).toBe(false);
  });
});

describe('no outbound call is left unbounded', () => {
  // A regression guard: a new bare axios.* or fetch( in a service reintroduces
  // exactly the failure this module exists to prevent, and nothing else catches
  // it — the call works fine until the day the far end hangs.
  it('services use the shared client', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const offenders = [];
    for (const f of readdirSync('src/services')) {
      if (!f.endsWith('.js') || f === 'http.js') continue;
      const src = readFileSync(`src/services/${f}`, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (/\bawait fetch\(/.test(line)) offenders.push(`${f}:${i + 1} bare fetch()`);
        // axios.* is allowed only when that call passes its own timeout
        if (/\baxios\.(get|post|put|patch|delete)\(/.test(line)) {
          const window = src.split('\n').slice(i, i + 12).join('\n').split(');')[0];
          if (!window.includes('timeout')) offenders.push(`${f}:${i + 1} axios without timeout`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
