/**
 * Tests for the BA scheduler — tier cadence policy and the closed-period
 * boundary math. The WEEKLY boundary specifically had a prod regression
 * (used ISO Mon→Sun, but Amazon BA weeks are Sun→Sat).
 */

import { cadenceForTier, previousClosedPeriod } from '../brand-analytics-scheduler.js';

describe('cadenceForTier', () => {
  it('BASIC fetches the 3 core reports monthly', () => {
    const cad = cadenceForTier('BASIC');
    expect(cad.reportingPeriod).toBe('MONTHLY');
    expect(cad.cadenceDays).toBeGreaterThanOrEqual(28);
    expect(cad.reports).toEqual(expect.arrayContaining(['TOP_SEARCH_TERMS', 'BRAND_CATALOG_PERFORMANCE']));
    expect(cad.reports).not.toContain('REPEAT_PURCHASE');
    expect(cad.reports).not.toContain('MARKET_BASKET');
  });

  it('PRO fetches the full report set weekly', () => {
    const cad = cadenceForTier('PRO');
    expect(cad.reportingPeriod).toBe('WEEKLY');
    expect(cad.reports).toEqual(expect.arrayContaining([
      'TOP_SEARCH_TERMS', 'BRAND_CATALOG_PERFORMANCE',
      'REPEAT_PURCHASE', 'MARKET_BASKET',
    ]));
  });

  it('ENTERPRISE matches PRO cadence (Amazon BA refreshes weekly at most)', () => {
    expect(cadenceForTier('ENTERPRISE')).toEqual(cadenceForTier('PRO'));
  });

  it('falls back to BASIC for unknown tiers', () => {
    expect(cadenceForTier(undefined).reportingPeriod).toBe('MONTHLY');
    expect(cadenceForTier('NEW_PLAN').reportingPeriod).toBe('MONTHLY');
  });
});

describe('previousClosedPeriod — WEEKLY (Sun→Sat boundary)', () => {
  // Amazon's BA weeks run Sunday → Saturday. The previously-closed week is
  // the most recent Sunday-to-Saturday window strictly before `now`.

  it('Monday: previous week ends the most recent Saturday', () => {
    const monday = new Date('2026-05-04T08:00:00Z'); // Monday
    const { periodStart, periodEnd } = previousClosedPeriod('WEEKLY', monday);
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-05-02');   // Sat
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-04-26'); // Sun
  });

  it('Sunday: still the previous Sun→Sat (current week not yet closed)', () => {
    const sunday = new Date('2026-05-03T12:00:00Z'); // Sunday
    const { periodStart, periodEnd } = previousClosedPeriod('WEEKLY', sunday);
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-05-02');
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-04-26');
  });

  it('Saturday: prior week (today is the last day of this week, not yet closed)', () => {
    const saturday = new Date('2026-05-02T23:00:00Z'); // Saturday
    const { periodStart, periodEnd } = previousClosedPeriod('WEEKLY', saturday);
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-04-25');
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-04-19');
  });

  it('returns 7-day spans every time', () => {
    for (const day of ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10']) {
      const { periodStart, periodEnd } = previousClosedPeriod('WEEKLY', new Date(`${day}T12:00:00Z`));
      const days = (periodEnd - periodStart) / 86_400_000;
      expect(days).toBe(6); // 7 inclusive days = 6 day diff
      // Anchor on Sun→Sat
      expect(periodStart.getUTCDay()).toBe(0); // Sunday
      expect(periodEnd.getUTCDay()).toBe(6);   // Saturday
    }
  });
});

describe('previousClosedPeriod — MONTHLY', () => {
  it('mid-May returns full April window', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('MONTHLY', new Date('2026-05-15T00:00:00Z'));
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('handles January boundary (rolls back to previous year December)', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('MONTHLY', new Date('2026-01-15T00:00:00Z'));
    expect(periodStart.toISOString().slice(0, 10)).toBe('2025-12-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2025-12-31');
  });
});

describe('previousClosedPeriod — QUARTERLY', () => {
  it('mid-May returns Q1 (Jan–Mar)', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('QUARTERLY', new Date('2026-05-15T00:00:00Z'));
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('mid-November returns Q3 (Jul–Sep)', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('QUARTERLY', new Date('2026-11-15T00:00:00Z'));
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('Q1 rolls back to previous year Q4', () => {
    const { periodStart, periodEnd } = previousClosedPeriod('QUARTERLY', new Date('2026-02-15T00:00:00Z'));
    expect(periodStart.toISOString().slice(0, 10)).toBe('2025-10-01');
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2025-12-31');
  });
});
