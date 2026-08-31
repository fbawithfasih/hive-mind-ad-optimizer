-- Per-item identity for bulk listing batches.
--
-- bulk-listing.worker.js counted batch progress by incrementing counters once
-- per *attempt*, so a retried item was counted twice and left a second
-- ListingOptimization row behind. Progress is now counted from these rows, and
-- the worker upserts on (batchId, itemKey) so a redelivered job replaces its
-- row rather than adding one.
--
-- Existing rows get NULL, as do single-listing optimizations, which have no
-- batch. Postgres treats NULLs as distinct in a unique index, so neither
-- collides.
ALTER TABLE "ListingOptimization" ADD COLUMN "itemKey" TEXT;

CREATE UNIQUE INDEX "ListingOptimization_batchId_itemKey_key" ON "ListingOptimization"("batchId", "itemKey");
