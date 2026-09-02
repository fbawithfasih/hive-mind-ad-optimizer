/**
 * The reviewer, and the boundary around it.
 *
 * Model output is untrusted input. The tests that matter here are the ones
 * asserting what a response CANNOT do: it cannot add an action, cannot change a
 * bid or a search term or an ad group, and cannot remove an action by saying
 * something unrecognisable. It can veto, and it can reorder. That asymmetry is
 * the entire safety argument for putting a model anywhere near live ad spend.
 *
 * The second theme is degradation. A model outage must cost a ranking, never a
 * night's decisions.
 */

import { jest } from '@jest/globals';

import {
  reviewCandidates, mergeReview, parseReviewResponse, buildReviewPrompt,
  withReviewIds, partitionByVerdict, MAX_REVIEWED,
} from '../llm-review.js';

const candidate = (over = {}) => ({
  actionType: 'ADD_NEGATIVE', campaignId: 'c1', campaignName: 'Camp',
  adGroupId: 'g1', adGroupName: 'Group', searchTerm: 'dud term',
  reason: 'NO_CONVERSION', detail: '20 clicks, no sales',
  inputs: { clicks: 20, cost: 15, purchases: 0, sales: 0, acos: null, cpc: 0.75 },
  ...over,
});

const modelReturning = (text) => jest.fn(async () => text);
const json = (reviews) => JSON.stringify({ reviews });

describe('what a model response cannot do', () => {
  const original = { ...withReviewIds([candidate({ actionType: 'ADD_EXACT', bid: 0.80 })])[0] };

  it('cannot change the bid', () => {
    const [merged] = mergeReview([original], [{ id: 'd1', verdict: 'approve', bid: 99 }]);

    expect(merged.bid).toBe(0.80);
  });

  it('cannot change the search term', () => {
    const [merged] = mergeReview([original], [{ id: 'd1', verdict: 'approve', searchTerm: 'something else' }]);

    expect(merged.searchTerm).toBe('dud term');
  });

  it('cannot move the action to another ad group', () => {
    const [merged] = mergeReview([original], [{ id: 'd1', verdict: 'approve', adGroupId: 'g999', campaignId: 'c999' }]);

    expect(merged.adGroupId).toBe('g1');
    expect(merged.campaignId).toBe('c1');
  });

  it('cannot change what kind of action it is', () => {
    const [merged] = mergeReview([original], [{ id: 'd1', verdict: 'approve', actionType: 'ADD_NEGATIVE' }]);

    expect(merged.actionType).toBe('ADD_EXACT');
  });

  it('cannot introduce an action the policy never proposed', () => {
    const merged = mergeReview([original], [
      { id: 'd1', verdict: 'approve' },
      { id: 'd2', verdict: 'approve', searchTerm: 'hallucinated', actionType: 'ADD_NEGATIVE' },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].searchTerm).toBe('dud term');
  });

  it('cannot veto by saying something unrecognisable', () => {
    // Silence, or a word the model invented, must not remove an action the
    // policy defended. Only the literal verdict "veto" removes anything.
    for (const verdict of ['reject', 'no', 'DENY', '', null, undefined, 42]) {
      const [merged] = mergeReview([original], [{ id: 'd1', verdict }]);
      expect(merged.llmVerdict).toBeNull();
      expect(partitionByVerdict([merged]).vetoed).toHaveLength(0);
    }
  });
});

describe('what a model response can do', () => {
  it('vetoes an action', () => {
    const [merged] = mergeReview(withReviewIds([candidate()]),
      [{ id: 'd1', verdict: 'veto', rationale: 'this is our own brand' }]);

    expect(merged.llmVerdict).toBe('veto');
    expect(merged.llmRationale).toBe('this is our own brand');
  });

  it('is case-insensitive about the verdict', () => {
    const [merged] = mergeReview(withReviewIds([candidate()]), [{ id: 'd1', verdict: 'VETO' }]);

    expect(merged.llmVerdict).toBe('veto');
  });

  it('reorders what survives', () => {
    const cands = withReviewIds([
      candidate({ searchTerm: 'a' }), candidate({ searchTerm: 'b' }), candidate({ searchTerm: 'c' }),
    ]);

    const merged = mergeReview(cands, [
      { id: 'd1', verdict: 'approve', rank: 3 },
      { id: 'd2', verdict: 'approve', rank: 1 },
      { id: 'd3', verdict: 'approve', rank: 2 },
    ]);

    expect(partitionByVerdict(merged).kept.map(c => c.searchTerm)).toEqual(['b', 'c', 'a']);
  });

  it('puts unranked actions after ranked ones rather than dropping them', () => {
    const cands = withReviewIds([candidate({ searchTerm: 'a' }), candidate({ searchTerm: 'b' })]);

    const merged = mergeReview(cands, [{ id: 'd2', verdict: 'approve', rank: 1 }]);

    expect(partitionByVerdict(merged).kept.map(c => c.searchTerm)).toEqual(['b', 'a']);
  });

  it('ignores a nonsense rank', () => {
    for (const rank of [0, -1, 1.5, 'first', null]) {
      const [merged] = mergeReview(withReviewIds([candidate()]), [{ id: 'd1', verdict: 'approve', rank }]);
      expect(merged.rank).toBeNull();
    }
  });

  it('truncates a rambling rationale', () => {
    const [merged] = mergeReview(withReviewIds([candidate()]),
      [{ id: 'd1', verdict: 'approve', rationale: 'x'.repeat(1000) }]);

    expect(merged.llmRationale).toHaveLength(300);
  });

  it('takes the first mention when an id appears twice', () => {
    const [merged] = mergeReview(withReviewIds([candidate()]),
      [{ id: 'd1', verdict: 'approve' }, { id: 'd1', verdict: 'veto' }]);

    expect(merged.llmVerdict).toBe('approve');
  });
});

