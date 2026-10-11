/**
 * Pure, reusable guards for the Data Import Wizard's bulk-import handlers.
 *
 * Extracted so the dedup rules live in ONE place (shared by the React
 * AppContext handlers) and can be regression-tested in Node without a DOM —
 * the same pattern as `src/shared/customerLedger.ts`. Importing the same CSV
 * twice must update in place, never duplicate financial or contact records.
 */

import type { Customer, Sale, Supplier } from '../types';

/** Normalise a comparison key: trim + case-fold. */
export const importKey = (value: string | undefined | null): string =>
  (value || '').trim().toLowerCase();

/**
 * Customer dedup: a phone match always wins; otherwise a name match (when the
 * incoming row has no phone) prevents duplicates. Returns the index of the
 * existing customer, or -1 when the row is new.
 */
export function findExistingCustomerIndex(
  list: Customer[],
  incoming: { name?: string; phone?: string },
): number {
  const phone = (incoming.phone || '').trim();
  const nameKey = importKey(incoming.name);
  return list.findIndex((c) => {
    const cPhone = (c.phone || '').trim();
    if (phone && cPhone && cPhone === phone) return true;
    if (!phone && nameKey && importKey(c.name) === nameKey) return true;
    return false;
  });
}

/** Supplier dedup: same rule as customers (phone, else name). */
export function findExistingSupplierIndex(
  list: Supplier[],
  incoming: { name?: string; phone?: string },
): number {
  const phone = (incoming.phone || '').trim();
  const nameKey = importKey(incoming.name);
  return list.findIndex((s) => {
    const sPhone = (s.phone || '').trim();
    if (phone && sPhone && sPhone === phone) return true;
    if (!phone && nameKey && importKey(s.name) === nameKey) return true;
    return false;
  });
}

/**
 * Sales dedup: the invoice number is the natural key. A non-empty, non-'N/A'
 * invoice that already exists is a duplicate and must be skipped so re-running
 * an import never doubles revenue or delivery expenses.
 */
export function isDuplicateSaleInvoice(list: Sale[], invoiceNo: string | undefined | null): boolean {
  const key = importKey(invoiceNo);
  if (!key || key === 'n/a') return false;
  return list.some((s) => importKey(s.invoiceNo) === key);
}

/**
 * RFC-4180 style field parser (the single implementation used by the Import
 * wizard). Only the double quote is a quote character; `""` is an escaped
 * literal quote. Quotes are stripped, embedded delimiters never split a field,
 * and apostrophes are ordinary characters. Extracted here so the parsing
 * contract is testable.
 */
export function parseDelimitedLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/** Detect the delimiter for a header line: tab when present, else comma. */
export function detectDelimiter(headerLine: string): ',' | '\t' {
  return headerLine.includes('\t') && !headerLine.includes(',') ? '\t' : ',';
}
