import { describe, it, expect } from 'vitest';
import { scrubUrl, scrubEvent } from '../analytics.js';

// The reason this hook exists: the pages a new seller is recorded on are the
// ones whose URL carries a single-use token.
describe('scrubUrl', () => {
  it('drops the token a verification or reset link carries', () => {
    expect(scrubUrl('https://optimizer.hivemindnestor.com/verify-email?token=abc123'))
      .toBe('https://optimizer.hivemindnestor.com/verify-email');
    expect(scrubUrl('https://optimizer.hivemindnestor.com/reset-password?token=t#x'))
      .toBe('https://optimizer.hivemindnestor.com/reset-password');
  });

  it('leaves a URL with nothing to drop alone', () => {
    expect(scrubUrl('https://optimizer.hivemindnestor.com/dashboard'))
      .toBe('https://optimizer.hivemindnestor.com/dashboard');
  });

  it('passes through anything that is not a URL', () => {
    expect(scrubUrl('')).toBe('');
    expect(scrubUrl('$direct')).toBe('$direct');
    expect(scrubUrl(undefined)).toBe(undefined);
    expect(scrubUrl(42)).toBe(42);
  });
});

describe('scrubEvent', () => {
  it('scrubs every url and referrer property, including the ones set on the person', () => {
    const event = scrubEvent({
      event: '$pageview',
      properties: {
        $current_url: 'https://app.test/signup?token=secret',
        $referrer:    'https://google.com/search?q=amazon+ads',
      },
      $set_once: { $initial_current_url: 'https://app.test/claim?claim=secret' },
    });

    expect(event.properties.$current_url).toBe('https://app.test/signup');
    expect(event.properties.$referrer).toBe('https://google.com/search');
    expect(event.$set_once.$initial_current_url).toBe('https://app.test/claim');
  });

  it('keeps the campaign properties, which is where attribution is read from', () => {
    const event = scrubEvent({
      event: '$pageview',
      properties: {
        $current_url: 'https://app.test/signup?utm_source=spn&utm_campaign=past_clients',
        utm_source:   'spn',
        utm_campaign: 'past_clients',
      },
    });

    expect(event.properties.$current_url).toBe('https://app.test/signup');
    expect(event.properties.utm_source).toBe('spn');
    expect(event.properties.utm_campaign).toBe('past_clients');
  });

  it('survives an event with no properties, and a dropped event', () => {
    expect(scrubEvent({ event: 'x' })).toEqual({ event: 'x' });
    expect(scrubEvent(null)).toBe(null);
  });
});
