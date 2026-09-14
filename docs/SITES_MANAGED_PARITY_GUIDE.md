# Sites-managed parity guide

Last audited: 2026-08-30

## Purpose

This document records the behavior adopted in the `sites-managed` application and the exact work required for GitHub `main` to behave like the currently deployed app.

Audit references:

- Current GitHub `main`: `8daaaa835ae815d32f7ea4ec0fcba4ccdfdf863b`
- Current GitHub `sites-managed`: `65c0c00ad7ddf27258c77cd757dc12b8f26ad642`
- Common ancestor: `9e03cd6cd59753392f84757a8481cdef7fcf7e2f`
- Deployed app: <https://idofera.awaknsikak.chatgpt.site/>
- Sites project: `appgprj_6a90a30a0e108191b4ed2e440401f6dd`

The branches are **diverged**. `main` has two main-only commits and `sites-managed` has two snapshot commits after their common ancestor. The code comparison contains 45 changed paths, approximately 8,101 additions and 1,253 deletions. A normal feature-by-feature cherry-pick is not an exact or low-risk route to parity.

## Adopted behavior

### 1. Sites hosting and Worker runtime

- The Vite app is packaged for Sites with `@openai/sites-vite-plugin`.
- `.openai/hosting.json` binds the application to the existing Sites project and logical D1 binding `DB`.
- `sites-worker.ts` is the Cloudflare Worker-compatible server entry point.
- The build compiles the client and Worker, then `scripts/finalize-worker.mjs` places the Worker at `dist/server/index.js`.
- SPA navigation falls back correctly to `index.html` instead of returning HTML for JavaScript assets.
- The service worker caches only valid same-origin assets and avoids caching bad HTML fallbacks as modules.
- The PWA manifest requests portrait orientation.
- Social preview metadata and `public/og.png` were added.

### 2. D1 durable business storage

- D1 is the authoritative shared business-data store; IndexedDB remains the device-local/offline cache.
- The following collections are stored as owner-scoped JSON documents: products, customers, suppliers, sales, purchases, expenses, notifications, audit logs, stock movements, pricing history, settings, held orders, WhatsApp pre-orders, and delivery orders.
- `app_documents` uses `(owner_id, collection, document_id)` as its primary key.
- `sync_revisions` supplies optimistic concurrency and conflict detection.
- Existing owner-scoped data is migrated into the canonical `idofera-business` owner when first accessed.
- A successful login/session startup reads D1 and merges it with pending local device changes.
- Remote data never silently overwrites explicitly unsynced local records.

### 3. The three approved synchronization flows

1. **Restore from Drive** downloads the latest Drive backup and replaces D1 only. It does not overwrite the device's current local business records.
2. **Sync Now** sends only changed local records and recorded deletions to D1. It does not replace unrelated D1 records.
3. **Upload to Drive** reads the current authoritative D1 revision and creates a new Google Drive backup.

Additional sync behavior:

- Inspect Changes displays locally pending record identities.
- Sync bookkeeping tracks individual `collection:id` keys.
- The header Sync Now action shows the number of pending records.
- The header action remains inactive until 20 pending records have accumulated; the settings-area action remains available for manual synchronization.
- Restore uses revision conflict checks and retries rather than blindly overwriting a newer D1 revision.
- Google Drive authorization tries Firebase Google authentication and then Google Identity Services when required.
- Drive controls are arranged with Sync Now above Inspect Changes on the left, and Upload to Drive above Restore from Drive on the right.

### 4. Server-backed application authentication

