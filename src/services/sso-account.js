/**
 * Account resolution for SSO logins (Google, Apple).
 *
 * The delicate part is deciding when an SSO identity may be attached to an
 * account that already exists under the same email. Linking hands whoever
 * completed the SSO flow full control of that account, so it has to be earned
 * rather than assumed — see canLink() below.
 */

import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/prisma.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('SSO');

const ID_FIELD = { google: 'googleId', apple: 'appleId' };

/**
 * Coerce a provider's email-verified claim to a boolean.
 *
 * Google's userinfo endpoint returns `verified_email` as a real boolean; Apple's
 * id_token returns `email_verified` as either a boolean or the string "true".
 * Anything else — absent, null, "false" — is treated as unverified.
 */
export function claimIsTrue(value) {
  return value === true || value === 'true';
}

/** Backfill only the profile fields we don't already have, and touch lastLogin. */
async function touch(user, profile, extraUpdates) {
  const updates = { lastLogin: new Date(), ...extraUpdates };
  for (const [key, value] of Object.entries(profile)) {
    if (value && !user[key]) updates[key] = value;
  }
  return prisma.user.update({ where: { id: user.id }, data: updates });
}

/**
 * Find, link, or create the local account for an SSO login.
 *
 * @param {object}  args
 * @param {'google'|'apple'} args.provider
 * @param {string}  args.providerId    Stable subject ID from the provider
 * @param {string}  args.email         Already normalised
 * @param {boolean} args.emailVerified Does the PROVIDER assert this address?
 * @param {object}  [args.profile]     firstName / lastName / avatar to backfill
 * @returns {Promise<{ok: true, user: object} | {ok: false, reason: string}>}
 */
export async function resolveSsoUser({
  provider,
  providerId,
  email,
  emailVerified,
  profile = {},
}) {
  const idField = ID_FIELD[provider];
  if (!idField) throw new Error(`Unknown SSO provider: ${provider}`);

  // 1. We've seen this provider identity before — unambiguously the same
  //    person, so there is no linking decision to make.
  const byProvider = await prisma.user.findFirst({ where: { [idField]: providerId } });
  if (byProvider) {
    const verifyNow = emailVerified && !byProvider.emailVerified
      ? { emailVerified: true, emailVerifiedAt: new Date() }
      : {};
    logger.info(`${provider} login: existing user ${byProvider.id}`);
    return { ok: true, user: await touch(byProvider, profile, verifyNow) };
  }

  // 2. No provider match, but an account exists on this email.
  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    // Both sides must prove they own the mailbox before we merge them: the
    // provider has to assert the address is verified, AND the local account has
    // to have verified it independently.
    //
    // Dropping the second half is the classic pre-hijacking hole. An attacker
    // registers the victim's address with a password of their choosing and
    // never verifies it (they can't — the mail isn't theirs). When the victim
    // later signs in with Google or Apple for the first time, the email branch
    // matches the attacker's row and links the provider onto it. The two now
    // share one account, and the attacker's password still works.
    if (!emailVerified || !byEmail.emailVerified) {
      logger.warn(
        `Refused to link ${provider} identity to account ${byEmail.id}: ` +
        `provider verified=${emailVerified}, local verified=${byEmail.emailVerified}`
      );
      return { ok: false, reason: 'link_requires_login' };
    }

    logger.info(`${provider} login: linked to existing verified user ${byEmail.id}`);
    return { ok: true, user: await touch(byEmail, profile, { [idField]: providerId }) };
  }

  // 3. Nothing matched — brand-new account. Trust the provider's verification
  //    claim rather than assuming it: an unverified address still has to go
  //    through our own verification flow before it can be linked to later.
  const user = await prisma.user.create({
    data: {
      id:            uuidv4(),
      email,
      [idField]:     providerId,
      passwordHash:  null,
      firstName:     profile.firstName || '',
      lastName:      profile.lastName  || '',
      avatar:        profile.avatar    ?? null,
      emailVerified,
      emailVerifiedAt: emailVerified ? new Date() : null,
      lastLogin:     new Date(),
    },
  });

  logger.info(`${provider} login: new user created ${user.id}`);
  return { ok: true, user };
}
