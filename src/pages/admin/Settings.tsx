import { useState } from 'react';
import { useStore } from '../../store/useStore';

export default function Settings() {
  const { storeSettings, updateSettings } = useStore();
  const [formData, setFormData] = useState(storeSettings);

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
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-slate-800">إعدادات النظام</h1>
        <p className="text-slate-500 mt-2">تخصيص هوية المحل وإعدادات الفواتير</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 space-y-6">
        <div className="flex items-center justify-center mb-6">
          <img src={formData.logo} alt="Logo Preview" style={{ borderColor: formData.themeColor + '40' }} className="w-24 h-24 rounded-2xl border-2 border-dashed object-cover p-1 bg-slate-50" />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="col-span-2">
            <label className="block text-sm font-bold text-slate-700 mb-2">اسم المحل</label>
            <input 
              type="text" 
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none transition"
              style={{ '--tw-ring-color': formData.themeColor + '40' } as any}
            />
          </div>
          
          <div className="col-span-2">
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

          <div className="col-span-2">
            <label className="block text-sm font-bold text-slate-700 mb-2">عنوان المحل</label>
            <input 
              type="text" 
              value={formData.address}
              onChange={(e) => setFormData({...formData, address: e.target.value})}
              className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition"
              placeholder="المدينة، الشارع، المبنى..."
            />
          </div>

          <div className="col-span-2">
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
        </div>

        {/* ── تسميات وسائل الدفع / المحافظ ── */}
        <div className="pt-6 border-t border-slate-100">
          <h2 className="text-lg font-black text-slate-800 mb-1">تسميات وسائل الدفع (المحافظ)</h2>
          <p className="text-slate-500 text-sm mb-4">سمِّ كل وسيلة بالاسم اللي تحبيه (مثلاً المحفظة → «فودافون كاش»). يظهر في الكاشير والإيصالات.</p>
          <div className="grid grid-cols-2 gap-3">
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
