-- Rename stripeInvoiceId → externalInvoiceId on Invoice table
-- Keeps all data intact; only renames the column and its unique constraint.

ALTER TABLE "Invoice" RENAME COLUMN "stripeInvoiceId" TO "externalInvoiceId";
