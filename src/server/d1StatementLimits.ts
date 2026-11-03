/**
 * D1 statement limits, applied to mapper output.
 *
 * D1 allows 100 bound parameters and 100 KB of SQL PER STATEMENT, and 2 MB per
 * row (https://developers.cloudflare.com/d1/platform/limits/). The mapper builds
 * one INSERT from every column of a row, so a wide header — migrations keep
 * ADDing columns to the live tables while an older bundle is still deployed —
 * or a long text column fails the whole PATCH with "too many SQL variables".
 * A wide row is therefore written as its first 100 columns plus follow-up
 * UPDATEs keyed by the row's primary key, and an over-long value is truncated
 * so one record cannot take the whole batch down.
 */
export const D1_MAX_VARS_PER_STMT = 100;
export const D1_MAX_SQL_CHARS_PER_STMT = 100_000;
export const D1_MAX_PARAM_CHARS = 1_000_000;

export type SqlStmt = { sql: string; params?: any[] };

export function capParam(value: any): any {
  return typeof value === 'string' && value.length > D1_MAX_PARAM_CHARS
    ? value.slice(0, D1_MAX_PARAM_CHARS)
    : value;
}

const splitColumns = (list: string) =>
  list.split(',').map((c) => c.trim()).filter(Boolean);

/**
 * Split one INSERT into slices of at most `D1_MAX_VARS_PER_STMT` parameters.
 * The first slice keeps the INSERT (and its ON CONFLICT clause); later slices
 * are UPDATEs on the primary key so the row is upserted once, not duplicated.
 */
export function chunkStatement(st: SqlStmt): { sql: string; params: any[] }[] {
  const sql = String(st.sql);
  const params = Array.isArray(st.params) ? st.params : [];
  if (params.length <= D1_MAX_VARS_PER_STMT) return [{ sql, params: params.map(capParam) }];
  const columns = splitColumns(/^\s*INSERT\s+INTO\s+[^(]+\(([^)]*)\)/i.exec(sql)?.[1] ?? '');
  const conflicts = /ON\s+CONFLICT\s*\(([^)]*)\)/i.exec(sql)?.[1];
  const valuesAt = sql.search(/\bVALUES\s*\(/i);
  if (!columns.length || columns.length !== params.length || !conflicts || valuesAt < 0) {
    // Not a shape we can slice safely: leave it to D1 so the error surfaces
    // exactly as it would have before.
    return [{ sql, params: params.map(capParam) }];
  }
  const tail = sql.slice(valuesAt).replace(/^\s*VALUES\s*\([^)]*\)/i, '');
  const head = sql.slice(0, valuesAt);
  const table = /^\s*INSERT\s+INTO\s+([^\s(]+)/i.exec(sql)?.[1] ?? '';
  const keys = splitColumns(conflicts);
  const keyRows = keys.map((k) => ({ column: k, param: params[columns.indexOf(k)] }));
  const chunks: { sql: string; params: any[] }[] = [];
  for (let start = 0; start < params.length; start += D1_MAX_VARS_PER_STMT) {
    const cols = columns.slice(start, start + D1_MAX_VARS_PER_STMT);
    const row = params.slice(start, start + D1_MAX_VARS_PER_STMT);
    if (start === 0) {
      // Narrow the column list to this slice; it closes right before VALUES.
      const slicedHead = head.replace(/\([^(]*\)\s*$/, `(${cols.join(', ')})`);
      chunks.push({ sql: `${slicedHead}VALUES (${cols.map(() => '?').join(', ')})${tail}`, params: row.map(capParam) });
      continue;
    }
    // Only real table columns can be updated, and never the primary key.
    const sets = cols.filter((c) => !keys.includes(c));
    if (!sets.length) continue;
    const setParams = sets.map((c) => params[start + cols.indexOf(c)]);
    const where = keyRows.map((k) => `${k.column} = ?`).join(' AND ');
    chunks.push({
      sql: `UPDATE ${table} SET ${sets.map((c) => `${c} = ?`).join(', ')} WHERE ${where}`,
      params: [...setParams.map(capParam), ...keyRows.map((k) => capParam(k.param))],
    });
  }
  return chunks;
}

/** Chunk a mapper batch; throws (instead of a D1 500) on an over-long statement. */
export function chunkStatements(stmts: SqlStmt[]): { sql: string; params: any[] }[] {
  const chunks: { sql: string; params: any[] }[] = [];
  for (const st of stmts) {
    for (const chunk of chunkStatement(st)) {
      if (chunk.sql.length > D1_MAX_SQL_CHARS_PER_STMT) {
        throw new Error(`A sync statement is ${chunk.sql.length} bytes; D1 allows ${D1_MAX_SQL_CHARS_PER_STMT} per statement.`);
      }
      chunks.push(chunk);
    }
  }
  return chunks;
}
