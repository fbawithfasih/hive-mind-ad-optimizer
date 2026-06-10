-- Webhook idempotency + audit ledger. Records every inbound provider webhook
-- (e.g. Razorpay) keyed by a unique event id so at-least-once delivery cannot
-- double-process. Idempotent so the migration can replay safely.

DO $$ BEGIN
  CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "WebhookEvent" (
  "id"          TEXT NOT NULL,
  "provider"    TEXT NOT NULL DEFAULT 'razorpay',
  "eventId"     TEXT NOT NULL,
  "eventType"   TEXT NOT NULL,
  "status"      "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "error"       TEXT,
  "receivedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_eventId_key"     ON "WebhookEvent"("eventId");
CREATE INDEX        IF NOT EXISTS "WebhookEvent_provider_eventType_idx" ON "WebhookEvent"("provider", "eventType");
CREATE INDEX        IF NOT EXISTS "WebhookEvent_status_idx"      ON "WebhookEvent"("status");
