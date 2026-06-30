import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Landmark,
  Phone,
  Plus,
  ReceiptText,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { useStore, type FinancingAccount, type FinancingPayment } from '../../store/useStore';

const today = new Date().toISOString().slice(0, 10);
type PayMethod = 'cash' | 'visa' | 'wallet' | 'instapay';
const inputClass = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-100';

function monthOffset(date: string, offset: number) {
  const next = new Date(`${date}T12:00:00`);
  next.setMonth(next.getMonth() + offset);
  return next.toISOString().slice(0, 10);
}

function money(value: number, currency: string) {
  return `${Number(value || 0).toFixed(2)} ${currency}`;
}

function isoToDisplay(value?: string | null) {
  if (!value) return '';
  const [year, month, day] = value.slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function displayToIso(value: string) {
  const clean = value.trim().replace(/-/g, '/');
  const parts = clean.split('/');
  if (parts.length !== 3) return null;
  const [dayRaw, monthRaw, yearRaw] = parts;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  if (!day || !month || !year || year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function dateLabel(date?: string | null) {
  return isoToDisplay(date) || '-';
}

function methodLabel(method: string) {
  const map: Record<string, string> = { cash: 'كاش', visa: 'فيزا', wallet: 'محفظة', instapay: 'انستاباي' };
  return map[method] || method;
}

export default function Financing() {
  const {
    financingAccounts,
    financingPayments,
    financingTransactions,
    storeSettings,
    addFinancingAccount,
    settleFinancingPayment,
  } = useStore();

  const [activeType, setActiveType] = useState<'loan' | 'association'>('loan');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<FinancingPayment | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [form, setForm] = useState({
    type: 'loan' as 'loan' | 'association',
    lender_name: '',
    lender_phone: '',
    lender_details: '',
    description: '',
    principal_amount: '0',
    collection_amount: '',
    collection_date: today,
    installment_count: '1',
    first_repayment_date: monthOffset(today, 1),
  });
  const [repaymentRows, setRepaymentRows] = useState<{ due_date: string; amount: number; note: string }[]>([]);

  useEffect(() => {
    const count = Math.max(1, Number(form.installment_count) || 1);
    const total = Math.max(0, Number(form.principal_amount) || 0);
    const amount = count > 0 ? total / count : total;
    setRepaymentRows(Array.from({ length: count }, (_, index) => ({
      due_date: monthOffset(form.first_repayment_date, index),
      amount,
      note: `دفعة ${index + 1} من ${count}`,
    })));
  }, [form.first_repayment_date, form.installment_count, form.principal_amount, form.collection_amount]);

  const getPayments = (accountId: string) => financingPayments.filter((payment) => payment.account_id === accountId);
  const getRemaining = (payment: FinancingPayment) => Number(payment.remaining_amount ?? payment.amount ?? 0) || 0;

  const accountSummary = (account: FinancingAccount) => {
    const payments = getPayments(account.id);
    const collection = payments.find((payment) => payment.payment_type === 'collection');
    const repayments = payments.filter((payment) => payment.payment_type === 'repayment');
    const paid = repayments.reduce((sum, payment) => sum + Number(payment.paid_amount || 0), 0);
    const remaining = repayments.reduce((sum, payment) => sum + getRemaining(payment), 0);
    const collectionRemaining = collection ? getRemaining(collection) : 0;
    const nextPayment = payments
      .filter((payment) => payment.status !== 'paid')
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0];
    return { payments, collection, repayments, paid, remaining, collectionRemaining, nextPayment };
  };

  const grouped = useMemo(() => {
    return {
      loan: financingAccounts.filter((account) => account.type === 'loan'),
      association: financingAccounts.filter((account) => account.type === 'association'),
    };
  }, [financingAccounts]);

  const stats = useMemo(() => {
    const collected = financingTransactions
      .filter((tx) => tx.transaction_type === 'collection')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const repaid = financingTransactions
      .filter((tx) => tx.transaction_type === 'repayment')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const remaining = financingPayments
      .filter((payment) => payment.payment_type === 'repayment')
      .reduce((sum, payment) => sum + getRemaining(payment), 0);
    return { collected, repaid, remaining };
  }, [financingPayments, financingTransactions]);

  const selectedAccount = selectedId ? financingAccounts.find((account) => account.id === selectedId) : null;
  const selectedSummary = selectedAccount ? accountSummary(selectedAccount) : null;
  const selectedTransactions = selectedAccount
    ? financingTransactions.filter((tx) => tx.account_id === selectedAccount.id)
    : [];

  const resetForm = () => {
    setForm({
      type: 'loan',
      lender_name: '',
      lender_phone: '',
      lender_details: '',
      description: '',
      principal_amount: '0',
      collection_amount: '',
      collection_date: today,
      installment_count: '1',
      first_repayment_date: monthOffset(today, 1),
    });
  };

  const openForm = (type: 'loan' | 'association') => {
    resetForm();
    setForm((current) => ({ ...current, type }));
    setShowForm(true);
  };

  const handleSubmit = async () => {
    const collectionAmount = Number(form.collection_amount) || 0;
    const principalAmount = Number(form.principal_amount) || 0;
    if (!form.lender_name.trim()) return alert('اكتبي اسم صاحب السلفة أو الجمعية');
    if (collectionAmount <= 0) return alert('اكتبي مبلغ التحصيل صحيح');
    if (principalAmount < 0) return alert('إجمالي السداد لا يمكن يكون أقل من صفر');

    await addFinancingAccount({
      type: form.type,
      lender_name: form.lender_name.trim(),
      lender_phone: form.lender_phone.trim(),
      lender_details: form.lender_details.trim(),
      description: form.description.trim(),
      principal_amount: principalAmount,
      collection_amount: collectionAmount,
      collection_date: form.collection_date,
      installment_count: Math.max(1, Number(form.installment_count) || 1),
    }, principalAmount > 0 ? repaymentRows : []);

    resetForm();
    setShowForm(false);
    setActiveType(form.type);
  };

  const openPayment = (payment: FinancingPayment) => {
    setPaymentTarget(payment);
    setPaymentAmount(getRemaining(payment).toFixed(2));
  };

  const confirmPayment = async () => {
    if (!paymentTarget) return;
    const amount = Number(paymentAmount) || 0;
    const remaining = getRemaining(paymentTarget);
    if (amount <= 0) return alert('اكتبي مبلغ صحيح');
    if (amount > remaining + 0.009) return alert('المبلغ أكبر من المتبقي على الدفعة');

    const action = paymentTarget.payment_type === 'collection' ? 'تحصيل' : 'سداد';
    if (!confirm(`تأكيد ${action} ${money(amount, storeSettings.currency)}؟`)) return;
    await settleFinancingPayment(paymentTarget.id, amount, paymentMethod);
    setPaymentTarget(null);
    setPaymentAmount('');
  };

  const renderAccountCard = (account: FinancingAccount) => {
    const summary = accountSummary(account);
    const Icon = account.type === 'association' ? Landmark : UserRound;
    const iconClass = account.type === 'association'
      ? 'p-3 rounded-2xl bg-violet-50 text-violet-600'
      : 'p-3 rounded-2xl bg-indigo-50 text-indigo-600';
    return (
      <button
        key={account.id}
        onClick={() => setSelectedId(account.id)}
        className="bg-white border border-slate-100 rounded-2xl p-5 text-right shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={iconClass}>
              <Icon size={22} />
            </div>
            <div>
              <p className="text-lg font-black text-slate-800">{account.lender_name}</p>
              <p className="text-xs font-bold text-slate-400 mt-1">{account.description || account.lender_details || 'بدون وصف'}</p>
            </div>
          </div>
          <span className={`px-2.5 py-1 rounded-lg text-[11px] font-black ${account.status === 'closed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {account.status === 'closed' ? 'مغلق' : 'مفتوح'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-5">
          <div className="bg-emerald-50 rounded-xl p-3">
            <p className="text-[10px] font-black text-emerald-600">التحصيل</p>
            <p className="font-black text-emerald-800 mt-1">{money(account.collection_amount, storeSettings.currency)}</p>
          </div>
          <div className="bg-red-50 rounded-xl p-3">
            <p className="text-[10px] font-black text-red-600">المتبقي</p>
            <p className="font-black text-red-800 mt-1">{money(summary.remaining, storeSettings.currency)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] font-black text-slate-500">الدفعات</p>
            <p className="font-black text-slate-800 mt-1">{summary.repayments.filter((p) => p.status === 'paid').length}/{summary.repayments.length}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs font-bold text-slate-400">
          <span className="flex items-center gap-1"><Clock3 size={13} /> القادم: {summary.nextPayment ? dateLabel(summary.nextPayment.due_date) : 'لا يوجد'}</span>
          <span className="flex items-center gap-1 text-indigo-600">فتح الملف <ArrowRight size={13} /></span>
        </div>
      </button>
    );
  };

  const statusCounts = useMemo(() => {
    const list = grouped[activeType];
    return {
      all: list.length,
      open: list.filter((account) => account.status !== 'closed').length,
      closed: list.filter((account) => account.status === 'closed').length,
    };
  }, [activeType, grouped]);

  const cards = grouped[activeType].filter((account) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') return account.status !== 'closed';
    return account.status === 'closed';
  });

  return (
    <div className="p-4 md:p-8 space-y-6" dir="rtl">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800">السلف والجمعيات</h1>
          <p className="text-slate-500 mt-2 font-medium">ملفات مستقلة لكل سلفة أو جمعية، مع تحصيل وسداد جزئي وسجل معاملات واضح.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openForm('loan')} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg">
            <Plus size={18} /> سلفة جديدة
          </button>
          <button onClick={() => openForm('association')} className="bg-violet-600 hover:bg-violet-700 text-white px-5 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg">
            <Plus size={18} /> جمعية جديدة
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl">
          <p className="text-xs font-black text-emerald-700">دخل للخزنة من التمويل</p>
          <h3 className="text-2xl font-black text-emerald-800 mt-2">{money(stats.collected, storeSettings.currency)}</h3>
        </div>
        <div className="bg-red-50 border border-red-100 p-5 rounded-2xl">
          <p className="text-xs font-black text-red-700">سداد خرج من الخزنة</p>
          <h3 className="text-2xl font-black text-red-800 mt-2">{money(stats.repaid, storeSettings.currency)}</h3>
        </div>
        <div className="bg-amber-50 border border-amber-100 p-5 rounded-2xl">
          <p className="text-xs font-black text-amber-700">إجمالي المتبقي للسداد</p>
          <h3 className="text-2xl font-black text-amber-800 mt-2">{money(stats.remaining, storeSettings.currency)}</h3>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="bg-white border border-slate-100 rounded-2xl p-2 flex gap-2 w-fit shadow-sm">
          <button
            onClick={() => setActiveType('loan')}
            className={`px-5 py-3 rounded-xl font-black transition ${activeType === 'loan' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            السلف ({grouped.loan.length})
          </button>
          <button
            onClick={() => setActiveType('association')}
            className={`px-5 py-3 rounded-xl font-black transition ${activeType === 'association' ? 'bg-violet-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            الجمعيات ({grouped.association.length})
          </button>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-2 flex gap-2 w-fit shadow-sm">
          {[
            { value: 'all', label: 'الكل', count: statusCounts.all },
            { value: 'open', label: 'المفتوح', count: statusCounts.open },
            { value: 'closed', label: 'المغلق', count: statusCounts.closed },
          ].map((item) => (
            <button
              key={item.value}
              onClick={() => setStatusFilter(item.value as 'all' | 'open' | 'closed')}
              className={`px-4 py-2.5 rounded-xl font-black text-sm transition ${statusFilter === item.value ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              {item.label} ({item.count})
            </button>
          ))}
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
          <p className="font-black text-slate-400">لا توجد {activeType === 'loan' ? 'سلف' : 'جمعيات'} بهذا الفلتر حالياً.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map(renderAccountCard)}
        </div>
      )}

      {selectedAccount && selectedSummary && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-y-auto">
            <div className="bg-white p-5 rounded-t-2xl border-b border-slate-100 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-indigo-50 text-indigo-600 p-2 rounded-xl">
                    {selectedAccount.type === 'association' ? <Landmark size={20} /> : <UserRound size={20} />}
                  </span>
                  <h2 className="text-2xl font-black text-slate-800">{selectedAccount.lender_name}</h2>
                </div>
                <div className="flex flex-wrap gap-3 mt-3 text-xs font-bold text-slate-500">
                  <span className="flex items-center gap-1"><Phone size={13} /> {selectedAccount.lender_phone || 'بدون رقم'}</span>
                  <span>{selectedAccount.description || selectedAccount.lender_details || 'بدون وصف'}</span>
                </div>
              </div>
              <button onClick={() => setSelectedId(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-red-500">
                <X size={22} />
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <p className="text-[11px] font-black text-emerald-600">مبلغ التحصيل</p>
                <p className="text-xl font-black text-emerald-800 mt-2">{money(selectedAccount.collection_amount, storeSettings.currency)}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <p className="text-[11px] font-black text-red-600">المتبقي للسداد</p>
                <p className="text-xl font-black text-red-800 mt-2">{money(selectedSummary.remaining, storeSettings.currency)}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <p className="text-[11px] font-black text-slate-500">مدفوع من السداد</p>
                <p className="text-xl font-black text-slate-800 mt-2">{money(selectedSummary.paid, storeSettings.currency)}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <p className="text-[11px] font-black text-slate-500">الحالة</p>
                <p className="text-xl font-black text-slate-800 mt-2">{selectedAccount.status === 'closed' ? 'مغلق' : 'مفتوح'}</p>
              </div>
            </div>

            <div className="p-5 grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-5">
              <div className="space-y-4">
                <div className="bg-white border border-slate-100 rounded-2xl p-4">
                  <h3 className="font-black text-slate-800 mb-4">التحصيل</h3>
                  {selectedSummary.collection && (
                    <PaymentRow payment={selectedSummary.collection} currency={storeSettings.currency} onPay={openPayment} />
                  )}
                </div>

                <div className="bg-white border border-slate-100 rounded-2xl p-4">
                  <h3 className="font-black text-slate-800 mb-4">دفعات السداد</h3>
                  <div className="space-y-2">
                    {selectedSummary.repayments.map((payment) => (
                      <PaymentRow key={payment.id} payment={payment} currency={storeSettings.currency} onPay={openPayment} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <h3 className="font-black text-slate-800 mb-4">معاملات الملف</h3>
                {selectedTransactions.length === 0 ? (
                  <p className="text-center text-slate-400 font-bold py-10">لا توجد معاملات مدفوعة بعد.</p>
                ) : (
                  <div className="space-y-3">
                    {selectedTransactions.map((tx) => (
                      <div key={tx.id} className="border border-slate-100 rounded-xl p-3 flex items-start justify-between gap-3">
                        <div>
                          <p className={`font-black ${tx.transaction_type === 'collection' ? 'text-emerald-700' : 'text-red-700'}`}>
                            {tx.transaction_type === 'collection' ? 'تحصيل' : 'سداد'} {money(tx.amount, storeSettings.currency)}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">{new Date(tx.created_at).toLocaleString('ar-EG')} - {methodLabel(tx.payment_method)}</p>
                          {tx.note && <p className="text-xs text-slate-500 mt-1">{tx.note}</p>}
                        </div>
                        <span className="text-[11px] font-black text-slate-500 bg-slate-50 px-2 py-1 rounded-lg">
                          باقي {money(tx.remaining_after, storeSettings.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-800">إضافة {form.type === 'association' ? 'جمعية' : 'سلفة'}</h2>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-red-500">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-4">
                <FormField label="النوع">
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })} className={inputClass}>
                    <option value="loan">سلفة من شخص</option>
                    <option value="association">جمعية</option>
                  </select>
                </FormField>
                <FormField label="اسم الشخص / الجمعية">
                  <input value={form.lender_name} onChange={(e) => setForm({ ...form, lender_name: e.target.value })} className={inputClass} />
                </FormField>
                <FormField label="رقم الهاتف">
                  <input value={form.lender_phone} onChange={(e) => setForm({ ...form, lender_phone: e.target.value })} className={inputClass} dir="ltr" />
                </FormField>
                <FormField label="بيانات إضافية">
                  <input value={form.lender_details} onChange={(e) => setForm({ ...form, lender_details: e.target.value })} className={inputClass} />
                </FormField>
                <FormField label="وصف المعاملة">
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${inputClass} min-h-[92px]`} />
                </FormField>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="مبلغ التحصيل">
                    <input type="number" value={form.collection_amount} onChange={(e) => setForm({ ...form, collection_amount: e.target.value })} className={`${inputClass} text-emerald-700 font-black`} />
                  </FormField>
                  <FormField label="إجمالي السداد">
                    <input type="number" value={form.principal_amount} onChange={(e) => setForm({ ...form, principal_amount: e.target.value })} className={`${inputClass} text-red-700 font-black`} />
                  </FormField>
                  <FormField label="تاريخ التحصيل">
                    <DateTextInput value={form.collection_date} onChange={(value) => setForm({ ...form, collection_date: value })} className={inputClass} />
                  </FormField>
                  <FormField label="عدد دفعات السداد">
                    <input type="number" min="1" value={form.installment_count} onChange={(e) => setForm({ ...form, installment_count: e.target.value })} className={inputClass} />
                  </FormField>
                  <FormField label="تاريخ أول دفعة">
                    <DateTextInput value={form.first_repayment_date} onChange={(value) => setForm({ ...form, first_repayment_date: value })} className={inputClass} />
                  </FormField>
                </div>

                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-black text-slate-700">جدول الدفعات</p>
                    <p className="text-xs font-bold text-slate-400">عدلي التاريخ أو المبلغ قبل الحفظ</p>
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {repaymentRows.map((payment, index) => (
                      <div key={index} className="bg-white border border-slate-100 rounded-xl p-3 grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
                        <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 font-black flex items-center justify-center text-xs">{index + 1}</span>
                        <DateTextInput value={payment.due_date} onChange={(value) => setRepaymentRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, due_date: value } : row))} className={`${inputClass} py-2 text-xs`} />
                        <input type="number" value={Number(payment.amount.toFixed(2))} onChange={(e) => setRepaymentRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: Number(e.target.value) || 0 } : row))} className={`${inputClass} py-2 text-xs`} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-5 py-3 rounded-xl bg-slate-100 text-slate-600 font-black">إلغاء</button>
              <button onClick={handleSubmit} className="px-5 py-3 rounded-xl bg-indigo-600 text-white font-black">حفظ الملف</button>
            </div>
          </div>
        </div>
      )}

      {paymentTarget && (
        <div className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-800">
                {paymentTarget.payment_type === 'collection' ? 'تحصيل' : 'سداد'} جزئي / كامل
              </h2>
              <button onClick={() => setPaymentTarget(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-red-500">
                <X size={20} />
              </button>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4 mt-4">
              <p className="text-xs font-black text-slate-500">المتبقي على الدفعة</p>
              <p className="text-2xl font-black text-slate-800 mt-1">{money(getRemaining(paymentTarget), storeSettings.currency)}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 mt-4">
              <FormField label="المبلغ المدفوع الآن">
                <input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className={`${inputClass} font-black`} />
              </FormField>
              <FormField label="طريقة الدفع">
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PayMethod)} className={inputClass}>
                  <option value="cash">كاش</option>
                  <option value="visa">فيزا</option>
                  <option value="wallet">محفظة</option>
                  <option value="instapay">انستاباي</option>
                </select>
              </FormField>
            </div>
            <button onClick={confirmPayment} className="w-full mt-5 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-black">
              تأكيد العملية
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-600">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function DateTextInput({ value, onChange, className }: { value: string; onChange: (value: string) => void; className: string }) {
  const [display, setDisplay] = useState(isoToDisplay(value));

  useEffect(() => {
    setDisplay(isoToDisplay(value));
  }, [value]);

  const handleChange = (nextDisplay: string) => {
    setDisplay(nextDisplay);
    const iso = displayToIso(nextDisplay);
    if (iso) onChange(iso);
  };

  const handleBlur = () => {
    const iso = displayToIso(display);
    if (iso) {
      onChange(iso);
      setDisplay(isoToDisplay(iso));
    } else {
      setDisplay(isoToDisplay(value));
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      dir="ltr"
      placeholder="يوم/شهر/سنة"
      value={display}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      className={className}
    />
  );
}

function PaymentRow({ payment, currency, onPay }: { payment: FinancingPayment; currency: string; onPay: (payment: FinancingPayment) => void }) {
  const remaining = Number(payment.remaining_amount ?? payment.amount ?? 0) || 0;
  const paid = Number(payment.paid_amount || 0);
  const isPaid = payment.status === 'paid';
  const isCollection = payment.payment_type === 'collection';
  const percent = Number(payment.amount || 0) > 0 ? Math.min(100, (paid / Number(payment.amount || 1)) * 100) : 0;

  return (
    <div className="border border-slate-100 rounded-2xl p-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl ${isCollection ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            {isCollection ? <Banknote size={18} /> : <ReceiptText size={18} />}
          </div>
          <div>
            <p className="font-black text-slate-800">{isCollection ? 'تحصيل' : payment.note || 'دفعة سداد'}</p>
            <p className="text-xs font-bold text-slate-400 mt-1 flex items-center gap-1">
              <CalendarDays size={12} /> {dateLabel(payment.due_date)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-slate-50 text-slate-700 px-3 py-2 rounded-xl text-xs font-black">الإجمالي {money(payment.amount, currency)}</span>
          <span className="bg-emerald-50 text-emerald-700 px-3 py-2 rounded-xl text-xs font-black">مدفوع {money(paid, currency)}</span>
          <span className="bg-red-50 text-red-700 px-3 py-2 rounded-xl text-xs font-black">باقي {money(remaining, currency)}</span>
          {!isPaid && (
            <button onClick={() => onPay(payment)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1">
              {isCollection ? <Wallet size={14} /> : <CreditCard size={14} />}
              {isCollection ? 'تحصيل' : 'سداد'}
            </button>
          )}
          {isPaid && <span className="bg-emerald-100 text-emerald-700 px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1"><CheckCircle2 size={14} /> مكتمل</span>}
        </div>
      </div>
      <div className="h-2 bg-slate-100 rounded-full mt-4 overflow-hidden">
        <div className={`h-full ${isCollection ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${isPaid ? 100 : percent}%` }} />
      </div>
    </div>
  );
}
