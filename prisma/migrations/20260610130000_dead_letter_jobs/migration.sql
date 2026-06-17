-- Durable record of background jobs that permanently failed (all BullMQ retries
-- exhausted). Operational/ops-level, not org-scoped. Idempotent so it can replay.

CREATE TABLE IF NOT EXISTS "DeadLetterJob" (
  "id"           TEXT NOT NULL,
  "queue"        TEXT NOT NULL,
  "jobId"        TEXT NOT NULL,
  "name"         TEXT,
  "data"         JSONB,
  "attemptsMade" INTEGER NOT NULL DEFAULT 0,
  "failedReason" TEXT,
  "stack"        TEXT,
  "replayedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeadLetterJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeadLetterJob_queue_idx"     ON "DeadLetterJob"("queue");
CREATE INDEX IF NOT EXISTS "DeadLetterJob_createdAt_idx" ON "DeadLetterJob"("createdAt");
