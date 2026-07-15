import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Clock } from 'lucide-react';
import { useStore } from '../store/useStore';

export default function POSLogin() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const navigate = useNavigate();
  const { loginPOS, storeSettings, cashiers, loadPosLoginData } = useStore();

  useEffect(() => {
    loadPosLoginData();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await loginPOS(name, password)) {
      navigate('/');
    } else {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 font-sans" dir="rtl">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
           {storeSettings.logo && <img src={storeSettings.logo} alt="Logo" className="h-20 w-auto max-w-[220px] mx-auto rounded-3xl shadow-xl mb-4 p-1 bg-white object-contain" />}
           <h1 className="text-3xl font-black text-slate-800 dark:text-white mb-2">{storeSettings.name}</h1>
           <p className="text-slate-500 font-bold">نظام الكاشير الذكي</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-10 rounded-[40px] shadow-2xl border border-slate-100 dark:border-slate-800 relative overflow-hidden">
          {/* Accent Decor */}
          <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600" style={{ backgroundColor: storeSettings.themeColor }}></div>
          
          <div className="flex justify-center mb-8">
            <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-3xl text-indigo-600 dark:text-indigo-400">
              <ShieldCheck size={40} />
            </div>
          </div>

          <h2 className="text-2xl font-black text-center text-slate-800 dark:text-white mb-2">تسجيل الدخول</h2>
          <p className="text-center text-slate-400 text-sm mb-8 font-bold">يرجى إدخال كلمة المرور للبدء</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1">اسم الكاشير</label>
               <select
                 required
                 value={name}
                 onChange={(e) => setName(e.target.value)}
                 className="w-full bg-slate-50 dark:bg-slate-800/50 border-2 border-slate-100 dark:border-slate-800 dark:text-white rounded-2xl py-3.5 px-4 font-bold focus:outline-none focus:border-indigo-500 transition-all"
               >
                 <option value="">اختر اسمك...</option>
                 {cashiers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
               </select>
            </div>

            <div className="space-y-1.5">
               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1">كلمة المرور</label>
               <div className="relative">
                <input
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(false);
                  }}
                  className={`w-full bg-slate-50 dark:bg-slate-800/50 border-2 ${error ? 'border-red-500' : 'border-slate-100 dark:border-slate-800'} dark:text-white rounded-2xl py-4 px-4 text-center text-2xl font-black focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:text-slate-200 dark:placeholder:text-slate-700`}
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="text-center pt-2">
                <p className="text-red-500 text-xs font-bold">الاسم أو كلمة المرور غير صحيحة، حاول مرة أخرى</p>
              </div>
            )}

            <button
              type="submit"
              style={{ backgroundColor: storeSettings.themeColor }}
              className="w-full bg-indigo-600 hover:opacity-90 text-white font-black py-4 px-6 rounded-2xl shadow-xl shadow-indigo-200 dark:shadow-none transition-all active:scale-95 flex items-center justify-center gap-3 text-lg mt-4"
            >
              <span>دخول للنظام</span>
              <ArrowRight size={20} />
            </button>
          </form>

          <div className="mt-8 text-center">
             <button
               onClick={() => navigate('/attendance')}
               className="w-full flex items-center justify-center gap-2 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-black py-3.5 px-6 rounded-2xl border-2 border-slate-100 dark:border-slate-800 transition-all"
             >
               <Clock size={18} />
               <span>تسجيل الحضور والانصراف</span>
             </button>
          </div>

          <div className="mt-6 pt-6 border-t border-slate-50 dark:border-slate-800 text-center">
             <button onClick={() => navigate('/login')} className="text-slate-400 hover:text-indigo-600 text-xs font-black transition-colors">
               الدخول لوحة التحكم (للمديرين فقط)
             </button>
          </div>
        </div>

        <p className="text-center text-slate-400 text-[10px] mt-8 font-bold uppercase tracking-widest">
           جميع الحقوق محفوظة &copy; {new Date().getFullYear()} {storeSettings.name}
        </p>
      </div>
    </div>
  );
}
