import { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList
} from 'recharts';
import { 
  TrendingUp, TrendingDown, DollarSign, Package, Users, 
  FileText, Table as TableIcon, RefreshCw
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { calculateInvoiceProfit } from '../../utils/invoiceProfit';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
// html2canvas-pro supports Tailwind v4's oklch() colors (the original html2canvas throws on them).
import html2canvas from 'html2canvas-pro';
import { allocatePayment } from '../../utils/paymentAllocator';

// Fix for jspdf-autotable typing
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: {
      finalY: number;
    };
  }
}

export default function Analytics() {
  const { storeSettings, loadAnalyticsData, purchaseInvoices, products, expenses, orders: globalOrders } = useStore();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'today' | '7d' | '30d' | 'thisMonth' | 'thisYear' | 'all'>('30d');
  // فلتر يوم محدد: لو متعبّى، يتجاهل أزرار الفترة ويعرض هذا اليوم فقط.
  const [customDay, setCustomDay] = useState('');

  useEffect(() => {
    fetchData();
  }, [timeRange, customDay]);

  const fetchData = async () => {
    setLoading(true);
    let start: string | undefined;
    let end: string | undefined;
    const now = new Date();

    if (customDay) {
      // يوم محدد: من بداية اليوم إلى نهايته.
      start = new Date(`${customDay}T00:00:00`).toISOString();
      end = new Date(`${customDay}T23:59:59.999`).toISOString();
    } else if (timeRange === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else if (timeRange === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      start = d.toISOString();
    } else if (timeRange === '30d') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      start = d.toISOString();
    } else if (timeRange === 'thisMonth') {
      start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    } else if (timeRange === 'thisYear') {
      start = new Date(now.getFullYear(), 0, 1).toISOString();
    }

    const data = await loadAnalyticsData(start, end);
    setOrders(data);
    setLoading(false);
  };

  // ── Calculations ─────────────────────────────────────────────
  const stats = useMemo(() => {
    let revenue = 0;
    let cost = 0;
    let invoiceProfit = 0;
    let serviceRevenues = 0;
    let serviceExpenses = 0;
    let collectedFromInvoices = 0;
    let collectedFromOther = 0;

    let productsMap: Record<string, { name: string, qty: number, profit: number, revenue: number }> = {};
    let customersMap: Record<string, { name: string, total: number, orders: number }> = {};

    const activeOrders = orders.filter((order: any) => !order.is_deleted);

    const debtPaymentsByInvoice = new Map<string, number>();
    globalOrders.filter(o => !o.is_deleted).forEach(o => {
      if (o.type === 'payment' && o.notes?.includes('سداد أجل للفاتورة رقم #')) {
        const match = o.notes.match(/سداد أجل للفاتورة رقم #([\w-]+)/);
        if (match && match[1]) {
          const invoiceId = match[1];
          debtPaymentsByInvoice.set(invoiceId, (debtPaymentsByInvoice.get(invoiceId) || 0) + (o.paid_amount || 0));
        }
      }
    });

    activeOrders.forEach(order => {
      if (order.type === 'payment') {
        const { toSales, toServices, toOldDebt } = allocatePayment(order, globalOrders);
        collectedFromInvoices += toSales;
        serviceRevenues += toServices;
        collectedFromOther += toOldDebt;
        revenue += (order.paid_amount || 0);
        return; // Skip items calculation for payment orders
      }

      let initialPaid = order.paid_amount || 0;
      const sumSplits = (order.paid_cash || 0) + (order.paid_visa || 0) + (order.paid_wallet || 0) + (order.paid_instapay || 0);
      if (sumSplits > 0) {
        initialPaid = sumSplits;
      } else {
        initialPaid = (order.paid_amount || 0) - (debtPaymentsByInvoice.get(order.id) || 0);
      }

      if (order.car_id) {
        serviceRevenues += initialPaid;
      } else {
        invoiceProfit += calculateInvoiceProfit(order);
      }
      
      collectedFromInvoices += initialPaid;
      revenue += initialPaid;

      let netOrderTotal = 0;
      
      order.items?.forEach((item: any) => {
        const qty = item.quantity - item.returned_quantity;
        const itemRevenue = item.sale_price * qty;
        const itemCost = item.average_purchase_price * qty; // Note: using average_purchase_price here for Branch 1
        cost += itemCost;
        netOrderTotal += itemRevenue;

        if (!productsMap[item.id]) {
          productsMap[item.id] = { name: item.name, qty: 0, profit: 0, revenue: 0 };
        }
        productsMap[item.id].qty += qty;
        productsMap[item.id].revenue += itemRevenue;
        productsMap[item.id].profit += (itemRevenue - itemCost);
      });

      if (order.customer) {
        if (!customersMap[order.customer.id]) {
          customersMap[order.customer.id] = { name: order.customer.name, total: 0, orders: 0 };
        }
        customersMap[order.customer.id].total += netOrderTotal;
        customersMap[order.customer.id].orders += 1;
      }
    });

    // Global Debts
    const totalCustomerDebt = Math.max(0, globalOrders.filter(o => !o.is_deleted).reduce((sum, o) => sum + (o.total - o.paid_amount), 0));
    const totalSupplierDebt = Math.max(0, purchaseInvoices.reduce((sum, inv) => sum + (inv.total - inv.paid_amount), 0));

    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    const topProductsByQty = Object.values(productsMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    const topProductsByProfit = Object.values(productsMap)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10);

    const topCustomers = Object.values(customersMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const procurementCost = purchaseInvoices.reduce((sum, inv) => sum + inv.total, 0);
    const totalInventoryValue = products.reduce((sum, p) => sum + (p.stock_quantity * (p.average_purchase_price || p.purchase_price || 0)), 0);

    // Calculate time-filtered expenses
    let startLimit: Date | null = null;
    let endLimit: Date | null = null;
    const now = new Date();
    if (customDay) {
      startLimit = new Date(`${customDay}T00:00:00`);
      endLimit = new Date(`${customDay}T23:59:59.999`);
    } else if (timeRange === 'today') {
      startLimit = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (timeRange === '7d') {
      startLimit = new Date();
      startLimit.setDate(startLimit.getDate() - 7);
    } else if (timeRange === '30d') {
      startLimit = new Date();
      startLimit.setDate(startLimit.getDate() - 30);
    } else if (timeRange === 'thisMonth') {
      startLimit = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (timeRange === 'thisYear') {
      startLimit = new Date(now.getFullYear(), 0, 1);
    }

    const filteredExpenses = expenses.filter(exp => {
      const expDate = new Date(exp.date);
      if (startLimit && expDate < startLimit) return false;
      if (endLimit && expDate > endLimit) return false;
      return true;
    });

    const extraIncomes = filteredExpenses.filter(e => e.amount < 0 && !e.car_id).reduce((sum, e) => sum + Math.abs(e.amount), 0);
    const totalExpenses = filteredExpenses.filter(e => e.amount > 0 && !e.car_id).reduce((sum, exp) => sum + exp.amount, 0);
    
    serviceExpenses = filteredExpenses.filter(e => e.car_id).reduce((sum, exp) => sum + exp.amount, 0);
    const serviceProfit = serviceRevenues - serviceExpenses;

    collectedFromOther += extraIncomes;
    revenue += extraIncomes;
    const finalNetProfit = invoiceProfit + serviceProfit + extraIncomes - totalExpenses;

    return { 
      revenue, cost, profit, invoiceProfit, margin, serviceRevenues, serviceExpenses, serviceProfit,
      orderCount: activeOrders.filter(o => o.type === 'sale').length,
      topProductsByQty, 
      topProductsByProfit, 
      topCustomers,
      procurementCost,
      totalInventoryValue,
      totalExpenses,
      finalNetProfit,
      collectedFromInvoices,
      collectedFromOther,
      totalCustomerDebt,
      totalSupplierDebt
    };
  }, [orders, expenses, purchaseInvoices, products, timeRange, customDay, globalOrders]);

  // ── Export Logic ─────────────────────────────────────────────
  const exportExcel = () => {
    const wsData = [
      ['تقرير التحليلات', '', '', ''],
      ['الفترة', timeRange, '', ''],
      [''],
      ['ملخص عام', '', '', ''],
      ['إجمالي المبيعات والإيرادات', stats.revenue, storeSettings.currency, ''],
      ['إجمالي التكلفة', stats.cost, storeSettings.currency, ''],
      ['إجمالي الربح من الفواتير', stats.invoiceProfit, storeSettings.currency, ''],
      ['إجمالي ربح الخدمات (السيارات)', stats.serviceProfit, storeSettings.currency, ''],
      ['إجمالي المصاريف العامة', stats.totalExpenses, storeSettings.currency, ''],
      ['صافي الربح النهائي', stats.finalNetProfit, storeSettings.currency, ''],
      ['هامش الربح', stats.margin.toFixed(2) + '%', '', ''],
      ['عدد الفواتير', stats.orderCount, '', ''],
      [''],
      ['المنتجات الأكثر مبيعاً (كمية)', '', '', ''],
      ['المنتج', 'الكمية', 'الإيراد', 'الربح'],
      ...stats.topProductsByQty.map(p => [p.name, p.qty, p.revenue, p.profit]),
      [''],
      ['العملاء الأكثر شراءً', '', '', ''],
      ['العميل', 'إجمالي المشتريات', 'عدد الفواتير', ''],
      ...stats.topCustomers.map(c => [c.name, c.total, c.orders, ''])
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analytics');
    XLSX.writeFile(wb, `analytics_report_${new Date().toLocaleDateString()}.xlsx`);
  };

  const exportPDF = async () => {
    const element = document.getElementById('analytics-dashboard');
    if (!element) return;

    setLoading(true);
    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#f8fafc' // slate-50
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`analytics_report_${new Date().toLocaleDateString()}.pdf`);
    } catch (err) {
      console.error("PDF Export Error:", err);
      alert("حدث خطأ أثناء تصدير PDF. يرجى المحاولة مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[400px] gap-4">
        <RefreshCw className="w-12 h-12 text-indigo-600 animate-spin" />
        <p className="text-slate-500 font-bold">جاري تحليل البيانات...</p>
      </div>
    );
  }

  return (
    <div id="analytics-dashboard" className="p-4 sm:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 mb-2">التحليلات والتقارير</h1>
          <p className="text-slate-500 font-medium">نظرة تفصيلية على أداء النشاط التجاري والأرباح</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-white p-1 rounded-xl shadow-sm border border-slate-200 flex gap-1">
            {[
              { id: 'today', label: 'اليوم' },
              { id: '7d', label: '7 أيام' },
              { id: '30d', label: '30 يوم' },
              { id: 'thisMonth', label: 'هذا الشهر' },
              { id: 'thisYear', label: 'هذه السنة' },
              { id: 'all', label: 'الكل' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => { setCustomDay(''); setTimeRange(btn.id as any); }}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  !customDay && timeRange === btn.id
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* فلتر يوم محدد */}
          <div className={`bg-white p-1.5 rounded-xl shadow-sm border flex items-center gap-2 transition-colors ${customDay ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200'}`}>
            <span className="text-xs font-bold text-slate-500 pr-2">يوم محدد:</span>
            <input
              type="date"
              value={customDay}
              onChange={(e) => setCustomDay(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            {customDay && (
              <button
                onClick={() => setCustomDay('')}
                className="text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg w-7 h-7 flex items-center justify-center font-black transition"
                title="إلغاء فلتر اليوم"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button 
              onClick={exportExcel}
              className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg shadow-emerald-100"
            >
              <TableIcon size={18} />
              Excel
            </button>
            <button 
              onClick={exportPDF}
              className="flex items-center gap-2 bg-red-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-red-700 transition shadow-lg shadow-red-100"
            >
              <FileText size={18} />
              PDF
            </button>
          </div>
        </div>
      </div>

      {/* Cards: New Financial Indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard 
          title="المحصل من الفواتير" 
          value={stats.collectedFromInvoices} 
          unit={storeSettings.currency}
          icon={DollarSign} 
          color="emerald" 
        />
        <StatCard 
          title="إيرادات أخرى ومسدد آجل" 
          value={stats.collectedFromOther} 
          unit={storeSettings.currency}
          icon={TrendingUp} 
          color="indigo" 
        />
        <StatCard 
          title="إجمالي الآجل على العملاء" 
          value={stats.totalCustomerDebt} 
          unit={storeSettings.currency}
          icon={Users} 
          color="amber" 
        />
        <StatCard 
          title="إجمالي المديونية للموردين" 
          value={stats.totalSupplierDebt} 
          unit={storeSettings.currency}
          icon={FileText} 
          color="red" 
        />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="إجمالي المبيعات والإيرادات" 
          value={stats.revenue} 
          unit={storeSettings.currency}
          icon={TrendingUp} 
          color="indigo" 
          increase={true} 
        />
        <StatCard 
          title="إجمالي الربح من الفواتير" 
          value={stats.invoiceProfit} 
          unit={storeSettings.currency}
          icon={FileText} 
          color="emerald" 
          increase={stats.invoiceProfit > 0} 
        />
        <StatCard 
          title="صافي ربح الخدمات (السيارات)" 
          value={stats.serviceProfit} 
          unit={storeSettings.currency}
          icon={TrendingUp} 
          color="indigo" 
          increase={stats.serviceProfit > 0} 
        />
        <StatCard 
          title="المصاريف والتكاليف" 
          value={stats.totalExpenses} 
          unit={storeSettings.currency}
          icon={TrendingDown} 
          color="slate" 
        />
        <StatCard 
          title="صافي الربح النهائي" 
          value={stats.finalNetProfit} 
          unit={storeSettings.currency}
          icon={DollarSign} 
          color="emerald" 
          increase={stats.finalNetProfit > 0} 
        />
        <StatCard 
          title="هامش الربح" 
          value={stats.margin.toFixed(1)} 
          unit="%" 
          icon={TrendingUp} 
          color="amber" 
        />
        <StatCard 
          title="عدد الفواتير" 
          value={stats.orderCount} 
          icon={Package} 
          color="slate" 
        />
        <StatCard 
          title="تكلفة المشتريات" 
          value={stats.procurementCost} 
          unit={storeSettings.currency}
          icon={DollarSign} 
          color="amber" 
        />
        <StatCard 
          title="قيمة بضاعة المخزن" 
          value={stats.totalInventoryValue} 
          unit={storeSettings.currency}
          icon={Package} 
          color="indigo" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Products Chart */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                <TrendingUp size={20} />
              </div>
              <h3 className="font-black text-slate-800 text-lg">المنتجات الأكثر مبيعاً (كمية)</h3>
            </div>
          </div>
          
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.topProductsByQty} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  hide
                />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="qty" radius={[0, 8, 8, 0]} barSize={32}>
                  <LabelList 
                    dataKey="name" 
                    position="right" 
                    offset={10} 
                    style={{ fill: '#475569', fontWeight: '900', fontSize: '14px' }} 
                  />
                  {stats.topProductsByQty.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={index < 3 ? storeSettings.themeColor : '#94a3b8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Profit Chart */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                <DollarSign size={20} />
              </div>
              <h3 className="font-black text-slate-800 text-lg">المنتجات الأكثر ربحاً (صافي)</h3>
            </div>
          </div>
          
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.topProductsByProfit} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  hide
                />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="profit" radius={[0, 8, 8, 0]} barSize={32}>
                  <LabelList 
                    dataKey="name" 
                    position="right" 
                    offset={10} 
                    style={{ fill: '#475569', fontWeight: '900', fontSize: '14px' }} 
                  />
                  {stats.topProductsByProfit.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={index < 3 ? '#10b981' : '#cbd5e1'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Customers Table */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
            <Users size={20} />
          </div>
          <h3 className="font-black text-slate-800 text-lg">العملاء الأكثر شراءً</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead>
              <tr className="text-slate-500 text-sm border-b border-slate-100">
                <th className="pb-4 font-bold">العميل</th>
                <th className="pb-4 font-bold">إجمالي المشتريات</th>
                <th className="pb-4 font-bold">عدد الفواتير</th>
                <th className="pb-4 font-bold">متوسط الفاتورة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {stats.topCustomers.map((customer, idx) => (
                <tr key={idx} className="group hover:bg-slate-50 transition-colors">
                  <td className="py-4 font-bold text-slate-700">{customer.name}</td>
                  <td className="py-4 font-black text-indigo-600">{customer.total.toLocaleString()} {storeSettings.currency}</td>
                  <td className="py-4 text-slate-500 font-medium">{customer.orders} فاتورة</td>
                  <td className="py-4 text-slate-500 font-medium">{(customer.total / customer.orders).toFixed(0).toLocaleString()} {storeSettings.currency}</td>
                </tr>
              ))}
              {stats.topCustomers.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400 font-bold">لا يوجد بيانات عملاء لهذه الفترة</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, unit, icon: Icon, color, increase }: any) {
  const colors: any = {
    indigo: 'bg-indigo-600',
    emerald: 'bg-emerald-600',
    amber: 'bg-amber-500',
    slate: 'bg-slate-800',
    red: 'bg-red-600'
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all group overflow-hidden relative">
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-slate-50 rounded-full group-hover:scale-150 transition-transform duration-500 -z-0"></div>
      
      <div className="relative z-10 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className={`w-12 h-12 ${colors[color]} rounded-2xl flex items-center justify-center text-white shadow-lg`}>
            <Icon size={24} />
          </div>
          {increase !== undefined && (
            <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg ${increase ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
              {increase ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {increase ? '+12%' : '-5%'} 
            </div>
          )}
        </div>
        
        <div>
          <p className="text-slate-500 font-bold text-sm mb-1">{title}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black text-slate-900">{typeof value === 'number' ? value.toLocaleString() : value}</span>
            {unit && <span className="text-xs font-bold text-slate-400">{unit}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
