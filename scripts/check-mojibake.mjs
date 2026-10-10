import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/d1_storage.db', { readOnly: true });
const tables = db.prepare("select name from sqlite_master where type='table'").all();
// Mojibake signature: UTF-8 bytes decoded as Latin-1/Windows-1252.
const re = /[\u00C0-\u00C5\u00C8-\u00CF\u00D2-\u00D5\u00D9-\u00DD\u00E0-\u00E5\u00E8-\u00EF\u00F2-\u00F5\u00F9-\u00FD\u0152\u0153\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/;
let hits = 0;
for (const t of tables) {
  const cols = db.prepare(`pragma table_info("${t.name}")`).all();
  let rows;
  try { rows = db.prepare(`select * from "${t.name}" limit 500`).all(); } catch { continue; }
  for (const r of rows) {
    for (const c of cols) {
      const v = r[c.name];
      if (typeof v === 'string' && re.test(v)) {
        hits++;
        if (hits <= 25) console.log(`${t.name}.${c.name} => ${JSON.stringify(v.slice(0, 100))}`);
      }
    }
  }
}
console.log('TOTAL HITS:', hits);
