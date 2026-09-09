/**
 * GSTIN — India's 15-character GST identification number.
 *
 * Two state digits, the PAN (five letters, four digits, one letter), an
 * entity code, the literal Z, and a check character. Validated for shape
 * only: the check character is a base-36 checksum, but the failure mode of
 * a typo here is an invoice the customer's accountant rejects, which they
 * will notice — while a strict checksum wrongly refusing a real number
 * would block a checkout over a formality.
 */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Normalise user input to a stored value.
 *
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 *   `value` is null for an empty input (clear), the uppercased number otherwise.
 */
export function normaliseGstin(input) {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'gstin must be a string' };
  const value = input.trim().toUpperCase().replace(/\s+/g, '');
  if (value === '') return { ok: true, value: null };
  if (!GSTIN.test(value)) {
    return { ok: false, error: 'gstin must be a 15-character GST number, e.g. 27AAPFU0939F1ZV' };
  }
  return { ok: true, value };
}

export default normaliseGstin;