- Initial ChatGPT authentication is not the application login mechanism.
- Username/email and password login is verified on the Worker against D1.
- Google login verifies the Google access token server-side and accepts only active, registered email addresses.
- Sessions use an opaque token stored as a SHA-256 hash in D1 and an `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
- Sessions last seven days unless logged out or revoked.
- PBKDF2-SHA-256 password hashes use 100,000 iterations to stay within the deployed runtime limit.
- User creation, user updates, password changes, administrative resets, protected-account deletion rules, and session invalidation are enforced server-side.
- Duplicate local user records are deduplicated by canonical user ID, including the protected Super Admin account.
- The Worker currently seeds two initial administrative accounts when the auth tables are empty. Their bootstrap passwords are present in source and must be rotated; they are intentionally not reproduced in this document.

### 5. Browser storage and offline safety

- Large business collections are no longer duplicated into `localStorage`.
- IndexedDB holds the local business cache; `localStorage` is limited to small preferences, auth-adjacent state, and unsynced key bookkeeping.
- Legacy large `idofera_*` collection keys are removed after migration.
- Quota failures are caught and trigger safe legacy-cache cleanup instead of crashing React.
- This fixes the blank screen previously caused by `QuotaExceededError` while completing a sale.
- A Super Admin can safely reset local business records without syncing those discarded records to D1.

### 6. Point of Sale

- On narrow screens, the Register is placed above the Catalogue.
- Catalogue items are ranked by historical sales frequency.
- Catalogue items already in the Register are highlighted.
- Clicking a selected catalogue item again removes it from the Register.
- Mobile Transfer is the default payment method.
- Historical Sales and Collect Delivery Fee were moved into More Settings to preserve screen space.
- Register customer search filters by customer name or phone number and retains the original, stable search/select workflow.
- Completing a sale no longer blanks the screen when a receipt cannot render.
- The installed PWA requests portrait orientation. Browser tabs may still follow the device/browser's own orientation policy.

### 7. Sales records and invoices

- Sales and other record lists use automatic LIFO/newest-first ordering, including after filters are applied.
- Calendar-view sale cards use responsive **View Receipt** and **More Actions** controls on all viewports.
- Editing an invoice preserves the original transaction timestamp unless the timestamp field is deliberately changed.
- The calendar record action layout no longer overflows.
- Receipt printing uses an isolated printable document instead of printing the surrounding screen.
- Receipt numeric rendering is defensive so malformed or missing amounts cannot blank the POS.

### 8. Super Admin Invoice Workshop

- Invoice Workshop is visible only to the Super Admin from Sales Records.
- It makes a temporary, print-only copy of an existing invoice.
- Item quantities and unit prices can be changed without altering sales, inventory, customers, IndexedDB records, D1, or the sync queue.
- The workshop invoice preserves the original transaction-invoice appearance but omits the disclaimer, server/staff footer, and customer debt statement.
- Amount Paid automatically follows the adjusted workshop total by default.
- Automatic matching can be disabled for manual Amount Paid entry.
- Preview/print is blocked when the manual amount is below the adjusted total, so a workshop invoice cannot show new debt.

### 9. Purchasing and Purchase Orders

- Only the Super Admin can open the Purchase Order editor.
- Editable fields include PO number, supplier, expected delivery, supplier logistics, local logistics, and notes.
- PO edits cascade to linked receiving history, stock movement references, logistics expenses, supplier/payable details, invoice values, and GRN values.
- Local logistics changes are proportionally distributed across existing linked receiving and expense records.

### 10. GRN behavior and printing

- Print GRN prints an isolated GRN document instead of the application screen.
- Printable GRNs use the reference layout with 8 mm margins and content constrained to the printable page.
- V1 Full GRN and V2 Ex-Local GRN share the approved visual styling.
- Shortage is calculated as `max(0, Ordered - Received - Damaged)`.
- Excess is calculated as `max(0, Received - Ordered)`.
- The original accepted-value/supplier-balance calculation was restored after the experimental formula proved incorrect.
- V2 Ex-Local intentionally omits the Balance Remaining detail.
- V1 retains the supplier balance detail.

### 11. Expenses, archive, and record lists

- Expense logging includes an explicit date picker with timezone-safe local-date defaults.
- The Unarchive path was corrected so archived products can be restored to Active.
- Products, archive, customers, suppliers, sales, purchases, expenses, notifications, audit logs, stock movements, pricing history, held orders, WhatsApp pre-orders, and delivery orders are exposed newest-first.

### 12. Responsive visual refresh

- The application shell, header, sidebar, cards, tables, modals, controls, and print surfaces received a responsive refresh while retaining existing workflows.
- The dark theme uses deeper surfaces and improved contrast.
- Golden/amber accents replace the previous predominantly blue/indigo identity while preserving semantic success, warning, and error colors.
- Dense action groups adapt across phone, tablet, laptop, and wide desktop layouts.

## Exact source differences that `main` must adopt

The following source paths differ between current `main` and the deployed Sites-managed tree.

### Hosting, schema, build, and PWA

- `.gitignore`
- `.openai/hosting.json` (new)
- `assets/.aistudio/.gitignore` (removed)
- `db/schema.ts` (new)
- `drizzle.config.ts` (new)
- `drizzle/0000_d1_storage.sql` (new)
- `drizzle/0001_app_auth.sql` (new)
- `index.html`
- `package-lock.json` (new and authoritative for the Sites build)
- `package.json`
- `public/manifest.json`
- `public/og.png` (new)
- `public/sw.js`
- `scripts/finalize-worker.mjs` (new)
- `sites-worker.ts` (new)
- `vite.config.ts`

### Application code

- `src/App.tsx`
- `src/components/auth/LoginView.tsx`
- `src/components/common/GoogleDriveAuthModal.tsx` (removed)
- `src/components/common/Header.tsx`
- `src/components/common/ReceiptModal.tsx`
- `src/components/common/Sidebar.tsx`
- `src/components/common/UnsyncedChangesModal.tsx`
- `src/components/expenses/ExpensesView.tsx`
- `src/components/inventory/InventoryView.tsx`
- `src/components/pos/PosView.tsx`
- `src/components/products/ArchiveView.tsx`
- `src/components/products/ProductsView.tsx`
- `src/components/purchases/GRNModal.tsx`
- `src/components/purchases/PriceAdjustmentReportModal.tsx`
- `src/components/purchases/PurchasesView.tsx`
- `src/components/sales/InvoiceWorkshopModal.tsx` (new)
- `src/components/sales/SalesView.tsx`
- `src/components/settings/SettingsView.tsx`
- `src/context/AppContext.tsx`
- `src/context/AuthContext.tsx`
- `src/db/indexedDB.ts`
- `src/firebase/config.ts`
- `src/firebase/services.ts`
- `src/hooks/useCloudSync.ts`
- `src/index.css`
- `src/services/d1StorageService.ts` (new)
- `src/services/googleDriveService.ts`
- `src/types/index.ts`
- `src/utils/localStorage.ts` (new)

## Required main-branch cutover

### Recommended: promote the complete tree

To make `main` function **exactly** like the current application, make a new commit whose parent is the current `main` commit but whose entire tree equals `sites-managed`. This retains main's history while avoiding an uncertain conflict-resolution result.

Prerequisites:

1. Freeze writes to both branches during the cutover.
2. Require a clean working tree.
3. Create a backup tag or branch at the pre-cutover `main` SHA.
4. Confirm `sites-managed` is at the audited/deployed revision.

One safe local Git procedure is:

```bash
git fetch origin main sites-managed
git switch main
git pull --ff-only origin main
git branch backup/main-before-sites-parity
git read-tree --reset -u origin/sites-managed
git commit -m "Promote Sites-managed application to main"
npm ci
npm run build
git diff --exit-code HEAD^{tree} origin/sites-managed^{tree}
git push origin main
```

Important: `git read-tree --reset -u` intentionally makes the tracked `main` tree exactly match `sites-managed`. Do not run it with uncommitted work. The backup branch is the rollback point.

Do not use a simple merge and assume it is equivalent. Both branches changed Google Drive and GRN code independently after the common ancestor. A merge may compile while preserving the wrong side of a conflict and therefore fail behavioral parity.

### Infrastructure and data requirements

Source parity alone is insufficient. The deployed result must also have:

1. The same Sites project or an equivalent project with a D1 binding named `DB`.
2. Both D1 migrations applied in order.
3. Existing production D1 data retained, or a verified D1 export/import if moving to another project.
4. The server Worker deployed with the static assets—not a static-only Vite deployment.
5. HTTPS and cookie support for the secure application session.
6. Firebase configuration retained for Google OAuth/Drive authorization.
7. The production hostname added to Firebase Authorized Domains and the Google OAuth client's authorized origins.
8. Google Drive API access and the dedicated backup folder accessible to the signing-in Google account.
9. `GEMINI_API_KEY` configured if the AI assistant is expected to operate.
10. `VITE_GOOGLE_DRIVE_API_KEY` configured only if the optional API-key fallback is required.
11. Bootstrap administrator passwords rotated and existing sessions reviewed after cutover.

If deployment remains in the current Sites project, keep `.openai/hosting.json` unchanged so the existing D1 data and URL remain associated with the app. If `main` will be deployed elsewhere, do not copy the project ID blindly; provision equivalent storage, migrate D1, configure secrets, and update hosting metadata for the new environment.

## Acceptance checklist

### Build and hosting

- [ ] `npm ci` completes from the committed lockfile.
- [ ] `npm run build` produces `dist/server/index.js` and static assets.
- [ ] Direct navigation to a nested SPA route returns the app.
- [ ] JavaScript assets return JavaScript MIME types, never `text/html`.
- [ ] D1 migrations are present in the deployment artifact.

### Authentication

- [ ] Username and email login both work without initial ChatGPT sign-in.
- [ ] Session survives reload and logout invalidates it.
- [ ] Duplicate Super Admin records do not appear.
- [ ] User administration and password reset permissions are enforced server-side.

### Storage and synchronization

- [ ] Login/reload reads D1 without overwriting unsynced local changes.
- [ ] Sync Now patches only pending records and deletions.
- [ ] Restore from Drive changes D1 only.
- [ ] Upload to Drive exports the current D1 revision.
- [ ] Header pending count and 20-record activation threshold behave correctly.
- [ ] A large sales history does not recreate `idofera_sales` in `localStorage` or cause a quota crash.

### Business workflows

- [ ] Complete Sale succeeds and the receipt opens without a blank screen.
- [ ] POS narrow-screen ordering, catalogue frequency ranking, item toggle, customer search, and Mobile Transfer default work.
- [ ] Sales lists and filtered results remain LIFO.
- [ ] Edit Invoice preserves the original time unless deliberately changed.
- [ ] Invoice Workshop is Super Admin-only, print-only, paid in full, and omits footer/debt elements.
- [ ] Super Admin PO edits cascade to linked records.
- [ ] V1/V2 GRNs print with 8 mm margins, shortage/excess columns, correct balance behavior, and no V2 balance detail.
- [ ] Expense date picker and Unarchive work.
- [ ] View Receipt and More Actions work across viewport sizes.

## Rollback

If acceptance fails:

1. Stop further deployments and data migrations.
2. Restore `main` from `backup/main-before-sites-parity` with a normal revert or a new tree-restoration commit.
3. Do not roll D1 backward unless the cutover changed its schema or data.
4. Restore D1 only from a verified pre-cutover backup and record the revision used.

The current `sites-managed` branch remains the authoritative parity reference until the cutover is accepted and a new branch policy is declared.

