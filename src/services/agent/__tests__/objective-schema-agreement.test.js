/**
 * The schema and the policy must agree about the click threshold.
 *
 * They did not. harvest-policy.js was corrected to derive minClicks from the
 * account's conversion rate, with null meaning "calibrate" — but the column
 * stayed `Int @default(12)`. So the calibration path was unreachable through
 * the database, and every profile enrolled without an explicit value got the
 * threshold that negates a healthy term 48% of the time at a 6% conversion
 * rate. The JavaScript was right and the storage silently disagreed.
 *
 * Read the schema rather than trusting that both were remembered.
 */

import { readFileSync } from 'node:fs';

import { DEFAULT_OBJECTIVE } from '../harvest-policy.js';

const schema = readFileSync('prisma/schema.prisma', 'utf8');

/** The ProfileObjective model block. */
function objectiveModel() {
  const match = /^model ProfileObjective \{([\s\S]*?)^\}/m.exec(schema);
  return match?.[1] ?? '';
}

function fieldLine(name) {
  const body = objectiveModel();
  return new RegExp(`^\\s*${name}\\s+.*$`, 'm').exec(body)?.[0] ?? null;
}

describe('ProfileObjective agrees with the policy', () => {
  it('finds the model at all', () => {
    // Guard against the regex matching nothing, which would make everything
    // below pass vacuously.
    expect(objectiveModel()).toMatch(/targetAcos/);
  });

  it('lets minClicks be null, so calibration is reachable', () => {
    // null is the instruction to derive the threshold from the report. A
    // non-null column makes that impossible to express.
    expect(fieldLine('minClicks')).toMatch(/Int\?/);
  });

  it('does not hardcode a click threshold in the database', () => {
    // A stored default competes with the calibration and will drift from it —
    // which is exactly what happened with @default(12).
    expect(fieldLine('minClicks')).not.toMatch(/@default/);
  });

  it('never reintroduces the threshold that was measured wrong', () => {
    expect(objectiveModel()).not.toMatch(/minClicks\s+Int\s+@default\(12\)/);
    expect(DEFAULT_OBJECTIVE.minClicks).not.toBe(12);
  });

  it('keeps the fields the policy actually reads', () => {
    for (const field of ['targetAcos', 'minPurchasesToPromote', 'wasteMultiplier', 'brandTerms']) {
      expect(fieldLine(field)).not.toBeNull();
    }
  });

  it('stores every threshold the policy defaults, so none is unreachable', () => {
    // Generated from DEFAULT_OBJECTIVE rather than listed, which is the whole
    // lesson of this file: a threshold added to the policy and forgotten in the
    // schema cannot be set per profile, and nothing else would say so.
    for (const field of Object.keys(DEFAULT_OBJECTIVE)) {
      expect(fieldLine(field)).not.toBeNull();
    }
  });

  it('lets minClicksToPromote be null, so the policy floor is reachable', () => {
    // Same shape as minClicks: null is an instruction, not an absence.
    expect(fieldLine('minClicksToPromote')).toMatch(/Int\?/);
  });

  it('does not hardcode the promotion floor in the database', () => {
    expect(fieldLine('minClicksToPromote')).not.toMatch(/@default/);
  });

  it('still defaults the other thresholds to what the policy expects', () => {
    // These have no calibration path, so a stored default is right — it just
    // has to match the code.
    expect(fieldLine('minPurchasesToPromote')).toContain(`@default(${DEFAULT_OBJECTIVE.minPurchasesToPromote})`);
    expect(fieldLine('wasteMultiplier')).toContain(`@default(${DEFAULT_OBJECTIVE.wasteMultiplier})`);
    expect(fieldLine('targetAcos')).toContain(`@default(${DEFAULT_OBJECTIVE.targetAcos})`);
  });

  it('starts a profile in shadow on both action types', () => {
    // Enrolment must never be the thing that grants autonomy.
    expect(fieldLine('negativeMode')).toContain('@default(SHADOW)');
    expect(fieldLine('promotionMode')).toContain('@default(SHADOW)');
  });

  it('starts a profile disabled', () => {
    expect(fieldLine('enabled')).toContain('@default(false)');
  });
});
