-- CreateEnum
CREATE TYPE "AgentMode" AS ENUM ('SHADOW', 'LIVE');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'ABORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentActionType" AS ENUM ('ADD_NEGATIVE', 'ADD_EXACT');

-- CreateEnum
CREATE TYPE "AgentDecisionStatus" AS ENUM ('PROPOSED', 'BLOCKED', 'VETOED', 'APPLIED', 'FAILED', 'REVERTED');

-- CreateEnum
CREATE TYPE "HumanVerdict" AS ENUM ('AGREE', 'DISAGREE');

-- CreateEnum
CREATE TYPE "AuditActor" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actor" "AuditActor" NOT NULL DEFAULT 'USER',
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "mode" "AgentMode" NOT NULL DEFAULT 'SHADOW',
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "slotKey" TEXT NOT NULL,
    "rowsIn" INTEGER NOT NULL DEFAULT 0,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "abortReason" TEXT,
    "abortDetail" TEXT,
    "error" TEXT,
    "llmModel" TEXT,
    "llmTokensIn" INTEGER,
    "llmTokensOut" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actionType" "AgentActionType" NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "searchTerm" TEXT NOT NULL,
    "matchType" TEXT,
    "bid" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "inputs" JSONB NOT NULL,
    "llmVerdict" TEXT,
    "llmRationale" TEXT,
    "rank" INTEGER,
    "status" "AgentDecisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "appliedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "inverse" JSONB,
    "humanVerdict" "HumanVerdict",
    "humanNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileObjective" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "targetAcos" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "minClicks" INTEGER NOT NULL DEFAULT 12,
    "minPurchasesToPromote" INTEGER NOT NULL DEFAULT 2,
    "wasteMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "brandTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "negativeMode" "AgentMode" NOT NULL DEFAULT 'SHADOW',
    "promotionMode" "AgentMode" NOT NULL DEFAULT 'SHADOW',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileObjective_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_orgId_idx" ON "AgentRun"("orgId");

-- CreateIndex
CREATE INDEX "AgentRun_orgId_startedAt_idx" ON "AgentRun"("orgId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_orgId_profileId_slotKey_key" ON "AgentRun"("orgId", "profileId", "slotKey");

-- CreateIndex
CREATE INDEX "AgentDecision_runId_idx" ON "AgentDecision"("runId");

-- CreateIndex
CREATE INDEX "AgentDecision_orgId_idx" ON "AgentDecision"("orgId");

-- CreateIndex
CREATE INDEX "AgentDecision_orgId_actionType_createdAt_idx" ON "AgentDecision"("orgId", "actionType", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDecision_orgId_humanVerdict_idx" ON "AgentDecision"("orgId", "humanVerdict");

-- CreateIndex
CREATE INDEX "ProfileObjective_orgId_idx" ON "ProfileObjective"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileObjective_orgId_profileId_key" ON "ProfileObjective"("orgId", "profileId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileObjective" ADD CONSTRAINT "ProfileObjective_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

