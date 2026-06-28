import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, Settings, LogOut, FileText, Users, BarChart3, Wallet, MessageCircle, CreditCard, Building2, BellRing, WifiOff, Ticket, PieChart, Scissors, Briefcase, Handshake } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useEffect, useState } from 'react';

export default function AdminLayout() {
  const navigate = useNavigate();
  const { storeSettings, logout, maintenanceAppointments, carSubscriptions, updateMaintenanceReminded } = useStore();
  const [hasCheckedReminders, setHasCheckedReminders] = useState(false);

  useEffect(() => {
    if (hasCheckedReminders || maintenanceAppointments.length === 0 || carSubscriptions.length === 0) return;

    const checkReminders = async () => {
      const tomorrowStr = new Date(Date.now() + 86400000).toDateString();
      
      for (const appt of maintenanceAppointments) {
        if (appt.status === 'pending' && !appt.is_reminded) {
          const apptDateStr = new Date(appt.appointment_date).toDateString();
          if (apptDateStr === tomorrowStr) {
            const car = carSubscriptions.find(c => c.id === appt.subscription_id);
            if (car) {
              // Send Telegram Alert
              fetch('/api/telegram-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'general',
                  message: `تذكير: موعد صيانة غداً للسيارة رقم ${car.car_number} باسم ${car.customer_name}. المطلوب: ${appt.description || 'صيانة عامة'}`
                }),
              }).catch(console.warn);

              // Update in DB so it doesn't notify again
              await updateMaintenanceReminded(appt.id);
              
              // Local UI notification could be added here if needed, but Telegram is sufficient
            }
          }
        }
      }
      setHasCheckedReminders(true);
    };

    checkReminders();
  }, [maintenanceAppointments, carSubscriptions, hasCheckedReminders, updateMaintenanceReminded]);

  const navItems = [
    { name: 'نظرة عامة', path: '/admin/overview', icon: LayoutDashboard },
    { name: 'التحليلات والتقارير', path: '/admin/analytics', icon: BarChart3 },
    { name: 'المخزون والمنتجات', path: '/admin/inventory', icon: Package },
    { name: 'الفواتير والمرتجعات', path: '/admin/invoices', icon: FileText },
    { name: 'قاعدة العملاء', path: '/admin/customers', icon: Users },
    { name: 'حملات واتساب', path: '/admin/whatsapp-campaigns', icon: MessageCircle },
    { name: 'الموردين والمشتريات', path: '/admin/suppliers', icon: Users },
    { name: 'حسابات الآجل', path: '/admin/deferred', icon: CreditCard },
    { name: 'إدارة المحاسبين', path: '/admin/cashiers', icon: Users },
    { name: 'الرواتب والموظفين', path: '/admin/employees', icon: Users },
    { name: 'الخزينة والمصاريف', path: '/admin/finance', icon: Wallet },
    { name: 'سلف وتمويل', path: '/admin/financing', icon: Building2 },
    { name: 'الميزانية العامة', path: '/admin/budget', icon: PieChart },
    { name: 'الفواتير الأوفلاين', path: '/admin/offline-invoices', icon: WifiOff },
    { name: 'كوبونات الخصم', path: '/admin/coupons', icon: Ticket },
    { name: 'تنبيهات النواقص', path: '/admin/stock-alerts', icon: BellRing },
    { name: 'إعدادات النظام', path: '/admin/settings', icon: Settings },
    { name: 'التصنيع', path: '/admin/manufacturing', icon: Scissors },
    { name: 'المدراء والسحوبات', path: '/admin/managers', icon: Briefcase },
    { name: 'الشركاء', path: '/admin/partners', icon: Handshake },
  ];

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900" dir="rtl">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-2xl z-20">
        <div className="p-6 pb-2">
          <div className="flex items-center gap-3 bg-slate-800 p-3 rounded-2xl mb-8 border border-slate-700">
            <img src={storeSettings.logo} alt="Logo" className="h-10 w-auto max-w-[120px] rounded-xl bg-white object-contain" />
            <div className="flex flex-col flex-1 min-w-0">
              <span className="font-bold text-white text-sm truncate" title={storeSettings.name}>{storeSettings.name}</span>
              <span className="text-xs text-slate-400">لوحة الإدارة</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              style={({ isActive }) => isActive ? { background: storeSettings.themeColor } : {}}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-xl transition ${
                  isActive
                    ? 'text-white font-bold shadow-lg'
                    : 'hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <item.icon size={20} />
              {item.name}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-4 py-3 text-red-400 hover:bg-black/20 hover:text-red-300 rounded-xl transition"
          >
            <LogOut size={20} />
            خروج من الإدارة
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50 relative">
        <div 
          style={{ backgroundColor: storeSettings.themeColor + '10' }}
          className="absolute top-0 left-0 w-full h-64 -z-10"
        ></div>
        <Outlet />
      </div>
    </div>
  );
}
