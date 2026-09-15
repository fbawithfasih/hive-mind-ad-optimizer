import {
  sanitiseAttribution, campaignProperties, parseAttributionParam, rememberAttribution, takeAttribution, ATTRIBUTION_COOKIE,
} from '../attribution.js';

const resStub = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });

describe('carrying attribution through Google / Apple sign-in', () => {
  const sent = JSON.stringify({ utm_source: 'spn', utm_campaign: 'past_clients', landing: '/signup', evil: 'x' });

  it('parses and sanitises the JSON a start route receives, and rejects anything else', () => {
    expect(parseAttributionParam(sent)).toEqual({ utm_source: 'spn', utm_campaign: 'past_clients', landing: '/signup' });
    expect(parseAttributionParam('not json')).toBeNull();
    expect(parseAttributionParam('x'.repeat(5000))).toBeNull();
    expect(parseAttributionParam(undefined)).toBeNull();
    expect(parseAttributionParam(['a'])).toBeNull();
  });

  it('remembers a sanitised copy in a short-lived httpOnly cookie with the flow\'s SameSite', () => {
    const res = resStub();
    rememberAttribution({ query: { attribution: sent } }, res, { sameSite: 'none' });

    const [name, value, options] = res.cookie.mock.calls[0];
    expect(name).toBe(ATTRIBUTION_COOKIE);
    expect(JSON.parse(value)).toEqual({ utm_source: 'spn', utm_campaign: 'past_clients', landing: '/signup' });
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'none', maxAge: 10 * 60 * 1000 });
  });

  it('sets no cookie when nothing usable arrived', () => {
    const res = resStub();
    expect(rememberAttribution({ query: {} }, res, { sameSite: 'lax' })).toBeNull();
    expect(rememberAttribution({ query: { attribution: '{}' } }, res, { sameSite: 'lax' })).toBeNull();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('takes it back on the callback and always clears the cookie', () => {
    const res = resStub();
    const taken = takeAttribution({ cookies: { [ATTRIBUTION_COOKIE]: sent } }, res, { sameSite: 'lax' });

    expect(taken).toEqual({ utm_source: 'spn', utm_campaign: 'past_clients', landing: '/signup' });
    expect(res.clearCookie).toHaveBeenCalledWith(ATTRIBUTION_COOKIE, expect.objectContaining({ httpOnly: true, sameSite: 'lax' }));
  });

  it('clears a tampered cookie and returns nothing', () => {
    const res = resStub();
    expect(takeAttribution({ cookies: { [ATTRIBUTION_COOKIE]: '{broken' } }, res, { sameSite: 'lax' })).toBeNull();
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('touches no cookie on a callback that never had one', () => {
    const res = resStub();
    expect(takeAttribution({ cookies: {} }, res, { sameSite: 'lax' })).toBeNull();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});

it('keeps the campaign tags, referral code and plan', () => {
  const source = sanitiseAttribution({
    utm_source: 'spn', utm_medium: 'message', utm_campaign: 'past_clients',
    ref: 'coach-asha', plan: 'GROWTH',
  });

  expect(campaignProperties(source)).toEqual({
    utm_source: 'spn', utm_medium: 'message', utm_campaign: 'past_clients',
    ref: 'coach-asha', plan: 'GROWTH',
  });
});

it('never sends the landing URL or referrer, which can carry tokens in their query strings', () => {
  const source = sanitiseAttribution({
    utm_source: 'spn',
    landing:  'https://optimizer.hivemindnestor.com/signup?claim=secret-claim-token',
    referrer: 'https://example.com/callback?code=oauth-code',
  });

  expect(campaignProperties(source)).toEqual({ utm_source: 'spn' });
});

it('is empty when a signup carried no attribution', () => {
  expect(campaignProperties(null)).toEqual({});
  expect(campaignProperties(sanitiseAttribution(undefined))).toEqual({});
});
