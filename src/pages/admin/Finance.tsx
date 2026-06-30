import { useState, useMemo } from 'react';
import { useStore, type Expense, type Order, type PurchaseInvoice } from '../../store/useStore';
import { 
  Wallet, Plus, Trash2, Search, ArrowUp, ArrowDown, 
  Calendar, Edit3, X, Download, TrendingUp, CreditCard, Smartphone, Zap, 
  ArrowRightLeft, Landmark, FileText, Printer
} from 'lucide-react';
import { calculateInvoiceProfit } from '../../utils/invoiceProfit';
import { calculateOrderReturnValue, calculateCashRefunded } from '../../utils/returns';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { activePaymentKeys, payLabelOf, primaryMethod as primaryMethod_ } from '../../utils/paymentMethods';
import { allocatePayment } from '../../utils/paymentAllocator';

export default function Finance() {
  const { 
    expenses, orders, storeSettings, addExpense, updateExpense, 
    deleteExpense, deletePurchaseInvoice, purchaseInvoices,
    deleteOrder, editOrder, updatePurchaseInvoice
  } = useStore();
  const activeOrders = useMemo(() => orders.filter((order) => !order.is_deleted), [orders]);

  const debtPaymentsByInvoice = useMemo(() => {
    const map = new Map<string, number>();
    activeOrders.forEach(o => {
      if (o.type === 'payment' && o.notes?.includes('سداد أجل للفاتورة رقم #')) {
        const match = o.notes.match(/سداد أجل للفاتورة رقم #([\w-]+)/);
        if (match && match[1]) {
          map.set(match[1], (map.get(match[1]) || 0) + (o.paid_amount || 0));
        }
      }
    });
    return map;
  }, [activeOrders]);

  const getInitialPaidAmount = (o: any) => {
    if (o.type === 'payment') return o.paid_amount || 0;
    const sumSplits = (o.paid_cash || 0) + (o.paid_visa || 0) + (o.paid_wallet || 0) + (o.paid_instapay || 0);
    if (sumSplits > 0) return sumSplits;
    const totalRefunded = o.items?.reduce((s: number, item: any) => s + (item.refunded_amount || 0), 0) || 0;
    return (o.paid_amount || 0) - (debtPaymentsByInvoice.get(o.id) || 0) + totalRefunded;
  };


  
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterType, setFilterType] = useState<'daily' | 'monthly' | 'yearly'>('daily');
  const selectedDateDisplay = useMemo(() => {
    const [year, month, day] = selectedDate.split('-');
    if (filterType === 'yearly') return year;
    if (filterType === 'monthly') return `${month}/${year}`;
    return `${day}/${month}/${year}`;
  }, [filterType, selectedDate]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<PurchaseInvoice | null>(null);
  const [formData, setFormData] = useState({ 
    transaction_type: 'expense',
    category: 'عام', 
    amount: '', 
    paid_cash: '',
    paid_visa: '',
    paid_wallet: '',
    paid_instapay: '',
    paid_method5: '',
    paid_method6: '',
    note: '',
    transfer_from: 'instapay',
    transfer_to: 'cash',
    transfer_amount: ''
  });

  // --- Calculations ---

  const initialBalance = storeSettings.initial_balance || 0;

  // Helper to get date string without time
  const getDateStr = (date: string | Date) => new Date(date).toISOString().split('T')[0];

  // 1. Transactions before selected date (for Opening Balance)
  const totalsBefore = useMemo(() => {
    const selDate = new Date(selectedDate);
    let startOfPeriod: Date;

    if (filterType === 'monthly') {
      startOfPeriod = new Date(selDate.getFullYear(), selDate.getMonth(), 1);
    } else if (filterType === 'yearly') {
      startOfPeriod = new Date(selDate.getFullYear(), 0, 1);
    } else {
      startOfPeriod = new Date(selectedDate);
      startOfPeriod.setHours(0,0,0,0);
    }
    
    const ordersIn = activeOrders
      .filter(o => new Date(o.date) < startOfPeriod)
      .reduce((sum, o) => sum + getInitialPaidAmount(o), 0);
    
    const returnsOut = activeOrders
      .filter(o => new Date(o.date) < startOfPeriod)
      .reduce((sum, o) => sum + calculateCashRefunded(o), 0);
    
    const expensesOut = expenses
      .filter(e => new Date(e.date) < startOfPeriod)
      .reduce((sum, e) => sum + e.amount, 0);

    const purchasesOut = purchaseInvoices
      .filter(inv => new Date(inv.created_at) < startOfPeriod)
      .reduce((sum, inv) => sum + inv.paid_amount, 0);

    return (ordersIn - returnsOut - expensesOut - purchasesOut);
  }, [activeOrders, expenses, purchaseInvoices, selectedDate, filterType]);

  const openingBalance = initialBalance + totalsBefore;

  const getPrimaryMethod = (item: any) => {
    if (typeof item.payment_method === 'string' && ['visa', 'wallet', 'instapay', 'method5', 'method6'].includes(item.payment_method)) {
      return item.payment_method;
    }
    return 'cash';
  };

  const getSafeMethodAmount = (item: any, method: string, totalPaidField: string) => {
    let rawTotal = item[totalPaidField] || 0;
    if (totalPaidField === 'paid_amount' && item.type !== undefined && item.items !== undefined) {
      rawTotal = getInitialPaidAmount(item);
    }
    const totalPaid = Math.abs(rawTotal);
    const cash = Math.abs(item.paid_cash || 0);
    const visa = Math.abs(item.paid_visa || 0);
    const wallet = Math.abs(item.paid_wallet || 0);
    const instapay = Math.abs(item.paid_instapay || 0);
    const m5 = Math.abs(item.paid_method5 || 0);
    const m6 = Math.abs(item.paid_method6 || 0);
    const splitsSum = cash + visa + wallet + instapay + m5 + m6;

    if (splitsSum > 0) {
      // Transfer case: amount=0 but splits have real values (positive/negative)
      if (totalPaid === 0 && splitsSum > 0) {
        // For transfers: paid_cash=+500 means cash GAINED money,
        // but in balance formula expenses are subtracted, so negate
        return -(item[`paid_${method}`] || 0);
      }
      let methodVal = Math.abs(item[`paid_${method}`] || 0);
      if (splitsSum !== totalPaid) {
        methodVal = methodVal * (totalPaid / splitsSum);
      }
      return rawTotal < 0 ? -methodVal : methodVal;
    }

    if (getPrimaryMethod(item) === method) {
      return rawTotal;
    }
    return 0;
  };

  const getOpeningBalanceByMethod = (method: string) => {
    const selDate = new Date(selectedDate);
    let startOfPeriod: Date;

    if (filterType === 'monthly') {
      startOfPeriod = new Date(selDate.getFullYear(), selDate.getMonth(), 1);
    } else if (filterType === 'yearly') {
      startOfPeriod = new Date(selDate.getFullYear(), 0, 1);
    } else {
      startOfPeriod = new Date(selectedDate);
      startOfPeriod.setHours(0,0,0,0);
    }

    const ordersIn = activeOrders
      .filter(o => new Date(o.date) < startOfPeriod)
      .reduce((sum, o) => sum + getSafeMethodAmount(o, method, 'paid_amount'), 0);
    
    const returnsOut = activeOrders
      .filter(o => new Date(o.date) < startOfPeriod && (o.refund_method || getPrimaryMethod(o)) === method)
      .reduce((sum, o) => sum + calculateCashRefunded(o), 0);

    const expensesOut = expenses
      .filter(e => new Date(e.date) < startOfPeriod)
      .reduce((sum, e) => sum + getSafeMethodAmount(e, method, 'amount'), 0);

    const purchasesOut = purchaseInvoices
      .filter(inv => new Date(inv.created_at) < startOfPeriod)
      .reduce((sum, inv) => sum + getSafeMethodAmount(inv, method, 'paid_amount'), 0);

    const initial = method === 'cash' ? initialBalance : 0;

    return initial + ordersIn - returnsOut - expensesOut - purchasesOut;
  };

  // 2. Period Transactions
  const periodTransactions = useMemo(() => {
    const selDate = new Date(selectedDate);
    return {
      orders: activeOrders.filter(o => {
        const d = new Date(o.date);
        if (filterType === 'monthly') return d.getFullYear() === selDate.getFullYear() && d.getMonth() === selDate.getMonth();
        if (filterType === 'yearly') return d.getFullYear() === selDate.getFullYear();
        return getDateStr(o.date) === selectedDate;
      }),
      expenses: expenses.filter(e => {
        const d = new Date(e.date);
        if (filterType === 'monthly') return d.getFullYear() === selDate.getFullYear() && d.getMonth() === selDate.getMonth();
        if (filterType === 'yearly') return d.getFullYear() === selDate.getFullYear();
        return getDateStr(e.date) === selectedDate;
      }),
      purchases: purchaseInvoices.filter(inv => {
        const d = new Date(inv.created_at);
        if (filterType === 'monthly') return d.getFullYear() === selDate.getFullYear() && d.getMonth() === selDate.getMonth();
        if (filterType === 'yearly') return d.getFullYear() === selDate.getFullYear();
        return getDateStr(inv.created_at) === selectedDate;
      })
    };
  }, [activeOrders, expenses, purchaseInvoices, selectedDate, filterType]);

  const collectedFromInvoices = periodTransactions.orders.filter(o => o.type === 'sale').reduce((sum, o) => sum + getInitialPaidAmount(o), 0) +
                                periodTransactions.orders.filter(o => o.type === 'payment').reduce((sum, o) => {
                                  const alloc = allocatePayment(o, activeOrders);
                                  return sum + alloc.toSales + (alloc.toServices || 0);
                                }, 0);
  const collectedFromOther = periodTransactions.orders.filter(o => o.type === 'payment').reduce((sum, o) => sum + allocatePayment(o, activeOrders).toOldDebt, 0) + 
                             periodTransactions.expenses.filter(e => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);
  const dailyIncome = collectedFromInvoices + collectedFromOther;

  const totalCustomerDebt = useMemo(() => {
    const debtMap: Record<string, number> = {};
    for (const o of activeOrders) {
      const cid = (typeof (o as any).customer_id === 'string' ? (o as any).customer_id : o.customer?.id) as string;
      if (!cid) continue;
      if (!debtMap[cid]) debtMap[cid] = 0;
      const returnedValue = calculateOrderReturnValue(o);
      const effectiveTotal = o.type === 'payment' ? 0 : o.total - returnedValue;
      const debt = effectiveTotal - o.paid_amount;
      if (debt > 0.009) {
        debtMap[cid] += debt;
      } else if (o.type === 'payment' && !(o.notes && o.notes.includes('سداد أجل للفاتورة رقم'))) {
        debtMap[cid] += debt;
      }
    }
    return Object.values(debtMap)
      .map(d => Math.max(0, d))
      .reduce((sum, d) => sum + d, 0);
  }, [activeOrders]);

  const totalSupplierDebt = useMemo(() => {
    const debtMap: Record<string, number> = {};
    for (const inv of purchaseInvoices) {
      if (!inv.supplier_id) continue;
      if (!debtMap[inv.supplier_id]) debtMap[inv.supplier_id] = 0;
      debtMap[inv.supplier_id] += (inv.total - inv.paid_amount);
    }
    return Object.values(debtMap)
      .map(d => Math.max(0, d))
      .reduce((sum, d) => sum + d, 0);
  }, [purchaseInvoices]);
  const dailyExpensesTotal = periodTransactions.expenses.filter(e => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
  const dailyPurchasesTotal = periodTransactions.purchases.reduce((sum, inv) => sum + inv.paid_amount, 0);
  const dailyReturnsValue = periodTransactions.orders.reduce((sum, o) => {
    return sum + calculateCashRefunded(o);
  }, 0);
  const invoiceProfitTotal = periodTransactions.orders.reduce((sum, order) => sum + calculateInvoiceProfit(order), 0);

  const dailyNet = dailyIncome - dailyExpensesTotal - dailyPurchasesTotal - dailyReturnsValue;
  const closingBalance = openingBalance + dailyNet;

  // 3. Payment Method Breakdown (Daily)
  const getDailyByMethod = (method: string) => {
    const inc = periodTransactions.orders.reduce((sum, o) => sum + getSafeMethodAmount(o, method, 'paid_amount'), 0);
    const returnsOut = periodTransactions.orders
      .filter(o => (o.refund_method || getPrimaryMethod(o)) === method)
      .reduce((sum, o) => sum + calculateCashRefunded(o), 0);
    const outExp = periodTransactions.expenses.reduce((sum, e) => sum + getSafeMethodAmount(e, method, 'amount'), 0);
    const outPur = periodTransactions.purchases.reduce((sum, inv) => sum + getSafeMethodAmount(inv, method, 'paid_amount'), 0);
    
    return inc - returnsOut - outExp - outPur;
  };

  const methodsBreakdown: Record<string, number> = {};
  activePaymentKeys(storeSettings as any).forEach((m) => {
    methodsBreakdown[m] = getDailyByMethod(m) + getOpeningBalanceByMethod(m);
  });

  // 4. Combined Transaction List for the table
  const allDailyTransactions = useMemo(() => {
    const list: any[] = [];
    
    periodTransactions.orders.forEach(o => {
      let cash = o.paid_cash || 0;
      let visa = o.paid_visa || 0;
      let wallet = o.paid_wallet || 0;
      let instapay = o.paid_instapay || 0;
      let initialPaid = getInitialPaidAmount(o);
      if (cash + visa + wallet + instapay === 0) {
        cash = o.payment_method === 'cash' ? initialPaid : 0;
        visa = o.payment_method === 'visa' ? initialPaid : 0;
        wallet = o.payment_method === 'wallet' ? initialPaid : 0;
        instapay = o.payment_method === 'instapay' ? initialPaid : 0;
      }

      list.push({
        id: o.id,
        type: o.type === 'sale' ? 'إيراد مبيعات' : 'تحصيل من العميل',
        amount: getInitialPaidAmount(o),
        method: o.payment_method,
        split: { cash, visa, wallet, instapay },
        note: o.customer?.name || 'عميل نقدي',
        isOut: false,
        time: new Date(o.date).toLocaleString('ar-SA'),
        rawDate: o.date,
        original: o,
        originType: 'order'
      });

      const returnedVal = calculateCashRefunded(o);

      if (returnedVal > 0) {
        const primaryMethod = o.refund_method || getPrimaryMethod(o);
        list.push({
          id: `${o.id}-return`,
          type: 'مرتجع مبيعات',
          amount: returnedVal,
          method: primaryMethod,
          split: {
            cash: primaryMethod === 'cash' ? returnedVal : 0,
            visa: primaryMethod === 'visa' ? returnedVal : 0,
            wallet: primaryMethod === 'wallet' ? returnedVal : 0,
            instapay: primaryMethod === 'instapay' ? returnedVal : 0
          },
          note: `مرتجع من فاتورة #${o.id}`,
          isOut: true,
          time: new Date(o.date).toLocaleString('ar-SA'),
          rawDate: o.date
        });
      }
    });

    periodTransactions.expenses.forEach(e => {
      const isTransfer = e.category === 'تحويل داخلي' && e.amount === 0;
      const isIncome = e.amount < 0;
      let cash = Math.abs(e.paid_cash || 0);
      let visa = Math.abs(e.paid_visa || 0);
      let wallet = Math.abs(e.paid_wallet || 0);
      let instapay = Math.abs(e.paid_instapay || 0);
      if (!isTransfer && cash + visa + wallet + instapay === 0) {
        const amt = Math.abs(e.amount || 0);
        cash = e.payment_method === 'cash' ? amt : 0;
        visa = e.payment_method === 'visa' ? amt : 0;
        wallet = e.payment_method === 'wallet' ? amt : 0;
        instapay = e.payment_method === 'instapay' ? amt : 0;
      }

      if (isTransfer) {
        // For transfers, show the actual paid values (positive/negative)
        const transferAmt = Math.max(
          Math.abs(e.paid_cash || 0), Math.abs(e.paid_visa || 0),
          Math.abs(e.paid_wallet || 0), Math.abs(e.paid_instapay || 0)
        );
        list.push({
          id: e.id,
          type: 'تحويل داخلي',
          amount: transferAmt,
          method: e.payment_method,
          split: { cash: e.paid_cash || 0, visa: e.paid_visa || 0, wallet: e.paid_wallet || 0, instapay: e.paid_instapay || 0 },
          note: e.note,
          isOut: false,
          isTransfer: true,
          time: new Date(e.date).toLocaleString('ar-SA'),
          rawDate: e.date,
          original: e,
          originType: 'expense'
        });
      } else {
        list.push({
          id: e.id,
          type: isIncome ? `إيراد: ${e.category}` : `مصروف: ${e.category}`,
          amount: Math.abs(e.amount),
          method: e.payment_method,
          split: { cash, visa, wallet, instapay },
          note: e.note,
          isOut: !isIncome,
          time: new Date(e.date).toLocaleString('ar-SA'),
          rawDate: e.date,
          original: e,
          originType: 'expense'
        });
      }
    });

    periodTransactions.purchases.forEach(inv => {
      const supplier = useStore.getState().suppliers.find(s => s.id === inv.supplier_id);
      const isPayment = inv.total === 0;
      let cash = inv.paid_cash || 0;
      let visa = inv.paid_visa || 0;
      let wallet = inv.paid_wallet || 0;
      let instapay = inv.paid_instapay || 0;
      if (cash + visa + wallet + instapay === 0) {
        cash = inv.payment_method === 'cash' ? inv.paid_amount : 0;
        visa = inv.payment_method === 'visa' ? inv.paid_amount : 0;
        wallet = inv.payment_method === 'wallet' ? inv.paid_amount : 0;
        instapay = inv.payment_method === 'instapay' ? inv.paid_amount : 0;
      }

      list.push({
        id: inv.id,
        type: isPayment ? 'سداد للمورد' : 'شراء بضاعة',
        amount: inv.paid_amount,
        method: inv.payment_method,
        split: { cash, visa, wallet, instapay },
        note: `${supplier?.name || 'مورد'} - #${inv.invoice_number}`,
        isOut: true,
        time: new Date(inv.created_at).toLocaleString('ar-SA'),
        rawDate: inv.created_at,
        original: inv,
        originType: 'purchase'
      });
    });

    return list.sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
  }, [periodTransactions]);

  // --- Handlers ---

  const handleOpenModal = (expense: Expense | null = null) => {
    setEditingOrder(null);
    setEditingPurchase(null);

    if (expense) {
      setEditingExpense(expense);
      setFormData({ 
        transaction_type: expense.amount < 0 ? 'income' : 'expense',
        category: expense.category, 
        amount: Math.abs(expense.amount).toString(), 
        paid_cash: Math.abs(expense.paid_cash || 0).toString(),
        paid_visa: Math.abs(expense.paid_visa || 0).toString(),
        paid_wallet: Math.abs(expense.paid_wallet || 0).toString(),
        paid_instapay: Math.abs(expense.paid_instapay || 0).toString(),
        paid_method5: Math.abs((expense as any).paid_method5 || 0).toString(),
        paid_method6: Math.abs((expense as any).paid_method6 || 0).toString(),
        note: expense.note,
        transfer_from: 'instapay',
        transfer_to: 'cash',
        transfer_amount: ''
      });
    } else {
      setEditingExpense(null);
      setFormData({ 
        transaction_type: 'expense',
        category: 'عام', 
        amount: '', 
        paid_cash: '',
        paid_visa: '',
        paid_wallet: '',
        paid_instapay: '',
        paid_method5: '',
        paid_method6: '',
        note: '',
        transfer_from: 'instapay',
        transfer_to: 'cash',
        transfer_amount: ''
      });
    }
    setShowModal(true);
  };

  const handleOpenEditOrder = (order: Order) => {
    setEditingOrder(order);
    setEditingExpense(null);
    setEditingPurchase(null);
    setFormData({
      transaction_type: 'income',
      category: order.type === 'payment' ? 'تحصيل من عميل' : 'مبيعات',
      amount: getInitialPaidAmount(order).toString(),
      paid_cash: (order.paid_cash || 0).toString(),
      paid_visa: (order.paid_visa || 0).toString(),
      paid_wallet: (order.paid_wallet || 0).toString(),
      paid_instapay: (order.paid_instapay || 0).toString(),
      paid_method5: ((order as any).paid_method5 || 0).toString(),
      paid_method6: ((order as any).paid_method6 || 0).toString(),
      note: order.notes || '',
      transfer_from: 'instapay',
      transfer_to: 'cash',
      transfer_amount: ''
    });
    setShowModal(true);
  };

  const handleOpenEditPurchase = (purchase: PurchaseInvoice) => {
    setEditingPurchase(purchase);
    setEditingExpense(null);
    setEditingOrder(null);
    const isPayment = purchase.total === 0;
    setFormData({
      transaction_type: 'expense',
      category: isPayment ? 'سداد لمورد' : 'شراء بضاعة',
      amount: purchase.paid_amount.toString(),
      paid_cash: (purchase.paid_cash || 0).toString(),
      paid_visa: (purchase.paid_visa || 0).toString(),
      paid_wallet: (purchase.paid_wallet || 0).toString(),
      paid_instapay: (purchase.paid_instapay || 0).toString(),
      paid_method5: ((purchase as any).paid_method5 || 0).toString(),
      paid_method6: ((purchase as any).paid_method6 || 0).toString(),
      note: '',
      transfer_from: 'instapay',
      transfer_to: 'cash',
      transfer_amount: ''
    });
    setShowModal(true);
  };

  const getMethodLabel = (method: string) => payLabelOf(storeSettings as any, method);

  const handleSubmit = async () => {
    // Handle transfer type separately
    if (formData.transaction_type === 'transfer' && !editingExpense && !editingOrder && !editingPurchase) {
      const transferAmt = parseFloat(formData.transfer_amount) || 0;
      if (transferAmt <= 0) return alert('يرجى إدخال مبلغ التحويل');
      if (formData.transfer_from === formData.transfer_to) return alert('لا يمكن التحويل لنفس وسيلة الدفع');
      
      // Validate balance
      const sourceBalance = methodsBreakdown[formData.transfer_from as keyof typeof methodsBreakdown] || 0;
      if (transferAmt > sourceBalance) {
        return alert(`الرصيد المتاح في ${getMethodLabel(formData.transfer_from)} هو ${sourceBalance.toLocaleString()} فقط. لا يمكن تحويل ${transferAmt.toLocaleString()}`);
      }

      setLoading(true);
      try {
        const splits: Record<string, number> = {};
        activePaymentKeys(storeSettings as any).forEach((k) => { splits[k] = 0; });
        splits[formData.transfer_from] = -transferAmt;
        splits[formData.transfer_to] = transferAmt;

        await addExpense({
          category: 'تحويل داخلي',
          amount: 0,
          paid_cash: splits.cash || 0,
          paid_visa: splits.visa || 0,
          paid_wallet: splits.wallet || 0,
          paid_instapay: splits.instapay || 0,
          paid_method5: splits.method5 || 0,
          paid_method6: splits.method6 || 0,
          note: formData.note || `تحويل ${transferAmt} من ${getMethodLabel(formData.transfer_from)} إلى ${getMethodLabel(formData.transfer_to)}`,
          payment_method: 'cash'
        } as any);

        // Send telegram notification
        fetch('/api/telegram-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'transfer',
            actor: 'المدير',
            date: new Date().toISOString(),
            description: `تحويل ${transferAmt} من ${getMethodLabel(formData.transfer_from)} إلى ${getMethodLabel(formData.transfer_to)}`,
            amount: transferAmt,
            noteText: formData.note || ''
          })
        }).catch(() => {});

        setShowModal(false);
      } catch (e: any) {
        console.error(e);
        alert('حدث خطأ أثناء حفظ التحويل');
      } finally {
        setLoading(false);
      }
      return;
    }

    const split: Record<string, number> = {};
    activePaymentKeys(storeSettings as any).forEach((k) => { split[k] = parseFloat((formData as any)['paid_' + k]) || 0; });
    const cash = split.cash || 0;
    const visa = split.visa || 0;
    const wallet = split.wallet || 0;
    const insta = split.instapay || 0;
    const m5 = split.method5 || 0;
    const m6 = split.method6 || 0;
    const amountNum = cash + visa + wallet + insta + m5 + m6;
    const primaryM = primaryMethod_(split);
    if (amountNum <= 0) return alert('يرجى إدخال مبالغ الدفع أولاً');

    const isAddingNew = !editingExpense && !editingOrder && !editingPurchase;

    if (isAddingNew) {
      setLoading(true);
    }

    try {
      if (editingExpense) {
        const multiplier = formData.transaction_type === 'income' ? -1 : 1;
        const expenseData = {
          category: formData.category,
          amount: amountNum * multiplier,
          paid_cash: cash * multiplier,
          paid_visa: visa * multiplier,
          paid_wallet: wallet * multiplier,
          paid_instapay: insta * multiplier,
          paid_method5: m5 * multiplier,
          paid_method6: m6 * multiplier,
          note: formData.note,
          payment_method: primaryM
        };
        await updateExpense(editingExpense.id, expenseData as any);
      } else if (editingOrder) {
        const updatedData = {
          paid_cash: cash,
          paid_visa: visa,
          paid_wallet: wallet,
          paid_instapay: insta,
          paid_method5: m5,
          paid_method6: m6,
          paid_amount: amountNum,
          payment_method: primaryM as any
        };
        await editOrder(editingOrder.id, updatedData, editingOrder.items || [], formData.note || 'تعديل من شاشة الميزانية');
      } else if (editingPurchase) {
        const updatedInvoice = {
          invoice_number: editingPurchase.invoice_number,
          supplier_id: editingPurchase.supplier_id,
          total: editingPurchase.total,
          paid_amount: amountNum,
          payment_method: primaryM as any
        };
        await updatePurchaseInvoice(
          editingPurchase.id,
          updatedInvoice,
          editingPurchase.items || [],
          split as any
        );
      } else {
        const multiplier = formData.transaction_type === 'income' ? -1 : 1;
        const expenseData = {
          category: formData.category,
          amount: amountNum * multiplier,
          paid_cash: cash * multiplier,
          paid_visa: visa * multiplier,
          paid_wallet: wallet * multiplier,
          paid_instapay: insta * multiplier,
          paid_method5: m5 * multiplier,
          paid_method6: m6 * multiplier,
          note: formData.note,
          payment_method: primaryM
        };
        await addExpense(expenseData as any);
      }
      setShowModal(false);
    } catch (e: any) {
      console.error(e);
      alert('حدث خطأ أثناء حفظ التعديلات');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrder = async (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذه المعاملة؟')) {
      const reason = prompt('الرجاء إدخال سبب الحذف:') || 'حذف يدوي من شاشة الميزانية';
      try {
        setLoading(true);
        const success = await deleteOrder(id, reason);
        if (success) {
          alert('تم حذف المعاملة بنجاح');
        } else {
          alert('حدث خطأ أثناء حذف المعاملة');
        }
      } catch (err: any) {
        console.error(err);
        alert('حدث خطأ أثناء حذف المعاملة');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDeletePurchase = async (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذه الفاتورة؟')) {
      prompt('الرجاء إدخال سبب الحذف:');
      try {
        setLoading(true);
        await deletePurchaseInvoice(id);
        alert('تم حذف الفاتورة بنجاح');
      } catch (err: any) {
        console.error(err);
        alert('حدث خطأ أثناء حذف الفاتورة');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (confirm('هل أنت متأكد من حذف هذه المعاملة؟')) {
      prompt('الرجاء إدخال سبب الحذف:');
      try {
        setLoading(true);
        await deleteExpense(id);
        alert('تم حذف المعاملة بنجاح');
      } catch (err: any) {
        console.error(err);
        alert('حدث خطأ أثناء حذف المعاملة');
      } finally {
        setLoading(false);
      }
    }
  };

  const exportToExcel = () => {
    const wsData = [
      ['تقرير الميزانية اليومية', '', '', ''],
      ['التاريخ المختار', selectedDate, '', ''],
      [''],
      ['رصيد أول اليوم', openingBalance],
      ['إجمالي الداخل (اليوم)', dailyIncome],
      ['إجمالي الخارج (اليوم)', dailyExpensesTotal + dailyPurchasesTotal + dailyReturnsValue],
      ['إجمالي الربح من الفواتير', invoiceProfitTotal],
      ['صافي اليوم', dailyNet],
      ['رصيد الإغلاق', closingBalance],
      [''],
      ['تفاصيل طرق الدفع (اليوم)'],
      ['كاش', methodsBreakdown.cash],
      ['فيزا', methodsBreakdown.visa],
      ['محفظة', methodsBreakdown.wallet],
      ['انستاباي', methodsBreakdown.instapay],
      [''],
      ['سجل المعاملات اليومي'],
      ['الوقت', 'النوع', 'المبلغ', 'الطريقة', 'التفاصيل'],
      ...allDailyTransactions.map(t => [t.time, t.type, t.amount, t.method, t.note])
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Finance');
    XLSX.writeFile(wb, `daily_report_${selectedDate}.xlsx`);
  };

  const printTransaction = (t: any) => {
    if (!t.original) return;
    const inv = t.original;
    const isOrder = t.originType === 'order';
    
    // Professional HTML template for printing from Finance
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(`https://cashier-branch3.vercel.app/view-invoice/${inv.id}`)}`;

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title>Print Invoice</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;font-family:'Cairo', sans-serif;}
  body{background:#fff;color:#1e293b;padding:10mm;}
  .invoice-card{width:128mm;margin:0 auto;position:relative;min-height:190mm;display:flex;flex-direction:column;}
  .header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1e293b;padding-bottom:10px;margin-bottom:15px;}
  .store-info{font-size:12px;color:#64748b;}
  .store-name{font-size:22px;font-weight:900;color:#1e293b;}
  .badge{background:#1e293b;color:#fff;padding:5px 15px;border-radius:6px;font-weight:900;font-size:14px;white-space:nowrap;}
  
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:15px;background:#f8fafc;padding:10px;border-radius:10px;border:1px solid #e2e8f0;}
  .info-item{font-size:11px;}
  .info-item strong{color:#64748b;}
  
  table{width:100%;border-collapse:collapse;margin-bottom:15px;}
  th{background:#f1f5f9;padding:8px;font-size:11px;text-align:center;border-bottom:2px solid #cbd5e1;}
  td{padding:8px;font-size:11px;border-bottom:1px solid #f1f5f9;text-align:center;}
  
  .summary{margin-right:auto;width:100%;max-width:250px;margin-top:auto;}
  .sum-row{display:flex;justify-content:space-between;padding:5px 0;font-size:12px;border-bottom:1px solid #f1f5f9;}
  .sum-total{font-weight:900;font-size:18px;border-top:2px solid #1e293b;padding-top:5px;margin-top:5px;border-bottom:none;}
  
  .footer-area{margin-top:20px;border-top:1px dashed #cbd5e1;padding-top:10px;display:flex;justify-content:space-between;align-items:flex-end;}
  .qr-box{text-align:center;}
  .qr-box img{width:80px;height:80px;border:1px solid #eee;padding:5px;border-radius:8px;background:white;}
  
  @media print{ @page{size:A5;margin:0;} body{padding:5mm;} .invoice-card{border:none;width:100%;} }
</style>
</head>
<body>
<div class="invoice-card">
  <div class="header">
    <div>
      <div class="store-name">${storeSettings.name}</div>
      <div class="store-info">${storeSettings.address} | ${storeSettings.phone}</div>
    </div>
    <div class="badge">${isOrder ? 'فاتورة مبيعات' : (inv.total === 0 ? 'إيصال سداد مورد' : 'فاتورة مشتريات')}</div>
  </div>

  <div class="info-grid">
    <div class="info-item"><strong>${isOrder ? 'العميل:' : 'المورد:'}</strong> <span>${isOrder ? (inv.customer?.name || 'عميل نقدي') : (useStore.getState().suppliers.find(s => s.id === inv.supplier_id)?.name || 'مورد')}</span></div>
    <div class="info-item"><strong>التاريخ:</strong> <span>${new Date(isOrder ? inv.date : inv.created_at).toLocaleString('ar-SA')}</span></div>
    <div class="info-item"><strong>رقم المستند:</strong> <span>#${isOrder ? inv.id : inv.invoice_number}</span></div>
    <div class="info-item"><strong>المسؤول:</strong> <span>${isOrder ? (inv.cashier_name || '—') : 'المدير'}</span></div>
  </div>

  <table style="flex-grow: 1;">
    <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
    <tbody>
      ${(inv.items || inv.purchase_items || []).map((item: any) => `
        <tr>
          <td style="text-align:right">${item.product_name || item.products?.name || useStore.getState().products.find(p => p.id === item.product_id)?.name || 'منتج'}</td>
          <td>${item.quantity}</td>
          <td>${(isOrder ? item.sale_price : item.purchase_price).toFixed(2)}</td>
          <td>${((isOrder ? item.sale_price : item.purchase_price) * item.quantity).toFixed(2)}</td>
        </tr>
      `).join('')}
      ${inv.total === 0 ? '<tr><td colspan="4" style="padding:40px; color:#059669; font-weight:black; font-size:16px;">إيصال سداد للمورد</td></tr>' : ''}
    </tbody>
  </table>

  <div class="summary">
    <div class="sum-row sum-total"><span>الإجمالي:</span><span>${inv.total.toFixed(2)} ${storeSettings.currency}</span></div>
    <div class="sum-row" style="color:#059669; font-weight:bold;"><span>المدفوع:</span><span>${inv.paid_amount.toFixed(2)} ${storeSettings.currency}</span></div>
    
    <!-- Payment Methods Breakdown -->
    <div style="margin-top:5px; padding:5px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0;">
      ${inv.paid_cash > 0 ? `<div class="sum-row" style="font-size:10px; border:none; padding:1px 0;"><span>💵 كاش:</span><span>${inv.paid_cash.toFixed(2)}</span></div>` : ''}
      ${inv.paid_visa > 0 ? `<div class="sum-row" style="font-size:10px; border:none; padding:1px 0;"><span>💳 فيزا:</span><span>${inv.paid_visa.toFixed(2)}</span></div>` : ''}
      ${inv.paid_wallet > 0 ? `<div class="sum-row" style="font-size:10px; border:none; padding:1px 0;"><span>📱 محفظة:</span><span>${inv.paid_wallet.toFixed(2)}</span></div>` : ''}
      ${inv.paid_instapay > 0 ? `<div class="sum-row" style="font-size:10px; border:none; padding:1px 0;"><span>⚡ انستا:</span><span>${inv.paid_instapay.toFixed(2)}</span></div>` : ''}
    </div>

    ${inv.total - inv.paid_amount > 0 ? `<div class="sum-row" style="color:#ef4444; font-weight:bold; margin-top:5px;"><span>المتبقي:</span><span>${(inv.total - inv.paid_amount).toFixed(2)} ${storeSettings.currency}</span></div>` : ''}
  </div>

  <div class="footer-area">
    <div style="font-size:10px; color:#94a3b8;">${storeSettings.name} - إدارة المالية</div>
    <div class="qr-box">
      <img src="${qrCodeUrl}" />
      <div style="font-size:9px; font-weight:bold; color:#1e293b; margin-top:4px;">تفاصيل الفاتورة</div>
    </div>
  </div>
</div>
<script>window.onload=()=>{setTimeout(()=>{window.print();},500);}<\/script>
</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 2000);
    }
  };

  const exportToPDF = async () => {
    const element = document.getElementById('finance-report');
    if (!element) return;
    
    setLoading(true);
    
    // Hide buttons during capture
    const buttons = element.querySelectorAll('.export-hide');
    buttons.forEach((b: any) => b.style.display = 'none');
    
    try {
      const canvas = await html2canvas(element, { 
        scale: 2,
        useCORS: true,
        backgroundColor: '#f8fafc',
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        onclone: (clonedDoc) => {
          const el = clonedDoc.getElementById('finance-report');
          if (el) {
            el.style.height = 'auto';
            el.style.overflow = 'visible';
          }
        }
      });

      const imgData = canvas.toDataURL('image/png');
      const pdfWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      let heightLeft = imgHeight;
      let position = 0;

      // Add the first page
      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pageHeight;

      // Add subsequent pages if needed
      while (heightLeft > 0) {
        position -= pageHeight; // Shift up by one page height
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      
      pdf.save(`finance_report_${selectedDate}.pdf`);
    } catch (e) {
      console.error("PDF Export Error:", e);
      alert("حدث خطأ أثناء تصدير التقرير. يرجى المحاولة مرة أخرى.");
    } finally {
      buttons.forEach((b: any) => b.style.display = '');
      setLoading(false);
    }
  };

  const tc = storeSettings.themeColor;

  return (
    <div id="finance-report" className="p-4 md:p-8 max-w-7xl mx-auto h-[calc(100vh-2rem)] overflow-y-auto relative" dir="rtl">
      {/* Loading Overlay for Export */}
      {loading && (
        <div className="fixed inset-0 z-[100] bg-white/60 backdrop-blur-md flex flex-col items-center justify-center gap-4 animate-in fade-in duration-300">
          <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-indigo-900 font-black text-xl animate-pulse">جاري تجهيز التقرير بالكامل...</p>
          <p className="text-slate-500 font-medium">يرجى الانتظار ثواني قليلة</p>
        </div>
      )}

      {/* Header & Date Picker */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
        <div>
          <h1 className="text-3xl font-black text-slate-800 flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-200">
              <Wallet size={28} />
            </div>
            الميزانية اليومية
          </h1>
          <p className="text-slate-500 mt-2 font-medium">مراقبة حركة الخزينة وتدفق الأموال</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 export-hide">
          <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
            {[
              { id: 'daily', label: 'يومي' },
              { id: 'monthly', label: 'شهري' },
              { id: 'yearly', label: 'سنوي' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setFilterType(t.id as any)}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filterType === t.id 
                    ? 'bg-white text-indigo-600 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="relative flex items-center gap-3 bg-white px-4 py-2.5 rounded-2xl border border-slate-200 shadow-inner min-w-[190px]">
            <Calendar size={20} className="text-indigo-600" />
            <span className="flex-1 text-center font-black text-slate-700 tabular-nums" dir="ltr">
              {selectedDateDisplay}
            </span>
            <input 
              type={filterType === 'monthly' ? 'month' : (filterType === 'yearly' ? 'number' : 'date')} 
              value={filterType === 'yearly' ? selectedDate.split('-')[0] : (filterType === 'monthly' ? selectedDate.slice(0,7) : selectedDate)}
              onChange={(e) => {
                const val = e.target.value;
                if (filterType === 'yearly') {
                  setSelectedDate(`${val}-01-01`);
                } else if (filterType === 'monthly') {
                  setSelectedDate(`${val}-01`);
                } else {
                  setSelectedDate(val);
                }
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              placeholder={filterType === 'yearly' ? 'سنة' : ''}
              {...(filterType === 'yearly' ? { min: 2020, max: 2050 } : {})}
            />
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={exportToExcel}
              className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl hover:bg-emerald-100 transition shadow-sm border border-emerald-100"
              title="تصدير Excel"
            >
              <Download size={22} />
            </button>
            <button 
              onClick={exportToPDF}
              className="p-3 bg-red-50 text-red-600 rounded-2xl hover:bg-red-100 transition shadow-sm border border-red-100"
              title="تصدير PDF"
            >
              <FileText size={22} />
            </button>
            <button 
              onClick={() => handleOpenModal()}
              style={{ backgroundColor: tc }}
              className="flex items-center gap-2 text-white px-6 py-3 rounded-2xl font-bold hover:opacity-90 transition shadow-lg"
            >
              <Plus size={20} /> معاملة مالية
            </button>
          </div>
        </div>
      </div>

      {/* New Breakdown Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-[32px] border border-emerald-100 shadow-sm">
          <p className="text-emerald-600 font-bold text-xs mb-1">المحصل من الفواتير</p>
          <h3 className="text-2xl font-black text-emerald-700">
            {collectedFromInvoices.toLocaleString()} <span className="text-sm font-normal opacity-50">{storeSettings.currency}</span>
          </h3>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-indigo-100 shadow-sm">
          <p className="text-indigo-600 font-bold text-xs mb-1">إيرادات أخرى ومسدد آجل</p>
          <h3 className="text-2xl font-black text-indigo-700">
            {collectedFromOther.toLocaleString()} <span className="text-sm font-normal opacity-50">{storeSettings.currency}</span>
          </h3>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-amber-100 shadow-sm">
          <p className="text-amber-600 font-bold text-xs mb-1">إجمالي الآجل على العملاء</p>
          <h3 className="text-2xl font-black text-amber-700">
            {totalCustomerDebt.toLocaleString()} <span className="text-sm font-normal opacity-50">{storeSettings.currency}</span>
          </h3>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-red-100 shadow-sm">
          <p className="text-red-600 font-bold text-xs mb-1">إجمالي المديونية للموردين</p>
          <h3 className="text-2xl font-black text-red-700">
            {totalSupplierDebt.toLocaleString()} <span className="text-sm font-normal opacity-50">{storeSettings.currency}</span>
          </h3>
        </div>
      </div>

      {/* Financial Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 mb-8">
        {/* Opening Balance */}
        <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
          <p className="text-slate-400 font-bold text-xs mb-1">رصيد الافتتاح</p>
          <h3 className="text-2xl font-black text-slate-700">
            {openingBalance.toLocaleString()} <span className="text-sm font-normal opacity-50">{storeSettings.currency}</span>
          </h3>
          <div className="mt-2 text-[10px] text-slate-400 font-bold flex items-center gap-1">
             بناءً على المعاملات السابقة
          </div>
        </div>

        {/* Daily In */}
        <div className="bg-white p-6 rounded-[32px] border border-emerald-100 shadow-sm bg-emerald-50/20">
          <p className="text-emerald-600 font-bold text-xs mb-1">إجمالي الداخل {filterType === 'daily' ? 'اليوم' : filterType === 'monthly' ? 'للشهر' : 'للعام'}</p>
          <h3 className="text-2xl font-black text-emerald-700">
            +{dailyIncome.toLocaleString()} <span className="text-sm font-normal opacity-50">{storeSettings.currency}</span>
          </h3>
          <div className="mt-2 text-[10px] text-emerald-500 font-bold flex items-center gap-1">
             {filterType === 'daily' ? 'مبيعات وتحصيل من العملاء اليوم' : (filterType === 'monthly' ? 'مبيعات وتحصيل من العملاء الشهر' : 'مبيعات وتحصيل من العملاء السنة')}
          </div>
        </div>

        {/* Invoice Profit */}
        <div className="bg-white p-6 rounded-[32px] border border-emerald-100 shadow-sm bg-emerald-50/20">
          <p className="text-emerald-600 font-bold text-xs mb-1">إجمالي الربح من الفواتير</p>
          <h3 className="text-2xl font-black text-emerald-700">
            {invoiceProfitTotal.toLocaleString()} <span className="text-sm font-normal opacity-50">{storeSettings.currency}</span>
          </h3>
          <div className="mt-2 text-[10px] text-emerald-500 font-bold flex items-center gap-1">
            <FileText size={12} /> {filterType === 'daily' ? 'ربح فواتير اليوم فقط' : (filterType === 'monthly' ? 'ربح فواتير الشهر فقط' : 'ربح فواتير السنة فقط')}
          </div>
        </div>

        {/* Daily Out */}
        <div className="bg-white p-6 rounded-[32px] border border-red-100 shadow-sm bg-red-50/20">
          <p className="text-red-600 font-bold text-xs mb-1">إجمالي الخارج {filterType === 'daily' ? 'اليوم' : filterType === 'monthly' ? 'للشهر' : 'للعام'}</p>
          <h3 className="text-2xl font-black text-red-700">
            -{ (dailyExpensesTotal + dailyPurchasesTotal + dailyReturnsValue).toLocaleString() } <span className="text-sm font-normal opacity-50">{storeSettings.currency}</span>
          </h3>
          <div className="mt-2 text-[10px] text-red-500 font-bold flex items-center gap-1">
             {filterType === 'daily' ? 'مصاريف، مشتريات، ومرتجعات اليوم' : (filterType === 'monthly' ? 'مصاريف، مشتريات، ومرتجعات الشهر' : 'مصاريف، مشتريات، ومرتجعات السنة')}
          </div>
        </div>

        {/* Closing Balance */}
        <div className="bg-slate-900 p-6 rounded-[32px] shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -mr-12 -mt-12 blur-2xl" />
          <p className="text-slate-400 font-bold text-xs mb-1 relative z-10">رصيد الإغلاق (الحالي)</p>
          <h3 className="text-2xl font-black text-white relative z-10">
            {closingBalance.toLocaleString()} <span className="text-sm font-normal text-slate-500">{storeSettings.currency}</span>
          </h3>
          <div className="mt-2 text-[10px] text-indigo-400 font-bold flex items-center gap-1 relative z-10">
            <TrendingUp size={12} /> رصيد الخزينة النهائي
          </div>
        </div>
      </div>

      {/* Payment Methods Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {activePaymentKeys(storeSettings as any).map((mk) => {
          const iconMap: Record<string, any> = { cash: <Landmark size={18} />, visa: <CreditCard size={18} />, wallet: <Smartphone size={18} />, instapay: <Zap size={18} /> };
          const m = { id: mk, label: payLabelOf(storeSettings as any, mk), icon: iconMap[mk] || <Wallet size={18} />, color: 'slate', value: methodsBreakdown[mk] || 0 };
          return (
          <div key={m.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl bg-${m.color}-50 text-${m.color}-600 flex items-center justify-center`}>
              {m.icon}
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400">{m.label}</p>
              <p 
                className={`text-sm font-black ${m.value < 0 ? 'text-red-600 font-bold' : 'text-slate-700'}`}
                dir={m.value < 0 ? 'ltr' : undefined}
              >
                {m.value < 0 ? `-${Math.abs(m.value).toLocaleString()}` : m.value.toLocaleString()}
              </p>
            </div>
          </div>
          );
        })}
      </div>

      {/* Daily Transactions Table */}
      <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden mb-8">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between">
          <h3 className="font-black text-slate-800 flex items-center gap-2">
            <ArrowRightLeft size={20} className="text-indigo-600" />
            سجل معاملات {filterType === 'daily' ? 'اليوم' : (filterType === 'monthly' ? 'الشهر' : 'السنة')}
          </h3>
          <span className="text-xs font-bold bg-slate-100 text-slate-500 px-3 py-1 rounded-full">
            {allDailyTransactions.length} عملية
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead>
              <tr className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                <th className="p-6">الوقت</th>
                <th className="p-6">النوع</th>
                <th className="p-6">التفاصيل</th>
                <th className="p-6">طريقة الدفع</th>
                <th className="p-6">المبلغ</th>
                <th className="p-6 text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {allDailyTransactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-20 text-center">
                    <div className="flex flex-col items-center opacity-20">
                      <Search size={64} />
                      <p className="text-xl font-bold mt-4">لا توجد معاملات في هذا اليوم</p>
                    </div>
                  </td>
                </tr>
              ) : (
                allDailyTransactions.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="p-6 text-slate-400 text-xs font-bold">{t.time}</td>
                    <td className="p-6">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold text-[10px] ${
                        t.isTransfer ? 'bg-blue-50 text-blue-600 border border-blue-100' : t.isOut ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                      }`}>
                        {t.isTransfer ? <ArrowRightLeft size={10} /> : t.isOut ? <ArrowDown size={10} /> : <ArrowUp size={10} />}
                        {t.type}
                      </span>
                    </td>
                    <td className="p-6 font-medium text-slate-600 text-sm">{t.note}</td>
                    <td className="p-6">
                      <div className="flex flex-col gap-1">
                        {t.isTransfer ? (
                          <>
                            {Object.entries(t.split || {}).map(([key, val]: [string, any]) => {
                              if (val === 0) return null;
                              const icons: Record<string, any> = { cash: <Landmark size={12} />, visa: <CreditCard size={12} />, wallet: <Smartphone size={12} />, instapay: <Zap size={12} /> };
                              return (
                                <span key={key} className={`text-[10px] font-black flex items-center gap-1 ${val < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                  {icons[key] || <Wallet size={12} />} {payLabelOf(storeSettings as any, key)}: {val > 0 ? '+' : ''}{val.toLocaleString()}
                                </span>
                              );
                            })}
                          </>
                        ) : (
                          <>
                            {t.split?.cash > 0 && (
                              <span className="text-[10px] font-black text-emerald-600 flex items-center gap-1">
                                <Landmark size={12} /> {t.split.cash.toLocaleString()}
                              </span>
                            )}
                            {t.split?.visa > 0 && (
                              <span className="text-[10px] font-black text-blue-600 flex items-center gap-1">
                                <CreditCard size={12} /> {t.split.visa.toLocaleString()}
                              </span>
                            )}
                            {t.split?.wallet > 0 && (
                              <span className="text-[10px] font-black text-purple-600 flex items-center gap-1">
                                <Smartphone size={12} /> {t.split.wallet.toLocaleString()}
                              </span>
                            )}
                            {t.split?.instapay > 0 && (
                              <span className="text-[10px] font-black text-amber-600 flex items-center gap-1">
                                <Zap size={12} /> {t.split.instapay.toLocaleString()}
                              </span>
                            )}
                            {!t.split || (t.split.cash <= 0 && t.split.visa <= 0 && t.split.wallet <= 0 && t.split.instapay <= 0) ? (
                              <span className="text-xs font-black text-slate-400">
                                 {t.method === 'cash' && '💵 كاش'}
                                 {t.method === 'visa' && '💳 فيزا'}
                                 {t.method === 'wallet' && '📱 محفظة'}
                                 {t.method === 'instapay' && '⚡ انستا'}
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    </td>
                    <td className={`p-6 font-black text-lg ${t.isTransfer ? 'text-blue-600' : t.isOut ? 'text-red-600' : 'text-emerald-600'}`}>
                      {t.isTransfer ? '↔' : t.isOut ? '-' : '+'}{t.amount.toLocaleString()}
                    </td>
                    <td className="p-6 text-left">
                       <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {t.original && <button onClick={() => printTransaction(t)} className="p-2 text-slate-400 hover:text-emerald-600 transition" title="طباعة"><Printer size={16} /></button>}
                          
                          {/* Edit Buttons */}
                          {t.original && t.originType === 'expense' && (
                             <button onClick={() => handleOpenModal(t.original)} className="p-2 text-slate-400 hover:text-indigo-600 transition" title="تعديل"><Edit3 size={16} /></button>
                          )}
                          {t.original && t.originType === 'order' && (
                             <button onClick={() => handleOpenEditOrder(t.original)} className="p-2 text-slate-400 hover:text-indigo-600 transition" title="تعديل"><Edit3 size={16} /></button>
                          )}
                          {t.original && t.originType === 'purchase' && (
                             <button onClick={() => handleOpenEditPurchase(t.original)} className="p-2 text-slate-400 hover:text-indigo-600 transition" title="تعديل"><Edit3 size={16} /></button>
                          )}

                          {/* Delete Buttons */}
                          {t.original && t.originType === 'expense' && (
                             <button onClick={() => handleDeleteExpense(t.id)} className="p-2 text-slate-400 hover:text-red-500 transition" title="حذف"><Trash2 size={16} /></button>
                          )}
                          {t.original && t.originType === 'order' && (
                             <button onClick={() => handleDeleteOrder(t.id)} className="p-2 text-slate-400 hover:text-red-500 transition" title="حذف"><Trash2 size={16} /></button>
                          )}
                          {t.original && t.originType === 'purchase' && (
                            <button onClick={() => handleDeletePurchase(t.id)} className="p-2 text-slate-400 hover:text-red-500 transition" title="حذف">
                              <Trash2 size={16} />
                            </button>
                          )}
                       </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div 
              className="p-8 text-white flex justify-between items-center shrink-0"
              style={{ backgroundColor: tc }}
            >
              <div>
                <h2 className="text-2xl font-black">
                  {editingExpense && 'تعديل المعاملة المالية'}
                  {editingOrder && 'تعديل معاملة العميل'}
                  {editingPurchase && 'تعديل معاملة المورد'}
                  {!editingExpense && !editingOrder && !editingPurchase && 'تسجيل معاملة مالية'}
                </h2>
                <p className="text-white/70 text-sm mt-1">
                  {editingOrder || editingPurchase ? 'تعديل تفاصيل الدفع وطرق السداد لهذه المعاملة' : 'سجل تفاصيل المصاريف أو الإيرادات الخارجية'}
                </p>
              </div>
              <button onClick={() => setShowModal(false)} className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition text-white">
                <X size={24} />
              </button>
            </div>
            <div className="p-8 space-y-6 overflow-y-auto">
              {editingOrder && (
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">نوع المعاملة</label>
                  <div className="w-full bg-slate-100 border border-slate-200 rounded-2xl p-4 font-bold text-slate-600">
                    معاملة عميل ({editingOrder.type === 'payment' ? 'سداد مديونية' : 'فاتورة مبيعات'})
                  </div>
                </div>
              )}
              {editingPurchase && (
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">نوع المعاملة</label>
                  <div className="w-full bg-slate-100 border border-slate-200 rounded-2xl p-4 font-bold text-slate-600">
                    معاملة مورد ({editingPurchase.total === 0 ? 'سداد مديونية مورد' : 'فاتورة شراء'})
                  </div>
                </div>
              )}
              {!editingOrder && !editingPurchase && (
                <>
                  <div className="flex gap-2 mb-6 bg-slate-100 p-1 rounded-2xl">
                    <button
                      onClick={() => setFormData({...formData, transaction_type: 'expense'})}
                      className={`flex-1 py-3 rounded-xl font-black text-sm transition-all ${formData.transaction_type === 'expense' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      مصروف
                    </button>
                    <button
                      onClick={() => setFormData({...formData, transaction_type: 'income'})}
                      className={`flex-1 py-3 rounded-xl font-black text-sm transition-all ${formData.transaction_type === 'income' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      إيراد
                    </button>
                    <button
                      onClick={() => setFormData({...formData, transaction_type: 'transfer'})}
                      className={`flex-1 py-3 rounded-xl font-black text-sm transition-all ${formData.transaction_type === 'transfer' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      تحويل
                    </button>
                  </div>

                  {formData.transaction_type === 'transfer' ? (
                    <>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">من وسيلة الدفع</label>
                        <select 
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-blue-500/20 outline-none font-bold"
                          value={formData.transfer_from}
                          onChange={e => setFormData({...formData, transfer_from: e.target.value})}
                        >
                          {activePaymentKeys(storeSettings as any).map((k) => (
                            <option key={k} value={k}>{payLabelOf(storeSettings as any, k)} ({(methodsBreakdown[k] || 0).toLocaleString()})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">إلى وسيلة الدفع</label>
                        <select 
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-blue-500/20 outline-none font-bold"
                          value={formData.transfer_to}
                          onChange={e => setFormData({...formData, transfer_to: e.target.value})}
                        >
                          {activePaymentKeys(storeSettings as any).map((k) => (
                            <option key={k} value={k}>{payLabelOf(storeSettings as any, k)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">مبلغ التحويل</label>
                        <input 
                          type="number" dir="ltr" placeholder="0.00"
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-blue-500/20 outline-none font-bold text-right"
                          value={formData.transfer_amount}
                          onChange={e => setFormData({...formData, transfer_amount: e.target.value})}
                        />
                      </div>
                      {formData.transfer_from === formData.transfer_to && (
                        <div className="bg-red-50 text-red-600 text-xs font-bold p-3 rounded-xl border border-red-100">
                          ⚠️ لا يمكن التحويل لنفس وسيلة الدفع
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">{formData.transaction_type === 'expense' ? 'فئة المصروف' : 'فئة الإيراد'}</label>
                        <select 
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500/20 outline-none font-bold"
                          value={formData.category}
                          onChange={e => setFormData({...formData, category: e.target.value})}
                        >
                          {formData.transaction_type === 'expense' ? (
                            <>
                              <option value="عام">عام</option>
                              <option value="إيجار">إيجار</option>
                              <option value="كهرباء/مياه">كهرباء / مياه</option>
                              <option value="رواتب">رواتب</option>
                              <option value="نقل/توصيل">نقل / توصيل</option>
                              <option value="صيانة">صيانة</option>
                            </>
                          ) : (
                            <>
                              <option value="عام">إيراد عام</option>
                              <option value="خدمات">خدمات إضافية</option>
                              <option value="استثمار">عائد استثمار</option>
                              <option value="أخرى">أخرى</option>
                            </>
                          )}
                        </select>
                      </div>
                    </>
                  )}


                </>
              )}

              {formData.transaction_type !== 'transfer' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {activePaymentKeys(storeSettings as any).map((k) => (
                  <div key={k}>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wide text-right">{payLabelOf(storeSettings as any, k)}</label>
                    <input
                      type="number" dir="ltr" placeholder="0.00"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 focus:ring-1 focus:outline-none font-bold text-right"
                      value={(formData as any)['paid_' + k] || ''}
                      onChange={e => setFormData({ ...formData, ['paid_' + k]: e.target.value } as any)}
                    />
                  </div>
                ))}
              </div>}

              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex justify-between items-center">
                <span className="text-sm font-bold text-slate-500">{formData.transaction_type === 'transfer' ? 'مبلغ التحويل:' : 'إجمالي المبلغ:'}</span>
                <span className={`text-2xl font-black ${
                  formData.transaction_type === 'transfer' ? 'text-blue-600' : (editingOrder || (formData.transaction_type === 'income' && !editingPurchase)) ? 'text-emerald-600' : 'text-red-600'
                }`}>
                  {formData.transaction_type === 'transfer'
                    ? (parseFloat(formData.transfer_amount) || 0).toLocaleString()
                    : activePaymentKeys(storeSettings as any).reduce((s, k) => s + (parseFloat((formData as any)['paid_' + k]) || 0), 0).toLocaleString()
                  } {storeSettings.currency}
                </span>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wide">ملاحظات</label>
                <textarea 
                  placeholder="اكتب ملاحظاتك هنا..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 h-24 focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium resize-none"
                  value={formData.note}
                  onChange={e => setFormData({...formData, note: e.target.value})}
                />
              </div>
              <button 
                onClick={handleSubmit}
                disabled={loading}
                style={{ backgroundColor: tc }}
                className="w-full text-white py-5 rounded-2xl font-black text-lg shadow-xl hover:opacity-90 transition-all flex items-center justify-center gap-3 disabled:opacity-55"
              >
                {loading ? 'جاري الحفظ...' : ((editingExpense || editingOrder || editingPurchase) ? 'حفظ التعديلات' : formData.transaction_type === 'transfer' ? 'تنفيذ التحويل' : 'إضافة العملية')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
