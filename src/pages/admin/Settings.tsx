import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { listPrinters, getQzConfig, saveQzConfig } from '../../utils/qzPrint';

export default function Settings() {
  const { storeSettings, updateSettings } = useStore();
  const [formData, setFormData] = useState(storeSettings);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printerStatus, setPrinterStatus] = useState('');
  const [discovering, setDiscovering] = useState(false);
  // QZ Tray config is per-device (printer names differ per machine) → localStorage, not DB.
  const [qz, setQz] = useState(getQzConfig());
  const updateQz = (patch: Partial<ReturnType<typeof getQzConfig>>) => {
    const next = { ...qz, ...patch };
    setQz(next);
    saveQzConfig(next);
  };

  const discoverPrinters = async () => {
    setDiscovering(true);
    setPrinterStatus('جارٍ الاتصال بـ QZ Tray واكتشاف الطابعات...');
    try {
      const found = await listPrinters();
      setPrinters(found);
      setPrinterStatus(found.length ? `تم العثور على ${found.length} طابعة ✅` : 'لم يتم العثور على طابعات.');
    } catch {
      setPrinterStatus('تعذّر الاتصال بـ QZ Tray. تأكد أن البرنامج مثبّت وقيد التشغيل على هذا الجهاز.');
    } finally {
      setDiscovering(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings(formData);
      alert('تم حفظ الإعدادات بنجاح!');
    } catch (error) {
      console.error(error);
      alert('حدث خطأ أثناء حفظ الإعدادات. تأكد من اتصال الإنترنت أو صلاحيات قاعدة البيانات.');
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 2 ميجابايت.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, logo: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-black text-slate-800">إعدادات النظام</h1>
        <p className="text-slate-500 mt-2">تخصيص هوية المحل وإعدادات الفواتير</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-4 md:p-8 rounded-3xl shadow-sm border border-slate-100 space-y-6">
        <div className="flex items-center justify-center mb-6">
          <img src={formData.logo} alt="Logo Preview" style={{ borderColor: formData.themeColor + '40' }} className="w-24 h-24 rounded-2xl border-2 border-dashed object-cover p-1 bg-slate-50" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="sm:col-span-2">
            <label className="block text-sm font-bold text-slate-700 mb-2">اسم المحل</label>
            <input 
              type="text" 
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none transition"
              style={{ '--tw-ring-color': formData.themeColor + '40' } as any}
            />
          </div>
          
          <div className="sm:col-span-2">
            <label className="block text-sm font-bold text-slate-700 mb-2">رابط أو صورة الشعار (Logo)</label>
            <div className="flex items-center gap-3">
              <input 
                type="text" 
                dir="ltr"
                value={formData.logo.startsWith('data:image') ? 'صورة مرفوعة (جارِ العرض)' : formData.logo}
                onChange={(e) => setFormData({...formData, logo: e.target.value})}
                className="flex-1 bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none transition text-left disabled:opacity-50"
                style={{ '--tw-ring-color': formData.themeColor + '40' } as any}
                disabled={formData.logo.startsWith('data:image')}
                placeholder="https://..."
              />
              <label 
                style={{ borderColor: formData.themeColor + '40', color: formData.themeColor }}
                className="cursor-pointer bg-white border hover:bg-slate-50 px-5 py-3 rounded-xl font-bold transition whitespace-nowrap flex items-center justify-center"
              >
                رفع صورة
                <input 
                  type="file" 
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
              {formData.logo.startsWith('data:image') && (
                <button
                  type="button"
                  onClick={() => setFormData({...formData, logo: ''})}
                  className="bg-red-50 text-red-600 px-4 py-3 rounded-xl hover:bg-red-100 font-bold transition"
                >
                  حذف
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-2">يمكنك نسخ رابط صورة، أو رفع صورة مباشرة من جهازك (يفضل أن تكون مربعة وبحجم أقل من 2MB).</p>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">العملة الافتراضية</label>
            <input 
              type="text" 
              value={formData.currency}
              onChange={(e) => setFormData({...formData, currency: e.target.value})}
              className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none transition"
              style={{ '--tw-ring-color': formData.themeColor + '40' } as any}
              placeholder="مثال: ر.س , ج.م , $"
            />
          </div>

          <div className="col-span-2 md:col-span-1">
            <label className="block text-sm font-bold text-slate-700 mb-2">رقم الهاتف (الأساسي)</label>
            <input 
              type="text" 
              dir="ltr"
              value={formData.phone}
              onChange={(e) => setFormData({...formData, phone: e.target.value})}
              className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition text-left"
              placeholder="0500000000"
            />
          </div>

          <div className="col-span-2 md:col-span-1">
            <label className="block text-sm font-bold text-slate-700 mb-2">رقم الهاتف (الإضافي)</label>
            <input 
              type="text" 
              dir="ltr"
              value={formData.phone2}
              onChange={(e) => setFormData({...formData, phone2: e.target.value})}
              className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition text-left"
              placeholder="اختياري..."
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-bold text-slate-700 mb-2">عنوان المحل</label>
            <input 
              type="text" 
              value={formData.address}
              onChange={(e) => setFormData({...formData, address: e.target.value})}
              className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition"
              placeholder="المدينة، الشارع، المبنى..."
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-bold text-slate-700 mb-2">رابط المقر على الخريطة (Location URL)</label>
            <input 
              type="text" 
              dir="ltr"
              value={formData.locationUrl || ''}
              onChange={(e) => setFormData({...formData, locationUrl: e.target.value})}
              className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition text-left"
              placeholder="https://maps.app.goo.gl/..."
            />
            <p className="text-[11px] text-slate-400 mt-1 text-right">سيظهر هذا الرابط كزر (المقر) في الفاتورة الإلكترونية، وفي رسائل الواتساب.</p>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">نسبة الضريبة المضافة (%)</label>
            <input 
              type="number" 
              min="0"
              max="100"
              value={formData.taxRate}
              onChange={(e) => setFormData({...formData, taxRate: parseFloat(e.target.value) || 0})}
              className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">كود الدولة للواتساب (الدولي)</label>
            <div className="flex items-center gap-2">
              <span className="bg-slate-100 border border-slate-200 py-3 px-4 rounded-xl text-slate-500 font-bold" dir="ltr">+</span>
              <input 
                type="text" 
                dir="ltr"
                value={formData.whatsappCountryCode}
                onChange={(e) => setFormData({...formData, whatsappCountryCode: e.target.value.replace(/\D/g, '')})}
                className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none transition font-bold"
                style={{ '--tw-ring-color': formData.themeColor + '40' } as any}
                placeholder="مثال: 966"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">يُستخدم لإضافة كود المراسلة الدولي تلقائياً (مصر 20، السعودية 966).</p>
          </div>

          <div className="col-span-2 md:col-span-1">
            <label className="block text-sm font-bold text-slate-700 mb-2">رصيد الخزينة الابتدائي (رصيد البداية)</label>
            <div className="flex items-center gap-2">
              <input 
                type="number" 
                value={formData.initial_balance}
                onChange={(e) => setFormData({...formData, initial_balance: parseFloat(e.target.value) || 0})}
                className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none transition font-bold text-emerald-600"
                style={{ '--tw-ring-color': formData.themeColor + '40' } as any}
                placeholder="0.00"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">يُستخدم كحجر أساس لحسابات الخزينة والميزانية اليومية.</p>
          </div>

          <div className="col-span-2 md:col-span-1">
            <label className="block text-sm font-bold text-slate-700 mb-2">لون هوية النظام الأولي</label>
            <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 py-2 px-4 rounded-xl transition">
              <input 
                type="color" 
                value={formData.themeColor || '#4f46e5'}
                onChange={(e) => setFormData({...formData, themeColor: e.target.value})}
                className="w-10 h-10 rounded cursor-pointer border-0 p-0 bg-transparent"
              />
              <span className="text-slate-500 text-sm font-mono" dir="ltr">{formData.themeColor || '#4f46e5'}</span>
            </div>
          </div>
        </div>

        {/* ── صلاحيات الكاشير ── */}
        <div className="pt-6 border-t border-slate-100">
          <h2 className="text-lg font-black text-slate-800 mb-1">صلاحيات الكاشير</h2>
          <p className="text-slate-500 text-sm mb-4">تحكّم في المميزات اللي تظهر للكاشير (إخفاء أي بند يخفيه من شاشة الكاشير).</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ['invoices', 'عرض الفواتير السابقة'],
              ['editDelete', 'تعديل / حذف / استبدال الفواتير'],
              ['returns', 'المرتجعات'],
              ['debt', 'سداد آجل للعملاء'],
              ['dayClosing', 'تقفيل اليوم'],
              ['wholesale', 'أسعار الجملة / نص الجملة'],
              ['savings', 'تحويل لخزنة الادخار'],
              ['barcodePrint', 'طباعة باركود المنتجات'],
            ] as const).map(([k, label]) => {
              const perms = formData.cashierPermissions || {};
              const enabled = perms[k] !== false; // الافتراضي مسموح
              return (
                <label key={k} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 cursor-pointer">
                  <span className="text-sm font-bold text-slate-700">{label}</span>
                  <input type="checkbox" checked={enabled} onChange={(e) => setFormData({ ...formData, cashierPermissions: { ...perms, [k]: e.target.checked } })} className="w-5 h-5 accent-indigo-600" />
                </label>
              );
            })}
          </div>
          <label className="mt-2 flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 cursor-pointer">
            <span className="text-sm font-bold text-amber-800">السماح للكاشير بصرف سلف للموظفين (تُخصم من راتب الشهر)</span>
            <input type="checkbox" checked={!!formData.allowCashierEmployeeAdvance} onChange={(e) => setFormData({ ...formData, allowCashierEmployeeAdvance: e.target.checked })} className="w-5 h-5 accent-amber-600" />
          </label>
        </div>

        {/* ── إعدادات العرض ── */}
        <div className="pt-6 border-t border-slate-100">
          <h2 className="text-lg font-black text-slate-800 mb-3">إعدادات العرض</h2>
          <label className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 cursor-pointer">
            <span className="text-sm font-bold text-slate-700">إظهار «ربح الفاتورة» في شاشة الكاشير</span>
            <input type="checkbox" checked={formData.showInvoiceProfit !== false} onChange={(e) => setFormData({ ...formData, showInvoiceProfit: e.target.checked })} className="w-5 h-5 accent-indigo-600" />
          </label>
        </div>

        {/* ── تسميات وسائل الدفع / المحافظ ── */}
        <div className="pt-6 border-t border-slate-100">
          <h2 className="text-lg font-black text-slate-800 mb-1">تسميات وسائل الدفع (المحافظ)</h2>
          <p className="text-slate-500 text-sm mb-4">سمِّ كل وسيلة بالاسم اللي تحبيه (مثلاً المحفظة → «فودافون كاش»). يظهر في الكاشير والإيصالات.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([['cash', 'كاش'], ['visa', 'فيزا'], ['wallet', 'محفظة'], ['instapay', 'انستا باي']] as const).map(([k, def]) => {
              const labels = formData.paymentLabels || {};
              return (
                <div key={k}>
                  <label className="block text-xs font-bold text-slate-500 mb-1">{def}</label>
                  <input value={labels[k] ?? ''} placeholder={def} onChange={(e) => setFormData({ ...formData, paymentLabels: { ...labels, [k]: e.target.value } })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              );
            })}
          </div>

          {/* طرق دفع إضافية (5 و6) — لكل منها حساب مستقل في الخزنة */}
          <h3 className="text-sm font-black text-slate-700 mt-6 mb-1">طرق دفع إضافية</h3>
          <p className="text-slate-500 text-xs mb-3">فعّل طريقة خامسة/سادسة (مثلاً محفظة تانية أو حساب بنكي) — كل واحدة بتفتح حساب مستقل في الخزنة زي المحفظة.</p>
          <div className="space-y-3">
            {([['method5', 'طريقة دفع 5'], ['method6', 'طريقة دفع 6']] as const).map(([k, def]) => {
              const labels = formData.paymentLabels || {};
              const enabled = formData.paymentMethodsEnabled || {};
              const on = !!enabled[k];
              return (
                <div key={k} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${on ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
                  <label className="flex items-center gap-2 cursor-pointer shrink-0">
                    <input type="checkbox" checked={on} onChange={(e) => setFormData({ ...formData, paymentMethodsEnabled: { ...enabled, [k]: e.target.checked } })} className="w-5 h-5 accent-indigo-600" />
                    <span className="text-xs font-bold text-slate-600">تفعيل</span>
                  </label>
                  <input
                    value={labels[k] ?? ''}
                    placeholder={def}
                    disabled={!on}
                    onChange={(e) => setFormData({ ...formData, paymentLabels: { ...labels, [k]: e.target.value } })}
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* ── الطباعة المباشرة (QZ Tray) ── */}
        <div className="pt-6 border-t border-slate-100">
          <h2 className="text-lg font-black text-slate-800 mb-1">الطباعة المباشرة (QZ Tray)</h2>
          <p className="text-slate-500 text-sm mb-2">طباعة الفواتير والباركود مباشرةً على الطابعة المحددة بدون نافذة طباعة. يتطلّب تثبيت برنامج <a href="https://qz.io/download/" target="_blank" rel="noreferrer" className="text-indigo-600 font-bold underline">QZ Tray</a> (مجاني) مرة واحدة على جهاز الكاشير وتشغيله.</p>
          <p className="text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">⚙️ هذا الإعداد خاص بهذا الجهاز فقط ويُحفظ تلقائياً عليه — اضبطه على كل جهاز كاشير على حدة باسم طابعته.</p>

          <label className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 cursor-pointer mb-3">
            <span className="text-sm font-bold text-slate-700">تفعيل الطباعة المباشرة عبر QZ Tray (هذا الجهاز)</span>
            <input type="checkbox" checked={!!qz.enabled} onChange={(e) => updateQz({ enabled: e.target.checked })} className="w-5 h-5 accent-indigo-600" />
          </label>

          {qz.enabled && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={discoverPrinters} disabled={discovering} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-bold transition text-sm">
                  {discovering ? 'جارٍ الاكتشاف...' : '🔍 اكتشاف الطابعات'}
                </button>
                {printerStatus && <span className="text-xs font-bold text-slate-500">{printerStatus}</span>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">🧾 طابعة الفواتير (الحرارية)</label>
                  <input
                    list="qz-printers"
                    value={qz.invoicePrinter || ''}
                    onChange={(e) => updateQz({ invoicePrinter: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition font-bold"
                    placeholder="اختر أو اكتب اسم الطابعة"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">🔳 طابعة الباركود (الملصقات)</label>
                  <input
                    list="qz-printers"
                    value={qz.barcodePrinter || ''}
                    onChange={(e) => updateQz({ barcodePrinter: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition font-bold"
                    placeholder="اختر أو اكتب اسم الطابعة"
                  />
                </div>
              </div>
              <datalist id="qz-printers">
                {printers.map((p) => <option key={p} value={p} />)}
              </datalist>
              <p className="text-[11px] text-slate-400">لو طابعة واحدة فقط، اتركي الخانة الثانية فارغة وسيتم استخدام نافذة الطباعة العادية لها. أول طباعة قد تطلب الضغط على «Allow / السماح» في QZ Tray — فعّلي «Remember» لعدم تكرار السؤال.</p>
            </div>
          )}
        </div>

        <div className="pt-6 border-t border-slate-100 flex justify-end">
          <button type="submit" style={{ backgroundColor: formData.themeColor, boxShadow: `0 4px 12px ${formData.themeColor}40` }} className="text-white px-8 py-3 rounded-xl font-bold transition hover:opacity-90">
            حفظ التغييرات
          </button>
        </div>
      </form>
    </div>
  );
}
