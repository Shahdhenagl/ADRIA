import { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { ClipboardCheck, Search, Save, Camera, X, Undo2, Zap } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { beepSuccess, beepError } from '../../utils/beep';

type Location = 'all' | 'warehouse' | 'display';
type Season = 'all' | 'summer' | 'winter' | 'annual';

const SEASON_LABEL: Record<string, string> = { summer: 'صيفي', winter: 'شتوي', annual: 'سنوي', all: 'كل المواسم' };
const LOCATION_LABEL: Record<Location, string> = { all: 'كل المخزن', warehouse: 'المستودع', display: 'المحل' };

// نفس الباركود بيتقرا في كذا فريم ورا بعض — بنتجاهل تكراره خلال المدة دي.
// لو بتجردي كذا قطعة بنفس الباركود استني اللمبة تولّع تاني بين القطعة والتانية.
const RESCAN_MS = 900;

/**
 * وقف الماسح وتفضية الحاوية — بيبلع كل الأخطاء عن قصد.
 * html5-qrcode بيحقن عناصره جوه الـ div بنفسه، ولو رمى استثناء وهو بيشيلها
 * (كاميرا اتقفلت مرتين، أو الحاوية اتشالت من React) الاستثناء بيطلع لريأكت
 * ويوقّع الشجرة كلها — ودي كانت «الشاشة البيضا» بعد الخروج من الكاميرا.
 */
const stopScanner = (scanner: Html5Qrcode | null) => {
  if (!scanner) return Promise.resolve();
  const safeClear = () => { try { scanner.clear(); } catch { /* الحاوية اتفضّت خلاص */ } };
  try {
    const state = scanner.getState();
    if (state === 2 || state === 3) { // 2 = SCANNING, 3 = PAUSED
      return scanner.stop().then(safeClear).catch(() => {});
    }
  } catch { /* المكتبة بترمي لو لسه بتقوم */ }
  safeClear();
  return Promise.resolve();
};

export default function StockTake() {
  const { products, storeSettings, adjustStock } = useStore();
  const cur = storeSettings.currency;
  const [search, setSearch] = useState('');
  const [seasonFilter, setSeasonFilter] = useState<Season>('all');
  const [stockLocation, setStockLocation] = useState<Location>('all');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [onlyCounted, setOnlyCounted] = useState(false);

  // ── الجرد بالمسح: كل قراءة بتزوّد قطعة على الصنف بتاعها ──────────────────
  const [scanOpen, setScanOpen] = useState(false);
  const [gunCode, setGunCode] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  // آخر قراءة (للعرض الكبير جوه الكاميرا) + ترتيب الأصناف اللي اتمسحت.
  const [lastScan, setLastScan] = useState<{ ok: boolean; code: string; id: string; name: string; qty: number } | null>(null);
  const [scannedIds, setScannedIds] = useState<string[]>([]);

  // كول-باك الكاميرا بيتسجّل مرة واحدة، فبيشوف نسخة قديمة من الـ state.
  // بنقراه من refs بدل الـ closure عشان العدّ ما يضيعش مع المسح السريع.
  const countsRef = useRef(counts);
  useEffect(() => { countsRef.current = counts; }, [counts]);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const scanHandlerRef = useRef<(code: string) => void>(() => {});
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // الكمية حسب المخزن المختار: الكل = الإجمالي، المحل = المعروض، المستودع = الباقي.
  const dispOf = (p: any) => Math.min(Number(p.display_quantity) || 0, Number(p.stock_quantity) || 0);
  const systemOf = (p: any) => {
    const total = Number(p.stock_quantity) || 0;
    if (stockLocation === 'display') return dispOf(p);
    if (stockLocation === 'warehouse') return Math.max(0, total - dispOf(p));
    return total;
  };

  // قراءة واحدة = قطعة واحدة. العدّ بيبدأ من صفر مش من رصيد النظام، عشان
  // الرقم اللي في الخانة يكون «اللي عدّيته بإيدي» فعلاً.
  const registerScan = (raw: string) => {
    const code = String(raw || '').trim();
    if (!code) return;

    const now = Date.now();
    if (code === lastCodeRef.current.code && now - lastCodeRef.current.at < RESCAN_MS) return;
    lastCodeRef.current = { code, at: now };

    const product = useStore.getState().products.find((p) => (p.barcode || '') === code);
    if (!product) {
      beepError();
      setLastScan({ ok: false, code, id: '', name: '', qty: 0 });
      return;
    }

    const next = (parseFloat(countsRef.current[product.id] || '0') || 0) + 1;
    countsRef.current = { ...countsRef.current, [product.id]: String(next) };
    setCounts((c) => ({ ...c, [product.id]: String((parseFloat(c[product.id] || '0') || 0) + 1) }));
    setScannedIds((ids) => (ids.includes(product.id) ? ids : [product.id, ...ids]));
    beepSuccess();
    setLastScan({ ok: true, code, id: product.id, name: product.name, qty: next });
  };
  scanHandlerRef.current = registerScan;

  // تراجع عن آخر قراءة (قطعة اتعدّت بالغلط أو الباركود اتقرا مرتين).
  const undoLastScan = () => {
    if (!lastScan?.ok) return;
    const next = Math.max(0, (parseFloat(countsRef.current[lastScan.id] || '0') || 0) - 1);
    countsRef.current = { ...countsRef.current, [lastScan.id]: String(next) };
    setCounts((c) => ({ ...c, [lastScan.id]: String(Math.max(0, (parseFloat(c[lastScan.id] || '0') || 0) - 1)) }));
    setLastScan({ ...lastScan, qty: next });
    lastCodeRef.current = { code: '', at: 0 }; // يسمح بإعادة مسح نفس القطعة فوراً
  };

  // كاميرا الموبايل — نفس إعدادات ماسح الكاشير، بس مسح مستمر من غير وقفة
  // بعد كل قراءة عشان تعدّي على القطع ورا بعض.
  useEffect(() => {
    if (!scanOpen) return;
    let scanner: Html5Qrcode | null = null;
    let cancelled = false;

    scanner = new Html5Qrcode('stocktake-reader', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    });
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: (w: number, h: number) => ({
            width: Math.floor(w * 0.9),
            height: Math.floor(Math.min(h * 0.45, Math.max(h * 0.3, 140))),
          }),
          disableFlip: true,
          videoConstraints: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            advanced: [{ focusMode: 'continuous' }],
          } as unknown as MediaTrackConstraints,
        },
        (decodedText: string) => scanHandlerRef.current(decodedText),
        () => {}
      )
      .then(() => {
        if (cancelled) return;
        try {
          setTorchSupported(scanner?.getRunningTrackCameraCapabilities().torchFeature().isSupported() ?? false);
        } catch {
          setTorchSupported(false);
        }
      })
      .catch((err: any) => {
        console.error(err);
        alert('حدث خطأ في تشغيل الكاميرا، تأكد من إعطاء الصلاحيات.');
        setScanOpen(false);
      });

    return () => {
      cancelled = true;
      setTorchOn(false);
      setTorchSupported(false);
      scannerRef.current = null;
      // الحاوية #stocktake-reader بتفضل في الـ DOM دايماً (مخفية بـ CSS)، فالتنضيف
      // هنا بيلاقي عناصره مكانها. stop() بيرمي لو الكاميرا لسه بتقوم — بنبلعه.
      stopScanner(scanner);
    };
  }, [scanOpen]);

  // وقف الكاميرا لو المستخدم خرج من الصفحة والماسح مفتوح.
  useEffect(() => () => { stopScanner(scannerRef.current); }, []);

  // بنوقّف الكاميرا *قبل* ما الشاشة تتخفي — لو سبناها لتنظيف الـ effect ممكن
  // تفضل لمبة الكاميرا شغّالة على بعض الأجهزة.
  const closeScanner = async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    await stopScanner(s);
    setTorchOn(false);
    setScanOpen(false);
  };

  const toggleTorch = async () => {
    try {
      const torch = scannerRef.current?.getRunningTrackCameraCapabilities().torchFeature();
      if (!torch?.isSupported()) return;
      await torch.apply(!torchOn);
      setTorchOn(!torchOn);
    } catch (err) {
      console.error('Torch toggle failed:', err);
      setTorchSupported(false);
    }
  };

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => !p.is_hidden)
      .filter((p) => seasonFilter === 'all' || p.season === seasonFilter)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q))
      .filter((p) => !onlyCounted || (counts[p.id] !== undefined && counts[p.id] !== ''));
  }, [products, search, seasonFilter, onlyCounted, counts]);

  const rows = list.map((p) => {
    const system = systemOf(p);
    const raw = counts[p.id];
    const counted = raw === undefined || raw === '' ? null : Number(raw);
    const diff = counted === null ? 0 : counted - system;
    const cost = Number(p.average_purchase_price ?? p.purchase_price) || 0;
    return { p, system, counted, diff, cost, diffValue: diff * cost };
  });

  const changed = rows.filter((r) => r.counted !== null && Math.abs(r.diff) > 0.0001);
  const totalShortageVal = changed.filter((r) => r.diff < 0).reduce((s, r) => s + Math.abs(r.diffValue), 0);
  const totalSurplusVal = changed.filter((r) => r.diff > 0).reduce((s, r) => s + r.diffValue, 0);
  // إجمالي القطع اللي اتعدّت (كل الأصناف المكتوب ليها كمية، مش المختلفة بس).
  const countedItems = Object.entries(counts).filter(([, v]) => v !== undefined && v !== '');
  const countedPieces = countedItems.reduce((s, [, v]) => s + (parseFloat(v) || 0), 0);

  const save = async () => {
    if (changed.length === 0) { alert('لا توجد فروقات للتسوية. أدخل الكميات المجرودة المختلفة عن النظام.'); return; }
    const locNote = stockLocation === 'all' ? '' : ` (جرد ${LOCATION_LABEL[stockLocation]})`;
    if (!confirm(`تأكيد تسوية ${changed.length} صنف${locNote}؟ سيتم تعديل المخزون للكميات المجرودة.`)) return;
    setSaving(true);
    const n = await adjustStock(
      changed.map((r) => ({ product_id: r.p.id, counted_qty: r.counted as number, location: stockLocation })),
      (note.trim() + locNote).trim()
    );
    setSaving(false);
    alert(`تمت تسوية ${n} صنف ✅`);
    setCounts({}); setNote(''); setScannedIds([]); setLastScan(null);
    countsRef.current = {};
  };

  const clearCounts = () => {
    if (countedItems.length === 0) return;
    if (!confirm(`مسح ${countedItems.length} صنف من ورقة الجرد الحالية؟ (المخزون نفسه مش بيتغيّر)`)) return;
    setCounts({}); setScannedIds([]); setLastScan(null);
    countsRef.current = {};
  };

  return (
    <div className="p-6 md:p-8 space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><ClipboardCheck className="text-indigo-600" size={30} /> الجرد والتسوية</h1>
          <p className="text-slate-500 mt-1 text-sm font-medium">امسح القطع بالكاميرا (كل مسحة = قطعة) أو اكتب الكمية بإيدك، راجع الفرق، ثم احفظ التسوية</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-2 text-center"><div className="text-[11px] font-bold text-red-600">قيمة العجز</div><div className="font-black text-red-700">{totalShortageVal.toFixed(2)} {cur}</div></div>
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl px-4 py-2 text-center"><div className="text-[11px] font-bold text-emerald-600">قيمة الزيادة</div><div className="font-black text-emerald-700">{totalSurplusVal.toFixed(2)} {cur}</div></div>
        </div>
      </div>

      {/* شريط المسح: كاميرا الموبايل + قارئ باركود (USB/بلوتوث) */}
      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-3 flex flex-wrap items-center gap-3">
        <button onClick={() => setScanOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-5 py-3 rounded-xl flex items-center gap-2 shadow">
          <Camera size={20} /> جرد بالكاميرا
        </button>
        <form
          onSubmit={(e) => { e.preventDefault(); registerScan(gunCode); setGunCode(''); }}
          className="flex-1 min-w-[220px]"
        >
          <input
            value={gunCode}
            onChange={(e) => setGunCode(e.target.value)}
            placeholder="أو صوّب قارئ الباركود هنا — كل قراءة بتزوّد قطعة"
            className="w-full bg-white dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 rounded-xl py-3 px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </form>
        <div className="text-sm font-bold text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-900 rounded-xl px-4 py-2.5 border border-indigo-100 dark:border-slate-700">
          اتعدّ: <b>{countedPieces}</b> قطعة · <b>{countedItems.length}</b> صنف
        </div>
        {countedItems.length > 0 && (
          <button onClick={clearCounts} className="text-xs font-bold text-slate-500 hover:text-red-600 underline">مسح ورقة الجرد</button>
        )}
      </div>

      {/* فلاتر: الموسم + المخزن */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-2xl p-2 shadow-sm border border-slate-100 dark:border-slate-700 w-fit">
          <span className="text-xs font-bold text-slate-500 px-2">الموسم:</span>
          {([['all', 'الكل'], ['summer', 'صيفي'], ['winter', 'شتوي'], ['annual', 'سنوي']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setSeasonFilter(k)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${seasonFilter === k ? 'bg-amber-500 text-white shadow' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-2xl p-2 shadow-sm border border-slate-100 dark:border-slate-700 w-fit">
          <span className="text-xs font-bold text-slate-500 px-2">المخزن:</span>
          {([['all', 'الكل'], ['warehouse', 'المستودع'], ['display', 'المحل']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setStockLocation(k)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${stockLocation === k ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setOnlyCounted((v) => !v)}
          className={`px-4 py-2.5 rounded-2xl text-sm font-bold border transition ${onlyCounted ? 'bg-emerald-600 text-white border-emerald-600 shadow' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-100 dark:border-slate-700'}`}>
          المجرود فقط
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم المنتج أو الباركود..." className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 pr-10 pl-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة الجرد (اختياري)" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500 min-w-[200px]" />
        <button onClick={save} disabled={saving || changed.length === 0} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black px-5 py-2.5 rounded-xl flex items-center gap-2"><Save size={18} /> {saving ? 'جاري...' : `حفظ التسوية (${changed.length})`}</button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto max-h-[65vh]">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 sticky top-0">
              <tr>
                <th className="p-3">المنتج</th><th className="p-3">الباركود</th>
                <th className="p-3 text-center">رصيد النظام{stockLocation !== 'all' ? ` (${LOCATION_LABEL[stockLocation]})` : ''}</th><th className="p-3 text-center">المجرود فعلياً</th>
                <th className="p-3 text-center">الفرق</th><th className="p-3 text-center">قيمة الفرق</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد منتجات</td></tr>
                : rows.map((r) => (
                  <tr key={r.p.id} className={`border-b border-slate-100 dark:border-slate-700/50 ${r.counted !== null && Math.abs(r.diff) > 0.0001 ? (r.diff < 0 ? 'bg-red-50/40 dark:bg-red-900/10' : 'bg-emerald-50/40 dark:bg-emerald-900/10') : ''}`}>
                    <td className="p-3 font-bold text-slate-800 dark:text-slate-100">{r.p.name}{r.p.season ? <span className="mr-1 text-[10px] font-bold text-amber-600">· {SEASON_LABEL[r.p.season] || r.p.season}</span> : ''}</td>
                    <td className="p-3 font-mono text-xs text-slate-500">{r.p.barcode || '-'}</td>
                    <td className="p-3 text-center font-bold">{r.system}</td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setCounts((c) => ({ ...c, [r.p.id]: String(Math.max(0, (parseFloat(c[r.p.id] || '0') || 0) - 1)) }))} className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-black">−</button>
                        <input type="number" value={counts[r.p.id] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [r.p.id]: e.target.value }))} placeholder={String(r.system)} className="w-20 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-center font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                        <button onClick={() => setCounts((c) => ({ ...c, [r.p.id]: String((parseFloat(c[r.p.id] || '0') || 0) + 1) }))} className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 font-black">+</button>
                      </div>
                    </td>
                    <td className={`p-3 text-center font-black ${r.counted === null ? 'text-slate-300' : r.diff === 0 ? 'text-slate-400' : r.diff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{r.counted === null ? '—' : (r.diff > 0 ? '+' : '') + r.diff}</td>
                    <td className={`p-3 text-center font-bold ${r.diffValue < 0 ? 'text-red-600' : r.diffValue > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{r.counted === null || r.diff === 0 ? '—' : `${r.diffValue.toFixed(2)} ${cur}`}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[12px] text-slate-400">
        الأصناف اللي متكتبش ليها كمية بتفضل زي ما هي. الحفظ بيعدّل المخزون للكمية المجرودة ويسجّل الفرق في سجل التسويات.
        {stockLocation === 'display' && ' — جرد المحل بيعدّل الكمية المعروضة فقط، والمستودع بيفضل زي ما هو.'}
        {stockLocation === 'warehouse' && ' — جرد المستودع بيعدّل كمية المستودع فقط، والمعروض في المحل بيفضل زي ما هو.'}
      </p>

      {/* ── ماسح الكاميرا: مسح مستمر، كل قراءة بتزوّد قطعة ───────────────────
          الشاشة دي بتفضل موجودة في الـ DOM وبتتخفي بـ CSS بدل ما تتشال: مكتبة
          الكاميرا بتحقن عناصرها جوه #stocktake-reader، ولو React شال الحاوية
          والمكتبة لسه بتنضّف بتحصل «الشاشة البيضا» بعد الخروج. */}
      <div className={`fixed inset-0 z-[200] bg-black flex-col ${scanOpen ? 'flex' : 'hidden'}`} dir="rtl">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shrink-0">
            <div>
              <h2 className="font-black flex items-center gap-2"><Camera size={20} /> جرد بالمسح</h2>
              <p className="text-[11px] text-white/60">بتعدّي في: {LOCATION_LABEL[stockLocation]} · {countedPieces} قطعة</p>
            </div>
            <div className="flex items-center gap-2">
              {torchSupported && (
                <button onClick={toggleTorch} className={`p-2 rounded-xl ${torchOn ? 'bg-amber-400 text-slate-900' : 'bg-white/10 text-white'}`}><Zap size={20} /></button>
              )}
              <button onClick={closeScanner} className="p-2 rounded-xl bg-white/10 hover:bg-white/20"><X size={22} /></button>
            </div>
          </div>

          <div id="stocktake-reader" className="w-full flex-1 min-h-0 bg-black" />

          <div className="bg-slate-900 text-white p-4 space-y-3 shrink-0 max-h-[45vh] overflow-y-auto">
            {lastScan ? (
              lastScan.ok ? (
                <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-2xl p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black truncate">{lastScan.name}</p>
                    <p className="text-[11px] text-white/60 font-mono">{lastScan.code}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-3xl font-black text-emerald-400">{lastScan.qty}</span>
                    <button onClick={undoLastScan} className="p-2 rounded-xl bg-white/10 hover:bg-white/20" title="تراجع عن آخر قطعة"><Undo2 size={18} /></button>
                  </div>
                </div>
              ) : (
                <div className="bg-red-500/15 border border-red-500/40 rounded-2xl p-3">
                  <p className="font-black text-red-300">باركود مش مسجّل على أي منتج</p>
                  <p className="text-[11px] text-white/60 font-mono">{lastScan.code}</p>
                </div>
              )
            ) : (
              <p className="text-center text-white/50 font-bold text-sm">صوّب الكاميرا على باركود القطعة — كل قراءة بتزوّد قطعة على الصنف بتاعها</p>
            )}

            {/* قايمة اللي اتعدّ (الأحدث فوق) — عشان تراجعي وإنتي واقفة بتجردي */}
            {scannedIds.length > 0 && (
              <div className="space-y-1">
                {scannedIds.slice(0, 12).map((id) => {
                  const p = products.find((x) => x.id === id);
                  if (!p) return null;
                  return (
                    <div key={id} className="flex items-center justify-between gap-2 bg-white/5 rounded-xl px-3 py-2">
                      <span className="text-sm font-bold truncate">{p.name}</span>
                      <span className="text-sm font-black text-emerald-400 shrink-0">{counts[id] || 0} <span className="text-[10px] text-white/40">/ النظام {systemOf(p)}</span></span>
                    </div>
                  );
                })}
                {scannedIds.length > 12 && <p className="text-center text-[11px] text-white/40 font-bold">+{scannedIds.length - 12} صنف تاني</p>}
              </div>
            )}
          </div>
      </div>
    </div>
  );
}
