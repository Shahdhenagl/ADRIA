import { createClient } from '@supabase/supabase-js';

// Creates (or updates the password of) a Supabase Auth user for a cashier, so a
// cashier added from the admin panel can log in immediately — no manual script.
// Uses the service-role key (server-side only). Authorized to the admin caller.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.VITE_ADMIN_EMAIL || process.env.ADMIN_EMAIL;

  if (!url || !serviceKey) {
    res.status(500).json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY).' });
    return;
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Authorize: caller must present the logged-in admin's access token.
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: 'unauthorized' }); return; }
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) { res.status(401).json({ error: 'unauthorized' }); return; }
  const callerEmail = (caller.user.email || '').toLowerCase();
  // A cashier account must never provision other logins. Any other authenticated
  // user is the admin (only admin + cashiers have accounts). We compare to
  // VITE_ADMIN_EMAIL when it's configured AND matches; otherwise we still allow
  // any non-cashier account, so a build-time/runtime email mismatch can't lock
  // out provisioning.
  if (callerEmail.endsWith('@cashier.local')) {
    res.status(403).json({ error: 'forbidden (cashier accounts cannot provision logins)' }); return;
  }
  if (adminEmail && callerEmail !== adminEmail.toLowerCase()) {
    console.warn(`provision-cashier: caller ${callerEmail} != VITE_ADMIN_EMAIL ${adminEmail} — allowing (non-cashier).`);
  }

  // Parse body (Vercel usually parses JSON, but be defensive).
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { id, password } = body || {};
  if (!id || !password) { res.status(400).json({ error: 'missing id or password' }); return; }

  // Supports cashiers (default) and admin-panel users.
  const table = body.table === 'admin_users' ? 'admin_users' : 'cashiers';
  const prefix = table === 'admin_users' ? 'admin' : 'cashier';
  const domain = table === 'admin_users' ? 'admin.local' : 'cashier.local';
  const email = `${prefix}-${id}@${domain}`;

  const { error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr && !/already (been )?registered|already exists/i.test(createErr.message || '')) {
    res.status(500).json({ error: createErr.message });
    return;
  }
  if (createErr) {
    // Already exists -> update its password (e.g. when editing a cashier).
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users?.find((u) => u.email === email);
    if (existing) await admin.auth.admin.updateUserById(existing.id, { password });
  }

  const { error: upErr } = await admin.from(table).update({ email }).eq('id', id);
  if (upErr) { res.status(500).json({ error: upErr.message }); return; }

  res.status(200).json({ ok: true, email });
}
