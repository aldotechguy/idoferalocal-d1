import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  D1_MAX_PARAM_CHARS,
  D1_MAX_VARS_PER_STMT,
  capParam,
  chunkStatement,
  chunkStatements,
} from '../src/server/d1StatementLimits.ts';

const insert = (columns: string[], table = 'wide') =>
  `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET c0=excluded.c0`;

test('chunkStatement leaves a normal row untouched', () => {
  const st = { sql: 'INSERT INTO t (id, name) VALUES (?, ?)', params: ['a', 'Ada'] };
  assert.deepEqual(chunkStatement(st), [st]);
});

test('chunkStatement splits a wide INSERT so every statement stays under the D1 variable cap', () => {
  const columns = ['id', ...Array.from({ length: 136 }, (_, i) => `c${i}`)];
  const params = columns.map((c) => `value-${c}`);
  const chunks = chunkStatement({ sql: insert(columns), params });
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) assert.ok(chunk.params.length <= D1_MAX_VARS_PER_STMT);
  // Every value travels exactly once; the key is re-sent for each UPDATE.
  assert.equal(chunks[0].params.length, 100);
  assert.deepEqual(chunks[0].params, params.slice(0, 100));
  assert.equal(chunks[1].params.length, 38, '37 columns + the key parameter');
  assert.deepEqual(chunks[1].params, [...params.slice(100), 'value-id']);
  // The first slice is the INSERT and keeps its conflict clause; the rest are
  // keyed UPDATEs so the wide row is upserted once, never duplicated.
  assert.match(chunks[0].sql, /^INSERT INTO wide \(id, c0,/);
  assert.match(chunks[0].sql, /ON CONFLICT\(id\)/);
  assert.match(chunks[1].sql, /^UPDATE wide SET c99 = \?, c100 = \?,/);
  assert.doesNotMatch(chunks[1].sql, /\bc0\b/);
  assert.match(chunks[1].sql, /WHERE id = \?$/);
  assert.equal(chunks[1].params.at(-1), 'value-id');
});

test('chunkStatements caps an over-long value at the D1 row limit', () => {
  const huge = 'x'.repeat(D1_MAX_PARAM_CHARS + 10);
  const [chunk] = chunkStatements([{ sql: 'INSERT INTO t (id, body) VALUES (?, ?)', params: ['a', huge] }]);
  assert.equal((chunk.params[1] as string).length, D1_MAX_PARAM_CHARS);
  assert.equal(capParam(42), 42);
});

test('a split wide record still writes as ONE logical row on SQLite', () => {
  const columns = ['id', ...Array.from({ length: 139 }, (_, i) => `c${i}`)];
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE wide (${columns.map((c, i) => `${c} TEXT${i === 0 ? ' PRIMARY KEY' : ''}`).join(', ')})`);
    const params = columns.map((c) => `value-${c}`);
    for (const chunk of chunkStatement({ sql: insert(columns), params })) {
      db.prepare(chunk.sql).run(...chunk.params);
    }
    const row = db.prepare('SELECT * FROM wide').get() as Record<string, string>;
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wide').get()?.n, 1, 'the wide row is written once');
    columns.forEach((c) => assert.equal(row[c], `value-${c}`, `${c} did not land`));
  } finally { db.close(); }
});

test('the records PATCH writes through the chunking layer, not raw prepare', () => {
  const worker = fs.readFileSync('sites-worker.ts', 'utf8');
  const patch = worker.slice(worker.indexOf('async function patchRecords'), worker.indexOf('function aiDenied'));
  assert.match(patch, /await writeStatements\(env, relationalStmts\)/);
  assert.doesNotMatch(patch, /toD1Statements/);
  // The worker error path must surface the real D1 message, not only a status.
  assert.match(patch, /relationalError/);
});
