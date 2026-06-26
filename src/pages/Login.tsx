import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useStore } from '../store/useStore';

export default function Login() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const navigate = useNavigate();
  const { login } = useStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await login(pin)) {
      navigate('/admin/overview');
    } else {
      setError(true);
      setPin('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 p-8 rounded-3xl shadow-2xl max-w-sm w-full border border-slate-700">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
            <Lock size={32} className="text-white" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-white mb-8">لوحة التحكم</h2>
        
        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-slate-400 text-sm mb-2 text-center">أدخل الرمز السري</label>
            <input
              type="password"
              dir="ltr"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(false);
              }}
              className={`w-full bg-slate-900 border ${error ? 'border-red-500' : 'border-slate-700'} text-white rounded-xl py-3 px-4 text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500 transition`}
              placeholder="••••"
              autoFocus
            />
            {error && <p className="text-red-500 text-xs text-center mt-2">الرمز غير صحيح</p>}
          </div>
          <button
            type="submit"
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition transform hover:-translate-y-0.5"
          >
            دخول
          </button>
        </form>
        <button onClick={() => navigate('/')} className="w-full mt-4 text-slate-400 hover:text-white text-sm transition">
          العودة لشاشة الكاشير
        </button>
      </div>
    </div>
  );
}
