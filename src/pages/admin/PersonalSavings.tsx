import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { supabase, fetchAllRows } from '../../lib/supabase';
import { activePaymentKeys, payLabelOf, savingsOpeningBalanceOf } from '../../utils/paymentMethods';
import { newSavingsGroupId } from '../../utils/treasury';
import { PiggyBank, Plus, Trash2, Wallet, ArrowDownToLine, ArrowUpFromLine, Landmark, User } from 'lucide-react';

type Split = Record<string, number>;

// أنواع الحركات الأربعة على خزنة الادخار.
const OPS = [
  { id: 'from_main',    label: 'إيداع من الخزنة الرئيسية', dir: 'in'  as const, touchesMain: true,  needsOtp: true,  cap: 'main'  as const, icon: ArrowDownToLine, hint: 'بيتسحب من الخزنة الرئيسية' },
  { id: 'personal_in',  label: 'إيداع من حسابي الشخصي',   dir: 'in'  as const, touchesMain: false, needsOtp: false, cap: 'none'  as const, icon: User,            hint: 'فلوس من برا — ملهاش علاقة بالرئيسية' },
  { id: 'personal_out', label: 'سحب لحسابي الشخصي',       dir: 'out' as const, touchesMain: false, needsOtp: false, cap: 'vault' as const, icon: User,            hint: 'بتطلعها لجيبك — ملهاش علاقة بالرئيسية' },
  { id: 'to_main',      label: 'سحب للخزنة الرئيسية',      dir: 'out' as const, touchesMain: true,  needsOtp: false, cap: 'vault' as const, icon: ArrowUpFromLine, hint: 'بيتسجّل إيداع في الخزنة الرئيسية' },
];
const opById = (id: string) => OPS.find((o) => o.id === id)!;

