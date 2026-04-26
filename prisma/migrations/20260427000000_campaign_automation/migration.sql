-- CreateTable
CREATE TABLE "CampaignRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "action" TEXT NOT NULL,
    "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "lookbackDays" INTEGER NOT NULL DEFAULT 14,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleExecution" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "changes" JSONB,
    "error" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignRule_orgId_idx" ON "CampaignRule"("orgId");

-- CreateIndex
CREATE INDEX "CampaignRule_isActive_idx" ON "CampaignRule"("isActive");

-- CreateIndex
CREATE INDEX "RuleExecution_ruleId_idx" ON "RuleExecution"("ruleId");

-- CreateIndex
CREATE INDEX "RuleExecution_orgId_idx" ON "RuleExecution"("orgId");

-- CreateIndex
CREATE INDEX "RuleExecution_executedAt_idx" ON "RuleExecution"("executedAt");

-- AddForeignKey
ALTER TABLE "CampaignRule" ADD CONSTRAINT "CampaignRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleExecution" ADD CONSTRAINT "RuleExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CampaignRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
