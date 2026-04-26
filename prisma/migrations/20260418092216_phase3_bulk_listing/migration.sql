-- AlterTable
ALTER TABLE "ListingOptimization" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "errorMessage" TEXT;

-- CreateTable
CREATE TABLE "BulkListingBatch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "batchRef" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT NOT NULL DEFAULT 'gemini',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkListingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BulkListingBatch_batchRef_key" ON "BulkListingBatch"("batchRef");

-- CreateIndex
CREATE INDEX "BulkListingBatch_orgId_idx" ON "BulkListingBatch"("orgId");

-- CreateIndex
CREATE INDEX "BulkListingBatch_batchRef_idx" ON "BulkListingBatch"("batchRef");

-- CreateIndex
CREATE INDEX "BulkListingBatch_status_idx" ON "BulkListingBatch"("status");

-- CreateIndex
CREATE INDEX "ListingOptimization_batchId_idx" ON "ListingOptimization"("batchId");

-- AddForeignKey
ALTER TABLE "ListingOptimization" ADD CONSTRAINT "ListingOptimization_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BulkListingBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkListingBatch" ADD CONSTRAINT "BulkListingBatch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