export default function PersonalSavings() {
  const { storeSettings, recordMainTreasuryIn, recordMainTreasuryOut } = useStore();
  const cur = storeSettings.currency;
  const keys = activePaymentKeys(storeSettings as any);
  const input = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none';

  const [vaults, setVaults] = useState<any[]>([]);
  const [vaultTxs, setVaultTxs] = useState<any[]>([]);
  const [savingsTxs, setSavingsTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedVaultId, setSelectedVaultId] = useState<string>('');
  const [opId, setOpId] = useState<string>('from_main');
  const [amt, setAmt] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [busy, setBusy] = useState(false);

  const op = opById(opId);

  const load = async () => {
    setLoading(true);
    try {
      const [vRows, vtRows, sRows] = await Promise.all([
        supabase.from('savings_vaults').select('*').order('created_at', { ascending: true }),
        fetchAllRows('savings_vault_transactions'),
        fetchAllRows('savings_transactions'),
      ]);
      const vs = (vRows.data as any[]) || [];
      setVaults(vs);
      setVaultTxs((vtRows as any[]) || []);
      setSavingsTxs((sRows as any[]) || []);
      if (!selectedVaultId && vs.length) setSelectedVaultId(vs[0].id);
    } catch (e) {
      console.error(e);
      alert('تعذّر تحميل بيانات الادخار — تأكدي إن ملف db/57 اتشغّل على قاعدة البيانات.');
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ── الأرصدة ────────────────────────────────────────────────────────────────
  // رصيد الخزنة الرئيسية لكل وسيلة = افتتاحي + (داخل − خارج) من دفتر الرئيسية.
  const mainBal = useMemo(() => {
    const b: Split = {};
    keys.forEach((k) => { b[k] = savingsOpeningBalanceOf(storeSettings as any, k); });
    savingsTxs.forEach((t) => { const m = t.method || 'cash'; if (b[m] === undefined) return; b[m] += (t.direction === 'in' ? 1 : -1) * (Number(t.amount) || 0); });
    return b;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savingsTxs, storeSettings, keys.join(',')]);

  // رصيد كل خزنة ادخار لكل وسيلة = (داخل − خارج).
  const vaultBalById = useMemo(() => {
    const map: Record<string, Split> = {};
    vaults.forEach((v) => { map[v.id] = {}; keys.forEach((k) => { map[v.id][k] = 0; }); });
    vaultTxs.forEach((t) => {
      const b = map[t.vault_id]; if (!b) return;
      const m = t.method || 'cash'; if (b[m] === undefined) return;
      b[m] += (t.direction === 'in' ? 1 : -1) * (Number(t.amount) || 0);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaults, vaultTxs, keys.join(',')]);

  const balTotal = (b?: Split) => (b ? keys.reduce((s, k) => s + (b[k] || 0), 0) : 0);
  const selectedBal = vaultBalById[selectedVaultId];

  // ملخّص شخصي عبر كل الخزائن.
  const personal = useMemo(() => {
    let inSelf = 0, outSelf = 0, fromMain = 0, toMain = 0;
    vaultTxs.forEach((t) => {
      const a = Number(t.amount) || 0;
      if (t.source === 'personal_in') inSelf += a;
      else if (t.source === 'personal_out') outSelf += a;
      else if (t.source === 'from_main') fromMain += a;
      else if (t.source === 'to_main') toMain += a;
    });
    const vaultsTotal = vaults.reduce((s, v) => s + balTotal(vaultBalById[v.id]), 0);
    return { inSelf, outSelf, netSelf: inSelf - outSelf, fromMain, toMain, vaultsTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultTxs, vaults, vaultBalById]);

  // ── سقف المبلغ حسب نوع الحركة ────────────────────────────────────────────────
  const capBal: Split | null = op.cap === 'main' ? mainBal : op.cap === 'vault' ? (selectedBal || null) : null;
  const money = (n: number) => (n < 0 ? `-${Math.abs(n).toLocaleString()}` : n.toLocaleString());

  // ── إدارة الخزائن ────────────────────────────────────────────────────────────
  const addVault = async () => {
    const name = window.prompt('اسم خزنة الادخار الجديدة (مثلاً: ادخار البيت):');
    if (!name || !name.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.from('savings_vaults').insert({ name: name.trim() }).select().single();
      if (error) throw error;
      await load();
      if (data) setSelectedVaultId((data as any).id);
    } catch (e: any) { alert('تعذّر إنشاء الخزنة: ' + (e?.message || '')); }
    setBusy(false);
  };

  const deleteVault = async (v: any) => {
    if (Math.abs(balTotal(vaultBalById[v.id])) > 0.01) { alert('مينفعش تحذفي خزنة رصيدها مش صفر. فرّغيها الأول (سحب لحسابك أو للرئيسية).'); return; }
    if (!window.confirm(`حذف خزنة «${v.name}»؟ (رصيدها صفر)`)) return;
    setBusy(true);
    try {
      await supabase.from('savings_vaults').delete().eq('id', v.id);
      if (selectedVaultId === v.id) setSelectedVaultId('');
      await load();
    } catch (e: any) { alert('تعذّر حذف الخزنة: ' + (e?.message || '')); }
    setBusy(false);
  };

  // ── تنفيذ الحركة ─────────────────────────────────────────────────────────────
  const splitOf = () => { const s: Split = {}; keys.forEach((k) => { s[k] = Number(amt[k]) || 0; }); return s; };
  const total = keys.reduce((s, k) => s + (Number(amt[k]) || 0), 0);

  const detailsText = () => {
    const v = vaults.find((x) => x.id === selectedVaultId);
    const lines = keys.filter((k) => (Number(amt[k]) || 0) > 0).map((k) => `${payLabelOf(storeSettings as any, k)}: ${(Number(amt[k]) || 0).toFixed(2)}`);
    return `${op.label}\nالخزنة: ${v?.name || '-'}\n${lines.join(' | ')}\nالإجمالي: ${total.toFixed(2)} ${cur}${note.trim() ? `\nملاحظة: ${note.trim()}` : ''}`;
  };

  const validate = () => {
    if (!selectedVaultId) { alert('اختاري خزنة الأول'); return false; }
    if (total <= 0) { alert('أدخلي مبلغاً'); return false; }
    if (capBal) {
      for (const k of keys) {
        if ((Number(amt[k]) || 0) > (capBal[k] || 0) + 0.001) {
          alert(`مبلغ ${payLabelOf(storeSettings as any, k)} أكبر من المتاح (${(capBal[k] || 0).toFixed(2)})`);
          return false;
        }
      }
    }
    return true;
  };

  const token = async () => { const { data } = await supabase.auth.getSession(); return data.session?.access_token; };

  const execute = async () => {
    const dateISO = txDate ? new Date(`${txDate}T12:00:00`).toISOString() : undefined;
    const split = splitOf();
    const groupId = newSavingsGroupId(); // يربط صفوف الحركة (وطرف الرئيسية لو موجود)
    const v = vaults.find((x) => x.id === selectedVaultId);
    const desc = `${op.label} - ${v?.name || 'خزنة'}${note.trim() ? ` - ${note.trim()}` : ''}`;

    // طرف الخزنة الرئيسية أولاً (لو الحركة بتلمسها) — لو فشل نوقف قبل ما نكتب في الخزنة.
    if (op.id === 'from_main') {
      const ok = await recordMainTreasuryOut(split as any, 'to_savings_vault', desc, dateISO, groupId as any);
      if (!ok) { alert('تعذّر الخصم من الخزنة الرئيسية'); return false; }
    } else if (op.id === 'to_main') {
      const ok = await recordMainTreasuryIn(split as any, 'from_savings_vault', desc, dateISO, groupId as any);
      if (!ok) { alert('تعذّر الإيداع في الخزنة الرئيسية'); return false; }
    }

    const rows = keys.filter((k) => (split[k] || 0) > 0).map((k) => ({
      vault_id: selectedVaultId,
      direction: op.dir,
      amount: split[k],
      method: k,
      source: op.id,
      note: note.trim() || null,
      group_id: groupId,
      ...(dateISO ? { created_at: dateISO } : {}),
    }));
    const { error } = await supabase.from('savings_vault_transactions').insert(rows);
    if (error) { alert('تعذّر تسجيل الحركة في الخزنة: ' + error.message + (op.touchesMain ? '\n⚠️ طرف الخزنة الرئيسية اتسجّل — راجعيه.' : '')); return false; }
    return true;
  };

  const resetForm = () => { setAmt({}); setNote(''); setOtpInput(''); setOtpSent(false); setTxDate(new Date().toISOString().slice(0, 10)); };

  const onPrimary = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      if (op.needsOtp) {
        const t = await token();
        if (!otpSent) {
          const r = await fetch('/api/wholesale-otp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ action: 'request', purpose: 'savings', details: detailsText() }) });
          const j = await r.json();
          if (j.ok) { setOtpSent(true); alert('اتبعت تفاصيل العملية ورمز تأكيد للمدير على تيليجرام 📲'); }
          else alert('تعذّر إرسال الرمز: ' + (j.error || ''));
          setBusy(false); return;
        }
        if (!otpInput.trim()) { alert('أدخلي رمز التأكيد'); setBusy(false); return; }
        const r = await fetch('/api/wholesale-otp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ action: 'verify', purpose: 'savings', code: otpInput.trim() }) });
        const j = await r.json();
        if (!j.ok) { alert(j.error || 'رمز غير صحيح'); setBusy(false); return; }
      }
      const ok = await execute();
      if (ok) { alert('تمت الحركة ✅'); resetForm(); await load(); }
    } catch (e) { console.error(e); alert('حصل خطأ أثناء تنفيذ الحركة'); }
    setBusy(false);
  };

  // ── سجل حركات الخزنة المختارة (مجمّع بالعملية) ────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map<string, any>();
    vaultTxs.filter((t) => t.vault_id === selectedVaultId).forEach((t) => {
      const key = t.group_id || t.id;
      if (!map.has(key)) map.set(key, { key, group_id: t.group_id, created_at: t.created_at, source: t.source, direction: t.direction, note: t.note, methods: {} as Split, total: 0 });
      const g = map.get(key);
      g.methods[t.method] = (g.methods[t.method] || 0) + (Number(t.amount) || 0);
      g.total += Number(t.amount) || 0;
    });
    return [...map.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [vaultTxs, selectedVaultId]);

  const deleteGroup = async (g: any) => {
    const touchesMain = g.source === 'from_main' || g.source === 'to_main';
    if (!window.confirm(`حذف حركة «${opById(g.source)?.label || g.source}» بمبلغ ${g.total.toLocaleString()} ${cur}؟${touchesMain ? '\nهيتعكس الطرف المقابل في الخزنة الرئيسية كمان.' : ''}`)) return;
    setBusy(true);
    try {
      if (touchesMain && g.group_id) await supabase.from('savings_transactions').delete().eq('group_id', g.group_id);
      if (g.group_id) await supabase.from('savings_vault_transactions').delete().eq('group_id', g.group_id);
      else await supabase.from('savings_vault_transactions').delete().eq('id', g.key);
      await load();
    } catch (e: any) { alert('تعذّر الحذف: ' + (e?.message || '')); }
    setBusy(false);
  };

  const selectedVault = vaults.find((v) => v.id === selectedVaultId);

  return (
    <div className="p-6 md:p-8 space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-800 flex items-center gap-3"><PiggyBank className="text-indigo-600" size={30} /> الادخار الشخصي</h1>
          <p className="text-slate-500 mt-1 font-medium text-sm">خزائن ادخار خاصة بيك — منفصلة عن حسابات المحل. الإيداع من الخزنة الرئيسية بيتأكد بـ OTP.</p>
        </div>
        <button onClick={addVault} disabled={busy} className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-2xl font-bold hover:bg-indigo-700 transition shadow-lg disabled:opacity-50">
          <Plus size={18} /> خزنة جديدة
        </button>
      </div>

      {/* ملخّص شخصي */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-emerald-100 shadow-sm">
          <p className="text-emerald-600 font-bold text-xs mb-1">صافي فلوسك الشخصية</p>
          <h3 className="text-2xl font-black text-emerald-700" dir="ltr">{money(personal.netSelf)} <span className="text-xs font-normal opacity-50">{cur}</span></h3>
          <p className="text-[10px] text-slate-400 mt-1 font-bold">اللي حطيته من جيبك − اللي طلّعته</p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-indigo-100 shadow-sm">
          <p className="text-indigo-600 font-bold text-xs mb-1">إجمالي أرصدة الخزائن</p>
          <h3 className="text-2xl font-black text-indigo-700" dir="ltr">{money(personal.vaultsTotal)} <span className="text-xs font-normal opacity-50">{cur}</span></h3>
          <p className="text-[10px] text-slate-400 mt-1 font-bold">مجموع كل الخزائن حالياً</p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-slate-500 font-bold text-xs mb-1">جاي من الرئيسية</p>
          <h3 className="text-2xl font-black text-slate-700" dir="ltr">{money(personal.fromMain)} <span className="text-xs font-normal opacity-50">{cur}</span></h3>
          <p className="text-[10px] text-slate-400 mt-1 font-bold">إجمالي اللي اتسحب من الخزنة الرئيسية</p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-slate-500 font-bold text-xs mb-1">راجع للرئيسية</p>
          <h3 className="text-2xl font-black text-slate-700" dir="ltr">{money(personal.toMain)} <span className="text-xs font-normal opacity-50">{cur}</span></h3>
          <p className="text-[10px] text-slate-400 mt-1 font-bold">إجمالي اللي رجّعته للخزنة الرئيسية</p>
        </div>
      </div>

      {/* الخزائن */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {vaults.length === 0 && !loading && (
          <div className="col-span-full bg-white rounded-3xl border border-dashed border-slate-200 p-10 text-center text-slate-400">
            <PiggyBank size={48} className="mx-auto opacity-30" />
            <p className="font-bold mt-3">لسه مفيش خزائن ادخار. اضغطي «خزنة جديدة» عشان تبدأي.</p>
          </div>
        )}
        {vaults.map((v) => {
          const b = vaultBalById[v.id];
          const isSel = v.id === selectedVaultId;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelectedVaultId(v.id)}
              className={`text-right bg-white p-5 rounded-3xl border transition-all ${isSel ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-md' : 'border-slate-100 hover:border-indigo-200 hover:shadow-sm'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-slate-800 flex items-center gap-2"><Wallet size={18} className="text-indigo-600" /> {v.name}</span>
                <Trash2
                  size={16}
                  className="text-slate-300 hover:text-red-500 transition"
                  onClick={(e) => { e.stopPropagation(); deleteVault(v); }}
                />
              </div>
              <h3 className="text-2xl font-black text-slate-800 mt-2" dir="ltr">{money(balTotal(b))} <span className="text-xs font-normal opacity-50">{cur}</span></h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {keys.filter((k) => Math.abs(b?.[k] || 0) > 0.001).map((k) => (
                  <span key={k} className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg" dir="ltr">
                    {payLabelOf(storeSettings as any, k)}: {money(b[k])}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {selectedVault && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* نموذج الحركة */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
            <h2 className="font-black text-slate-800 mb-4">حركة على «{selectedVault.name}»</h2>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {OPS.map((o) => {
                const active = o.id === opId;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { setOpId(o.id); setOtpSent(false); setOtpInput(''); }}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition text-right ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-600 border-slate-100 hover:border-indigo-200'}`}
                  >
                    <o.icon size={16} /> {o.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 font-bold mb-4 flex items-center gap-1">
              {op.touchesMain ? <Landmark size={12} /> : <User size={12} />} {op.hint}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {keys.map((k) => (
                <div key={k}>
                  <label className="text-[11px] font-bold text-slate-500 flex items-center justify-between">
                    <span>{payLabelOf(storeSettings as any, k)}</span>
                    {capBal && <span className="text-slate-400" dir="ltr">متاح: {money(capBal[k] || 0)}</span>}
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={amt[k] ?? ''}
                    onChange={(e) => setAmt((p) => ({ ...p, [k]: e.target.value }))}
                    placeholder="0.00"
                    className={input}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-[11px] font-bold text-slate-500">التاريخ</label>
                <input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch {} }}
                  className={input}
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500">ملاحظة (اختياري)</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="..." className={input} />
              </div>
            </div>

            <div className="flex items-center justify-between mb-4 bg-slate-50 rounded-xl px-4 py-2.5">
              <span className="text-xs font-bold text-slate-500">إجمالي الحركة</span>
              <span className="text-lg font-black text-indigo-700" dir="ltr">{total.toLocaleString()} {cur}</span>
            </div>

            {op.needsOtp && otpSent && (
              <input
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value)}
                placeholder="رمز التأكيد من تيليجرام"
                className={`${input} mb-3 text-center tracking-widest`}
              />
            )}

            <button
              onClick={onPrimary}
              disabled={busy || total <= 0}
              className="w-full bg-indigo-600 text-white font-black py-3 rounded-xl hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {busy ? 'جاري التنفيذ...' : op.needsOtp ? (otpSent ? 'تأكيد وتنفيذ' : 'إرسال رمز التأكيد') : 'تنفيذ الحركة'}
            </button>
          </div>

          {/* سجل حركات الخزنة */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
            <h2 className="font-black text-slate-800 mb-4">سجل «{selectedVault.name}»</h2>
            <div className="space-y-2 max-h-[520px] overflow-y-auto">
              {groups.length === 0 && <p className="text-center text-slate-400 py-10 font-bold">لسه مفيش حركات على الخزنة دي.</p>}
              {groups.map((g) => {
                const o = opById(g.source);
                const isIn = g.direction === 'in';
                return (
                  <div key={g.key} className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${isIn ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>{o?.label || g.source}</span>
                        <span className="text-[10px] text-slate-400 font-bold">{new Date(g.created_at).toLocaleDateString('ar-EG', { calendar: 'gregory' })}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {Object.entries(g.methods).map(([k, val]: [string, any]) => (
                          <span key={k} className="text-[10px] font-bold text-slate-500" dir="ltr">{payLabelOf(storeSettings as any, k)}: {Number(val).toLocaleString()}</span>
                        ))}
                      </div>
                      {g.note && <p className="text-[10px] text-slate-400 mt-1 truncate">{g.note}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`font-black ${isIn ? 'text-emerald-600' : 'text-red-600'}`} dir="ltr">{isIn ? '+' : '−'}{g.total.toLocaleString()}</span>
                      <button onClick={() => deleteGroup(g)} disabled={busy} className="p-1.5 text-slate-300 hover:text-red-500 transition disabled:opacity-50" title="حذف"><Trash2 size={15} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
