-- The column trackUsage has been writing to since the image optimizer shipped.
--
-- image-optimizer.js calls trackUsage(orgId, 'imagesOptimized'); UsageMetric had
-- no such column, so Prisma rejected every upsert and the error was swallowed.
-- Existing rows start at 0, which is what they have effectively reported all
-- along.
ALTER TABLE "UsageMetric" ADD COLUMN "imagesOptimized" INTEGER NOT NULL DEFAULT 0;
