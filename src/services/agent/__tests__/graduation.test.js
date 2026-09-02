/**
 * The gate between shadow and autonomous.
 *
 * The property that matters most is that agreement cannot be earned by not
 * reviewing. Everything else is arithmetic; that one is the difference between
 * a gate and a formality.
 */

import {
  agreementRate, graduationStatus, graduationByActionType, DEFAULT_GATE, GRADUATABLE,
} from '../graduation.js';

/** n decisions, the first `agree` of them marked AGREE, rest DISAGREE. */
const reviewed = (agree, disagree, actionType = 'ADD_NEGATIVE') => [
  ...Array.from({ length: agree },    () => ({ actionType, humanVerdict: 'AGREE' })),
  ...Array.from({ length: disagree }, () => ({ actionType, humanVerdict: 'DISAGREE' })),
];

const unreviewed = (n, actionType = 'ADD_NEGATIVE') =>
  Array.from({ length: n }, () => ({ actionType, humanVerdict: null }));

describe('what counts as evidence', () => {
  it('ignores decisions nobody reviewed', () => {
    // Counting them as agreement would let a reviewer earn autonomy by not
    // reviewing, which is the one way this gate could be worse than useless.
    const stats = agreementRate([...reviewed(10, 0), ...unreviewed(500)]);

    expect(stats.reviewed).toBe(10);
    expect(stats.agreed).toBe(10);
  });

  it('never reaches the bar on unreviewed decisions alone', () => {
    const status = graduationStatus(unreviewed(10_000));

    expect(status.eligible).toBe(false);
    expect(status.reviewed).toBe(0);
  });

  it('has no rate at all with nothing reviewed', () => {
    expect(agreementRate([]).rate).toBeNull();
    expect(agreementRate(unreviewed(50)).rate).toBeNull();
  });

  it('ignores a verdict it does not recognise', () => {
    const stats = agreementRate([{ humanVerdict: 'MAYBE' }, { humanVerdict: 'AGREE' }]);

    expect(stats.reviewed).toBe(1);
  });
});

describe('the bar', () => {
  it('is not cleared on a good rate with too little volume', () => {
    const status = graduationStatus(reviewed(50, 0));

    expect(status.rate).toBe(1);
    expect(status.eligible).toBe(false);
  });

  it('is not cleared on high volume with a poor rate', () => {
    const status = graduationStatus(reviewed(300, 100));

    expect(status.reviewed).toBe(400);
    expect(status.eligible).toBe(false);
  });

  it('is cleared with both', () => {
    expect(graduationStatus(reviewed(200, 0)).eligible).toBe(true);
  });

  it('is cleared exactly at the bar, not one past it', () => {
    // 190/200 is 95.0%.
    const status = graduationStatus(reviewed(190, 10));

    expect(status.reviewed).toBe(200);
    expect(status.rate).toBeCloseTo(0.95, 5);
    expect(status.eligible).toBe(true);
  });

  it('is not cleared one disagreement below the bar', () => {
    expect(graduationStatus(reviewed(189, 11)).eligible).toBe(false);
  });

  it('respects a bar set deliberately lower', () => {
    expect(graduationStatus(reviewed(80, 20), { minDecisions: 100, minRate: 0.8 }).eligible).toBe(true);
  });
});

describe('saying what is missing', () => {
  it('names how many more decisions are needed', () => {
    // "not yet" is far less useful to a reviewer than a number.
    const status = graduationStatus(reviewed(158, 0));

    expect(status.shortfall).toContain('42 more reviewed decisions');
  });

  it('names the rate against the bar', () => {
    const status = graduationStatus(reviewed(180, 20));

    expect(status.shortfall.join(' ')).toMatch(/90\.0% against a bar of 95%/);
  });

  it('names both when both are short', () => {
    expect(graduationStatus(reviewed(50, 20)).shortfall).toHaveLength(2);
  });

  it('says nothing is missing once eligible', () => {
    expect(graduationStatus(reviewed(200, 0)).shortfall).toEqual([]);
  });

  it('does not complain about a rate before anything is reviewed', () => {
    // A brand-new action type should be told it needs decisions, not that its
    // agreement rate is nil.
    expect(graduationStatus([]).shortfall).toEqual([`${DEFAULT_GATE.minDecisions} more reviewed decisions`]);
  });
});

describe('the window', () => {
  it('judges recent behaviour, not a whole history', () => {
    // Newest first: 500 good decisions after an early bad patch should clear.
    const decisions = [...reviewed(500, 0), ...reviewed(0, 500)];

    expect(graduationStatus(decisions).eligible).toBe(true);
  });

  it('lets recent mistakes pull an established rate down', () => {
    const decisions = [...reviewed(0, 100), ...reviewed(400, 0)];

    expect(graduationStatus(decisions).eligible).toBe(false);
  });

  it('counts at most the window', () => {
    expect(agreementRate(reviewed(900, 0)).reviewed).toBe(DEFAULT_GATE.window);
  });
});

describe('per action type', () => {
  it('graduates one while the other is still watched', () => {
    // A negative can be removed; a keyword starts spending. They are different
    // judgements with different risk and must not share a verdict.
    const decisions = [
      ...reviewed(200, 0, 'ADD_NEGATIVE'),
      ...reviewed(10, 40, 'ADD_EXACT'),
    ];

    const byType = graduationByActionType(decisions);

    expect(byType.ADD_NEGATIVE.eligible).toBe(true);
    expect(byType.ADD_EXACT.eligible).toBe(false);
  });

  it('reports every graduatable type even with no decisions', () => {
    const byType = graduationByActionType([]);

    expect(Object.keys(byType).sort()).toEqual([...GRADUATABLE].sort());
    for (const type of GRADUATABLE) expect(byType[type].eligible).toBe(false);
  });

  it('does not let one type\'s decisions count toward another', () => {
    const byType = graduationByActionType(reviewed(300, 0, 'ADD_NEGATIVE'));

    expect(byType.ADD_EXACT.reviewed).toBe(0);
  });
});

describe('the default gate', () => {
  it('demands real volume and a high rate', () => {
    expect(DEFAULT_GATE.minDecisions).toBeGreaterThanOrEqual(100);
    expect(DEFAULT_GATE.minRate).toBeGreaterThanOrEqual(0.9);
  });

  it('reports the gate it judged against, so a number is never unexplained', () => {
    expect(graduationStatus([]).gate).toEqual({
      minDecisions: DEFAULT_GATE.minDecisions,
      minRate: DEFAULT_GATE.minRate,
      window: DEFAULT_GATE.window,
    });
  });
});
