import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { PiggyBank, ArrowLeftRight, Banknote, Save } from 'lucide-react';
import { ALL_PAYMENT_KEYS, activePaymentKeys, payLabelOf, openingBalanceOf, savingsOpeningBalanceOf } from '../../utils/paymentMethods';
import { applySplit, applyInternalTransferNet, isInternalTransfer, isMainTreasuryExpense, isMainTreasuryPurchase } from '../../utils/treasury';

type Split = Record<string, number>;
const zero = (): Split => { const z: Split = {}; ALL_PAYMENT_KEYS.forEach((k) => { z[k] = 0; }); return z; };

export default function Savings() {
  const { storeSettings, savingsTransfer, savingsConvert, updateSettings } = useStore();
  const cur = storeSettings.currency;
  const METHODS = activePaymentKeys(storeSettings as any).map((k) => ({ key: k, label: payLabelOf(storeSettings as any, k) }));
  const input = 'w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none';

  const [shopAvail, setShopAvail] = useState<Split>(zero());
  const [savingsBal, setSavingsBal] = useState<Split>(zero());
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [mode, setMode] = useState<'in' | 'out' | 'convert'>('in');
  const direction: 'in' | 'out' = mode === 'out' ? 'out' : 'in';
  const [amt, setAmt] = useState<Record<string, string>>({ cash: '', visa: '', wallet: '', instapay: '' });
  // تحويل بين طرق الخزنة الرئيسية (نقدي ➜ بنك مثلاً)
  const [convFrom, setConvFrom] = useState('cash');
  const [convTo, setConvTo] = useState('visa');
  const [convAmt, setConvAmt] = useState('');
  const [note, setNote] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  // تاريخ العملية — تُسجَّل في حسابات هذا اليوم (افتراضي النهاردة)
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  // فلتر سجل معاملات الخزنة الرئيسية: الكل / شهر / يوم
  const [fMode, setFMode] = useState<'all' | 'month' | 'day'>('all');
  const [fMonth, setFMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [fDay, setFDay] = useState(() => new Date().toISOString().slice(0, 10));

  // محرّر الرصيد الافتتاحي للخزنة الرئيسية
  const [openDraft, setOpenDraft] = useState<Record<string, string>>({});
  const [savingOpen, setSavingOpen] = useState(false);
  useEffect(() => {
    const d: Record<string, string> = {};
    METHODS.forEach((m) => { d[m.key] = String(savingsOpeningBalanceOf(storeSettings as any, m.key)); });
    setOpenDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSettings.savingsOpeningBalances, METHODS.map((m) => m.key).join(',')]);

  const saveOpening = async () => {
    setSavingOpen(true);
    const obj: Record<string, number> = { ...(storeSettings.savingsOpeningBalances || {}) };
    METHODS.forEach((m) => { obj[m.key] = Number(openDraft[m.key]) || 0; });
    try {
      await updateSettings({ savingsOpeningBalances: obj });
      await load();
      alert('تم حفظ الرصيد الافتتاحي للخزنة الرئيسية ✅');
    } catch (err) {
      alert((err as Error)?.message || 'تعذّر حفظ الرصيد الافتتاحي');
    }
    setSavingOpen(false);
  };

  const load = async () => {
    setLoading(true);
    try {
      const { fetchAllRows } = await import('../../lib/supabase');
      // جلب كل الصفوف (تخطّي حد 1000) عشان رصيد خزنة المحل يطلع صح مهما كثرت الحركات.
      const [expData, purData, salData, ordData, savRows] = await Promise.all([
        fetchAllRows('expenses'),
        fetchAllRows('purchase_invoices'),
        fetchAllRows('employee_transactions'),
        fetchAllRows('orders', '*, order_items(refunded_amount)'),
        fetchAllRows('savings_transactions'),
      ]);
      const savRes = { data: savRows };
      const allOrders = (ordData as any[]).map((o) => ({ ...o, items: o.order_items || [] }));
      // خزنة المحل المتاح لكل وسيلة (كل الفترات) — منطق التوزيع مشترك في utils/treasury.
      const net = zero();
      const add = (sign: number, rec: any, field: string) => applySplit(net, rec, field, { sign });
      allOrders.filter((o: any) => !o.is_deleted).forEach((o: any) => {
        if (o.type === 'sale' || o.type === 'payment') add(1, o, 'paid_amount');
        const ref = (o.items || []).reduce((t: number, it: any) => t + (+it.refunded_amount || 0), 0);
        if (ref > 0) add(-1, { paid_amount: ref, payment_method: o.refund_method || o.payment_method }, 'paid_amount');
      });
      (expData || []).forEach((e: any) => {
        const amount = Number(e.amount) || 0;
        if (isMainTreasuryExpense(e)) return;
        if (isInternalTransfer(e.category)) { applyInternalTransferNet(net, e); return; }
        if (amount < 0) { const absRec: any = { ...e, amount: Math.abs(amount) }; ALL_PAYMENT_KEYS.forEach((k) => { absRec['paid_' + k] = Math.abs(+e['paid_' + k] || 0); }); add(1, absRec, 'amount'); }
        else add(-1, e, 'amount');
      });
      (purData || []).filter((p: any) => !isMainTreasuryPurchase(p)).forEach((p: any) => add(-1, p, 'paid_amount'));
      (salData || []).forEach((s: any) => add(-1, s, 'amount'));
      ALL_PAYMENT_KEYS.forEach((k) => { net[k] += openingBalanceOf(storeSettings as any, k); });
      setShopAvail(net);

      // رصيد الخزنة الرئيسية لكل وسيلة = رصيد افتتاحي + (داخل − خارج)
      const sav = zero();
      ALL_PAYMENT_KEYS.forEach((k) => { sav[k] += savingsOpeningBalanceOf(storeSettings as any, k); });
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

  // تحويل بين الطرق: الحد الأقصى = رصيد الطريقة المصدر في الخزنة الرئيسية
  const convCap = savingsBal[convFrom] || 0;
  const convValue = Number(convAmt) || 0;
  const labelOfKey = (k: string) => METHODS.find((m) => m.key === k)?.label || k;

  const fillAll = () => { const next: Record<string, string> = {}; METHODS.forEach((m) => { next[m.key] = String(Math.max(0, cap[m.key] || 0) || ''); }); setAmt(next); };

  const detailsText = () => {
    if (mode === 'convert') {
      return `تحويل بين طرق الخزنة الرئيسية\n${labelOfKey(convFrom)} ➜ ${labelOfKey(convTo)}\nالمبلغ: ${convValue.toFixed(2)} ${cur}${note ? `\nملاحظة: ${note}` : ''}`;
    }
    const lines = METHODS.filter((m) => (Number(amt[m.key]) || 0) > 0).map((m) => `${m.label}: ${Number(amt[m.key]).toFixed(2)}`);
    return `${direction === 'in' ? 'تحويل من المحل ➜ الخزنة الرئيسية' : 'تحويل من الخزنة الرئيسية ➜ المحل'}\n${lines.join(' | ')}\nالإجمالي: ${total.toFixed(2)} ${cur}${note ? `\nملاحظة: ${note}` : ''}`;
  };

  const validate = () => {
    if (mode === 'convert') {
      if (convFrom === convTo) { alert('اختاري طريقتين مختلفتين'); return false; }
      if (convValue <= 0) { alert('أدخل مبلغاً للتحويل'); return false; }
      if (convValue > convCap + 0.001) { alert(`المبلغ أكبر من المتاح في ${labelOfKey(convFrom)} (${convCap.toFixed(2)})`); return false; }
      return true;
    }
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
      // نثبّت التاريخ المُختار (12 ظهراً لتفادي إزاحة المنطقة الزمنية) كـ created_at للحركة.
      const dateISO = txDate ? new Date(`${txDate}T12:00:00`).toISOString() : undefined;
      let ok = false;
      if (mode === 'convert') {
        ok = await savingsConvert(convFrom, convTo, convValue, note.trim(), dateISO);
      } else {
        const split: Record<string, number> = {};
        ALL_PAYMENT_KEYS.forEach((k) => { split[k] = Number(amt[k]) || 0; });
        ok = await savingsTransfer(split as any, direction, direction === 'in' ? 'shop_transfer' : 'to_shop', note.trim(), dateISO);
      }
      if (ok) { alert('تم التحويل ✅'); setAmt({}); setConvAmt(''); setNote(''); setOtpInput(''); setOtpSent(false); setTxDate(new Date().toISOString().slice(0, 10)); load(); }
    } catch { alert('تعذّر تنفيذ التحويل'); }
    setBusy(false);
  };

  // فلترة سجل المعاملات بالتاريخ المحلي (مطابق للعرض) — بالشهر أو باليوم.
  const localYMD = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const filteredTxs = txs.filter((t) => {
    if (fMode === 'all') return true;
    const ymd = localYMD(t.created_at);
    return fMode === 'month' ? ymd.slice(0, 7) === fMonth : ymd === fDay;
  });
  const fIn = filteredTxs.filter((t) => t.direction === 'in').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const fOut = filteredTxs.filter((t) => t.direction === 'out').reduce((s, t) => s + (Number(t.amount) || 0), 0);

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><PiggyBank className="text-indigo-600" size={30} /> الخزنة الرئيسية</h1>
          <p className="text-slate-500 mt-1 font-medium text-sm">تحويل بين خزنة المحل والخزنة الرئيسية (كل طريقة بطريقتها) — بتأكيد OTP للمدير</p>
        </div>
        <div className="bg-gradient-to-l from-indigo-600 to-purple-600 text-white rounded-2xl px-5 py-3 text-center">
          <div className="text-[11px] font-bold opacity-90">إجمالي الخزنة الرئيسية</div>
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

      {/* الرصيد الافتتاحي للخزنة الرئيسية */}
      <details className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <summary className="cursor-pointer font-black text-slate-800 dark:text-white flex items-center gap-2"><Banknote size={18} className="text-emerald-600" /> الرصيد الافتتاحي للخزنة الرئيسية</summary>
        <p className="text-[11px] text-slate-400 mt-2 mb-3">الفلوس اللي كانت موجودة في الخزنة الرئيسية لكل وسيلة قبل ما تبدئي على النظام. بتتضاف لرصيد الخزنة الرئيسية (مستقلة عن خزنة المحل).</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {METHODS.map((m) => (
            <div key={m.key}>
              <label className="text-xs font-bold text-slate-500 block mb-1 truncate">{m.label}</label>
              <input type="number" value={openDraft[m.key] ?? ''} onChange={(e) => setOpenDraft((d) => ({ ...d, [m.key]: e.target.value }))} className={input} />
            </div>
          ))}
        </div>
        <button onClick={saveOpening} disabled={savingOpen} className="mt-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black px-5 py-2.5 rounded-xl flex items-center gap-2"><Save size={18} /> {savingOpen ? 'جاري الحفظ...' : 'حفظ الرصيد الافتتاحي'}</button>
      </details>

      {/* Transfer */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-3 max-w-2xl">
        <h2 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2"><ArrowLeftRight size={18} className="text-indigo-600" /> تحويل</h2>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => { setMode('in'); setOtpSent(false); }} className={`py-2.5 rounded-xl font-black text-xs ${mode === 'in' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>المحل ➜ الرئيسية</button>
          <button onClick={() => { setMode('out'); setOtpSent(false); }} className={`py-2.5 rounded-xl font-black text-xs ${mode === 'out' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>الرئيسية ➜ المحل</button>
          <button onClick={() => { setMode('convert'); setOtpSent(false); }} className={`py-2.5 rounded-xl font-black text-xs ${mode === 'convert' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>تحويل بين الطرق</button>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-500 block mb-1">تاريخ العملية <span className="text-slate-400">(تُسجَّل في حسابات هذا اليوم)</span></label>
          <input className={input} type="date" value={txDate} onChange={(e) => { setTxDate(e.target.value); setOtpSent(false); }} />
        </div>

        {mode === 'convert' ? (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-400">تحويل رصيد داخل الخزنة الرئيسية من طريقة لطريقة تانية (مثلاً: نقدي ➜ بنك بعد ما تودّعي الكاش في البنك). الإجمالي ما بيتغيّرش — بس شكل الفلوس بيتحوّل.</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-500">من <span className="text-slate-400">(متاح {convCap.toFixed(2)})</span></label>
                <select className={input} value={convFrom} onChange={(e) => { setConvFrom(e.target.value); setOtpSent(false); }}>
                  {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500">إلى</label>
                <select className={input} value={convTo} onChange={(e) => { setConvTo(e.target.value); setOtpSent(false); }}>
                  {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500">المبلغ</label>
              <div className="flex gap-2">
                <input className={input} type="number" min="0" placeholder="0" value={convAmt} onChange={(e) => { setConvAmt(e.target.value); setOtpSent(false); }} />
                <button onClick={() => { setConvAmt(String(Math.max(0, convCap) || '')); setOtpSent(false); }} className="shrink-0 text-[11px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-3 rounded-lg">كل المتاح</button>
              </div>
            </div>
            <input className={input} placeholder="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="text-center font-black text-slate-700 dark:text-slate-200">{labelOfKey(convFrom)} ➜ {labelOfKey(convTo)}: {convValue.toFixed(2)} {cur}</div>
          </div>
        ) : (
        <>
        <div className="flex justify-end"><button onClick={fillAll} className="text-[11px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-lg">تحويل كل المتاح</button></div>
        <div className="grid grid-cols-2 gap-2">
          {METHODS.map((m) => (
            <div key={m.key}>
              <label className="text-[11px] font-bold text-slate-500">{m.label} <span className="text-slate-400">(متاح {(cap[m.key] || 0).toFixed(0)})</span></label>
              <input className={input} type="number" min="0" placeholder="0" value={amt[m.key] || ''} onChange={(e) => { setAmt((a) => ({ ...a, [m.key]: e.target.value })); setOtpSent(false); }} />
            </div>
          ))}
        </div>
        <input className={input} placeholder="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="text-center font-black text-slate-700 dark:text-slate-200">الإجمالي: {total.toFixed(2)} {cur}</div>
        </>
        )}

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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-black text-slate-800 dark:text-white">سجل معاملات الخزنة الرئيسية</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 rounded-xl p-1">
              {([['all', 'الكل'], ['month', 'شهر'], ['day', 'يوم']] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setFMode(k)} className={`px-3 py-1.5 rounded-lg text-xs font-black transition ${fMode === k ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}>{lbl}</button>
              ))}
            </div>
            {fMode === 'month' && (
              <input type="month" value={fMonth} onChange={(e) => setFMonth(e.target.value)} className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs font-bold" />
            )}
            {fMode === 'day' && (
              <input type="date" value={fDay} onChange={(e) => setFDay(e.target.value)} className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs font-bold" />
            )}
          </div>
        </div>

        {fMode !== 'all' && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-2.5 text-center"><div className="text-[10px] font-bold text-emerald-600">داخل</div><div className="text-sm font-black text-emerald-700 dark:text-emerald-400">{fIn.toFixed(2)}</div></div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-2.5 text-center"><div className="text-[10px] font-bold text-red-600">خارج</div><div className="text-sm font-black text-red-700 dark:text-red-400">{fOut.toFixed(2)}</div></div>
            <div className="bg-slate-100 dark:bg-slate-900/40 rounded-xl p-2.5 text-center"><div className="text-[10px] font-bold text-slate-500">الصافي</div><div className="text-sm font-black text-slate-800 dark:text-slate-100">{(fIn - fOut).toFixed(2)}</div></div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead><tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700"><th className="p-2">التاريخ</th><th className="p-2">النوع</th><th className="p-2">المبلغ</th><th className="p-2">الطريقة</th><th className="p-2">المصدر</th><th className="p-2">ملاحظة</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="text-center text-slate-400 py-6">جاري التحميل...</td></tr>
                : filteredTxs.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-400 py-6">{txs.length === 0 ? 'لا توجد معاملات' : 'لا توجد معاملات في هذه الفترة'}</td></tr>
                : filteredTxs.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 dark:border-slate-700/50">
                    <td className="p-2">{new Date(t.created_at).toLocaleString('ar-EG')}</td>
                    <td className="p-2 font-bold"><span className={t.source === 'convert' ? 'text-indigo-600' : t.direction === 'in' ? 'text-emerald-600' : 'text-red-600'}>{t.source === 'convert' ? (t.direction === 'in' ? 'دخول (تحويل بين الطرق)' : 'خروج (تحويل بين الطرق)') : t.direction === 'in' ? 'إيداع للرئيسية' : 'سحب للمحل'}</span></td>
                    <td className={`p-2 font-black ${t.source === 'convert' ? 'text-indigo-600' : t.direction === 'in' ? 'text-emerald-600' : 'text-red-600'}`}>{t.direction === 'in' ? '+' : '−'}{Number(t.amount).toFixed(2)} {cur}</td>
                    <td className="p-2">{METHODS.find((m) => m.key === t.method)?.label || t.method}</td>
                    <td className="p-2 text-xs text-slate-500">{t.source === 'day_closing' ? 'تقفيل اليوم' : t.source === 'shop_transfer' ? 'تحويل من المحل' : t.source === 'to_shop' ? 'تحويل للمحل' : t.source === 'convert' ? 'تحويل بين الطرق' : 'يدوي'}</td>
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
