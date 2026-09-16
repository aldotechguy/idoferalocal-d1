/**
 * Phase 4 — verify Cloudflare REST credentials work (READ-ONLY, safe to run anytime).
 * Checks the token is present and can query the relational `idofera` database.
 * Run: npx tsx scripts/check-rest-auth.ts
 */
import dotenv from 'dotenv';
dotenv.config();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '35b307711376954341708cbea8080dcc';
const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID_TARGET || '3a3eb157-5aa5-419a-a8ce-2eade2afc436';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

console.log(`account ${ACCOUNT_ID.slice(0, 6)}... | database ${DATABASE_ID.slice(0, 8)}... | token ${API_TOKEN ? `present (length ${API_TOKEN.length})` : 'MISSING'}`);
if (!API_TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN is not set (looked in .env and environment).');
  process.exit(1);
}

const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sql: `SELECT
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM sales) AS sales,
      (SELECT COUNT(*) FROM customers) AS customers,
      (SELECT COALESCE(SUM(total_kobo), 0) FROM sales) AS sales_total_kobo`,
  }),
});
const data: any = await res.json();
if (!res.ok || !data.success) {
  console.error(`AUTH/QUERY FAILED (HTTP ${res.status}):`, JSON.stringify(data.errors || data, null, 1).slice(0, 400));
  process.exit(1);
}
const row = data.result?.[0]?.results?.[0] || {};
console.log(`REST OK -> products=${row.products} sales=${row.sales} customers=${row.customers} sales_total_kobo=${row.sales_total_kobo}`);
console.log('TOKEN VERIFIED (read-only query succeeded)');