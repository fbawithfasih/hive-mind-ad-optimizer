// jest.mock is hoisted — factory must not reference out-of-scope variables
jest.mock('../../db/prisma.ts', () => ({
  prisma: {
    bulkListingBatch:   { update: jest.fn(), findUnique: jest.fn() },
    listingOptimization: { create: jest.fn() },
  },
}));

jest.mock('../../services/claude-mcp.js', () => ({
  optimizeListing: jest.fn(),
}));

import { bulkListingProcessor } from '../bulk-listing.worker.js';
import { optimizeListing }      from '../../services/claude-mcp.js';
import { prisma }               from '../../db/prisma.ts';

const { bulkListingBatch, listingOptimization } = prisma;

const baseJob = {
  data: {
    dbBatchId: 'batch-1',
    batchRef:  'ref-abc',
    orgId:     'org-1',
    model:     'gemini',
    item: {
      asin:        'B0001',
      sku:         'SKU1',
      title:       'Original title',
      bullets:     ['Bullet 1', 'Bullet 2'],
      description: 'Original description',
      searchTerms: ['kw1', 'kw2'],
    },
  },
};

const optimizedResult = {
  title:       'Optimized title',
  bullets:     ['Better bullet 1'],
  description: 'Optimized description',
};

beforeEach(() => {
  jest.clearAllMocks();
  bulkListingBatch.update.mockResolvedValue({});
  listingOptimization.create.mockResolvedValue({ id: 'opt-1' });
  bulkListingBatch.findUnique.mockResolvedValue({
    id: 'batch-1', batchRef: 'ref-abc', total: 3, completed: 0, failed: 0,
  });
});

describe('bulkListingProcessor — success path', () => {
  beforeEach(() => { optimizeListing.mockResolvedValue(optimizedResult); });

  it('creates a ListingOptimization record with status COMPLETED', async () => {
    await bulkListingProcessor(baseJob);
    expect(listingOptimization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED', optimizedTitle: 'Optimized title' }),
      })
    );
  });

  it('increments the completed counter on the batch', async () => {
    await bulkListingProcessor(baseJob);
    expect(bulkListingBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'batch-1' },
        data:  expect.objectContaining({ completed: { increment: 1 } }),
      })
    );
  });

  it('normalises ASIN to uppercase', async () => {
    const job = { data: { ...baseJob.data, item: { ...baseJob.data.item, asin: 'b0001abc' } } };
    await bulkListingProcessor(job);
    expect(listingOptimization.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ asin: 'B0001ABC' }) })
    );
  });
});

describe('bulkListingProcessor — failure / retry path', () => {
  beforeEach(() => { optimizeListing.mockRejectedValue(new Error('AI service unavailable')); });

  it('creates a ListingOptimization record with status FAILED', async () => {
    await expect(bulkListingProcessor(baseJob)).rejects.toThrow();
    expect(listingOptimization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', errorMessage: 'AI service unavailable' }),
      })
    );
  });

  it('increments the failed counter on the batch', async () => {
    await expect(bulkListingProcessor(baseJob)).rejects.toThrow();
    expect(bulkListingBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ failed: { increment: 1 } }) })
    );
  });

  it('re-throws so BullMQ can retry the job', async () => {
    await expect(bulkListingProcessor(baseJob)).rejects.toThrow('AI service unavailable');
  });
});

describe('maybeCompleteBatch — batch completion logic', () => {
  it('marks batch COMPLETED when all items succeed', async () => {
    optimizeListing.mockResolvedValue(optimizedResult);
    // Simulate: after incrementing, batch is now fully done
    bulkListingBatch.update.mockImplementation(({ data }) => {
      if (data.completed?.increment) {
        bulkListingBatch.findUnique.mockResolvedValue({
          id: 'batch-1', batchRef: 'ref-abc', total: 1, completed: 1, failed: 0,
        });
      }
      return Promise.resolve({});
    });
    bulkListingBatch.findUnique.mockResolvedValue({
      id: 'batch-1', batchRef: 'ref-abc', total: 1, completed: 0, failed: 0,
    });

    await bulkListingProcessor(baseJob);

    const statusCall = bulkListingBatch.update.mock.calls.find(([a]) => a?.data?.status);
    expect(statusCall).toBeDefined();
    expect(statusCall[0].data.status).toBe('COMPLETED');
  });

  it('does not call maybeCompleteBatch on failure (job re-throws for BullMQ retry)', async () => {
    // When optimizeListing fails the job throws so BullMQ can retry it.
    // maybeCompleteBatch is never reached, so no status update happens.
    optimizeListing.mockRejectedValue(new Error('fail'));

    await expect(bulkListingProcessor(baseJob)).rejects.toThrow();

    const statusCalls = bulkListingBatch.update.mock.calls.filter(([a]) => a?.data?.status);
    expect(statusCalls).toHaveLength(0);
  });

  it('does not mark batch complete while items are still pending', async () => {
    optimizeListing.mockResolvedValue(optimizedResult);
    // total=3, only 1 done — not complete
    bulkListingBatch.findUnique.mockResolvedValue({
      id: 'batch-1', batchRef: 'ref-abc', total: 3, completed: 1, failed: 0,
    });

    await bulkListingProcessor(baseJob);

    const statusCalls = bulkListingBatch.update.mock.calls.filter(([a]) => a?.data?.status);
    expect(statusCalls).toHaveLength(0);
  });
});

describe('bulkListingProcessor — edge cases', () => {
  beforeEach(() => { optimizeListing.mockResolvedValue(optimizedResult); });

  it('handles null asin/sku gracefully', async () => {
    const job = { data: { ...baseJob.data, item: { ...baseJob.data.item, asin: null, sku: null } } };
    await bulkListingProcessor(job);
    expect(listingOptimization.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ asin: '', sku: '' }) })
    );
  });

  it('falls back to uploadedKeywords when searchTerms is absent', async () => {
    const job = {
      data: {
        ...baseJob.data,
        item: { ...baseJob.data.item, searchTerms: null, uploadedKeywords: ['fallback-kw'] },
      },
    };
    await bulkListingProcessor(job);
    expect(listingOptimization.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ keywords: ['fallback-kw'] }) })
    );
  });
});
