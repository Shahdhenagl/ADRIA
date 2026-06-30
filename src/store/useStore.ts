import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { unitMinQty, unitStep } from '../utils/units';

// Effective unit price for the current invoice type (retail / half-wholesale / wholesale).
function priceForType(product: any, type: string): number {
  if (type === 'wholesale') return (product.wholesale_price && product.wholesale_price > 0) ? product.wholesale_price : product.sale_price;
  if (type === 'half') return (product.half_wholesale_price && product.half_wholesale_price > 0) ? product.half_wholesale_price : product.sale_price;
  return (product.discount_price && product.discount_price > 0) ? product.discount_price : product.sale_price;
}

// Creates/updates the Supabase Auth account for a cashier via the server
// endpoint (which holds the service-role key), so a cashier added from the
// admin panel can log in immediately. Best-effort: in local dev (no /api) or on
// failure it silently no-ops, and you can still run the provisioning script.
async function provisionCashierAuth(id: string, password: string, table?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) return { ok: false, error: 'لا توجد جلسة دخول حالية' };
    const res = await fetch('/api/provision-cashier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, password, table }),
    });
    if (res.ok) return { ok: true };
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    return { ok: false, error: msg };
  } catch (e) {
    console.warn('provisionCashierAuth failed:', e);
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

// ─── Types ───────────────────────────────────────────────────
export interface Product {
  id: string;
  name: string;
  barcode: string;
  purchase_price: number;
  average_purchase_price: number;
  sale_price: number;
  discount_price?: number; // سعر البيع بعد الخصم (قطاعي)
  wholesale_price?: number; // سعر الجملة
  half_wholesale_price?: number; // سعر نص الجملة
  season?: string; // 'summer' / 'winter'
  stock_quantity: number;
  display_quantity?: number; // الكمية المعروضة في المحل (الباقي في المستودع)
  factory_quantity?: number; // كمية مخزن المصنع (غير متاحة للبيع حتى تُحوَّل)
  category_id: string;
  unit: string; // وحدة المنتج: قطعة / كيلو / جرام / لتر ... (المخزون والسعر بهذه الوحدة)
  is_hidden?: boolean; // إخفاء المنتج من الكاشير دون حذفه
  color?: string; // لون المنتج (للملابس)
}

// ── التصنيع ──────────────────────────────────────────────────
export interface Material {
  id: string;
  name: string;
  unit: string;
  cost_per_unit: number;
  stock_quantity: number;
  supplier_id?: string; // المورد الذي تُشترى منه الخامة (اختياري)
  created_at?: string;
}

export interface ProductionOrder {
  id: string;
  product_id?: string;
  product_name: string;
  color?: string;
  code?: string;
  quantity: number;
  materials_cost: number;
  extra_costs: number;
  total_cost: number;
  cost_per_piece: number;
  sale_price: number;
  notes?: string;
  created_at?: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface OrderItem extends Product {
  quantity: number;
  returned_quantity: number;
  refunded_amount?: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  timestamp: string;
  custom_id?: string;
  card_number?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  created_at: string;
}

export interface Cashier {
  id: string;
  name: string;
  password?: string;
  pin?: string;
  phone: string;
  photo_url: string;
  created_at: string;
  /** Supabase Auth email used to sign this cashier in (set by the provisioning script). */
  email?: string;
}

export interface PurchaseItem {
  id?: string;
  product_id: string;
  quantity: number;
  purchase_price: number;
}

export interface PurchaseInvoice {
  id: string;
  invoice_number: string;
  supplier_id: string;
  total: number;
  paid_amount: number;
  paid_cash: number;
  paid_visa: number;
  paid_wallet: number;
  paid_instapay: number;
  paid_method5?: number;
  paid_method6?: number;
  payment_method: 'cash' | 'visa' | 'wallet' | 'instapay' | 'method5' | 'method6';
  created_at: string;
  notes?: string;
  items?: PurchaseItem[];
}

export interface Order {
  id: string;
  items: OrderItem[];
  total: number;
  paid_amount: number;
  paid_cash: number;
  paid_visa: number;
  paid_wallet: number;
  paid_instapay: number;
  paid_method5?: number;
  paid_method6?: number;
  type: 'sale' | 'payment' | 'previous_debt';
  date: string;
  payment_method: 'cash' | 'visa' | 'wallet' | 'instapay' | 'method5' | 'method6';
  refund_method?: string;
  customer?: Customer;
  cashier_name?: string;
  salesperson_id?: string; // الموظف البائع (لحساب مبيعاته/أرباحه للعمولة)
  salesperson_name?: string;
  isOffline?: boolean;
  is_deleted?: boolean;
  deleted_at?: string | null;
  deletion_reason?: string | null;
  notes?: string | null;
  coupon_code?: string | null;
  discount_amount?: number;
  car_id?: string;
  exchange_data?: any; // بيانات الاستبدال: { before, after, oldTotal, newTotal, diff, method, date }
}

// فاتورة معلقة / محجوزة: تحجز الكمية من المخزون دون تسجيل بيع، ويمكن لاحقاً
// تأكيد البيع (تُحمَّل في الكاشير وتُكمَّل) أو إرجاعها للمخزون. تُرجَّع تلقائياً
// للمخزون بعد أسبوع إن لم يُتَّخذ إجراء.
export interface HeldInvoiceItem {
  id: string;
  name: string;
  barcode?: string;
  quantity: number;
  sale_price: number;
  purchase_price?: number;
  average_purchase_price?: number;
  unit?: string;
  category_id?: string;
}

export interface HeldInvoice {
  id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_custom_id?: string | null;
  items: HeldInvoiceItem[];
  total: number;
  invoice_type: 'retail' | 'half' | 'wholesale';
  salesperson_id?: string | null;
  salesperson_name?: string | null;
  cashier_name?: string | null;
  notes?: string | null;
  created_at: string;
  expires_at: string;
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  paid_cash: number;
  paid_visa: number;
  paid_wallet: number;
  paid_instapay: number;
  paid_method5?: number;
  paid_method6?: number;
  note: string;
  payment_method: 'cash' | 'visa' | 'wallet' | 'instapay' | 'method5' | 'method6';
  date: string;
  car_id?: string;
}

export interface CarSubscription {
  id: string;
  car_number: string;
  car_details: string;
  customer_name: string;
  customer_phone: string;
  created_at: string;
  status?: 'active' | 'inactive';
  subscription_duration_months?: number;
  subscription_frequency_days?: number;
}

export interface MaintenanceAppointment {
  id: string;
  subscription_id: string;
  appointment_date: string;
  description: string;
  report: string;
  cost: number;
  status: 'pending' | 'completed';
  is_reminded: boolean;
  created_at: string;
}

export interface FinancingAccount {
  id: string;
  type: 'loan' | 'association';
  lender_name: string;
  lender_phone: string;
  lender_details: string;
  description: string;
  principal_amount: number;
  collection_amount: number;
  collection_date: string;
  installment_count: number;
  status: 'open' | 'closed';
  created_at: string;
}

export interface FinancingPayment {
  id: string;
  account_id: string;
  payment_type: 'collection' | 'repayment';
  due_date: string;
  amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: 'pending' | 'paid';
  paid_at?: string | null;
  expense_id?: string | null;
  note?: string | null;
}

export interface FinancingTransaction {
  id: string;
  account_id: string;
  payment_id: string;
  transaction_type: 'collection' | 'repayment';
  amount: number;
  remaining_after: number;
  payment_method: 'cash' | 'visa' | 'wallet' | 'instapay';
  expense_id?: string | null;
  note?: string | null;
  created_at: string;
}

export interface StoreSettings {
  name: string;
  currency: string;
  logo: string;
  taxRate: number;
  themeColor: string;
  address: string;
  phone: string;
  phone2: string;
  whatsappCountryCode: string;
  initial_balance: number;
  locationUrl?: string;
  cashierPermissions?: Record<string, boolean>; // صلاحيات الكاشير (إظهار/إخفاء مميزات)
  paymentLabels?: Record<string, string>; // تسميات وسائل الدفع (كاش/فيزا/محفظة/انستا/طريقة5/طريقة6)
  paymentMethodsEnabled?: Record<string, boolean>; // تفعيل طرق الدفع الإضافية (method5/method6)
  showInvoiceProfit?: boolean; // إظهار ربح الفاتورة في شاشة الكاشير
  allowCashierEmployeeAdvance?: boolean; // السماح للكاشير بصرف سلف للموظفين (افتراضياً مغلق)
}

export interface Employee {
  id: string;
  name: string;
  job_title: string;
  phone: string;
  working_hours: string;
  monthly_salary: number;
  annual_leave_balance: number;
  hire_date: string;
  is_active: boolean;
  created_at: string;
  cashier_id?: string; // ربط الموظف بحساب الكاشير
  commission_rate?: number; // نسبة عمولة المبيعات % (للمحاسبين)
}

export interface EmployeeTransaction {
  id: string;
  employee_id: string;
  amount: number;
  type: 'salary' | 'advance' | 'incentive';
  payment_method: 'cash' | 'visa' | 'wallet' | 'instapay' | 'method5' | 'method6';
  paid_cash: number;
  paid_visa: number;
  paid_wallet: number;
  paid_instapay: number;
  paid_method5?: number;
  paid_method6?: number;
  month: string;
  deductions: number;
  note: string;
  created_at: string;
}

export interface EmployeeLeave {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  days_count: number;
  leave_type: 'paid' | 'unpaid';
  deduction_amount: number;
  month: string;
  note: string;
  created_at: string;
}

export interface ProductSuggestion {
  id: string;
  name: string;
  notes?: string;
  is_purchased: boolean;
  created_at: string;
}

export interface Coupon {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  start_date: string | null;
  end_date: string | null;
  max_uses_per_customer: number | null;
  max_uses_total: number | null;
  used_count: number;
  is_active: boolean;
  created_at: string;
}

export interface CashierNote {
  id: string;
  cashier_name: string;
  note: string;
  is_read: boolean;
  created_at: string;
}

export interface AdminUser {
  id: string;
  name: string;
  password?: string;
  email?: string;
  permissions: string[]; // مسارات الصفحات المسموح بها
  created_at?: string;
}

// ─── Store Interface ──────────────────────────────────────────
interface CashierStore {
  storeSettings: StoreSettings;
  products: Product[];
  categories: Category[];
  customers: Customer[];
  suppliers: Supplier[];
  cashiers: Cashier[];
  materials: Material[];
  productionOrders: ProductionOrder[];
  cart: OrderItem[];
  invoiceType: 'retail' | 'half' | 'wholesale';
  salesperson: { id: string; name: string } | null;
  orders: Order[];
  expenses: Expense[];
  financingAccounts: FinancingAccount[];
  financingPayments: FinancingPayment[];
  financingTransactions: FinancingTransaction[];
  purchaseInvoices: PurchaseInvoice[];
  coupons: Coupon[];
  invoiceCounter: number;
  activeInvoiceId: string;
  isLoading: boolean;
  dbError: string | null;
  activeCashier: Cashier | null;
  employees: Employee[];
  employeeTransactions: EmployeeTransaction[];
  employeeLeaves: EmployeeLeave[];
  productSuggestions: ProductSuggestion[];
  cashierNotes: CashierNote[];
  carSubscriptions: CarSubscription[];
  maintenanceAppointments: MaintenanceAppointment[];

  // Data loading
  loadAll: (silent?: boolean) => Promise<void>;
  loadSettingsOnly: () => Promise<void>;
  loadProductsOnly: () => Promise<void>;

  // Cart
  addToCart: (product: Product) => void;
  addToCartQty: (product: Product, quantity: number) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updatePrice: (productId: string, price: number) => void;
  clearCart: () => void;
  setInvoiceType: (t: 'retail' | 'half' | 'wholesale') => void;
  setSalesperson: (sp: { id: string; name: string } | null) => void;

  // Operations
  checkout: (
    total: number, 
    customerDetails?: { name: string; phone: string; custom_id?: string }, 
    paidAmount?: number, 
    type?: 'sale' | 'payment' | 'previous_debt', 
    paymentMethod?: string,
    splitPayments?: { cash: number; visa: number; wallet: number; instapay: number; method5?: number; method6?: number },
    cashierName?: string,
    notes?: string,
    couponCode?: string,
    discountAmount?: number,
    carId?: string
  ) => Promise<string>;
  payInvoiceDebt: (
    invoiceId: string, 
    customerId: string, 
    amount: number, 
    splitPayments?: { cash: number; visa: number; wallet: number; instapay: number; method5?: number; method6?: number },
    paymentMethod?: string,
    discount?: number
  ) => Promise<string | null | void>;
  processReturn: (orderId: string, returns: { productId: string, returnQty: number, refundAmount: number, debtDeduction?: number }[], refundMethod?: string) => Promise<boolean>;
  deleteOrder: (orderId: string, reason?: string) => Promise<boolean>;
  editOrder: (orderId: string, updatedData: Partial<Order>, updatedItems: OrderItem[], reason: string) => Promise<boolean>;
  markOrderExchanged: (orderId: string, exchangeData: any) => Promise<boolean>;

  // Held / reserved invoices (فواتير معلقة)
  heldInvoices: HeldInvoice[];
  loadHeldInvoices: () => Promise<void>;
  holdInvoice: (data: {
    customerName?: string;
    customerPhone?: string;
    customerCustomId?: string;
    notes?: string;
  }) => Promise<boolean>;
  confirmHeldInvoice: (id: string) => Promise<HeldInvoice | null>;
  returnHeldInvoice: (id: string) => Promise<boolean>;
  sweepExpiredHeldInvoices: () => Promise<void>;

  // Admin
  loadAnalyticsData: (startDate?: string, endDate?: string) => Promise<Order[]>;
  updateSettings: (settings: Partial<StoreSettings>) => Promise<void>;
  addProduct: (product: Omit<Product, 'id'>) => Promise<Product | undefined>;
  updateProduct: (id: string, product: Partial<Product>) => Promise<void>;
  adjustStock: (items: { product_id: string; counted_qty: number }[], note?: string) => Promise<number>;
  deleteProduct: (id: string) => Promise<void>;
  
  // Expenses
  addExpense: (expense: Omit<Expense, 'id' | 'date'>) => Promise<void>;
  managerWithdraw: (managerName: string, split: { cash: number; visa: number; wallet: number; instapay: number; method5?: number; method6?: number }) => Promise<boolean>;
  recordPartnerTransaction: (tx: { partner_id: string; partner_name: string; type: 'deposit' | 'withdraw'; amount: number; treasury: 'shop' | 'main'; method: string; note?: string }) => Promise<boolean>;
  savingsTransfer: (split: { cash: number; visa: number; wallet: number; instapay: number; method5?: number; method6?: number }, direction: 'in' | 'out', source: string, note?: string) => Promise<boolean>;
  updateExpense: (id: string, expense: Partial<Expense>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;

  // Financing
  loadFinancing: () => Promise<void>;
  addFinancingAccount: (
    account: Omit<FinancingAccount, 'id' | 'status' | 'created_at'>,
    repayments: { due_date: string; amount: number; note?: string }[]
  ) => Promise<void>;
  settleFinancingPayment: (paymentId: string, amount?: number, paymentMethod?: 'cash' | 'visa' | 'wallet' | 'instapay') => Promise<void>;

  // Suppliers
  addSupplier: (supplier: Omit<Supplier, 'id' | 'created_at'>) => Promise<Supplier | null>;
  updateSupplier: (id: string, supplier: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;

  // Customers
  addCustomer: (customer: Omit<Customer, 'id' | 'timestamp'>) => Promise<Customer | null>;
  updateCustomer: (id: string, customer: Partial<Customer>) => Promise<void>;

  // Cashiers
  loadCashiers: () => Promise<void>;
  loadPosLoginData: () => Promise<void>;
  addCashier: (cashier: Omit<Cashier, 'id' | 'created_at'>) => Promise<void>;
  updateCashier: (id: string, cashier: Partial<Cashier>) => Promise<void>;
  deleteCashier: (id: string) => Promise<void>;

  // Manufacturing
  loadManufacturing: () => Promise<void>;
  addMaterial: (m: Omit<Material, 'id' | 'created_at'>, payment?: { supplierId?: string; split?: { cash: number; visa: number; wallet: number; instapay: number; method5?: number; method6?: number } }) => Promise<void>;
  updateMaterial: (id: string, m: Partial<Material>) => Promise<void>;
  deleteMaterial: (id: string) => Promise<void>;
  transferFromFactory: (productId: string, toDisplay: number, toWarehouse: number) => Promise<boolean>;
  addProductionOrder: (input: {
    product_name: string;
    color?: string;
    code?: string;
    quantity: number;
    sale_price: number;
    extra_costs: number;
    display_quantity?: number;
    warehouse_quantity?: number;
    extra_costs_split?: { cash: number; visa: number; wallet: number; instapay: number; method5?: number; method6?: number };
    notes?: string;
    materials: { material_id: string; quantity: number }[];
  }) => Promise<boolean>;
  deleteCashierNote: (id: string) => Promise<void>;

  // Coupons
  loadCoupons: () => Promise<void>;
  addCoupon: (coupon: Omit<Coupon, 'id' | 'created_at' | 'used_count'>) => Promise<void>;
  updateCoupon: (id: string, updates: Partial<Coupon>) => Promise<void>;
  deleteCoupon: (id: string) => Promise<void>;
  incrementCouponUsage: (code: string) => Promise<void>;

  // Employees
  loadEmployees: () => Promise<void>;
  addEmployee: (employee: Omit<Employee, 'id' | 'created_at'>) => Promise<void>;
  updateEmployee: (id: string, employee: Partial<Employee>) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;
  addEmployeeTransaction: (transaction: Omit<EmployeeTransaction, 'id' | 'created_at'>) => Promise<void>;
  updateEmployeeTransaction: (id: string, transaction: Partial<Omit<EmployeeTransaction, 'id' | 'created_at'>>) => Promise<void>;
  deleteEmployeeTransaction: (id: string) => Promise<void>;
  addEmployeeLeave: (leave: Omit<EmployeeLeave, 'id' | 'created_at'>) => Promise<void>;
  updateEmployeeLeave: (id: string, leave: Partial<Omit<EmployeeLeave, 'id' | 'created_at'>>) => Promise<void>;
  deleteEmployeeLeave: (id: string) => Promise<void>;

  // Suggestions & Notes
  loadProductSuggestions: () => Promise<void>;
  addProductSuggestion: (name: string, notes?: string) => Promise<void>;
  markSuggestionAsPurchased: (id: string) => Promise<void>;
  deleteProductSuggestion: (id: string) => Promise<void>;
  loadCashierNotes: () => Promise<void>;
  addCashierNote: (cashierName: string, note: string) => Promise<void>;
  markCashierNoteAsRead: (id: string) => Promise<void>;

  // Purchases
  loadPurchaseInvoices: () => Promise<void>;
  addPurchaseInvoice: (
    invoice: Omit<PurchaseInvoice, 'id' | 'created_at' | 'items' | 'paid_cash' | 'paid_visa' | 'paid_wallet' | 'paid_instapay'>, 
    items: PurchaseItem[],
    splitPayments?: { cash: number; visa: number; wallet: number; instapay: number; method5?: number; method6?: number }
  ) => Promise<void>;
  updatePurchaseInvoice: (
    invoiceId: string,
    invoice: Omit<PurchaseInvoice, 'id' | 'created_at' | 'items' | 'paid_cash' | 'paid_visa' | 'paid_wallet' | 'paid_instapay'>, 
      items: PurchaseItem[],
    splitPayments?: { cash: number; visa: number; wallet: number; instapay: number; method5?: number; method6?: number }
  ) => Promise<void>;
  deletePurchaseInvoice: (id: string) => Promise<void>;
  paySupplierDebt: (supplierId: string, amount: number, splitPayments?: { cash: number; visa: number; wallet: number; instapay: number; method5?: number; method6?: number }) => Promise<void>;

  // Car Maintenance
  loadCarSubscriptions: () => Promise<void>;
  addCarSubscription: (subscription: Omit<CarSubscription, 'id' | 'created_at'>) => Promise<CarSubscription | undefined>;
  updateCarSubscription: (id: string, updates: Partial<CarSubscription>) => Promise<void>;
  deleteCarSubscription: (id: string) => Promise<void>;
  toggleCarSubscriptionStatus: (id: string, status: 'active' | 'inactive') => Promise<void>;
  addMaintenanceAppointment: (appointment: Omit<MaintenanceAppointment, 'id' | 'created_at' | 'status' | 'is_reminded' | 'report' | 'cost'>) => Promise<MaintenanceAppointment | undefined>;
  updateMaintenanceAppointment: (id: string, updates: Partial<MaintenanceAppointment>) => Promise<void>;
  generateSubscriptionAppointments: (carId: string, durationMonths: number, frequencyDays: number) => Promise<void>;
  completeMaintenanceAppointment: (
    appointmentId: string, 
    report: string, 
    items: { type: 'part' | 'labor', name: string, costPrice: number, salePrice: number }[],
    splitPayments?: { cash: number; visa: number; wallet: number; instapay: number; method5?: number; method6?: number },
    paymentMethod?: 'cash' | 'visa' | 'wallet' | 'instapay'
  ) => Promise<void>;
  completeAppointmentWithRegisteredTransactions: (appointmentId: string, cost: number, report: string) => Promise<void>;
  updateMaintenanceReminded: (appointmentId: string) => Promise<void>;
  deleteMaintenanceAppointment: (id: string) => Promise<void>;

  // Realtime
  setupRealtime: () => void;

  // Offline Sync
  offlineQueue: any[];
  offlineReturnsQueue: any[];
  isOnline: boolean;
  isSyncing: boolean;
  syncOfflineQueue: () => Promise<void>;
  syncOfflineReturnsQueue: () => Promise<void>;

  // Auth
  isAdminAuthenticated: boolean;
  isPOSAuthenticated: boolean;
  adminPermissions: string[] | null; // null = صلاحيات كاملة (المدير العام)
  login: (pin: string) => Promise<boolean>;
  loginAdminUser: (user: { email?: string; permissions?: string[] }, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  loginPOS: (name: string, password?: string) => Promise<boolean>;
  logoutPOS: () => Promise<void>;

  // Admin users (لوحة التحكم)
  adminUsers: AdminUser[];
  loadAdminUsers: () => Promise<void>;
  addAdminUser: (u: { name: string; password: string; permissions: string[] }) => Promise<void>;
  updateAdminUser: (id: string, u: Partial<AdminUser> & { password?: string }) => Promise<void>;
  deleteAdminUser: (id: string) => Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────
function mapSettings(row: Record<string, unknown>): StoreSettings {
  return {
    name: (row.name as string) ?? 'محلي',
    currency: (row.currency as string) ?? 'ج.م',
    logo: (row.logo as string) ?? '',
    taxRate: (row.tax_rate as number) ?? 0,
    themeColor: (row.theme_color as string) ?? '#4f46e5',
    address: (row.address as string) ?? '',
    phone: (row.phone as string) ?? '',
    phone2: (row.phone2 as string) ?? '',
    whatsappCountryCode: (row.whatsapp_country_code as string) ?? '2',
    initial_balance: (row.initial_balance as number) ?? 0,
    locationUrl: (row.location_url as string) ?? '',
    cashierPermissions: (row.cashier_permissions as Record<string, boolean>) ?? undefined,
    paymentLabels: (row.payment_labels as Record<string, string>) ?? undefined,
    paymentMethodsEnabled: (row.payment_methods_enabled as Record<string, boolean>) ?? undefined,
    showInvoiceProfit: (row.show_invoice_profit as boolean) ?? true,
    allowCashierEmployeeAdvance: (row.allow_cashier_employee_advance as boolean) ?? false,
  };
}

function isRefundedAmountSchemaError(error: unknown): boolean {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return message.includes('refunded_amount');
}

const LOW_STOCK_THRESHOLD = 3;

function getActorName(state: CashierStore): string {
  if (state.activeCashier?.name) return state.activeCashier.name;
  if (typeof sessionStorage !== 'undefined') {
    return sessionStorage.getItem('active_cashier_name') || 'مدير النظام';
  }
  return 'مدير النظام';
}

function getPublicInvoiceUrl(invoiceId: string): string {
  if (typeof window === 'undefined') return `https://cashier-branch3.vercel.app/view-invoice/${invoiceId}`;
  const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'https://cashier-branch3.vercel.app'
    : window.location.origin;
  return `${baseUrl}/view-invoice/${invoiceId}`;
}

async function sendTelegramAlert(payload: Record<string, unknown>) {
  if (typeof fetch === 'undefined') return;
  try {
    // Attach the current Supabase session token so the endpoint can verify the
    // caller is an authenticated staff member (enforced when REQUIRE_ALERT_AUTH
    // is set server-side — see SECURITY_SETUP.md).
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    await fetch('/api/telegram-alert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn('Telegram alert failed:', error);
  }
}

function notifyLowStock(
  beforeProducts: Product[],
  cartItems: OrderItem[],
  afterProducts: Product[],
  actor: string,
  currency: string
) {
  const affected = cartItems
    .map((item) => {
      const before = beforeProducts.find((product) => product.id === item.id);
      const after = afterProducts.find((product) => product.id === item.id);
      const previousQuantity = Number(before?.stock_quantity ?? 0);
      const currentQuantity = Number(after?.stock_quantity ?? previousQuantity);
      return {
        name: item.name,
        previous_quantity: previousQuantity,
        moved_quantity: Number(item.quantity) || 0,
        stock_quantity: currentQuantity,
        threshold: LOW_STOCK_THRESHOLD,
      };
    })
    .filter((product) =>
      product.stock_quantity <= LOW_STOCK_THRESHOLD &&
      product.previous_quantity > LOW_STOCK_THRESHOLD
    );

  if (affected.length === 0) return;
  sendTelegramAlert({
    type: 'stock_low',
    actor,
    currency,
    products: affected,
  });
}

const getSplits = (split: any, method: string, amount: number) => {
  const cash = Number(split?.cash) || 0;
  const visa = Number(split?.visa) || 0;
  const wallet = Number(split?.wallet) || 0;
  const instapay = Number(split?.instapay) || 0;
  const method5 = Number(split?.method5) || 0;
  const method6 = Number(split?.method6) || 0;
  if (cash + visa + wallet + instapay + method5 + method6 > 0) {
    return { cash, visa, wallet, instapay, method5, method6 };
  }
  return {
    cash: method === 'cash' ? amount : 0,
    visa: method === 'visa' ? amount : 0,
    wallet: method === 'wallet' ? amount : 0,
    instapay: method === 'instapay' ? amount : 0,
    method5: method === 'method5' ? amount : 0,
    method6: method === 'method6' ? amount : 0,
  };
};


// ─── Store ───────────────────────────────────────────────────
export const useStore = create<CashierStore>((set, get) => ({
  storeSettings: {
    name: 'ADRIA',
    currency: 'ج.م',
    logo: '',
    taxRate: 0,
    themeColor: '#4f46e5',
    address: '',
    phone: '',
    phone2: '',
    whatsappCountryCode: '2',
    initial_balance: 0,
    locationUrl: '',
    allowCashierEmployeeAdvance: false,
  },
  products: [],
  categories: [],
  customers: [],
  suppliers: [],
  cashiers: [],
  materials: [],
  productionOrders: [],
  cart: [],
  invoiceType: 'retail',
  salesperson: null,
  setSalesperson: (sp) => set({ salesperson: sp }),
  orders: [],
  expenses: [],
  financingAccounts: [],
  financingPayments: [],
  financingTransactions: [],
  purchaseInvoices: [],
  employees: [],
  employeeTransactions: [],
  employeeLeaves: [],
  productSuggestions: [],
  cashierNotes: [],
  coupons: [],
  carSubscriptions: [],
  maintenanceAppointments: [],
  heldInvoices: [],
  invoiceCounter: 1,
  activeInvoiceId: '1',
  isLoading: false,
  dbError: null,
  offlineQueue: typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cashier_offline_queue') || '[]') : [],
  offlineReturnsQueue: typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cashier_offline_returns_queue') || '[]') : [],
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  activeCashier: null,
  isAdminAuthenticated: !!sessionStorage.getItem('cashier_admin_auth'),
  adminPermissions: (() => { try { const v = sessionStorage.getItem('admin_permissions'); return v ? JSON.parse(v) : null; } catch { return null; } })(),
  adminUsers: [],
  isPOSAuthenticated: !!sessionStorage.getItem('cashier_pos_auth'),

  // Admin login: authenticates against Supabase Auth using a fixed admin
  // account. The "PIN" the admin types is their Supabase password. The admin
  // email is configured via VITE_ADMIN_EMAIL and the account is created by the
  // provisioning script (see SECURITY_SETUP.md).
  login: async (pin: string) => {
    const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
    if (!adminEmail) {
      console.error('VITE_ADMIN_EMAIL is not configured. Run the security setup (SECURITY_SETUP.md).');
      return false;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: adminEmail, password: pin });
    if (error) return false;
    sessionStorage.setItem('cashier_admin_auth', 'true');
    sessionStorage.removeItem('admin_permissions'); // المدير العام = صلاحيات كاملة
    set({ isAdminAuthenticated: true, adminPermissions: null });
    // Reload data now that we have an authenticated session (under RLS, the
    // initial anon load returns nothing).
    await get().loadAll(true);
    return true;
  },

  // دخول مستخدم لوحة تحكم بصلاحيات محددة
  loginAdminUser: async (user, password) => {
    if (!user?.email) return false;
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
    if (error) return false;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    sessionStorage.setItem('cashier_admin_auth', 'true');
    sessionStorage.setItem('admin_permissions', JSON.stringify(perms));
    set({ isAdminAuthenticated: true, adminPermissions: perms });
    await get().loadAll(true);
    return true;
  },

  loadAdminUsers: async () => {
    const { data } = await supabase.from('admin_users').select('*').order('name');
    if (data) set({ adminUsers: (data as unknown as AdminUser[]) });
  },

  addAdminUser: async ({ name, password, permissions }) => {
    const { data, error } = await supabase.from('admin_users').insert({ name, password, permissions }).select().single();
    if (error) { alert('تعذّر حفظ المستخدم: ' + error.message); return; }
    const row = data as unknown as AdminUser;
    const r = await provisionCashierAuth(row.id, password, 'admin_users');
    if (r.ok) row.email = `admin-${row.id}@admin.local`;
    else alert('تم حفظ المستخدم، لكن تعذّر إنشاء حساب الدخول:\n' + (r.error || '') + '\nتأكد من SUPABASE_SERVICE_ROLE_KEY على Vercel ثم عدّل الباسورد.');
    set((s) => ({ adminUsers: [row, ...s.adminUsers] }));
  },

  updateAdminUser: async (id, u) => {
    await supabase.from('admin_users').update({ name: u.name, password: u.password, permissions: u.permissions }).eq('id', id);
    if (u.password) {
      const r = await provisionCashierAuth(id, u.password, 'admin_users');
      if (!r.ok) alert('تم التعديل، لكن تعذّر تحديث حساب الدخول: ' + (r.error || ''));
    }
    set((s) => ({ adminUsers: s.adminUsers.map((x) => (x.id === id ? { ...x, ...u } : x)) }));
  },

  deleteAdminUser: async (id) => {
    await supabase.from('admin_users').delete().eq('id', id);
    set((s) => ({ adminUsers: s.adminUsers.filter((x) => x.id !== id) }));
  },

  logout: async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem('cashier_admin_auth');
    sessionStorage.removeItem('admin_permissions');
    set({ isAdminAuthenticated: false, adminPermissions: null });
  },

  // Cashier login: each cashier is a Supabase Auth user (email set by the
  // provisioning script). Authentication is delegated to Supabase — passwords
  // are never compared in the browser.
  loginPOS: async (name, password) => {
    const { cashiers } = get();
    const cashier = cashiers.find(c => c.name === name);
    if (!cashier || !cashier.email) return false;
    const { error } = await supabase.auth.signInWithPassword({ email: cashier.email, password: password ?? '' });
    if (error) return false;
    sessionStorage.setItem('cashier_pos_auth', 'true');
    sessionStorage.setItem('active_cashier_name', cashier.name);
    set({ isPOSAuthenticated: true, activeCashier: cashier });
    // Reload data now that we have an authenticated session.
    await get().loadAll(true);
    return true;
  },

  // Loads only what the cashier login screen needs (store branding + cashier
  // names/emails) via a SECURITY DEFINER RPC, since the anon key can no longer
  // read the tables directly after the RLS lockdown.
  loadPosLoginData: async () => {
    const { data, error } = await supabase.rpc('get_pos_login_data');
    if (error || !data) return;
    const s = (data as any).settings || {};
    set((state) => ({
      cashiers: ((data as any).cashiers || []) as Cashier[],
      storeSettings: {
        ...state.storeSettings,
        name: s.name ?? state.storeSettings.name,
        currency: s.currency ?? state.storeSettings.currency,
        logo: s.logo ?? state.storeSettings.logo,
        themeColor: s.theme_color ?? state.storeSettings.themeColor,
      },
    }));
  },

  logoutPOS: async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem('cashier_pos_auth');
    sessionStorage.removeItem('active_cashier_name');
    set({ isPOSAuthenticated: false, activeCashier: null });
  },

  // ── Load all data from Supabase ────────────────────────────
  loadAll: async (silent = false) => {
    // silent = reload data in the background without toggling the full-screen
    // loader (which would unmount the Router and drop a pending navigate, e.g.
    // right after login). Used by login()/loginPOS().
    if (!silent) set({ isLoading: true, dbError: null });
    try {
      const [settingsRes, categoriesRes, productsRes, customersRes, ordersRes, counterRes, cashiersRes, employeesRes, employeeTransactionsRes, employeeLeavesRes] =
        await Promise.all([
          supabase.from('store_settings').select('*').limit(1).maybeSingle(),
          supabase.from('categories').select('*').order('name'),
          supabase.from('products').select('*').order('name'),
          supabase.from('customers').select('*').order('created_at', { ascending: false }),
          supabase
            .from('orders')
            .select('*, customers(*), order_items(*, products(*))')
            .order('created_at', { ascending: false })
            .limit(1000),
          supabase.from('invoice_counter').select('current_value').limit(1).maybeSingle(),
          supabase.from('cashiers').select('*').order('created_at', { ascending: false }),
          supabase.from('employees').select('*').order('created_at', { ascending: false }),
          supabase.from('employee_transactions').select('*').order('created_at', { ascending: false }),
          supabase.from('employee_leaves').select('*').order('created_at', { ascending: false }),
        ]);

      const settings = settingsRes.data ? mapSettings(settingsRes.data as Record<string, unknown>) : get().storeSettings;

      const customers: Customer[] = ((customersRes.data ?? []) as Record<string, unknown>[]).map((c) => ({
        id: c.id as string,
        name: c.name as string,
        phone: c.phone as string,
        custom_id: c.custom_id as string,
        card_number: c.card_number as string,
        timestamp: c.created_at as string,
      }));

      const orders: Order[] = ((ordersRes.data ?? []) as Record<string, unknown>[]).map((o) => {
        const custRow = o.customers as Record<string, unknown> | null;
        const itemRows = (o.order_items as Record<string, unknown>[]) ?? [];
        const items: OrderItem[] = itemRows.map((i) => {
          const prod = (i.products as Record<string, unknown>) ?? {};
          return {
            id: (i.product_id as string) ?? (i.id as string),
            name: (i.product_name as string) ?? (prod.name as string) ?? '',
            barcode: (prod.barcode as string) ?? '',
            purchase_price: (i.purchase_price as number) ?? (prod.average_purchase_price as number) ?? (prod.purchase_price as number) ?? 0,
            average_purchase_price: (i.purchase_price as number) ?? (prod.average_purchase_price as number) ?? (prod.purchase_price as number) ?? 0,
            sale_price: i.sale_price as number,
            stock_quantity: (prod.stock_quantity as number) ?? 0,
            category_id: (prod.category_id as string) ?? '',
            unit: (prod.unit as string) ?? 'قطعة',
            quantity: i.quantity as number,
            returned_quantity: (i.returned_quantity as number) ?? 0,
            refunded_amount: (i.refunded_amount as number) ?? 0,
          };
        });
        return {
          id: o.id as string,
          total: o.total as number,
          paid_amount: (o.paid_amount as number) ?? (o.total as number),
          paid_cash: (o.paid_cash as number) ?? 0,
          paid_visa: (o.paid_visa as number) ?? 0,
          paid_wallet: (o.paid_wallet as number) ?? 0,
          paid_instapay: (o.paid_instapay as number) ?? 0,
          paid_method5: (o.paid_method5 as number) ?? 0,
          paid_method6: (o.paid_method6 as number) ?? 0,
          type: (o.type as string) as 'sale' | 'payment' ?? 'sale',
          payment_method: (o.payment_method as any) ?? 'cash',
          refund_method: (o.refund_method as string) ?? undefined,
          date: o.created_at as string,
          items,
          cashier_name: (o.cashier_name as string) ?? undefined,
          salesperson_id: (o.salesperson_id as string) ?? undefined,
          salesperson_name: (o.salesperson_name as string) ?? undefined,
          exchange_data: (o.exchange_data as any) ?? undefined,
          is_deleted: Boolean(o.is_deleted),
          deleted_at: (o.deleted_at as string) ?? null,
          deletion_reason: (o.deletion_reason as string) ?? null,
          notes: o.notes as string | null,
          coupon_code: o.coupon_code as string | null,
          discount_amount: (o.discount_amount as number) ?? 0,
          customer: custRow
            ? { 
                id: custRow.id as string, 
                name: custRow.name as string, 
                phone: custRow.phone as string, 
                custom_id: custRow.custom_id as string,
                card_number: custRow.card_number as string,
                timestamp: custRow.created_at as string 
              }
            : undefined,
          car_id: o.car_id as string | undefined,
        };
      });

      const counter = (counterRes.data as Record<string, unknown> | null)?.current_value as number ?? 1;

        set({
        storeSettings: settings,
        categories: (categoriesRes.data ?? []) as Category[],
        products: (productsRes.data ?? []).map((p: any) => ({
          ...p,
          unit: p.unit ?? 'قطعة',
          average_purchase_price: p.average_purchase_price ?? p.purchase_price ?? 0
        })) as Product[],
        customers,
        orders,
        cashiers: (cashiersRes.data ?? []) as Cashier[],
        expenses: [], // Default to empty
        invoiceCounter: counter,
        activeInvoiceId: counter.toString(),
        isLoading: false,
        activeCashier: sessionStorage.getItem('active_cashier_name') 
          ? ((cashiersRes.data ?? []) as Cashier[]).find(c => c.name === sessionStorage.getItem('active_cashier_name')) || null
          : (sessionStorage.getItem('cashier_pos_auth') === 'true' ? { id: 'master', name: 'المدير', pin: '123456', phone: '', photo_url: '', created_at: '' } : null),
        employees: (employeesRes.data ?? []) as Employee[],
        employeeTransactions: (employeeTransactionsRes.data ?? []) as EmployeeTransaction[],
        employeeLeaves: (employeeLeavesRes.data ?? []) as EmployeeLeave[],
      });

      // Fetch expenses separately to avoid breaking the whole loadAll if the table is missing
      try {
        const { data: expData } = await supabase.from('expenses').select('*').order('created_at', { ascending: false });
        if (expData) {
          set({
            expenses: (expData as any[]).map(e => ({
              id: e.id,
              category: e.category,
              amount: e.amount,
              paid_cash: e.paid_cash || 0,
              paid_visa: e.paid_visa || 0,
              paid_wallet: e.paid_wallet || 0,
              paid_instapay: e.paid_instapay || 0,
              note: e.note,
              payment_method: e.payment_method ?? 'cash',
              date: e.created_at,
              car_id: e.car_id
            }))
          });
        }
      } catch (e) {
        console.error("Expenses table might not exist yet:", e);
      }

      try {
        const { data: supData } = await supabase.from('suppliers').select('*').order('created_at', { ascending: false });
        if (supData) {
          set({
            suppliers: (supData as any[]).map(s => ({
              ...s
            }))
          });
        }
      } catch (e) {
        console.error("Suppliers table might not exist yet:", e);
      }

      // Fetch purchase invoices
      get().loadPurchaseInvoices();
      get().loadFinancing();
      get().loadCarSubscriptions();
      get().loadProductSuggestions();
      get().loadCashierNotes();
      get().loadCoupons();
      get().loadHeldInvoices();
      // إرجاع الفواتير المعلقة المنتهية (أكثر من أسبوع) للمخزون تلقائياً.
      get().sweepExpiredHeldInvoices();

      // Setup Realtime subscriptions
      get().setupRealtime();

      // Sync settings across tabs
      const bc = new BroadcastChannel('cashier-sync');
      bc.onmessage = (msg) => {
        if (msg.data === 'sync_settings') {
          get().loadSettingsOnly();
        }
      };
    } catch (err) {
      set({ isLoading: false, dbError: String(err) });
    }
  },

  loadSettingsOnly: async () => {
    try {
      const { data } = await supabase.from('store_settings').select('*').limit(1).maybeSingle();
      if (data) {
        set({ storeSettings: mapSettings(data as Record<string, unknown>) });
      }
    } catch(e) { console.error(e); }
  },

  loadProductsOnly: async () => {
    try {
      const { data, error } = await supabase.from('products').select('*').order('name');
      if (!error && data) {
        set({
          products: data.map((p: any) => ({
            ...p,
            unit: p.unit ?? 'قطعة',
            average_purchase_price: p.average_purchase_price ?? p.purchase_price ?? 0
          })) as Product[]
        });
      }
    } catch (e) {
      console.error("Error loading products only:", e);
    }
  },

  syncOfflineQueue: async () => {
    const state = get();
    if (state.isSyncing || state.offlineQueue.length === 0) return;

    set({ isSyncing: true });

    const queue = [...state.offlineQueue];
    const failedOrders = [];

    for (const offlineOrder of queue) {
      try {
        const { data: counterData, error: counterError } = await supabase
          .from('invoice_counter')
          .select('current_value')
          .eq('id', 1)
          .single();

        if (counterError || !counterData) {
          throw new Error("Could not fetch counter");
        }

        const realInvoiceId = (counterData as any).current_value.toString();
        const nextCounter = (counterData as any).current_value + 1;

        await supabase
          .from('invoice_counter')
          .update({ current_value: nextCounter })
          .eq('id', 1);

        let customerId: string | null = null;
        let finalCustomer = offlineOrder.customer;

        if (finalCustomer) {
          const phone = finalCustomer.phone?.trim();
          const custom_id = finalCustomer.custom_id?.trim();
          
          let existingCust = null;
          if (phone || custom_id) {
            const orQuery = [];
            if (phone) orQuery.push(`phone.eq.${phone}`);
            if (custom_id) orQuery.push(`custom_id.eq.${custom_id}`);
            const { data } = await supabase
              .from('customers')
              .select('*')
              .or(orQuery.join(','))
              .maybeSingle();
            existingCust = data;
          }

          if (existingCust) {
            customerId = existingCust.id;
            finalCustomer = {
              id: existingCust.id,
              name: existingCust.name,
              phone: existingCust.phone,
              custom_id: existingCust.custom_id,
              card_number: existingCust.card_number,
              timestamp: existingCust.created_at
            };
          } else {
            const { data: newCust } = await supabase
              .from('customers')
              .insert({ 
                name: finalCustomer.name || 'بدون اسم', 
                phone: phone || null, 
                custom_id: custom_id || null
              })
              .select()
              .single();
            if (newCust) {
              customerId = (newCust as any).id;
              finalCustomer = {
                id: customerId!,
                name: (newCust as any).name,
                phone: (newCust as any).phone,
                custom_id: (newCust as any).custom_id,
                card_number: (newCust as any).card_number,
                timestamp: (newCust as any).created_at
              };
            }
          }
        }

        const { error: orderError } = await supabase.from('orders').insert({ 
          id: realInvoiceId, 
          total: offlineOrder.total, 
          paid_amount: offlineOrder.paid_amount,
          paid_cash: offlineOrder.paid_cash,
          paid_visa: offlineOrder.paid_visa,
          paid_wallet: offlineOrder.paid_wallet,
          paid_instapay: offlineOrder.paid_instapay,
          type: offlineOrder.type,
          customer_id: customerId,
          payment_method: offlineOrder.payment_method,
          cashier_name: offlineOrder.cashier_name,
          salesperson_id: offlineOrder.salesperson_id || null,
          salesperson_name: offlineOrder.salesperson_name || null,
          coupon_code: offlineOrder.coupon_code || null,
          discount_amount: offlineOrder.discount_amount || 0,
          created_at: offlineOrder.date
        });

        if (orderError) throw orderError;

        const itemsPayload = offlineOrder.items.map((item: any) => ({
          order_id: realInvoiceId,
          product_id: item.id,
          product_name: item.name,
          barcode: item.barcode,
          quantity: item.quantity,
          returned_quantity: item.returned_quantity || 0,
          refunded_amount: item.refunded_amount || 0,
          sale_price: item.sale_price,
          purchase_price: item.average_purchase_price || item.purchase_price || 0,
        }));
        const { error: itemsError } = await supabase.from('order_items').insert(itemsPayload);
        if (itemsError) {
          console.error("Sync Order Items Error:", itemsError);
          throw itemsError;
        }

        for (const item of offlineOrder.items) {
          const { data: prodData } = await supabase.from('products').select('stock_quantity').eq('id', item.id).single();
          const currentStock = prodData?.stock_quantity ?? 0;
          const netQty = item.quantity - (item.returned_quantity || 0);
          await supabase.from('products').update({ stock_quantity: Math.max(0, currentStock - netQty) }).eq('id', item.id);
        }

        set((s) => ({
          orders: s.orders.map(o => o.id === offlineOrder.id ? { ...o, id: realInvoiceId, customer: finalCustomer || undefined, isOffline: false } : o)
        }));

      } catch (err) {
        console.error("Failed to sync offline order:", offlineOrder.id, err);
        failedOrders.push(offlineOrder);
      }
    }

    localStorage.setItem('cashier_offline_queue', JSON.stringify(failedOrders));
    set({
      offlineQueue: failedOrders,
      isSyncing: false
    });

    new BroadcastChannel('cashier-sync').postMessage('sync_products');
    get().syncOfflineReturnsQueue();
  },

  // ── Cart ───────────────────────────────────────────────────
  addToCart: (product) =>
    set((state) => {
      if (product.stock_quantity <= 0) return state;
      const step = unitStep(product.unit); // 1 للقطعة، 0.25 للوحدات الكسرية
      const existing = state.cart.find((i) => i.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock_quantity) return state;
        const next = Math.min(existing.quantity + step, product.stock_quantity);
        return { cart: state.cart.map((i) => (i.id === product.id ? { ...i, quantity: next } : i)) };
      }
      const first = Math.min(step, product.stock_quantity);
      const price = priceForType(product, state.invoiceType);
      return { cart: [...state.cart, { ...product, sale_price: price, quantity: first, returned_quantity: 0 }] };
    }),

  // إضافة منتج للسلة بكمية محددة (تُستخدم لإدخال الوزن من شاشة الكاشير)
  addToCartQty: (product, quantity) =>
    set((state) => {
      if (product.stock_quantity <= 0 || quantity <= 0) return state;
      const min = unitMinQty(product.unit);
      const existing = state.cart.find((i) => i.id === product.id);
      if (existing) {
        const next = Math.max(min, Math.min(existing.quantity + quantity, product.stock_quantity));
        return { cart: state.cart.map((i) => (i.id === product.id ? { ...i, quantity: next } : i)) };
      }
      const qty = Math.max(min, Math.min(quantity, product.stock_quantity));
      const price = priceForType(product, state.invoiceType);
      return { cart: [...state.cart, { ...product, sale_price: price, quantity: qty, returned_quantity: 0 }] };
    }),

  removeFromCart: (productId) => set((state) => ({ cart: state.cart.filter((i) => i.id !== productId) })),

  updateQuantity: (productId: string, quantity: number) =>
    set((state) => {
      const product = state.products.find((p) => p.id === productId);
      if (!product) return state;
      const validQty = Math.max(unitMinQty(product.unit), Math.min(quantity, product.stock_quantity));
      return { cart: state.cart.map((i) => (i.id === productId ? { ...i, quantity: validQty } : i)) };
    }),

  updatePrice: (productId, price) =>
    set((state) => ({
      cart: state.cart.map((i) => (i.id === productId ? { ...i, sale_price: price } : i))
    })),

  clearCart: () => set({ cart: [] }),

  // Switch pricing tier; re-price items already in the cart.
  setInvoiceType: (t) => set((state) => ({
    invoiceType: t,
    cart: state.cart.map((i) => {
      const prod = state.products.find((p) => p.id === i.id);
      return prod ? { ...i, sale_price: priceForType(prod, t) } : i;
    }),
  })),

  // ── Checkout ───────────────────────────────────────────────
  checkout: async (total, customerDetails, paidAmount = total, type = 'sale', paymentMethod = 'cash', splitPayments, cashierName, notes, couponCode, discountAmount, carId) => {
    const state = get();
    const finalCashierName = cashierName || state.activeCashier?.name || 'مدير النظام';
    const sp = state.salesperson;
    if (state.cart.length === 0 && type !== 'payment' && type !== 'previous_debt') return state.activeInvoiceId;

    const savedPaidAmount = type === 'payment' ? paidAmount : Math.min(total, paidAmount);

    const executeOfflineCheckout = () => {
      const offlineId = `OFF-${Date.now()}`;
      
      let customerId: string | null = null;
      let finalCustomer: Customer | undefined;
      
      if (customerDetails?.phone?.trim() || customerDetails?.custom_id?.trim() || customerDetails?.name?.trim()) {
        const phone = customerDetails.phone?.trim();
        const custom_id = customerDetails.custom_id?.trim();
        const name = customerDetails.name?.trim();
        
        const existing = state.customers.find((c) => 
          (phone && c.phone === phone) || 
          (custom_id && c.custom_id === custom_id) ||
          (!phone && !custom_id && name && c.name.trim().toLowerCase() === name.toLowerCase())
        );

        if (existing) {
          customerId = existing.id;
          finalCustomer = existing;
        } else {
          customerId = `OFF-CUST-${Date.now()}`;
          finalCustomer = {
            id: customerId,
            name: name || 'بدون اسم',
            phone: phone || '',
            custom_id: custom_id || '',
            timestamp: new Date().toISOString()
          };
        }
      }

      const splits = getSplits(splitPayments, paymentMethod, savedPaidAmount);
      const newOfflineOrder = {
        id: offlineId,
        total,
        paid_amount: savedPaidAmount,
        paid_cash: splits.cash,
        paid_visa: splits.visa,
        paid_wallet: splits.wallet,
        paid_instapay: splits.instapay,
        paid_method5: splits.method5 || 0,
        paid_method6: splits.method6 || 0,
        type,
        payment_method: paymentMethod as any,
        date: new Date().toISOString(),
        customer: finalCustomer,
        cashier_name: finalCashierName,
        salesperson_id: sp?.id || undefined,
        salesperson_name: sp?.name || undefined,
        notes: notes || null,
        coupon_code: couponCode || null,
        discount_amount: discountAmount || 0,
        car_id: carId || undefined,
        items: state.cart.map((i) => ({ ...i })),
        isOffline: true
      };

      const updatedQueue = [...state.offlineQueue, newOfflineOrder];
      localStorage.setItem('cashier_offline_queue', JSON.stringify(updatedQueue));

      const updatedProducts = state.products.map((p) => {
        const cartItem = state.cart.find((c) => c.id === p.id);
        return cartItem ? { ...p, stock_quantity: Math.max(0, p.stock_quantity - cartItem.quantity) } : p;
      });

      const updatedCustomers = finalCustomer && !state.customers.find((c) => c.id === finalCustomer!.id)
        ? [finalCustomer, ...state.customers]
        : state.customers;

      set({
        orders: [newOfflineOrder, ...state.orders],
        cart: [],
        invoiceType: 'retail',
        salesperson: null,
        products: updatedProducts,
        customers: updatedCustomers,
        offlineQueue: updatedQueue
      });

      return offlineId;
    };

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error("No network connectivity");
      }

      // 1. Get the LATEST counter value from DB right now (Atomic approach)
      const { data: counterData, error: counterError } = await supabase
        .from('invoice_counter')
        .select('current_value')
        .eq('id', 1)
        .single();

      if (counterError || !counterData) {
        throw new Error("Counter Fetch Error");
      }

      const invoiceId = (counterData as any).current_value.toString();
      const nextCounter = (counterData as any).current_value + 1;

      // 2. Increment counter in DB immediately to "lock" this number
      const { error: updateCounterError } = await supabase
        .from('invoice_counter')
        .update({ current_value: nextCounter })
        .eq('id', 1);

      if (updateCounterError) {
        console.error("Counter Update Error:", updateCounterError);
      }

      let customerId: string | null = null;
      let finalCustomer: Customer | undefined;

      // Upsert customer
      if (customerDetails?.phone?.trim() || customerDetails?.custom_id?.trim() || customerDetails?.name?.trim()) {
        const phone = customerDetails.phone?.trim();
        const custom_id = customerDetails.custom_id?.trim();
        const name = customerDetails.name?.trim();
        
        const existing = state.customers.find((c) => 
          (phone && c.phone === phone) || 
          (custom_id && c.custom_id === custom_id) ||
          (!phone && !custom_id && name && c.name.trim().toLowerCase() === name.toLowerCase())
        );

        if (existing) {
          customerId = existing.id;
          finalCustomer = existing;
          
          if (name && existing.name !== name) {
             await supabase.from('customers').update({ name }).eq('id', existing.id);
             existing.name = name;
          }
        } else {
          const { data: newCust } = await supabase
            .from('customers')
            .insert({ 
              name: name || 'بدون اسم', 
              phone: phone || null, 
              custom_id: custom_id || null
            })
            .select()
            .single();
          if (newCust) {
            customerId = (newCust as Record<string, unknown>).id as string;
            finalCustomer = {
              id: customerId,
              name: (newCust as Record<string, unknown>).name as string,
              phone: (newCust as Record<string, unknown>).phone as string,
              custom_id: (newCust as Record<string, unknown>).custom_id as string,
              card_number: (newCust as Record<string, unknown>).card_number as string,
              timestamp: (newCust as Record<string, unknown>).created_at as string,
            };
          }
        }
      }

      const splits = getSplits(splitPayments, paymentMethod, savedPaidAmount);
      // Insert order
      const { error: orderError } = await supabase.from('orders').insert({ 
        id: invoiceId, 
        total, 
        paid_amount: savedPaidAmount,
        paid_cash: splits.cash,
        paid_visa: splits.visa,
        paid_wallet: splits.wallet,
        paid_instapay: splits.instapay,
        paid_method5: splits.method5 || 0,
        paid_method6: splits.method6 || 0,
        type,
        customer_id: customerId,
        payment_method: paymentMethod,
        cashier_name: finalCashierName,
        salesperson_id: sp?.id || null,
        salesperson_name: sp?.name || null,
        notes: notes || null,
        coupon_code: couponCode || null,
        discount_amount: discountAmount || 0,
        car_id: carId || null
      });

      if (orderError) {
        console.error("Order Insert Error:", orderError);
        // If duplicate key, it means another cashier took the number in that millisecond.
        alert(`عذراً، رقم الفاتورة مستخدم حالياً (${invoiceId}). يرجى المحاولة مرة أخرى.`);
        return invoiceId;
      }

      // Insert order items
      const itemsPayload = state.cart.map((item) => ({
        order_id: invoiceId,
        product_id: item.id,
        product_name: item.name,
        barcode: item.barcode,
        quantity: item.quantity,
        returned_quantity: 0,
        sale_price: item.sale_price,
        purchase_price: item.average_purchase_price || item.purchase_price,
      }));
      const { error: itemsError } = await supabase.from('order_items').insert(itemsPayload);
      if (itemsError) {
        console.error("Order Items Insert Error:", itemsError);
      }

      // Update stock
      for (const item of state.cart) {
        const newQty = (state.products.find((p) => p.id === item.id)?.stock_quantity ?? 0) - item.quantity;
        await supabase.from('products').update({ stock_quantity: Math.max(0, newQty) }).eq('id', item.id);
      }

      // Build new order for local state
      const newOrder: Order = {
        id: invoiceId,
        items: state.cart.map((i) => ({ ...i })),
        total,
        paid_amount: savedPaidAmount,
        paid_cash: splits.cash,
        paid_visa: splits.visa,
        paid_wallet: splits.wallet,
        paid_instapay: splits.instapay,
        paid_method5: splits.method5 || 0,
        paid_method6: splits.method6 || 0,
        type,
        payment_method: paymentMethod as any,
        date: new Date().toISOString(),
        customer: finalCustomer,
        cashier_name: finalCashierName,
        salesperson_id: sp?.id,
        salesperson_name: sp?.name,
        notes: notes || null,
        car_id: carId || undefined
      };

      const updatedProducts = state.products.map((p) => {
        const cartItem = state.cart.find((c) => c.id === p.id);
        return cartItem ? { ...p, stock_quantity: Math.max(0, p.stock_quantity - cartItem.quantity) } : p;
      });

      const updatedCustomers = finalCustomer && !state.customers.find((c) => c.id === finalCustomer!.id)
        ? [finalCustomer, ...state.customers]
        : state.customers;

      set({
        orders: [newOrder, ...state.orders],
        cart: [],
        invoiceType: 'retail',
        salesperson: null,
        products: updatedProducts,
        customers: updatedCustomers,
        invoiceCounter: nextCounter,
        activeInvoiceId: nextCounter.toString(),
      });

      new BroadcastChannel('cashier-sync').postMessage('sync_products');
      sendTelegramAlert({
        type: type === 'payment' ? 'payment' : 'sale',
        actor: finalCashierName,
        salesperson: sp?.name || undefined,
        currency: state.storeSettings.currency,
        invoiceId,
        invoiceUrl: getPublicInvoiceUrl(invoiceId),
        customer: finalCustomer?.name || 'عميل نقدي',
        date: newOrder.date,
        total,
        paid: savedPaidAmount,
        paymentMethod,
        items: newOrder.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          sale_price: item.sale_price,
        })),
      });
      notifyLowStock(state.products, newOrder.items, updatedProducts, finalCashierName, state.storeSettings.currency);

      return invoiceId;
    } catch (err) {
      console.warn("Network offline or Supabase connection failed. Falling back to offline checkout:", err);
      return executeOfflineCheckout();
    }
  },

  // ── Held / reserved invoices (فواتير معلقة) ─────────────────
  loadHeldInvoices: async () => {
    try {
      const { data, error } = await supabase
        .from('held_invoices')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) {
        set({ heldInvoices: (data as any[]).map((h) => ({ ...h, items: Array.isArray(h.items) ? h.items : [] })) as HeldInvoice[] });
      }
    } catch (e) {
      console.error('Held invoices table might not exist yet:', e);
    }
  },

  // Saves the current cart as a held invoice and RESERVES the stock (deducts it
  // from products.stock_quantity, like a real sale) so the quantity can't be
  // sold twice. No invoice number is consumed until the sale is confirmed.
  holdInvoice: async ({ customerName, customerPhone, customerCustomId, notes } = {}) => {
    const state = get();
    if (state.cart.length === 0) return false;
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        alert('حفظ الفواتير المعلقة غير متاح بدون اتصال بالإنترنت.');
        return false;
      }
      const sp = state.salesperson;
      const total = state.cart.reduce((sum, i) => sum + i.sale_price * i.quantity, 0);
      const items: HeldInvoiceItem[] = state.cart.map((i) => ({
        id: i.id,
        name: i.name,
        barcode: i.barcode,
        quantity: i.quantity,
        sale_price: i.sale_price,
        purchase_price: i.purchase_price,
        average_purchase_price: i.average_purchase_price,
        unit: i.unit,
        category_id: i.category_id,
      }));

      const { data, error } = await supabase
        .from('held_invoices')
        .insert({
          customer_name: customerName?.trim() || null,
          customer_phone: customerPhone?.trim() || null,
          customer_custom_id: customerCustomId?.trim() || null,
          items,
          total,
          invoice_type: state.invoiceType,
          salesperson_id: sp?.id || null,
          salesperson_name: sp?.name || null,
          cashier_name: getActorName(state),
          notes: notes?.trim() || null,
        })
        .select()
        .single();

      if (error || !data) {
        console.error('Hold invoice error:', error);
        alert('تعذّر حفظ الفاتورة المعلقة: ' + (error?.message || 'خطأ غير معروف'));
        return false;
      }

      // Reserve stock.
      for (const item of state.cart) {
        const newQty = (state.products.find((p) => p.id === item.id)?.stock_quantity ?? 0) - item.quantity;
        await supabase.from('products').update({ stock_quantity: Math.max(0, newQty) }).eq('id', item.id);
      }

      const updatedProducts = state.products.map((p) => {
        const cartItem = state.cart.find((c) => c.id === p.id);
        return cartItem ? { ...p, stock_quantity: Math.max(0, p.stock_quantity - cartItem.quantity) } : p;
      });

      set({
        heldInvoices: [{ ...(data as any), items } as HeldInvoice, ...state.heldInvoices],
        products: updatedProducts,
        cart: [],
        invoiceType: 'retail',
        salesperson: null,
      });

      new BroadcastChannel('cashier-sync').postMessage('sync_products');
      return true;
    } catch (err) {
      console.error('Failed to hold invoice:', err);
      alert('تعذّر حفظ الفاتورة المعلقة.');
      return false;
    }
  },

  // تأكيد البيع: تُعاد الكمية المحجوزة للمخزون ويُحذف سجل الحجز، وتُحمَّل الأصناف
  // في السلة ليُكمل الكاشير عملية البيع والتحصيل والطباعة بشكل طبيعي (الكاشير
  // عند الإتمام يخصم الكمية من جديد، فالنتيجة الصافية لا تغيّر المخزون).
  confirmHeldInvoice: async (id) => {
    const state = get();
    const held = state.heldInvoices.find((h) => h.id === id);
    if (!held) return null;
    try {
      const { error } = await supabase.from('held_invoices').delete().eq('id', id);
      if (error) {
        console.error('Confirm held invoice delete error:', error);
        alert('تعذّر تأكيد الفاتورة المعلقة: ' + error.message);
        return null;
      }

      // Return the reserved stock so the upcoming checkout deducts it cleanly.
      for (const item of held.items) {
        const { data: prodData } = await supabase.from('products').select('stock_quantity').eq('id', item.id).single();
        const currentStock = (prodData as any)?.stock_quantity ?? 0;
        await supabase.from('products').update({ stock_quantity: currentStock + item.quantity }).eq('id', item.id);
      }

      const restoredProducts = state.products.map((p) => {
        const it = held.items.find((i) => i.id === p.id);
        return it ? { ...p, stock_quantity: p.stock_quantity + it.quantity } : p;
      });

      // Rebuild cart items from the held items + the latest product record.
      const cartItems: OrderItem[] = held.items.map((it) => {
        const prod = restoredProducts.find((p) => p.id === it.id);
        const base: any = prod ? { ...prod } : {
          id: it.id, name: it.name, barcode: it.barcode || '',
          purchase_price: it.purchase_price || 0,
          average_purchase_price: it.average_purchase_price || it.purchase_price || 0,
          sale_price: it.sale_price, stock_quantity: it.quantity,
          category_id: it.category_id || '', unit: it.unit || 'قطعة',
        };
        return { ...base, sale_price: it.sale_price, quantity: it.quantity, returned_quantity: 0 };
      });

      set({
        heldInvoices: state.heldInvoices.filter((h) => h.id !== id),
        products: restoredProducts,
        cart: cartItems,
        invoiceType: held.invoice_type || 'retail',
        salesperson: held.salesperson_id ? { id: held.salesperson_id, name: held.salesperson_name || '' } : null,
      });

      new BroadcastChannel('cashier-sync').postMessage('sync_products');
      return held;
    } catch (err) {
      console.error('Failed to confirm held invoice:', err);
      alert('تعذّر تأكيد الفاتورة المعلقة.');
      return null;
    }
  },

  // إرجاع للمخزون: تُعاد الكمية المحجوزة ويُحذف سجل الحجز.
  returnHeldInvoice: async (id) => {
    const state = get();
    const held = state.heldInvoices.find((h) => h.id === id);
    if (!held) return false;
    try {
      const { error } = await supabase.from('held_invoices').delete().eq('id', id);
      if (error) {
        console.error('Return held invoice error:', error);
        alert('تعذّر إرجاع الفاتورة للمخزون: ' + error.message);
        return false;
      }
      for (const item of held.items) {
        const { data: prodData } = await supabase.from('products').select('stock_quantity').eq('id', item.id).single();
        const currentStock = (prodData as any)?.stock_quantity ?? 0;
        await supabase.from('products').update({ stock_quantity: currentStock + item.quantity }).eq('id', item.id);
      }
      const restoredProducts = state.products.map((p) => {
        const it = held.items.find((i) => i.id === p.id);
        return it ? { ...p, stock_quantity: p.stock_quantity + it.quantity } : p;
      });
      set({
        heldInvoices: state.heldInvoices.filter((h) => h.id !== id),
        products: restoredProducts,
      });
      new BroadcastChannel('cashier-sync').postMessage('sync_products');
      return true;
    } catch (err) {
      console.error('Failed to return held invoice:', err);
      alert('تعذّر إرجاع الفاتورة للمخزون.');
      return false;
    }
  },

  // إرجاع تلقائي للفواتير المعلقة المنتهية (تجاوزت أسبوعاً) للمخزون. مستقل عن
  // الحالة المحلية حتى يعمل بشكل صحيح حتى لو سبق التحميل.
  sweepExpiredHeldInvoices: async () => {
    try {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('held_invoices')
        .select('*')
        .lt('expires_at', nowIso);
      if (error || !data || data.length === 0) return;

      for (const row of data as any[]) {
        const { error: delErr } = await supabase.from('held_invoices').delete().eq('id', row.id);
        if (delErr) { console.error('Sweep delete error:', delErr); continue; }
        const items = Array.isArray(row.items) ? row.items : [];
        for (const item of items) {
          const { data: prodData } = await supabase.from('products').select('stock_quantity').eq('id', item.id).single();
          const currentStock = (prodData as any)?.stock_quantity ?? 0;
          await supabase.from('products').update({ stock_quantity: currentStock + (item.quantity || 0) }).eq('id', item.id);
        }
      }

      const expiredIds = new Set((data as any[]).map((r) => r.id));
      const expiredItemQty = new Map<string, number>();
      for (const row of data as any[]) {
        const items = Array.isArray(row.items) ? row.items : [];
        for (const it of items) expiredItemQty.set(it.id, (expiredItemQty.get(it.id) || 0) + (it.quantity || 0));
      }
      set((s) => ({
        heldInvoices: s.heldInvoices.filter((h) => !expiredIds.has(h.id)),
        products: s.products.map((p) => expiredItemQty.has(p.id)
          ? { ...p, stock_quantity: p.stock_quantity + (expiredItemQty.get(p.id) || 0) }
          : p),
      }));
      new BroadcastChannel('cashier-sync').postMessage('sync_products');
    } catch (e) {
      console.error('Failed to sweep expired held invoices:', e);
    }
  },

  // ── Returns ────────────────────────────────────────────────
  payInvoiceDebt: async (invoiceId, customerId, amount, splitPayments, paymentMethod = 'cash', discount = 0) => {
    const state = get();
    const invoice = state.orders.find(o => o.id === invoiceId);
    if (!invoice) return;

    // Validate: don't accept more than what's owed
    const currentDebt = invoice.total - (invoice.paid_amount || 0);
    const totalReduction = amount + discount;
    if (totalReduction > currentDebt + 0.01) {
      alert(`إجمالي السداد والخصم (${totalReduction.toFixed(2)}) أكبر من المديونية المتبقية (${currentDebt.toFixed(2)})`);
      return;
    }

    try {
      const { supabase } = await import('../lib/supabase');
      
      // 1. Update the original invoice
      const newPaidAmount = Math.min(invoice.total, (invoice.paid_amount || 0) + totalReduction);
      const newDiscountAmount = (invoice.discount_amount || 0) + discount;
      const { error: updateError } = await supabase
        .from('orders')
        .update({ 
          paid_amount: newPaidAmount,
          discount_amount: newDiscountAmount
        })
        .eq('id', invoiceId);
        
      if (updateError) throw updateError;

      // 2. Insert a payment transaction
      const paymentId = `PAY-${Date.now()}`;
      const cashierName = state.activeCashier?.name || 'مدير النظام';
      const remainingDebt = invoice.total - newPaidAmount;
      const debtBefore = remainingDebt + totalReduction;
      const note = `سداد أجل للفاتورة رقم #${invoiceId}${invoice.notes ? ` | الوصف: ${invoice.notes}` : ''} | المديونية قبل: ${debtBefore.toFixed(2)} | المتبقي: ${remainingDebt.toFixed(2)}${discount > 0 ? ` | خصم/إكرامية: ${discount.toFixed(2)}` : ''}`;

      const splits = getSplits(splitPayments, paymentMethod, amount);
      const paymentOrder = {
        id: paymentId,
        total: 0,
        paid_amount: amount,
        paid_cash: splits.cash,
        paid_visa: splits.visa,
        paid_wallet: splits.wallet,
        paid_instapay: splits.instapay,
        paid_method5: splits.method5 || 0,
        paid_method6: splits.method6 || 0,
        type: 'payment',
        customer_id: customerId,
        payment_method: paymentMethod,
        cashier_name: cashierName,
        notes: note
      };

      const { error: insertError } = await supabase.from('orders').insert(paymentOrder);
      if (insertError) throw insertError;

      // Update local state
      const customer = state.customers.find(c => c.id === customerId);
      const newPaymentOrderObj: Order = {
        ...paymentOrder,
        items: [],
        type: 'payment',
        date: new Date().toISOString(),
        customer: customer,
        payment_method: paymentMethod as any
      };

      set({
        orders: [
          newPaymentOrderObj,
          ...state.orders.map(o => o.id === invoiceId ? { ...o, paid_amount: newPaidAmount } : o)
        ]
      });

      return paymentId;
    } catch (err) {
      console.error("Failed to pay invoice debt:", err);
      alert("حدث خطأ أثناء سداد المديونية.");
      return null;
    }
  },

  processReturn: async (orderId, returns, refundMethod = 'cash') => {
    const state = get();
    const orderIndex = state.orders.findIndex((o) => o.id === orderId);
    if (orderIndex === -1 || returns.length === 0) return false;

    const order = state.orders[orderIndex];

    const executeOfflineReturn = () => {
      let updatedItems = [...order.items];
      let updatedProducts = [...state.products];

      for (const ret of returns) {
        updatedItems = updatedItems.map((i) =>
          i.id === ret.productId ? { ...i, returned_quantity: i.returned_quantity + ret.returnQty, refunded_amount: (i.refunded_amount || 0) + ret.refundAmount } : i
        );
        updatedProducts = updatedProducts.map((p) =>
          p.id === ret.productId ? { ...p, stock_quantity: p.stock_quantity + ret.returnQty } : p
        );
      }

      // Handle paid_amount adjustments based on cash refunded
      const offlineRefundAmount = returns.reduce((sum, ret) => sum + (ret.refundAmount || 0), 0);
      const offlinePaidAmount = offlineRefundAmount > 0 
        ? (order.paid_amount || 0) - offlineRefundAmount
        : order.paid_amount;

      const updatedOrders = state.orders.map((o, idx) =>
        idx === orderIndex ? { ...o, items: updatedItems, paid_amount: offlinePaidAmount } : o
      );

      if (orderId.startsWith('OFF-')) {
        const updatedQueue = state.offlineQueue.map((o) => {
          if (o.id === orderId) {
            let oItems = [...o.items];
            for (const ret of returns) {
              oItems = oItems.map((i: any) =>
                i.id === ret.productId ? { ...i, returned_quantity: (i.returned_quantity || 0) + ret.returnQty, refunded_amount: (i.refunded_amount || 0) + ret.refundAmount } : i
              );
            }
            return {
              ...o,
              items: oItems,
            };
          }
          return o;
        });
        localStorage.setItem('cashier_offline_queue', JSON.stringify(updatedQueue));
        set({
          orders: updatedOrders,
          products: updatedProducts,
          offlineQueue: updatedQueue,
        });
      } else {
        const newOfflineReturn = {
          orderId,
          returns,
          date: new Date().toISOString(),
        };
        const updatedReturnsQueue = [...state.offlineReturnsQueue, newOfflineReturn];
        localStorage.setItem('cashier_offline_returns_queue', JSON.stringify(updatedReturnsQueue));
        set({
          orders: updatedOrders,
          products: updatedProducts,
          offlineReturnsQueue: updatedReturnsQueue,
        });
      }

      new BroadcastChannel('cashier-sync').postMessage('sync_products');
      return true;
    };

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error("No network connectivity");
      }

      let updatedItems = [...order.items];
      let updatedProducts = [...state.products];

      for (const ret of returns) {
        const itemIndex = updatedItems.findIndex(i => i.id === ret.productId);
        if (itemIndex === -1) continue;
        
        const item = updatedItems[itemIndex];
        const newReturnedQty = item.returned_quantity + ret.returnQty;
        const newRefundedAmt = (item.refunded_amount || 0) + ret.refundAmount;

        const orderItemRow = await supabase
          .from('order_items')
          .select('id')
          .eq('order_id', orderId)
          .eq('product_id', ret.productId)
          .single();

        if (!orderItemRow.error && orderItemRow.data) {
          const { error: updateError } = await supabase
            .from('order_items')
            .update({ returned_quantity: newReturnedQty, refunded_amount: newRefundedAmt })
            .eq('id', (orderItemRow.data as Record<string, unknown>).id as string);
            
          if (updateError) {
             throw updateError;
          }
        }

        const product = updatedProducts.find((p) => p.id === ret.productId);
        if (product) {
          const { error: prodError } = await supabase
            .from('products')
            .update({ stock_quantity: product.stock_quantity + ret.returnQty })
            .eq('id', ret.productId);
          if (prodError) throw prodError;
          
          updatedProducts = updatedProducts.map((p) =>
            p.id === ret.productId ? { ...p, stock_quantity: p.stock_quantity + ret.returnQty } : p
          );
        }

        updatedItems = updatedItems.map((i) =>
          i.id === ret.productId ? { ...i, returned_quantity: newReturnedQty, refunded_amount: newRefundedAmt } : i
        );
      }

      // Handle paid_amount adjustments based on cash refunded
      const totalRefundAmount = returns.reduce((sum, ret) => sum + (ret.refundAmount || 0), 0);
      let finalPaidAmount = order.paid_amount || 0;
      
      if (totalRefundAmount > 0) {
        finalPaidAmount = finalPaidAmount - totalRefundAmount;
        const { error: paidError } = await supabase
          .from('orders')
          .update({ paid_amount: finalPaidAmount })
          .eq('id', orderId);
        if (paidError) {
          console.error('Failed to update paid_amount for cash refund:', paidError);
        }
        // Record which method the cash was refunded through (best-effort: the
        // refund_method column may not exist yet on older databases).
        const { error: methodError } = await supabase
          .from('orders')
          .update({ refund_method: refundMethod })
          .eq('id', orderId);
        if (methodError) {
          console.warn('Could not store refund_method (column may be missing):', methodError.message);
        }
      }

      const updatedOrders = state.orders.map((o, idx) =>
        idx === orderIndex
          ? { ...o, items: updatedItems, paid_amount: finalPaidAmount, refund_method: totalRefundAmount > 0 ? refundMethod : o.refund_method }
          : o
      );

      set({ orders: updatedOrders, products: updatedProducts });
      new BroadcastChannel('cashier-sync').postMessage('sync_products');
      sendTelegramAlert({
        type: 'return',
        actor: getActorName(state),
        currency: state.storeSettings.currency,
        invoiceId: order.id,
        invoiceUrl: getPublicInvoiceUrl(order.id),
        customer: order.customer?.name || 'عميل نقدي',
        date: new Date().toISOString(),
        refundTotal: returns.reduce((sum, ret) => sum + (Number(ret.refundAmount) || 0), 0),
        items: returns.map((ret) => {
          const item = order.items.find((orderItem) => orderItem.id === ret.productId);
          return {
            name: item?.name || ret.productId,
            quantity: ret.returnQty,
            sale_price: item?.sale_price || 0,
            total: ret.refundAmount,
          };
        }),
      });
      return true;
    } catch (err) {
      if (isRefundedAmountSchemaError(err)) {
        console.error("Return failed because refunded_amount column is missing:", err);
        alert("لازم تحديث قاعدة البيانات أولاً: شغّل ملف update_refunded_amount_schema.sql في Supabase عشان مبلغ المرتجع المعدل يتحفظ صح.");
        return false;
      }
      console.warn("Network offline or Supabase return failed. Falling back to offline return:", err);
      return executeOfflineReturn();
    }
  },

  deleteOrder: async (orderId, reason) => {
    const state = get();
    const order = state.orders.find((o) => o.id === orderId);
    if (!order || order.is_deleted || order.isOffline) return false;

    const deletedAt = new Date().toISOString();
    const deletionReason = reason?.trim() || 'حذف يدوي من شاشة الفواتير';
    const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
    const stockRestores = order.type === 'sale'
      ? order.items
          .map((item) => ({
            productId: item.id,
            quantity: Math.max(0, (Number(item.quantity) || 0) - (Number(item.returned_quantity) || 0)),
          }))
          .filter((item) => item.quantity > 0 && isUUID(item.productId))
      : [];

    try {
      const { error: orderError } = await supabase
        .from('orders')
        .update({
          is_deleted: true,
          deleted_at: deletedAt,
          deletion_reason: deletionReason,
        })
        .eq('id', orderId);

      if (orderError) throw orderError;

      const updatedProducts = [...state.products];
      for (const item of stockRestores) {
        const productIndex = updatedProducts.findIndex((p) => p.id === item.productId);
        const localStock = productIndex >= 0 ? updatedProducts[productIndex].stock_quantity : 0;

        const { data: prodData } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', item.productId)
          .maybeSingle();

        const dbStock = (prodData?.stock_quantity ?? localStock) as number;
        const newStock = dbStock + item.quantity;
        const { error: productError } = await supabase
          .from('products')
          .update({ stock_quantity: newStock })
          .eq('id', item.productId);

        if (productError) throw productError;

        if (productIndex >= 0) {
          updatedProducts[productIndex] = {
            ...updatedProducts[productIndex],
            stock_quantity: localStock + item.quantity,
          };
        }
      }

      let updatedOrders = state.orders.map((o) =>
        o.id === orderId
          ? { ...o, is_deleted: true, deleted_at: deletedAt, deletion_reason: deletionReason }
          : o
      );

      if (order.type === 'payment' && order.notes?.includes('سداد أجل للفاتورة رقم #')) {
        const match = order.notes.match(/سداد أجل للفاتورة رقم #([\w-]+)/);
        if (match && match[1]) {
          const originalInvoiceId = match[1];
          const originalInvoice = state.orders.find(o => o.id === originalInvoiceId);
          if (originalInvoice) {
            const newPaidAmount = Math.max(0, (originalInvoice.paid_amount || 0) - (order.paid_amount || 0));
            
            const { error: invoiceUpdateError } = await supabase
              .from('orders')
              .update({ paid_amount: newPaidAmount })
              .eq('id', originalInvoiceId);
              
            if (invoiceUpdateError) throw invoiceUpdateError;
            
            updatedOrders = updatedOrders.map(o => 
              o.id === originalInvoiceId ? { ...o, paid_amount: newPaidAmount } : o
            );
          }
        }
      }

      set({
        orders: updatedOrders,
        products: updatedProducts,
      });

      new BroadcastChannel('cashier-sync').postMessage('sync_products');
      sendTelegramAlert({
        type: 'delete_invoice',
        actor: getActorName(state),
        currency: state.storeSettings.currency,
        invoiceId: order.id,
        invoiceUrl: getPublicInvoiceUrl(order.id),
        customer: order.customer?.name || 'عميل نقدي',
        date: deletedAt,
        total: order.total,
        paid: order.paid_amount,
        reason: deletionReason,
        items: order.items.map((item) => ({
          name: item.name,
          quantity: Math.max(0, item.quantity - item.returned_quantity),
          sale_price: item.sale_price,
        })),
      });
      return true;
    } catch (err) {
      console.error("Delete Order Error:", err);
      return false;
    }
  },

  editOrder: async (orderId, updatedData, updatedItems, reason) => {
    const state = get();
    const order = state.orders.find((o) => o.id === orderId);
    if (!order || order.is_deleted || order.isOffline) return false;

    const oldTotal = order.total;
    const oldPaid = order.paid_amount;

    try {
      // Calculate stock adjustments
      const stockAdjustments = new Map<string, number>();
      
      // Add back old quantities
      for (const item of order.items) {
        stockAdjustments.set(item.id, (stockAdjustments.get(item.id) || 0) + item.quantity);
      }
      
      // Subtract new quantities
      for (const item of updatedItems) {
        stockAdjustments.set(item.id, (stockAdjustments.get(item.id) || 0) - item.quantity);
      }

      const updatedProducts = [...state.products];
      
      // Apply stock adjustments to Supabase and local store
      for (const [productId, delta] of Array.from(stockAdjustments.entries())) {
        if (delta === 0) continue;
        
        const productIndex = updatedProducts.findIndex((p) => p.id === productId);
        const localStock = productIndex >= 0 ? updatedProducts[productIndex].stock_quantity : 0;

        const { data: prodData } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', productId)
          .maybeSingle();

        const dbStock = (prodData?.stock_quantity ?? localStock) as number;
        const newStock = dbStock + delta;
        
        const { error: productError } = await supabase
          .from('products')
          .update({ stock_quantity: Math.max(0, newStock) })
          .eq('id', productId);

        if (productError) throw productError;

        if (productIndex >= 0) {
          updatedProducts[productIndex] = {
            ...updatedProducts[productIndex],
            stock_quantity: Math.max(0, localStock + delta),
          };
        }
      }

      // Update order in Supabase
      const newOrderData = {
        total: updatedData.total ?? order.total,
        paid_amount: updatedData.paid_amount ?? order.paid_amount,
        paid_cash: updatedData.paid_cash ?? order.paid_cash,
        paid_visa: updatedData.paid_visa ?? order.paid_visa,
        paid_wallet: updatedData.paid_wallet ?? order.paid_wallet,
        paid_instapay: updatedData.paid_instapay ?? order.paid_instapay,
        payment_method: updatedData.payment_method ?? order.payment_method,
        created_at: updatedData.date ?? order.date,
      };

      const { error: orderError } = await supabase
        .from('orders')
        .update(newOrderData)
        .eq('id', orderId);

      if (orderError) throw orderError;

      // Update order items in Supabase
      // First delete old items
      const { error: deleteItemsError } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', orderId);

      if (deleteItemsError) throw deleteItemsError;

      // Then insert new items
      const itemsPayload = updatedItems.map((item) => ({
        order_id: orderId,
        product_id: item.id,
        product_name: item.name,
        barcode: item.barcode,
        quantity: item.quantity,
        returned_quantity: item.returned_quantity || 0,
        sale_price: item.sale_price,
        purchase_price: item.average_purchase_price || item.purchase_price,
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(itemsPayload);

      if (itemsError) throw itemsError;

      // Update local state
      const finalOrder = { 
        ...order, 
        ...newOrderData, 
        date: newOrderData.created_at, 
        items: updatedItems 
      };
      set({
        orders: state.orders.map((o) => (o.id === orderId ? finalOrder : o)),
        products: updatedProducts,
      });

      new BroadcastChannel('cashier-sync').postMessage('sync_products');
      new BroadcastChannel('cashier-sync').postMessage('sync_orders');

      sendTelegramAlert({
        type: 'edit_invoice',
        actor: getActorName(state),
        currency: state.storeSettings.currency,
        invoiceId: orderId,
        invoiceUrl: getPublicInvoiceUrl(orderId),
        customer: order.customer?.name || 'عميل نقدي',
        date: new Date().toISOString(),
        items: updatedItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          sale_price: item.sale_price,
        })),
        editDetails: {
          oldTotal,
          newTotal: updatedData.total,
          oldPaid,
          newPaid: updatedData.paid_amount,
          notes: reason
        }
      });

      return true;
    } catch (err) {
      console.error("Edit Order Error:", err);
      return false;
    }
  },

  // يسجّل بيانات الاستبدال على الفاتورة (قبل/بعد) لمنع تكراره وعرضه لاحقاً.
  markOrderExchanged: async (orderId, exchangeData) => {
    const { error } = await supabase.from('orders').update({ exchange_data: exchangeData }).eq('id', orderId);
    if (error) { console.error('markOrderExchanged:', error); return false; }
    set((state) => ({ orders: state.orders.map((o) => (o.id === orderId ? { ...o, exchange_data: exchangeData } : o)) }));
    return true;
  },

  syncOfflineReturnsQueue: async () => {
    const state = get();
    if (state.isSyncing || state.offlineReturnsQueue.length === 0) return;

    set({ isSyncing: true });

    const queue = [...state.offlineReturnsQueue];
    const failedReturns = [];

    for (const returnBatch of queue) {
      try {
        const batchReturns = Array.isArray(returnBatch.returns) ? returnBatch.returns : [returnBatch];
        const batchOrderId = returnBatch.orderId;

        for (const returnItem of batchReturns) {
          const orderItemRow = await supabase
            .from('order_items')
            .select('id, returned_quantity, refunded_amount')
            .eq('order_id', batchOrderId)
            .eq('product_id', returnItem.productId)
            .single();

          if (orderItemRow.error) throw orderItemRow.error;

          if (orderItemRow.data) {
            const currentReturned = (orderItemRow.data as any).returned_quantity || 0;
            const currentRefunded = (orderItemRow.data as any).refunded_amount || 0;
            const { error: updateError } = await supabase
              .from('order_items')
              .update({
                returned_quantity: currentReturned + returnItem.returnQty,
                refunded_amount: currentRefunded + (Number(returnItem.refundAmount) || 0),
              })
              .eq('id', (orderItemRow.data as any).id);
            if (updateError) throw updateError;
          }

          const { data: prodData, error: prodGetError } = await supabase
            .from('products')
            .select('stock_quantity')
            .eq('id', returnItem.productId)
            .single();
          
          if (prodGetError) throw prodGetError;

          const currentStock = prodData?.stock_quantity ?? 0;
          const { error: prodError } = await supabase
            .from('products')
            .update({ stock_quantity: currentStock + returnItem.returnQty })
            .eq('id', returnItem.productId);
          
          if (prodError) throw prodError;
        }

      } catch (err) {
        console.error("Failed to sync offline return:", returnBatch, err);
        failedReturns.push(returnBatch);
      }
    }

    localStorage.setItem('cashier_offline_returns_queue', JSON.stringify(failedReturns));
    set({
      offlineReturnsQueue: failedReturns,
      isSyncing: false
    });

    new BroadcastChannel('cashier-sync').postMessage('sync_products');
  },

  // ── Admin ──────────────────────────────────────────────────
  loadAnalyticsData: async (startDate, endDate) => {
    let query = supabase
      .from('orders')
      .select('*, customers(*), order_items(*, products(*))')
      .neq('is_deleted', true)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);

    const { data, error } = await query.limit(1000);
    if (error) {
      console.error("Analytics Load Error:", error);
      return [];
    }

    const orders: Order[] = (data as Record<string, unknown>[]).map((o) => {
      const custRow = o.customers as Record<string, unknown> | null;
      const itemRows = (o.order_items as Record<string, unknown>[]) ?? [];
      const items: OrderItem[] = itemRows.map((i) => {
        const prod = (i.products as Record<string, unknown>) ?? {};
        return {
          id: (i.product_id as string) ?? (i.id as string),
          name: (i.product_name as string) ?? (prod.name as string) ?? '',
          barcode: (prod.barcode as string) ?? '',
          purchase_price: (i.purchase_price as number) ?? (prod.average_purchase_price as number) ?? (prod.purchase_price as number) ?? 0,
          average_purchase_price: (i.purchase_price as number) ?? (prod.average_purchase_price as number) ?? (prod.purchase_price as number) ?? 0,
          sale_price: i.sale_price as number,
          stock_quantity: (prod.stock_quantity as number) ?? 0,
          category_id: (prod.category_id as string) ?? '',
          unit: (prod.unit as string) ?? 'قطعة',
          quantity: i.quantity as number,
          returned_quantity: (i.returned_quantity as number) ?? 0,
          refunded_amount: (i.refunded_amount as number) ?? 0,
        };
      });
      return {
        id: o.id as string,
        total: o.total as number,
        paid_amount: (o.paid_amount as number) ?? (o.total as number),
        paid_cash: (o.paid_cash as number) ?? 0,
        paid_visa: (o.paid_visa as number) ?? 0,
        paid_wallet: (o.paid_wallet as number) ?? 0,
        paid_instapay: (o.paid_instapay as number) ?? 0,
        paid_method5: (o.paid_method5 as number) ?? 0,
        paid_method6: (o.paid_method6 as number) ?? 0,
        type: (o.type as string) as 'sale' | 'payment' ?? 'sale',
        payment_method: (o.payment_method as any) ?? 'cash',
        date: o.created_at as string,
        items,
        cashier_name: (o.cashier_name as string) ?? undefined,
        is_deleted: Boolean(o.is_deleted),
        deleted_at: (o.deleted_at as string) ?? null,
        deletion_reason: (o.deletion_reason as string) ?? null,
        notes: o.notes as string | null,
        coupon_code: o.coupon_code as string | null,
        discount_amount: (o.discount_amount as number) ?? 0,
        customer: custRow
          ? { id: custRow.id as string, name: custRow.name as string, phone: custRow.phone as string, custom_id: custRow.custom_id as string, card_number: custRow.card_number as string, timestamp: custRow.created_at as string }
          : undefined,
        car_id: o.car_id as string | undefined,
      };
    });

    return orders;
  },

  // ── Cashiers ──────────────────────────────────────────────
  loadCashiers: async () => {
    const { data } = await supabase.from('cashiers').select('*').order('created_at', { ascending: false });
    if (data) set({ cashiers: data as Cashier[] });
  },

  addCashier: async (cashier) => {
    const { data, error } = await supabase.from('cashiers').insert(cashier).select().single();
    if (error) {
      console.error('Add Cashier Error:', error);
      alert('تعذّر حفظ المحاسب في قاعدة البيانات:\n' + (error.message || '') + '\n(غالباً لازم تعملي تسجيل دخول من جديد كأدمن.)');
      return;
    }
    if (!data) return;
    const row = data as unknown as Cashier;
    // Auto-create the cashier's login (Supabase Auth) so they can sign in right away.
    if (row.password) {
      const r = await provisionCashierAuth(row.id, row.password);
      if (r.ok) row.email = `cashier-${row.id}@cashier.local`;
      else alert('تم حفظ بيانات الكاشير، لكن تعذّر إنشاء حساب الدخول تلقائياً:\n' + (r.error || '') + '\n\nتأكد أن SUPABASE_SERVICE_ROLE_KEY مضبوط في Vercel، ثم عدّل الكاشير وأعد حفظ الباسورد.');
    }
    set((state) => ({ cashiers: [row, ...state.cashiers] }));

    // Auto-create a linked employee profile (so the cashier gets salary + sales commission).
    try {
      const { data: emp } = await supabase.from('employees')
        .insert({ name: row.name, job_title: 'كاشير', phone: row.phone || '', cashier_id: row.id, monthly_salary: 0, commission_rate: 0 })
        .select().single();
      if (emp) set((state) => ({ employees: [emp as unknown as Employee, ...state.employees] }));
    } catch (e) {
      console.warn('Could not auto-create employee for cashier:', e);
    }
  },

  updateCashier: async (id, updated) => {
    await supabase.from('cashiers').update(updated).eq('id', id);
    // If the password changed, sync it to the cashier's login account.
    if (updated.password) {
      const r = await provisionCashierAuth(id, updated.password);
      if (r.ok) updated = { ...updated, email: `cashier-${id}@cashier.local` };
      else alert('تم حفظ التعديل، لكن تعذّر تحديث حساب الدخول:\n' + (r.error || '') + '\n\nتأكد أن SUPABASE_SERVICE_ROLE_KEY مضبوط في Vercel.');
    }
    set((state) => ({ cashiers: state.cashiers.map((c) => (c.id === id ? { ...c, ...updated } : c)) }));
  },

  deleteCashier: async (id) => {
    await supabase.from('cashiers').delete().eq('id', id);
    set((state) => ({ cashiers: state.cashiers.filter((c) => c.id !== id) }));
  },

  // ── Manufacturing ────────────────────────────────────────────
  loadManufacturing: async () => {
    const [mRes, pRes] = await Promise.all([
      supabase.from('materials').select('*').order('created_at', { ascending: false }),
      supabase.from('production_orders').select('*').order('created_at', { ascending: false }),
    ]);
    set({
      materials: (mRes.data ?? []) as unknown as Material[],
      productionOrders: (pRes.data ?? []) as unknown as ProductionOrder[],
    });
  },

  addMaterial: async (m, payment) => {
    const supplierId = payment?.supplierId || null;
    const split = payment?.split || { cash: 0, visa: 0, wallet: 0, instapay: 0 };
    const { data } = await supabase.from('materials').insert({ ...m, supplier_id: supplierId }).select().single();
    if (data) set((s) => ({ materials: [data as unknown as Material, ...s.materials] }));

    const total = (Number(m.cost_per_unit) || 0) * (Number(m.stock_quantity) || 0);
    if (total <= 0) return;

    const paid = (Number(split.cash) || 0) + (Number(split.visa) || 0) + (Number(split.wallet) || 0) + (Number(split.instapay) || 0);
    const primary = split.cash >= split.visa && split.cash >= split.wallet && split.cash >= split.instapay ? 'cash'
      : split.visa >= split.wallet && split.visa >= split.instapay ? 'visa'
      : split.wallet >= split.instapay ? 'wallet' : 'instapay';

    if (supplierId) {
      // مشتريات من مورد: تُسجّل كفاتورة شراء — الباقي (total - paid) يبقى دين على المورد يُسدَّد لاحقاً.
      const { data: inv } = await supabase.from('purchase_invoices').insert({
        invoice_number: `MAT-${Date.now()}`,
        supplier_id: supplierId,
        total,
        paid_amount: paid,
        paid_cash: split.cash || 0,
        paid_visa: split.visa || 0,
        paid_wallet: split.wallet || 0,
        paid_instapay: split.instapay || 0,
        paid_method5: split.method5 || 0,
        paid_method6: split.method6 || 0,
        payment_method: primary,
      }).select().single();
      if (inv) set((s) => ({ purchaseInvoices: [{ ...(inv as any), items: [] }, ...s.purchaseInvoices] }));
    } else {
      // بدون مورد: مصروف "شراء خامات" بالمبلغ المدفوع فعلاً (نقدي مباشر).
      await get().addExpense({
        category: 'شراء خامات',
        amount: total,
        note: `شراء خامة: ${m.name}`,
        payment_method: primary,
        paid_cash: split.cash || 0,
        paid_visa: split.visa || 0,
        paid_wallet: split.wallet || 0,
        paid_instapay: split.instapay || 0,
        paid_method5: split.method5 || 0,
        paid_method6: split.method6 || 0,
      } as Omit<Expense, 'id' | 'date'>);
    }
  },

  updateMaterial: async (id, m) => {
    await supabase.from('materials').update(m).eq('id', id);
    set((s) => ({ materials: s.materials.map((x) => (x.id === id ? { ...x, ...m } : x)) }));
  },

  deleteMaterial: async (id) => {
    await supabase.from('materials').delete().eq('id', id);
    set((s) => ({ materials: s.materials.filter((x) => x.id !== id) }));
  },

  // تحويل قطع من مخزن المصنع للبيع (عرض/مستودع) → تتاح في الكاشير.
  transferFromFactory: async (productId, toDisplay, toWarehouse) => {
    const state = get();
    const p = state.products.find((x) => x.id === productId);
    if (!p) return false;
    const factory = Number(p.factory_quantity) || 0;
    const dis = Math.max(0, Number(toDisplay) || 0);
    const wh = Math.max(0, Number(toWarehouse) || 0);
    const move = dis + wh;
    if (move <= 0) { alert('أدخل كمية للتحويل'); return false; }
    if (move > factory + 0.001) { alert('الكمية المطلوبة أكبر من المتاح في مخزن المصنع'); return false; }
    const newFactory = factory - move;
    const newStock = (Number(p.stock_quantity) || 0) + move;
    const newDisplay = (Number(p.display_quantity) || 0) + dis;
    const { error } = await supabase.from('products').update({
      factory_quantity: newFactory,
      stock_quantity: newStock,
      display_quantity: newDisplay,
    }).eq('id', productId);
    if (error) { alert('فشل التحويل: ' + error.message); return false; }
    set((s) => ({ products: s.products.map((x) => (x.id === productId ? { ...x, factory_quantity: newFactory, stock_quantity: newStock, display_quantity: newDisplay } : x)) }));
    new BroadcastChannel('cashier-sync').postMessage('sync_products');
    return true;
  },

  addProductionOrder: async (input) => {
    const state = get();
    const usedMaterials = input.materials
      .map((m) => ({ ...m, mat: state.materials.find((x) => x.id === m.material_id) }))
      .filter((m) => m.mat && m.quantity > 0);

    const materials_cost = usedMaterials.reduce((s, m) => s + (m.mat!.cost_per_unit * m.quantity), 0);
    const extra_costs = Number(input.extra_costs) || 0;
    const quantity = Number(input.quantity) || 0;
    const total_cost = materials_cost + extra_costs;
    const cost_per_piece = quantity > 0 ? total_cost / quantity : 0;

    if (quantity <= 0) { alert('من فضلك أدخل عدد القطع المنتجة'); return false; }

    // توزيع القطع: عرض + مستودع = متاح للبيع (الكاشير)، والباقي يبقى في مخزن المصنع.
    const display = Math.max(0, Math.min(quantity, Number(input.display_quantity) || 0));
    const warehouse = Math.max(0, Math.min(quantity - display, Number(input.warehouse_quantity) || 0));
    const sellable = display + warehouse;
    const factory = Math.max(0, quantity - sellable);

    try {
      // 1) خصم الخامات من المخزون
      for (const m of usedMaterials) {
        const newStock = (m.mat!.stock_quantity || 0) - m.quantity;
        const { error } = await supabase.from('materials').update({ stock_quantity: newStock }).eq('id', m.material_id);
        if (error) throw error;
      }

      // 2) إضافة المنتج المُصنّع للمخزون (تجميع بالكود مع متوسط التكلفة)
      let productId: string | undefined;
      const code = (input.code || '').trim();
      const existing = code ? state.products.find((p) => p.barcode === code) : undefined;
      if (existing) {
        const oldStock = Number(existing.stock_quantity) || 0;
        const oldFactory = Number(existing.factory_quantity) || 0;
        const oldDisplay = Number(existing.display_quantity) || 0;
        const oldAvg = Number(existing.average_purchase_price ?? existing.purchase_price) || 0;
        const oldPieces = oldStock + oldFactory;
        const newAvg = (oldPieces + quantity) > 0 ? ((oldAvg * oldPieces) + total_cost) / (oldPieces + quantity) : cost_per_piece;
        const { error } = await supabase.from('products').update({
          stock_quantity: oldStock + sellable,
          display_quantity: oldDisplay + display,
          factory_quantity: oldFactory + factory,
          average_purchase_price: newAvg,
          purchase_price: newAvg,
          sale_price: input.sale_price,
          color: input.color || existing.color || null,
        }).eq('id', existing.id);
        if (error) throw error;
        productId = existing.id;
      } else {
        const { data, error } = await supabase.from('products').insert({
          name: input.product_name,
          barcode: code || null,
          color: input.color || null,
          unit: 'قطعة',
          stock_quantity: sellable,
          display_quantity: display,
          factory_quantity: factory,
          sale_price: input.sale_price,
          purchase_price: cost_per_piece,
          average_purchase_price: cost_per_piece,
        }).select().single();
        if (error) throw error;
        productId = (data as Record<string, unknown>)?.id as string;
      }

      // 3) تسجيل أمر التصنيع
      const { data: poData, error: poErr } = await supabase.from('production_orders').insert({
        product_id: productId ?? null,
        product_name: input.product_name,
        color: input.color || null,
        code: code || null,
        quantity,
        materials_cost,
        extra_costs,
        total_cost,
        cost_per_piece,
        sale_price: input.sale_price,
        notes: input.notes || null,
      }).select().single();
      if (poErr) throw poErr;
      const poId = (poData as Record<string, unknown>)?.id as string;

      // 4) تسجيل الخامات المستهلكة
      if (poId && usedMaterials.length) {
        await supabase.from('production_materials').insert(usedMaterials.map((m) => ({
          production_id: poId,
          material_id: m.material_id,
          material_name: m.mat!.name,
          quantity: m.quantity,
          cost: m.mat!.cost_per_unit * m.quantity,
        })));
      }

      // Manufacturing labor / extra costs are a real cash outflow — split-aware.
      if (extra_costs > 0) {
        const sp = input.extra_costs_split;
        const spSum = sp ? (Number(sp.cash) || 0) + (Number(sp.visa) || 0) + (Number(sp.wallet) || 0) + (Number(sp.instapay) || 0) : 0;
        const finalSplit = sp && spSum > 0 ? sp : { cash: extra_costs, visa: 0, wallet: 0, instapay: 0 };
        const primary = finalSplit.cash >= finalSplit.visa && finalSplit.cash >= finalSplit.wallet && finalSplit.cash >= finalSplit.instapay ? 'cash'
          : finalSplit.visa >= finalSplit.wallet && finalSplit.visa >= finalSplit.instapay ? 'visa'
          : finalSplit.wallet >= finalSplit.instapay ? 'wallet' : 'instapay';
        await get().addExpense({
          category: 'تكاليف تصنيع',
          amount: extra_costs,
          note: `مصنعية: ${input.product_name}${input.notes ? ' — ' + input.notes : ''}`,
          payment_method: primary,
          paid_method5: finalSplit.method5 || 0,
          paid_method6: finalSplit.method6 || 0,
          paid_cash: finalSplit.cash || 0,
          paid_visa: finalSplit.visa || 0,
          paid_wallet: finalSplit.wallet || 0,
          paid_instapay: finalSplit.instapay || 0,
        } as Omit<Expense, 'id' | 'date'>);
      }

      await get().loadManufacturing();
      await get().loadProductsOnly();
      new BroadcastChannel('cashier-sync').postMessage('sync_products');
      return true;
    } catch (e) {
      console.error('addProductionOrder failed:', e);
      alert('فشل حفظ أمر التصنيع: ' + String((e as Record<string, unknown>)?.message || e));
      return false;
    }
  },

  deleteCashierNote: async (id) => {
    await supabase.from('cashier_notes').delete().eq('id', id);
    set((state) => ({ cashierNotes: state.cashierNotes.filter((n) => n.id !== id) }));
  },

  // Coupons
  loadCoupons: async () => {
    try {
      const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
      if (error) {
        // Fallback or ignore if table doesn't exist yet
        console.warn('Could not load coupons', error);
        return;
      }
      if (data) {
        set({ coupons: data });
      }
    } catch (e) {
      console.warn('Coupons fetch error:', e);
    }
  },

  addCoupon: async (coupon) => {
    const { data, error } = await supabase.from('coupons').insert({
      ...coupon,
      used_count: 0
    }).select().single();
    
    if (error) throw error;
    if (data) {
      set((state) => ({ coupons: [data, ...state.coupons] }));
    }
  },

  updateCoupon: async (id, updates) => {
    const { data, error } = await supabase.from('coupons').update(updates).eq('id', id).select().single();
    if (error) throw error;
    if (data) {
      set((state) => ({ coupons: state.coupons.map((c) => (c.id === id ? data : c)) }));
    }
  },

  deleteCoupon: async (id) => {
    const { error } = await supabase.from('coupons').delete().eq('id', id);
    if (error) throw error;
    set((state) => ({ coupons: state.coupons.filter((c) => c.id !== id) }));
  },

  incrementCouponUsage: async (code) => {
    const state = get();
    const coupon = state.coupons.find(c => c.code === code);
    if (!coupon) return;
    
    const newCount = coupon.used_count + 1;
    await supabase.from('coupons').update({ used_count: newCount }).eq('code', code);
    set((state) => ({
      coupons: state.coupons.map(c => c.code === code ? { ...c, used_count: newCount } : c)
    }));
  },

  updateSettings: async (newSettings) => {
    const mapped: Record<string, unknown> = {};
    if (newSettings.name !== undefined) mapped.name = newSettings.name;
    if (newSettings.currency !== undefined) mapped.currency = newSettings.currency;
    if (newSettings.logo !== undefined) mapped.logo = newSettings.logo;
    if (newSettings.taxRate !== undefined) mapped.tax_rate = newSettings.taxRate;
    if (newSettings.themeColor !== undefined) mapped.theme_color = newSettings.themeColor;
    if (newSettings.address !== undefined) mapped.address = newSettings.address;
    if (newSettings.phone !== undefined) mapped.phone = newSettings.phone;
    if (newSettings.phone2 !== undefined) mapped.phone2 = newSettings.phone2;
    if (newSettings.whatsappCountryCode !== undefined) mapped.whatsapp_country_code = newSettings.whatsappCountryCode;
    if (newSettings.initial_balance !== undefined) mapped.initial_balance = newSettings.initial_balance;
    if (newSettings.locationUrl !== undefined) mapped.location_url = newSettings.locationUrl;
    if (newSettings.cashierPermissions !== undefined) mapped.cashier_permissions = newSettings.cashierPermissions;
    if (newSettings.paymentLabels !== undefined) mapped.payment_labels = newSettings.paymentLabels;
    if (newSettings.paymentMethodsEnabled !== undefined) mapped.payment_methods_enabled = newSettings.paymentMethodsEnabled;
    if (newSettings.showInvoiceProfit !== undefined) mapped.show_invoice_profit = newSettings.showInvoiceProfit;
    if (newSettings.allowCashierEmployeeAdvance !== undefined) mapped.allow_cashier_employee_advance = newSettings.allowCashierEmployeeAdvance;

    const { data: existing } = await supabase.from('store_settings').select('id').limit(1).maybeSingle();
    
    if (existing?.id) {
      await supabase.from('store_settings').update(mapped).eq('id', existing.id);
    } else {
      await supabase.from('store_settings').insert(mapped);
    }
    
    set((state) => ({ storeSettings: { ...state.storeSettings, ...newSettings } }));
    new BroadcastChannel('cashier-sync').postMessage('sync_settings');
  },

  // ─── Car Maintenance Methods ─────────────────────────────────
  loadCarSubscriptions: async () => {
    try {
      const { data: subs } = await supabase.from('car_subscriptions').select('*').order('created_at', { ascending: false });
      const { data: appts } = await supabase.from('maintenance_appointments').select('*').order('appointment_date', { ascending: true });
      if (subs) set({ carSubscriptions: subs as CarSubscription[] });
      if (appts) set({ maintenanceAppointments: appts as MaintenanceAppointment[] });
    } catch (e) {
      console.error('Error loading car maintenance data:', e);
    }
  },

  addCarSubscription: async (subscription) => {
    try {
      const { data, error } = await supabase.from('car_subscriptions').insert([subscription]).select().single();
      if (error) throw error;
      if (data) {
        set((state) => ({ carSubscriptions: [data as CarSubscription, ...state.carSubscriptions] }));
        return data as CarSubscription;
      }
    } catch (error) {
      console.error('Error adding car subscription:', error);
      throw error;
    }
  },

  updateCarSubscription: async (id, updates) => {
    try {
      const { data, error } = await supabase
        .from('car_subscriptions')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      if (data) {
        set(state => ({
          carSubscriptions: state.carSubscriptions.map(c => c.id === id ? (data as CarSubscription) : c)
        }));
      }
    } catch (error) {
      console.error('Error updating car subscription:', error);
      throw error;
    }
  },

  deleteCarSubscription: async (id) => {
    try {
      const { error } = await supabase.from('car_subscriptions').delete().eq('id', id);
      if (error) throw error;
      set(state => ({
        carSubscriptions: state.carSubscriptions.filter(c => c.id !== id),
        // Appointments cascade delete in DB, so we filter them here too
        maintenanceAppointments: state.maintenanceAppointments.filter(a => a.subscription_id !== id)
      }));
    } catch (error) {
      console.error('Error deleting car subscription:', error);
      throw error;
    }
  },

  toggleCarSubscriptionStatus: async (id, status) => {
    try {
      const { data, error } = await supabase
        .from('car_subscriptions')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      if (data) {
        set(state => ({
          carSubscriptions: state.carSubscriptions.map(c => c.id === id ? (data as CarSubscription) : c)
        }));
      }
    } catch (error) {
      console.error('Error toggling car subscription status:', error);
      throw error;
    }
  },

  addMaintenanceAppointment: async (appointment) => {
    try {
      const { data, error } = await supabase.from('maintenance_appointments').insert([{
        ...appointment,
        status: 'pending',
        is_reminded: false
      }]).select().single();
      if (error) throw error;
      if (data) {
        set((state) => ({ 
          maintenanceAppointments: [...state.maintenanceAppointments, data as MaintenanceAppointment]
            .sort((a, b) => new Date(a.appointment_date).getTime() - new Date(b.appointment_date).getTime())
        }));
        return data as MaintenanceAppointment;
      }
    } catch (error) {
      console.error('Error adding maintenance appointment:', error);
      throw error;
    }
  },

  updateMaintenanceAppointment: async (id, updates) => {
    try {
      const { data, error } = await supabase
        .from('maintenance_appointments')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      if (data) {
        set(state => ({
          maintenanceAppointments: state.maintenanceAppointments.map(a => a.id === id ? (data as MaintenanceAppointment) : a)
            .sort((a, b) => new Date(a.appointment_date).getTime() - new Date(b.appointment_date).getTime())
        }));
      }
    } catch (error) {
      console.error('Error updating maintenance appointment:', error);
      throw error;
    }
  },

  generateSubscriptionAppointments: async (carId, durationMonths, frequencyDays) => {
    try {
      // 1. Delete existing pending appointments for this car
      await supabase.from('maintenance_appointments')
        .delete()
        .eq('subscription_id', carId)
        .eq('status', 'pending');

      // 2. Update car subscription details
      await supabase.from('car_subscriptions')
        .update({ 
          subscription_duration_months: durationMonths, 
          subscription_frequency_days: frequencyDays,
          status: 'active'
        })
        .eq('id', carId);

      // 3. Generate new appointments
      const appointments = [];
      const now = new Date();
      const totalDays = durationMonths * 30; // approx
      
      for (let i = frequencyDays; i <= totalDays; i += frequencyDays) {
        const nextDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
        appointments.push({
          subscription_id: carId,
          appointment_date: nextDate.toISOString().split('T')[0],
          description: 'صيانة دورية - اشتراك باقة',
          status: 'pending',
          is_reminded: false
        });
      }

      if (appointments.length === 0) return;

      const { data, error } = await supabase
        .from('maintenance_appointments')
        .insert(appointments)
        .select();

      if (error) throw error;
      
      // 4. Update local state
      set(state => ({
        carSubscriptions: state.carSubscriptions.map(c => 
          c.id === carId 
            ? { ...c, subscription_duration_months: durationMonths, subscription_frequency_days: frequencyDays, status: 'active' } 
            : c
        ),
        maintenanceAppointments: [
          ...state.maintenanceAppointments.filter(a => !(a.subscription_id === carId && a.status === 'pending')),
          ...(data as MaintenanceAppointment[])
        ].sort((a, b) => new Date(a.appointment_date).getTime() - new Date(b.appointment_date).getTime())
      }));
    } catch (error) {
      console.error('Error generating subscription appointments:', error);
      throw error;
    }
  },

  completeMaintenanceAppointment: async (appointmentId, report, items, splitPayments, paymentMethod) => {
    try {
      const totalCost = items.reduce((sum, item) => sum + item.costPrice, 0);
      const totalSale = items.reduce((sum, item) => sum + item.salePrice, 0);

      // 1. Update appointment
      const { data, error } = await supabase.from('maintenance_appointments')
        .update({ status: 'completed', report, cost: totalSale })
        .eq('id', appointmentId)
        .select().single();
      if (error) throw error;

      const appointment = data as MaintenanceAppointment;
      const subscription = get().carSubscriptions.find(s => s.id === appointment.subscription_id);
      const carInfo = subscription ? `للسيارة ${subscription.car_number}` : '';

      // 2. Add Expense for the parts cost
      if (totalCost > 0) {
        await get().addExpense({
          category: 'مصروفات سيارات',
          amount: totalCost,
          paid_cash: paymentMethod === 'cash' ? totalCost : 0,
          paid_visa: paymentMethod === 'visa' ? totalCost : 0,
          paid_wallet: paymentMethod === 'wallet' ? totalCost : 0,
          paid_instapay: paymentMethod === 'instapay' ? totalCost : 0,
          note: `تكلفة قطع غيار زيارة صيانة ${carInfo}`,
          payment_method: paymentMethod || 'cash',
          car_id: appointment.subscription_id
        });
      }

      // 3. Add as order (income & customer history)
      if (totalSale > 0) {
        // Save current cart
        const tempCart = get().cart;
        
        // Map items to fake cart
        const maintenanceCart = items.map((item, index) => ({
          id: `maint-${appointment.id}-${index}`,
          name: `${item.type === 'part' ? 'قطعة غيار: ' : 'مصنعية: '}${item.name}`,
          category_id: '',
          barcode: '',
          purchase_price: item.costPrice,
          average_purchase_price: item.costPrice,
          sale_price: item.salePrice,
          stock_quantity: 99999, // dummy value
          unit: 'قطعة',
          quantity: 1,
          returned_quantity: 0
        }));

        set({ cart: maintenanceCart });

        // Checkout creates the order, logs revenue, and registers the customer if they don't exist
        await get().checkout(
          totalSale, // total
          { name: subscription?.customer_name || 'بدون اسم', phone: subscription?.customer_phone || '' }, // customer details
          totalSale, // paidAmount
          'sale', // type
          paymentMethod || 'cash', // payment method
          splitPayments, // split payments
          undefined, // cashier name
          `إيراد صيانة - الموعد: ${appointment.appointment_date}`, // notes
          undefined, // couponCode
          undefined, // discountAmount
          appointment.subscription_id // carId
        );

        // Restore original cart
        set({ cart: tempCart });
      }

      if (data) {
        const completedAppt = data as MaintenanceAppointment;
        set((state) => {
          const updatedAppointments = state.maintenanceAppointments.map(a => 
            a.id === appointmentId ? completedAppt : a
          );
          
          // Check remaining pending appointments for this car
          const remainingAppts = updatedAppointments.filter(
            a => a.subscription_id === completedAppt.subscription_id && a.status === 'pending'
          );
          
          const carSub = state.carSubscriptions.find(c => c.id === completedAppt.subscription_id);
          if (carSub && carSub.subscription_duration_months) {
            if (remainingAppts.length === 0) {
              sendTelegramAlert({
                message: `⚠️ تنبيه: انتهى تعاقد الصيانة!\nالسيارة: ${carSub.car_number}\nالعميل: ${carSub.customer_name}\nالهاتف: ${carSub.customer_phone}`,
                type: 'warning'
              });
            } else if (remainingAppts.length <= 2) {
              sendTelegramAlert({
                message: `ℹ️ تنبيه: اقترب انتهاء تعاقد الصيانة!\nالسيارة: ${carSub.car_number}\nالعميل: ${carSub.customer_name}\nالهاتف: ${carSub.customer_phone}\nمتبقي: ${remainingAppts.length} زيارة`,
                type: 'info'
              });
            }
          }

          return { maintenanceAppointments: updatedAppointments };
        });
      }
    } catch (error) {
      console.error('Error completing maintenance appointment:', error);
      throw error;
    }
  },

  completeAppointmentWithRegisteredTransactions: async (appointmentId, cost, report) => {
    try {
      const { data, error } = await supabase.from('maintenance_appointments')
        .update({ status: 'completed', cost, report })
        .eq('id', appointmentId)
        .select().single();
      if (error) throw error;

      if (data) {
        const completedAppt = data as MaintenanceAppointment;
        set((state) => {
          const updatedAppointments = state.maintenanceAppointments.map(a => 
            a.id === appointmentId ? completedAppt : a
          );
          
          const remainingAppts = updatedAppointments.filter(
            a => a.subscription_id === completedAppt.subscription_id && a.status === 'pending'
          );
          
          const carSub = state.carSubscriptions.find(c => c.id === completedAppt.subscription_id);
          if (carSub && carSub.subscription_duration_months) {
            if (remainingAppts.length === 0) {
              sendTelegramAlert({
                message: `⚠️ تنبيه: انتهى تعاقد الصيانة!\nالسيارة: ${carSub.car_number}\nالعميل: ${carSub.customer_name}\nالهاتف: ${carSub.customer_phone}`,
                type: 'warning'
              });
            } else if (remainingAppts.length <= 2) {
              sendTelegramAlert({
                message: `ℹ️ تنبيه: اقترب انتهاء تعاقد الصيانة!\nالسيارة: ${carSub.car_number}\nالعميل: ${carSub.customer_name}\nالهاتف: ${carSub.customer_phone}\nمتبقي: ${remainingAppts.length} زيارة`,
                type: 'info'
              });
            }
          }

          return { maintenanceAppointments: updatedAppointments };
        });
      }
    } catch (error) {
      console.error('Error completing appointment with registered transactions:', error);
      throw error;
    }
  },

  updateMaintenanceReminded: async (appointmentId) => {
    try {
      const { error } = await supabase.from('maintenance_appointments')
        .update({ is_reminded: true })
        .eq('id', appointmentId);
      if (error) throw error;
      
      set((state) => ({
        maintenanceAppointments: state.maintenanceAppointments.map(a => 
          a.id === appointmentId ? { ...a, is_reminded: true } : a
        )
      }));
    } catch (error) {
      console.error('Error updating maintenance reminded status:', error);
    }
  },

  deleteMaintenanceAppointment: async (appointmentId: string) => {
    try {
      const state = get();
      
      // 1. Delete the appointment in Supabase
      const { error: deleteApptError } = await supabase
        .from('maintenance_appointments')
        .delete()
        .eq('id', appointmentId);
      if (deleteApptError) throw deleteApptError;

      // 2. Find and delete related orders
      const relatedOrders = state.orders.filter(o => 
        (o.notes && o.notes.includes(`[زيارة:${appointmentId}]`)) ||
        (o.items && o.items.some(item => item.id?.startsWith(`maint-${appointmentId}`)))
      );
      
      for (const order of relatedOrders) {
        await state.deleteOrder(order.id, 'حذف تلقائي مع موعد الصيانة');
      }

      // 3. Find and delete related expenses
      const relatedExpenses = state.expenses.filter(e => 
        e.note && e.note.includes(`[زيارة:${appointmentId}]`)
      );

      for (const expense of relatedExpenses) {
        await state.deleteExpense(expense.id);
      }

      // 4. Update local state
      set(state => ({
        maintenanceAppointments: state.maintenanceAppointments.filter(a => a.id !== appointmentId)
      }));
    } catch (error) {
      console.error('Error deleting maintenance appointment:', error);
      throw error;
    }
  },

