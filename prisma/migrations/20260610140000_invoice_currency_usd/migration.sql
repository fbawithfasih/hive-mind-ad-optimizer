-- International payments are enabled on the Razorpay account; the platform bills
-- in USD. Switch the Invoice.currency column default from INR to USD. Existing
-- rows keep their stored currency (the webhook always writes payment.currency).

ALTER TABLE "Invoice" ALTER COLUMN "currency" SET DEFAULT 'USD';
