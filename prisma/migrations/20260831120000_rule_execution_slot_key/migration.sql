-- Idempotency marker for the automation sweeps.
--
-- automation.worker.js had none: BullMQ retries the whole slot (attempts: 2,
-- plus stalled-job redelivery when a deploy kills the process mid-sweep), and
-- every rule that had already executed ran again. For `increase_budget` that
-- compounds — 20% twice is 44% — against live campaigns.
--
-- Existing rows get NULL, and Postgres treats NULLs as distinct in a unique
-- index, so this adds no conflict with history already recorded and leaves
-- manual runs (which are meant to be repeatable) unconstrained.
ALTER TABLE "RuleExecution" ADD COLUMN "slotKey" TEXT;

CREATE UNIQUE INDEX "RuleExecution_ruleId_slotKey_key" ON "RuleExecution"("ruleId", "slotKey");
