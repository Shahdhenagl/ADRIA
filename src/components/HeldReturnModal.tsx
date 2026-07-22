/**
 * مرتجع طلب أونلاين — العميل ما استلمش الطلب كله أو جزء منه.
 *
 * مشترك بين شاشة الكاشير وموديول لوحة التحكم عشان الاتنين يسجّلوا نفس الحركة
 * بنفس المنطق (الستور: returnHeldItems).
 *   - جزئي: الأصناف المرتجعة بترجع للمخزون والإجمالي بيقلّ، والطلب بيكمّل عادي.
 *   - كلي:  كل الأصناف بترجع، الحالة «مرتجع»، والعربون بيترد.
 * مصاريف شحن المرتجع اختيارية وبتتقيّد مصروف على الخزنة بتاريخ دلوقتي.
 */
import { useMemo, useState } from 'react';
import { useStore, type HeldInvoice } from '../store/useStore';
import { activePaymentKeys, payLabelOf } from '../utils/paymentMethods';
import { formatQty } from '../utils/units';
import { Undo2, X } from 'lucide-react';

interface Props {
  held: HeldInvoice;
  onClose: () => void;
  onDone: () => void;
}

export function HeldReturnModal({ held, onClose, onDone }: Props) {
  const { storeSettings, returnHeldItems } = useStore();
  const cur = storeSettings.currency;
  const payKeys = activePaymentKeys(storeSettings as any);

  const [qty, setQty] = useState<Record<string, string>>({});
  const [shipCost, setShipCost] = useState('');
  const [shipSplit, setShipSplit] = useState<Record<string, string>>({});
  const [shipNote, setShipNote] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => {
    const map: Record<string, number> = {};
    held.items.forEach((it) => {
      const v = parseFloat(qty[it.id] || '') || 0;
      map[it.id] = Math.max(0, Math.min(Number(it.quantity) || 0, v));
    });
    const value = held.items.reduce((s, it) => s + map[it.id] * (Number(it.sale_price) || 0), 0);
    const isFull = held.items.every((it) => map[it.id] >= (Number(it.quantity) || 0) - 0.0001);
    return { map, value, isFull };
  }, [qty, held.items]);

  const cost = Math.max(0, parseFloat(shipCost || '') || 0);
  const remainingTotal = Math.max(0, (Number(held.total) || 0) - parsed.value);

  const returnAll = () => {
    const next: Record<string, string> = {};
    held.items.forEach((it) => { next[it.id] = String(it.quantity); });
    setQty(next);
  };

  const submit = async () => {
    if (parsed.value <= 0 && cost <= 0) { alert('اختاري كمية مرتجعة أو سجّلي مصاريف شحن المرتجع.'); return; }
    const msg = parsed.isFull && parsed.value > 0
      ? `مرتجع كلي: كل الأصناف هترجع للمخزون والطلب هيتقفل كـ «مرتجع»${Number(held.deposit) > 0 ? ` والعربون (${Number(held.deposit).toFixed(2)}) هيترد للعميل` : ''}.${cost > 0 ? `\nومصاريف شحن المرتجع ${cost.toFixed(2)} هتتسجّل مصروف من الخزنة.` : ''}\nمتابعة؟`
      : `مرتجع جزئي بقيمة ${parsed.value.toFixed(2)} ${cur} — إجمالي الطلب هيبقى ${remainingTotal.toFixed(2)} ${cur}.${cost > 0 ? `\nومصاريف شحن المرتجع ${cost.toFixed(2)} هتتسجّل مصروف من الخزنة.` : ''}\nمتابعة؟`;
    if (!confirm(msg)) return;

    const split: Record<string, number> = {};
    payKeys.forEach((k) => { split[k] = parseFloat(shipSplit[k] || '') || 0; });
    const splitSum = Object.values(split).reduce((s, v) => s + v, 0);
    // لو ما حددتش وسيلة، نحطها كلها كاش — أشيع حالة ومش هتسيب المصروف بغير وسيلة.
    if (cost > 0 && splitSum <= 0) split[payKeys[0] || 'cash'] = cost;
    else if (cost > 0 && Math.abs(splitSum - cost) > 0.01) {
      alert(`تقسيمة مصاريف الشحن (${splitSum.toFixed(2)}) لازم تساوي المبلغ (${cost.toFixed(2)}).`);
      return;
    }

    setBusy(true);
    try {
      const ok = await returnHeldItems(held.id, parsed.map, cost > 0 ? { amount: cost, split, note: shipNote.trim() } : undefined);
      if (ok) { alert('✅ تم تسجيل المرتجع.'); onDone(); }
    } finally { setBusy(false); }
  };

  const input = 'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 font-black text-left outline-none focus:ring-2 focus:ring-amber-500';

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-lg text-slate-800 dark:text-white flex items-center gap-2"><Undo2 size={18} className="text-amber-600" /> مرتجع طلب أونلاين</h3>
            <p className="text-xs text-slate-500 font-bold mt-0.5">{held.customer_name?.trim() || 'عميل'} · إجمالي {Number(held.total).toFixed(2)} {cur}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-red-50 hover:text-red-500"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-black text-slate-500 uppercase">الكمية المرتجعة لكل صنف</label>
              <button onClick={returnAll} className="text-[11px] font-black text-amber-600 hover:underline">إرجاع الكل</button>
            </div>
            <div className="space-y-2">
              {held.items.map((it) => (
                <div key={it.id} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900 rounded-xl p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-black text-sm text-slate-800 dark:text-white truncate">{it.name}</div>
                    <div className="text-[11px] font-bold text-slate-400">
                      {formatQty(it.quantity, it.unit || 'قطعة')} × {Number(it.sale_price).toFixed(2)}
                    </div>
                  </div>
                  <input
                    type="number" dir="ltr" min={0} max={it.quantity} placeholder="0"
                    value={qty[it.id] || ''} onChange={(e) => setQty((s) => ({ ...s, [it.id]: e.target.value }))}
                    className={`${input} w-24 shrink-0`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-2xl p-3 text-sm font-bold space-y-1">
            <div className="flex justify-between"><span className="text-slate-600 dark:text-slate-300">قيمة المرتجع</span><span className="text-amber-700 dark:text-amber-400">{parsed.value.toFixed(2)} {cur}</span></div>
            <div className="flex justify-between"><span className="text-slate-600 dark:text-slate-300">إجمالي الطلب بعد المرتجع</span><span>{remainingTotal.toFixed(2)} {cur}</span></div>
            {parsed.value > 0 && (
              <div className="text-[11px] font-black text-amber-700 dark:text-amber-400 pt-1 border-t border-amber-200 dark:border-amber-800/40">
                {parsed.isFull ? 'مرتجع كلي — الطلب هيتقفل كـ «مرتجع» والبضاعة كلها هترجع للمخزون' : 'مرتجع جزئي — الطلب هيكمّل بالمبلغ الجديد'}
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] font-black text-slate-500 uppercase mb-2 block">مصاريف شحن المرتجع (اختياري)</label>
            <input type="number" dir="ltr" placeholder="0.00" value={shipCost} onChange={(e) => setShipCost(e.target.value)} className={input} />
            <p className="text-[11px] text-slate-400 font-bold mt-1">بتتسجّل مصروف من الخزنة بتاريخ دلوقتي (فئة «مصاريف شحن مرتجع»).</p>
            {cost > 0 && (
              <>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {payKeys.map((k) => (
                    <div key={k}>
                      <label className="text-[10px] font-black text-slate-400 block mb-1">{payLabelOf(storeSettings as any, k)}</label>
                      <input type="number" dir="ltr" placeholder="0.00" value={shipSplit[k] || ''} onChange={(e) => setShipSplit((s) => ({ ...s, [k]: e.target.value }))} className={input} />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 font-bold mt-1">سيبيها فاضية والمبلغ هيتخصم من {payLabelOf(storeSettings as any, payKeys[0] || 'cash')}.</p>
                <input placeholder="ملاحظة (شركة الشحن، رقم البوليصة...)" value={shipNote} onChange={(e) => setShipNote(e.target.value)}
                  className="w-full mt-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 font-bold text-sm outline-none focus:ring-2 focus:ring-amber-500" />
              </>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-3 rounded-2xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-black">إلغاء</button>
          <button onClick={submit} disabled={busy} className="flex-1 py-3 rounded-2xl bg-amber-600 text-white font-black disabled:opacity-50">
            {busy ? 'جارٍ...' : 'تسجيل المرتجع'}
          </button>
        </div>
      </div>
    </div>
  );
}
