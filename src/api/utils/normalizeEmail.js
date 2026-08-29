/**
 * Normalise an email address for storage and lookup.
 *
 * Mail providers treat the domain (and in practice the local part) as
 * case-insensitive, but Postgres unique constraints are not — so without this,
 * `Fasih@Example.com` and `fasih@example.com` are two different accounts, and a
 * user who signs up with one casing cannot log in with the other. Google and
 * Apple both hand back lowercased addresses, which is how the same person ends
 * up with a duplicate account after using SSO.
 *
 * Non-string input passes through untouched so callers can keep doing their own
 * `if (!email)` validation afterwards.
 */
export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export default normalizeEmail;
