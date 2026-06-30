import { useStore } from '../../store/useStore';
import { Banknote, ShoppingBag, ReceiptText, DollarSign } from 'lucide-react';
import { calculateCashRefunded } from '../../utils/returns';

export default function Overview() {
  const { orders, products, expenses, storeSettings, purchaseInvoices } = useStore();
  const activeOrders = orders.filter((order) => !order.is_deleted);

  let totalNetRevenue = 0;
  let validOrdersCount = 0;

  activeOrders.forEach(order => {
    if (order.type === 'payment') {
      totalNetRevenue += order.paid_amount;
    } else {
      validOrdersCount++;
      order.items.forEach(item => {
        const qty = item.quantity - item.returned_quantity;
        const revenue = item.sale_price * qty;
        totalNetRevenue += revenue;
      });
    }
  });

  const extraIncomes = expenses.filter(e => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);
  totalNetRevenue += extraIncomes;

  // Calculate Net Safe Balance
  const initialBalance = storeSettings.initial_balance || 0;
  const ordersIn = activeOrders.reduce((sum, o) => {
    if (o.type === 'payment') return sum + (o.paid_amount || 0);
    
    let initialPaid = o.paid_amount || 0;
    const sumSplits = (o.paid_cash || 0) + (o.paid_visa || 0) + (o.paid_wallet || 0) + (o.paid_instapay || 0);
    if (sumSplits > 0) {
      initialPaid = sumSplits;
    } else {
      const paymentsForThis = activeOrders.filter(p => p.type === 'payment' && p.notes?.includes(`سداد أجل للفاتورة رقم #${o.id}`));
      const paymentsSum = paymentsForThis.reduce((s, p) => s + (p.paid_amount || 0), 0);
      initialPaid -= paymentsSum;
    }
    // We do not add totalRefunded back here because returnsOut subtracts it later, 
    // and if initialPaid was reduced by processReturn, then it's already subtracted once.
    // Wait, if initialPaid was reduced by processReturn AND we subtract returnsOut later, it's double subtracted!
    // But returnsOut in Overview uses `calculateOrderReturnValue(o)`, which is the item prices.
    // And initialPaid here is just cash in.
    // To be perfectly accurate on Cash In:
    const totalRefunded = o.items?.reduce((s, item) => s + (item.refunded_amount || 0), 0) || 0;
    if (sumSplits === 0) initialPaid += totalRefunded;

    return sum + initialPaid;
  }, 0);

  const returnsOut = activeOrders.reduce((sum, o) => sum + calculateCashRefunded(o), 0);
  const expensesOut = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const purchasesOut = purchaseInvoices.reduce((sum, inv) => sum + inv.paid_amount, 0);
  
  const totalSafeBalance = initialBalance + ordersIn - returnsOut - expensesOut - purchasesOut;

  const lowStockProducts = products.filter((p) => p.stock_quantity < 5).length;

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap gap-3 justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-800">نظرة عامة</h1>
          <p className="text-slate-500 mt-2">إحصائيات المبيعات والأداء</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-6">
          <div 
            style={{ backgroundColor: storeSettings.themeColor + '15', color: storeSettings.themeColor }}
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
          >
            <Banknote size={32} />
          </div>
          <div>
            <p className="text-slate-500 text-sm font-bold mb-1">إجمالي المبيعات والإيرادات</p>
            <h2 className="text-2xl font-black text-slate-800">{totalNetRevenue.toFixed(2)} <span className="text-sm text-slate-400">{storeSettings.currency}</span></h2>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <DollarSign size={32} />
          </div>
          <div>
            <p className="text-slate-500 text-sm font-bold mb-1">صافي رصيد الخزنة</p>
            <h2 className="text-2xl font-black text-emerald-600">{totalSafeBalance.toFixed(2)} <span className="text-sm text-slate-400">{storeSettings.currency}</span></h2>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-6">
          <div 
            style={{ backgroundColor: storeSettings.themeColor + '15', color: storeSettings.themeColor }}
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
          >
            <ReceiptText size={32} />
          </div>
          <div>
            <p className="text-slate-500 text-sm font-bold mb-1">عدد الفواتير</p>
            <h2 className="text-2xl font-black text-slate-800">{validOrdersCount} <span className="text-sm text-slate-400">فاتورة</span></h2>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center text-red-500">
            <ShoppingBag size={32} />
          </div>
          <div>
            <p className="text-slate-500 text-sm font-bold mb-1">منتجات أوشكت على النفاذ</p>
            <h2 className="text-2xl font-black text-slate-800">{lowStockProducts} <span className="text-sm text-slate-400">منتج</span></h2>
          </div>
        </div>
      </div>

      {/* Recent Orders Table */}
      <h3 className="text-xl font-bold text-slate-800 mb-4">أحدث الفواتير</h3>
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-right">
          <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 text-sm">
            <tr>
              <th className="p-4 font-bold">رقم الفاتورة</th>
              <th className="p-4 font-bold">التاريخ</th>
              <th className="p-4 font-bold">المنتجات المباعة</th>
              <th className="p-4 font-bold">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {activeOrders.length === 0 ? (
              <tr><td colSpan={4} className="p-8 text-center text-slate-400">لا توجد مبيعات حتى الآن</td></tr>
            ) : (
              activeOrders.slice(0, 10).map((order) => {
                const netTotal = order.items.reduce((sum, item) => sum + (item.sale_price * (item.quantity - item.returned_quantity)), 0);
                return (
                  <tr key={order.id} className="hover:bg-slate-50 transition">
                    <td className="p-4 font-bold text-indigo-600 font-mono">{order.id}</td>
                    <td className="p-4 text-slate-600">{new Date(order.date).toLocaleDateString('ar-SA')}</td>
                    <td className="p-4 text-slate-600 truncate max-w-xs">{order.items.map(i => i.name).join(', ')}</td>
                    <td className="p-4 font-black">{netTotal.toFixed(2)} {storeSettings.currency}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
