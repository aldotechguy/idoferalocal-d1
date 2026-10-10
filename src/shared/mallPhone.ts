export function normalizeMallPhone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 32) return null;
  const digits = value.trim().replace(/[ ()-]/g, '');
  const normalized = /^0[789][01]\d{8}$/.test(digits) ? `+234${digits.slice(1)}` :
    /^234[789][01]\d{8}$/.test(digits) ? `+${digits}` : digits;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

/** SQL equivalent for historical data. Invalid legacy numbers are deliberately not matched. */
export function normalizedPhoneSql(column: string) {
  const clean = `REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(${column},'')),' ',''),'-',''),'(',''),')','')`;
  const mobile = `SUBSTR(${clean},2)`;
  return `CASE
    WHEN LENGTH(${clean}) = 11 AND ${clean} GLOB '0[789][01]*' AND ${clean} NOT GLOB '*[^0-9]*' THEN '+234' || ${mobile}
    WHEN LENGTH(${clean}) = 13 AND ${clean} GLOB '234[789][01]*' AND ${clean} NOT GLOB '*[^0-9]*' THEN '+' || ${clean}
    WHEN LENGTH(${clean}) BETWEEN 9 AND 16 AND ${clean} GLOB '+[1-9]*' AND SUBSTR(${clean},2) NOT GLOB '*[^0-9]*' THEN ${clean}
    ELSE NULL END`;
}