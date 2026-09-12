-- A report type for the nightly Sales & Traffic snapshot.
--
-- Its own value rather than REVENUE_SUMMARY, which the reporting agent
-- already writes AI narrative reports under. Sharing them would mean anything
-- asking for "the latest REVENUE_SUMMARY" could get prose where it expected
-- per-ASIN numbers, and neither reader would notice until it mattered.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'SALES_TRAFFIC';
