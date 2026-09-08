-- Who took an applied decision back, and when.
--
-- The REVERTED status has existed in AgentDecisionStatus since the table was
-- created and nothing ever set it. Now that something does, the status alone
-- is not enough: archiving a keyword at Amazon is terminal, so the one
-- irreversible thing this system does to a customer's account needs to name
-- the person who asked for it. Shaped after reviewedAt/reviewedById, which
-- answers the same question about the verdict.
ALTER TABLE "AgentDecision" ADD COLUMN "revertedAt" TIMESTAMP(3);
ALTER TABLE "AgentDecision" ADD COLUMN "revertedById" TEXT;
