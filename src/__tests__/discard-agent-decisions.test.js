/**
 * The term filter on the discard script.
 *
 * This script deletes rows from a production database, and the filter exists
 * because the alternative was deleting eighteen decisions to remove three. So
 * the property worth pinning is not "it matches" but "it matches exactly what
 * was named, and says so when it does not".
 *
 * A term that matches nothing is the dangerous case. It is almost always a typo
 * or the wrong run id, and the operator's mental model at that moment is "I
 * asked for three and it removed what it found" — under which a silent partial
 * match is how two of the three quietly survive, unnoticed, and stay suppressed
 * by decisionKey for ninety days.
 */
import { normaliseTerm, unmatchedTerms } from '../../scripts/discard-agent-decisions.js';

const decision = (searchTerm) => ({ searchTerm });

describe('normalising a search term for comparison', () => {
  it('matches the policy: trimmed, lowercased, whitespace collapsed', () => {
    // Must agree with normalise() in harvest-policy.js, or a term the operator
    // copies out of the review panel fails to match the row it came from.
    expect(normaliseTerm('  Salt   Cellar ')).toBe('salt cellar');
    expect(normaliseTerm('B0926QF71K')).toBe('b0926qf71k');
  });

  it('survives a term that is missing entirely', () => {
    expect(normaliseTerm(null)).toBe('');
    expect(normaliseTerm(undefined)).toBe('');
  });
});

describe('reporting terms that matched nothing', () => {
  const RUN = [
    decision('b0926qf71k'),
    decision('b003pbhghg'),
    decision('salt cellar'),
    decision('salt cellar marble'),
  ];

  it('is silent when every named term is present', () => {
    expect(unmatchedTerms(RUN, ['b0926qf71k', 'b003pbhghg'])).toEqual([]);
  });

  it('names the one term that is not in the run', () => {
    expect(unmatchedTerms(RUN, ['b0926qf71k', 'b0gfgx7529'])).toEqual(['b0gfgx7529']);
  });

  it('reports a typo rather than quietly narrowing to the terms that did match', () => {
    // The whole point. Two of three matching is not a partial success — it is
    // the operator believing three were handled.
    expect(unmatchedTerms(RUN, ['b0926qf71k', 'b003pbhghg', 'b0926qf71'])).toEqual(['b0926qf71']);
  });

  it('compares on normalised form, so case and spacing do not cause a false alarm', () => {
    expect(unmatchedTerms(RUN, ['  SALT   Cellar '])).toEqual([]);
  });

  it('does not treat a substring as a match', () => {
    // 'salt' would substring-match two rows. Exact matching is what makes the
    // filter safe to hand --apply: an operator naming 'salt' means the term
    // 'salt', not everything containing it.
    expect(unmatchedTerms(RUN, ['salt'])).toEqual(['salt']);
  });

  it('has nothing to report when no terms were named', () => {
    expect(unmatchedTerms(RUN, [])).toEqual([]);
  });
});
