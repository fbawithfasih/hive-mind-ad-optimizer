-- Where a signup came from.
--
-- Nothing recorded it. A trial that converted and a trial that expired were
-- indistinguishable by channel, so no channel could be judged. The first
-- touch this browser saw — utm_*, a partner's ?ref= code, the plan chosen on
-- the site, the landing path, the referrer — is captured on the client and
-- stored here at signup, as a small whitelisted JSON object.
ALTER TABLE "User" ADD COLUMN "signupSource" JSONB;
