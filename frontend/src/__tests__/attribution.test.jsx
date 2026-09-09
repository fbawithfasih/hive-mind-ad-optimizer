import { describe, it, expect, beforeEach } from 'vitest';
import { captureAttribution, readAttribution, ATTRIBUTION_KEY } from '../attribution.js';

beforeEach(() => { localStorage.clear(); });

describe('captureAttribution', () => {
  it('keeps the utm parameters, the ref code, the plan, the landing path and the referrer host', () => {
    captureAttribution({
      search: '?utm_source=youtube&utm_campaign=sept&ref=coach42&plan=GROWTH&junk=1',
      path: '/pricing', referrer: 'https://www.youtube.com/watch?v=abc',
    });
    expect(readAttribution()).toEqual({
      utm_source: 'youtube', utm_campaign: 'sept', ref: 'coach42', plan: 'GROWTH',
      referrer: 'www.youtube.com', landing: '/pricing',
    });
  });

  it('is first-touch: a later visit does not overwrite what brought them', () => {
    captureAttribution({ search: '?ref=coach42', path: '/', referrer: '' });
    captureAttribution({ search: '?utm_source=google', path: '/pricing', referrer: '' });
    expect(readAttribution()).toEqual({ ref: 'coach42', landing: '/' });
  });

  it('stores nothing for a bare visit with no signal', () => {
    captureAttribution({ search: '', path: '/', referrer: '' });
    expect(localStorage.getItem(ATTRIBUTION_KEY)).toBeNull();
    expect(readAttribution()).toBeNull();
  });

  it('caps each value so a crafted URL cannot fill storage', () => {
    captureAttribution({ search: `?utm_term=${'x'.repeat(2000)}`, path: '/', referrer: '' });
    expect(readAttribution().utm_term).toHaveLength(200);
  });

  it('reads null, not a throw, when storage holds garbage', () => {
    localStorage.setItem(ATTRIBUTION_KEY, '{not json');
    expect(readAttribution()).toBeNull();
  });
});
