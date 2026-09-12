-- A profile that is sample data, not a seller's Amazon account.
--
-- A new org sees nothing until two Amazon consents and a sync are done, and
-- the trial's whole argument is the agent's proposals. One flagged profile
-- per org, backed by a fixture client, lets the dashboard and the agent
-- panel show real shapes before anything is connected. The flag is the
-- source of truth for every exclusion: plan limits, sync, enrolment, and
-- onboarding all ask `isDemo: false`.
ALTER TABLE "SellerProfile" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
