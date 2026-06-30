import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Handshake, Plus, Trash2, ArrowDownCircle, ArrowUpCircle, Edit2 } from 'lucide-react';
import { activePaymentKeys, payLabelOf } from '../../utils/paymentMethods';

const TREASURIES = [
  { key: 'shop', label: 'خزنة المحل' },
  { key: 'main', label: 'الخزنة الأساسية' },
];

export default function Partners() {
  const { storeSettings, recordPartnerTransaction } = useStore();
  const cur = storeSettings.currency;
  const METHODS = activePaymentKeys(storeSettings as any).map((k) => ({ key: k, label: payLabelOf(storeSettings as any, k) }));
  const input = 'w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none';

  const [partners, setPartners] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // add-partner form
  const [pName, setPName] = useState('');
  const [pShare, setPShare] = useState('');
  const [pOpening, setPOpening] = useState('');

  // transaction form
  const [txPartner, setTxPartner] = useState('');
  const [txType, setTxType] = useState<'deposit' | 'withdraw'>('deposit');
  const [txAmount, setTxAmount] = useState('');
  const [txTreasury, setTxTreasury] = useState('shop');
  const [txMethod, setTxMethod] = useState('cash');
  const [txNote, setTxNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { supabase } = await import('../../lib/supabase');
      const [pRes, tRes] = await Promise.all([
        supabase.from('partners').select('*').order('created_at', { ascending: true }),
        supabase.from('partner_transactions').select('*').order('created_at', { ascending: false }),
      ]);
      setPartners((pRes.data as any[]) || []);
      setTxs((tRes.data as any[]) || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const totalShare = partners.reduce((s, p) => s + (Number(p.share_percent) || 0), 0);
  const partnerStats = (id: string) => {
    const rows = txs.filter((t) => t.partner_id === id);
    const deposits = rows.filter((t) => t.type === 'deposit').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const withdrawals = rows.filter((t) => t.type === 'withdraw').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const opening = Number(partners.find((p) => p.id === id)?.opening_balance) || 0;
    return { deposits, withdrawals, net: opening + deposits - withdrawals, rows };
  };

  const addPartner = async () => {
    if (!pName.trim()) { alert('اسم الشريك مطلوب'); return; }
    const { supabase } = await import('../../lib/supabase');
    const { data, error } = await supabase.from('partners').insert({ name: pName.trim(), share_percent: Number(pShare) || 0, opening_balance: Number(pOpening) || 0 }).select().single();
    if (error) { alert('فشل: ' + error.message); return; }
    if (data) { setPartners((p) => [...p, data as any]); setPName(''); setPShare(''); setPOpening(''); }
  };

  const editPartner = async (p: any) => {
    const share = prompt(`نسبة ${p.name} %`, String(p.share_percent ?? 0));
    if (share === null) return;
    const opening = prompt(`الرصيد الافتتاحي لـ ${p.name}`, String(p.opening_balance ?? 0));
    if (opening === null) return;
    const { supabase } = await import('../../lib/supabase');
    await supabase.from('partners').update({ share_percent: Number(share) || 0, opening_balance: Number(opening) || 0 }).eq('id', p.id);
    setPartners((arr) => arr.map((x) => (x.id === p.id ? { ...x, share_percent: Number(share) || 0, opening_balance: Number(opening) || 0 } : x)));
  };

  const removePartner = async (p: any) => {
    if (!confirm(`حذف الشريك ${p.name}؟ (معاملاته تفضل محفوظة)`)) return;
    const { supabase } = await import('../../lib/supabase');
    await supabase.from('partners').delete().eq('id', p.id);
    setPartners((arr) => arr.filter((x) => x.id !== p.id));
  };

  const submitTx = async () => {
    const partner = partners.find((p) => p.id === txPartner);
    if (!partner) { alert('اختر الشريك'); return; }
    const amt = Number(txAmount) || 0;
    if (amt <= 0) { alert('أدخل مبلغاً صحيحاً'); return; }
    setSaving(true);
    const ok = await recordPartnerTransaction({ partner_id: partner.id, partner_name: partner.name, type: txType, amount: amt, treasury: txTreasury as any, method: txMethod, note: txNote.trim() });
    setSaving(false);
    if (ok) { alert('تم تسجيل المعاملة ✅'); setTxAmount(''); setTxNote(''); load(); }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><Handshake className="text-indigo-600" size={30} /> الشركاء</h1>
        <p className="text-slate-500 mt-1 font-medium text-sm">نِسب الشركاء، الرصيد الافتتاحي، والإيداع/السحب لكل شريك</p>
      </div>

      {totalShare !== 100 && partners.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-2 text-sm font-bold text-amber-700 dark:text-amber-300">
          ⚠️ مجموع نسب الشركاء = {totalShare}% (المفروض 100%)
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* New transaction */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <h2 className="text-base font-black text-slate-800 dark:text-white">إيداع / سحب</h2>
          <select className={input} value={txPartner} onChange={(e) => setTxPartner(e.target.value)}>
            <option value="">اختر الشريك</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.share_percent || 0}%)</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTxType('deposit')} className={`py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-1 ${txType === 'deposit' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}><ArrowDownCircle size={16} /> إيداع</button>
            <button onClick={() => setTxType('withdraw')} className={`py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-1 ${txType === 'withdraw' ? 'bg-red-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}><ArrowUpCircle size={16} /> سحب</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label className="text-[11px] font-bold text-slate-500">المبلغ</label><input className={input} type="number" placeholder="0" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} /></div>
            <div><label className="text-[11px] font-bold text-slate-500">الخزنة</label><select className={input} value={txTreasury} onChange={(e) => setTxTreasury(e.target.value)}>{TREASURIES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
            <div><label className="text-[11px] font-bold text-slate-500">الطريقة</label><select className={input} value={txMethod} onChange={(e) => setTxMethod(e.target.value)}>{METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
            <div><label className="text-[11px] font-bold text-slate-500">ملاحظة</label><input className={input} value={txNote} onChange={(e) => setTxNote(e.target.value)} placeholder="اختياري" /></div>
          </div>
          <p className="text-[11px] text-slate-400">على «خزنة المحل» تتأثر خزنة النظام (إيراد/مصروف)؛ على «الخزنة الأساسية» تُسجَّل في دفتر الشركاء فقط.</p>
          <button onClick={submitTx} disabled={saving} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black py-3 rounded-xl">{saving ? 'جاري...' : 'تسجيل المعاملة'}</button>
        </div>

        {/* Add partner */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <h2 className="text-base font-black text-slate-800 dark:text-white">إضافة شريك</h2>
          <div className="grid grid-cols-1 gap-2">
            <input className={input} placeholder="اسم الشريك" value={pName} onChange={(e) => setPName(e.target.value)} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="text-[11px] font-bold text-slate-500">النسبة %</label><input className={input} type="number" placeholder="0" value={pShare} onChange={(e) => setPShare(e.target.value)} /></div>
              <div><label className="text-[11px] font-bold text-slate-500">رصيد افتتاحي</label><input className={input} type="number" placeholder="0" value={pOpening} onChange={(e) => setPOpening(e.target.value)} /></div>
            </div>
          </div>
          <button onClick={addPartner} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2"><Plus size={18} /> إضافة شريك</button>
        </div>
      </div>

      {/* Partners summary */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
        <h2 className="text-base font-black text-slate-800 dark:text-white mb-4">الشركاء</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead><tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
              <th className="p-2">الشريك</th><th className="p-2">النسبة</th><th className="p-2">رصيد افتتاحي</th><th className="p-2">إجمالي الإيداع</th><th className="p-2">إجمالي السحب</th><th className="p-2">الرصيد الحالي</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="text-center text-slate-400 py-6">جاري التحميل...</td></tr>
                : partners.length === 0 ? <tr><td colSpan={7} className="text-center text-slate-400 py-6">لا يوجد شركاء</td></tr>
                : partners.map((p) => {
                  const s = partnerStats(p.id);
                  return (
                    <tr key={p.id} className={`border-b border-slate-100 dark:border-slate-700/50 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/30 ${selected === p.id ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : ''}`} onClick={() => setSelected(selected === p.id ? null : p.id)}>
                      <td className="p-2 font-black text-slate-800 dark:text-slate-100">{p.name}</td>
                      <td className="p-2 font-bold">{p.share_percent || 0}%</td>
                      <td className="p-2">{(Number(p.opening_balance) || 0).toFixed(2)}</td>
                      <td className="p-2 font-bold text-emerald-600">{s.deposits.toFixed(2)}</td>
                      <td className="p-2 font-bold text-red-600">{s.withdrawals.toFixed(2)}</td>
                      <td className="p-2 font-black text-indigo-600">{s.net.toFixed(2)} {cur}</td>
                      <td className="p-2 whitespace-nowrap">
                        <button onClick={(e) => { e.stopPropagation(); editPartner(p); }} className="text-slate-500 hover:bg-slate-100 p-1.5 rounded-lg"><Edit2 size={15} /></button>
                        <button onClick={(e) => { e.stopPropagation(); removePartner(p); }} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg"><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected partner profile */}
      {selected && (() => {
        const p = partners.find((x) => x.id === selected);
        if (!p) return null;
        const s = partnerStats(selected);
        return (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-indigo-200 dark:border-indigo-800 p-5">
            <h2 className="text-base font-black text-slate-800 dark:text-white mb-1">بروفايل الشريك: {p.name} <span className="text-sm font-bold text-slate-400">({p.share_percent || 0}%)</span></h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 text-center"><div className="text-[11px] font-bold text-slate-500">رصيد افتتاحي</div><div className="font-black text-slate-800 dark:text-slate-100">{(Number(p.opening_balance) || 0).toFixed(2)}</div></div>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center"><div className="text-[11px] font-bold text-emerald-600">إجمالي الإيراد منه</div><div className="font-black text-emerald-700">{s.deposits.toFixed(2)}</div></div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center"><div className="text-[11px] font-bold text-red-600">إجمالي السحوبات</div><div className="font-black text-red-700">{s.withdrawals.toFixed(2)}</div></div>
              <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3 text-center"><div className="text-[11px] font-bold text-indigo-600">الرصيد الحالي</div><div className="font-black text-indigo-700">{s.net.toFixed(2)} {cur}</div></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead><tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700"><th className="p-2">التاريخ</th><th className="p-2">النوع</th><th className="p-2">المبلغ</th><th className="p-2">الخزنة</th><th className="p-2">الطريقة</th><th className="p-2">ملاحظة</th></tr></thead>
                <tbody>
                  {s.rows.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-400 py-6">لا توجد معاملات</td></tr>
                    : s.rows.map((t) => (
                      <tr key={t.id} className="border-b border-slate-100 dark:border-slate-700/50">
                        <td className="p-2">{new Date(t.created_at).toLocaleString('ar-EG')}</td>
                        <td className="p-2 font-bold"><span className={t.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}>{t.type === 'deposit' ? 'إيداع' : 'سحب'}</span></td>
                        <td className={`p-2 font-black ${t.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}`}>{Number(t.amount).toFixed(2)} {cur}</td>
                        <td className="p-2">{TREASURIES.find((x) => x.key === t.treasury)?.label || t.treasury}</td>
                        <td className="p-2">{METHODS.find((x) => x.key === t.method)?.label || t.method}</td>
                        <td className="p-2 text-slate-600 dark:text-slate-300">{t.note || '-'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
