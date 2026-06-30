import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useStore, type Employee, type EmployeeTransaction, type EmployeeLeave } from '../../store/useStore';
import {
  Users, Plus, Trash2, Edit3, Search, X,
  Wallet, Landmark, CreditCard, Zap, Phone,
  DollarSign, Briefcase, ArrowRight, FileText, CalendarDays, Gift, UserCheck, UserX, Download
} from 'lucide-react';
import { activePaymentKeys, payLabelOf, primaryMethod as primaryMethod_ } from '../../utils/paymentMethods';

export default function Employees() {
  const {
    employees, employeeTransactions, employeeLeaves, storeSettings, orders, cashiers,
    addEmployee, updateEmployee, addEmployeeTransaction,
    updateEmployeeTransaction, deleteEmployeeTransaction,
    addEmployeeLeave, updateEmployeeLeave, deleteEmployeeLeave
  } = useStore();
  const payKeys = activePaymentKeys(storeSettings as any);

  // إجمالي مبيعات محاسب (المرتبط بموظف) في شهر معيّن (YYYY-MM).
  // مبيعات الموظف كبائع (salesperson) لهذا الشهر + الأرباح المحققة — لحساب العمولة.
  // يشمل الفواتير اللي اتسجّل عليها كبائع، + (لو محاسب) فواتيره اللي ملهاش بائع محدد.
  const employeeMonthStats = (emp: any, month: string) => {
    const cashier = emp?.cashier_id ? cashiers.find((c: any) => c.id === emp.cashier_id) : null;
    const cname = cashier?.name || emp?.name;
    const rows = orders.filter((o: any) => !o.is_deleted && o.type === 'sale' && String(o.date || '').slice(0, 7) === month && (
      (emp?.id && o.salesperson_id === emp.id) ||
      (emp?.cashier_id && !o.salesperson_id && o.cashier_name === cname)
    ));
    const sales = rows.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
    const profit = rows.reduce((s: number, o: any) => s + (o.items || []).reduce((ps: number, it: any) => {
      const qty = (Number(it.quantity) || 0) - (Number(it.returned_quantity) || 0);
      const cost = Number(it.average_purchase_price ?? it.purchase_price) || 0;
      return ps + ((Number(it.sale_price) || 0) - cost) * qty;
    }, 0), 0);
    return { sales, profit };
  };

  const [activeTab, setActiveTab] = useState<'employees' | 'transactions'>('employees');
  const [searchTerm, setSearchTerm] = useState('');
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [showTransModal, setShowTransModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<EmployeeTransaction | null>(null);
  const [editingLeave, setEditingLeave] = useState<EmployeeLeave | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [transType, setTransType] = useState<'salary' | 'advance' | 'incentive'>('advance');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileTimeFilter, setProfileTimeFilter] = useState<'month' | 'week' | 'all' | 'custom_month' | 'custom_year'>('month');
  const [profileCustomMonth, setProfileCustomMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [profileCustomYear, setProfileCustomYear] = useState<string>(new Date().getFullYear().toString());
  const [payrollMonth, setPayrollMonth] = useState<string>(new Date().toISOString().slice(0, 7));

  const [empFormData, setEmpFormData] = useState({
    name: '',
    phone: '',
    job_title: '',
    working_hours: '',
    monthly_salary: '',
    annual_leave_balance: '',
    hire_date: new Date().toISOString().slice(0, 10),
    is_active: true
  });

  const [transFormData, setTransFormData] = useState<Record<string, string>>({
    amount: '',
    paid_cash: '',
    paid_visa: '',
    paid_wallet: '',
    paid_instapay: '',
    paid_method5: '',
    paid_method6: '',
    month: new Date().toISOString().slice(0, 7),
    dedDays: '',
    dedAmount: '',
    commissionRate: '',
    note: ''
  });

  const [leaveFormData, setLeaveFormData] = useState({
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    leave_type: 'paid' as 'paid' | 'unpaid',
    note: ''
  });

  // --- Calculations ---
  const tc = storeSettings.themeColor;
  const today = new Date().toISOString().slice(0, 10);

  const getDaysBetween = (start: string, end: string) => {
    const startDate = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);
    const diff = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    return Math.max(1, diff || 1);
  };

  const formatDateInput = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const addDaysToDate = (date: string, days: number) => {
    const nextDate = new Date(`${date}T00:00:00`);
    nextDate.setDate(nextDate.getDate() + days);
    return formatDateInput(nextDate);
  };

  const splitDateRangeByMonth = (start: string, end: string) => {
    const ranges: { start: string; end: string; days: number }[] = [];
    let cursor = new Date(`${start}T00:00:00`);
    const finalDate = new Date(`${end}T00:00:00`);

    while (cursor <= finalDate) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const rangeEnd = monthEnd < finalDate ? monthEnd : finalDate;
      const rangeStartText = formatDateInput(cursor);
      const rangeEndText = formatDateInput(rangeEnd);
      ranges.push({
        start: rangeStartText,
        end: rangeEndText,
        days: getDaysBetween(rangeStartText, rangeEndText)
      });
      cursor = new Date(rangeEnd);
      cursor.setDate(cursor.getDate() + 1);
    }

    return ranges;
  };

  const getCurrentLeaveYearStart = (emp: Employee) => {
    const hire = new Date(`${emp.hire_date || emp.created_at?.slice(0, 10) || today}T00:00:00`);
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), hire.getMonth(), hire.getDate());
    if (yearStart > now) yearStart.setFullYear(yearStart.getFullYear() - 1);
    return formatDateInput(yearStart);
  };

  const getLeaveBalanceStats = (emp: Employee, excludeLeaveId?: string) => {
    const annualBalance = Number(emp.annual_leave_balance || 0);
    const yearStart = getCurrentLeaveYearStart(emp);
    const nextYearStart = new Date(`${yearStart}T00:00:00`);
    nextYearStart.setFullYear(nextYearStart.getFullYear() + 1);
    const yearEnd = nextYearStart.toISOString().slice(0, 10);
    const paidLeaves = employeeLeaves.filter(l =>
      l.employee_id === emp.id &&
      l.leave_type === 'paid' &&
      l.id !== excludeLeaveId &&
      l.start_date >= yearStart &&
      l.start_date < yearEnd
    );
    const used = paidLeaves.reduce((sum, l) => sum + Number(l.days_count || 0), 0);

    return {
      annualBalance,
      yearStart,
      yearEnd,
      used,
      remaining: Math.max(0, annualBalance - used)
    };
  };

  const getLeaveMonthDeductions = (empId: string, month: string, excludeLeaveId?: string) =>
    employeeLeaves
      .filter(l => l.employee_id === empId && l.month === month && l.leave_type === 'unpaid' && l.id !== excludeLeaveId)
      .reduce((sum, l) => sum + Number(l.deduction_amount || 0), 0);

  const filteredEmployees = employees
    .filter(e => {
      const isActive = e.is_active ?? true;
      const matchesStatus =
        employeeStatusFilter === 'all' ||
        (employeeStatusFilter === 'active' && isActive) ||
        (employeeStatusFilter === 'inactive' && !isActive);
      const matchesSearch =
        e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (e.job_title || '').toLowerCase().includes(searchTerm.toLowerCase());

      return matchesStatus && matchesSearch;
    })
    .sort((a, b) => Number(b.is_active ?? true) - Number(a.is_active ?? true) || a.name.localeCompare(b.name, 'ar'));

  const filteredTransactions = employeeTransactions
    .filter(t => {
      const emp = employees.find(e => e.id === t.employee_id);
      return emp?.name.toLowerCase().includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const getEmployeeMonthStats = (empId: string, month: string, excludeTransactionId?: string) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return { salary: 0, advances: 0, paidSalary: 0, deductions: 0, incentives: 0, leaveDeductions: 0, remaining: 0 };

    const monthTrans = employeeTransactions.filter(t => t.employee_id === empId && t.month === month && t.id !== excludeTransactionId);
    
    const advances = monthTrans.filter(t => t.type === 'advance').reduce((sum, t) => sum + t.amount, 0);
    const paidSalary = monthTrans.filter(t => t.type === 'salary').reduce((sum, t) => sum + t.amount, 0);
    const deductions = monthTrans.filter(t => t.type === 'salary').reduce((sum, t) => sum + (t.deductions || 0), 0);
    const incentives = monthTrans.filter(t => t.type === 'incentive').reduce((sum, t) => sum + t.amount, 0);
    const leaveDeductions = getLeaveMonthDeductions(empId, month);

    const remaining = Math.max(0, emp.monthly_salary - advances - paidSalary - deductions - leaveDeductions);

    return { salary: emp.monthly_salary, advances, paidSalary, deductions: deductions + leaveDeductions, incentives, leaveDeductions, remaining };
  };

  // تصدير كشف الرواتب للشهر المحدد (Excel)
  const exportPayroll = () => {
    const rows = employees.map((emp) => {
      const s = getEmployeeMonthStats(emp.id, payrollMonth);
      const sales = employeeMonthStats(emp, payrollMonth);
      return {
        'الموظف': emp.name,
        'الوظيفة': emp.job_title || '',
        'الراتب الشهري': Number(emp.monthly_salary) || 0,
        'السلف': s.advances,
        'الحوافز': s.incentives,
        'الخصومات': s.deductions,
        'الراتب المدفوع': s.paidSalary,
        'المتبقي': s.remaining,
        'مبيعاته (كبائع)': sales.sales,
        'أرباحه للشركة': sales.profit,
        'نسبة العمولة %': Number(emp.commission_rate) || 0,
      };
    });
    if (rows.length === 0) { alert('لا يوجد موظفون'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الرواتب');
    XLSX.writeFile(wb, `كشف_الرواتب_${payrollMonth}.xlsx`);
  };

  // --- Profile Logic ---
  const profileEmployee = employees.find(e => e.id === selectedProfileId);
  const profileTransactions = useMemo(() => {
    if (!profileEmployee) return [];
    let txs = employeeTransactions.filter(t => t.employee_id === profileEmployee.id);
    
    if (profileTimeFilter === 'month') {
      const currentMonth = new Date().toISOString().slice(0, 7);
      txs = txs.filter(t => t.month === currentMonth || t.created_at.startsWith(currentMonth));
    } else if (profileTimeFilter === 'week') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      txs = txs.filter(t => new Date(t.created_at) >= sevenDaysAgo);
    } else if (profileTimeFilter === 'custom_month') {
      txs = txs.filter(t => t.month === profileCustomMonth || t.created_at.startsWith(profileCustomMonth));
    } else if (profileTimeFilter === 'custom_year') {
      txs = txs.filter(t => t.month.startsWith(profileCustomYear) || t.created_at.startsWith(profileCustomYear));
    }
    return txs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [profileEmployee, employeeTransactions, profileTimeFilter, profileCustomMonth, profileCustomYear]);

  const profileLeaves = useMemo(() => {
    if (!profileEmployee) return [];
    let leaves = employeeLeaves.filter(l => l.employee_id === profileEmployee.id);
    if (profileTimeFilter === 'month') {
      const currentMonth = new Date().toISOString().slice(0, 7);
      leaves = leaves.filter(l => l.month === currentMonth || l.start_date.startsWith(currentMonth));
    } else if (profileTimeFilter === 'week') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      leaves = leaves.filter(l => new Date(l.start_date) >= sevenDaysAgo);
    } else if (profileTimeFilter === 'custom_month') {
      leaves = leaves.filter(l => l.month === profileCustomMonth || l.start_date.startsWith(profileCustomMonth));
    } else if (profileTimeFilter === 'custom_year') {
      leaves = leaves.filter(l => l.month.startsWith(profileCustomYear) || l.start_date.startsWith(profileCustomYear));
    }
    return leaves.sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
  }, [profileEmployee, employeeLeaves, profileTimeFilter, profileCustomMonth, profileCustomYear]);

  const profileStats = useMemo(() => {
    if (!profileEmployee) return { advances: 0, paidSalary: 0, deductions: 0, incentives: 0, leaveDays: 0 };
    return {
      advances: profileTransactions.filter(t => t.type === 'advance').reduce((s, t: any) => s + t.amount, 0),
      paidSalary: profileTransactions.filter(t => t.type === 'salary').reduce((s, t: any) => s + t.amount, 0),
      deductions: profileTransactions.filter(t => t.type === 'salary').reduce((s, t: any) => s + (t.deductions || 0), 0) + profileLeaves.filter(l => l.leave_type === 'unpaid').reduce((s, l) => s + (l.deduction_amount || 0), 0),
      incentives: profileTransactions.filter(t => t.type === 'incentive').reduce((s, t: any) => s + t.amount, 0),
      leaveDays: profileLeaves.reduce((s, l) => s + (l.days_count || 0), 0)
    };
  }, [profileTransactions, profileLeaves, profileEmployee]);

  const profileLeaveBalance = profileEmployee ? getLeaveBalanceStats(profileEmployee) : null;

  // --- Handlers ---
  const handleOpenEmpModal = (emp: Employee | null = null) => {
    if (emp) {
      setEditingEmployee(emp);
      setEmpFormData({
        name: emp.name,
        phone: emp.phone || '',
        job_title: emp.job_title,
        working_hours: emp.working_hours,
        monthly_salary: emp.monthly_salary.toString(),
        annual_leave_balance: (emp.annual_leave_balance || 0).toString(),
        hire_date: emp.hire_date || emp.created_at?.slice(0, 10) || today,
        is_active: emp.is_active ?? true
      });
    } else {
      setEditingEmployee(null);
      setEmpFormData({ name: '', phone: '', job_title: '', working_hours: '', monthly_salary: '', annual_leave_balance: '', hire_date: today, is_active: true });
    }
    setShowEmpModal(true);
  };

  const handleEmpSubmit = async () => {
    if (!empFormData.name || !empFormData.monthly_salary) return alert('يرجى إكمال البيانات الأساسية');
    
    const data = {
      name: empFormData.name,
      phone: empFormData.phone,
      job_title: empFormData.job_title,
      working_hours: empFormData.working_hours,
      monthly_salary: parseFloat(empFormData.monthly_salary) || 0,
      annual_leave_balance: parseFloat(empFormData.annual_leave_balance) || 0,
      hire_date: empFormData.hire_date || today,
      is_active: empFormData.is_active
    };

    if (editingEmployee) {
      await updateEmployee(editingEmployee.id, data);
    } else {
      await addEmployee(data);
    }
    setShowEmpModal(false);
  };

  const handleToggleEmployeeActive = async (emp: Employee) => {
    const isActive = emp.is_active ?? true;
    const message = isActive
      ? 'هل تريد جعل الموظف غير نشط؟ ستظل كل بياناته وسجلاته محفوظة.'
      : 'هل تريد إعادة تفعيل الموظف؟';
    if (!confirm(message)) return;
    await updateEmployee(emp.id, { is_active: !isActive });
  };

  const handleOpenTransModal = (emp: Employee, type: 'salary' | 'advance' | 'incentive', transaction?: EmployeeTransaction) => {
    setSelectedEmployee(emp);
    setTransType(type);
    setEditingTransaction(transaction || null);

    if (transaction) {
      setTransFormData({
        amount: transaction.amount.toString(),
        paid_cash: (transaction.paid_cash || 0).toString(),
        paid_visa: (transaction.paid_visa || 0).toString(),
        paid_wallet: (transaction.paid_wallet || 0).toString(),
        paid_instapay: (transaction.paid_instapay || 0).toString(),
        paid_method5: ((transaction as any).paid_method5 || 0).toString(),
        paid_method6: ((transaction as any).paid_method6 || 0).toString(),
        month: transaction.month,
        dedDays: '',
        dedAmount: (transaction.deductions || 0).toString(),
        commissionRate: '',
        note: transaction.note || ''
      });
      setShowTransModal(true);
      return;
    }
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    const stats = getEmployeeMonthStats(emp.id, currentMonth);
    const netAmount = type === 'salary' ? stats.remaining : '';

    setTransFormData({
      amount: netAmount.toString(),
      paid_cash: netAmount.toString(),
      paid_visa: '',
      paid_wallet: '',
      paid_instapay: '',
      month: currentMonth,
      dedDays: '',
      dedAmount: '',
      commissionRate: (type === 'salary' && emp.commission_rate) ? String(emp.commission_rate) : '',
      note: type === 'salary' ? `راتب شهر ${currentMonth}` : type === 'incentive' ? `حافز شهر ${currentMonth}` : ''
    });
    setShowTransModal(true);
  };

  const handleOpenLeaveModal = (emp: Employee, leave?: EmployeeLeave) => {
    setSelectedEmployee(emp);
    setEditingLeave(leave || null);
    setLeaveFormData({
      start_date: leave?.start_date || today,
      end_date: leave?.end_date || leave?.start_date || today,
      leave_type: leave?.leave_type || 'paid',
      note: leave?.note || ''
    });
    setShowLeaveModal(true);
  };

  const handleTransSubmit = async () => {
    const split: Record<string, number> = {};
    payKeys.forEach((k) => { split[k] = parseFloat((transFormData as any)['paid_' + k]) || 0; });
    const total = payKeys.reduce((s, k) => s + split[k], 0);

    if (total <= 0) return alert('يرجى إدخال مبلغ صحيح');

    const paymentMethod = primaryMethod_(split);

    const transactionData = {
      employee_id: selectedEmployee!.id,
      amount: total,
      type: transType,
      payment_method: paymentMethod as any,
      paid_cash: split.cash || 0,
      paid_visa: split.visa || 0,
      paid_wallet: split.wallet || 0,
      paid_instapay: split.instapay || 0,
      paid_method5: split.method5 || 0,
      paid_method6: split.method6 || 0,
      month: transFormData.month,
      deductions: (parseFloat(transFormData.dedAmount) || 0) + ((parseFloat(transFormData.dedDays) || 0) * (selectedEmployee!.monthly_salary / 30)),
      note: transFormData.note
    };

    if (editingTransaction) {
      await updateEmployeeTransaction(editingTransaction.id, transactionData);
    } else {
      await addEmployeeTransaction(transactionData);
    }

    setShowTransModal(false);
    setEditingTransaction(null);
  };

  const handleLeaveSubmit = async () => {
    if (!selectedEmployee) return;
    if (!leaveFormData.start_date || !leaveFormData.end_date) return alert('يرجى تحديد تاريخ الإجازة');

    const daysCount = getDaysBetween(leaveFormData.start_date, leaveFormData.end_date);
    const balance = getLeaveBalanceStats(selectedEmployee, editingLeave?.id);
    const dailyRate = selectedEmployee.monthly_salary / 30;

    const createLeaveData = (
      startDate: string,
      endDate: string,
      leaveType: 'paid' | 'unpaid',
      days: number
    ) => ({
      employee_id: selectedEmployee.id,
      start_date: startDate,
      end_date: endDate,
      days_count: days,
      leave_type: leaveType,
      deduction_amount: leaveType === 'unpaid' ? days * dailyRate : 0,
      month: startDate.slice(0, 7),
      note: leaveFormData.note || (leaveType === 'paid' ? 'إجازة من الرصيد' : 'إجازة بخصم من المرتب')
    });

    if (leaveFormData.leave_type === 'unpaid') {
      const unpaidRanges = splitDateRangeByMonth(leaveFormData.start_date, leaveFormData.end_date);
      for (let index = 0; index < unpaidRanges.length; index += 1) {
        const range = unpaidRanges[index];
        const leaveData = createLeaveData(range.start, range.end, 'unpaid', range.days);
        if (editingLeave && index === 0) {
          await updateEmployeeLeave(editingLeave.id, leaveData);
        } else {
          await addEmployeeLeave(leaveData);
        }
      }
    } else {
      const paidDays = Math.min(daysCount, Math.max(0, balance.remaining));
      const unpaidDays = daysCount - paidDays;

      if (paidDays > 0) {
        const paidStart = leaveFormData.start_date;
        const paidEnd = addDaysToDate(paidStart, paidDays - 1);
        const paidLeaveData = createLeaveData(paidStart, paidEnd, 'paid', paidDays);

        if (editingLeave) {
          await updateEmployeeLeave(editingLeave.id, paidLeaveData);
        } else {
          await addEmployeeLeave(paidLeaveData);
        }
      }

      if (unpaidDays > 0) {
        const unpaidStart = addDaysToDate(leaveFormData.start_date, paidDays);
        const unpaidRanges = splitDateRangeByMonth(unpaidStart, leaveFormData.end_date);

        for (let index = 0; index < unpaidRanges.length; index += 1) {
          const range = unpaidRanges[index];
          const unpaidLeaveData = createLeaveData(range.start, range.end, 'unpaid', range.days);
          if (paidDays === 0 && editingLeave && index === 0) {
            await updateEmployeeLeave(editingLeave.id, unpaidLeaveData);
          } else {
            await addEmployeeLeave(unpaidLeaveData);
          }
        }

        alert(`الرصيد المتاح ${balance.remaining} يوم. تم تسجيل ${paidDays} يوم من الرصيد و${unpaidDays} يوم بخصم من المرتب.`);
      }
    }

    setShowLeaveModal(false);
    setEditingLeave(null);
  };

  const handleDeleteLeave = async (leaveId: string) => {
    if (!confirm('هل تريد حذف سجل الإجازة؟')) return;
    await deleteEmployeeLeave(leaveId);
  };

  const handleDeleteTransaction = async (transactionId: string) => {
    if (!confirm('هل تريد حذف هذه المعاملة؟ سيتم حذف أثرها من الخزينة والميزانية أيضاً.')) return;
    await deleteEmployeeTransaction(transactionId);
  };

  const handleCloseTransModal = () => {
    setShowTransModal(false);
    setEditingTransaction(null);
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto h-[calc(100vh-2rem)] overflow-y-auto" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
        <div>
          <h1 className="text-3xl font-black text-slate-800 flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-200">
              <Users size={28} />
            </div>
            إدارة الموظفين والرواتب
          </h1>
          <p className="text-slate-500 mt-2 font-medium">سجل الموظفين، الرواتب، والسلف الشهرية</p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text"
              placeholder="بحث عن موظف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-2xl pr-12 pl-4 py-3 focus:ring-2 focus:ring-indigo-500/20 outline-none font-medium w-64"
            />
          </div>
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2">
            <input type="month" value={payrollMonth} onChange={(e) => setPayrollMonth(e.target.value)} className="bg-transparent text-sm font-bold outline-none" />
            <button onClick={exportPayroll} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition"><Download size={16} /> كشف الرواتب Excel</button>
          </div>
          <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl">
            {[
              { value: 'all', label: 'الكل' },
              { value: 'active', label: 'نشط' },
              { value: 'inactive', label: 'غير نشط' },
            ].map(option => (
              <button
                key={option.value}
                onClick={() => setEmployeeStatusFilter(option.value as typeof employeeStatusFilter)}
                className={`px-4 py-2 rounded-xl text-sm font-black transition ${
                  employeeStatusFilter === option.value
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          
          <button 
            onClick={() => handleOpenEmpModal()}
            style={{ backgroundColor: tc }}
            className="flex items-center gap-2 text-white px-6 py-3 rounded-2xl font-bold hover:opacity-90 transition shadow-lg"
          >
            <Plus size={20} /> موظف جديد
          </button>
        </div>
      </div>

      {/* Profile View vs List View */}
      {selectedProfileId && profileEmployee ? (
        <div className="space-y-6">
          {/* Profile Header */}
          <div className="flex items-center justify-between bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setSelectedProfileId(null)}
                className="p-3 bg-slate-50 hover:bg-slate-100 rounded-2xl text-slate-500 transition"
              >
                <ArrowRight size={20} />
              </button>
              <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                <Briefcase size={32} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-black text-slate-800">{profileEmployee.name}</h2>
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${(profileEmployee.is_active ?? true) ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {(profileEmployee.is_active ?? true) ? 'نشط' : 'غير نشط'}
                  </span>
                </div>
                <p className="text-slate-500 font-medium">{profileEmployee.job_title || 'بدون مسمى'} • {profileEmployee.phone}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => handleOpenLeaveModal(profileEmployee)}
                disabled={!(profileEmployee.is_active ?? true)}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-sky-50 text-sky-600 font-bold hover:bg-sky-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CalendarDays size={20} /> إضافة إجازة
              </button>
              <button 
                onClick={() => handleOpenTransModal(profileEmployee, 'incentive')}
                disabled={!(profileEmployee.is_active ?? true)}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-50 text-emerald-600 font-bold hover:bg-emerald-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Gift size={20} /> إضافة حافز
              </button>
              <button 
                onClick={() => handleOpenTransModal(profileEmployee, 'advance')}
                disabled={!(profileEmployee.is_active ?? true)}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-amber-50 text-amber-600 font-bold hover:bg-amber-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Wallet size={20} /> سحب سلفة
              </button>
              <button 
                onClick={() => handleOpenTransModal(profileEmployee, 'salary')}
                disabled={!(profileEmployee.is_active ?? true)}
                style={{ backgroundColor: tc }}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl text-white font-bold hover:opacity-90 transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Landmark size={20} /> صرف راتب
              </button>
            </div>
          </div>

          {/* Profile Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-center">
              <span className="text-slate-400 font-bold text-sm mb-1">الراتب الأساسي</span>
              <span className="text-2xl font-black text-slate-800">{profileEmployee.monthly_salary.toLocaleString()} <span className="text-sm font-medium text-slate-400">{storeSettings.currency}</span></span>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-center">
              <span className="text-sky-500 font-bold text-sm mb-1">رصيد الإجازات المتبقي</span>
              <span className="text-2xl font-black text-sky-600">{profileLeaveBalance?.remaining || 0} <span className="text-sm font-medium text-sky-400">يوم</span></span>
              <span className="text-[11px] font-bold text-slate-400 mt-1">يتجدد {profileLeaveBalance?.yearEnd}</span>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-center">
              <span className="text-amber-500 font-bold text-sm mb-1">إجمالي السلف (للفترة)</span>
              <span className="text-2xl font-black text-amber-600">{profileStats.advances.toLocaleString()} <span className="text-sm font-medium text-amber-400">{storeSettings.currency}</span></span>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-center">
              <span className="text-emerald-500 font-bold text-sm mb-1">حوافز (للفترة)</span>
              <span className="text-2xl font-black text-emerald-600">{profileStats.incentives.toLocaleString()} <span className="text-sm font-medium text-emerald-400">{storeSettings.currency}</span></span>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-center">
              <span className="text-emerald-500 font-bold text-sm mb-1">رواتب مدفوعة (للفترة)</span>
              <span className="text-2xl font-black text-emerald-600">{profileStats.paidSalary.toLocaleString()} <span className="text-sm font-medium text-emerald-400">{storeSettings.currency}</span></span>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-center">
              <span className="text-red-500 font-bold text-sm mb-1">خصومات (للفترة)</span>
              <span className="text-2xl font-black text-red-600">{profileStats.deductions.toLocaleString()} <span className="text-sm font-medium text-red-400">{storeSettings.currency}</span></span>
            </div>
          </div>

          {/* Profile Transactions */}
          <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <FileText size={20} className="text-slate-400" />
                سجل حركات الموظف
              </h3>
              <div className="flex items-center gap-2 bg-white p-1 rounded-xl shadow-sm border border-slate-200 px-2">
                <select
                  value={profileTimeFilter}
                  onChange={(e) => setProfileTimeFilter(e.target.value as any)}
                  className="bg-transparent text-sm font-bold text-slate-700 py-2 focus:outline-none"
                >
                  <option value="week">هذا الأسبوع</option>
                  <option value="month">الشهر الحالي</option>
                  <option value="custom_month">شهر محدد</option>
                  <option value="custom_year">سنة محددة</option>
                  <option value="all">كل الأوقات</option>
                </select>
                {profileTimeFilter === 'custom_month' && (
                  <input 
                    type="month" 
                    value={profileCustomMonth}
                    onChange={(e) => setProfileCustomMonth(e.target.value)}
                    className="bg-transparent text-sm font-bold text-indigo-600 focus:outline-none pl-2"
                  />
                )}
                {profileTimeFilter === 'custom_year' && (
                  <input 
                    type="number" 
                    value={profileCustomYear}
                    onChange={(e) => setProfileCustomYear(e.target.value)}
                    className="bg-transparent text-sm font-bold text-indigo-600 focus:outline-none pl-2 w-20"
                    placeholder="2026"
                  />
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead>
                  <tr className="bg-white text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="p-6">التاريخ</th>
                    <th className="p-6">النوع</th>
                    <th className="p-6">الشهر</th>
                    <th className="p-6">طريقة الدفع</th>
                    <th className="p-6 text-left">المبلغ</th>
                    <th className="p-6 text-left">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {profileTransactions.map((t: any) => (
                    <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-6 text-slate-400 text-xs font-bold">{new Date(t.created_at).toLocaleDateString('ar-SA')}</td>
                      <td className="p-6">
                        <span className={`px-2.5 py-1 rounded-lg font-bold text-[10px] ${
                          t.type === 'salary' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : t.type === 'incentive' ? 'bg-sky-50 text-sky-600 border border-sky-100' : 'bg-amber-50 text-amber-600 border border-amber-100'
                        }`}>
                          {t.type === 'salary' ? 'راتب' : t.type === 'incentive' ? 'حافز' : 'سلفة'}
                        </span>
                      </td>
                      <td className="p-6 text-slate-500 font-medium">{t.month}</td>
                      <td className="p-6">
                        <div className="flex flex-col gap-1">
                          {t.paid_cash > 0 && <span className="text-[10px] font-black text-emerald-600 flex items-center gap-1"><Landmark size={12} /> كاش</span>}
                          {t.paid_visa > 0 && <span className="text-[10px] font-black text-blue-600 flex items-center gap-1"><CreditCard size={12} /> فيزا</span>}
                          {t.paid_instapay > 0 && <span className="text-[10px] font-black text-amber-600 flex items-center gap-1"><Zap size={12} /> انستا</span>}
                        </div>
                      </td>
                      <td className="p-6 text-left">
                        <div className="flex flex-col items-left">
                          <span className="font-black text-lg text-slate-800">
                            {t.amount.toLocaleString()} <span className="text-xs font-normal text-slate-400">{storeSettings.currency}</span>
                          </span>
                          {t.deductions > 0 && (
                            <span className="text-[10px] font-bold text-red-500">
                              خصومات: -{t.deductions.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-6">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleOpenTransModal(profileEmployee, t.type, t)} className="p-2 text-slate-400 hover:text-indigo-600 transition" title="تعديل">
                            <Edit3 size={16} />
                          </button>
                          <button onClick={() => handleDeleteTransaction(t.id)} className="p-2 text-slate-400 hover:text-red-500 transition" title="حذف">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {profileTransactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 font-bold">لا توجد حركات مالية في هذه الفترة</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <CalendarDays size={20} className="text-sky-500" />
                سجل الإجازات والغيابات
              </h3>
              <div className="text-xs font-bold text-slate-400">
                إجمالي الفترة: {profileStats.leaveDays} يوم
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead>
                  <tr className="bg-white text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="p-6">من</th>
                    <th className="p-6">إلى</th>
                    <th className="p-6">الأيام</th>
                    <th className="p-6">النوع</th>
                    <th className="p-6">الخصم</th>
                    <th className="p-6 text-left">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {profileLeaves.map((leave) => (
                    <tr key={leave.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-6 text-slate-500 font-bold">{leave.start_date}</td>
                      <td className="p-6 text-slate-500 font-bold">{leave.end_date}</td>
                      <td className="p-6 text-slate-800 font-black">{leave.days_count} يوم</td>
                      <td className="p-6">
                        <span className={`px-2.5 py-1 rounded-lg font-bold text-[10px] ${
                          leave.leave_type === 'paid' ? 'bg-sky-50 text-sky-600 border border-sky-100' : 'bg-red-50 text-red-600 border border-red-100'
                        }`}>
                          {leave.leave_type === 'paid' ? 'من الرصيد' : 'بخصم مرتب'}
                        </span>
                      </td>
                      <td className="p-6 font-black text-red-600">
                        {leave.deduction_amount > 0 ? `${leave.deduction_amount.toLocaleString()} ${storeSettings.currency}` : '-'}
                      </td>
                      <td className="p-6">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleOpenLeaveModal(profileEmployee, leave)} className="p-2 text-slate-400 hover:text-indigo-600 transition" title="تعديل">
                            <Edit3 size={16} />
                          </button>
                          <button onClick={() => handleDeleteLeave(leave.id)} className="p-2 text-slate-400 hover:text-red-500 transition" title="حذف">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {profileLeaves.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 font-bold">لا توجد إجازات أو غيابات في هذه الفترة</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-2 mb-6 bg-slate-100 p-1.5 rounded-2xl w-fit">
            <button 
              onClick={() => setActiveTab('employees')}
              className={`px-6 py-2.5 rounded-xl font-bold transition ${activeTab === 'employees' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              قائمة الموظفين
            </button>
            <button 
              onClick={() => setActiveTab('transactions')}
              className={`px-6 py-2.5 rounded-xl font-bold transition ${activeTab === 'transactions' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              سجل العمليات
            </button>
          </div>

      {activeTab === 'employees' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEmployees.map(emp => {
            const currentMonth = new Date().toISOString().slice(0, 7);
            const stats = getEmployeeMonthStats(emp.id, currentMonth);
            const leaveStats = getLeaveBalanceStats(emp);
            const isActive = emp.is_active ?? true;
            
            return (
              <div key={emp.id} className={`bg-white rounded-[32px] p-6 shadow-sm border transition-all group ${isActive ? 'border-slate-100 hover:border-indigo-200' : 'border-slate-200 opacity-75 grayscale-[0.25]'}`}>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${isActive ? 'bg-slate-100 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                      <Briefcase size={28} />
                    </div>
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                      {isActive ? 'نشط' : 'غير نشط'}
                    </span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleOpenEmpModal(emp)} className="p-2 text-slate-400 hover:text-indigo-600 transition"><Edit3 size={18} /></button>
                    <button
                      onClick={() => handleToggleEmployeeActive(emp)}
                      className={`p-2 text-slate-400 transition ${isActive ? 'hover:text-amber-600' : 'hover:text-emerald-600'}`}
                      title={isActive ? 'جعل الموظف غير نشط' : 'إعادة تفعيل الموظف'}
                    >
                      {isActive ? <UserX size={18} /> : <UserCheck size={18} />}
                    </button>
                  </div>
                </div>

                <h3 className="text-xl font-black text-slate-800 mb-1">{emp.name}</h3>
                <p className="text-slate-500 text-sm font-medium mb-4 flex flex-col gap-1">
                   <span>{emp.job_title || 'بدون مسمى وظيفي'}</span>
                   {emp.phone && <span className="text-indigo-600 flex items-center gap-1"><Phone size={12} /> {emp.phone}</span>}
                </p>

                <div className="space-y-3 mb-6">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400 flex items-center gap-1"><DollarSign size={14} /> الراتب الأساسي</span>
                    <span className="font-black text-slate-800">{emp.monthly_salary.toLocaleString()} {storeSettings.currency}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400 flex items-center gap-1"><CalendarDays size={14} /> رصيد الإجازات</span>
                    <span className="font-black text-sky-600">{leaveStats.remaining} / {leaveStats.annualBalance} يوم</span>
                  </div>
                  {stats.paidSalary > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-400 flex items-center gap-1">تم صرفه (رواتب)</span>
                      <span className="font-black text-indigo-600">{stats.paidSalary.toLocaleString()} {storeSettings.currency}</span>
                    </div>
                  )}
                  {stats.deductions > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-400 flex items-center gap-1">خصومات</span>
                      <span className="font-black text-red-600">{stats.deductions.toLocaleString()} {storeSettings.currency}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <span className="text-amber-600 font-bold flex items-center gap-1">سلف الشهر</span>
                    <span className="font-black text-amber-700">{stats.advances.toLocaleString()} {storeSettings.currency}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm p-3 bg-emerald-50 rounded-xl border border-emerald-100 mt-2">
                    <span className="text-emerald-600 font-bold flex items-center gap-1">المتبقي صرفه ({currentMonth})</span>
                    <span className="font-black text-emerald-700">{stats.remaining.toLocaleString()} {storeSettings.currency}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => handleOpenLeaveModal(emp)}
                    disabled={!isActive}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl bg-sky-50 text-sky-700 font-bold hover:bg-sky-100 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CalendarDays size={16} /> إجازة
                  </button>
                  <button 
                    onClick={() => handleOpenTransModal(emp, 'incentive')}
                    disabled={!isActive}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-50 text-emerald-700 font-bold hover:bg-emerald-100 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Gift size={16} /> حافز
                  </button>
                  <button 
                    onClick={() => handleOpenTransModal(emp, 'advance')}
                    disabled={!isActive}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Wallet size={16} /> صرف سلفة
                  </button>
                  <button 
                    onClick={() => handleOpenTransModal(emp, 'salary')}
                    disabled={!isActive || stats.remaining <= 0}
                    style={{ backgroundColor: !isActive || stats.remaining <= 0 ? '#94a3b8' : tc }}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl text-white font-bold hover:opacity-90 transition shadow-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Landmark size={16} /> {stats.remaining <= 0 ? 'مُسدد بالكامل' : 'صرف راتب'}
                  </button>
                </div>
                <button 
                  onClick={() => setSelectedProfileId(emp.id)}
                  className="w-full mt-3 py-3 border-2 border-slate-100 rounded-xl text-slate-500 font-bold hover:border-indigo-200 hover:text-indigo-600 transition flex items-center justify-center gap-2 text-sm"
                >
                  <FileText size={16} /> عرض البروفايل والشيت
                </button>
              </div>
            );
          })}

          {filteredEmployees.length === 0 && (
            <div className="col-span-full py-20 text-center bg-white rounded-[32px] border border-dashed border-slate-200 opacity-50">
              <Users size={64} className="mx-auto mb-4 text-slate-300" />
              <p className="text-xl font-bold">لا يوجد موظفون مضافون بعد</p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                  <th className="p-6">التاريخ</th>
                  <th className="p-6">الموظف</th>
                  <th className="p-6">النوع</th>
                  <th className="p-6">الشهر</th>
                  <th className="p-6">طريقة الدفع</th>
                  <th className="p-6 text-left">المبلغ</th>
                  <th className="p-6 text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredTransactions.map(t => {
                  const emp = employees.find(e => e.id === t.employee_id);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-6 text-slate-400 text-xs font-bold">{new Date(t.created_at).toLocaleDateString('ar-SA')}</td>
                      <td className="p-6 font-bold text-slate-800">{emp?.name || 'موظف محذوف'}</td>
                      <td className="p-6">
                        <span className={`px-2.5 py-1 rounded-lg font-bold text-[10px] ${
                          t.type === 'salary' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : t.type === 'incentive' ? 'bg-sky-50 text-sky-600 border border-sky-100' : 'bg-amber-50 text-amber-600 border border-amber-100'
                        }`}>
                          {t.type === 'salary' ? 'راتب' : t.type === 'incentive' ? 'حافز' : 'سلفة'}
                        </span>
                      </td>
                      <td className="p-6 text-slate-500 font-medium">{t.month}</td>
                      <td className="p-6">
                        <div className="flex flex-col gap-1">
                          {t.paid_cash > 0 && <span className="text-[10px] font-black text-emerald-600 flex items-center gap-1"><Landmark size={12} /> كاش: {t.paid_cash.toLocaleString()}</span>}
                          {t.paid_visa > 0 && <span className="text-[10px] font-black text-blue-600 flex items-center gap-1"><CreditCard size={12} /> فيزا: {t.paid_visa.toLocaleString()}</span>}
                          {t.paid_instapay > 0 && <span className="text-[10px] font-black text-amber-600 flex items-center gap-1"><Zap size={12} /> انستا: {t.paid_instapay.toLocaleString()}</span>}
                        </div>
                      </td>
                      <td className="p-6 text-left">
                        <div className="flex flex-col items-left">
                          <span className="font-black text-lg text-slate-800">
                            {t.amount.toLocaleString()} <span className="text-xs font-normal text-slate-400">{storeSettings.currency}</span>
                          </span>
                          {t.deductions > 0 && (
                            <span className="text-[10px] font-bold text-red-500">
                              خصومات: -{t.deductions.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-6">
                        <div className="flex items-center justify-end gap-2">
                          {emp && (
                            <button onClick={() => handleOpenTransModal(emp, t.type, t)} className="p-2 text-slate-400 hover:text-indigo-600 transition" title="تعديل">
                              <Edit3 size={16} />
                            </button>
                          )}
                          <button onClick={() => handleDeleteTransaction(t.id)} className="p-2 text-slate-400 hover:text-red-500 transition" title="حذف">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}

      {/* Employee Modal */}
      {showEmpModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-8 text-white flex justify-between items-center shrink-0" style={{ backgroundColor: tc }}>
              <div>
                <h2 className="text-2xl font-black">{editingEmployee ? 'تعديل بيانات موظف' : 'إضافة موظف جديد'}</h2>
                <p className="text-white/70 text-sm mt-1">سجل بيانات الموظف والراتب الأساسي</p>
              </div>
              <button onClick={() => setShowEmpModal(false)} className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition text-white"><X size={24} /></button>
            </div>
            <div className="p-8 space-y-6 overflow-y-auto">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">اسم الموظف</label>
                <input 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500/20 outline-none font-bold"
                  value={empFormData.name}
                  onChange={e => setEmpFormData({...empFormData, name: e.target.value})}
                  placeholder="مثال: أحمد محمد"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">رقم الهاتف</label>
                <input 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500/20 outline-none font-bold"
                  value={empFormData.phone}
                  onChange={e => setEmpFormData({...empFormData, phone: e.target.value})}
                  placeholder="01xxxxxxxxx"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">المسمى الوظيفي</label>
                  <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500/20 outline-none font-bold"
                    value={empFormData.job_title}
                    onChange={e => setEmpFormData({...empFormData, job_title: e.target.value})}
                    placeholder="شيف، كاشير..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">مواعيد العمل</label>
                  <input 
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500/20 outline-none font-bold"
                    value={empFormData.working_hours}
                    onChange={e => setEmpFormData({...empFormData, working_hours: e.target.value})}
                    placeholder="10ص - 10م"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">الراتب الشهري</label>
                <input 
                  type="number"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500/20 outline-none font-black text-xl"
                  value={empFormData.monthly_salary}
                  onChange={e => setEmpFormData({...empFormData, monthly_salary: e.target.value})}
                  placeholder="0.00"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">رصيد الإجازات السنوي</label>
                  <input 
                    type="number"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500/20 outline-none font-black"
                    value={empFormData.annual_leave_balance}
                    onChange={e => setEmpFormData({...empFormData, annual_leave_balance: e.target.value})}
                    placeholder="مثال: 21"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">تاريخ التعيين</label>
                  <input 
                    type="date"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500/20 outline-none font-black"
                    value={empFormData.hire_date}
                    onChange={e => setEmpFormData({...empFormData, hire_date: e.target.value})}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">حالة الموظف</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setEmpFormData({...empFormData, is_active: true})}
                    className={`py-4 rounded-2xl font-black border transition ${empFormData.is_active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                  >
                    نشط
                  </button>
                  <button
                    onClick={() => setEmpFormData({...empFormData, is_active: false})}
                    className={`py-4 rounded-2xl font-black border transition ${!empFormData.is_active ? 'bg-slate-700 text-white border-slate-700' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                  >
                    غير نشط
                  </button>
                </div>
              </div>
              <button onClick={handleEmpSubmit} style={{ backgroundColor: tc }} className="w-full text-white py-5 rounded-2xl font-black text-lg shadow-xl hover:opacity-90 transition-all">
                {editingEmployee ? 'حفظ التعديلات' : 'إضافة الموظف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Modal (Salary/Advance/Incentive) */}
      {showTransModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-8 text-white flex justify-between items-center shrink-0" style={{ backgroundColor: transType === 'salary' ? '#059669' : transType === 'incentive' ? '#0284c7' : '#d97706' }}>
              <div>
                <h2 className="text-2xl font-black">
                  {editingTransaction ? 'تعديل معاملة موظف' : transType === 'salary' ? 'صرف راتب شهري' : transType === 'incentive' ? 'إضافة حافز شهري' : 'صرف سلفة لموظف'}
                </h2>
                <p className="text-white/70 text-sm mt-1">{selectedEmployee?.name}</p>
              </div>
              <button onClick={handleCloseTransModal} className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition text-white"><X size={24} /></button>
            </div>
            
            <div className="p-8 space-y-6 overflow-y-auto">
              {transType === 'salary' && (() => {
                const stats = getEmployeeMonthStats(selectedEmployee!.id, transFormData.month, editingTransaction?.id);
                return (
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">الراتب الأساسي</p>
                      <p className="text-lg font-black text-slate-700">{selectedEmployee?.monthly_salary.toLocaleString()} <span className="text-xs text-slate-400">{storeSettings.currency}</span></p>
                    </div>
                    {stats.paidSalary > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-indigo-400 uppercase">تم صرفه (سابقاً)</p>
                        <p className="text-lg font-black text-indigo-600">-{stats.paidSalary.toLocaleString()} <span className="text-xs text-indigo-300">{storeSettings.currency}</span></p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold text-red-400 uppercase">سلف (خصم)</p>
                      <p className="text-lg font-black text-red-600">-{stats.advances.toLocaleString()} <span className="text-xs text-red-300">{storeSettings.currency}</span></p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-emerald-500 uppercase">المتبقي للصرف</p>
                      <p className="text-lg font-black text-emerald-600">{stats.remaining.toLocaleString()} <span className="text-xs text-emerald-300">{storeSettings.currency}</span></p>
                    </div>
                  </div>
                );
              })()}

              {transType === 'salary' && (
                <div className="space-y-4 bg-slate-50 p-6 rounded-[24px] border border-slate-100">
                  <p className="text-sm font-bold text-slate-700 flex items-center gap-2">
                    <Trash2 size={16} className="text-red-500" /> تطبيق خصومات إضافية
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">بعدد الأيام</label>
                      <input 
                        type="number" 
                        placeholder="0 يوم"
                        className="w-full bg-white border border-slate-200 rounded-xl p-3 outline-none font-bold" 
                        value={transFormData.dedDays} 
                        onChange={e => {
                          const days = e.target.value;
                          const dailyRate = selectedEmployee!.monthly_salary / 30;
                          const totalDed = (parseFloat(days) || 0) * dailyRate + (parseFloat(transFormData.dedAmount) || 0);
                          const stats = getEmployeeMonthStats(selectedEmployee!.id, transFormData.month, editingTransaction?.id);
                          const net = Math.max(0, stats.salary - stats.advances - stats.paidSalary - stats.deductions - totalDed);
                          setTransFormData({
                            ...transFormData, 
                            dedDays: days,
                            amount: net.toFixed(2),
                            paid_cash: net.toFixed(2),
                            paid_visa: '', paid_wallet: '', paid_instapay: ''
                          });
                        }} 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">بمبلغ محدد</label>
                      <input 
                        type="number" 
                        placeholder="0.00"
                        className="w-full bg-white border border-slate-200 rounded-xl p-3 outline-none font-bold" 
                        value={transFormData.dedAmount} 
                        onChange={e => {
                          const amt = e.target.value;
                          const dailyRate = selectedEmployee!.monthly_salary / 30;
                          const totalDed = (parseFloat(transFormData.dedDays) || 0) * dailyRate + (parseFloat(amt) || 0);
                          const stats = getEmployeeMonthStats(selectedEmployee!.id, transFormData.month, editingTransaction?.id);
                          const net = Math.max(0, stats.salary - stats.advances - stats.paidSalary - stats.deductions - totalDed);
                          setTransFormData({
                            ...transFormData, 
                            dedAmount: amt,
                            amount: net.toFixed(2),
                            paid_cash: net.toFixed(2),
                            paid_visa: '', paid_wallet: '', paid_instapay: ''
                          });
                        }} 
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">الشهر المستهدف</label>
                  <input 
                    type="month"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 focus:ring-1 outline-none font-bold"
                    value={transFormData.month}
                    onChange={e => {
                      const newMonth = e.target.value;
                      if (transType === 'salary') {
                        const stats = getEmployeeMonthStats(selectedEmployee!.id, newMonth, editingTransaction?.id);
                        const totalDed = (parseFloat(transFormData.dedDays) || 0) * (selectedEmployee!.monthly_salary / 30) + (parseFloat(transFormData.dedAmount) || 0);
                        const net = Math.max(0, stats.salary - stats.advances - stats.paidSalary - stats.deductions - totalDed);
                        setTransFormData({
                          ...transFormData,
                          month: newMonth,
                          amount: net.toFixed(2),
                          paid_cash: net.toFixed(2),
                          paid_visa: '', paid_wallet: '', paid_instapay: ''
                        });
                      } else {
                        setTransFormData({...transFormData, month: newMonth});
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">المبلغ الإجمالي</label>
                  <input 
                    type="number"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 focus:ring-1 outline-none font-black text-indigo-600"
                    value={transFormData.amount}
                    onChange={e => setTransFormData({...transFormData, amount: e.target.value, paid_cash: e.target.value, paid_visa: '', paid_wallet: '', paid_instapay: ''})}
                  />
                </div>
              </div>

              {transType === 'salary' && (() => {
                const stats = employeeMonthStats(selectedEmployee, transFormData.month);
                const sales = stats.sales;
                const rate = parseFloat(transFormData.commissionRate) || 0;
                const commission = sales * rate / 100;
                return (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-sm font-black text-emerald-800">
                      <span>عمولة المبيعات</span>
                      <span>مبيعات الشهر: {sales.toFixed(2)} {storeSettings.currency}</span>
                    </div>
                    <div className="text-[11px] font-bold text-emerald-700 -mt-1">الأرباح المحققة للشركة من مبيعاته: {stats.profit.toFixed(2)} {storeSettings.currency}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="text-xs font-bold text-slate-600">نسبة العمولة %</label>
                      <input type="number" min="0" step="0.1" className="w-20 bg-white border border-emerald-200 rounded-lg p-2 text-center font-bold" value={transFormData.commissionRate} onChange={e => setTransFormData({ ...transFormData, commissionRate: e.target.value })} />
                      <span className="text-sm font-black text-emerald-700">= {commission.toFixed(2)} {storeSettings.currency}</span>
                      <button type="button" disabled={commission <= 0}
                        onClick={() => setTransFormData({
                          ...transFormData,
                          paid_cash: ((parseFloat(transFormData.paid_cash) || 0) + commission).toFixed(2),
                          amount: ((parseFloat(transFormData.amount) || 0) + commission).toFixed(2),
                          note: `${transFormData.note}${transFormData.note ? ' + ' : ''}عمولة مبيعات شهر ${transFormData.month} (${rate}%): ${commission.toFixed(2)}`,
                        })}
                        className="mr-auto bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-lg">
                        + أضف العمولة للراتب
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500">تُحسب على مبيعات هذا الشهر فقط؛ بعد صرف الشهر تبدأ مبيعات الشهر التالي من الصفر تلقائياً.</p>
                  </div>
                );
              })()}

              <div className="space-y-4">
                <p className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">تفاصيل الدفع (طرق الدفع)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {payKeys.map((k) => (
                    <div key={k}>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">{payLabelOf(storeSettings as any, k)}</label>
                      <input type="number" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 outline-none font-bold" value={(transFormData as any)['paid_' + k] || ''} onChange={e => setTransFormData({ ...transFormData, ['paid_' + k]: e.target.value })} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">ملاحظات</label>
                <textarea 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 h-20 outline-none font-medium resize-none"
                  value={transFormData.note}
                  onChange={e => setTransFormData({...transFormData, note: e.target.value})}
                  placeholder="اكتب ملاحظات إضافية..."
                />
              </div>

              <button 
                onClick={handleTransSubmit} 
                style={{ backgroundColor: transType === 'salary' ? '#059669' : transType === 'incentive' ? '#0284c7' : '#d97706' }} 
                className="w-full text-white py-5 rounded-2xl font-black text-lg shadow-xl hover:opacity-90 transition-all"
              >
                {editingTransaction ? 'حفظ التعديلات' : 'تأكيد العملية'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLeaveModal && selectedEmployee && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-8 text-white flex justify-between items-center shrink-0 bg-sky-600">
              <div>
                <h2 className="text-2xl font-black">{editingLeave ? 'تعديل إجازة' : 'إضافة إجازة / غياب'}</h2>
                <p className="text-white/70 text-sm mt-1">{selectedEmployee.name}</p>
              </div>
              <button onClick={() => { setShowLeaveModal(false); setEditingLeave(null); }} className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition text-white"><X size={24} /></button>
            </div>
            <div className="p-8 space-y-6 overflow-y-auto">
              {(() => {
                const daysCount = getDaysBetween(leaveFormData.start_date, leaveFormData.end_date);
                const balance = getLeaveBalanceStats(selectedEmployee, editingLeave?.id);
                const paidDays = leaveFormData.leave_type === 'paid' ? Math.min(daysCount, Math.max(0, balance.remaining)) : 0;
                const unpaidDays = leaveFormData.leave_type === 'paid' ? daysCount - paidDays : daysCount;
                const deduction = unpaidDays * (selectedEmployee.monthly_salary / 30);
                return (
                  <div className="bg-sky-50 rounded-2xl p-4 border border-sky-100 grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px] font-bold text-sky-500">الرصيد المتبقي</p>
                      <p className="text-lg font-black text-sky-700">{balance.remaining} يوم</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-500">مدة الإجازة</p>
                      <p className="text-lg font-black text-slate-800">{daysCount} يوم</p>
                      {leaveFormData.leave_type === 'paid' && unpaidDays > 0 && (
                        <p className="text-[10px] font-bold text-red-500 mt-1">{unpaidDays} يوم بخصم</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-red-500">خصم متوقع</p>
                      <p className="text-lg font-black text-red-600">{deduction.toLocaleString()} <span className="text-xs">{storeSettings.currency}</span></p>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">من تاريخ</label>
                  <input
                    type="date"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 outline-none font-bold"
                    value={leaveFormData.start_date}
                    onChange={e => setLeaveFormData({...leaveFormData, start_date: e.target.value, end_date: leaveFormData.end_date < e.target.value ? e.target.value : leaveFormData.end_date})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">إلى تاريخ</label>
                  <input
                    type="date"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 outline-none font-bold"
                    value={leaveFormData.end_date}
                    min={leaveFormData.start_date}
                    onChange={e => setLeaveFormData({...leaveFormData, end_date: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">نوع الإجازة</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setLeaveFormData({...leaveFormData, leave_type: 'paid'})}
                    className={`py-4 rounded-2xl font-black border transition ${leaveFormData.leave_type === 'paid' ? 'bg-sky-600 text-white border-sky-600' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                  >
                    من الرصيد
                  </button>
                  <button
                    onClick={() => setLeaveFormData({...leaveFormData, leave_type: 'unpaid'})}
                    className={`py-4 rounded-2xl font-black border transition ${leaveFormData.leave_type === 'unpaid' ? 'bg-red-600 text-white border-red-600' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                  >
                    بخصم مرتب
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">ملاحظات</label>
                <textarea
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 h-24 outline-none font-medium resize-none"
                  value={leaveFormData.note}
                  onChange={e => setLeaveFormData({...leaveFormData, note: e.target.value})}
                  placeholder="سبب الإجازة أو ملاحظة داخل سجل الغياب"
                />
              </div>

              <button onClick={handleLeaveSubmit} className="w-full text-white py-5 rounded-2xl font-black text-lg shadow-xl hover:opacity-90 transition-all bg-sky-600">
                {editingLeave ? 'حفظ التعديلات' : 'تسجيل الإجازة'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
