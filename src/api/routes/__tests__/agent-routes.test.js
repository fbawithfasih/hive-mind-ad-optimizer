/**
 * The review surface.
 *
 * Two things matter more than the CRUD: that a verdict cannot be recorded
 * against another org's decision, and that the payload which enrols a profile
 * or moves it to LIVE is validated before it reaches the database. Those are
 * the two writes here that decide whether the agent touches a real account.
 */

import { jest } from '@jest/globals';

import { validateObjective } from '../agent.js';

describe('validating an objective before it can enrol anything', () => {
  it('accepts an empty patch', () => {
    // PUT is a partial update; sending nothing changes nothing.
    expect(validateObjective({})).toBeNull();
  });

  it('accepts a fully specified objective', () => {
    expect(validateObjective({
      targetAcos: 25, minClicks: 38, minPurchasesToPromote: 2, wasteMultiplier: 2,
      brandTerms: ['queenza'], negativeMode: 'SHADOW', promotionMode: 'SHADOW', enabled: true,
    })).toBeNull();
  });

  it('accepts null minClicks, which means calibrate from the account', () => {
    // The distinction that matters after the threshold correction: null is not
    // "unset", it is an instruction to derive the number from the report.
    expect(validateObjective({ minClicks: null })).toBeNull();
  });

  it.each([[0], [-5], [501], [12.5], ['many']])('rejects minClicks %p', (minClicks) => {
    expect(validateObjective({ minClicks })).toMatch(/minClicks/);
  });

  it.each([[0], [-1], [301], ['low']])('rejects targetAcos %p', (targetAcos) => {
    expect(validateObjective({ targetAcos })).toMatch(/targetAcos/);
  });

  it('rejects a wasteMultiplier that would never fire or fire instantly', () => {
    expect(validateObjective({ wasteMultiplier: 0 })).toMatch(/wasteMultiplier/);
    expect(validateObjective({ wasteMultiplier: 100 })).toMatch(/wasteMultiplier/);
  });

  it('rejects brand terms that are not strings', () => {
    expect(validateObjective({ brandTerms: 'queenza' })).toMatch(/brandTerms/);
    expect(validateObjective({ brandTerms: ['ok', 42] })).toMatch(/brandTerms/);
  });

  it('caps the brand list', () => {
    expect(validateObjective({ brandTerms: Array(201).fill('x') })).toMatch(/at most 200/);
  });

  it.each([['negativeMode'], ['promotionMode']])('rejects an unknown %s', (field) => {
    expect(validateObjective({ [field]: 'AUTO' })).toMatch(field);
    expect(validateObjective({ [field]: 'live' })).toMatch(field);  // case matters
  });

  it('accepts the two real modes', () => {
    expect(validateObjective({ negativeMode: 'LIVE', promotionMode: 'SHADOW' })).toBeNull();
  });

  it('rejects a non-boolean enabled', () => {
    expect(validateObjective({ enabled: 'yes' })).toMatch(/enabled/);
  });
});
