import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Briefcase, Plus, Banknote } from 'lucide-react';
import { ALL_PAYMENT_KEYS, activePaymentKeys, payLabelOf } from '../../utils/paymentMethods';

export default function Managers() {
  const { orders, storeSettings, managerWithdraw } = useStore();
  const cur = storeSettings.currency;
  const METHODS = activePaymentKeys(storeSettings as any).map((k) => ({ key: k, label: payLabelOf(storeSettings as any, k) }));

  const [managers, setManagers] = useState<{ id: string; name: string }[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [avail, setAvail] = useState<Record<string, number>>({ cash: 0, visa: 0, wallet: 0, instapay: 0 });
  const [loading, setLoading] = useState(false);

  const [newManager, setNewManager] = useState('');
  const [selManager, setSelManager] = useState('');
  const [amt, setAmt] = useState<Record<string, string>>({ cash: '', visa: '', wallet: '', instapay: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { supabase } = await import('../../lib/supabase');
      const [mRes, expRes, purRes, salRes] = await Promise.all([
        supabase.from('managers').select('*').order('created_at', { ascending: true }),
        supabase.from('expenses').select('*'),
        supabase.from('purchase_invoices').select('*'),
        supabase.from('employee_transactions').select('*'),
      ]);
      setManagers((mRes.data as any[]) || []);
      const expenses = (expRes.data as any[]) || [];
      setWithdrawals(expenses.filter((e) => e.category === 'سحب مدير').sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));

      // الرصيد المتاح في كل وسيلة دفع (كل الفترات).
      const net: Record<string, number> = {};
      ALL_PAYMENT_KEYS.forEach((k) => { net[k] = 0; });
      const add = (sign: number, rec: any, field: string, mOverride?: string) => {
        const vals = ALL_PAYMENT_KEYS.map((k) => +rec['paid_' + k] || 0);
        const sum = vals.reduce((a, b) => a + b, 0);
        if (sum > 0) { ALL_PAYMENT_KEYS.forEach((k, idx) => { net[k] += sign * vals[idx]; }); return; }
        const a = Math.abs(+rec[field] || 0);
        const m = mOverride || rec.payment_method || 'cash';
        if (net[m] !== undefined) net[m] += sign * a;
      };
      orders.filter((o: any) => !o.is_deleted).forEach((o: any) => {
        if (o.type === 'sale' || o.type === 'payment') add(1, o, 'paid_amount');
        const refunded = (o.items || []).reduce((s: number, it: any) => s + (+it.refunded_amount || 0), 0);
        if (refunded > 0) add(-1, { paid_amount: refunded, payment_method: o.refund_method || o.payment_method }, 'paid_amount');
      });
      expenses.forEach((e) => {
        const amt = Number(e.amount) || 0;
        if (amt < 0) {
          // مصروف بمبلغ سالب = إيراد مسجّل يدوياً (داخل للخزنة) مش خارج منها
          { const absRec: any = { ...e, amount: Math.abs(amt) }; ALL_PAYMENT_KEYS.forEach((k) => { absRec['paid_' + k] = Math.abs(+e['paid_' + k] || 0); }); add(1, absRec, 'amount'); }
        } else {
          add(-1, e, 'amount');
        }
      });
      purRes.data?.forEach((p: any) => add(-1, p, 'paid_amount'));
      salRes.data?.forEach((s: any) => add(-1, s, 'amount'));
      net.cash += Number((storeSettings as any).initialBalance ?? (storeSettings as any).initial_balance) || 0;
      setAvail(net);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const addManager = async () => {
    if (!newManager.trim()) return;
    const { supabase } = await import('../../lib/supabase');
    const { data } = await supabase.from('managers').insert({ name: newManager.trim() }).select().single();
    if (data) { setManagers((m) => [...m, data as any]); setNewManager(''); }
  };

  const submitWithdraw = async () => {
    if (!selManager) { alert('اختر المدير'); return; }
    const split: Record<string, number> = {};
    ALL_PAYMENT_KEYS.forEach((k) => { split[k] = +amt[k] || 0; });
    const total = ALL_PAYMENT_KEYS.reduce((s, k) => s + split[k], 0);
    if (total <= 0) { alert('أدخل مبلغاً للسحب'); return; }
    for (const m of METHODS) {
      if ((split as any)[m.key] > (avail[m.key] || 0) + 0.001) {
        alert(`المبلغ المطلوب من ${m.label} (${(split as any)[m.key]}) أكبر من المتاح (${(avail[m.key] || 0).toFixed(2)})`);
        return;
      }
    }
    setSaving(true);
    const ok = await managerWithdraw(selManager, split as any);
    setSaving(false);
    if (ok) {
      alert('تم تسجيل السحب وخصمه من الخزنة ✅');
      setAmt({});
      load();
    }
  };

  const inputCls = 'w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none';

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3">
          <Briefcase className="text-indigo-600" size={30} /> المدراء والسحوبات
        </h1>
        <p className="text-slate-500 mt-1 font-medium text-sm">سحب أموال من الخزنة باسم المدير (يُخصم من وسيلة الدفع ولا يُحذف)</p>
      </div>

      {/* إجمالي الخزنة الحقيقي */}
      <div className="bg-gradient-to-l from-indigo-600 to-purple-600 text-white rounded-2xl p-5 flex items-center justify-between">
        <span className="text-sm font-bold opacity-90">إجمالي المتاح بالخزنة (كل الوسائل)</span>
        <span className="text-2xl font-black">{METHODS.reduce((s, m) => s + (avail[m.key] || 0), 0).toFixed(2)} {cur}</span>
      </div>

      {/* المتاح في كل وسيلة */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {METHODS.map((m) => {
          const v = avail[m.key] || 0;
          const neg = v < 0;
          return (
            <div key={m.key} className={`bg-white dark:bg-slate-800 rounded-2xl p-4 border text-center ${neg ? 'border-red-300 dark:border-red-700' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="text-[11px] font-bold text-slate-500">المتاح — {m.label}</div>
              <div className={`text-xl font-black ${neg ? 'text-red-600' : 'text-emerald-600'}`}>{v.toFixed(2)} {cur}</div>
              {neg && <div className="text-[9px] font-bold text-red-500 mt-1">مسحوب منها أكثر من رصيدها</div>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* سحب جديد */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <h2 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2"><Banknote size={18} className="text-indigo-600" /> سحب جديد</h2>
          <div className="flex gap-2">
            <select className={inputCls + ' flex-1'} value={selManager} onChange={(e) => setSelManager(e.target.value)}>
              <option value="">اختر المدير</option>
              {managers.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <div key={m.key}>
                <label className="text-[11px] font-bold text-slate-500">{m.label} <span className="text-slate-400">(متاح {(avail[m.key] || 0).toFixed(0)})</span></label>
                <input className={inputCls} type="number" min="0" placeholder="0" value={amt[m.key] || ''} onChange={(e) => setAmt((a) => ({ ...a, [m.key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="text-center font-black text-slate-700 dark:text-slate-200">
            الإجمالي: {METHODS.reduce((s, m) => s + (+amt[m.key] || 0), 0).toFixed(2)} {cur}
          </div>
          <button onClick={submitWithdraw} disabled={saving} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black py-3 rounded-xl transition">
            {saving ? 'جاري التسجيل...' : 'تأكيد السحب وخصمه من الخزنة'}
          </button>
        </div>

        {/* إدارة المدراء */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
          <h2 className="text-base font-black text-slate-800 dark:text-white mb-3">المدراء</h2>
          <div className="flex gap-2 mb-3">
            <input className={inputCls + ' flex-1'} placeholder="اسم المدير" value={newManager} onChange={(e) => setNewManager(e.target.value)} />
            <button onClick={addManager} className="bg-indigo-600 text-white px-4 rounded-lg font-bold flex items-center gap-1"><Plus size={16} /> إضافة</button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {managers.length === 0 ? <p className="text-center text-slate-400 text-sm py-4">لا يوجد مدراء</p>
              : managers.map((m) => <div key={m.id} className="bg-slate-50 dark:bg-slate-900/40 rounded-lg px-3 py-2 font-bold text-slate-700 dark:text-slate-200">{m.name}</div>)}
          </div>
        </div>
      </div>

      {/* سجل السحوبات */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
        <h2 className="text-base font-black text-slate-800 dark:text-white mb-4">سجل سحوبات المدراء</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="p-2">التاريخ</th><th className="p-2">المدير</th><th className="p-2">المبلغ</th><th className="p-2">الوسيلة</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="text-center text-slate-400 py-6">جاري التحميل...</td></tr>
              ) : withdrawals.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-slate-400 py-6">لا توجد سحوبات</td></tr>
              ) : withdrawals.map((w) => (
                <tr key={w.id} className="border-b border-slate-100 dark:border-slate-700/50">
                  <td className="p-2">{new Date(w.created_at).toLocaleString('ar-EG')}</td>
                  <td className="p-2 font-bold text-slate-800 dark:text-slate-100">{w.note}</td>
                  <td className="p-2 font-black text-red-600">{Number(w.amount).toFixed(2)} {cur}</td>
                  <td className="p-2">{METHODS.find((m) => m.key === w.payment_method)?.label || w.payment_method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
