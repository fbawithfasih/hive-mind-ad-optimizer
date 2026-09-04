-- Clicks a term needs before its conversion rate is worth promoting on.
--
-- Nullable with no default, deliberately: null means "use the policy's floor",
-- so the number lives in harvest-policy.js alone. A stored default would
-- compete with it and drift, which is what @default(12) did to minClicks.
ALTER TABLE "ProfileObjective" ADD COLUMN "minClicksToPromote" INTEGER;
