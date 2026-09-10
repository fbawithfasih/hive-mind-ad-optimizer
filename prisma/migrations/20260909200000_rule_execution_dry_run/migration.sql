-- Whether this execution actually changed anything.
--
-- A dry run is recorded like any other execution so the history shows what a
-- rule considered as well as what it did — but the two must be
-- distinguishable, or "12 campaigns affected" in the panel would mean either
-- twelve budgets changed or twelve budgets contemplated.
ALTER TABLE "RuleExecution" ADD COLUMN "dryRun" BOOLEAN NOT NULL DEFAULT false;
