/**
 * Plan id ↔ tier, across both billing intervals.
 *
 * tierFromPlanId is what the webhook uses to decide what a paying customer
 * gets, and it falls back to BASIC for an id it does not recognise. That
 * fallback is the right direction for garbage — but it means a yearly plan
 * id the lookup did not know would provision a Scale subscriber as Starter,
 * silently, on the day they paid the most. So the yearly map is part of the
 * lookup, and this file pins it.
 *
 * The maps read process.env at import, so each case loads the module fresh
 * inside jest.isolateModules with the environment it wants.
 */
jest.mock('../../db/prisma.js', () => ({ prisma: {} }));

const ENV_KEYS = [
  'RAZORPAY_PLAN_BASIC', 'RAZORPAY_PLAN_PRO', 'RAZORPAY_PLAN_ENTERPRISE',
  'RAZORPAY_PLAN_BASIC_YEARLY', 'RAZORPAY_PLAN_PRO_YEARLY', 'RAZORPAY_PLAN_ENTERPRISE_YEARLY',
];

/** Load razorpay.js with exactly these plan env vars set. */
function loadWith(env) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  let mod;
  jest.isolateModules(() => { mod = require('../razorpay.js'); });
  return mod;
}

afterAll(() => { for (const k of ENV_KEYS) delete process.env[k]; });

describe('tierFromPlanId', () => {
  it('resolves a monthly id to its tier', () => {
    const { tierFromPlanId } = loadWith({ RAZORPAY_PLAN_PRO: 'plan_m_pro' });
    expect(tierFromPlanId('plan_m_pro')).toBe('PRO');
  });

  it('resolves a yearly id to the same tier, so a yearly buyer is not demoted', () => {
    const { tierFromPlanId } = loadWith({
      RAZORPAY_PLAN_ENTERPRISE: 'plan_m_ent', RAZORPAY_PLAN_ENTERPRISE_YEARLY: 'plan_y_ent',
    });
    expect(tierFromPlanId('plan_y_ent')).toBe('ENTERPRISE');
  });

  it('falls back to BASIC for an id it does not know', () => {
    const { tierFromPlanId } = loadWith({ RAZORPAY_PLAN_PRO: 'plan_m_pro' });
    expect(tierFromPlanId('plan_from_another_account')).toBe('BASIC');
  });

  it('never matches an unset tier against an undefined id', () => {
    // With no env at all every entry is undefined; an undefined planId must
    // not "match" the first of them and come back as BASIC-by-accident.
    const { tierFromPlanId } = loadWith({});
    expect(tierFromPlanId(undefined)).toBe('BASIC');
    expect(tierFromPlanId(null)).toBe('BASIC');
  });
});

describe('planIdFor', () => {
  it('returns the id for the interval asked for, and null when unset', () => {
    const { planIdFor } = loadWith({ RAZORPAY_PLAN_PRO: 'plan_m_pro', RAZORPAY_PLAN_PRO_YEARLY: 'plan_y_pro' });
    expect(planIdFor('PRO')).toBe('plan_m_pro');
    expect(planIdFor('PRO', 'monthly')).toBe('plan_m_pro');
    expect(planIdFor('PRO', 'yearly')).toBe('plan_y_pro');
    expect(planIdFor('BASIC', 'yearly')).toBeNull();
  });
});
