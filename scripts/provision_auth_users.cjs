/**
 * One-time provisioning: creates Supabase Auth users for the admin and every
 * existing cashier, so the app can authenticate against Supabase Auth instead
 * of the old client-side PIN / plaintext-password checks.
 *
 * Run this BEFORE applying db/secure_rls_migration.sql and BEFORE deploying the
 * new front-end build. See SECURITY_SETUP.md for the full ordered rollout.
 *
 * Required environment variables (do NOT commit these):
 *   SUPABASE_URL                 your project URL
 *   SUPABASE_SERVICE_ROLE_KEY    service-role key (admin; keep secret)
 *   ADMIN_EMAIL                  email for the admin login (e.g. owner@store.com)
 *   ADMIN_PASSWORD               password the admin will type in the PIN field
 * Optional:
 *   CASHIER_EMAIL_DOMAIN         domain for synthesized cashier emails (default: cashier.local)
 *
 * Usage (PowerShell):
 *   $env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."; `
 *   $env:ADMIN_EMAIL="owner@store.com"; $env:ADMIN_PASSWORD="strong-pass"; `
 *   node scripts/provision_auth_users.cjs
 */
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CASHIER_DOMAIN = process.env.CASHIER_EMAIL_DOMAIN || 'cashier.local';

if (!URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Missing ADMIN_EMAIL or ADMIN_PASSWORD.');
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function ensureUser(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    // If the user already exists, treat as success (idempotent re-runs).
    if (/already (been )?registered|already exists/i.test(error.message || '')) {
      console.log(`  • exists: ${email}`);
      return true;
    }
    console.error(`  ✗ failed: ${email} — ${error.message}`);
    return false;
  }
  console.log(`  ✓ created: ${email} (${data.user.id})`);
  return true;
}

async function main() {
  console.log('Provisioning admin user...');
  await ensureUser(ADMIN_EMAIL, ADMIN_PASSWORD);

  console.log('\nProvisioning cashier users...');
  const { data: cashiers, error } = await admin.from('cashiers').select('*');
  if (error) {
    console.error('Could not read cashiers table:', error.message);
    process.exit(1);
  }

  for (const c of cashiers || []) {
    const password = c.password;
    if (!password) {
      console.log(`  • skip (no password): ${c.name}`);
      continue;
    }
    const email = (c.email || `cashier-${c.id}@${CASHIER_DOMAIN}`).toLowerCase();
    const ok = await ensureUser(email, password);
    if (ok) {
      const { error: upErr } = await admin.from('cashiers').update({ email }).eq('id', c.id);
      if (upErr) console.error(`    ✗ could not set email on cashier ${c.name}: ${upErr.message}`);
      else console.log(`    → linked ${c.name} -> ${email}`);
    }
  }

  console.log('\nDone. Next: deploy the new build, verify logins, then run db/secure_rls_migration.sql.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
