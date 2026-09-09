-- When each trial lifecycle email was sent, so a send is idempotent.
--
-- The lifecycle worker selects orgs by where they are in their trial and
-- sends the matching email. It runs daily, on every replica, and a retried
-- job re-runs; without a mark per email a trialist would get "your trial
-- ends in three days" three times. Null means not yet sent. Shaped as three
-- columns rather than a table because there are exactly three emails and
-- the question asked of each is only "has this gone out".
ALTER TABLE "Organization" ADD COLUMN "trialWelcomeSentAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "trialEndingSentAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "trialExpiredSentAt" TIMESTAMP(3);
