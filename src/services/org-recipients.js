/**
 * Who in an organization receives account-level email.
 *
 * Billing and trial mail is transactional — a failed payment is not
 * something a member opts out of — so this is every ADMIN's address with no
 * preference applied. Campaign alerts are different (OrgMember.notifyOnAlerts)
 * and resolve their own list in the alert worker.
 */

import { prisma } from '../db/prisma.js';

/** @returns {Promise<string[]>} every ADMIN's email, deduplicated, possibly empty */
export async function orgAdminEmails(orgId) {
  const members = await prisma.orgMember.findMany({
    where:   { orgId, role: 'ADMIN' },
    include: { user: { select: { email: true } } },
  });
  return [...new Set(members.map((m) => m.user?.email).filter(Boolean))];
}

export default orgAdminEmails;
