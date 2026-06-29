import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import POS from './pages/POS';
import Login from './pages/Login';
import POSLogin from './pages/POSLogin';
import AdminLayout from './pages/admin/AdminLayout';
import Overview from './pages/admin/Overview';
import Inventory from './pages/admin/Inventory';
import Invoices from './pages/admin/Invoices';
import Customers from './pages/admin/Customers';
import WhatsAppCampaigns from './pages/admin/WhatsAppCampaigns';
import Suppliers from './pages/admin/Suppliers';
import DeferredAccounts from './pages/admin/DeferredAccounts';
import Settings from './pages/admin/Settings';
import Analytics from './pages/admin/Analytics';
import Finance from './pages/admin/Finance';
import OfflineInvoices from './pages/admin/OfflineInvoices';
import Cashiers from './pages/admin/Cashiers';
import Employees from './pages/admin/Employees';
import Budget from './pages/admin/Budget';
import Financing from './pages/admin/Financing';
import StockAlerts from './pages/admin/StockAlerts';
import Coupons from './pages/admin/Coupons';
import Manufacturing from './pages/admin/Manufacturing';
import Managers from './pages/admin/Managers';
import Partners from './pages/admin/Partners';
import Savings from './pages/admin/Savings';
import StockTake from './pages/admin/StockTake';
import Reports from './pages/admin/Reports';
import AdminUsers from './pages/admin/AdminUsers';
import PublicInvoice from './pages/PublicInvoice';
import { useStore } from './store/useStore';

function ThemeInjector() {
  const { storeSettings } = useStore();
  const hex = storeSettings.themeColor || '#4f46e5';

  useEffect(() => {
    const r = parseInt(hex.slice(1, 3), 16) || 79;
    const g = parseInt(hex.slice(3, 5), 16) || 70;
    const b = parseInt(hex.slice(5, 7), 16) || 229;

    let el = document.getElementById('cashier-theme') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'cashier-theme';
      document.head.appendChild(el);
    }

    el.textContent = `
      .bg-indigo-50  { background-color: rgba(${r},${g},${b},0.08) !important; }
      .bg-indigo-100 { background-color: rgba(${r},${g},${b},0.15) !important; }
      .bg-indigo-500 { background-color: ${hex} !important; }
      .bg-indigo-600 { background-color: ${hex} !important; }
      .bg-indigo-700 { background-color: rgba(${r},${g},${b},0.85) !important; }
      .hover\\:bg-indigo-50:hover  { background-color: rgba(${r},${g},${b},0.08) !important; }
      .hover\\:bg-indigo-600:hover { background-color: ${hex} !important; }
      .hover\\:bg-indigo-700:hover { background-color: rgba(${r},${g},${b},0.85) !important; }
      .text-indigo-400 { color: rgba(${r},${g},${b},0.7) !important; }
      .text-indigo-500 { color: rgba(${r},${g},${b},0.85) !important; }
      .text-indigo-600 { color: ${hex} !important; }
      .text-indigo-700 { color: rgba(${r},${g},${b},0.85) !important; }
      .hover\\:text-indigo-600:hover { color: ${hex} !important; }
      .border-indigo-100 { border-color: rgba(${r},${g},${b},0.2) !important; }
      .border-indigo-200 { border-color: rgba(${r},${g},${b},0.3) !important; }
      .border-indigo-500 { border-color: ${hex} !important; }
      .border-indigo-600 { border-color: ${hex} !important; }
      .from-indigo-500, .from-indigo-600, .from-indigo-700 {
        --tw-gradient-from: ${hex} !important;
        --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, rgba(${r},${g},${b},0)) !important;
      }
      .via-indigo-600 {
        --tw-gradient-stops: ${hex}, ${hex}, var(--tw-gradient-to, rgba(${r},${g},${b},0)) !important;
      }
      .to-purple-600, .to-purple-700, .to-purple-800 {
        --tw-gradient-to: rgba(${r},${g},${b},0.75) !important;
      }
      .hover\\:from-indigo-700:hover { --tw-gradient-from: rgba(${r},${g},${b},0.9) !important; }
      .hover\\:to-purple-700:hover   { --tw-gradient-to: rgba(${r},${g},${b},0.75) !important; }
      .focus\\:ring-indigo-500:focus { --tw-ring-color: rgba(${r},${g},${b},0.4) !important; }
      .shadow-indigo-200 { --tw-shadow-color: rgba(${r},${g},${b},0.25) !important; --tw-shadow: var(--tw-shadow-colored) !important; }
      .dark .dark\\:text-indigo-400 { color: rgba(${r},${g},${b},0.7) !important; }
      .dark .dark\\:from-indigo-400 { --tw-gradient-from: rgba(${r},${g},${b},0.7) !important; }
      .dark .dark\\:to-purple-400   { --tw-gradient-to: rgba(${r},${g},${b},0.6) !important; }
    `;
  }, [hex]);

  return null;
}


