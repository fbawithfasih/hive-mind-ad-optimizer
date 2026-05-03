-- Schema drift cleanup
--
-- The 20260503150546_brand_analytics_report migration was force-resolved on
-- prod after its first statement (ALTER TABLE "CampaignRule" ADD "schedule")
-- collided with a column added earlier via raw SQL in src/server.js boot
-- migration. The remaining DDL (CampaignAlert/AlertFire tables, indexes, FKs)
-- was applied manually except for two tail items that were missed:
--
--   1. CREATE INDEX "CampaignRule_schedule_idx" — Prisma declares this index
--      on CampaignRule.schedule but prod never got it.
--   2. ALTER INDEX "Invoice_stripeInvoiceId_key" RENAME TO
--      "Invoice_externalInvoiceId_key" — the underlying column was renamed
--      in an earlier migration but the index name stayed stale on prod.
--
-- Statements are idempotent so this migration is a no-op on fresh DBs (where
-- both items were already applied via 20260503150546_brand_analytics_report).

-- 1. Missing index on CampaignRule.schedule
CREATE INDEX IF NOT EXISTS "CampaignRule_schedule_idx" ON "CampaignRule"("schedule");

-- 2. Rename the stale Invoice index. Postgres has no IF EXISTS for
--    ALTER INDEX RENAME, so guard it via DO block.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'Invoice_stripeInvoiceId_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'Invoice_externalInvoiceId_key'
  ) THEN
    ALTER INDEX "Invoice_stripeInvoiceId_key" RENAME TO "Invoice_externalInvoiceId_key";
  END IF;
END $$;
