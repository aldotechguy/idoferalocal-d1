/** Search-only normalization; catalog names and customer input remain unchanged. */
export function normalizeMallSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/(\d)[.,](?=\d)/g, '$1decimal')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/(\d)(\p{L})/gu, '$1 $2').replace(/(\p{L})(\d)/gu, '$1 $2')
    .trim().replace(/\s+/g, ' ');
}

/** One insertion, deletion, substitution, or adjacent transposition. */
export function mallOneTypo(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || /\d/.test(a + b) || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export type MallSearchDocument = { name: string; category_name?: string; brand?: string; description?: string };

export function createMallSearchMatcher(query: string) {
  const normalized = normalizeMallSearch(query);
  const tokens = normalized.split(' ').filter(Boolean);
  const compact = normalized.replace(/ /g, '');
  return (document: MallSearchDocument): number => {
    if (!compact) return 0;
    const fields = [document.name, document.brand, document.category_name, document.description].map(value => normalizeMallSearch(value || ''));
    const words = fields.join(' ').split(' ').filter(Boolean);
    // Numbers must match whole numeric tokens, never a prefix or a typo.
    if (tokens.some(token => /\d/.test(token) && !words.includes(token))) return 0;
    if (fields[0] === normalized) return 100;
    if (fields[0].includes(normalized)) return 90;
    if (fields.some(field => field.includes(normalized))) return 80;
    if (fields.some(field => field.replace(/ /g, '').includes(compact))) return 70;
    const exactToken = (token: string) => words.some(word => /\d/.test(token) ? word === token : word.startsWith(token));
    if (tokens.every(exactToken)) return 60;
    // At most one misspelled word; never fuzzy-match descriptions.
    const catalogWords = fields.slice(0, 3).join(' ').split(' ').filter(Boolean);
    let errors = 0;
    for (const token of tokens) {
      if (exactToken(token)) continue;
      if (++errors > 1 || !catalogWords.some(word => mallOneTypo(token, word))) return 0;
    }
    return errors ? 30 : 0;
  };
}