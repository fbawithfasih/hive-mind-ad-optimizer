/**
 * Bulk listing optimization job processor
 *
 * Each BullMQ job carries ONE listing item from a bulk batch:
 *   { dbBatchId, batchRef, orgId, model, item: { asin, sku, title, bullets, description, searchTerms, uploadedKeywords } }
 *
 * The processor:
 *   1. Runs the listing through optimizeListing()
 *   2. Persists the result as a ListingOptimization row linked to the batch
 *   3. Increments completed/failed counters on the BulkListingBatch row
 *   4. Marks the batch COMPLETED when all items have been processed
 */

import { prisma }             from '../db/prisma.ts';
import { optimizeListing }    from '../services/claude-mcp.js';
import { createLogger }       from '../api/utils/logger.js';

const logger = createLogger('BULK_WORKER');

async function incrementBatchCounter(dbBatchId, field) {
  await prisma.bulkListingBatch.update({
    where: { id: dbBatchId },
    data:  { [field]: { increment: 1 }, updatedAt: new Date() },
  }).catch((err) => {
    logger.error(`Failed to increment batch ${dbBatchId}.${field}: ${err.message}`);
  });
}

async function maybeCompleteBatch(dbBatchId) {
  const batch = await prisma.bulkListingBatch.findUnique({ where: { id: dbBatchId } });
  if (!batch) return;
  if (batch.completed + batch.failed >= batch.total) {
    const finalStatus = batch.failed === batch.total ? 'FAILED'
                      : batch.failed > 0             ? 'COMPLETED'  // partial success → COMPLETED
                      :                                'COMPLETED';
    await prisma.bulkListingBatch.update({
      where: { id: dbBatchId },
      data:  { status: finalStatus, updatedAt: new Date() },
    }).catch((err) => logger.error(`Failed to mark batch ${dbBatchId} ${finalStatus}: ${err.message}`));
    logger.info(`Batch ${batch.batchRef} ${finalStatus} — ${batch.completed}/${batch.total} succeeded, ${batch.failed} failed`);
  }
}

export async function bulkListingProcessor(job) {
  const { dbBatchId, batchRef, orgId, model, item } = job.data;
  const { asin, sku, title, bullets, description, searchTerms, uploadedKeywords } = item;

  logger.info(`Processing bulk item for batch ${batchRef} — ASIN: ${asin ?? 'N/A'}, SKU: ${sku ?? 'N/A'}`);

  let result = null;
  let errorMessage = null;

  try {
    result = await optimizeListing(
      { asin, title, bullets, description, searchTerms, uploadedKeywords },
      model || 'gemini'
    );
  } catch (err) {
    errorMessage = err.message;
    logger.error(`Bulk item failed for batch ${batchRef} — ASIN: ${asin}: ${err.message}`);
  }

  // Persist the ListingOptimization record regardless of success/failure
  await prisma.listingOptimization.create({
    data: {
      orgId,
      batchId:             dbBatchId,
      asin:                (asin ?? '').trim().toUpperCase(),
      sku:                 (sku  ?? '').trim(),
      originalTitle:       title ?? '',
      optimizedTitle:      result?.title       ?? null,
      originalBullets:     bullets             ?? [],
      optimizedBullets:    result?.bullets     ?? [],
      originalDescription: description         ?? '',
      optimizedDescription: result?.description ?? null,
      keywords:            searchTerms ?? uploadedKeywords ?? [],
      aiModel:             model || 'gemini',
      status:              result ? 'COMPLETED' : 'FAILED',
      errorMessage:        errorMessage ?? null,
    },
  }).catch((dbErr) => {
    logger.error(`Failed to persist bulk listing optimization: ${dbErr.message}`);
  });

  // Update batch counters
  if (result) {
    await incrementBatchCounter(dbBatchId, 'completed');
  } else {
    await incrementBatchCounter(dbBatchId, 'failed');
    // Propagate error so BullMQ can retry
    throw new Error(errorMessage ?? 'Listing optimization failed');
  }

  // Check if the entire batch is now done
  await maybeCompleteBatch(dbBatchId);
}
