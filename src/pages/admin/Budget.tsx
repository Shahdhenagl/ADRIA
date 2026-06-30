import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { calculateInvoiceProfit } from '../../utils/invoiceProfit';
import { allocatePayment } from '../../utils/paymentAllocator';
import { 
  TrendingUp, TrendingDown, DollarSign, Activity, Filter, 
  Calendar, FileText, Banknote, CreditCard, Smartphone, Zap
} from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { ALL_PAYMENT_KEYS, activePaymentKeys, payLabelOf, type PaymentKey } from '../../utils/paymentMethods';

interface UnifiedTransaction {
  id: string;
  originalId: string;
  type: 'revenue' | 'expense';
  category: string;
  description: string;
  amount: number;
  payment_method: PaymentKey;
  date: Date;
  car_id?: string;
}

export default function Budget() {
  const { orders, expenses, purchaseInvoices, employeeTransactions, storeSettings, productionOrders, loadManufacturing } = useStore();

  useEffect(() => { loadManufacturing(); }, []);

  // Potential profit from all manufacturing runs = Σ (sale price − piece cost) × qty.
  const manufacturingProfit = useMemo(
    () => productionOrders.reduce((s, p) => s + (((Number(p.sale_price) || 0) - (Number(p.cost_per_piece) || 0)) * (Number(p.quantity) || 0)), 0),
    [productionOrders]
  );

  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'month' | 'custom_month' | 'year' | 'custom_year' | 'custom'>('month');
  const [customDate, setCustomDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [customMonth, setCustomMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [customYear, setCustomYear] = useState<string>(new Date().getFullYear().toString());
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentKey>('all');
  const activePayKeys = activePaymentKeys(storeSettings as any);
  const [isExporting, setIsExporting] = useState(false);

  const exportToPDF = async () => {
    const element = document.getElementById('budget-report');
    if (!element) return;
    
    setIsExporting(true);
    
    const buttons = element.querySelectorAll('.export-hide');
    buttons.forEach((b: any) => b.style.display = 'none');
    
    try {
      const canvas = await html2canvas(element, { 
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        onclone: (clonedDoc) => {
          const el = clonedDoc.getElementById('budget-report');
          if (el) {
            el.style.height = 'auto';
            el.style.overflow = 'visible';
          }
        }
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      pdf.save(`Budget_Report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error(error);
      alert('حدث خطأ أثناء تصدير التقرير');
    } finally {
      buttons.forEach((b: any) => b.style.display = '');
      setIsExporting(false);
    }
  };

  // Aggregation Logic
  const allTransactions = useMemo(() => {
    const txs: UnifiedTransaction[] = [];

    // Helper to add split transactions by payment method
    const addSplits = (
      id: string, type: 'revenue' | 'expense', category: string, desc: string, dateStr: string,
      split: Partial<Record<PaymentKey, number>>, carId?: string
    ) => {
      const date = new Date(dateStr);
      ALL_PAYMENT_KEYS.forEach((m) => {
        const amt = Number(split[m]) || 0;
        if (amt > 0) txs.push({ id: `${id}-${m}`, originalId: id, type, category, description: desc, amount: amt, payment_method: m, date, car_id: carId });
      });
    };
    // Read a record's per-method split; if all zero, fall back to its single payment_method.
    const splitOf = (rec: any, fallbackAmount: number): Partial<Record<PaymentKey, number>> => {
      const out: Partial<Record<PaymentKey, number>> = {};
      let sum = 0;
      ALL_PAYMENT_KEYS.forEach((m) => { const v = Math.abs(Number(rec[`paid_${m}`]) || 0); out[m] = v; sum += v; });
      if (sum === 0) {
        const m = (ALL_PAYMENT_KEYS as readonly string[]).includes(rec.payment_method) ? rec.payment_method as PaymentKey : 'cash';
        out[m] = Math.abs(fallbackAmount || 0);
      }
      return out;
    };

    // 1. Pre-calculate debt payments per invoice to reconstruct original paid amount for old orders
    const debtPaymentsByInvoice = new Map<string, number>();
    orders.filter(o => !o.is_deleted).forEach(o => {
      if (o.type === 'payment' && o.notes?.includes('سداد أجل للفاتورة رقم #')) {
        const match = o.notes.match(/سداد أجل للفاتورة رقم #([\w-]+)/);
        if (match && match[1]) {
          const invoiceId = match[1];
          debtPaymentsByInvoice.set(invoiceId, (debtPaymentsByInvoice.get(invoiceId) || 0) + (o.paid_amount || 0));
        }
      }
    });

    // 2. Orders (Sales revenues & Debt payments & Refunds)
    orders.filter((order) => !order.is_deleted).forEach(o => {
      const isPaymentOrder = o.type === 'payment';
      const totalRefunded = o.items?.reduce((sum, item) => sum + (item.refunded_amount || 0), 0) || 0;

      let initialPaidAmount = o.paid_amount || 0;
      const sumSplits = (o.paid_cash || 0) + (o.paid_visa || 0) + (o.paid_wallet || 0) + (o.paid_instapay || 0);

      if (isPaymentOrder) {
        initialPaidAmount = o.paid_amount || 0;
      } else {
        if (sumSplits > 0) {
          initialPaidAmount = sumSplits;
        } else {
          initialPaidAmount = (o.paid_amount || 0) - (debtPaymentsByInvoice.get(o.id) || 0) + totalRefunded;
        }
      }

      // Revenues: payments received
      if (initialPaidAmount > 0) {
        const cat = o.type === 'sale' ? (o.car_id ? 'إيرادات خدمات (سيارات)' : 'مبيعات كاشير') : 'تحصيل من العميل';
        const desc = o.type === 'sale' ? `فاتورة مبيعات #${o.id}` : `تحصيل من العميل #${o.id}`;
        
        addSplits(o.id, 'revenue', cat, desc, o.date, splitOf(o, initialPaidAmount), o.car_id);
      }

      // Expenses: Returns refunded amount
      if (totalRefunded > 0) {
        txs.push({
          id: `${o.id}-refund`,
          originalId: o.id,
          type: 'expense',
          category: 'مرتجعات عملاء',
          description: `إرجاع للفاتورة #${o.id}`,
          amount: totalRefunded,
          payment_method: ((o.refund_method && ['cash', 'visa', 'wallet', 'instapay'].includes(o.refund_method))
            ? o.refund_method
            : (['visa', 'wallet', 'instapay'].includes(o.payment_method) ? o.payment_method : 'cash')) as 'cash' | 'visa' | 'wallet' | 'instapay',
          date: new Date(o.date),
          car_id: o.car_id
        });
      }
    });

    // 2. Manual finance transactions (store expenses and extra revenues)
    expenses.forEach(e => {
      const isRevenue = e.amount < 0;
      addSplits(
        e.id,
        isRevenue ? 'revenue' : 'expense',
        `${isRevenue ? 'إيرادات' : 'مصروفات'} - ${e.category}`,
        e.note || (isRevenue ? 'إيراد عام' : 'مصروف عام'),
        e.date,
        splitOf(e, e.amount),
        e.car_id
      );
    });

    const hasMatchingExpense = (et: typeof employeeTransactions[number]) => {
      const etDate = new Date(et.created_at).toISOString().slice(0, 10);
      return expenses.some(e => {
        const expenseDate = new Date(e.date).toISOString().slice(0, 10);
        return e.category === 'رواتب'
          && expenseDate === etDate
          && Math.abs(e.amount) === Math.abs(et.amount)
          && Math.abs(e.paid_cash || 0) === Math.abs(et.paid_cash || 0)
          && Math.abs(e.paid_visa || 0) === Math.abs(et.paid_visa || 0)
          && Math.abs(e.paid_wallet || 0) === Math.abs(et.paid_wallet || 0)
          && Math.abs(e.paid_instapay || 0) === Math.abs(et.paid_instapay || 0)
          && Math.abs((e as any).paid_method5 || 0) === Math.abs(et.paid_method5 || 0)
          && Math.abs((e as any).paid_method6 || 0) === Math.abs(et.paid_method6 || 0);
      });
    };

    // 3. Purchase Invoices (Purchases & Supplier payments)
    purchaseInvoices.forEach(p => {
      if (p.paid_amount > 0) {
        addSplits(p.id, 'expense', p.total === 0 ? 'سداد للمورد' : 'مشتريات وموردين', `${p.total === 0 ? 'سداد للمورد' : 'فاتورة مشتريات'} #${p.invoice_number}`, p.created_at, splitOf(p, p.paid_amount));
      }
    });

    // 4. Employee Transactions (Salaries & Advances)
    employeeTransactions.forEach(et => {
      if (hasMatchingExpense(et)) return;
      const cat = et.type === 'salary' ? 'رواتب' : 'سلف موظفين';
      
      addSplits(et.id, 'expense', `رواتب وموظفين - ${cat}`, et.note || `دفع ${cat}`, et.created_at, splitOf(et, et.amount));
    });

    // Sort by date descending
    return txs.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [orders, expenses, purchaseInvoices, employeeTransactions]);

  // Filtering Logic
  const filteredTransactions = useMemo(() => {
    let result = allTransactions;

    // Date Filter
    if (dateFilter !== 'all') {
      const now = new Date();
      result = result.filter(tx => {
        if (dateFilter === 'today') {
          return tx.date.toDateString() === now.toDateString();
        } else if (dateFilter === 'month') {
          return tx.date.getMonth() === now.getMonth() && tx.date.getFullYear() === now.getFullYear();
        } else if (dateFilter === 'year') {
          return tx.date.getFullYear() === now.getFullYear();
        } else if (dateFilter === 'custom') {
          const txYear = tx.date.getFullYear();
          const txMonth = String(tx.date.getMonth() + 1).padStart(2, '0');
          const txDay = String(tx.date.getDate()).padStart(2, '0');
          const txDateStr = `${txYear}-${txMonth}-${txDay}`;
          return txDateStr === customDate;
        } else if (dateFilter === 'custom_month') {
          const txYear = tx.date.getFullYear();
          const txMonth = String(tx.date.getMonth() + 1).padStart(2, '0');
          return `${txYear}-${txMonth}` === customMonth;
        } else if (dateFilter === 'custom_year') {
          return tx.date.getFullYear().toString() === customYear;
        }
        return true;
      });
    }

    // Method Filter
    if (methodFilter !== 'all') {
      result = result.filter(tx => tx.payment_method === methodFilter);
    }

    return result;
  }, [allTransactions, dateFilter, methodFilter, customDate, customMonth, customYear]);

  // Stats Logic
  const stats = useMemo(() => {
    let totalRevenue = 0;
    let totalExpense = 0;
    let collectedFromInvoices = 0;
    let collectedFromOther = 0;
    let serviceRevenues = 0;
    let serviceExpenses = 0;

    filteredTransactions.forEach(tx => {
      if (tx.type === 'revenue') {
        totalRevenue += tx.amount;
        if (tx.category === 'تحصيل من العميل') {
          const origOrder = orders.find((o: any) => o.id === tx.originalId);
          if (origOrder) {
            const { toSales, toServices, toOldDebt } = allocatePayment(origOrder, orders);
            collectedFromInvoices += toSales;
            serviceRevenues += toServices;
            collectedFromOther += toOldDebt;
          } else {
            collectedFromOther += tx.amount;
          }
        } else if (tx.car_id || tx.category === 'إيرادات خدمات (سيارات)') {
          serviceRevenues += tx.amount;
        } else if (tx.category === 'مبيعات كاشير') {
          collectedFromInvoices += tx.amount;
        } else {
          collectedFromOther += tx.amount;
        }
      }
      else if (tx.type === 'expense') {
        totalExpense += tx.amount;
        if (tx.car_id || tx.category.includes('مصروفات سيارات')) {
          serviceExpenses += tx.amount;
        }
      }
    });

    const orderMatchesDateFilter = (date: Date) => {
      if (dateFilter === 'all') return true;
      const now = new Date();
      if (dateFilter === 'today') {
        return date.toDateString() === now.toDateString();
      }
      if (dateFilter === 'month') {
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      }
      if (dateFilter === 'year') {
        return date.getFullYear() === now.getFullYear();
      }
      if (dateFilter === 'custom') {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}` === customDate;
      }
      if (dateFilter === 'custom_month') {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}` === customMonth;
      }
      if (dateFilter === 'custom_year') {
        return date.getFullYear().toString() === customYear;
      }
      return true;
    };

    const getInvoiceProfitByMethod = (order: any) => {
      const profit = calculateInvoiceProfit(order);
      if (methodFilter === 'all') return profit;

      const paidAmount = Number(order.paid_amount) || 0;
      if (paidAmount <= 0) return 0;

      const methodAmount = Number(order[`paid_${methodFilter}`]) || 0;
      return profit * (methodAmount / paidAmount);
    };

    const invoiceProfit = orders
      .filter(order => !order.car_id && orderMatchesDateFilter(new Date(order.date)))
      .reduce((sum, order) => sum + getInvoiceProfitByMethod(order), 0);

    const getEndOfPeriod = () => {
      const now = new Date();
      if (dateFilter === 'today') {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      }
      if (dateFilter === 'month') {
        return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      }
      if (dateFilter === 'year') {
        return new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      }
      if (dateFilter === 'custom') {
        const d = new Date(customDate);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      }
      if (dateFilter === 'custom_month') {
        const [year, month] = customMonth.split('-');
        return new Date(Number(year), Number(month), 0, 23, 59, 59, 999);
      }
      if (dateFilter === 'custom_year') {
        return new Date(Number(customYear), 11, 31, 23, 59, 59, 999);
      }
      return new Date(8640000000000000);
    };

    const endOfPeriod = getEndOfPeriod();
    const closingBalance = allTransactions
      .filter(tx => tx.date <= endOfPeriod)
      .reduce((sum, tx) => sum + (tx.type === 'revenue' ? tx.amount : -tx.amount), 0);

    return {
      totalRevenue,
      totalExpense,
      invoiceProfit,
      serviceProfit: serviceRevenues - serviceExpenses,
      collectedFromInvoices,
      collectedFromOther,
      closingBalance,
      netProfit: totalRevenue - totalExpense,
      count: filteredTransactions.length
    };
  }, [filteredTransactions, allTransactions, orders, dateFilter, customDate, customMonth, customYear, methodFilter]);

  const totalCustomerDebt = useMemo(() => {
    return Math.max(0, orders.filter(o => !o.is_deleted).reduce((sum, o) => sum + (o.total - o.paid_amount), 0));
  }, [orders]);

  const totalSupplierDebt = useMemo(() => {
    return Math.max(0, purchaseInvoices.reduce((sum, inv) => sum + (inv.total - inv.paid_amount), 0));
  }, [purchaseInvoices]);

  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'cash': return <Banknote size={16} className="text-emerald-500" />;
      case 'visa': return <CreditCard size={16} className="text-blue-500" />;
      case 'wallet': return <Smartphone size={16} className="text-purple-500" />;
      case 'instapay': return <Zap size={16} className="text-yellow-500" />;
      default: return <Banknote size={16} />;
    }
  };

  const getMethodName = (method: string) => payLabelOf(storeSettings as any, method);

  return (
    <div className="p-6 md:p-8 space-y-8 animate-fade-in" id="budget-report">
      <details className="export-hide bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl p-4 border border-indigo-100 dark:border-indigo-800">
        <summary className="cursor-pointer font-black text-indigo-800 dark:text-indigo-300 select-none">
          📘 دليل سريع: يعني إيه الأرقام دي؟
        </summary>
        <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-300 list-disc pr-5 leading-relaxed">
          <li><b>إجمالي الإيرادات:</b> كل الفلوس اللي دخلت فعلاً (مبيعات مدفوعة + تحصيل من العملاء على الأجل + أي إيراد إضافي).</li>
          <li><b>إجمالي المصروفات:</b> كل الفلوس اللي خرجت (مشتريات للموردين + مصروفات + رواتب + مرتجعات اترد فيها كاش).</li>
          <li><b>صافي الربح / صافي الخزنة:</b> الإيرادات ناقص المصروفات. لو موجب يبقى ربح، لو سالب يبقى خسارة.</li>
          <li><b>إيرادات أخرى ومسدّد آجل:</b> المبالغ اللي العملاء سدّدوها من مديونيتهم القديمة + أي إيراد يدوي.</li>
          <li><b>مبيعات آجلة (أجل):</b> بضاعة اتباعت ولسه مدفوعتش — مش بتتحسب إيراد دلوقتي، بتتحسب لما العميل يسدّد.</li>
          <li><b>مرتجعات عملاء:</b> بس المرتجع اللي اترد فيه <b>كاش</b> بيظهر كمصروف. المرتجع اللي اتخصم من المديونية مش بيظهر هنا لأنه مخرّجش كاش — هو بس قلّل دين العميل.</li>
        </ul>
      </details>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3">
            <Activity className="text-indigo-600" size={32} />
            الميزانية العامة
          </h1>
          <p className="text-slate-500 mt-2 font-medium">ملخص الأرباح والمصروفات وحركة الخزينة الشاملة</p>
        </div>

        {/* Filters and Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="export-hide">
            <button 
              onClick={exportToPDF}
              disabled={isExporting}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition shadow-sm border ${
                isExporting ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-red-50 text-red-600 hover:bg-red-100 border-red-100'
              }`}
              title="تصدير كملف PDF"
            >
              <FileText size={18} />
              {isExporting ? 'جاري التصدير...' : 'تصدير PDF'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-800 p-2 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 export-hide">
          <div className="flex items-center gap-2 border-l border-slate-200 dark:border-slate-700 pl-3">
            <Calendar size={18} className="text-slate-400" />
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="bg-transparent text-sm font-bold text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="today">اليوم</option>
              <option value="month">الشهر الحالي</option>
              <option value="custom_month">شهر محدد</option>
              <option value="year">السنة الحالية</option>
              <option value="custom_year">سنة محددة</option>
              <option value="all">كل الأوقات</option>
              <option value="custom">يوم محدد</option>
            </select>
            {dateFilter === 'custom' && (
              <input 
                type="date" 
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="bg-transparent text-sm font-bold text-indigo-600 dark:text-indigo-400 focus:outline-none ml-2"
              />
            )}
            {dateFilter === 'custom_month' && (
              <input 
                type="month" 
                value={customMonth}
                onChange={(e) => setCustomMonth(e.target.value)}
                className="bg-transparent text-sm font-bold text-indigo-600 dark:text-indigo-400 focus:outline-none ml-2"
              />
            )}
            {dateFilter === 'custom_year' && (
              <input 
                type="number" 
                value={customYear}
                onChange={(e) => setCustomYear(e.target.value)}
                className="bg-transparent text-sm font-bold text-indigo-600 dark:text-indigo-400 focus:outline-none ml-2 w-20"
                placeholder="2026"
                min="2020"
                max="2100"
              />
            )}
          </div>
          <div className="flex items-center gap-2 pr-2">
            <Filter size={18} className="text-slate-400" />
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as any)}
              className="bg-transparent text-sm font-bold text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">كل طرق الدفع</option>
              {activePayKeys.map((k) => <option key={k} value={k}>{payLabelOf(storeSettings as any, k)}</option>)}
            </select>
          </div>
          </div>
        </div>
      </div>

      {/* New Breakdown Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden group">
          <div className="absolute inset-0 opacity-10 transition-opacity group-hover:opacity-20 bg-blue-500" />
          <div className="flex items-center gap-4 mb-4 relative z-10">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg bg-blue-500">
              <Banknote size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">رصيد الخزنة (الإغلاق)</p>
              <h3 className="text-2xl font-black mt-1 text-blue-600 dark:text-blue-400">
                {stats.closingBalance.toFixed(2)} <span className="text-xs text-slate-400">{storeSettings.currency}</span>
              </h3>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 rounded-2xl flex items-center justify-center">
              <DollarSign size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">المحصل من الفواتير</p>
              <h3 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                {stats.collectedFromInvoices.toFixed(2)} <span className="text-xs text-slate-400">{storeSettings.currency}</span>
              </h3>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 rounded-2xl flex items-center justify-center">
              <TrendingUp size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">إيرادات أخرى ومسدد آجل</p>
              <h3 className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
                {stats.collectedFromOther.toFixed(2)} <span className="text-xs text-slate-400">{storeSettings.currency}</span>
              </h3>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/50 text-amber-600 rounded-2xl flex items-center justify-center">
              <Activity size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">إجمالي الآجل على العملاء</p>
              <h3 className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
                {totalCustomerDebt.toFixed(2)} <span className="text-xs text-slate-400">{storeSettings.currency}</span>
              </h3>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/50 text-red-600 rounded-2xl flex items-center justify-center">
              <FileText size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">إجمالي المديونية للموردين</p>
              <h3 className="text-2xl font-black text-red-600 dark:text-red-400 mt-1">
                {totalSupplierDebt.toFixed(2)} <span className="text-xs text-slate-400">{storeSettings.currency}</span>
              </h3>
            </div>
          </div>
        </div>
      </div>

      {/* Main Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 rounded-2xl flex items-center justify-center">
              <TrendingUp size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">إجمالي الإيرادات</p>
              <h3 className="text-2xl font-black text-slate-800 dark:text-white mt-1">{stats.totalRevenue.toFixed(2)}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/50 text-red-600 rounded-2xl flex items-center justify-center">
              <TrendingDown size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">إجمالي المصروفات</p>
              <h3 className="text-2xl font-black text-slate-800 dark:text-white mt-1">{stats.totalExpense.toFixed(2)}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 rounded-2xl flex items-center justify-center">
              <FileText size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">إجمالي الربح من الفواتير</p>
              <h3 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{stats.invoiceProfit.toFixed(2)}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 rounded-2xl flex items-center justify-center">
              <TrendingUp size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">صافي الربح من التصنيع</p>
              <h3 className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{manufacturingProfit.toFixed(2)}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden group">
          <div className={`absolute inset-0 opacity-10 transition-opacity group-hover:opacity-20 ${stats.netProfit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <div className="flex items-center gap-4 mb-4 relative z-10">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg ${stats.netProfit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}>
              <DollarSign size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">صافي حركة الخزنة</p>
              <h3 className={`text-2xl font-black mt-1 ${stats.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {stats.netProfit.toFixed(2)}
              </h3>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 rounded-2xl flex items-center justify-center">
              <FileText size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500">العمليات التي تمت</p>
              <h3 className="text-2xl font-black text-slate-800 dark:text-white mt-1">{stats.count} <span className="text-sm text-slate-500 font-bold">معاملة</span></h3>
            </div>
          </div>
        </div>
      </div>

      {/* Balance Sheet Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Revenues Table */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
          <div className="p-6 border-b border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/50 dark:bg-emerald-900/10">
            <h2 className="text-xl font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
              <TrendingUp size={24} />
              الإيرادات
            </h2>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-right">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 font-bold text-sm">
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">التصنيف</th>
                  <th className="px-4 py-3">الدفع</th>
                  <th className="px-4 py-3 text-left">القيمة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredTransactions.filter(tx => tx.type === 'revenue').length > 0 ? (
                  filteredTransactions.filter(tx => tx.type === 'revenue').map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                            {tx.date.toLocaleDateString('ar-SA')}
                          </span>
                          <span className="text-xs text-slate-500">
                            {tx.date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-700 dark:text-slate-300 text-sm">{tx.category}</span>
                          <span className="text-xs text-slate-500 max-w-[120px] truncate" title={tx.description}>{tx.description}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {getMethodIcon(tx.payment_method)}
                          <span className="font-bold text-slate-700 dark:text-slate-300 text-xs">
                            {getMethodName(tx.payment_method)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-left">
                        <span className="font-black text-emerald-600 dark:text-emerald-400">
                          + {tx.amount.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-slate-500">
                      <p className="font-bold">لا توجد إيرادات</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Expenses Table */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
          <div className="p-6 border-b border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10">
            <h2 className="text-xl font-bold text-red-700 dark:text-red-400 flex items-center gap-2">
              <TrendingDown size={24} />
              المصروفات
            </h2>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-right">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 font-bold text-sm">
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">التصنيف</th>
                  <th className="px-4 py-3">الدفع</th>
                  <th className="px-4 py-3 text-left">القيمة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredTransactions.filter(tx => tx.type === 'expense').length > 0 ? (
                  filteredTransactions.filter(tx => tx.type === 'expense').map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                            {tx.date.toLocaleDateString('ar-SA')}
                          </span>
                          <span className="text-xs text-slate-500">
                            {tx.date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-700 dark:text-slate-300 text-sm">{tx.category}</span>
                          <span className="text-xs text-slate-500 max-w-[120px] truncate" title={tx.description}>{tx.description}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {getMethodIcon(tx.payment_method)}
                          <span className="font-bold text-slate-700 dark:text-slate-300 text-xs">
                            {getMethodName(tx.payment_method)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-left">
                        <span className="font-black text-red-600 dark:text-red-400">
                          - {tx.amount.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-slate-500">
                      <p className="font-bold">لا توجد مصروفات</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