describe('a candidate the model did not mention', () => {
  it('survives, un-reviewed rather than vetoed', () => {
    // Treating silence as rejection would let a truncated response quietly
    // discard most of a night's work.
    const cands = withReviewIds([candidate({ searchTerm: 'a' }), candidate({ searchTerm: 'b' })]);

    const merged = mergeReview(cands, [{ id: 'd1', verdict: 'approve' }]);

    expect(merged[1].llmVerdict).toBeNull();
    expect(partitionByVerdict(merged).kept).toHaveLength(2);
  });
});

describe('parsing what the model actually sends back', () => {
  it('reads a clean object', () => {
    expect(parseReviewResponse(json([{ id: 'd1', verdict: 'approve' }]))).toHaveLength(1);
  });

  it('reads a bare array', () => {
    expect(parseReviewResponse('[{"id":"d1","verdict":"veto"}]')).toHaveLength(1);
  });

  it('strips markdown fences', () => {
    expect(parseReviewResponse('```json\n{"reviews":[{"id":"d1"}]}\n```')).toHaveLength(1);
  });

  it('digs the object out of surrounding prose', () => {
    const wrapped = 'Here is my review:\n{"reviews":[{"id":"d1","verdict":"veto"}]}\nHope that helps!';

    expect(parseReviewResponse(wrapped)).toHaveLength(1);
  });

  it('returns null for anything unusable', () => {
    for (const bad of ['', '   ', 'not json at all', '{broken', null, undefined, 42, '{"reviews":"nope"}']) {
      expect(parseReviewResponse(bad)).toBeNull();
    }
  });
});

describe('degrading when the model is unavailable', () => {
  it('keeps every candidate when the call throws', () => {
    // A model outage must cost a ranking, never a night's decisions.
    return reviewCandidates([candidate(), candidate({ searchTerm: 'b' })], {},
      { callModel: jest.fn(async () => { throw new Error('503 from provider'); }) })
      .then((result) => {
        expect(result.kept).toHaveLength(2);
        expect(result.vetoed).toHaveLength(0);
        expect(result.reviewError).toMatch(/503/);
      });
  });

  it('keeps every candidate when the response is unparseable', async () => {
    const result = await reviewCandidates([candidate()], {}, { callModel: modelReturning('I refuse.') });

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].llmVerdict).toBeNull();
    expect(result.reviewError).toBe('unparseable model response');
  });

  it('keeps every candidate when no model is configured at all', async () => {
    const result = await reviewCandidates([candidate()], {}, {});

    expect(result.kept).toHaveLength(1);
    expect(result.reviewError).toBeTruthy();
  });

  it('reports no error on a good response', async () => {
    const result = await reviewCandidates([candidate()], {},
      { callModel: modelReturning(json([{ id: 'd1', verdict: 'approve', rank: 1, rationale: 'clear waste' }])) });

    expect(result.reviewError).toBeNull();
    expect(result.kept[0].llmRationale).toBe('clear waste');
  });

  it('does not call the model at all for an empty candidate set', async () => {
    const callModel = jest.fn();

    const result = await reviewCandidates([], {}, { callModel });

    expect(callModel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kept: [], vetoed: [] });
  });
});

describe('cost control', () => {
  it('reviews only the first slice of a very large set', async () => {
    const many = Array.from({ length: MAX_REVIEWED + 20 }, (_, i) => candidate({ searchTerm: `t${i}` }));
    const callModel = modelReturning(json([{ id: 'd1', verdict: 'approve' }]));

    const result = await reviewCandidates(many, {}, { callModel });

    const sent = JSON.parse(callModel.mock.calls[0][1]);
    expect(sent.proposals).toHaveLength(MAX_REVIEWED);
    // The tail is passed through, not discarded — the policy already defended it.
    expect(result.kept).toHaveLength(MAX_REVIEWED + 20);
  });
});

describe('the prompt', () => {
  it('carries the numbers behind each proposal', () => {
    const sent = JSON.parse(buildReviewPrompt(withReviewIds([candidate()]), { targetAcos: 25 }));

    expect(sent.proposals[0].metrics).toMatchObject({ clicks: 20, cost: 15 });
    expect(sent.account.targetAcos).toBe(25);
  });

  it('includes the brand list, so the model can act on it', () => {
    const sent = JSON.parse(buildReviewPrompt(withReviewIds([candidate()]), { brandTerms: ['hive mind'] }));

    expect(sent.account.brandTerms).toEqual(['hive mind']);
  });

  it('sends the proposed bid only for promotions', () => {
    const sent = JSON.parse(buildReviewPrompt(
      withReviewIds([candidate(), candidate({ actionType: 'ADD_EXACT', bid: 0.9 })]), {}));

    expect(sent.proposals[0].proposedBid).toBeUndefined();
    expect(sent.proposals[1].proposedBid).toBe(0.9);
  });

  it('gives every proposal a distinct id', () => {
    const ids = withReviewIds([candidate(), candidate(), candidate()]).map(c => c.reviewId);

    expect(new Set(ids).size).toBe(3);
  });
});
