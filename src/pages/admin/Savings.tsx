import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { PiggyBank, ArrowLeftRight } from 'lucide-react';

const METHODS = [
  { key: 'cash', label: 'كاش' },
  { key: 'visa', label: 'فيزا' },
  { key: 'wallet', label: 'محفظة' },
  { key: 'instapay', label: 'انستا باي' },
] as const;

type Split = Record<string, number>;
const zero = (): Split => ({ cash: 0, visa: 0, wallet: 0, instapay: 0 });

export default function Savings() {
  const { orders, storeSettings, savingsTransfer } = useStore();
  const cur = storeSettings.currency;
  const input = 'w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none';

  const [shopAvail, setShopAvail] = useState<Split>(zero());
  const [savingsBal, setSavingsBal] = useState<Split>(zero());
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amt, setAmt] = useState<Record<string, string>>({ cash: '', visa: '', wallet: '', instapay: '' });
  const [note, setNote] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { supabase } = await import('../../lib/supabase');
      const [expRes, purRes, salRes, savRes] = await Promise.all([
        supabase.from('expenses').select('*'),
        supabase.from('purchase_invoices').select('*'),
        supabase.from('employee_transactions').select('*'),
        supabase.from('savings_transactions').select('*').order('created_at', { ascending: false }),
      ]);
      // خزنة المحل المتاح لكل وسيلة (كل الفترات)
      const net = zero();
      const add = (sign: number, rec: any, field: string) => {
        const c = +rec.paid_cash || 0, v = +rec.paid_visa || 0, w = +rec.paid_wallet || 0, i = +rec.paid_instapay || 0;
        if (c + v + w + i > 0) { net.cash += sign * c; net.visa += sign * v; net.wallet += sign * w; net.instapay += sign * i; return; }
        const a = Math.abs(+rec[field] || 0);
        const m = ['cash', 'visa', 'wallet', 'instapay'].includes(rec.payment_method) ? rec.payment_method : 'cash';
        net[m] += sign * a;
      };
      orders.filter((o: any) => !o.is_deleted).forEach((o: any) => {
        if (o.type === 'sale' || o.type === 'payment') add(1, o, 'paid_amount');
        const ref = (o.items || []).reduce((t: number, it: any) => t + (+it.refunded_amount || 0), 0);
        if (ref > 0) add(-1, { paid_amount: ref, payment_method: o.refund_method || o.payment_method }, 'paid_amount');
      });
      (expRes.data || []).forEach((e: any) => {
        const amount = Number(e.amount) || 0;
        if (amount < 0) add(1, { ...e, amount: Math.abs(amount), paid_cash: Math.abs(+e.paid_cash || 0), paid_visa: Math.abs(+e.paid_visa || 0), paid_wallet: Math.abs(+e.paid_wallet || 0), paid_instapay: Math.abs(+e.paid_instapay || 0) }, 'amount');
        else add(-1, e, 'amount');
      });
      (purRes.data || []).forEach((p: any) => add(-1, p, 'paid_amount'));
      (salRes.data || []).forEach((s: any) => add(-1, s, 'amount'));
      net.cash += Number((storeSettings as any).initialBalance ?? (storeSettings as any).initial_balance) || 0;
      setShopAvail(net);

      // رصيد الادخار لكل وسيلة (داخل − خارج)
      const sav = zero();
      const list = (savRes.data as any[]) || [];
      list.forEach((t) => { const m = t.method || 'cash'; if (sav[m] === undefined) return; sav[m] += (t.direction === 'in' ? 1 : -1) * (Number(t.amount) || 0); });
      setSavingsBal(sav);
      setTxs(list);
    } catch (e) { console.error(e); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const cap = direction === 'in' ? shopAvail : savingsBal; // الحد الأقصى لكل وسيلة
  const total = METHODS.reduce((s, m) => s + (Number(amt[m.key]) || 0), 0);
  const savingsTotal = METHODS.reduce((s, m) => s + (savingsBal[m.key] || 0), 0);

  const fillAll = () => setAmt({ cash: String(Math.max(0, cap.cash) || ''), visa: String(Math.max(0, cap.visa) || ''), wallet: String(Math.max(0, cap.wallet) || ''), instapay: String(Math.max(0, cap.instapay) || '') });

  const detailsText = () => {
    const lines = METHODS.filter((m) => (Number(amt[m.key]) || 0) > 0).map((m) => `${m.label}: ${Number(amt[m.key]).toFixed(2)}`);
    return `${direction === 'in' ? 'تحويل من المحل ➜ الادخار' : 'تحويل من الادخار ➜ المحل'}\n${lines.join(' | ')}\nالإجمالي: ${total.toFixed(2)} ${cur}${note ? `\nملاحظة: ${note}` : ''}`;
  };

  const validate = () => {
    if (total <= 0) { alert('أدخل مبلغاً للتحويل'); return false; }
    for (const m of METHODS) {
      if ((Number(amt[m.key]) || 0) > (cap[m.key] || 0) + 0.001) {
        alert(`مبلغ ${m.label} أكبر من المتاح (${(cap[m.key] || 0).toFixed(2)})`);
        return false;
      }
    }
    return true;
  };

  const token = async () => { const { supabase } = await import('../../lib/supabase'); const { data } = await supabase.auth.getSession(); return data.session?.access_token; };

  const requestOtp = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const t = await token();
      const r = await fetch('/api/wholesale-otp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ action: 'request', purpose: 'savings', details: detailsText() }) });
      const j = await r.json();
      if (j.ok) { setOtpSent(true); alert('تم إرسال تفاصيل العملية ورمز التأكيد للمدير على تليجرام 📲'); }
      else alert('تعذّر إرسال الرمز: ' + (j.error || ''));
    } catch { alert('تعذّر إرسال الرمز'); }
    setBusy(false);
  };

  const confirmTransfer = async () => {
    if (!validate()) return;
    if (!otpInput.trim()) { alert('أدخل رمز التأكيد'); return; }
    setBusy(true);
    try {
      const t = await token();
      const r = await fetch('/api/wholesale-otp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ action: 'verify', purpose: 'savings', code: otpInput.trim() }) });
      const j = await r.json();
      if (!j.ok) { alert(j.error || 'رمز غير صحيح'); setBusy(false); return; }
      const split = { cash: Number(amt.cash) || 0, visa: Number(amt.visa) || 0, wallet: Number(amt.wallet) || 0, instapay: Number(amt.instapay) || 0 };
      const ok = await savingsTransfer(split, direction, direction === 'in' ? 'shop_transfer' : 'to_shop', note.trim());
      if (ok) { alert('تم التحويل ✅'); setAmt({ cash: '', visa: '', wallet: '', instapay: '' }); setNote(''); setOtpInput(''); setOtpSent(false); load(); }
    } catch { alert('تعذّر تنفيذ التحويل'); }
    setBusy(false);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><PiggyBank className="text-indigo-600" size={30} /> خزنة الادخار</h1>
          <p className="text-slate-500 mt-1 font-medium text-sm">تحويل بين خزنة المحل وخزنة الادخار (كل طريقة بطريقتها) — بتأكيد OTP للمدير</p>
        </div>
        <div className="bg-gradient-to-l from-indigo-600 to-purple-600 text-white rounded-2xl px-5 py-3 text-center">
          <div className="text-[11px] font-bold opacity-90">إجمالي الادخار</div>
          <div className="text-2xl font-black">{savingsTotal.toFixed(2)} {cur}</div>
        </div>
      </div>

      {/* Balances */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {METHODS.map((m) => (
          <div key={m.key} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 text-center">
            <div className="text-[11px] font-bold text-slate-500">{m.label}</div>
            <div className="text-lg font-black text-indigo-600">{(savingsBal[m.key] || 0).toFixed(2)}</div>
            <div className="text-[10px] text-slate-400 mt-1">بالمحل: {(shopAvail[m.key] || 0).toFixed(2)}</div>
          </div>
        ))}
      </div>

      {/* Transfer */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-3 max-w-2xl">
        <h2 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2"><ArrowLeftRight size={18} className="text-indigo-600" /> تحويل</h2>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { setDirection('in'); setOtpSent(false); }} className={`py-2.5 rounded-xl font-black text-sm ${direction === 'in' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>من المحل ➜ الادخار</button>
          <button onClick={() => { setDirection('out'); setOtpSent(false); }} className={`py-2.5 rounded-xl font-black text-sm ${direction === 'out' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>من الادخار ➜ المحل</button>
        </div>
        <div className="flex justify-end"><button onClick={fillAll} className="text-[11px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-lg">تحويل كل المتاح</button></div>
        <div className="grid grid-cols-2 gap-2">
          {METHODS.map((m) => (
            <div key={m.key}>
              <label className="text-[11px] font-bold text-slate-500">{m.label} <span className="text-slate-400">(متاح {(cap[m.key] || 0).toFixed(0)})</span></label>
              <input className={input} type="number" min="0" placeholder="0" value={amt[m.key]} onChange={(e) => { setAmt((a) => ({ ...a, [m.key]: e.target.value })); setOtpSent(false); }} />
            </div>
          ))}
        </div>
        <input className={input} placeholder="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="text-center font-black text-slate-700 dark:text-slate-200">الإجمالي: {total.toFixed(2)} {cur}</div>

        {!otpSent ? (
          <button onClick={requestOtp} disabled={busy} className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-black py-3 rounded-xl">{busy ? 'جاري...' : '📲 إرسال للمدير وطلب رمز التأكيد'}</button>
        ) : (
          <div className="space-y-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">وصل الرمز للمدير على تليجرام — أدخليه لتأكيد التحويل.</p>
            <div className="flex gap-2">
              <input className={input + ' text-center tracking-widest'} dir="ltr" placeholder="الرمز" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} />
              <button onClick={confirmTransfer} disabled={busy} className="shrink-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black px-5 rounded-xl">تأكيد التحويل</button>
            </div>
            <button onClick={requestOtp} disabled={busy} className="text-[11px] font-bold text-amber-700">إعادة إرسال الرمز</button>
          </div>
        )}
      </div>

      {/* Ledger */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
        <h2 className="text-base font-black text-slate-800 dark:text-white mb-4">سجل معاملات خزنة الادخار</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead><tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700"><th className="p-2">التاريخ</th><th className="p-2">النوع</th><th className="p-2">المبلغ</th><th className="p-2">الطريقة</th><th className="p-2">المصدر</th><th className="p-2">ملاحظة</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="text-center text-slate-400 py-6">جاري التحميل...</td></tr>
                : txs.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-400 py-6">لا توجد معاملات</td></tr>
                : txs.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 dark:border-slate-700/50">
                    <td className="p-2">{new Date(t.created_at).toLocaleString('ar-EG')}</td>
                    <td className="p-2 font-bold"><span className={t.direction === 'in' ? 'text-emerald-600' : 'text-red-600'}>{t.direction === 'in' ? 'إيداع للادخار' : 'سحب للمحل'}</span></td>
                    <td className={`p-2 font-black ${t.direction === 'in' ? 'text-emerald-600' : 'text-red-600'}`}>{Number(t.amount).toFixed(2)} {cur}</td>
                    <td className="p-2">{METHODS.find((m) => m.key === t.method)?.label || t.method}</td>
                    <td className="p-2 text-xs text-slate-500">{t.source === 'day_closing' ? 'تقفيل اليوم' : t.source === 'shop_transfer' ? 'تحويل من المحل' : t.source === 'to_shop' ? 'تحويل للمحل' : 'يدوي'}</td>
                    <td className="p-2 text-slate-600 dark:text-slate-300">{t.note || '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
