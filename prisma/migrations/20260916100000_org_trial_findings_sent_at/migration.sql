-- When the day-3 "what the agent found" trial email went out.
--
-- Same shape and purpose as trialWelcomeSentAt and friends: the daily sweep
-- claims it with a WHERE ... IS NULL update before sending, so the email goes
-- out once across retries and replicas. Null means not yet.
ALTER TABLE "Organization" ADD COLUMN "trialFindingsSentAt" TIMESTAMP(3);
