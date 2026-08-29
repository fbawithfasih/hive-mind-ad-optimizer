-- Session revocation ---------------------------------------------------------
-- tokenVersion is stamped into every session JWT. Incrementing it invalidates
-- every token issued before the bump. Existing tokens in the wild carry no
-- tokenVersion claim; requireAuth reads a missing claim as 0, which matches
-- this default, so deploying this does not log everyone out.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Email normalisation --------------------------------------------------------
-- Addresses are treated case-insensitively by mail providers, but the "User"
-- unique constraint is case-sensitive. The application now lowercases on the
-- way in; this folds the rows that predate that.
--
-- Rows whose lowercased address would collide with another row are left alone
-- on purpose: those are genuine duplicate accounts (each with its own orgs,
-- subscriptions and Amazon credentials) and merging them is a judgement call,
-- not something a migration should decide. Find them with:
--
--   SELECT lower(email), count(*), array_agg(id)
--   FROM "User" GROUP BY 1 HAVING count(*) > 1;
UPDATE "User" u
SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (
    SELECT 1 FROM "User" o
    WHERE o."id" <> u."id"
      AND lower(o."email") = lower(u."email")
  );
