-- AlterTable: track Amazon accountId/accountName per profile so syncProfilesForOrg
-- can distinguish Attribution profiles from Seller profiles. The columns are
-- created idempotently in src/server.js at boot; this migration brings the
-- declarative migration history in line for fresh dev databases.
ALTER TABLE "SellerProfile" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "SellerProfile" ADD COLUMN IF NOT EXISTS "accountName" TEXT;
