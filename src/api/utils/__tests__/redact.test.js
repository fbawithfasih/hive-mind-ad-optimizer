/**
 * Credential redaction for connection-string logging.
 *
 * Production logged `redis://default:<password>@redis.railway.internal:6379`
 * on every connect. BullMQ opens one connection per queue and per worker, so
 * the password landed in Railway's retained logs ~15 times per boot.
 */

import { redactConnectionUrl } from '../redact.js';

describe('redactConnectionUrl', () => {
  it('strips the password from the exact shape production was leaking', () => {
    const out = redactConnectionUrl(
      'redis://default:slPNOpeKBJwaVgDCLxxZKwzbzUrNKuoC@redis.railway.internal:6379'
    );

    expect(out).toBe('redis://redis.railway.internal:6379');
    expect(out).not.toContain('slPNOpeKBJwaVgDCLxxZKwzbzUrNKuoC');
    expect(out).not.toContain('default');
    expect(out).not.toContain('@');
  });

  it('keeps host and port so the log stays useful for debugging', () => {
    expect(redactConnectionUrl('redis://localhost:6379')).toBe('redis://localhost:6379');
  });

  it.each([
    ['user and password', 'redis://user:pass@h:6379'],
    ['password only',     'redis://:pass@h:6379'],
    ['user only',         'redis://user@h:6379'],
    ['rediss (TLS)',      'rediss://default:secret@h:6380'],
    ['query string',      'redis://default:secret@h:6379?family=6'],
  ])('removes credentials — %s', (_label, url) => {
    const out = redactConnectionUrl(url);

    expect(out).not.toMatch(/pass|secret|user|default/);
    expect(out).not.toContain('@');
  });

  it('omits the port when the URL has none', () => {
    expect(redactConnectionUrl('redis://default:secret@h')).toBe('redis://h');
  });

  it.each([
    ['empty',      ''],
    ['garbage',    'not a url'],
    ['undefined',  undefined],
    ['null',       null],
  ])('fails closed on unparseable input — %s', (_label, url) => {
    const out = redactConnectionUrl(url);

    expect(out).toBe('<redacted: unparseable url>');
  });

  it('never returns the input unchanged when it carries credentials', () => {
    const url = 'redis://default:hunter2@example.com:6379';

    expect(redactConnectionUrl(url)).not.toBe(url);
  });
});
