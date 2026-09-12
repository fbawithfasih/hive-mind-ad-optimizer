-- Composite indexes for the query every list endpoint actually runs, and the
-- removal of the single-column ones they replace.
--
-- Each of these tables is read the same way — "this org's rows, newest first"
-- — and indexed as if it were read two ways: one index on orgId, another on
-- the timestamp. Postgres can use only one of them per scan, so the query
-- filters on orgId and then sorts however many rows that returns. On a table
-- with a year of one org's history that is the whole history, sorted, per
-- request.
--
-- The single-column orgId indexes are dropped rather than left alongside: a
-- composite whose leading column is orgId answers every lookup the standalone
-- one did, and keeping both costs a write on every insert to maintain an index
-- nothing will choose. The timestamp-only indexes stay — the retention sweep
-- below deletes by age across all orgs and needs exactly that.
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog" ("orgId", "createdAt" DESC);
DROP INDEX IF EXISTS "AuditLog_orgId_idx";

CREATE INDEX "ReportJob_orgId_createdAt_idx" ON "ReportJob" ("orgId", "createdAt" DESC);
DROP INDEX IF EXISTS "ReportJob_orgId_idx";

CREATE INDEX "AlertFire_orgId_triggeredAt_idx" ON "AlertFire" ("orgId", "triggeredAt" DESC);
DROP INDEX IF EXISTS "AlertFire_orgId_idx";

CREATE INDEX "ListingOptimization_orgId_createdAt_idx" ON "ListingOptimization" ("orgId", "createdAt" DESC);
DROP INDEX IF EXISTS "ListingOptimization_orgId_idx";

-- UsageMetric already has a unique index on (orgId, month), which serves every
-- lookup by org. The separate orgId index has never been the better plan for
-- any query against it.
DROP INDEX IF EXISTS "UsageMetric_orgId_idx";