setupRealtime: () => {
    // loadAll() can run more than once (e.g. again right after login), and
    // re-subscribing to an already-subscribed channel throws
    // "cannot add postgres_changes callbacks ... after subscribe()".
    // Remove any existing channel first so this is safe to call repeatedly.
    supabase.getChannels()
      .filter((c) => c.topic === 'realtime:db-changes')
      .forEach((c) => supabase.removeChannel(c));

    const channel = supabase
      .channel('db-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        async (payload) => {
          const newOrder = payload.new as any;
          
          // Fetch items for the new order to have a complete order object
          const { data: items } = await supabase
            .from('order_items')
            .select('*, products(*)')
            .eq('order_id', newOrder.id);

          const { data: customer } = newOrder.customer_id 
            ? await supabase.from('customers').select('*').eq('id', newOrder.customer_id).single()
            : { data: null };

          const formattedOrder: Order = {
            id: newOrder.id,
            total: newOrder.total,
            paid_amount: newOrder.paid_amount,
            paid_cash: newOrder.paid_cash || 0,
            paid_visa: newOrder.paid_visa || 0,
            paid_wallet: newOrder.paid_wallet || 0,
            paid_instapay: newOrder.paid_instapay || 0,
            type: newOrder.type,
            payment_method: newOrder.payment_method,
            date: newOrder.created_at,
            cashier_name: newOrder.cashier_name,
            notes: newOrder.notes || null,
            coupon_code: newOrder.coupon_code || null,
            discount_amount: newOrder.discount_amount || 0,
            car_id: newOrder.car_id || undefined,
            customer: customer ? {
              id: customer.id,
              name: customer.name,
              phone: customer.phone,
              custom_id: customer.custom_id,
              card_number: customer.card_number,
              timestamp: customer.created_at
            } : undefined,
            items: (items || []).map(i => ({
              id: i.product_id,
              name: i.product_name,
              barcode: i.barcode,
              purchase_price: i.purchase_price,
              average_purchase_price: i.purchase_price,
              sale_price: i.sale_price,
              stock_quantity: i.products?.stock_quantity || 0,
              category_id: i.products?.category_id || '',
              unit: i.products?.unit || 'قطعة',
              quantity: i.quantity,
              returned_quantity: i.returned_quantity || 0,
              refunded_amount: i.refunded_amount || 0
            }))
          };

          set((state) => ({
            orders: [formattedOrder, ...state.orders.filter(o => o.id !== formattedOrder.id)]
          }));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const updatedOrder = payload.new as any;
          set((state) => ({
            orders: state.orders.map((order) =>
              order.id === updatedOrder.id
                ? {
                    ...order,
                    total: updatedOrder.total,
                    paid_amount: updatedOrder.paid_amount,
                    paid_cash: updatedOrder.paid_cash || 0,
                    paid_visa: updatedOrder.paid_visa || 0,
                    paid_wallet: updatedOrder.paid_wallet || 0,
                    paid_instapay: updatedOrder.paid_instapay || 0,
                    type: updatedOrder.type,
                    payment_method: updatedOrder.payment_method,
                    date: updatedOrder.created_at,
                    cashier_name: updatedOrder.cashier_name,
                    is_deleted: Boolean(updatedOrder.is_deleted),
                    deleted_at: updatedOrder.deleted_at || null,
                    deletion_reason: updatedOrder.deletion_reason || null,
                    notes: updatedOrder.notes || null,
                    coupon_code: updatedOrder.coupon_code || null,
                    discount_amount: updatedOrder.discount_amount || 0,
                    car_id: updatedOrder.car_id || undefined,
                  }
                : order
            )
          }));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          set((state) => {
            let updatedProducts = [...state.products];
            if (eventType === 'INSERT') {
              const p = newRecord as any;
              updatedProducts = [{
                ...p,
                unit: p.unit ?? 'قطعة',
                average_purchase_price: p.average_purchase_price ?? p.purchase_price ?? 0
              } as Product, ...updatedProducts];
            } else if (eventType === 'UPDATE') {
              updatedProducts = updatedProducts.map((p) =>
                p.id === (newRecord as any).id ? {
                  ...(newRecord as any),
                  unit: (newRecord as any).unit ?? 'قطعة',
                  average_purchase_price: (newRecord as any).average_purchase_price ?? (newRecord as any).purchase_price ?? 0
                } as Product : p
              );
            } else if (eventType === 'DELETE') {
              updatedProducts = updatedProducts.filter((p) => p.id !== (oldRecord as any).id);
            }
            return { products: updatedProducts };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'invoice_counter' },
        (payload) => {
          const nextVal = (payload.new as any).current_value;
          set({ 
            invoiceCounter: nextVal,
            activeInvoiceId: nextVal.toString()
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_suggestions' },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          set((state) => {
            let updated = [...state.productSuggestions];
            if (eventType === 'INSERT') {
              updated = [newRecord as ProductSuggestion, ...updated];
            } else if (eventType === 'UPDATE') {
              updated = updated.map((s) => s.id === (newRecord as ProductSuggestion).id ? (newRecord as ProductSuggestion) : s);
            } else if (eventType === 'DELETE') {
              updated = updated.filter((s) => s.id !== (oldRecord as ProductSuggestion).id);
            }
            return { productSuggestions: updated };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cashier_notes' },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;
          set((state) => {
            let updated = [...state.cashierNotes];
            if (eventType === 'INSERT') {
              updated = [newRecord as CashierNote, ...updated];
            } else if (eventType === 'UPDATE') {
              updated = updated.map((n) => n.id === (newRecord as CashierNote).id ? (newRecord as CashierNote) : n);
            } else if (eventType === 'DELETE') {
              updated = updated.filter((n) => n.id !== (oldRecord as CashierNote).id);
            }
            return { cashierNotes: updated };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
  addProduct: async (product) => {
    const { data, error } = await supabase.from('products').insert(product).select().single();
    if (error) {
      console.error("Error adding product:", error);
      throw error;
    }
    // Optimistic update to avoid race conditions with UI
    if (data) {
      set((state) => {
        const exists = state.products.some(p => p.id === data.id);
        if (!exists) {
          return { products: [...state.products, data as Product] };
        }
        return state;
      });
      return data as Product;
    }
  },
  updateProduct: async (id, updated) => {
    // Realtime subscription handles the live UPDATE — no need to broadcast
    set((state) => ({ products: state.products.map(p => p.id === id ? { ...p, ...updated } : p) })); await supabase.from('products').update(updated).eq('id', id);
  },

  deleteProduct: async (id) => {
    // Realtime subscription handles the live DELETE — no need to broadcast
    await supabase.from('products').delete().eq('id', id);
  },

  // تسوية الجرد: تحديث مخزون المنتجات للكمية المجرودة وتسجيل الفروق.
  adjustStock: async (items, note) => {
    const state = get();
    const rows: any[] = [];
    const updatedProducts = [...state.products];
    for (const it of items) {
      const p = state.products.find((x) => x.id === it.product_id);
      if (!p) continue;
      const system = Number(p.stock_quantity) || 0;
      const counted = Number(it.counted_qty);
      if (isNaN(counted) || Math.abs(counted - system) < 0.0001) continue; // تجاهل غير المتغيّر
      const diff = counted - system;
      const cost = Number(p.average_purchase_price ?? p.purchase_price) || 0;
      const { error } = await supabase.from('products').update({ stock_quantity: counted }).eq('id', it.product_id);
      if (error) continue;
      rows.push({ product_id: it.product_id, product_name: p.name, system_qty: system, counted_qty: counted, diff, cost, note: note || null });
      const idx = updatedProducts.findIndex((x) => x.id === it.product_id);
      if (idx >= 0) updatedProducts[idx] = { ...updatedProducts[idx], stock_quantity: counted };
    }
    if (rows.length) await supabase.from('stock_adjustments').insert(rows);
    set({ products: updatedProducts });
    new BroadcastChannel('cashier-sync').postMessage('sync_products');
    return rows.length;
  },

  // ── Expenses ──────────────────────────────────────────────
  addExpense: async (expense) => {
    const { data, error } = await supabase.from('expenses').insert({
      category: expense.category,
      amount: expense.amount,
      paid_cash: expense.paid_cash || 0,
      paid_visa: expense.paid_visa || 0,
      paid_wallet: expense.paid_wallet || 0,
      paid_instapay: expense.paid_instapay || 0,
      paid_method5: (expense as any).paid_method5 || 0,
      paid_method6: (expense as any).paid_method6 || 0,
      note: expense.note,
      payment_method: expense.payment_method,
      car_id: expense.car_id || null
    }).select().single();
    
    if (error) {
      console.error("Add Expense Error:", error);
      return;
    }

    if (data) {
      const newExp: Expense = {
        id: (data as any).id,
        category: (data as any).category,
        amount: (data as any).amount,
        paid_cash: (data as any).paid_cash || 0,
        paid_visa: (data as any).paid_visa || 0,
        paid_wallet: (data as any).paid_wallet || 0,
        paid_instapay: (data as any).paid_instapay || 0,
        paid_method5: (data as any).paid_method5 || 0,
        paid_method6: (data as any).paid_method6 || 0,
        note: (data as any).note,
        payment_method: (data as any).payment_method,
        date: (data as any).created_at,
        car_id: (data as any).car_id
      };
      set((state) => ({ expenses: [newExp, ...state.expenses] }));
    }
  },

  // سحب المدير: يُسجّل كمصروف "سحب مدير" (يخصم من الخزنة) + تنبيه تليجرام. لا يُحذف.
  managerWithdraw: async (managerName, split) => {
    const total = (split.cash || 0) + (split.visa || 0) + (split.wallet || 0) + (split.instapay || 0);
    if (total <= 0) return false;
    const primary = split.cash >= split.visa && split.cash >= split.wallet && split.cash >= split.instapay ? 'cash'
      : split.visa >= split.wallet && split.visa >= split.instapay ? 'visa'
      : split.wallet >= split.instapay ? 'wallet' : 'instapay';
    await get().addExpense({
      category: 'سحب مدير',
      amount: total,
      note: managerName,
      payment_method: primary,
      paid_cash: split.cash || 0,
      paid_visa: split.visa || 0,
      paid_wallet: split.wallet || 0,
      paid_instapay: split.instapay || 0,
    } as Omit<Expense, 'id' | 'date'>);
    sendTelegramAlert({
      type: 'manager_withdrawal',
      actor: getActorName(get()),
      currency: get().storeSettings.currency,
      description: `سحب باسم المدير: ${managerName}`,
      amount: total,
      paymentMethod: primary,
      date: new Date().toISOString(),
    });
    return true;
  },

  // معاملة شريك (إيداع/سحب). على خزنة المحل تنعكس في الخزنة كمصروف/إيراد؛ على الخزنة
  // الأساسية تُسجَّل في دفتر الشركاء فقط. لا تُحذف.
  recordPartnerTransaction: async (tx) => {
    const amount = Math.abs(Number(tx.amount) || 0);
    if (amount <= 0) return false;
    const method = tx.method || 'cash';
    const split = {
      cash: method === 'cash' ? amount : 0,
      visa: method === 'visa' ? amount : 0,
      wallet: method === 'wallet' ? amount : 0,
      instapay: method === 'instapay' ? amount : 0,
      method5: method === 'method5' ? amount : 0,
      method6: method === 'method6' ? amount : 0,
    };
    const { data, error } = await supabase.from('partner_transactions').insert({
      partner_id: tx.partner_id,
      partner_name: tx.partner_name,
      type: tx.type,
      amount,
      treasury: tx.treasury,
      method,
      note: tx.note || null,
    }).select().single();
    if (error) { alert('فشل حفظ معاملة الشريك: ' + error.message); return false; }

    // انعكاس على خزنة المحل فقط
    if (tx.treasury === 'shop') {
      if (tx.type === 'withdraw') {
        await get().addExpense({
          category: 'سحب شريك', amount, note: `سحب الشريك: ${tx.partner_name}`,
          payment_method: method, paid_cash: split.cash, paid_visa: split.visa, paid_wallet: split.wallet, paid_instapay: split.instapay, paid_method5: split.method5 || 0, paid_method6: split.method6 || 0,
        } as Omit<Expense, 'id' | 'date'>);
      } else {
        // إيداع = إيراد للخزنة (مبلغ سالب في المصروفات)
        await get().addExpense({
          category: 'إيداع شريك', amount: -amount, note: `إيداع الشريك: ${tx.partner_name}`,
          payment_method: method, paid_cash: split.cash, paid_visa: split.visa, paid_wallet: split.wallet, paid_instapay: split.instapay, paid_method5: split.method5 || 0, paid_method6: split.method6 || 0,
        } as Omit<Expense, 'id' | 'date'>);
      }
    }

    sendTelegramAlert({
      type: tx.type === 'withdraw' ? 'partner_withdraw' : 'partner_deposit',
      actor: getActorName(get()),
      currency: get().storeSettings.currency,
      description: `${tx.type === 'withdraw' ? 'سحب' : 'إيداع'} للشريك ${tx.partner_name} — ${tx.treasury === 'shop' ? 'خزنة المحل' : 'الخزنة الأساسية'}`,
      amount,
      paymentMethod: method,
      date: new Date().toISOString(),
    });
    return data ? true : true;
  },

  // تحويل بين خزنة المحل وخزنة الادخار (كل طريقة بطريقتها). ينعكس على خزنة المحل
  // كمصروف (تحويل للادخار) أو إيراد (تحويل من الادخار)، ويُسجَّل في دفتر الادخار.
  savingsTransfer: async (split, direction, source, note) => {
    const s = { cash: Number(split?.cash) || 0, visa: Number(split?.visa) || 0, wallet: Number(split?.wallet) || 0, instapay: Number(split?.instapay) || 0, method5: Number(split?.method5) || 0, method6: Number(split?.method6) || 0 };
    const total = s.cash + s.visa + s.wallet + s.instapay + s.method5 + s.method6;
    if (total <= 0) return false;
    const primary = s.cash >= s.visa && s.cash >= s.wallet && s.cash >= s.instapay ? 'cash'
      : s.visa >= s.wallet && s.visa >= s.instapay ? 'visa'
      : s.wallet >= s.instapay ? 'wallet' : 'instapay';

    // انعكاس على خزنة المحل
    await get().addExpense({
      category: direction === 'in' ? 'تحويل لخزنة الادخار' : 'تحويل من خزنة الادخار',
      amount: direction === 'in' ? total : -total,
      note: note || (direction === 'in' ? 'تحويل من المحل للادخار' : 'تحويل من الادخار للمحل'),
      payment_method: primary,
      paid_cash: s.cash, paid_visa: s.visa, paid_wallet: s.wallet, paid_instapay: s.instapay, paid_method5: s.method5 || 0, paid_method6: s.method6 || 0,
    } as Omit<Expense, 'id' | 'date'>);

    // دفتر الادخار: صف لكل طريقة بمبلغ
    const rows = (['cash', 'visa', 'wallet', 'instapay', 'method5', 'method6'] as const)
      .filter((m) => s[m] > 0)
      .map((m) => ({ direction, amount: s[m], method: m, source: source || 'manual', note: note || null }));
    if (rows.length) await supabase.from('savings_transactions').insert(rows);

    sendTelegramAlert({
      type: direction === 'in' ? 'savings_in' : 'savings_out',
      actor: getActorName(get()),
      currency: get().storeSettings.currency,
      description: `${direction === 'in' ? 'تحويل للادخار' : 'تحويل من الادخار'}: ${total.toFixed(2)}`,
      amount: total,
      paymentMethod: primary,
      date: new Date().toISOString(),
    });
    return true;
  },

  updateExpense: async (id, expense) => {
    const { data, error } = await supabase.from('expenses').update({
      category: expense.category,
      amount: expense.amount,
      paid_cash: expense.paid_cash,
      paid_visa: expense.paid_visa,
      paid_wallet: expense.paid_wallet,
      paid_instapay: expense.paid_instapay,
      paid_method5: (expense as any).paid_method5,
      paid_method6: (expense as any).paid_method6,
      note: expense.note,
      payment_method: expense.payment_method,
      created_at: expense.date
    }).eq('id', id).select().single();

    if (error) {
      console.error("Update Expense Error:", error);
      return;
    }

    if (data) {
      set((state) => ({
        expenses: state.expenses.map((e) => (e.id === id ? { ...e, ...expense } : e))
      }));
    }
  },

  deleteExpense: async (id: string) => {
    await supabase.from('expenses').delete().eq('id', id);
    set((state) => ({ expenses: state.expenses.filter((e) => e.id !== id) }));
  },

  // ── Financing ─────────────────────────────────────────────
  loadFinancing: async () => {
    try {
      const [accountsRes, paymentsRes, transactionsRes] = await Promise.all([
        supabase.from('financing_accounts').select('*').order('created_at', { ascending: false }),
        supabase.from('financing_payments').select('*').order('due_date', { ascending: true }),
        supabase.from('financing_transactions').select('*').order('created_at', { ascending: false }),
      ]);

      if (accountsRes.error) throw accountsRes.error;
      if (paymentsRes.error) throw paymentsRes.error;
      if (transactionsRes.error) throw transactionsRes.error;

      set({
        financingAccounts: (accountsRes.data || []) as FinancingAccount[],
        financingPayments: (paymentsRes.data || []) as FinancingPayment[],
        financingTransactions: (transactionsRes.data || []) as FinancingTransaction[],
      });
    } catch (e) {
      console.error("Financing tables might not exist yet:", e);
      set({ financingAccounts: [], financingPayments: [], financingTransactions: [] });
    }
  },

  addFinancingAccount: async (account, repayments) => {
    const { data: accountData, error: accountError } = await supabase
      .from('financing_accounts')
      .insert({
        type: account.type,
        lender_name: account.lender_name,
        lender_phone: account.lender_phone,
        lender_details: account.lender_details,
        description: account.description,
        principal_amount: account.principal_amount,
        collection_amount: account.collection_amount,
        collection_date: account.collection_date,
        installment_count: account.installment_count,
        status: 'open',
      })
      .select()
      .single();

    if (accountError) {
      console.error("Add Financing Account Error:", accountError);
      alert('تعذر حفظ السلفة/الجمعية. تأكد من تشغيل ملف update_financing_schema.sql في Supabase.');
      return;
    }

    const savedAccount = accountData as FinancingAccount;
    const paymentsPayload = [
      {
        account_id: savedAccount.id,
        payment_type: 'collection',
        due_date: account.collection_date,
        amount: account.collection_amount,
        paid_amount: 0,
        remaining_amount: account.collection_amount,
        status: 'pending',
        note: 'تحصيل مبلغ التمويل',
      },
      ...repayments.map((payment, index) => ({
        account_id: savedAccount.id,
        payment_type: 'repayment',
        due_date: payment.due_date,
        amount: payment.amount,
        paid_amount: 0,
        remaining_amount: payment.amount,
        status: 'pending',
        note: payment.note || `دفعة سداد ${index + 1}`,
      })),
    ];

    const { data: paymentsData, error: paymentsError } = await supabase
      .from('financing_payments')
      .insert(paymentsPayload)
      .select();

    if (paymentsError) {
      console.error("Add Financing Payments Error:", paymentsError);
      alert('تم حفظ السلفة/الجمعية لكن تعذر إنشاء الدفعات.');
      set((state) => ({ financingAccounts: [savedAccount, ...state.financingAccounts] }));
      return;
    }

    set((state) => ({
      financingAccounts: [savedAccount, ...state.financingAccounts],
      financingPayments: [...state.financingPayments, ...((paymentsData || []) as FinancingPayment[])],
    }));
  },

  settleFinancingPayment: async (paymentId, amountToSettle, paymentMethod = 'cash') => {
    const state = get();
    const payment = state.financingPayments.find((p) => p.id === paymentId);
    if (!payment || payment.status === 'paid') return;

    const account = state.financingAccounts.find((a) => a.id === payment.account_id);
    const remainingBefore = Math.max(0, Number(payment.remaining_amount ?? payment.amount) || 0);
    const amount = Math.min(remainingBefore, Math.abs(Number(amountToSettle ?? remainingBefore) || 0));
    if (amount <= 0) {
      alert('اكتب مبلغ سداد صحيح.');
      return;
    }

    const isCollection = payment.payment_type === 'collection';
    const signedAmount = isCollection ? -amount : amount;
    const split = {
      paid_cash: paymentMethod === 'cash' ? signedAmount : 0,
      paid_visa: paymentMethod === 'visa' ? signedAmount : 0,
      paid_wallet: paymentMethod === 'wallet' ? signedAmount : 0,
      paid_instapay: paymentMethod === 'instapay' ? signedAmount : 0,
    };

    const note = `${isCollection ? 'تحصيل' : 'سداد'} ${account?.type === 'association' ? 'جمعية' : 'سلفة'} - ${account?.lender_name || ''}${payment.note ? ` (${payment.note})` : ''}`;
    const { data: expenseData, error: expenseError } = await supabase
      .from('expenses')
      .insert({
        category: isCollection ? 'تمويل وسلف - تحصيل' : 'تمويل وسلف - سداد',
        amount: signedAmount,
        ...split,
        note,
        payment_method: paymentMethod,
      })
      .select()
      .single();

    if (expenseError) {
      console.error("Settle Financing Expense Error:", expenseError);
      alert('تعذر تسجيل حركة الخزنة.');
      return;
    }

    const paidAt = new Date().toISOString();
    const newPaidAmount = (Number(payment.paid_amount) || 0) + amount;
    const newRemainingAmount = Math.max(0, remainingBefore - amount);
    const newStatus = newRemainingAmount <= 0.009 ? 'paid' : 'pending';
    const { data: paymentData, error: paymentError } = await supabase
      .from('financing_payments')
      .update({
        status: newStatus,
        paid_amount: newPaidAmount,
        remaining_amount: newRemainingAmount,
        paid_at: newStatus === 'paid' ? paidAt : payment.paid_at,
        expense_id: (expenseData as any).id,
      })
      .eq('id', payment.id)
      .select()
      .single();

    if (paymentError) {
      console.error("Settle Financing Payment Error:", paymentError);
      alert('تم تسجيل حركة الخزنة لكن تعذر تحديث حالة الدفعة.');
      return;
    }

    const { data: transactionData, error: transactionError } = await supabase
      .from('financing_transactions')
      .insert({
        account_id: payment.account_id,
        payment_id: payment.id,
        transaction_type: payment.payment_type,
        amount,
        remaining_after: newRemainingAmount,
        payment_method: paymentMethod,
        expense_id: (expenseData as any).id,
        note,
      })
      .select()
      .single();

    if (transactionError) {
      console.error("Financing Transaction Log Error:", transactionError);
      alert('تم تسجيل الحركة، لكن تعذر حفظها في سجل معاملات السلفة/الجمعية. شغّل تحديث قاعدة البيانات.');
    }

    const newExpense: Expense = {
      id: (expenseData as any).id,
      category: (expenseData as any).category,
      amount: (expenseData as any).amount,
      paid_cash: (expenseData as any).paid_cash || 0,
      paid_visa: (expenseData as any).paid_visa || 0,
      paid_wallet: (expenseData as any).paid_wallet || 0,
      paid_instapay: (expenseData as any).paid_instapay || 0,
      note: (expenseData as any).note,
      payment_method: (expenseData as any).payment_method,
      date: (expenseData as any).created_at,
    };

    const updatedPayments = state.financingPayments.map((p) =>
      p.id === payment.id ? (paymentData as FinancingPayment) : p
    );
    const accountPayments = updatedPayments.filter((p) => p.account_id === payment.account_id);
    const shouldClose = accountPayments.length > 0 && accountPayments.every((p) => p.status === 'paid');

    let updatedAccounts = state.financingAccounts;
    if (shouldClose && account) {
      await supabase.from('financing_accounts').update({ status: 'closed' }).eq('id', account.id);
      updatedAccounts = state.financingAccounts.map((a) => a.id === account.id ? { ...a, status: 'closed' } : a);
    }

    set({
      expenses: [newExpense, ...state.expenses],
      financingPayments: updatedPayments,
      financingAccounts: updatedAccounts,
      financingTransactions: transactionData
        ? [(transactionData as FinancingTransaction), ...state.financingTransactions]
        : state.financingTransactions,
    });

    sendTelegramAlert({
      type: isCollection ? 'financing_collection' : 'financing_repayment',
      actor: getActorName(state),
      currency: state.storeSettings.currency,
      date: paidAt,
      financingType: account?.type === 'association' ? 'جمعية' : 'سلفة',
      lender: account?.lender_name,
      phone: account?.lender_phone,
      description: account?.description || account?.lender_details,
      amount,
      remaining: newRemainingAmount,
      total: payment.amount,
      paymentMethod,
      dueDate: payment.due_date,
    });
  },

  // ── Suppliers ─────────────────────────────────────────────
  addSupplier: async (supplier) => {
    const { data, error } = await supabase.from('suppliers').insert(supplier).select().single();
    if (error) {
      console.error("Add Supplier Error:", error);
      return null;
    }
    if (data) {
      set((state) => ({ suppliers: [data as unknown as Supplier, ...state.suppliers] }));
      return data as unknown as Supplier;
    }
    return null;
  },

  updateSupplier: async (id, updated) => {
    const { data, error } = await supabase.from('suppliers').update(updated).eq('id', id).select().single();
    if (error) {
      console.error("Update Supplier Error:", error);
      return;
    }
    if (data) {
      set((state) => ({ suppliers: state.suppliers.map((s) => (s.id === id ? { ...s, ...updated } : s)) }));
    }
  },

  deleteSupplier: async (id) => {
    await supabase.from('suppliers').delete().eq('id', id);
    set((state) => ({ suppliers: state.suppliers.filter((s) => s.id !== id) }));
  },

  // ── Purchases ─────────────────────────────────────────────
  loadPurchaseInvoices: async () => {
    try {
      const { data } = await supabase.from('purchase_invoices').select('*, purchase_items(*)').order('created_at', { ascending: false });
      if (data) {
        const mapped = (data as any[]).map(inv => ({
          ...inv,
          paid_cash: inv.paid_cash || 0,
          paid_visa: inv.paid_visa || 0,
          paid_wallet: inv.paid_wallet || 0,
          paid_instapay: inv.paid_instapay || 0,
          items: inv.purchase_items || []
        }));
        set({ purchaseInvoices: mapped as PurchaseInvoice[] });
      }
    } catch (e) {
      console.error(e);
    }
  },

  addPurchaseInvoice: async (invoice, items, splitPayments) => {
    const state = get();
    const splits = getSplits(splitPayments, invoice.payment_method, invoice.paid_amount);
    // 1. Insert Invoice
    const { data: invData, error: invError } = await supabase
      .from('purchase_invoices')
      .insert({
        invoice_number: invoice.invoice_number,
        supplier_id: invoice.supplier_id,
        total: invoice.total,
        paid_amount: invoice.paid_amount,
        paid_cash: splits.cash,
        paid_visa: splits.visa,
        paid_wallet: splits.wallet,
        paid_instapay: splits.instapay,
        paid_method5: splits.method5 || 0,
        paid_method6: splits.method6 || 0,
        payment_method: invoice.payment_method
      })
      .select()
      .single();

    if (invError) {
      console.error("Add Purchase Invoice Error:", invError);
      throw new Error(`خطأ في حفظ الفاتورة: ${invError.message}`);
    }

    const newInvoiceId = (invData as any).id;

    // 2. Insert Items
    const itemsToInsert = items.map(item => ({
      invoice_id: newInvoiceId,
      product_id: item.product_id,
      quantity: item.quantity,
      purchase_price: item.purchase_price
    }));

    if (itemsToInsert.length > 0) {
      const { error: itemsError } = await supabase.from('purchase_items').insert(itemsToInsert);
      if (itemsError) {
        console.error("Add Purchase Items Error:", itemsError);
        throw new Error(`خطأ في حفظ أصناف الفاتورة: ${itemsError.message}`);
      }
    }

    // 3. Update stock and average price for each product
    const updatedProducts = [...state.products];
    for (const item of items) {
      const productIndex = updatedProducts.findIndex(p => p.id === item.product_id);
      if (productIndex !== -1) {
        const product = updatedProducts[productIndex];
        const oldQty = product.stock_quantity;
        const oldAvgPrice = product.average_purchase_price || product.purchase_price || 0;
        
        const newQty = oldQty + item.quantity;
        const newTotalValue = (oldQty * oldAvgPrice) + (item.quantity * item.purchase_price);
        const newAvgPrice = newQty > 0 ? newTotalValue / newQty : 0;

        // Update DB
        await supabase.from('products').update({
          stock_quantity: newQty,
          average_purchase_price: newAvgPrice,
          purchase_price: item.purchase_price
        }).eq('id', product.id);

        // Update local state copy
        updatedProducts[productIndex] = {
          ...product,
          stock_quantity: newQty,
          average_purchase_price: newAvgPrice,
          purchase_price: item.purchase_price
        };
      }
    }

    // 4. Update local state
    const completeInvoice: PurchaseInvoice = {
      ...invData as any,
      items
    };

    set({
      purchaseInvoices: [completeInvoice, ...state.purchaseInvoices],
      products: updatedProducts
    });

    new BroadcastChannel('cashier-sync').postMessage('sync_products');
    const supplier = state.suppliers.find((s) => s.id === invoice.supplier_id);
    sendTelegramAlert({
      type: invoice.total === 0 ? 'supplier_payment' : 'purchase',
      actor: getActorName(state),
      currency: state.storeSettings.currency,
      invoiceId: invoice.invoice_number,
      invoiceUrl: getPublicInvoiceUrl((invData as any).id),
      supplier: supplier?.name || 'مورد',
      date: (invData as any).created_at,
      total: invoice.total,
      paid: invoice.paid_amount,
      paymentMethod: invoice.payment_method,
      items: items.map((item) => {
        const product = state.products.find((p) => p.id === item.product_id);
        return {
          name: product?.name || item.product_id,
          quantity: item.quantity,
          purchase_price: item.purchase_price,
        };
      }),
    });
  },

  updatePurchaseInvoice: async (invoiceId, invoice, items, splitPayments) => {
    const state = get();
    const oldInvoice = state.purchaseInvoices.find(inv => inv.id === invoiceId);
    if (!oldInvoice) throw new Error('الفاتورة غير موجودة');

    // 1. Revert old items impact
    const updatedProducts = [...state.products];
    const oldItems = oldInvoice.items || [];
    
    // Group differences by product_id
    const productDeltas: Record<string, { oldQty: number; oldValue: number; newQty: number; newValue: number; newPrice?: number }> = {};
    
    oldItems.forEach(item => {
      if (!productDeltas[item.product_id]) productDeltas[item.product_id] = { oldQty: 0, oldValue: 0, newQty: 0, newValue: 0 };
      productDeltas[item.product_id].oldQty += item.quantity;
      productDeltas[item.product_id].oldValue += (item.quantity * item.purchase_price);
    });

    items.forEach(item => {
      if (!productDeltas[item.product_id]) productDeltas[item.product_id] = { oldQty: 0, oldValue: 0, newQty: 0, newValue: 0 };
      productDeltas[item.product_id].newQty += item.quantity;
      productDeltas[item.product_id].newValue += (item.quantity * item.purchase_price);
      productDeltas[item.product_id].newPrice = item.purchase_price;
    });

    // Update stock and average price for each affected product
    for (const [productId, delta] of Object.entries(productDeltas)) {
      const productIndex = updatedProducts.findIndex(p => p.id === productId);
      if (productIndex !== -1) {
        const product = updatedProducts[productIndex];
        const currentStock = product.stock_quantity;
        const currentAvgPrice = product.average_purchase_price || product.purchase_price || 0;
        const currentTotalValue = currentStock * currentAvgPrice;

        const newStock = Math.max(0, currentStock - delta.oldQty + delta.newQty);
        const adjustedTotalValue = Math.max(0, currentTotalValue - delta.oldValue + delta.newValue);
        const newAvgPrice = newStock > 0 ? adjustedTotalValue / newStock : 0;
        
        const finalPurchasePrice = delta.newPrice !== undefined ? delta.newPrice : product.purchase_price;

        await supabase.from('products').update({
          stock_quantity: newStock,
          average_purchase_price: newAvgPrice,
          purchase_price: finalPurchasePrice
        }).eq('id', productId);

        updatedProducts[productIndex] = {
          ...product,
          stock_quantity: newStock,
          average_purchase_price: newAvgPrice,
          purchase_price: finalPurchasePrice
        };
      }
    }

    // 2. Update Invoice
    const splits = getSplits(splitPayments, invoice.payment_method, invoice.paid_amount);
    const { data: invData, error: invError } = await supabase
      .from('purchase_invoices')
      .update({
        total: invoice.total,
        paid_amount: invoice.paid_amount,
        paid_cash: splits.cash,
        paid_visa: splits.visa,
        paid_wallet: splits.wallet,
        paid_instapay: splits.instapay,
        paid_method5: splits.method5 || 0,
        paid_method6: splits.method6 || 0,
        payment_method: invoice.payment_method
      })
      .eq('id', invoiceId)
      .select()
      .single();

    if (invError) throw new Error(`خطأ في تحديث الفاتورة: ${invError.message}`);

    // 3. Replace Items (Delete old, Insert new)
    await supabase.from('purchase_items').delete().eq('invoice_id', invoiceId);
    
    const itemsToInsert = items.map(item => ({
      invoice_id: invoiceId,
      product_id: item.product_id,
      quantity: item.quantity,
      purchase_price: item.purchase_price
    }));

    if (itemsToInsert.length > 0) {
      const { error: itemsError } = await supabase.from('purchase_items').insert(itemsToInsert);
      if (itemsError) throw new Error(`خطأ في حفظ أصناف الفاتورة: ${itemsError.message}`);
    }

    // 4. Update local state
    const completeInvoice: any = {
      ...invData,
      items
    };

    set({
      purchaseInvoices: state.purchaseInvoices.map(inv => inv.id === invoiceId ? completeInvoice : inv),
      products: updatedProducts
    });

   new BroadcastChannel('cashier-sync').postMessage('sync_products');
  },

  deletePurchaseInvoice: async (id) => {
    try {
      const state = get();
      const invoice = state.purchaseInvoices.find(inv => inv.id === id);
      const supplierName = invoice ? state.suppliers.find(s => s.id === invoice.supplier_id)?.name : 'مورد';

      // Delete purchase items first
      await supabase.from('purchase_items').delete().eq('invoice_id', id);
      // Delete the invoice
      const { error } = await supabase.from('purchase_invoices').delete().eq('id', id);
      if (error) throw error;
      set((state) => ({
        purchaseInvoices: state.purchaseInvoices.filter(inv => inv.id !== id)
      }));

      sendTelegramAlert({
        type: 'delete_purchase_invoice',
        actor: getActorName(state),
        currency: state.storeSettings.currency,
        invoiceId: id,
        supplier: supplierName || 'مورد',
        date: new Date().toISOString(),
        total: invoice?.total || 0,
        paid: invoice?.paid_amount || 0
      });
    } catch (e) {
      console.error('Delete Purchase Invoice Error:', e);
      alert('حدث خطأ أثناء حذف الفاتورة');
    }
  },

  paySupplierDebt: async (supplierId, amount, splitPayments) => {
    const state = get();
    const invoiceNumber = `PAY-${Date.now()}`;

    // Validate: don't accept more than what's owed to this supplier
    const supplierInvoices = state.purchaseInvoices.filter(inv => inv.supplier_id === supplierId);
    const totalSupplierDebt = supplierInvoices.reduce((sum, inv) => sum + (inv.total - inv.paid_amount), 0);
    if (amount > totalSupplierDebt + 0.01) {
      alert(`المبلغ المدخل (${amount.toFixed(2)}) أكبر من إجمالي مديونية المورد (${Math.max(0, totalSupplierDebt).toFixed(2)})`);
      return;
    }
    
    try {
      const methods = [
        { name: 'cash', amount: splitPayments?.cash || 0 },
        { name: 'visa', amount: splitPayments?.visa || 0 },
        { name: 'wallet', amount: splitPayments?.wallet || 0 },
        { name: 'instapay', amount: splitPayments?.instapay || 0 }
      ];
      // If splitPayments is undefined, default to cash or the primary method
      const primaryMethod = splitPayments ? methods.sort((a, b) => b.amount - a.amount)[0].name : 'cash';
      const splits = getSplits(splitPayments, primaryMethod, amount);

      const { data, error } = await supabase
        .from('purchase_invoices')
        .insert({
          invoice_number: invoiceNumber,
          supplier_id: supplierId,
          total: 0,
          paid_amount: amount,
          paid_cash: splits.cash,
          paid_visa: splits.visa,
          paid_wallet: splits.wallet,
          paid_instapay: splits.instapay,
        paid_method5: splits.method5 || 0,
        paid_method6: splits.method6 || 0,
          payment_method: primaryMethod
        })
        .select()
        .single();

      if (error) {
        console.error("Payment Insert Error:", error);
        throw error;
      }

      // Update local state with the complete record from DB (includes created_at)
      const newPayment: PurchaseInvoice = {
        ...(data as any),
        items: []
      };

      set({
        purchaseInvoices: [newPayment, ...state.purchaseInvoices]
      });
      const supplier = state.suppliers.find((s) => s.id === supplierId);
      sendTelegramAlert({
        type: 'supplier_payment',
        actor: getActorName(state),
        currency: state.storeSettings.currency,
        invoiceId: invoiceNumber,
        invoiceUrl: getPublicInvoiceUrl((data as any).id),
        supplier: supplier?.name || 'مورد',
        date: (data as any).created_at,
        total: 0,
        paid: amount,
        paymentMethod: (data as any).payment_method,
      });
    } catch (e) {
      console.error("Pay Supplier Debt Exception:", e);
      throw e;
    }
  },

  addCustomer: async (customer) => {
    const { data, error } = await supabase.from('customers').insert({
      name: customer.name,
      phone: customer.phone,
      custom_id: customer.custom_id,
      card_number: customer.card_number
    }).select().single();
    if (error) {
      console.error("Add Customer Error:", error);
      return null;
    }
    if (data) {
      const newCustomer: Customer = {
        id: data.id as string,
        name: data.name as string,
        phone: data.phone as string,
        custom_id: data.custom_id as string,
        card_number: data.card_number as string,
        timestamp: data.created_at as string,
      };
      set((state) => ({ customers: [newCustomer, ...state.customers] }));
      return newCustomer;
    }
    return null;
  },

  updateCustomer: async (id, updated) => {
    const { error } = await supabase.from('customers').update(updated).eq('id', id);
    if (error) {
      console.error("Update Customer Error:", error);
      throw error;
    }
    set((state) => ({
      customers: state.customers.map((c) => (c.id === id ? { ...c, ...updated } : c))
    }));
  },

  // ── Employees ─────────────────────────────────────────────
  loadEmployees: async () => {
    const [empRes, transRes, leavesRes] = await Promise.all([
      supabase.from('employees').select('*').order('created_at', { ascending: false }),
      supabase.from('employee_transactions').select('*').order('created_at', { ascending: false }),
      supabase.from('employee_leaves').select('*').order('created_at', { ascending: false }),
    ]);
    if (empRes.data) set({ employees: empRes.data as Employee[] });
    if (transRes.data) set({ employeeTransactions: transRes.data as EmployeeTransaction[] });
    if (leavesRes.data) set({ employeeLeaves: leavesRes.data as EmployeeLeave[] });
  },

  addEmployee: async (employee) => {
    const { data, error } = await supabase.from('employees').insert(employee).select().single();
    if (error) {
      console.error("Add Employee Error:", error);
      alert('تعذّر حفظ الموظف:\n' + (error.message || '') + '\n(جرّبي تسجيل الدخول من جديد كأدمن.)');
      return;
    }
    if (data) {
      set((state) => ({ employees: [data as Employee, ...state.employees] }));
    }
  },

  updateEmployee: async (id, updated) => {
    const { data, error } = await supabase.from('employees').update(updated).eq('id', id).select().single();
    if (error) {
      console.error("Update Employee Error:", error);
      return;
    }
    if (data) {
      set((state) => ({ employees: state.employees.map((e) => (e.id === id ? { ...e, ...updated } : e)) }));
    }
  },

  deleteEmployee: async (id) => {
    await supabase.from('employees').delete().eq('id', id);
    set((state) => ({ 
      employees: state.employees.filter((e) => e.id !== id),
      employeeTransactions: state.employeeTransactions.filter(t => t.employee_id !== id),
      employeeLeaves: state.employeeLeaves.filter(l => l.employee_id !== id)
    }));
  },

  addEmployeeTransaction: async (transaction) => {
    const { data, error } = await supabase.from('employee_transactions').insert(transaction).select().single();
    if (error) {
      console.error("Add Employee Transaction Error:", error);
      alert('تعذّر حفظ المعاملة (راتب/سلفة):\n' + (error.message || '') + '\n(جرّبي تسجيل الدخول من جديد كأدمن.)');
      return;
    }
    
    if (data) {
      const emp = get().employees.find(e => e.id === transaction.employee_id);
      const typeLabel = transaction.type === 'salary' ? 'راتب' : transaction.type === 'advance' ? 'سلفة' : 'حافز';
      const note = `${typeLabel} - ${emp?.name || 'موظف'}${transaction.note ? ` (${transaction.note})` : ''}`;
      
      // Add to expenses
      await get().addExpense({
        category: 'رواتب',
        amount: transaction.amount,
        paid_cash: transaction.paid_cash,
        paid_visa: transaction.paid_visa,
        paid_wallet: transaction.paid_wallet,
        paid_instapay: transaction.paid_instapay,
        paid_method5: (transaction as any).paid_method5 || 0,
        paid_method6: (transaction as any).paid_method6 || 0,
        note: note,
        payment_method: transaction.payment_method
      } as any);

      set((state) => ({ employeeTransactions: [data as EmployeeTransaction, ...state.employeeTransactions] }));
    }
  },

  updateEmployeeTransaction: async (id, transaction) => {
    const current = get().employeeTransactions.find(t => t.id === id);
    if (!current) return;

    const { data, error } = await supabase.from('employee_transactions').update(transaction).eq('id', id).select().single();
    if (error) {
      console.error("Update Employee Transaction Error:", error);
      return;
    }

    const updatedTransaction = { ...current, ...(data as EmployeeTransaction) };
    const emp = get().employees.find(e => e.id === updatedTransaction.employee_id);
    const typeLabel = updatedTransaction.type === 'salary' ? 'راتب' : updatedTransaction.type === 'advance' ? 'سلفة' : 'حافز';
    const note = `${typeLabel} - ${emp?.name || 'موظف'}${updatedTransaction.note ? ` (${updatedTransaction.note})` : ''}`;
    const currentDate = new Date(current.created_at).toISOString().slice(0, 10);

    const linkedExpense = get().expenses.find(e => {
      const expenseDate = new Date(e.date).toISOString().slice(0, 10);
      return e.category === 'رواتب'
        && expenseDate === currentDate
        && Math.abs(e.amount) === Math.abs(current.amount)
        && Math.abs(e.paid_cash || 0) === Math.abs(current.paid_cash || 0)
        && Math.abs(e.paid_visa || 0) === Math.abs(current.paid_visa || 0)
        && Math.abs(e.paid_wallet || 0) === Math.abs(current.paid_wallet || 0)
        && Math.abs(e.paid_instapay || 0) === Math.abs(current.paid_instapay || 0);
    });

    if (linkedExpense) {
      await get().updateExpense(linkedExpense.id, {
        category: 'رواتب',
        amount: updatedTransaction.amount,
        paid_cash: updatedTransaction.paid_cash,
        paid_visa: updatedTransaction.paid_visa,
        paid_wallet: updatedTransaction.paid_wallet,
        paid_instapay: updatedTransaction.paid_instapay,
        note,
        payment_method: updatedTransaction.payment_method
      });
    }

    set((state) => ({
      employeeTransactions: state.employeeTransactions.map(t => (t.id === id ? updatedTransaction : t))
    }));
  },

  deleteEmployeeTransaction: async (id) => {
    const current = get().employeeTransactions.find(t => t.id === id);
    if (!current) return;

    const { error } = await supabase.from('employee_transactions').delete().eq('id', id);
    if (error) {
      console.error("Delete Employee Transaction Error:", error);
      return;
    }

    const currentDate = new Date(current.created_at).toISOString().slice(0, 10);
    const linkedExpense = get().expenses.find(e => {
      const expenseDate = new Date(e.date).toISOString().slice(0, 10);
      return e.category === 'رواتب'
        && expenseDate === currentDate
        && Math.abs(e.amount) === Math.abs(current.amount)
        && Math.abs(e.paid_cash || 0) === Math.abs(current.paid_cash || 0)
        && Math.abs(e.paid_visa || 0) === Math.abs(current.paid_visa || 0)
        && Math.abs(e.paid_wallet || 0) === Math.abs(current.paid_wallet || 0)
        && Math.abs(e.paid_instapay || 0) === Math.abs(current.paid_instapay || 0);
    });

    if (linkedExpense) {
      await get().deleteExpense(linkedExpense.id);
    }

    set((state) => ({
      employeeTransactions: state.employeeTransactions.filter(t => t.id !== id)
    }));
  },

  addEmployeeLeave: async (leave) => {
    const { data, error } = await supabase.from('employee_leaves').insert(leave).select().single();
    if (error) {
      console.error("Add Employee Leave Error:", error);
      return;
    }

    if (data) {
      set((state) => ({ employeeLeaves: [data as EmployeeLeave, ...state.employeeLeaves] }));
    }
  },

  updateEmployeeLeave: async (id, leave) => {
    const { data, error } = await supabase.from('employee_leaves').update(leave).eq('id', id).select().single();
    if (error) {
      console.error("Update Employee Leave Error:", error);
      return;
    }

    if (data) {
      set((state) => ({
        employeeLeaves: state.employeeLeaves.map(l => (l.id === id ? data as EmployeeLeave : l))
      }));
    }
  },

  deleteEmployeeLeave: async (id) => {
    const { error } = await supabase.from('employee_leaves').delete().eq('id', id);
    if (error) {
      console.error("Delete Employee Leave Error:", error);
      return;
    }

    set((state) => ({ employeeLeaves: state.employeeLeaves.filter(l => l.id !== id) }));
  },

  // Suggestions & Notes
  loadProductSuggestions: async () => {
    try {
      const { data, error } = await supabase.from('product_suggestions').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        set({ productSuggestions: data as ProductSuggestion[] });
      }
    } catch (e) {
      console.error("Error loading product suggestions:", e);
    }
  },
  addProductSuggestion: async (name, notes) => {
    try {
      const { data, error } = await supabase.from('product_suggestions').insert({ name, notes }).select().single();
      if (error) console.error("Error adding product suggestion:", error);
      if (data) set((state) => ({ productSuggestions: [data as ProductSuggestion, ...state.productSuggestions] }));
    } catch (e) {
      console.error("Error adding product suggestion:", e);
    }
  },
  markSuggestionAsPurchased: async (id) => {
    try {
      set((state) => ({ productSuggestions: state.productSuggestions.map(s => s.id === id ? { ...s, is_purchased: true } : s) }));
      const { error } = await supabase.from('product_suggestions').update({ is_purchased: true }).eq('id', id);
      if (error) console.error("Error updating product suggestion:", error);
    } catch (e) {
      console.error("Error updating product suggestion:", e);
    }
  },
  deleteProductSuggestion: async (id) => {
    try {
      set((state) => ({ productSuggestions: state.productSuggestions.filter(s => s.id !== id) }));
      const { error } = await supabase.from('product_suggestions').delete().eq('id', id);
      if (error) console.error("Error deleting product suggestion:", error);
    } catch (e) {
      console.error("Error deleting product suggestion:", e);
    }
  },
  loadCashierNotes: async () => {
    try {
      const { data, error } = await supabase.from('cashier_notes').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        set({ cashierNotes: data as CashierNote[] });
      }
    } catch (e) {
      console.error("Error loading cashier notes:", e);
    }
  },
  addCashierNote: async (cashierName, note) => {
    try {
      const { error } = await supabase.from('cashier_notes').insert({ cashier_name: cashierName, note });
      if (error) console.error("Error adding cashier note:", error);
    } catch (e) {
      console.error("Error adding cashier note:", e);
    }
  },
  markCashierNoteAsRead: async (id) => {
    try {
      const { error } = await supabase.from('cashier_notes').update({ is_read: true }).eq('id', id);
      if (error) console.error("Error updating cashier note:", error);
    } catch (e) {
      console.error("Error updating cashier note:", e);
    }
  },
}));
