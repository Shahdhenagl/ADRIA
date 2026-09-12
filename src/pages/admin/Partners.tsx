import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Handshake, Plus, Trash2, ArrowDownCircle, ArrowUpCircle, Edit2 } from 'lucide-react';
import { activePaymentKeys, payLabelOf } from '../../utils/paymentMethods';

const TREASURIES = [
  { key: 'shop', label: 'خزنة المحل' },
  { key: 'main', label: 'الخزنة الأساسية' },
];

export default function Partners() {
  const { storeSettings, recordPartnerTransaction, deletePartnerTransaction, recordMainTreasuryIn, recordMainTreasuryOut } = useStore();
  const cur = storeSettings.currency;
  const METHODS = activePaymentKeys(storeSettings as any).map((k) => ({ key: k, label: payLabelOf(storeSettings as any, k) }));
  const input = 'w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none';

  const [partners, setPartners] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  // add-partner form
  const [pName, setPName] = useState('');
  const [pShare, setPShare] = useState('');
  const [pOpening, setPOpening] = useState('');

  // transaction form
  const [txPartner, setTxPartner] = useState('');
  const [txType, setTxType] = useState<'deposit' | 'withdraw'>('deposit');
  const [txAmount, setTxAmount] = useState('');
  const [txMethod, setTxMethod] = useState('cash');
  const [txNote, setTxNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingTx, setEditingTx] = useState<any | null>(null); // معاملة قيد التعديل (استبدال)

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { supabase } = await import('../../lib/supabase');
      const [pRes, tRes] = await Promise.all([
        supabase.from('partners').select('*').order('created_at', { ascending: true }),
        supabase.from('partner_transactions').select('*').order('created_at', { ascending: false }),
      ]);
      if (pRes.error) throw new Error(`تعذر تحميل الشركاء: ${pRes.error.message}`);
      if (tRes.error) throw new Error(`تعذر تحميل معاملات الشركاء: ${tRes.error.message}`);
      setPartners((pRes.data as any[]) || []);
      setTxs((tRes.data as any[]) || []);
    } catch (e: any) {
      console.error(e);
      setLoadError(e?.message || 'تعذر تحميل بيانات الشركاء');
    }
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
    const opening = Math.max(0, Number(pOpening) || 0);
    const share = Math.max(0, Number(pShare) || 0);
    if (share > 100) { alert('نسبة الشريك لا يمكن أن تتجاوز 100%'); return; }
    if (totalShare + share > 100.001) { alert(`مجموع النسب سيتجاوز 100% (${(totalShare + share).toFixed(2)}%)`); return; }
    const { supabase } = await import('../../lib/supabase');
    const { data, error } = await supabase.from('partners').insert({ name: pName.trim(), share_percent: share, opening_balance: opening }).select().single();
    if (error) { alert('فشل: ' + error.message); return; }
    if (data) {
      if (opening > 0) {
        const note = `[PARTNER_OPENING:${data.id}] رأس مال افتتاحي للشريك: ${pName.trim()}`;
        const cashRecorded = await recordMainTreasuryIn({ cash: opening }, 'partner_capital_opening', note, new Date().toISOString());
        if (!cashRecorded) {
          await supabase.from('partners').delete().eq('id', data.id);
          alert('تم إلغاء إضافة الشريك لأن إيداع رأس المال في الخزنة الرئيسية فشل.');
          return;
        }
      }
      setPartners((p) => [...p, data as any]); setPName(''); setPShare(''); setPOpening('');
    }
  };

  const editPartner = async (p: any) => {
    const share = prompt(`نسبة ${p.name} %`, String(p.share_percent ?? 0));
    if (share === null) return;
    const opening = prompt(`الرصيد الافتتاحي النقدي لـ ${p.name}`, String(p.opening_balance ?? 0));
    if (opening === null) return;
    const oldOpening = Math.max(0, Number(p.opening_balance) || 0);
    const newOpening = Math.max(0, Number(opening) || 0);
    const nextShare = Math.max(0, Number(share) || 0);
    const otherShares = totalShare - (Number(p.share_percent) || 0);
    if (nextShare > 100 || otherShares + nextShare > 100.001) { alert('مجموع نسب الشركاء لا يمكن أن يتجاوز 100%'); return; }
    const { supabase } = await import('../../lib/supabase');
    const delta = newOpening - oldOpening;
    if (Math.abs(delta) > 0.001) {
      const note = `[PARTNER_OPENING:${p.id}] رأس مال افتتاحي للشريك: ${p.name}`;
      const ok = delta > 0
        ? await recordMainTreasuryIn({ cash: delta }, 'partner_capital_opening', note, new Date().toISOString())
        : await recordMainTreasuryOut({ cash: Math.abs(delta) }, 'partner_capital_opening_reversal', note, new Date().toISOString());
      if (!ok) { alert('تعذّر تحديث أثر رأس المال في الخزنة الرئيسية.'); return; }
    }
    const { error } = await supabase.from('partners').update({ share_percent: nextShare, opening_balance: newOpening }).eq('id', p.id);
    if (error) {
      // لا نترك فرقاً في الخزنة إذا فشل تحديث سجل الشريك بعد تسجيل delta.
      if (Math.abs(delta) > 0.001) {
        const rollbackNote = `[PARTNER_OPENING:${p.id}] عكس فشل تعديل رأس المال: ${p.name}`;
        if (delta > 0) await recordMainTreasuryOut({ cash: delta }, 'partner_capital_opening_rollback', rollbackNote, new Date().toISOString());
        else await recordMainTreasuryIn({ cash: Math.abs(delta) }, 'partner_capital_opening_rollback', rollbackNote, new Date().toISOString());
      }
      alert('تعذّر تحديث بيانات الشريك وتمت محاولة عكس أثر الخزنة: ' + error.message); return;
    }
    setPartners((arr) => arr.map((x) => (x.id === p.id ? { ...x, share_percent: nextShare, opening_balance: newOpening } : x)));
  };

  const removePartner = async (p: any) => {
    const linkedRows = txs.filter((t) => t.partner_id === p.id);
    if (linkedRows.length > 0) {
      alert('لا يمكن حذف الشريك لأن لديه معاملات مالية. احذف أو اعكس المعاملات أولًا حتى لا يختل رصيد الخزنة والتقارير.');
      return;
    }
    const opening = Math.max(0, Number(p.opening_balance) || 0);
    if (!confirm(opening > 0
      ? `حذف الشريك ${p.name}؟\nسيتم عكس رأس المال الافتتاحي ${opening.toFixed(2)} ${cur} من الخزنة الرئيسية ثم حذف الشريك.`
      : `حذف الشريك ${p.name}؟`)) return;
    const { supabase } = await import('../../lib/supabase');
    if (opening > 0) {
      const { data: openingTx, error: openingLookupError } = await supabase
        .from('savings_transactions')
        .select('id,amount,method,note')
        .eq('source', 'partner_capital_opening')
        .ilike('note', `%[PARTNER_OPENING:${p.id}]%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openingLookupError || !openingTx) {
        alert('تعذر العثور على حركة رأس المال الافتتاحي، لذلك لم يتم حذف الشريك حفاظًا على تطابق الخزنة.');
        return;
      }
      const reversed = await recordMainTreasuryOut({ [openingTx.method || 'cash']: Number(openingTx.amount) || opening }, 'partner_capital_opening_reversal', `عكس رأس مال افتتاحي للشريك: ${p.name}`, new Date().toISOString());
      if (!reversed) { alert('تعذر عكس رأس المال من الخزنة، ولم يتم حذف الشريك.'); return; }
      const { error: openingDeleteError } = await supabase.from('savings_transactions').delete().eq('id', openingTx.id);
      if (openingDeleteError) { alert('تم عكس رأس المال لكن تعذر حذف القيد الأصلي: ' + openingDeleteError.message); return; }
    }
    const { error } = await supabase.from('partners').delete().eq('id', p.id);
    if (error) { alert('فشل حذف الشريك: ' + error.message); return; }
    setPartners((arr) => arr.filter((x) => x.id !== p.id));
  };

  const resetTxForm = () => { setTxAmount(''); setTxNote(''); setEditingTx(null); };

  const availableForWithdrawal = (partnerId: string) => {
    const stats = partnerStats(partnerId);
    if (!editingTx || editingTx.partner_id !== partnerId) return stats.net;
    // عند تعديل حركة قديمة، أخرج أثرها مؤقتاً حتى لا تمنعنا من استبدالها
    // بسحب صحيح أو تجعل الرصيد المتاح أكبر من الحقيقي.
    return stats.net + (editingTx.type === 'withdraw' ? Number(editingTx.amount) || 0 : -(Number(editingTx.amount) || 0));
  };

  const submitTx = async () => {
    const partner = partners.find((p) => p.id === txPartner);
    if (!partner) { alert('اختر الشريك'); return; }
    const amt = Number(txAmount) || 0;
    if (amt <= 0) { alert('أدخل مبلغاً صحيحاً'); return; }
    if (txType === 'withdraw') {
      const available = Math.max(0, availableForWithdrawal(partner.id));
      if (amt > available + 0.001) {
        alert(`لا يمكن سحب ${amt.toFixed(2)} ${cur}. المتاح لرأس مال الشريك ${partner.name} هو ${available.toFixed(2)} ${cur}.`);
        return;
      }
    }
    setSaving(true);
    // نسجّل الجديد الأول، وبعدين نحذف القديم (لو تعديل) — عشان ما يحصلش فقدان بيانات لو فشل أي خطوة.
    const ok = await recordPartnerTransaction({ partner_id: partner.id, partner_name: partner.name, type: txType, amount: amt, treasury: 'main', method: txMethod, note: txNote.trim() });
    if (ok && editingTx) await deletePartnerTransaction(editingTx);
    setSaving(false);
    if (ok) { alert(editingTx ? 'تم تعديل المعاملة ✅' : 'تم تسجيل المعاملة ✅'); resetTxForm(); load(); }
  };

  const startEditTx = (t: any) => {
    setEditingTx(t);
    setTxPartner(t.partner_id);
    setTxType(t.type);
    setTxAmount(String(t.amount ?? ''));
    setTxMethod(t.method || 'cash');
    setTxNote(t.note || '');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeTx = async (t: any) => {
    if (!confirm(`حذف ${t.type === 'withdraw' ? 'سحب' : 'إيداع'} الشريك ${t.partner_name} بمبلغ ${Number(t.amount).toFixed(2)} ${cur}؟\nسيتم عكسه من الخزنة الرئيسية.`)) return;
    const ok = await deletePartnerTransaction(t);
    if (ok) { alert('تم الحذف وعكس الأثر ✅'); load(); }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><Handshake className="text-indigo-600" size={30} /> الشركاء</h1>
        <p className="text-slate-500 mt-1 font-medium text-sm">نِسب الشركاء، الرصيد الافتتاحي، والإيداع/السحب لكل شريك</p>
      </div>
      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 font-bold flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={load} className="underline whitespace-nowrap">إعادة المحاولة</button>
        </div>
      )}

      {totalShare !== 100 && partners.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-2 text-sm font-bold text-amber-700 dark:text-amber-300">
          ⚠️ مجموع نسب الشركاء = {totalShare}% (المفروض 100%)
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* New transaction */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-black text-slate-800 dark:text-white">{editingTx ? 'تعديل معاملة' : 'إيداع / سحب'}</h2>
            {editingTx && <button onClick={resetTxForm} className="text-[11px] font-black text-red-500 hover:underline">إلغاء التعديل</button>}
          </div>
          <select className={input} value={txPartner} onChange={(e) => setTxPartner(e.target.value)}>
            <option value="">اختر الشريك</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.share_percent || 0}%)</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTxType('deposit')} className={`py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-1 ${txType === 'deposit' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}><ArrowDownCircle size={16} /> إضافة رأس مال</button>
            <button onClick={() => setTxType('withdraw')} className={`py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-1 ${txType === 'withdraw' ? 'bg-red-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}><ArrowUpCircle size={16} /> صرف رأس مال</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div><label className="text-[11px] font-bold text-slate-500">المبلغ</label><input className={input} type="number" placeholder="0" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} /></div>
            <div><label className="text-[11px] font-bold text-slate-500">الطريقة</label><select className={input} value={txMethod} onChange={(e) => setTxMethod(e.target.value)}>{METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
            <div><label className="text-[11px] font-bold text-slate-500">ملاحظة</label><input className={input} value={txNote} onChange={(e) => setTxNote(e.target.value)} placeholder="اختياري" /></div>
          </div>
          <p className="text-[11px] text-slate-400">إضافة رأس المال تزيد رصيد الشريك والخزنة الرئيسية، وصرف رأس المال ينقص رصيده ويخرج من الرئيسية. لا يُحسب أي منهما إيرادًا أو مصروفًا أو ربحًا.</p>
          {txPartner && <p className="text-xs font-black text-indigo-600">المتاح للصرف: {Math.max(0, availableForWithdrawal(txPartner)).toFixed(2)} {cur}</p>}
          <button onClick={submitTx} disabled={saving} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black py-3 rounded-xl">{saving ? 'جاري...' : editingTx ? 'حفظ التعديل' : 'تسجيل المعاملة'}</button>
        </div>

        {/* Add partner */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <h2 className="text-base font-black text-slate-800 dark:text-white">إضافة شريك</h2>
          <div className="grid grid-cols-1 gap-2">
            <input className={input} placeholder="اسم الشريك" value={pName} onChange={(e) => setPName(e.target.value)} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="text-[11px] font-bold text-slate-500">النسبة %</label><input className={input} type="number" placeholder="0" value={pShare} onChange={(e) => setPShare(e.target.value)} /></div>
              <div><label className="text-[11px] font-bold text-slate-500">رأس مال افتتاحي نقدي</label><input className={input} type="number" placeholder="0" value={pOpening} onChange={(e) => setPOpening(e.target.value)} /></div>
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
                <thead><tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700"><th className="p-2">التاريخ</th><th className="p-2">النوع</th><th className="p-2">المبلغ</th><th className="p-2">الخزنة</th><th className="p-2">الطريقة</th><th className="p-2">ملاحظة</th><th className="p-2"></th></tr></thead>
                <tbody>
                  {s.rows.length === 0 ? <tr><td colSpan={7} className="text-center text-slate-400 py-6">لا توجد معاملات</td></tr>
                    : s.rows.map((t) => (
                      <tr key={t.id} className="border-b border-slate-100 dark:border-slate-700/50">
                        <td className="p-2">{new Date(t.created_at).toLocaleString('ar-EG')}</td>
                        <td className="p-2 font-bold"><span className={t.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}>{t.type === 'deposit' ? 'إيداع' : 'سحب'}</span></td>
                        <td className={`p-2 font-black ${t.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}`}>{Number(t.amount).toFixed(2)} {cur}</td>
                        <td className="p-2">{TREASURIES.find((x) => x.key === t.treasury)?.label || t.treasury}</td>
                        <td className="p-2">{METHODS.find((x) => x.key === t.method)?.label || t.method}</td>
                        <td className="p-2 text-slate-600 dark:text-slate-300">{t.note || '-'}</td>
                        <td className="p-2 whitespace-nowrap">
                          <button onClick={() => startEditTx(t)} className="text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 p-1.5 rounded-lg" title="تعديل"><Edit2 size={15} /></button>
                          <button onClick={() => removeTx(t)} className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 rounded-lg" title="حذف"><Trash2 size={15} /></button>
                        </td>
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
