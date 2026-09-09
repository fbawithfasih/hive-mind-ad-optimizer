import { sanitiseAttribution, ATTRIBUTION_KEYS } from '../attribution.js';

describe('sanitiseAttribution', () => {
  it('keeps the known keys and drops the rest', () => {
    const out = sanitiseAttribution({
      utm_source: 'youtube', ref: 'coach42', plan: 'GROWTH',
      password: 'never', nested: { a: 1 }, utm_medium: 42,
    });
    expect(out).toEqual({ utm_source: 'youtube', ref: 'coach42', plan: 'GROWTH' });
  });

  it('trims and caps each value', () => {
    const out = sanitiseAttribution({ utm_campaign: '  ' + 'x'.repeat(500) + '  ' });
    expect(out.utm_campaign).toHaveLength(200);
  });

  it('returns null when nothing usable was sent', () => {
    for (const v of [undefined, null, 'utm_source=x', 7, [], {}, { utm_source: '' }, { junk: 'y' }]) {
      expect(sanitiseAttribution(v)).toBeNull();
    }
  });

  it('whitelists exactly the keys the funnel is read by', () => {
    // A key added here is a key the analytics queries will look for; keep the
    // two in step by making the list explicit.
    expect(ATTRIBUTION_KEYS).toEqual([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'ref', 'plan', 'landing', 'referrer',
    ]);
  });
});
