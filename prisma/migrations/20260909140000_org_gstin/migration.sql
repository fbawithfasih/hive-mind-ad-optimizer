-- The organization's GST identification number, for invoices.
--
-- The customer is an Indian business. A subscription invoice that carries
-- their GSTIN lets them claim input tax credit on it, which for a registered
-- seller is the difference between the price and the price plus 18%. It is
-- optional — an unregistered seller has none — and it is carried into the
-- Razorpay subscription's notes at checkout so the invoice shows it.
ALTER TABLE "Organization" ADD COLUMN "gstin" TEXT;
