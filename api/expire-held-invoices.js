import { authorizeCron, getSupabase } from './_report-utils.js';

// Returns held (reserved) invoices that have been sitting for more than a week
// back to stock and deletes them. Runs daily via Vercel Cron (see vercel.json)
// so reservations are released even when no cashier has the app open. The same
// logic also runs client-side on app load (sweepExpiredHeldInvoices).
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!authorizeCron(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const nowIso = new Date().toISOString();

    const { data: expired, error } = await supabase
      .from('held_invoices')
      .select('*')
      .lt('expires_at', nowIso);

    if (error) throw error;

    const PAY_KEYS = ['cash', 'visa', 'wallet', 'instapay', 'method5', 'method6'];
    let restored = 0;
    let refunded = 0;
    for (const row of expired || []) {
      const { error: delErr } = await supabase.from('held_invoices').delete().eq('id', row.id);
      if (delErr) continue;
      const items = Array.isArray(row.items) ? row.items : [];
      for (const item of items) {
        if (!item?.id) continue;
        const { data: prod } = await supabase.from('products').select('stock_quantity').eq('id', item.id).single();
        const currentStock = Number(prod?.stock_quantity ?? 0);
        await supabase.from('products').update({ stock_quantity: currentStock + Number(item.quantity || 0) }).eq('id', item.id);
      }
      // رد عربون الحجز المنتهي للعميل (مرتجع من الدرج): صف مصروف بقيمة موجبة، category='حجز'.
      const depAmt = Math.max(0, Number(row.deposit || 0));
      if (depAmt > 0) {
        const split = row.deposit_split || { cash: depAmt };
        const paid = {};
        let best = 'cash', bestAmt = -Infinity;
        for (const k of PAY_KEYS) { const a = Math.abs(Number(split?.[k]) || 0); paid['paid_' + k] = a; if (a > bestAmt) { bestAmt = a; best = k; } }
        await supabase.from('expenses').insert({
          category: 'حجز',
          amount: depAmt,
          ...paid,
          note: `رد عربون حجز منتهٍ - ${(row.customer_name || 'عميل').trim()}`,
          payment_method: best,
        });
        refunded += 1;
      }
      restored += 1;
    }

    return res.status(200).json({ ok: true, restored, refunded });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
