import { useEffect, useMemo, useState } from 'react';
import { useStore, HELD_STATUS_LABEL, HELD_KIND_LABEL, type HeldInvoice, type HeldStatus } from '../../store/useStore';
import { PackageSearch, Search, Truck, CheckCircle2, XCircle, AlertTriangle, Clock, RefreshCw, Store } from 'lucide-react';
import { activePaymentKeys, payLabelOf } from '../../utils/paymentMethods';
import { formatQty } from '../../utils/units';

// حد اعتبار الحجز «قديم» — بعده بيتلوّن تحذيري في القائمة وبيتعدّ في بطاقة التنبيه.
const STALE_DAYS = 14;

const STATUS_STYLE: Record<HeldStatus, string> = {
  held: 'bg-amber-50 text-amber-700 border-amber-200',
  shipped: 'bg-violet-50 text-violet-700 border-violet-200',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

type Filter = 'active' | HeldStatus | 'stale';

export default function HeldInvoices() {
  const { storeSettings, loadAllHeldInvoices, setHeldInvoiceStatus, deliverHeldInvoice, returnHeldInvoice, loadHeldInvoices } = useStore();
  const cur = storeSettings.currency;
  const payKeys = activePaymentKeys(storeSettings as any);

  const [rows, setRows] = useState<HeldInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // مودال التحصيل عند التسليم
  const [collecting, setCollecting] = useState<HeldInvoice | null>(null);
  const [collectPay, setCollectPay] = useState<Record<string, string>>({});

  const refresh = async () => {
    setLoading(true);
    try { setRows(await loadAllHeldInvoices()); } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const ageDaysOf = (r: HeldInvoice) =>
    Math.max(0, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000));
  const isActive = (r: HeldInvoice) => r.status === 'held' || r.status === 'shipped';
  const isStale = (r: HeldInvoice) => isActive(r) && ageDaysOf(r) >= STALE_DAYS;

  const stats = useMemo(() => ({
    held: rows.filter((r) => r.status === 'held').length,
    shipped: rows.filter((r) => r.status === 'shipped').length,
    stale: rows.filter(isStale).length,
    reservedValue: rows.filter(isActive).reduce((s, r) => s + (Number(r.total) || 0), 0),
    depositsHeld: rows.filter(isActive).reduce((s, r) => s + (Number(r.deposit) || 0), 0),
  }), [rows]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'active' && !isActive(r)) return false;
      if (filter === 'stale' && !isStale(r)) return false;
      if (filter !== 'active' && filter !== 'stale' && r.status !== filter) return false;
      if (!q) return true;
      return (r.customer_name || '').toLowerCase().includes(q)
        || (r.customer_phone || '').includes(q)
        || (r.items || []).some((i: any) => (i.name || '').toLowerCase().includes(q));
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [rows, filter, search]);

  const doShip = async (r: HeldInvoice) => {
    if (!confirm(`تغيير حالة طلب «${r.customer_name || 'عميل'}» إلى «تم الشحن»؟`)) return;
    setBusyId(r.id);
    try { if (await setHeldInvoiceStatus(r.id, 'shipped')) await refresh(); } finally { setBusyId(null); }
  };

  const doCancel = async (r: HeldInvoice) => {
    const dep = Number(r.deposit) || 0;
    const msg = dep > 0
      ? `إلغاء الطلب وإرجاع الأصناف للمخزون، ورد العربون (${dep.toFixed(2)} ${cur}) للعميل من الدرج. متابعة؟`
      : 'إلغاء الطلب وإرجاع الأصناف للمخزون. متابعة؟';
    if (!confirm(msg)) return;
    setBusyId(r.id);
    try {
      // returnHeldInvoice بيشتغل على النسخة المحمّلة في الستور، فنحدّثها الأول.
      await loadHeldInvoices();
      if (await returnHeldInvoice(r.id)) await refresh();
    } finally { setBusyId(null); }
  };

  const openCollect = async (r: HeldInvoice) => {
    await loadHeldInvoices();
    setCollecting(r);
    const remaining = Math.max(0, (Number(r.total) || 0) - (Number(r.deposit) || 0));
    setCollectPay({ [payKeys[0] || 'cash']: remaining ? String(remaining) : '' });
  };

  const doDeliver = async () => {
    if (!collecting) return;
    const split: Record<string, number> = {};
    payKeys.forEach((k) => { split[k] = parseFloat(collectPay[k] || '') || 0; });
    const paid = payKeys.reduce((s, k) => s + split[k], 0);
    const remaining = Math.max(0, (Number(collecting.total) || 0) - (Number(collecting.deposit) || 0));
    if (paid < remaining - 0.01 && !confirm(`المحصّل (${paid.toFixed(2)}) أقل من الباقي (${remaining.toFixed(2)}).\nالفرق هيتسجّل آجل على العميل. متابعة؟`)) return;
    setBusyId(collecting.id);
    try {
      if (await deliverHeldInvoice(collecting.id, split)) {
        setCollecting(null); setCollectPay({});
        await refresh();
        alert('✅ تم تسليم الطلب وتسجيله كفاتورة بيع.');
      }
    } finally { setBusyId(null); }
  };

  const Chip = ({ id, label, count, tone }: { id: Filter; label: string; count?: number; tone?: string }) => (
    <button
      onClick={() => setFilter(id)}
      className={`px-3 py-2 rounded-xl text-sm font-black border transition ${filter === id ? 'bg-indigo-600 text-white border-indigo-600' : `bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 ${tone || 'text-slate-600 dark:text-slate-300'}`}`}
    >
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
            <PackageSearch className="text-indigo-600" /> الفواتير المعلقة والطلبات
          </h1>
          <p className="text-sm text-slate-500 font-medium mt-1">
            حجوزات المحل والطلبات الأونلاين — الأصناف محجوزة من المخزون لحد ما تتسلّم أو تتلغي.
          </p>
        </div>
        <button onClick={refresh} disabled={loading} className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-xl font-bold text-sm disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {/* بطاقات الملخّص */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'معلقة', value: stats.held, icon: Clock, tone: 'text-amber-600' },
          { label: 'تم الشحن', value: stats.shipped, icon: Truck, tone: 'text-violet-600' },
          { label: `قديمة (+${STALE_DAYS} يوم)`, value: stats.stale, icon: AlertTriangle, tone: stats.stale > 0 ? 'text-red-600' : 'text-slate-400' },
          { label: 'قيمة محجوزة', value: `${stats.reservedValue.toFixed(0)} ${cur}`, icon: Store, tone: 'text-indigo-600' },
          { label: 'عرابين بالخزنة', value: `${stats.depositsHeld.toFixed(0)} ${cur}`, icon: CheckCircle2, tone: 'text-emerald-600' },
        ].map((c) => (
          <div key={c.label} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500"><c.icon size={14} /> {c.label}</div>
            <div className={`text-xl font-black mt-1 ${c.tone}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* تنبيه الحجوزات القديمة */}
      {stats.stale > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="text-red-600 shrink-0 mt-0.5" size={20} />
          <div className="text-sm">
            <p className="font-black text-red-700 dark:text-red-400">
              فيه {stats.stale} حجز عدّى عليه أكتر من {STALE_DAYS} يوم من غير حركة
            </p>
            <p className="text-red-600/80 dark:text-red-400/70 font-medium mt-0.5">
              الأصناف دي مخصومة من المخزون ومش متاحة للبيع. راجعها: سلّمها أو ألغيها عشان ترجع للمخزون.
            </p>
            <button onClick={() => setFilter('stale')} className="mt-2 text-xs font-black bg-red-600 text-white px-3 py-1.5 rounded-lg">عرضها</button>
          </div>
        </div>
      )}

      {/* فلاتر + بحث */}
      <div className="flex flex-wrap gap-2 items-center">
        <Chip id="active" label="النشطة" count={stats.held + stats.shipped} />
        <Chip id="held" label={HELD_STATUS_LABEL.held} />
        <Chip id="shipped" label={HELD_STATUS_LABEL.shipped} />
        <Chip id="delivered" label={HELD_STATUS_LABEL.delivered} />
        <Chip id="cancelled" label={HELD_STATUS_LABEL.cancelled} />
        <Chip id="stale" label="قديمة" count={stats.stale} tone="text-red-600" />
        <div className="relative mr-auto min-w-[220px]">
          <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="اسم العميل أو تليفونه أو صنف..."
            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pr-9 pl-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* القائمة */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 font-bold">جارٍ التحميل...</div>
      ) : list.length === 0 ? (
        <div className="py-16 text-center text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <PackageSearch size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-bold">لا توجد طلبات في هذا الفلتر</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => {
            const age = ageDaysOf(r);
            const dep = Number(r.deposit) || 0;
            const remaining = Math.max(0, (Number(r.total) || 0) - dep);
            const st = (r.status || 'held') as HeldStatus;
            const stale = isStale(r);
            return (
              <div key={r.id} className={`bg-white dark:bg-slate-800 rounded-2xl p-4 border ${stale ? 'border-red-300 dark:border-red-800' : 'border-slate-200 dark:border-slate-700'}`}>
                <div className="flex flex-wrap justify-between items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${r.kind === 'online' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                        {r.kind === 'online' ? '🚚' : '🏬'} {HELD_KIND_LABEL[r.kind || 'shop']}
                      </span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${STATUS_STYLE[st]}`}>{HELD_STATUS_LABEL[st]}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${stale ? 'bg-red-100 text-red-700' : 'text-slate-400'}`}>
                        {age === 0 ? 'اليوم' : `من ${age} يوم`}
                      </span>
                    </div>
                    <div className="font-black text-slate-800 dark:text-white mt-1.5">
                      {r.customer_name?.trim() || 'عميل نقدي'}
                      {r.customer_phone && <span className="text-xs font-bold text-slate-400 mr-2" dir="ltr">{r.customer_phone}</span>}
                    </div>
                    <div className="text-xs text-slate-500 font-medium mt-1 line-clamp-2">
                      {(r.items || []).map((i: any) => `${i.name}×${formatQty(i.quantity, i.unit || 'قطعة')}`).join(' ، ')}
                    </div>
                    {r.notes && <div className="text-[11px] text-slate-400 font-bold mt-1">📝 {r.notes}</div>}
                  </div>

                  <div className="text-left shrink-0">
                    <div className="text-lg font-black text-indigo-600">{Number(r.total).toFixed(2)} <span className="text-[10px] text-slate-400">{cur}</span></div>
                    {dep > 0 && (
                      <div className="text-[11px] font-black mt-1 space-y-0.5">
                        <div className="text-emerald-600">عربون: {dep.toFixed(2)}</div>
                        {isActive(r) && <div className="text-amber-600">باقي: {remaining.toFixed(2)}</div>}
                      </div>
                    )}
                    {st === 'delivered' && r.order_id && (
                      <div className="text-[10px] font-bold text-slate-400 mt-1">فاتورة #{r.order_id}</div>
                    )}
                  </div>
                </div>

                {isActive(r) && (
                  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                    {r.kind === 'online' && st === 'held' && (
                      <button onClick={() => doShip(r)} disabled={busyId === r.id}
                        className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-2 rounded-xl font-black text-xs disabled:opacity-50">
                        <Truck size={14} /> تم الشحن
                      </button>
                    )}
                    <button onClick={() => openCollect(r)} disabled={busyId === r.id}
                      className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl font-black text-xs disabled:opacity-50">
                      <CheckCircle2 size={14} /> تم التسليم وتحصيل
                    </button>
                    <button onClick={() => doCancel(r)} disabled={busyId === r.id}
                      className="flex items-center gap-1.5 bg-white dark:bg-slate-800 text-red-600 border border-red-200 px-3 py-2 rounded-xl font-black text-xs disabled:opacity-50">
                      <XCircle size={14} /> إلغاء وإرجاع للمخزون
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* مودال التحصيل */}
      {collecting && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-700">
            <div className="p-5 border-b border-slate-100 dark:border-slate-700">
              <h3 className="font-black text-lg text-slate-800 dark:text-white">تسليم وتحصيل</h3>
              <p className="text-xs text-slate-500 font-bold mt-0.5">{collecting.customer_name || 'عميل نقدي'}</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-4 text-sm font-bold space-y-1">
                <div className="flex justify-between"><span className="text-slate-500">إجمالي الطلب</span><span>{Number(collecting.total).toFixed(2)} {cur}</span></div>
                {Number(collecting.deposit) > 0 && (
                  <div className="flex justify-between text-emerald-600"><span>عربون محصّل مقدماً</span><span>− {Number(collecting.deposit).toFixed(2)}</span></div>
                )}
                <div className="flex justify-between text-base font-black border-t border-slate-200 dark:border-slate-700 pt-1 mt-1">
                  <span>المطلوب تحصيله</span>
                  <span className="text-indigo-600">{Math.max(0, Number(collecting.total) - Number(collecting.deposit || 0)).toFixed(2)} {cur}</span>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-500 uppercase mb-2 block">المحصّل الآن وطريقة الدفع</label>
                <div className="grid grid-cols-2 gap-3">
                  {payKeys.map((k) => (
                    <div key={k}>
                      <label className="text-[10px] font-black text-slate-400 block mb-1">{payLabelOf(storeSettings as any, k)}</label>
                      <input type="number" dir="ltr" value={collectPay[k] || ''} onChange={(e) => setCollectPay((s) => ({ ...s, [k]: e.target.value }))}
                        placeholder="0.00" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 font-black text-left outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 font-bold mt-2">لو حصّلت أقل من المطلوب، الفرق هيتسجّل آجل على العميل.</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setCollecting(null); setCollectPay({}); }} className="flex-1 py-3 rounded-2xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-black">إلغاء</button>
                <button onClick={doDeliver} disabled={busyId === collecting.id} className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white font-black disabled:opacity-50">
                  {busyId === collecting.id ? 'جارٍ...' : 'تأكيد التسليم'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
