/**
 * Country config for <dinify-phone-input>.
 *
 * Uganda-only today. Adding a second country later is an ADDITIVE change —
 * append an entry here and swap the static label for a small selector — NOT a
 * rewrite. Deliberately a single keyed list; do not grow this into a country
 * table abstraction.
 */
export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code; emitted to consumers as `iso2Code` (e.g. 'UG'). */
  iso2: string;
  /** Calling code without '+'; rendered as the static '+<dialCode>' label (e.g. '256'). */
  dialCode: string;
  /** Local, decorative flag asset path (no remote requests). */
  flagAsset: string;
  /** National significant number length; drives the client-side validity hint. */
  nationalLength: number;
}

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { iso2: 'UG', dialCode: '256', flagAsset: 'assets/flags/ug.svg', nationalLength: 9 },
];
