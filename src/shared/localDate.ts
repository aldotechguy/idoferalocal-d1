/**
 * Calendar date key (YYYY-MM-DD) in the reader's LOCAL timezone.
 *
 * `Date#toISOString()` renders UTC, and every business day filter compares
 * `sale.createdAt.startsWith(dateKey)` against a UTC ISO timestamp. Nigeria
 * runs UTC+1, so a sale taken between midnight and 1AM WAT carries the
 * previous UTC date in its createdAt and silently drops out of "Today's
 * Sales" when the key is built with toISOString(). Build day keys from the
 * local calendar instead.
 */
export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
