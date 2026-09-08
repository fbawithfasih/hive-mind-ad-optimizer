/**
 * The pricing config, and the marketing site's copy of it.
 *
 * Three price tables existed for the same three plans — the site's catalog,
 * the site's pricing page, and this config — and they disagreed by $150 on
 * the top tier and by a factor of two on profile counts. A buyer who compared
 * two pages lost trust; one who upgraded got a surprise. This file makes the
 * config the source of truth and, when the marketing repo is checked out
 * beside this one, checks that the site still agrees.
 *
 * The cross-repo check is conditional on purpose. The site is a separate
 * repository that CI does not have, so the drift guard runs on a developer
 * machine — where both repos live side by side and where a price gets edited
 * — and is skipped, loudly, where it cannot run.
 */
import fs from 'node:fs';
import path from 'node:path';

import { PLAN_PRICING, PLAN_TIER_MAP } from '../pricing.js';
import { PLAN_LIMITS, FIELD_LABELS, MONTHLY_FIELDS, STANDING_FIELDS } from '../plan-limits.js';

const inr = (n, per) => `₹${n.toLocaleString('en-IN')}/${per}`;

describe('the pricing config is internally consistent', () => {
  it.each(Object.entries(PLAN_PRICING))('%s displays its own monthly and yearly price', (_tier, plan) => {
    // Indian digit grouping: ₹1,69,990, not ₹169,990. The display string is
    // what the customer sees, so it is pinned to the locale, not hand-typed.
    expect(plan.currency).toBe('INR');
    expect(plan.priceDisplay).toBe(inr(plan.priceMonthly, 'mo'));
    expect(plan.priceAnnualDisplay).toBe(inr(plan.priceAnnual, 'yr'));
  });

  it.each(Object.entries(PLAN_PRICING))('%s annual price is ten months', (_tier, plan) => {
    // "Two months free" is the promise on the page; it has to be exactly that.
    expect(plan.priceAnnual).toBe(plan.priceMonthly * 10);
  });

  it('prices every tier the site can name', () => {
    for (const tier of new Set(Object.values(PLAN_TIER_MAP))) {
      expect(PLAN_PRICING[tier]).toBeDefined();
    }
  });

  it('rises monotonically through the tiers', () => {
    const [b, p, e] = ['BASIC', 'PRO', 'ENTERPRISE'].map((t) => PLAN_PRICING[t].priceMonthly);
    expect(b).toBeLessThan(p);
    expect(p).toBeLessThan(e);
  });
});

describe('the limit table is complete', () => {
  const fields = Object.keys(PLAN_LIMITS.BASIC);

  it('gives every tier every field', () => {
    for (const tier of Object.keys(PLAN_LIMITS)) {
      expect(Object.keys(PLAN_LIMITS[tier]).sort()).toEqual([...fields].sort());
    }
  });

  it('labels every field, so a 402 can name what was hit', () => {
    for (const f of fields) expect(FIELD_LABELS[f]).toEqual(expect.any(String));
  });

  it('classifies every field as monthly or standing, never both or neither', () => {
    for (const f of fields) {
      expect(MONTHLY_FIELDS.has(f) !== STANDING_FIELDS.has(f)).toBe(true);
    }
  });

  it('never gives a lower tier more than a higher one', () => {
    const cap = (v) => (v === null ? Infinity : v);
    for (const f of fields) {
      expect(cap(PLAN_LIMITS.BASIC[f])).toBeLessThanOrEqual(cap(PLAN_LIMITS.PRO[f]));
      expect(cap(PLAN_LIMITS.PRO[f])).toBeLessThanOrEqual(cap(PLAN_LIMITS.ENTERPRISE[f]));
    }
  });
});

// ── The marketing site, when it is here to check ────────────────────────────

const SITE = path.resolve(process.cwd(), '../hivemindnestor/src');
const siteFile = (rel) => path.join(SITE, rel);
const sitePresent = fs.existsSync(siteFile('lib/catalog.ts'));

/** Pull `KEY: { amount: N, currency: 'C'` pairs out of catalog.ts. */
function catalogPrices(src) {
  const out = {};
  for (const m of src.matchAll(/^\s*(STARTER|GROWTH|SCALE):\s*\{\s*amount:\s*(\d+),\s*currency:\s*'(\w+)'/gm)) {
    out[m[1]] = { amount: Number(m[2]), currency: m[3] };
  }
  return out;
}

/** Pull `name: 'X', … price: N` pairs out of an Astro plan array. */
function astroPrices(src, arrayName) {
  const start = src.indexOf(`const ${arrayName} = [`);
  const end = src.indexOf('];', start);
  const block = src.slice(start, end);
  const out = {};
  for (const m of block.matchAll(/name:\s*'(Starter|Growth|Scale)'[\s\S]*?price:\s*(\d+)/g)) {
    out[m[1].toUpperCase()] = Number(m[2]);
  }
  return out;
}

const expected = {
  STARTER: PLAN_PRICING.BASIC.priceMonthly,
  GROWTH:  PLAN_PRICING.PRO.priceMonthly,
  SCALE:   PLAN_PRICING.ENTERPRISE.priceMonthly,
};

const describeSite = sitePresent ? describe : describe.skip;

describeSite('the marketing site agrees with this config', () => {
  it('catalog.ts charges the same rupee amount', () => {
    const prices = catalogPrices(fs.readFileSync(siteFile('lib/catalog.ts'), 'utf8'));
    for (const [key, amount] of Object.entries(expected)) {
      expect(prices[key]).toEqual({ amount, currency: 'INR' });
    }
  });

  it('pricing.astro shows the same amounts', () => {
    const prices = astroPrices(fs.readFileSync(siteFile('pages/pricing.astro'), 'utf8'), 'saasPlans');
    expect(prices).toEqual(expected);
  });

  it('amaiop.astro shows the same amounts', () => {
    const prices = astroPrices(fs.readFileSync(siteFile('pages/amaiop.astro'), 'utf8'), 'plans');
    expect(prices).toEqual(expected);
  });

  it.each(['pricing.astro', 'amaiop.astro'])('%s does not quote a profile count the app will not honour', (page) => {
    const src = fs.readFileSync(siteFile(`pages/${page}`), 'utf8');
    const quoted = [...src.matchAll(/(\d+)\s+Amazon Ads profiles?/g)].map((m) => Number(m[1]));
    const honoured = [PLAN_LIMITS.BASIC.profiles, PLAN_LIMITS.PRO.profiles, PLAN_LIMITS.ENTERPRISE.profiles];
    for (const n of quoted) expect(honoured).toContain(n);
  });
});

if (!sitePresent) {
  // eslint-disable-next-line no-console
  console.warn('pricing.test.js: marketing repo not found beside this one — site drift checks skipped');
}
