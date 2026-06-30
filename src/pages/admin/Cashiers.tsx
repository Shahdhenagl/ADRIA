import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { UserPlus, UserCircle, Phone, Lock, Trash2, Edit, Save, X, Image as ImageIcon, Camera } from 'lucide-react';

export default function Cashiers() {
  const { cashiers, loadCashiers, addCashier, updateCashier, deleteCashier, storeSettings } = useStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCashier, setEditingCashier] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    password: '',
    phone: '',
    photo_url: ''
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCashiers();
  }, []);

  const resetForm = () => {
    setFormData({ name: '', password: '', phone: '', photo_url: '' });
    setEditingCashier(null);
  };

  const handleOpenModal = (cashier?: any) => {
    if (cashier) {
      setEditingCashier(cashier);
      setFormData({
        name: cashier.name,
        password: cashier.password || '',
        phone: cashier.phone,
        photo_url: cashier.photo_url || ''
      });
    } else {
      resetForm();
    }
    setIsModalOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Basic validation
      if (file.size > 10 * 1024 * 1024) {
        alert('حجم الصورة كبير جداً، يرجى اختيار صورة أصغر من 10 ميجابايت');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.src = reader.result as string;
        img.onload = () => {
          // Compress image using canvas
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 500;
          const MAX_HEIGHT = 500;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
          setFormData({ ...formData, photo_url: compressedBase64 });
        };
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      if (editingCashier) {
        await updateCashier(editingCashier.id, formData);
      } else {
        await addCashier(formData);
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      console.error("Error saving cashier:", error);
      alert('حدث خطأ أثناء حفظ البيانات، يرجى المحاولة مرة أخرى');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذا المحاسب؟')) {
      await deleteCashier(id);
    }
  };

  return (
    <div className="p-4 md:p-8 font-sans" dir="rtl">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-800">إدارة محاسبين الكاشير</h1>
          <p className="text-slate-500 mt-2">إضافة وتعديل بيانات الموظفين المسؤولين عن البيع</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          style={{ backgroundColor: storeSettings.themeColor }}
          className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg hover:opacity-90 transition-all active:scale-95"
        >
          <UserPlus size={20} /> إضافة محاسب جديد
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cashiers.map((cashier) => (
          <div key={cashier.id} className="bg-white dark:bg-slate-800 rounded-[32px] shadow-xl border border-slate-100 dark:border-slate-700 overflow-hidden group hover:shadow-2xl transition-all duration-300">
            <div className="h-24 relative" style={{ backgroundColor: storeSettings.themeColor + '20' }}>
                <div className="absolute -bottom-10 right-8">
                  {cashier.photo_url ? (
                    <img src={cashier.photo_url} alt={cashier.name} className="w-20 h-20 rounded-2xl object-cover border-4 border-white dark:border-slate-800 shadow-lg" />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-white dark:bg-slate-700 flex items-center justify-center text-slate-300 border-4 border-white dark:border-slate-800 shadow-lg">
                      <UserCircle size={40} />
                    </div>
                  )}
                </div>
            </div>
            
            <div className="pt-14 p-8">
              <h3 className="text-xl font-black text-slate-800 dark:text-white mb-4">{cashier.name}</h3>
              
              <div className="space-y-3 mb-8">
                <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                   <Phone size={16} />
                   <span className="text-sm font-bold">{cashier.phone || 'بدون رقم هاتف'}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                   <Lock size={16} />
                   <span className="text-sm font-bold font-mono tracking-widest">Password: {cashier.password || '****'}</span>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-50 dark:border-slate-700">
                 <button 
                  onClick={() => handleOpenModal(cashier)}
                  className="flex-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors"
                 >
                   <Edit size={16} /> تعديل
                 </button>
                 <button 
                  onClick={() => handleDelete(cashier.id)}
                  className="bg-red-50 text-red-500 p-3 rounded-xl hover:bg-red-100 transition-colors"
                 >
                   <Trash2 size={18} />
                 </button>
              </div>
            </div>
          </div>
        ))}

        {cashiers.length === 0 && (
          <div className="col-span-full py-20 text-center bg-slate-50 dark:bg-slate-900/50 rounded-[40px] border-2 border-dashed border-slate-200 dark:border-slate-800">
             <div className="bg-white dark:bg-slate-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl">
                <UserCircle size={40} className="text-slate-300" />
             </div>
             <h3 className="text-xl font-black text-slate-400">لا يوجد محاسبين مضافين حالياً</h3>
             <p className="text-slate-400 mt-2">ابدأ بإضافة أول محاسب للفريق</p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-8 text-white flex justify-between items-center shrink-0" style={{ backgroundColor: storeSettings.themeColor }}>
              <div>
                <h2 className="text-2xl font-black">{editingCashier ? 'تعديل بيانات كاشير' : 'إضافة كاشير جديد'}</h2>
                <p className="text-white/70 text-sm mt-1">أدخل بيانات الدخول للكاشير</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition text-white">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto">
               <div className="space-y-4">
                  {/* Photo Upload Section */}
                  <div className="flex flex-col items-center gap-4 mb-6">
                    <div className="relative group">
                      <div className="w-32 h-32 rounded-3xl bg-slate-100 dark:bg-slate-900 border-4 border-slate-50 dark:border-slate-800 shadow-inner flex items-center justify-center overflow-hidden">
                        {formData.photo_url ? (
                          <img src={formData.photo_url} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon size={48} className="text-slate-300" />
                        )}
                      </div>
                      <button 
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute -bottom-2 -right-2 bg-indigo-600 text-white p-3 rounded-2xl shadow-lg hover:scale-110 transition-transform active:scale-95"
                      >
                        <Camera size={20} />
                      </button>
                    </div>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="image/*"
                      className="hidden"
                    />
                    <p className="text-xs font-bold text-slate-400">اضغط لرفع صورة المحاسب</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest mr-1">الاسم بالكامل</label>
                    <input 
                      required
                      type="text" 
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      placeholder="أدخل اسم المحاسب..."
                      className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-indigo-500 py-3.5 px-5 rounded-2xl focus:outline-none transition-all font-bold"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest mr-1">كلمة المرور (Password)</label>
                      <input 
                        required
                        type="text" 
                        dir="ltr"
                        value={formData.password}
                        onChange={(e) => setFormData({...formData, password: e.target.value})}
                        placeholder="••••••••"
                        className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-indigo-500 py-3.5 px-5 rounded-2xl focus:outline-none transition-all font-black text-center"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest mr-1">رقم الهاتف</label>
                      <input 
                        type="text" 
                        dir="ltr"
                        value={formData.phone}
                        onChange={(e) => setFormData({...formData, phone: e.target.value})}
                        placeholder="010..."
                        className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-indigo-500 py-3.5 px-5 rounded-2xl focus:outline-none transition-all font-bold"
                      />
                    </div>
                  </div>
               </div>

               <div className="flex gap-4 pt-6">
                 <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-4 px-6 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-black transition-all active:scale-95"
                 >إلغاء</button>
                 <button 
                  type="submit" 
                  disabled={isSubmitting}
                  style={{ backgroundColor: storeSettings.themeColor }}
                  className={`flex-[2] py-4 px-6 bg-indigo-600 text-white rounded-2xl font-black shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center justify-center gap-2 ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                 >
                   {isSubmitting ? (
                     <>جارٍ الحفظ...</>
                   ) : (
                     <><Save size={20} /> {editingCashier ? 'حفظ التعديلات' : 'إضافة المحاسب'}</>
                   )}
                 </button>
               </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

