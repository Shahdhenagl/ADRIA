# Security Setup — Real Auth + Row Level Security

This document explains how to finish closing the most critical security gaps:

- **S1** — every table had an `allow all` RLS policy, so the public anon key could
  read/write/delete **all** data. (Fixed by `db/secure_rls_migration.sql`.)
- **S2 / S3** — admin login was a hardcoded PIN (`1111`) and cashier passwords were
  compared in the browser. (Fixed by moving both to Supabase Auth.)
- **S4** — the public invoice page (`/view-invoice/:id`) read tables directly with the
  anon key, exposing customer data. (Fixed by the `get_public_invoice` RPC.)

> ⚠️ **Order matters.** Do the steps in sequence. Tightening RLS *before* the app can
> authenticate will lock the live POS out of its own database. The code is already in
> place; these steps switch it on safely.

---

## What changed in the code

- `src/store/useStore.ts` — `login()` and `loginPOS()` now call
  `supabase.auth.signInWithPassword(...)`. The hardcoded `1111` PIN and the
  plaintext password comparison are gone.
- `src/pages/PublicInvoice.tsx` — now reads through the `get_public_invoice` RPC
  instead of querying tables directly with the anon key.
- `api/telegram-alert.js` — can require a valid Supabase session
  (set `REQUIRE_ALERT_AUTH=true`); the report/cron endpoints honor `CRON_SECRET`.

New artifacts: `db/secure_rls_migration.sql`, `scripts/provision_auth_users.cjs`.

---

## Rollout steps (in order)

### 1. Create the admin email env var
Set `VITE_ADMIN_EMAIL` (e.g. `owner@yourstore.com`) in your `.env` and in your
Vercel project environment. This is the account the control-panel login signs in as.

### 2. Provision Supabase Auth users
Run the provisioning script with your **service-role** key (never ship this key):

```powershell
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
$env:ADMIN_EMAIL="owner@yourstore.com"     # must match VITE_ADMIN_EMAIL
$env:ADMIN_PASSWORD="<the password the admin will type>"
node scripts/provision_auth_users.cjs
```

This creates the admin Auth user and one Auth user per existing cashier (using each
cashier's current password), and writes a synthesized `email` back onto each
`cashiers` row. (Add an `email text` column to `cashiers` first if it doesn't exist:
`alter table cashiers add column if not exists email text;`)

### 3. Deploy the new front-end build
Deploy this code. **Verify before continuing**: the admin can log in with the
password you set, and at least one cashier can log in. (At this point the old
`allow all` RLS is still active, so the app keeps working either way.)

### 4. Apply the RLS migration (the actual lockdown)
Run `db/secure_rls_migration.sql` in the Supabase SQL editor. After this, the anon
key can no longer touch any table; only authenticated sessions can, and the public
invoice page works through the `get_public_invoice` function.

**Verify**: POS sales, admin pages, and a public invoice link all still work.
If something breaks, you can temporarily restore access by re-creating a permissive
policy on the affected table, then investigate.

### 5. (Optional) Lock down the Telegram alert endpoint
Set `REQUIRE_ALERT_AUTH=true` in Vercel. The central `sendTelegramAlert` helper
already attaches the session token. NOTE: a few alert calls in `POS.tsx`,
`AdminLayout.tsx`, and `Finance.tsx` still call `/api/telegram-alert` directly
without a token — route those through `sendTelegramAlert` before enabling this, or
they will start returning 401.

### 6. (Optional) Protect the cron/report endpoints
Set `CRON_SECRET` in Vercel. Vercel Cron sends it automatically; manual calls must
send `Authorization: Bearer <CRON_SECRET>`.

> **Important after step 4:** the scheduled-report functions read the database
> server-side. Once RLS is locked down they must use the **service-role** key.
> Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel — `api/_report-utils.js` already
> prefers it. Without it the reports will read with the anon key and return empty.

---

## Ongoing: adding / removing cashiers

Because each cashier is now a Supabase Auth user, the in-app "add cashier" form
inserts a row but **cannot** create the Auth user (the browser has no service-role
key). After adding a cashier, either:

- re-run `scripts/provision_auth_users.cjs` (it's idempotent), or
- create the Auth user in the Supabase dashboard and set the matching `email` on the
  cashier row.

A cleaner long-term fix is a small Supabase Edge Function that creates/deletes the
Auth user when a cashier is added/removed, called from the admin UI.

---

## Notes / residual items

- The `cashiers.password` column is no longer used for authentication. You can drop
  it once you've confirmed everyone can log in via Auth.
- This was implemented but **not** verifiable against your live database from the
  dev environment — test each step in a staging project first if you can.
