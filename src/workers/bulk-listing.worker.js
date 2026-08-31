/**
 * Bulk listing optimization job processor
 *
 * Each BullMQ job carries ONE listing item from a bulk batch:
 *   { dbBatchId, batchRef, orgId, model, item: { asin, sku, title, bullets, description, searchTerms, uploadedKeywords } }
 *
 * The processor:
 *   1. Runs the listing through optimizeListing()
 *   2. Persists the result as a ListingOptimization row linked to the batch
 *   3. Recomputes the batch's completed/failed counters from those rows
 *   4. Marks the batch COMPLETED (or FAILED) once every item has landed
 *
 * ── Counting, and why it is not incremental ────────────────────────────────
 * Progress used to be tracked by incrementing a counter once per *attempt*.
 * With `attempts: 2` that produced three separate defects:
 *
 *   - An item that failed and then succeeded on retry incremented `failed` and
 *     then `completed`, counting one item twice and leaving two rows behind.
 *   - The failure path threw to trigger the retry, and the throw jumped over the
 *     batch-completion check. A batch whose last item failed was never
 *     finalised — it sat in PROCESSING forever, and the UI polls that status.
 *   - `completed + failed` could exceed `total`, so the numbers shown to the
 *     customer were simply wrong.
 *
 * Counters are now derived from the ListingOptimization rows rather than
 * accumulated. That is idempotent by construction: re-running an item cannot
 * inflate a count, because nothing is being added up. The rows are upserted on
 * (batchId, itemKey) so a redelivered job replaces its row instead of adding
 * one, and the batch is reconciled on every terminal outcome, success or
 * failure, before the error is rethrown.
 */

import { prisma }             from '../db/prisma.js';
import { optimizeListing }    from '../services/claude-mcp.js';
import { flattenListingKeywords } from '../api/utils/listingKeywords.js';
import { createLogger }       from '../api/utils/logger.js';

const logger = createLogger('BULK_WORKER');

/**
 * Whether BullMQ will hand this job back after the current attempt fails.
 *
 * Mirrors Job.shouldRetryJob: inside the processor `attemptsMade` counts the
 * attempts already finished, so the current one is `attemptsMade + 1`. We need
 * this because a non-final failure must not be recorded — the retry may still
 * succeed, and a FAILED row written now would count against a batch that is
 * not finished.
 */
export function willRetry(job) {
  return (job?.attemptsMade ?? 0) + 1 < (job?.opts?.attempts ?? 0);
}

/**
 * Recompute a batch's progress from its item rows and finalise it if complete.
 *
 * Deliberately a recount rather than an increment: it is safe to run twice, and
 * it repairs a batch whose counters already drifted.
 */
async function reconcileBatch(dbBatchId, batchRef) {
  try {
    const batch = await prisma.bulkListingBatch.findUnique({ where: { id: dbBatchId } });
    if (!batch) return;

    const [completed, failed] = await Promise.all([
      prisma.listingOptimization.count({ where: { batchId: dbBatchId, status: 'COMPLETED' } }),
      prisma.listingOptimization.count({ where: { batchId: dbBatchId, status: 'FAILED' } }),
    ]);

    const done = completed + failed >= batch.total;
    // A batch where every item failed is a failure; any success at all leaves it
    // COMPLETED, with `failed` carrying the partial count.
    const finalStatus = failed >= batch.total ? 'FAILED' : 'COMPLETED';

    await prisma.bulkListingBatch.update({
      where: { id: dbBatchId },
      data: {
        completed,
        failed,
        ...(done ? { status: finalStatus } : {}),
        updatedAt: new Date(),
      },
    });

    if (done) {
      logger.info(`Batch ${batchRef} ${finalStatus} — ${completed}/${batch.total} succeeded, ${failed} failed`);
    }
  } catch (err) {
    // Never let bookkeeping mask the item's own outcome.
    logger.error(`Failed to reconcile batch ${dbBatchId}: ${err.message}`);
  }
}

export async function bulkListingProcessor(job) {
  const { dbBatchId, batchRef, orgId, model, item } = job.data;
  const { asin, sku, title, bullets, description, searchTerms, uploadedKeywords } = item;

  // Stable per-item identity. The enqueuing route sets jobId to
  // `${batchRef}:${index}` (listings.js), which survives retries and stalls.
  const itemKey = job.id ?? job.name ?? `${batchRef}:${asin ?? ''}:${sku ?? ''}`;

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

    if (willRetry(job)) {
      // Record nothing yet. The retry may succeed, and a FAILED row written now
      // would count against a batch that is not actually finished — which is
      // how an item used to be counted twice.
      throw err;
    }
  }

  const row = {
    orgId,
    batchId:             dbBatchId,
    itemKey,
    asin:                (asin ?? '').trim().toUpperCase(),
    sku:                 (sku  ?? '').trim(),
    originalTitle:       title ?? '',
    optimizedTitle:      result?.title       ?? null,
    originalBullets:     bullets             ?? [],
    optimizedBullets:    result?.bullets     ?? [],
    originalDescription: description         ?? '',
    optimizedDescription: result?.description ?? null,
    originalGenericKeyword:  item.genericKeyword ?? null,
    optimizedGenericKeyword: result?.genericKeyword ?? null,
    keywords:            flattenListingKeywords(searchTerms?.length ? searchTerms : uploadedKeywords),
    aiModel:             model || 'gemini',
    status:              result ? 'COMPLETED' : 'FAILED',
    errorMessage:        errorMessage ?? null,
  };

  // Upsert, so a job redelivered after a stall replaces its row rather than
  // adding a second one the recount would treat as another item.
  await prisma.listingOptimization
    .upsert({
      where:  { batchId_itemKey: { batchId: dbBatchId, itemKey } },
      create: row,
      update: row,
    })
    .catch((dbErr) => {
      logger.error(`Failed to persist bulk listing optimization: ${dbErr.message}`);
    });

  // Reconcile before rethrowing. The old code threw first, so a batch whose
  // last item failed was never finalised and stayed PROCESSING forever.
  await reconcileBatch(dbBatchId, batchRef);

  if (!result) {
    throw new Error(errorMessage ?? 'Listing optimization failed');
  }
}