function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAdminAuthenticated } = useStore();
  if (!isAdminAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function ProtectedRoutePOS({ children }: { children: React.ReactNode }) {
  const { isPOSAuthenticated } = useStore();
  if (!isPOSAuthenticated) {
    return <Navigate to="/pos-login" replace />;
  }
  return <>{children}</>;
}

function App() {
  const { loadAll, loadSettingsOnly, loadProductsOnly, isLoading, dbError } = useStore();
  const isPublicInvoiceRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/view-invoice/');

  useEffect(() => {
    if (isPublicInvoiceRoute) return;

    loadAll();

    const channel = new BroadcastChannel('cashier-sync');
    channel.onmessage = (event) => {
      if (event.data === 'sync_settings') {
        loadSettingsOnly();
      } else if (event.data === 'sync_products') {
        loadProductsOnly();
      }
    };
    return () => channel.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublicInvoiceRoute]);

  if (isLoading && !isPublicInvoiceRoute) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 font-bold text-lg">جاري تحميل البيانات...</p>
      </div>
    );
  }

  if (dbError && !isPublicInvoiceRoute) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-red-50 gap-4 p-8 text-center">
        <div className="text-5xl">⚠️</div>
        <h2 className="text-2xl font-black text-red-700">تعذّر الاتصال بقاعدة البيانات</h2>
        <p className="text-red-500 font-mono text-sm bg-red-100 px-4 py-2 rounded-lg max-w-lg">{dbError}</p>
        <button onClick={() => loadAll()} className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-700 transition">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  return (
    <>
      <ThemeInjector />
      <Router>
        <Routes>
          <Route 
            path="/" 
            element={
              <ProtectedRoutePOS>
                <POS />
              </ProtectedRoutePOS>
            } 
          />
          <Route path="/pos-login" element={<POSLogin />} />
          <Route path="/login" element={<Login />} />
          <Route 
            path="/admin" 
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<Overview />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="customers" element={<Customers />} />
            <Route path="whatsapp-campaigns" element={<WhatsAppCampaigns />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="cashiers" element={<Cashiers />} />
            <Route path="deferred" element={<DeferredAccounts />} />
            <Route path="finance" element={<Finance />} />
            <Route path="financing" element={<Financing />} />
            <Route path="offline-invoices" element={<OfflineInvoices />} />
            <Route path="coupons" element={<Coupons />} />
            <Route path="employees" element={<Employees />} />
            <Route path="stock-alerts" element={<StockAlerts />} />
            <Route path="budget" element={<Budget />} />
            <Route path="settings" element={<Settings />} />
            <Route path="manufacturing" element={<Manufacturing />} />
            <Route path="managers" element={<Managers />} />
            <Route path="partners" element={<Partners />} />
            <Route path="savings" element={<Savings />} />
            <Route path="stocktake" element={<StockTake />} />
            <Route path="reports" element={<Reports />} />
            <Route path="users" element={<AdminUsers />} />
          </Route>
          <Route path="/view-invoice/:id" element={<PublicInvoice />} />
        </Routes>
      </Router>
    </>
  );
}

export default App;
