import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Clock, LogIn, LogOut, Camera, CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';

interface AttEmployee {
  id: string;
  name: string;
  job_title?: string;
}

interface Branding {
  name: string;
  logo?: string;
  themeColor: string;
}

type Toast = { kind: 'success' | 'error'; text: string } | null;

const ERROR_AR: Record<string, string> = {
  not_found: 'الموظف غير موجود',
  inactive: 'هذا الموظف غير نشط',
  no_pin: 'لا يوجد رقم سري مسجّل لك، راجع المدير',
  wrong_pin: 'الرقم السري غير صحيح',
  not_checked_in: 'لم تسجّل حضور اليوم بعد',
  already_checked_in: 'لقد سجّلت حضورك اليوم بالفعل',
  already_checked_out: 'لقد سجّلت انصرافك اليوم بالفعل',
  bad_action: 'إجراء غير معروف',
};

export default function Attendance() {
  const [branding, setBranding] = useState<Branding>({ name: 'تسجيل الحضور', themeColor: '#4f46e5' });
  const [employees, setEmployees] = useState<AttEmployee[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<{ check_in: string | null; check_out: string | null }>({ check_in: null, check_out: null });
  const [busy, setBusy] = useState<'check_in' | 'check_out' | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [now, setNow] = useState(new Date());
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ساعة حية
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // تحميل بيانات المحل + قائمة الموظفين (كلها عبر RPC متاحة للـ anon)
  useEffect(() => {
    (async () => {
      const [{ data: login }, { data: emps }] = await Promise.all([
        supabase.rpc('get_pos_login_data'),
        supabase.rpc('get_attendance_employees'),
      ]);
      if (login && (login as any).settings) {
        const s = (login as any).settings;
        setBranding({ name: s.name || 'تسجيل الحضور', logo: s.logo, themeColor: s.theme_color || '#4f46e5' });
      }
      if (Array.isArray(emps)) setEmployees(emps as AttEmployee[]);
    })();
  }, []);

  // تشغيل الكاميرا
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCamReady(true);
      } catch {
        setCamError(true);
      }
    })();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // حالة اليوم للموظف المختار (لتفعيل زر الانصراف)
  const refreshStatus = useCallback(async (id: string) => {
    if (!id) { setStatus({ check_in: null, check_out: null }); return; }
    const { data } = await supabase.rpc('get_attendance_status', { p_employee_id: id });
    if (data) setStatus({ check_in: (data as any).check_in, check_out: (data as any).check_out });
  }, []);

  useEffect(() => { refreshStatus(selectedId); }, [selectedId, refreshStatus]);

  const capturePhoto = (): string | null => {
    const video = videoRef.current;
    if (!video || !camReady || video.videoWidth === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  };

  const showToast = (kind: 'success' | 'error', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 5000);
  };

  const handleAction = async (action: 'check_in' | 'check_out') => {
    if (!selectedId) return showToast('error', 'اختر اسمك أولاً');
    if (!pin.trim()) return showToast('error', 'اكتب الرقم السري');
    setBusy(action);
    try {
      const photo = capturePhoto();
      const { data, error } = await supabase.rpc('record_attendance', {
        p_employee_id: selectedId,
        p_pin: pin.trim(),
        p_action: action,
      });
      if (error || !data || !(data as any).ok) {
        const code = (data as any)?.error || 'bad_action';
        showToast('error', ERROR_AR[code] || 'تعذّر التسجيل، حاول مرة أخرى');
        return;
      }
      const res = data as any;
      const emp = employees.find((e) => e.id === selectedId);

      // إرسال الصورة + الاسم والوقت للمدير في تليجرام (لا يعطّل نجاح التسجيل لو فشل)
      fetch('/api/attendance-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: res.name || emp?.name,
          jobTitle: emp?.job_title || '',
          action,
          time: res.time,
          photo,
        }),
      }).catch(() => {});

      const t = new Date(res.time).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });
      showToast('success', action === 'check_in' ? `تم تسجيل حضورك الساعة ${t} ✅` : `تم تسجيل انصرافك الساعة ${t} ✅`);
      setPin('');
      await refreshStatus(selectedId);
    } finally {
      setBusy(null);
    }
  };

  const tc = branding.themeColor;
  const checkedIn = !!status.check_in;
  const checkedOut = !!status.check_out;
  const fmtTime = (v: string | null) =>
    v ? new Date(v).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 font-sans" dir="rtl">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          {branding.logo && (
            <img src={branding.logo} alt="Logo" className="h-16 w-auto max-w-[200px] mx-auto rounded-3xl shadow-xl mb-3 p-1 bg-white object-contain" />
          )}
          <h1 className="text-2xl font-black text-slate-800 dark:text-white">{branding.name}</h1>
          <p className="text-slate-500 font-bold flex items-center justify-center gap-2 mt-1">
            <Clock size={16} /> تسجيل الحضور والانصراف
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-[36px] shadow-2xl border border-slate-100 dark:border-slate-800 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2" style={{ backgroundColor: tc }} />

          {/* الساعة الحية */}
          <div className="text-center mb-6">
            <div className="text-4xl font-black text-slate-800 dark:text-white tabular-nums tracking-wide">
              {now.toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-slate-400 text-sm font-bold mt-1">
              {now.toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>

          {/* الكاميرا */}
          <div className="mb-6 relative rounded-3xl overflow-hidden bg-slate-900 aspect-video flex items-center justify-center border-4 border-slate-100 dark:border-slate-800">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
            {!camReady && !camError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 gap-2">
                <Camera size={32} className="animate-pulse" />
                <span className="text-xs font-bold">جاري تشغيل الكاميرا...</span>
              </div>
            )}
            {camError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 gap-2 p-4 text-center">
                <Camera size={32} />
                <span className="text-xs font-bold">تعذّر الوصول للكاميرا — سيتم التسجيل بدون صورة</span>
              </div>
            )}
            {camReady && (
              <div className="absolute bottom-2 right-2 bg-red-600 text-white text-[10px] font-black px-2 py-1 rounded-lg flex items-center gap-1">
                <span className="w-2 h-2 bg-white rounded-full animate-pulse" /> مباشر
              </div>
            )}
          </div>

          {/* اختيار الموظف */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1">الموظف</label>
              <select
                value={selectedId}
                onChange={(e) => { setSelectedId(e.target.value); setPin(''); }}
                className="w-full bg-slate-50 dark:bg-slate-800/50 border-2 border-slate-100 dark:border-slate-800 dark:text-white rounded-2xl py-3.5 px-4 font-bold focus:outline-none focus:border-indigo-500 transition-all"
              >
                <option value="">اختر اسمك...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}{e.job_title ? ` — ${e.job_title}` : ''}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1">الرقم السري</label>
              <input
                type="password"
                inputMode="numeric"
                dir="ltr"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800/50 border-2 border-slate-100 dark:border-slate-800 dark:text-white rounded-2xl py-4 px-4 text-center text-2xl font-black focus:outline-none focus:border-indigo-500 transition-all placeholder:text-slate-200 dark:placeholder:text-slate-700"
                placeholder="••••"
              />
            </div>

            {/* حالة اليوم */}
            {selectedId && (
              <div className="flex gap-3 text-center">
                <div className={`flex-1 rounded-2xl py-2.5 border ${checkedIn ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                  <div className="text-[10px] font-black">الحضور</div>
                  <div className="text-sm font-black tabular-nums">{fmtTime(status.check_in)}</div>
                </div>
                <div className={`flex-1 rounded-2xl py-2.5 border ${checkedOut ? 'bg-rose-50 border-rose-100 text-rose-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                  <div className="text-[10px] font-black">الانصراف</div>
                  <div className="text-sm font-black tabular-nums">{fmtTime(status.check_out)}</div>
                </div>
              </div>
            )}

            {/* أزرار الحضور والانصراف */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => handleAction('check_in')}
                disabled={busy !== null || checkedIn}
                className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-emerald-600 text-white font-black hover:opacity-90 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
              >
                <LogIn size={20} /> {busy === 'check_in' ? '...' : 'تسجيل حضور'}
              </button>
              <button
                onClick={() => handleAction('check_out')}
                disabled={busy !== null || !checkedIn || checkedOut}
                className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-rose-600 text-white font-black hover:opacity-90 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
              >
                <LogOut size={20} /> {busy === 'check_out' ? '...' : 'تسجيل انصراف'}
              </button>
            </div>
            {selectedId && !checkedIn && (
              <p className="text-center text-[11px] font-bold text-slate-400">زر الانصراف يُفعّل بعد تسجيل الحضور</p>
            )}
          </div>

          {/* Toast */}
          {toast && (
            <div className={`mt-5 flex items-center gap-2 rounded-2xl px-4 py-3 font-bold text-sm ${toast.kind === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
              {toast.kind === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
              <span>{toast.text}</span>
            </div>
          )}
        </div>

        <p className="text-center text-slate-400 text-[10px] mt-6 font-bold flex items-center justify-center gap-1.5">
          <ShieldCheck size={12} /> يُرسَل حضورك وصورتك تلقائياً للإدارة
        </p>
      </div>
    </div>
  );
}
