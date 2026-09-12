-- What the model calls cost, per org per month.
--
-- Four places called Claude and every one of them discarded the `usage`
-- object in the response, so token spend was not recorded anywhere and no
-- per-org cost could be attributed even after the fact. Input and output are
-- kept apart because they are priced apart; the plan limit is on their sum.
ALTER TABLE "UsageMetric" ADD COLUMN "llmInputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageMetric" ADD COLUMN "llmOutputTokens" INTEGER NOT NULL DEFAULT 0;
