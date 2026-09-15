import { sanitiseAttribution, campaignProperties } from '../attribution.js';

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
