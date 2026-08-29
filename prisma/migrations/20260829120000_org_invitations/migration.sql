-- Pending invitations to join an organization.
--
-- Replaces the previous behaviour where POST /api/orgs/:orgId/members created
-- an OrgMember row outright. Membership now requires the invited person to
-- accept while signed in as the invited address.
CREATE TABLE "OrgInvitation" (
    "id"         TEXT NOT NULL,
    "orgId"      TEXT NOT NULL,
    "email"      TEXT NOT NULL,
    "role"       "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "token"      TEXT NOT NULL,
    "invitedBy"  TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt"  TIMESTAMP(3),

    CONSTRAINT "OrgInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrgInvitation_token_key"      ON "OrgInvitation"("token");
CREATE INDEX        "OrgInvitation_orgId_idx"      ON "OrgInvitation"("orgId");
CREATE INDEX        "OrgInvitation_email_idx"      ON "OrgInvitation"("email");
CREATE INDEX        "OrgInvitation_expiresAt_idx"  ON "OrgInvitation"("expiresAt");

ALTER TABLE "OrgInvitation"
    ADD CONSTRAINT "OrgInvitation_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
