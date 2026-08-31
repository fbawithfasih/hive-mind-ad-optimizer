/**
 * Bulk listing batch bookkeeping.
 *
 * These tests run against an in-memory stand-in for the two tables involved
 * rather than asserting on the shape of Prisma calls. The defects being guarded
 * against are all about the numbers a customer ends up seeing — an item counted
 * twice, a batch stuck in PROCESSING — and a call-shape assertion cannot
 * express those. The previous version of this file asserted
 * `{ completed: { increment: 1 } }` was passed, which was true of the broken
 * code, and had a test named "does not call maybeCompleteBatch on failure" that
 * encoded the stuck-batch bug as intended behaviour.
 */

// jest.mock is hoisted — factory must not reference out-of-scope variables
jest.mock('../../db/prisma.js', () => ({
  prisma: {
    bulkListingBatch:    { update: jest.fn(), findUnique: jest.fn() },
    listingOptimization: { upsert: jest.fn(), count: jest.fn() },
  },
}));

jest.mock('../../services/claude-mcp.js', () => ({
  optimizeListing: jest.fn(),
}));

import { bulkListingProcessor, willRetry } from '../bulk-listing.worker.js';
import { optimizeListing }      from '../../services/claude-mcp.js';
import { prisma }               from '../../db/prisma.js';

const { bulkListingBatch, listingOptimization } = prisma;

const optimizedResult = {
  title:       'Optimized title',
  bullets:     ['Better bullet 1'],
  description: 'Optimized description',
};

/** The queue is configured with attempts: 2 (queue.js). */
const ATTEMPTS = 2;

function makeJob(index = 0, attemptsMade = 0, overrides = {}) {
  return {
    id:   `ref-abc:${index}`,
    name: `item-${index}`,
    attemptsMade,
    opts: { attempts: ATTEMPTS },
    data: {
      dbBatchId: 'batch-1',
      batchRef:  'ref-abc',
      orgId:     'org-1',
      model:     'gemini',
      item: {
        asin:        `B000${index}`,
        sku:         `SKU${index}`,
        title:       'Original title',
        bullets:     ['Bullet 1', 'Bullet 2'],
        description: 'Original description',
        searchTerms: ['kw1', 'kw2'],
        ...overrides,
      },
    },
  };
}

/** Last attempt for a job — BullMQ will not hand it back after this one. */
const finalAttempt = (index) => makeJob(index, ATTEMPTS - 1);

/**
 * In-memory stand-in for BulkListingBatch + ListingOptimization, wired so the
 * worker's recount reads what its upserts wrote.
 */
function makeStore(total) {
  const batch = { id: 'batch-1', batchRef: 'ref-abc', total, completed: 0, failed: 0, status: 'PROCESSING' };
  const rows = new Map(); // `${batchId}::${itemKey}` → row

  bulkListingBatch.findUnique.mockImplementation(async () => ({ ...batch }));
  bulkListingBatch.update.mockImplementation(async ({ data }) => {
    Object.assign(batch, data);
    return { ...batch };
  });
  listingOptimization.upsert.mockImplementation(async ({ where, create }) => {
    const { batchId, itemKey } = where.batchId_itemKey;
    rows.set(`${batchId}::${itemKey}`, { ...create });
    return { id: 'opt-1', ...create };
  });
  listingOptimization.count.mockImplementation(async ({ where }) =>
    [...rows.values()].filter(r => r.batchId === where.batchId && r.status === where.status).length
  );

  return { batch, rows };
}

const run = (job) => bulkListingProcessor(job).catch((err) => err);

beforeEach(() => {
  jest.clearAllMocks();
  optimizeListing.mockResolvedValue(optimizedResult);
});

describe('willRetry', () => {
  it('is true while attempts remain and false on the last one', () => {
    expect(willRetry(makeJob(0, 0))).toBe(true);   // attempt 1 of 2
    expect(willRetry(makeJob(0, 1))).toBe(false);  // attempt 2 of 2
  });

  it('treats a job with no configured attempts as final', () => {
    expect(willRetry({ attemptsMade: 0, opts: {} })).toBe(false);
  });
});

describe('an item that fails and then succeeds on retry', () => {
  it('is counted once, not twice', async () => {
    const { batch } = makeStore(1);

    optimizeListing.mockRejectedValueOnce(new Error('AI service unavailable'));
    await run(makeJob(0, 0));           // attempt 1 — fails, will be retried
    await run(makeJob(0, 1));           // attempt 2 — succeeds

    expect(batch.completed).toBe(1);
    expect(batch.failed).toBe(0);
    expect(batch.completed + batch.failed).toBeLessThanOrEqual(batch.total);
  });

  it('records nothing on the attempt that will be retried', async () => {
    makeStore(1);
    optimizeListing.mockRejectedValue(new Error('AI service unavailable'));

    await run(makeJob(0, 0));

    // A FAILED row written here counts against a batch that is not finished.
    expect(listingOptimization.upsert).not.toHaveBeenCalled();
  });

  it('leaves exactly one row behind', async () => {
    const { rows } = makeStore(1);

    optimizeListing.mockRejectedValueOnce(new Error('transient'));
    await run(makeJob(0, 0));
    await run(makeJob(0, 1));

    expect(rows.size).toBe(1);
    expect([...rows.values()][0].status).toBe('COMPLETED');
  });
});

