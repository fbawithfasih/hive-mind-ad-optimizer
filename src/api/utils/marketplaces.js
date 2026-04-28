/**
 * Amazon marketplace constants.
 *
 * Maps two-letter country codes to Marketplace IDs and locale tags used in
 * SP-API attribute payloads.  Add new regions here — nothing else needs
 * changing as long as the countryCode on SellerProfile is correct.
 */

export const MARKETPLACE_IDS = {
  US: 'ATVPDKIKX0DER',
  CA: 'A2EUQ1WTGCTBG2',
  MX: 'A1AM78C64UM0Y8',
  BR: 'A2Q3Y263D00KWC',
  UK: 'A1F83G8C2ARO7P',
  GB: 'A1F83G8C2ARO7P',
  DE: 'A1PA6795UKMFR9',
  FR: 'A13V1IB3VIYZZH',
  IT: 'APJ6JRA9NG5V4',
  ES: 'A1RKKUPIHCS9HS',
  NL: 'A1805IZSGTT6HS',
  SE: 'A2NODRKZP88ZB9',
  PL: 'A1C3SOZHARKG6S',
  BE: 'AMEN7PMS3EDWL',
  IN: 'A21TJRUUN4KGV',
  JP: 'A1VC38T7YXB528',
  AU: 'A39IBJ37TRP1C6',
  SG: 'A19VAU5U5O7RUS',
  AE: 'A2VIGQ35RCS4UG',
  SA: 'A17E79C6D8DWNP',
  TR: 'A33AVAJ2PDY3EV',
  EG: 'ARBP9OOSHTCHU',
};

export const LANGUAGE_TAGS = {
  US: 'en_US',
  CA: 'en_CA',
  MX: 'es_MX',
  BR: 'pt_BR',
  UK: 'en_GB',
  GB: 'en_GB',
  DE: 'de_DE',
  FR: 'fr_FR',
  IT: 'it_IT',
  ES: 'es_ES',
  NL: 'nl_NL',
  SE: 'sv_SE',
  PL: 'pl_PL',
  BE: 'nl_BE',
  IN: 'en_IN',
  JP: 'ja_JP',
  AU: 'en_AU',
  SG: 'en_SG',
  AE: 'en_AE',
  SA: 'ar_SA',
  TR: 'tr_TR',
  EG: 'ar_EG',
};

/**
 * Returns the SP-API Marketplace ID for a given country code.
 * Falls back to US if the country is unknown.
 */
export function marketplaceIdForCountry(countryCode) {
  return MARKETPLACE_IDS[countryCode?.toUpperCase()] ?? MARKETPLACE_IDS.US;
}

/**
 * Returns the BCP-47 locale tag for SP-API attribute language_tag fields.
 * Falls back to en_US.
 */
export function languageTagForCountry(countryCode) {
  return LANGUAGE_TAGS[countryCode?.toUpperCase()] ?? LANGUAGE_TAGS.US;
}
