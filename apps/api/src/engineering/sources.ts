import type { SourceReference } from './contracts.js';

/**
 * Candidate governing documents, for IDENTIFICATION ONLY (design §6). None has been retrieved, read or checked for edition, amendment, effective date
 * or applicability, so every one is NOT_VERIFIED and no value from any of them is used anywhere in the backend. Editions are deliberately absent:
 * naming one would assert a currency nobody has checked. A determination that depends on one of these fails closed as REQUIRES_SOURCE_VERIFICATION.
 */
const candidate = (sourceId: string, designation: string, title: string, issuer: string, note: string): SourceReference => Object.freeze({
  sourceId, designation, title, issuer, jurisdiction: 'IN', edition: null, effectiveDate: null, amendmentStatus: 'UNKNOWN', url: null, retrievedOn: null,
  verificationStatus: 'NOT_VERIFIED', permittedUse: 'IDENTIFICATION_ONLY', note,
}) as SourceReference;

export const SOURCES = Object.freeze({
  IS875_1: candidate('IN-BIS-IS875-1', 'IS 875 (Part 1)', 'Design loads (other than earthquake) for buildings and structures, Part 1: dead loads', 'Bureau of Indian Standards',
    'Candidate source for unit weights of materials; edition and applicability not established'),
  IS875_2: candidate('IN-BIS-IS875-2', 'IS 875 (Part 2)', 'Design loads (other than earthquake) for buildings and structures, Part 2: imposed loads', 'Bureau of Indian Standards',
    'Candidate source for occupancy imposed loads; edition and applicability not established'),
  IS875_3: candidate('IN-BIS-IS875-3', 'IS 875 (Part 3)', 'Design loads (other than earthquake) for buildings and structures, Part 3: wind loads', 'Bureau of Indian Standards',
    'Candidate source for wind parameters; edition, amendments and applicability to this height not established'),
  IS1893_1: candidate('IN-BIS-IS1893-1', 'IS 1893 (Part 1)', 'Criteria for earthquake resistant design of structures, Part 1: general provisions and buildings',
    'Bureau of Indian Standards', 'Candidate source for seismic parameters; edition, amendments and applicability not established'),
  IS16700: candidate('IN-BIS-IS16700', 'IS 16700', 'Criteria for structural safety of tall concrete buildings', 'Bureau of Indian Standards',
    'Candidate source for tall-building criteria; scope, edition and applicability to this building not established'),
  NBC: candidate('IN-BIS-NBC', 'National Building Code of India', 'National Building Code of India (fire and life safety and related parts)', 'Bureau of Indian Standards',
    'Candidate source; state and local development control rules may govern instead. Edition and applicability not established'),
} as const);
export type SourceKey = keyof typeof SOURCES;

/** Candidates are only catalogued for India. Any other jurisdiction has none, which is reported as such rather than borrowed. */
export const candidates = (country: string | null, keys: SourceKey[]) => country === 'IN' ? keys.map(k => SOURCES[k]) : [];
