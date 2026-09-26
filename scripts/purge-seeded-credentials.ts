/**
 * Remove seeded credentials and session tokens from the committed SQL dumps.
 *
 * `drizzle/full_migration.sql` and `drizzle/migration_dump.sql` contained the
 * default-seeded `app_users` rows (known password hashes) and 15 live
 * `app_sessions` tokens. Those tokens were valid session credentials for the
 * deployed database: anyone with the file could present one as an
 * `idofera_session` cookie and be authenticated without a password.
 *
 * This strips the DATA rows and keeps the DDL, so the dumps still recreate an
 * empty, correctly-shaped auth schema. It does NOT fix the deployed database —
 * the rows already live in D1, and only a rotation there can revoke them.
 *
 * Dry-run by default. Run with --apply, then review the diff.
 *
 *   npx tsx scripts/purge-seeded-credentials.ts
 *   npx tsx scripts/purge-seeded-credentials.ts --apply
 */
import fs from 'node:fs';

const TARGETS = ['drizzle/full_migration.sql', 'drizzle/migration_dump.sql'];
const apply = process.argv.includes('--apply');

// Only DATA rows are stripped: an INSERT/REPLACE/UPDATE against the auth tables.
// CREATE TABLE / CREATE INDEX statements are DDL and are kept verbatim.
const isAuthDataRow = (line: string) =>
  /^\s*(INSERT|REPLACE|UPDATE)\b/i.test(line) && /\b(app_users|app_sessions)\b/i.test(line);

let totalRemoved = 0;
let failed = false;

for (const file of TARGETS) {
  if (!fs.existsSync(file)) {
    console.log(`${file}: (missing, skipped)`);
    continue;
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const kept: string[] = [];
  const removed: string[] = [];

  for (const line of lines) {
    if (isAuthDataRow(line)) removed.push(line);
    else kept.push(line);
  }

  const users = removed.filter((l) => /\bapp_users\b/i.test(l)).length;
  const sessions = removed.filter((l) => /\bapp_sessions\b/i.test(l)).length;
  console.log(`${file}: remove ${removed.length} auth row(s) -> ${users} app_users, ${sessions} app_sessions`);

  if (removed.length === 0) continue;

  if (apply) {
    // Collapse a run of removed lines into a single explanatory comment so the
    // dump does not silently appear truncated.
    const out: string[] = [];
    let runOpen = false;
    for (const line of lines) {
      if (isAuthDataRow(line)) {
        if (!runOpen) {
          out.push('-- Seeded app_users/app_sessions rows REMOVED: they contained known');
          out.push('-- default password hashes and live session tokens. Provision accounts via');
          out.push('-- BOOTSTRAP_ADMIN_* / scripts/provision-admin.ts instead. See');
          out.push('-- docs/mall-launch-safety.md.');
          runOpen = true;
        }
        continue;
      }
      runOpen = false;
      out.push(line);
    }
    fs.writeFileSync(file, out.join('\n'));
  }
  totalRemoved += removed.length;
}

if (failed) process.exit(1);
if (!apply) {
  console.log(`\nDRY RUN — ${totalRemoved} row(s) would be removed. Re-run with --apply.`);
} else {
  console.log(`\nApplied — ${totalRemoved} row(s) removed from the dumps.`);
  console.log('Next: the DEPLOYED database still holds these rows. Rotate there too.');
}

// Verify no known-compromised material survives in either dump.
const KNOWN_HASHES = [
  '36d3d6c39b4d14b9b92fc1aab297ba7e3651a73816e411e50050d37aa5d29224',
  '7ff68f11344b4f18203efec74c0d289f996d27cd95770a15e204fbebb1bc931b',
];
for (const file of TARGETS) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const hash of KNOWN_HASHES) {
    if (text.includes(hash)) {
      console.error(`STILL PRESENT in ${file}: ${hash}`);
      failed = true;
    }
  }
  if (/INSERT\s+(OR\s+REPLACE\s+)?INTO\s+app_sessions/i.test(text)) {
    console.error(`STILL PRESENT in ${file}: an app_sessions INSERT row.`);
    failed = true;
  }
}
if (!failed && apply) console.log('Verified: no seeded hashes and no session rows remain in the dumps.');