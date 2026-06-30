import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { Ticket, Plus, Search, Calendar, Users, Check, X, AlertCircle, Edit2 } from 'lucide-react';

export default function Coupons() {
  const { coupons, addCoupon, updateCoupon, deleteCoupon } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCouponId, setEditingCouponId] = useState<string | null>(null);
  
  // Form State
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [maxUsesCustomer, setMaxUsesCustomer] = useState<number | ''>('');
  const [maxUsesTotal, setMaxUsesTotal] = useState<number | ''>('');
  const [isActive, setIsActive] = useState(true);

  const filteredCoupons = coupons.filter(c => c.code.toLowerCase().includes(searchTerm.toLowerCase()));

  const handleSave = async () => {
    if (!code || discountValue <= 0) {
      alert('يرجى إدخال كود صحيح وقيمة خصم أكبر من الصفر');
      return;
    }

    try {
      const couponData = {
        code: code.trim().toUpperCase(),
        discount_type: discountType,
        discount_value: discountValue,
        start_date: startDate ? new Date(startDate).toISOString() : null,
        end_date: endDate ? new Date(endDate).toISOString() : null,
        max_uses_per_customer: maxUsesCustomer === '' ? null : Number(maxUsesCustomer),
        max_uses_total: maxUsesTotal === '' ? null : Number(maxUsesTotal),
        is_active: isActive
      };

      if (editingCouponId) {
        await updateCoupon(editingCouponId, couponData);
      } else {
        await addCoupon(couponData);
      }
      
      setIsModalOpen(false);
      resetForm();
    } catch (e: any) {
      console.error("Save coupon error: ", e);
      alert('حدث خطأ أثناء الحفظ: ' + (e.message || JSON.stringify(e)));
    }
  };

  const resetForm = () => {
    setEditingCouponId(null);
    setCode('');
    setDiscountType('percentage');
    setDiscountValue(0);
    setStartDate('');
    setEndDate('');
    setMaxUsesCustomer('');
    setMaxUsesTotal('');
    setIsActive(true);
  };

  const handleEdit = (coupon: any) => {
    const formatToLocalDatetime = (isoString: string) => {
      if (!isoString) return '';
      const date = new Date(isoString);
      const offset = date.getTimezoneOffset();
      const localDate = new Date(date.getTime() - (offset * 60 * 1000));
      return localDate.toISOString().slice(0, 16);
    };

    setEditingCouponId(coupon.id);
    setCode(coupon.code);
    setDiscountType(coupon.discount_type);
    setDiscountValue(coupon.discount_value);
    setStartDate(coupon.start_date ? formatToLocalDatetime(coupon.start_date) : '');
    setEndDate(coupon.end_date ? formatToLocalDatetime(coupon.end_date) : '');
    setMaxUsesCustomer(coupon.max_uses_per_customer ?? '');
    setMaxUsesTotal(coupon.max_uses_total ?? '');
    setIsActive(coupon.is_active);
    setIsModalOpen(true);
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      await updateCoupon(id, { is_active: !currentStatus });
    } catch (e) {
      alert('حدث خطأ أثناء تغيير الحالة');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذا الكوبون؟ لا يمكن التراجع عن هذا الإجراء.')) {
      try {
        await deleteCoupon(id);
      } catch (e) {
        alert('حدث خطأ أثناء الحذف');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-pink-600 to-rose-600 rounded-[32px] p-4 md:p-8 text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-black mb-2 flex items-center gap-3">
              <Ticket size={32} />
              الكوبونات والخصومات
            </h1>
            <p className="text-pink-100 font-medium text-lg">
              إدارة أكواد الخصم، وتحديد فترات الصلاحية وشروط الاستخدام.
            </p>
          </div>
          <button 
            onClick={() => { resetForm(); setIsModalOpen(true); }}
            className="bg-white text-rose-600 px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-rose-50 transition-colors shadow-md"
          >
            <Plus size={20} />
            كوبون جديد
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-3xl shadow-sm border border-slate-100">
        <div className="relative flex-1">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            placeholder="ابحث بكود الخصم..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pr-12 pl-4 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-rose-500 font-medium"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredCoupons.map((coupon) => {
          const isExpired = coupon.end_date && new Date(coupon.end_date) < new Date();
          const isFullyUsed = coupon.max_uses_total && coupon.used_count >= coupon.max_uses_total;
          
          return (
            <div key={coupon.id} className={`bg-white rounded-3xl p-6 border transition-all ${!coupon.is_active || isExpired || isFullyUsed ? 'border-slate-200 opacity-75' : 'border-rose-100 shadow-sm hover:shadow-md'}`}>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="inline-flex items-center gap-2 bg-slate-100 text-slate-800 font-black px-4 py-2 rounded-xl text-lg tracking-wider mb-2">
                    {coupon.code}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {coupon.is_active ? (
                      <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg text-xs font-bold flex items-center gap-1"><Check size={12}/> نشط</span>
                    ) : (
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg text-xs font-bold flex items-center gap-1"><X size={12}/> معطل</span>
                    )}
                    {isExpired && (
                      <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-lg text-xs font-bold flex items-center gap-1"><AlertCircle size={12}/> منتهي</span>
                    )}
                    {isFullyUsed && (
                      <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg text-xs font-bold flex items-center gap-1"><AlertCircle size={12}/> اكتمل العدد</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span className="block text-2xl font-black text-rose-600">
                    {coupon.discount_value} {coupon.discount_type === 'percentage' ? '%' : 'ج'}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">قيمة الخصم</span>
                </div>
              </div>

              <div className="space-y-3 mt-6 bg-slate-50 p-4 rounded-2xl">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span className="text-slate-500 flex items-center gap-2"><Calendar size={16}/> الصلاحية</span>
                  <span className="text-slate-800">
                    {coupon.start_date ? new Date(coupon.start_date).toLocaleDateString() : 'مفتوح'} - {coupon.end_date ? new Date(coupon.end_date).toLocaleDateString() : 'مفتوح'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm font-medium">
                  <span className="text-slate-500 flex items-center gap-2"><Users size={16}/> إجمالي الاستخدام</span>
                  <span className="text-slate-800">
                    {coupon.used_count} / {coupon.max_uses_total || '∞'}
                  </span>
                </div>
                {coupon.max_uses_per_customer && (
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span className="text-slate-500 flex items-center gap-2"><Users size={16}/> حد العميل</span>
                    <span className="text-slate-800">{coupon.max_uses_per_customer} مرات</span>
                  </div>
                )}
              </div>

              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => handleEdit(coupon)}
                  className="px-4 py-2 rounded-xl flex items-center justify-center bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                  title="تعديل"
                >
                  <Edit2 size={18} />
                </button>
                <button
                  onClick={() => toggleStatus(coupon.id, coupon.is_active)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold transition-colors ${coupon.is_active ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                >
                  {coupon.is_active ? 'تعطيل' : 'تفعيل'}
                </button>
                <button
                  onClick={() => handleDelete(coupon.id)}
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                >
                  حذف
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-md">
          <div className="bg-white rounded-[32px] w-full max-w-3xl max-h-[95vh] flex flex-col shadow-2xl overflow-hidden border border-slate-100">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-6 sm:p-8 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-2xl font-black flex items-center gap-4 text-slate-800">
                <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center shadow-sm">
                  <Ticket size={24} />
                </div>
                {editingCouponId ? 'تعديل بيانات الكوبون' : 'إضافة كوبون خصم جديد'}
              </h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 sm:p-8 overflow-y-auto space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">كود الخصم</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-rose-500 uppercase tracking-widest font-black text-slate-800"
                    placeholder="مثال: SUMMER2024"
                  />
                </div>
                
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-bold text-slate-700 mb-2">القيمة</label>
                    <input
                      type="number"
                      min="0"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-rose-500 font-bold"
                    />
                  </div>
                  <div className="w-32">
                    <label className="block text-sm font-bold text-slate-700 mb-2">النوع</label>
                    <select
                      value={discountType}
                      onChange={(e) => setDiscountType(e.target.value as 'percentage' | 'fixed')}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-rose-500 font-bold appearance-none"
                    >
                      <option value="percentage">% نسبة</option>
                      <option value="fixed">مبلغ ثابت</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">تاريخ البداية (اختياري)</label>
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">تاريخ النهاية (اختياري)</label>
                  <input
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">حد الاستخدام للعميل الواحد (اختياري)</label>
                  <input
                    type="number"
                    min="1"
                    value={maxUsesCustomer}
                    onChange={(e) => setMaxUsesCustomer(e.target.value ? Number(e.target.value) : '')}
                    placeholder="بدون حد"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">إجمالي عدد مرات الاستخدام المسموحة (اختياري)</label>
                  <input
                    type="number"
                    min="1"
                    value={maxUsesTotal}
                    onChange={(e) => setMaxUsesTotal(e.target.value ? Number(e.target.value) : '')}
                    placeholder="بدون حد"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 bg-rose-50 border border-rose-100 p-5 rounded-2xl text-rose-800 transition-colors hover:bg-rose-100/80 cursor-pointer" onClick={() => setIsActive(!isActive)}>
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="peer w-6 h-6 text-rose-600 rounded-lg focus:ring-rose-500 focus:ring-offset-rose-50 border-rose-300 cursor-pointer transition-all"
                  />
                </div>
                <label htmlFor="isActive" className="font-bold cursor-pointer flex-1 text-lg select-none">
                  تفعيل الكوبون وجعله متاحاً للاستخدام فوراً
                </label>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 sm:p-8 border-t border-slate-100 bg-slate-50/50 flex flex-col-reverse sm:flex-row gap-4">
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-full sm:w-auto px-8 py-4 rounded-2xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
              >
                إلغاء التغييرات
              </button>
              <button
                onClick={handleSave}
                className="w-full sm:flex-1 bg-gradient-to-r from-rose-600 to-pink-600 text-white py-4 rounded-2xl font-black hover:from-rose-700 hover:to-pink-700 transition-all shadow-lg shadow-rose-200 flex items-center justify-center gap-2 text-lg"
              >
                <Check size={24} />
                {editingCouponId ? 'حفظ التعديلات' : 'حفظ وإصدار الكوبون'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
