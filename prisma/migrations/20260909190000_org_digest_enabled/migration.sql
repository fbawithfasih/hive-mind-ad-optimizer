-- Whether this organization wants the Monday digest.
--
-- Default true: the digest is the only recurring reason a part-time seller
-- opens the product, and an opt-in nobody discovers is the same as no digest
-- at all. Off is one click, and every email carries the link.
ALTER TABLE "Organization" ADD COLUMN "digestEnabled" BOOLEAN NOT NULL DEFAULT true;
