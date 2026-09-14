import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '35b307711376954341708cbea8080dcc';
const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID || '3e95a550-a091-490b-819d-f0acb7ea8dd8';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!API_TOKEN) {
  console.error('Error: CLOUDFLARE_API_TOKEN is not set in environment or .env');
  process.exit(1);
}

const DB_PATH = path.join(process.cwd(), 'data', 'd1_storage.db');
if (!fs.existsSync(DB_PATH)) {
  console.error(`Error: Local SQLite DB not found at ${DB_PATH}`);
  process.exit(1);
}

const localDb = new DatabaseSync(DB_PATH);

async function executeD1Statements(statements: { sql: string; params?: any[] }[]) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
  
  for (let i = 0; i < statements.length; i += 25) {
    const batch = statements.slice(i, i + 25);
    for (const stmt of batch) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: stmt.sql,
          params: stmt.params || [],
        }),
      });

      const data = await res.json() as any;
      if (!res.ok || !data.success) {
        console.error(`Failed executing SQL: ${stmt.sql.slice(0, 100)}...`, JSON.stringify(data));
        throw new Error(`D1 Execution error: ${JSON.stringify(data.errors || data)}`);
      }
    }
  }
}

async function pushDatabaseToD1() {
  console.log(`\n======================================================`);
  console.log(` Pushing Database to Cloudflare D1`);
  console.log(` Account:  ${ACCOUNT_ID}`);
  console.log(` Database: ${DATABASE_ID}`);
  console.log(`======================================================\n`);

  // Step 1: Check existing tables and update schema
  console.log('Step 1: Preparing schema and tables on Cloudflare D1...');

  // Ensure table migration if legacy structure exists
  const migrationStatements = [
    { sql: `DROP TABLE IF EXISTS app_storage;` },
    { sql: `DROP TABLE IF EXISTS app_sessions;` },
    { sql: `DROP TABLE IF EXISTS app_users;` },
    {
      sql: `CREATE TABLE IF NOT EXISTS app_documents (
        owner_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        document_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, collection, document_id)
      );`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_app_documents_owner_collection ON app_documents (owner_id, collection);`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS sync_revisions (
        owner_id TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL UNIQUE,
        username TEXT UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Active',
        avatar_url TEXT,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_iterations INTEGER NOT NULL DEFAULT 100000,
        is_super_admin INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_login TEXT,
        password_last_changed TEXT
      );`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_app_users_login ON app_users (email, username, status);`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS app_sessions (
        token_hash TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_app_sessions_user_expiry ON app_sessions (user_id, expires_at);`
    },
  ];

  await executeD1Statements(migrationStatements);
  console.log('✓ Tables and indexes successfully established on Cloudflare D1.');

  // Step 2: Push App Users
  const users = localDb.prepare('SELECT * FROM app_users').all() as any[];
  console.log(`\nStep 2: Pushing ${users.length} users to Cloudflare D1...`);
  const userStatements = users.map((u) => ({
    sql: `INSERT INTO app_users (
      id, email, username, display_name, role, status, avatar_url, password_hash, password_salt, password_iterations, is_super_admin, is_protected, created_at, last_login, password_last_changed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      username = excluded.username,
      display_name = excluded.display_name,
      role = excluded.role,
      status = excluded.status,
      avatar_url = excluded.avatar_url,
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_iterations = excluded.password_iterations,
      is_super_admin = excluded.is_super_admin,
      is_protected = excluded.is_protected,
      created_at = excluded.created_at,
      last_login = excluded.last_login,
      password_last_changed = excluded.password_last_changed;`,
    params: [
      u.id,
      u.email,
      u.username || null,
      u.display_name,
      u.role || 'Sales Staff',
      u.status || 'Active',
      u.avatar_url || null,
      u.password_hash,
      u.password_salt,
      u.password_iterations || 100000,
      u.is_super_admin ? 1 : 0,
      u.is_protected ? 1 : 0,
      u.created_at,
      u.last_login || null,
      u.password_last_changed || u.created_at,
    ],
  }));
  await executeD1Statements(userStatements);
  console.log(`✓ ${users.length} users successfully synced.`);

  // Step 3: Push Sync Revisions
  const revisions = localDb.prepare('SELECT * FROM sync_revisions').all() as any[];
  console.log(`\nStep 3: Pushing ${revisions.length} sync revision records...`);
  const revStatements = revisions.map((r) => ({
    sql: `INSERT INTO sync_revisions (owner_id, revision, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at;`,
    params: [r.owner_id, r.revision, r.updated_at],
  }));
  if (revStatements.length > 0) {
    await executeD1Statements(revStatements);
  }
  console.log(`✓ Sync revisions initialized.`);

  // Step 4: Push Business Documents
  const docs = localDb.prepare('SELECT * FROM app_documents').all() as any[];
  console.log(`\nStep 4: Pushing ${docs.length} business documents to Cloudflare D1...`);
  
  const docStatements = docs.map((doc) => ({
    sql: `INSERT INTO app_documents (owner_id, collection, document_id, payload, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(owner_id, collection, document_id) DO UPDATE SET
            payload = excluded.payload, updated_at = excluded.updated_at;`,
    params: [doc.owner_id, doc.collection, doc.document_id, doc.payload, doc.updated_at],
  }));

  const batchSize = 50;
  for (let i = 0; i < docStatements.length; i += batchSize) {
    const slice = docStatements.slice(i, i + batchSize);
    await executeD1Statements(slice);
    process.stdout.write(`\rProgress: ${Math.min(i + batchSize, docStatements.length)} / ${docStatements.length} documents uploaded...`);
  }
  console.log(`\n✓ All ${docs.length} documents uploaded to D1 successfully.`);

  // Step 5: Verification
  console.log('\nStep 5: Verifying live data in Cloudflare D1...');
  const verifyUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
  
  const vUsersRes = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: 'SELECT id, email, display_name, role, status FROM app_users;' }),
  });
  const vUsersData = await vUsersRes.json() as any;

  const vDocsRes = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: 'SELECT collection, count(*) as count FROM app_documents GROUP BY collection ORDER BY count DESC;' }),
  });
  const vDocsData = await vDocsRes.json() as any;

  const vTotalRes = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: 'SELECT count(*) as total_documents FROM app_documents;' }),
  });
  const vTotalData = await vTotalRes.json() as any;

  console.log('\n======================================================');
  console.log(' Cloudflare D1 Remote Verification:');
  console.log('======================================================');
  console.log('Total Documents in D1:', vTotalData.result?.[0]?.results?.[0]?.total_documents);
  console.log('\nUsers in D1:');
  console.table(vUsersData.result?.[0]?.results);
  console.log('\nDocuments by Collection in D1:');
  console.table(vDocsData.result?.[0]?.results);
  console.log('======================================================\n');

  console.log('🎉 SUCCESS: Full database successfully pushed to Cloudflare D1!');
}

pushDatabaseToD1().catch((err) => {
  console.error('Error during D1 push:', err);
  process.exit(1);
});
