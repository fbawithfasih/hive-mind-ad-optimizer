-- AlterTable: capture Amazon backend search-terms (generic keyword) field
-- alongside title / bullets / description so the optimizer can fill it from
-- leftover priority keywords. Idempotent for parity with the runtime
-- migration in src/server.js.
ALTER TABLE "ListingOptimization" ADD COLUMN IF NOT EXISTS "originalGenericKeyword" TEXT;
ALTER TABLE "ListingOptimization" ADD COLUMN IF NOT EXISTS "optimizedGenericKeyword" TEXT;
