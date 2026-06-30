import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Users, Plus, Trash2, Edit3, Shield, X } from 'lucide-react';

const PERM_GROUPS: { section: string; items: [string, string][] }[] = [
  { section: 'عام', items: [['/admin/overview', 'نظرة عامة'], ['/admin/analytics', 'التحليلات والتقارير'], ['/admin/reports', 'التقارير وكشوف الحساب']] },
  { section: 'المبيعات والفواتير', items: [['/admin/invoices', 'الفواتير والمرتجعات'], ['/admin/offline-invoices', 'الفواتير الأوفلاين'], ['/admin/coupons', 'كوبونات الخصم']] },
  { section: 'المخزون والتصنيع', items: [['/admin/inventory', 'المخزون والمنتجات'], ['/admin/stocktake', 'الجرد والتسوية'], ['/admin/manufacturing', 'التصنيع'], ['/admin/stock-alerts', 'تنبيهات النواقص']] },
  { section: 'العملاء', items: [['/admin/customers', 'قاعدة العملاء'], ['/admin/deferred', 'حسابات الآجل'], ['/admin/whatsapp-campaigns', 'حملات واتساب']] },
  { section: 'الموردين', items: [['/admin/suppliers', 'الموردين والمشتريات']] },
  { section: 'المالية والخزائن', items: [['/admin/finance', 'الخزينة والمصاريف'], ['/admin/savings', 'خزنة الادخار'], ['/admin/budget', 'الميزانية العامة'], ['/admin/financing', 'سلف وتمويل'], ['/admin/managers', 'المدراء والسحوبات'], ['/admin/partners', 'الشركاء']] },
  { section: 'الموظفين', items: [['/admin/cashiers', 'إدارة المحاسبين'], ['/admin/employees', 'الرواتب والموظفين']] },
  { section: 'الإعدادات', items: [['/admin/settings', 'إعدادات النظام']] },
];
const ALL_PATHS = PERM_GROUPS.flatMap((g) => g.items.map(([p]) => p));
const labelOf = (path: string) => PERM_GROUPS.flatMap((g) => g.items).find(([p]) => p === path)?.[1] || path;

export default function AdminUsers() {
  const { adminUsers, loadAdminUsers, addAdminUser, updateAdminUser, deleteAdminUser } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [perms, setPerms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadAdminUsers(); }, []);

  const openAdd = () => { setEditing(null); setName(''); setPassword(''); setPerms([]); setShowForm(true); };
  const openEdit = (u: any) => { setEditing(u); setName(u.name); setPassword(''); setPerms(Array.isArray(u.permissions) ? u.permissions : []); setShowForm(true); };
  const toggle = (p: string) => setPerms((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);
  const toggleGroup = (items: [string, string][]) => {
    const paths = items.map(([p]) => p);
    const allOn = paths.every((p) => perms.includes(p));
    setPerms((cur) => allOn ? cur.filter((x) => !paths.includes(x)) : [...new Set([...cur, ...paths])]);
  };

  const submit = async () => {
    if (!name.trim()) { alert('اسم المستخدم مطلوب'); return; }
    if (!editing && password.length < 4) { alert('كلمة السر مطلوبة (4 خانات على الأقل)'); return; }
    setSaving(true);
    if (editing) await updateAdminUser(editing.id, { name: name.trim(), permissions: perms, ...(password ? { password } : {}) });
    else await addAdminUser({ name: name.trim(), password, permissions: perms });
    setSaving(false);
    setShowForm(false);
  };

  return (
    <div className="p-6 md:p-8 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><Shield className="text-indigo-600" size={30} /> مستخدمو لوحة التحكم</h1>
          <p className="text-slate-500 mt-1 text-sm font-medium">أنشئ مستخدمين بكلمة سر وصلاحيات محددة — كل مستخدم يدخل ويرى صفحاته فقط</p>
        </div>
        <button onClick={openAdd} className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-5 py-2.5 rounded-xl flex items-center gap-2"><Plus size={18} /> مستخدم جديد</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {adminUsers.length === 0 ? <p className="text-slate-400 col-span-full text-center py-8">لا يوجد مستخدمون بعد</p>
          : adminUsers.map((u) => (
            <div key={u.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center font-black">{u.name.charAt(0)}</div><div><p className="font-black text-slate-800 dark:text-slate-100">{u.name}</p><p className="text-[11px] text-slate-500">{(u.permissions || []).length} صلاحية</p></div></div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(u)} className="text-slate-500 hover:bg-slate-100 p-2 rounded-lg"><Edit3 size={16} /></button>
                  <button onClick={() => { if (confirm(`حذف المستخدم ${u.name}؟`)) deleteAdminUser(u.id); }} className="text-red-500 hover:bg-red-50 p-2 rounded-lg"><Trash2 size={16} /></button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(u.permissions || []).slice(0, 6).map((p: string) => <span key={p} className="text-[10px] bg-slate-100 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">{labelOf(p)}</span>)}
                {(u.permissions || []).length > 6 && <span className="text-[10px] text-slate-400">+{(u.permissions || []).length - 6}</span>}
              </div>
            </div>
          ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-[150] flex items-center justify-center p-3" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-indigo-600 text-white px-5 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black flex items-center gap-2"><Users size={20} /> {editing ? 'تعديل مستخدم' : 'مستخدم جديد'}</h2>
              <button onClick={() => setShowForm(false)} className="hover:bg-white/20 p-1.5 rounded-lg"><X size={22} /></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="text-xs font-bold text-slate-500 block mb-1">اسم المستخدم</label><input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-bold" /></div>
                <div><label className="text-xs font-bold text-slate-500 block mb-1">{editing ? 'كلمة سر جديدة (اختياري)' : 'كلمة السر'}</label><input type="text" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editing ? '••••' : ''} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-bold" /></div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-slate-700 dark:text-slate-200">الصلاحيات (الصفحات المسموح بها)</span>
                <button type="button" onClick={() => setPerms(perms.length === ALL_PATHS.length ? [] : [...ALL_PATHS])} className="text-[11px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-lg">{perms.length === ALL_PATHS.length ? 'إلغاء الكل' : 'تحديد الكل'}</button>
              </div>
              {PERM_GROUPS.map((g) => (
                <div key={g.section} className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                  <button type="button" onClick={() => toggleGroup(g.items)} className="text-xs font-black text-slate-600 dark:text-slate-300 mb-2">{g.section}</button>
                  <div className="grid grid-cols-2 gap-1.5">
                    {g.items.map(([p, label]) => (
                      <label key={p} className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                        <input type="checkbox" checked={perms.includes(p)} onChange={() => toggle(p)} className="w-4 h-4 accent-indigo-600" />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex gap-2">
              <button onClick={() => setShowForm(false)} className="flex-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 font-bold py-3 rounded-xl">إلغاء</button>
              <button onClick={submit} disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black py-3 rounded-xl">{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