describe('a batch whose last item fails', () => {
  it('is still finalised instead of stranding in PROCESSING', async () => {
    const { batch } = makeStore(2);

    await run(makeJob(0));                        // succeeds
    optimizeListing.mockRejectedValue(new Error('AI service unavailable'));
    await run(finalAttempt(1));                   // fails for good

    expect(batch.status).toBe('COMPLETED');       // partial success
    expect(batch.completed).toBe(1);
    expect(batch.failed).toBe(1);
  });

  it('still rethrows so BullMQ records the failure', async () => {
    makeStore(1);
    optimizeListing.mockRejectedValue(new Error('AI service unavailable'));

    await expect(bulkListingProcessor(finalAttempt(0))).rejects.toThrow('AI service unavailable');
  });

  it('marks the batch FAILED when every item failed', async () => {
    const { batch } = makeStore(2);
    optimizeListing.mockRejectedValue(new Error('AI service unavailable'));

    await run(finalAttempt(0));
    await run(finalAttempt(1));

    expect(batch.status).toBe('FAILED');
    expect(batch.failed).toBe(2);
  });
});

describe('a job redelivered after a stall', () => {
  it('replaces its row rather than adding a second one', async () => {
    const { batch, rows } = makeStore(2);

    await run(makeJob(0));
    await run(makeJob(0));   // same job id — redelivered, attemptsMade unchanged

    expect(rows.size).toBe(1);
    expect(batch.completed).toBe(1);
    expect(batch.status).toBe('PROCESSING'); // item 1 has not run
  });
});

describe('batch progress', () => {
  it('does not finalise while items are outstanding', async () => {
    const { batch } = makeStore(3);

    await run(makeJob(0));

    expect(batch.completed).toBe(1);
    expect(batch.status).toBe('PROCESSING');
  });

  it('finalises once every item has landed', async () => {
    const { batch } = makeStore(3);

    await run(makeJob(0));
    await run(makeJob(1));
    await run(makeJob(2));

    expect(batch).toMatchObject({ completed: 3, failed: 0, status: 'COMPLETED' });
  });

  it('repairs counters that had already drifted', async () => {
    // A batch left inconsistent by the old incremental counting is corrected
    // the next time any of its items reports, because the counts are recomputed
    // rather than added to.
    const { batch } = makeStore(2);
    batch.completed = 7;
    batch.failed = 4;

    await run(makeJob(0));

    expect(batch.completed).toBe(1);
    expect(batch.failed).toBe(0);
  });

  it('survives a batch row that has been deleted', async () => {
    makeStore(1);
    bulkListingBatch.findUnique.mockResolvedValue(null);

    await expect(bulkListingProcessor(makeJob(0))).resolves.toBeUndefined();
  });
});

describe('the persisted row', () => {
  it('carries the optimization result and the item key', async () => {
    makeStore(1);

    await run(makeJob(0));

    const { where, create } = listingOptimization.upsert.mock.calls[0][0];
    expect(where.batchId_itemKey).toEqual({ batchId: 'batch-1', itemKey: 'ref-abc:0' });
    expect(create).toMatchObject({ status: 'COMPLETED', optimizedTitle: 'Optimized title' });
  });

  it('records the error message when the item failed for good', async () => {
    makeStore(1);
    optimizeListing.mockRejectedValue(new Error('AI service unavailable'));

    await run(finalAttempt(0));

    expect(listingOptimization.upsert.mock.calls[0][0].create).toMatchObject({
      status: 'FAILED', errorMessage: 'AI service unavailable',
    });
  });

  it('normalises ASIN to uppercase and tolerates null asin/sku', async () => {
    makeStore(2);

    await run(makeJob(0, 0, { asin: 'b0001abc' }));
    expect(listingOptimization.upsert.mock.calls[0][0].create.asin).toBe('B0001ABC');

    await run(makeJob(1, 0, { asin: null, sku: null }));
    expect(listingOptimization.upsert.mock.calls[1][0].create).toMatchObject({ asin: '', sku: '' });
  });

  it('falls back to uploadedKeywords when searchTerms is absent', async () => {
    makeStore(1);

    await run(makeJob(0, 0, { searchTerms: null, uploadedKeywords: ['fallback-kw'] }));

    expect(listingOptimization.upsert.mock.calls[0][0].create.keywords).toEqual(['fallback-kw']);
  });
});

describe('bookkeeping failures', () => {
  it('does not mask a successful item when the batch update throws', async () => {
    makeStore(1);
    bulkListingBatch.update.mockRejectedValue(new Error('database unreachable'));

    await expect(bulkListingProcessor(makeJob(0))).resolves.toBeUndefined();
  });

  it('does not mask a failed item when persisting the row throws', async () => {
    makeStore(1);
    listingOptimization.upsert.mockRejectedValue(new Error('database unreachable'));
    optimizeListing.mockRejectedValue(new Error('AI service unavailable'));

    await expect(bulkListingProcessor(finalAttempt(0))).rejects.toThrow('AI service unavailable');
  });
});
