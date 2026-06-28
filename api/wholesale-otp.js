import { createClient } from '@supabase/supabase-js';
import { sendTelegramText } from './_report-utils.js';

// OTP gate for wholesale / half-wholesale invoices.
//  POST { action: 'request' }        → generate a 6-digit code, store it, send to Telegram.
//  POST { action: 'verify', code }   → validate (unused + not expired) and consume it.
// Caller must present a logged-in staff bearer token (admin or cashier).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    res.status(500).json({ ok: false, error: 'Server not configured (SUPABASE_SERVICE_ROLE_KEY).' });
    return;
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Authorize: any authenticated staff user.
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const action = body?.action;

  try {
    const purpose = (body?.purpose || 'wholesale').toString();
    const details = (body?.details || '').toString().slice(0, 600);

    if (action === 'request') {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const { error } = await admin.from('otp_codes').insert({ code, purpose, expires_at: expires, used: false });
      if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
      try {
        const header = purpose === 'savings'
          ? '🔐 تأكيد عملية على خزنة الادخار'
          : purpose === 'wholesale'
            ? '🔐 رمز تأكيد فاتورة الجملة / نص الجملة'
            : '🔐 رمز تأكيد عملية';
        const msg = `${header}:\n${details ? `\n${details}\n` : ''}\nالرمز: ${code}\n\nصالح لمدة 5 دقائق. لا تشاركه إلا بعد مراجعة تفاصيل العملية.`;
        await sendTelegramText(msg);
      } catch (e) {
        res.status(500).json({ ok: false, error: 'تعذّر إرسال الرمز على تليجرام: ' + String(e) });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'verify') {
      const code = String(body?.code || '').trim();
      if (!code) { res.status(400).json({ ok: false, error: 'missing code' }); return; }
      const { data } = await admin
        .from('otp_codes')
        .select('*')
        .eq('code', code)
        .eq('purpose', purpose)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) { res.status(200).json({ ok: false, error: 'رمز غير صحيح أو منتهي' }); return; }
      await admin.from('otp_codes').update({ used: true }).eq('id', data.id);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
