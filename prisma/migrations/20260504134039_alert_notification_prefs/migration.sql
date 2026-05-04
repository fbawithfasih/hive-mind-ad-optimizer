-- Per-user opt-out for campaign-alert emails + per-org Slack webhook URL.
-- Both fields default to safe values (true / null) so existing rows need no
-- backfill. Idempotent so the migration can be replayed safely.

ALTER TABLE "OrgMember"    ADD COLUMN IF NOT EXISTS "notifyOnAlerts"  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "slackWebhookUrl" TEXT;
