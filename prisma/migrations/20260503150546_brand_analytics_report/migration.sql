-- CreateEnum
CREATE TYPE "BrandAnalyticsReportType" AS ENUM ('SQP_BRAND', 'SQP_ASIN', 'TOP_SEARCH_TERMS', 'REPEAT_PURCHASE', 'MARKET_BASKET', 'ITEM_COMPARISON_ALT_PURCHASE', 'DEMOGRAPHICS', 'BRAND_CATALOG_PERFORMANCE');

-- AlterTable
ALTER TABLE "CampaignRule" ADD COLUMN     "schedule" TEXT;

-- CreateTable
CREATE TABLE "BrandAnalyticsReport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reportType" "BrandAnalyticsReportType" NOT NULL,
    "reportingPeriod" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amazonReportId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "rawData" JSONB NOT NULL,
    "error" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandAnalyticsReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignAlert" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertFire" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertFire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandAnalyticsReport_orgId_reportType_periodEnd_idx" ON "BrandAnalyticsReport"("orgId", "reportType", "periodEnd");

-- CreateIndex
CREATE INDEX "BrandAnalyticsReport_status_idx" ON "BrandAnalyticsReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BrandAnalyticsReport_orgId_reportType_periodStart_periodEnd_key" ON "BrandAnalyticsReport"("orgId", "reportType", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "CampaignAlert_orgId_idx" ON "CampaignAlert"("orgId");

-- CreateIndex
CREATE INDEX "CampaignAlert_isActive_idx" ON "CampaignAlert"("isActive");

-- CreateIndex
CREATE INDEX "AlertFire_orgId_idx" ON "AlertFire"("orgId");

-- CreateIndex
CREATE INDEX "AlertFire_alertId_idx" ON "AlertFire"("alertId");

-- CreateIndex
CREATE INDEX "AlertFire_isRead_idx" ON "AlertFire"("isRead");

-- CreateIndex
CREATE INDEX "AlertFire_triggeredAt_idx" ON "AlertFire"("triggeredAt");

-- CreateIndex
CREATE INDEX "CampaignRule_schedule_idx" ON "CampaignRule"("schedule");

-- AddForeignKey
ALTER TABLE "BrandAnalyticsReport" ADD CONSTRAINT "BrandAnalyticsReport_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAlert" ADD CONSTRAINT "CampaignAlert_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertFire" ADD CONSTRAINT "AlertFire_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "CampaignAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Invoice_stripeInvoiceId_key" RENAME TO "Invoice_externalInvoiceId_key";
