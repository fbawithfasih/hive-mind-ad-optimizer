-- Remove Paddle-era customerId from Subscription.
-- customerId was required when Paddle created a customer object per org;
-- Razorpay subscriptions carry orgId in notes, so no separate customer ID is needed.

-- Drop the old index before dropping the column
DROP INDEX IF EXISTS "Subscription_customerId_idx";

-- Drop the column (safe: no foreign keys reference it)
ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "customerId";

-- Add index on subscriptionId (Razorpay sub ID) for webhook lookups
CREATE INDEX IF NOT EXISTS "Subscription_subscriptionId_idx" ON "Subscription"("subscriptionId");

-- Update Invoice currency default from USD to INR
ALTER TABLE "Invoice" ALTER COLUMN "currency" SET DEFAULT 'INR';
