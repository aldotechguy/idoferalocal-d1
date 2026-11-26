/**
 * Customer Hub duplicate detection — pure, DOM-free matching for Add/Edit
 * Customer modals so duplicate records don't split customer debt or loyalty.
 */

export interface DedupCustomer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  outstandingBalance?: number;
  purchaseHistoryCount?: number;
}

export type DuplicateMatchType = 'phone' | 'email' | 'name' | 'fuzzy_name';
export type DuplicateConfidence = 'exact' | 'possible';

export interface DuplicateMatch<T extends DedupCustomer = DedupCustomer> {
  customer: T;
  matchType: DuplicateMatchType;
  confidence: DuplicateConfidence;
  reason: string;
}

export const normalizeName = (value?: string | null): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const normalizeEmail = (value?: string | null): string =>
  String(value || '').trim().toLowerCase();

export const normalizePhoneDigits = (value?: string | null): string =>
  String(value || '').replace(/\D/g, '');

/**
 * Return comparison keys for a phone number: the full digit string and, when
 * >= 10 digits (e.g. +2348031234567 vs 08031234567), the trailing 10 digits.
 */
export const phoneMatchKeys = (value?: string | null): string[] => {
  const digits = normalizePhoneDigits(value);
  if (!digits) return [];
  const keys = [digits];
  if (digits.length >= 10) {
    keys.push(digits.slice(-10));
  }
  return keys;
};

/** Standard Levenshtein edit distance for short customer names. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }
  return prev[b.length];
};

function isFuzzyNameMatch(candidateName: string, existingName: string): string | null {
  if (!candidateName || !existingName || candidateName === existingName) return null;

  // Swapped word order (e.g., "John Doe" vs "Doe John")
  const candTokens = candidateName.split(' ').filter(Boolean).sort();
  const existTokens = existingName.split(' ').filter(Boolean).sort();
  if (candTokens.length >= 2 && candTokens.length === existTokens.length && candTokens.join(' ') === existTokens.join(' ')) {
    return 'Same name words in different order';
  }

  // Edit distance for names of reasonable length (>= 5 chars)
  const maxLen = Math.max(candidateName.length, existingName.length);
  if (Math.min(candidateName.length, existingName.length) >= 5) {
    const dist = levenshteinDistance(candidateName, existingName);
    const similarity = 1 - dist / maxLen;
    if (dist <= 2 && similarity >= 0.75) {
      return `Similar name (${Math.round(similarity * 100)}% match)`;
    }
  }

  return null;
}

/**
 * Find potential duplicate customers for a candidate record.
 * `excludeCustomerId` should be passed when editing an existing customer.
 */
export function findPotentialDuplicates<T extends DedupCustomer>(
  customers: T[],
  candidate: { name?: string; phone?: string; email?: string },
  excludeCustomerId?: string,
): DuplicateMatch<T>[] {
  const candName = normalizeName(candidate.name);
  const candEmail = normalizeEmail(candidate.email);
  const candPhoneKeys = phoneMatchKeys(candidate.phone);

  if (!candName && !candEmail && candPhoneKeys.length === 0) {
    return [];
  }

  const matches: DuplicateMatch<T>[] = [];

  for (const cust of customers) {
    if (!cust || (excludeCustomerId && cust.id === excludeCustomerId)) continue;

    // 1. Exact / normalized phone match
    if (candPhoneKeys.length > 0) {
      const custPhoneKeys = phoneMatchKeys(cust.phone);
      const phoneMatched = custPhoneKeys.some((k) => candPhoneKeys.includes(k));
      if (phoneMatched) {
        matches.push({
          customer: cust,
          matchType: 'phone',
          confidence: 'exact',
          reason: `Matching phone number (${cust.phone})`,
        });
        continue;
      }
    }

    // 2. Exact normalized email match
    if (candEmail) {
      const custEmail = normalizeEmail(cust.email);
      if (custEmail && custEmail === candEmail) {
        matches.push({
          customer: cust,
          matchType: 'email',
          confidence: 'exact',
          reason: `Matching email (${cust.email})`,
        });
        continue;
      }
    }

    // 3. Exact normalized name match
    const custName = normalizeName(cust.name);
    if (candName && custName && candName === custName) {
      matches.push({
        customer: cust,
        matchType: 'name',
        confidence: 'exact',
        reason: 'Exact same customer name',
      });
      continue;
    }

    // 4. Fuzzy name match
    if (candName && custName) {
      const fuzzyReason = isFuzzyNameMatch(candName, custName);
      if (fuzzyReason) {
        matches.push({
          customer: cust,
          matchType: 'fuzzy_name',
          confidence: 'possible',
          reason: fuzzyReason,
        });
      }
    }
  }

  return matches.sort((a, b) => {
    if (a.confidence === b.confidence) return 0;
    return a.confidence === 'exact' ? -1 : 1;
  });
}
