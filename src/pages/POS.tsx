import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, type Product } from '../store/useStore';
import { EditInvoiceModal } from '../components/EditInvoiceModal';
import { ShoppingCart, Search, Plus, Minus, Trash2, Banknote, RefreshCcw, Moon, Sun, ArrowRightLeft, X, Printer, CreditCard, Smartphone, Zap, ScanLine, Camera, Box, Check, ChevronRight, ChevronLeft, FileText, MessageSquare, Send, Wallet, Edit2, Eye, HandCoins, Clock, PauseCircle, Undo2 } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { normalizeArabic } from '../utils/textUtils';
import { printBarcodeLabels, generateBarcode } from '../utils/printBarcodeLabels';
import { ALL_PAYMENT_KEYS, activePaymentKeys, payLabelOf } from '../utils/paymentMethods';
import { getUnitConfig, isFractionalUnit, formatQty } from '../utils/units';
import { escapeHtml } from '../utils/escapeHtml';
import { printDocument } from '../utils/printWindow';


export default function POS() {
  const { products, categories, cart, addToCart, addToCartQty, removeFromCart, updateQuantity, updatePrice, clearCart, checkout, processReturn, storeSettings, orders, activeInvoiceId, customers, activeCashier, logoutPOS, isOnline, offlineQueue, offlineReturnsQueue, isSyncing, syncOfflineQueue, syncOfflineReturnsQueue, addCashierNote, addExpense, invoiceType, setInvoiceType, employees, salesperson, setSalesperson, deleteOrder, savingsTransfer, addEmployeeTransaction, updateProduct, heldInvoices, holdInvoice, confirmHeldInvoice, returnHeldInvoice } = useStore();
  // Transfer day-closing balance to savings (with manager OTP)
  const [showSaveXfer, setShowSaveXfer] = useState(false);
  const [saveXfer, setSaveXfer] = useState<Record<string, string>>({ cash: '', visa: '', wallet: '', instapay: '' });
  const [saveXferOtp, setSaveXferOtp] = useState('');
  const [saveXferSent, setSaveXferSent] = useState(false);
  const [saveXferBusy, setSaveXferBusy] = useState(false);
  const PAY_KEYS = [['cash', 'كاش'], ['visa', 'فيزا'], ['wallet', 'محفظة'], ['instapay', 'انستا باي']] as const;
  const saveXferToken = async () => { const { supabase } = await import('../lib/supabase'); const { data } = await supabase.auth.getSession(); return data.session?.access_token; };
  const saveXferTotal = PAY_KEYS.reduce((s, [k]) => s + (Number(saveXfer[k]) || 0), 0);
  const saveXferValidate = () => {
    const avail = dayBudget?.shopAvail || {};
    if (saveXferTotal <= 0) { alert('حدّد المبلغ المراد تحويله'); return false; }
    for (const [k, label] of PAY_KEYS) { if ((Number(saveXfer[k]) || 0) > (avail[k] || 0) + 0.001) { alert(`مبلغ ${label} أكبر من المتاح في خزنة المحل (${(avail[k] || 0).toFixed(2)})`); return false; } }
    return true;
  };
  const saveXferRequest = async () => {
    if (!saveXferValidate()) return;
    setSaveXferBusy(true);
    try {
      const lines = PAY_KEYS.filter(([k]) => (Number(saveXfer[k]) || 0) > 0).map(([k, l]) => `${l}: ${Number(saveXfer[k]).toFixed(2)}`).join(' | ');
      const details = `تحويل من خزنة المحل ➜ الادخار\n${lines}\nالإجمالي: ${saveXferTotal.toFixed(2)} ${storeSettings.currency}`;
      const t = await saveXferToken();
      const r = await fetch('/api/wholesale-otp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ action: 'request', purpose: 'savings', details }) });
      const j = await r.json();
      if (j.ok) { setSaveXferSent(true); alert('تم إرسال تفاصيل التحويل ورمز التأكيد للمدير على تليجرام 📲'); }
      else alert('تعذّر إرسال الرمز: ' + (j.error || ''));
    } catch { alert('تعذّر إرسال الرمز'); }
    setSaveXferBusy(false);
  };
  const saveXferConfirm = async () => {
    if (!saveXferValidate()) return;
    if (!saveXferOtp.trim()) { alert('أدخل رمز التأكيد'); return; }
    setSaveXferBusy(true);
    try {
      const t = await saveXferToken();
      const r = await fetch('/api/wholesale-otp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ action: 'verify', purpose: 'savings', code: saveXferOtp.trim() }) });
      const j = await r.json();
      if (!j.ok) { alert(j.error || 'رمز غير صحيح'); setSaveXferBusy(false); return; }
      const split = { cash: Number(saveXfer.cash) || 0, visa: Number(saveXfer.visa) || 0, wallet: Number(saveXfer.wallet) || 0, instapay: Number(saveXfer.instapay) || 0 };
      const ok = await savingsTransfer(split, 'in', 'day_closing');
      if (ok) { alert('تم تحويل المبلغ لخزنة الادخار ✅'); setSaveXfer({ cash: '', visa: '', wallet: '', instapay: '' }); setSaveXferOtp(''); setSaveXferSent(false); setShowSaveXfer(false); computeDayBudget(dayBudgetDate); }
    } catch { alert('تعذّر تنفيذ التحويل'); }
    setSaveXferBusy(false);
  };
  const [posSeason, setPosSeason] = useState<'all' | 'summer' | 'winter'>('all');
  const [historyToday, setHistoryToday] = useState(true);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [viewExchange, setViewExchange] = useState<any>(null);
  const openEditOrder = (o: any) => {
    if (o.exchange_data) { setViewExchange(o); return; }
    setEditingOrder(o); setShowHistory(false);
  };

  // تنقّل بالكيبورد (Enter) بين الحقول وقت الزحمة من غير ماوس
  const focusById = (id: string) => { setTimeout(() => { const el = document.getElementById(id) as HTMLElement | null; el?.focus(); }, 0); };
  const keyNext = (e: React.KeyboardEvent, nextId: string) => { if (e.key === 'Enter') { e.preventDefault(); focusById(nextId); } };

  // ── سداد آجل للعملاء من الكاشير ──────────────────────────────
  const [showDebtModal, setShowDebtModal] = useState(false);
  const [debtSearch, setDebtSearch] = useState('');
  const [debtCustId, setDebtCustId] = useState('');
  const [debtAmount, setDebtAmount] = useState('');
  const [debtMethod, setDebtMethod] = useState('cash');
  const [debtSaving, setDebtSaving] = useState(false);
  const customerDebtOf = (custId: string) => {
    return orders.filter(o => o.customer?.id === custId && !o.is_deleted).reduce((sum, o) => {
      const debt = (o.type === 'payment' ? 0 : (o.total || 0)) - (o.paid_amount || 0);
      if (debt > 0.009 && o.type !== 'payment') return sum + debt;
      if (o.type === 'payment' && !(o.notes && o.notes.includes('سداد أجل للفاتورة رقم'))) return sum + debt;
      return sum;
    }, 0);
  };
  const debtCustomers = customers.map(c => ({ ...c, debt: customerDebtOf(c.id) })).filter(c => c.debt > 0.5);
  const debtFiltered = debtCustomers.filter(c => {
    const q = debtSearch.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q);
  });
  const selectedDebtCustomer = debtCustomers.find(c => c.id === debtCustId);

  const printDebtReceipt = (custName: string, paid: number, remaining: number, methodLabel: string, invId: string) => {
    const s = storeSettings;
    const date = new Date().toLocaleString('ar-EG', { calendar: 'gregory', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>إيصال سداد #${invId}</title><style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;900&display=swap');
      *{margin:0;padding:0;box-sizing:border-box;font-family:'Cairo',sans-serif;color:#000;}
      .c{width:72mm;margin:0 auto;padding:2mm 1.5mm;}
      .nm{font-size:18px;font-weight:900;text-align:center;}
      .ttl{font-size:14px;font-weight:900;text-align:center;border:1.5px solid #000;border-radius:5px;padding:3px;margin:5px 0;}
      .r{display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:2px 0;}
      .big{font-size:17px;font-weight:900;border-top:1.5px solid #000;border-bottom:1.5px solid #000;padding:5px 0;margin-top:4px;}
      .rem{font-size:15px;font-weight:900;text-align:center;border:1.5px solid #000;border-radius:5px;padding:4px;margin-top:5px;}
      .ft{text-align:center;font-size:10px;font-weight:700;margin-top:6px;border-top:1px dashed #000;padding-top:4px;}
      @media print{@page{size:72mm auto;margin:0;}.c{width:72mm;}}
    </style></head><body><div class="c">
      <div class="nm">${escapeHtml(s.name)}</div>
      <div class="ttl">إيصال سداد آجل</div>
      <div class="r"><span>رقم الإيصال:</span><span>#${invId}</span></div>
      <div class="r"><span>التاريخ:</span><span>${date}</span></div>
      <div class="r"><span>المحاسب:</span><span>${escapeHtml(activeCashier?.name || 'مدير النظام')}</span></div>
      <div class="r"><span>العميل:</span><span>${escapeHtml(custName)}</span></div>
      <div class="r"><span>طريقة الدفع:</span><span>${methodLabel}</span></div>
      <div class="r big"><span>المبلغ المدفوع:</span><span>${paid.toFixed(2)} ${s.currency}</span></div>
      <div class="rem">المتبقي عليه: ${remaining.toFixed(2)} ${s.currency}</div>
      <div class="ft">شكراً لتعاملكم معنا</div>
    </div><script>window.onload=()=>{setTimeout(()=>{window.print();},400);}</script></body></html>`;
    void printDocument('invoice', html);
  };

  const submitDebtPayment = async () => {
    const c = selectedDebtCustomer;
    if (!c) { alert('اختر العميل'); return; }
    const amount = Number(debtAmount) || 0;
    if (amount <= 0) { alert('أدخل المبلغ المدفوع'); return; }
    if (amount > c.debt + 0.01) { alert(`المبلغ أكبر من المديونية (${c.debt.toFixed(2)})`); return; }
    setDebtSaving(true);
    try {
      const split = { cash: debtMethod === 'cash' ? amount : 0, visa: debtMethod === 'visa' ? amount : 0, wallet: debtMethod === 'wallet' ? amount : 0, instapay: debtMethod === 'instapay' ? amount : 0 };
      const invId = await checkout(0, { name: c.name, phone: c.phone, custom_id: c.custom_id }, amount, 'payment', debtMethod as any, split);
      const methodLabel = debtMethod === 'cash' ? 'كاش' : debtMethod === 'visa' ? 'فيزا' : debtMethod === 'wallet' ? 'محفظة' : 'انستا باي';
      printDebtReceipt(c.name, amount, Math.max(0, c.debt - amount), methodLabel, String(invId || ''));
      setShowDebtModal(false); setDebtCustId(''); setDebtAmount(''); setDebtSearch('');
    } catch (e: any) { alert('خطأ في تسجيل السداد: ' + (e?.message || e)); }
    setDebtSaving(false);
  };

  const deleteOrderWithOtp = async (o: any) => {
    const reason = prompt('سبب حذف الفاتورة؟', 'حذف من الكاشير');
    if (reason === null) return;
    try {
      const { supabase } = await import('../lib/supabase');
      const { data } = await supabase.auth.getSession();
      const tk = data.session?.access_token;
      const headers = { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) };
      const details = `حذف فاتورة #${o.id}\nالعميل: ${o.customer?.name || 'نقدي'}\nالإجمالي: ${(o.total || 0).toFixed(2)} ${storeSettings.currency}\nالسبب: ${reason || '-'}`;
      const r1 = await fetch('/api/wholesale-otp', { method: 'POST', headers, body: JSON.stringify({ action: 'request', purpose: 'invoice', details }) });
      const j1 = await r1.json();
      if (!j1.ok) { alert('تعذّر إرسال رمز التأكيد: ' + (j1.error || '')); return; }
      const code = prompt('تم إرسال رمز التأكيد للمدير على تليجرام.\nأدخل الرمز لإتمام الحذف:');
      if (!code) return;
      const r2 = await fetch('/api/wholesale-otp', { method: 'POST', headers, body: JSON.stringify({ action: 'verify', purpose: 'invoice', code: code.trim() }) });
      const j2 = await r2.json();
      if (!j2.ok) { alert(j2.error || 'رمز غير صحيح'); return; }
      const ok = await deleteOrder(o.id, reason || 'حذف من الكاشير');
      if (ok) alert('تم حذف الفاتورة وإرجاع الكمية للمخزون ✅');
    } catch { alert('تعذّر تنفيذ الحذف'); }
  };
  // OTP gate for wholesale / half-wholesale: prices hidden + checkout blocked until verified.
  const [wholesaleUnlocked, setWholesaleUnlocked] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const pricesHidden = invoiceType !== 'retail' && !wholesaleUnlocked;
  // صلاحيات الكاشير (المدير يرى الكل؛ غيره حسب الإعدادات)
  const isMaster = activeCashier?.id === 'master';
  const perm = (k: string) => isMaster || ((storeSettings as any).cashierPermissions?.[k] !== false);
  // تسميات وسائل الدفع
  const payLabel = (m: string) => payLabelOf(storeSettings as any, m);
  // طرق الدفع المفعّلة (الأساسية + أي إضافية مفعّلة من الإعدادات)
  const activePayKeys = activePaymentKeys(storeSettings as any);
  useEffect(() => { setWholesaleUnlocked(false); setOtpInput(''); setOtpSent(false); }, [invoiceType]);

  const requestOtp = async () => {
    setOtpBusy(true);
    try {
      const { supabase } = await import('../lib/supabase');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const r = await fetch('/api/wholesale-otp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'request' }) });
      const j = await r.json();
      if (j.ok) { setOtpSent(true); alert('تم إرسال رمز التأكيد على تليجرام 📲'); }
      else alert('تعذّر إرسال الرمز: ' + (j.error || ''));
    } catch (e) { alert('تعذّر إرسال الرمز'); }
    setOtpBusy(false);
  };

  const verifyOtp = async () => {
    if (!otpInput.trim()) { alert('أدخل الرمز'); return; }
    setOtpBusy(true);
    try {
      const { supabase } = await import('../lib/supabase');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const r = await fetch('/api/wholesale-otp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'verify', code: otpInput.trim() }) });
      const j = await r.json();
      if (j.ok) { setWholesaleUnlocked(true); setOtpInput(''); }
      else alert(j.error || 'رمز غير صحيح');
    } catch (e) { alert('تعذّر التحقق من الرمز'); }
    setOtpBusy(false);
  };
  const navigate = useNavigate();

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const categoriesRef = useRef<HTMLDivElement>(null);

  const scrollCategories = (direction: 'left' | 'right') => {
    if (categoriesRef.current) {
      const scrollAmount = 200;
      categoriesRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanStatus, setScanStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Mobile Responsiveness & Camera Scanner States
  const [mobileView, setMobileView] = useState<'catalog' | 'cart'>('catalog');
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [scannedProduct, setScannedProduct] = useState<any>(null);
  const [scanQty, setScanQty] = useState(1);
  const [html5QrCode, setHtml5QrCode] = useState<Html5Qrcode | null>(null);

  const playSuccessSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
      console.log('Audio not supported', e);
    }
  };

  const playErrorSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.log('Audio not supported', e);
    }
  };

  // ── إدخال الوزن للمنتجات التي تُباع بالوزن (كيلو/جرام/لتر...) ──
  const [weightProduct, setWeightProduct] = useState<Product | null>(null);
  const [weightUnitInput, setWeightUnitInput] = useState(''); // الكمية بالوحدة الأساسية
  const [weightSubInput, setWeightSubInput] = useState('');   // الكمية بالوحدة الفرعية (جرام...)

  // فتح نافذة الوزن أو الإضافة المباشرة حسب نوع وحدة المنتج
  const handleAddProduct = (product: Product) => {
    if (isFractionalUnit(product.unit)) {
      setWeightProduct(product);
      setWeightUnitInput('');
      setWeightSubInput('');
    } else {
      addToCart(product);
    }
  };

  // الكمية النهائية (بالوحدة الأساسية) المحسوبة من مدخلات نافذة الوزن
  const computeWeightQty = (): number => {
    if (!weightProduct) return 0;
    const cfg = getUnitConfig(weightProduct.unit);
    if (weightSubInput && cfg.subPerUnit) {
      return (parseFloat(weightSubInput) || 0) / cfg.subPerUnit;
    }
    return parseFloat(weightUnitInput) || 0;
  };

  const confirmWeight = () => {
    if (!weightProduct) return;
    const qty = computeWeightQty();
    if (qty <= 0) return;
    addToCartQty(weightProduct, qty);
    setWeightProduct(null);
    setWeightUnitInput('');
    setWeightSubInput('');
  };

  const handleBarcodeScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = barcodeInput.trim();
      if (!code) return;

      const product = products.find(p => p.barcode === code);
      if (product) {
        playSuccessSound();
        handleAddProduct(product);
        setBarcodeInput('');
        setScanStatus('success');
        setTimeout(() => setScanStatus('idle'), 1000);
      } else {
        playErrorSound();
        setScanStatus('error');
        setTimeout(() => setScanStatus('idle'), 1000);
      }
    }
  };

  // Customer details for checkout
  const [customerId, setCustomerId] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [deferredNote, setDeferredNote] = useState('');
  // مبالغ الدفع لكل طريقة (مفتاح الطريقة → نص المبلغ) — يدعم الطرق الستة
  const [payInput, setPayInput] = useState<Record<string, string>>({});
  const setPay = (k: string, v: string) => setPayInput((s) => ({ ...s, [k]: v }));
  const paidVal = (k: string) => parseFloat(payInput[k] || '') || 0;
  const paidTotal = activePayKeys.reduce((s, k) => s + paidVal(k), 0);
  const [discountStr, setDiscountStr] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [customerDebt, setCustomerDebt] = useState<number>(0);

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showReturnsModal, setShowReturnsModal] = useState(false);
  const [returnSearchQuery, setReturnSearchQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');

  // Reprint a past order on the thermal receipt by reconstructing its details.
  const reprintOrder = (order: any) => {
    const items = order.items || [];
    const details = {
      cart: items,
      subtotal: items.reduce((s: number, i: any) => s + (i.sale_price * i.quantity), 0),
      discount: order.discount_amount || 0,
      tax: 0,
      total: order.total,
      paidAmount: order.paid_amount,
      splitPayments: { cash: order.paid_cash || 0, visa: order.paid_visa || 0, wallet: order.paid_wallet || 0, instapay: order.paid_instapay || 0, method5: (order as any).paid_method5 || 0, method6: (order as any).paid_method6 || 0 },
      customerName: order.customer?.name || '',
      customerPhone: order.customer?.phone || '',
      customId: order.customer?.custom_id || order.customer?.card_number || '',
      customerId: order.customer?.id || '',
      paymentMethod: order.payment_method,
      totalDebt: Math.max(0, (order.total || 0) - (order.paid_amount || 0)),
      couponCode: order.coupon_code,
      couponDiscountAmount: order.discount_amount || 0,
      salesperson: order.salesperson_name || '',
    };
    printInvoice(order.id, details);
  };

  // Send a past invoice to the customer on WhatsApp (public link + summary).
  const sendOrderWhatsApp = (order: any) => {
    const invoiceLink = `${window.location.origin}/view-invoice/${order.id}`;
    const itemsText = (order.items || []).map((i: any) => `• ${i.name} (${formatQty(i.quantity, i.unit)}) - ${(i.sale_price * i.quantity).toFixed(2)} ${storeSettings.currency}`).join('\n');
    const spLine = order.salesperson_name ? `*مسؤول المبيعات:* ${order.salesperson_name}\n` : '';
    const message = `*فاتورة من ${storeSettings.name}*\n\n*رقم الفاتورة:* #${order.id}\n${spLine}*الإجمالي:* ${(order.total || 0).toFixed(2)} ${storeSettings.currency}\n\n*عرض الفاتورة بالتفاصيل:*\n${invoiceLink}\n\n*تفاصيل الطلب:*\n${itemsText}\n\n*شكراً لتعاملكم معنا!*`;
    let phone = (order.customer?.phone || '').replace(/\D/g, '');
    const code = storeSettings.whatsappCountryCode || '2';
    if (phone.startsWith('0')) phone = code + phone.substring(1);
    else if (phone && !phone.startsWith(code)) phone = code + phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
  };
  // ── Daily treasury (تقفيل اليوم) — view only ──────────────
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [showDayBudget, setShowDayBudget] = useState(false);
  const [dayBudgetDate, setDayBudgetDate] = useState(todayStr());
  const [dayBudget, setDayBudget] = useState<any>(null);
  const [dayBudgetLoading, setDayBudgetLoading] = useState(false);

  const computeDayBudget = async (dayStr: string) => {
    setDayBudgetLoading(true);
    try {
      const { supabase } = await import('../lib/supabase');
      const start = new Date(`${dayStr}T00:00:00`);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const [expRes, purRes, salRes] = await Promise.all([
        supabase.from('expenses').select('*'),
        supabase.from('purchase_invoices').select('*'),
        supabase.from('employee_transactions').select('*'),
      ]);
      const methods = [...ALL_PAYMENT_KEYS] as string[];
      const zero = (): Record<string, number> => Object.fromEntries(methods.map((m) => [m, 0]));
      const dayIn = zero(), dayOut = zero(), befIn = zero(), befOut = zero();
      const addM = (t: Record<string, number>, rec: any, field: string, mOverride?: string) => {
        const splits = methods.map((m) => +rec[`paid_${m}`] || 0);
        const splitsSum = splits.reduce((a, b) => a + b, 0);
        if (splitsSum > 0) { methods.forEach((m, idx) => { t[m] += splits[idx]; }); return; }
        const amt = Math.abs(+rec[field] || 0);
        const m = mOverride || rec.payment_method || 'cash';
        if (methods.includes(m)) t[m] += amt; else t.cash += amt;
      };
      orders.filter((o: any) => !o.is_deleted).forEach((o: any) => {
        const d = new Date(o.date);
        const inDay = d >= start && d < end;
        const before = d < start;
        if (!inDay && !before) return;
        if ((o.type === 'sale' || o.type === 'payment')) addM(inDay ? dayIn : befIn, o, 'paid_amount');
        const refunded = (o.items || []).reduce((s: number, it: any) => s + (+it.refunded_amount || 0), 0);
        if (refunded > 0) addM(inDay ? dayOut : befOut, { paid_amount: refunded, payment_method: o.refund_method || o.payment_method }, 'paid_amount');
      });
      const addOut = (arr: any[], field: string) => (arr || []).forEach((r: any) => {
        const d = new Date(r.created_at);
        if (d >= start && d < end) addM(dayOut, r, field);
        else if (d < start) addM(befOut, r, field);
      });
      // المصروفات: لو المبلغ سالب فهو إيراد مسجّل يدوياً (داخل) مش خارج.
      const expensesArr = (expRes.data as any[]) || [];
      const realExpenses = expensesArr.filter((e) => (Number(e.amount) || 0) >= 0);
      const manualIncomes = expensesArr.filter((e) => (Number(e.amount) || 0) < 0).map((e) => {
        const abs: any = { ...e, amount: Math.abs(+e.amount || 0) };
        methods.forEach((m) => { abs[`paid_${m}`] = Math.abs(+e[`paid_${m}`] || 0); });
        return abs;
      });
      manualIncomes.forEach((r: any) => {
        const d = new Date(r.created_at);
        if (d >= start && d < end) addM(dayIn, r, 'amount');
        else if (d < start) addM(befIn, r, 'amount');
      });
      addOut(realExpenses, 'amount');
      addOut(purRes.data as any[], 'paid_amount');
      addOut(salRes.data as any[], 'amount');
      const sum = (o: Record<string, number>) => methods.reduce((s, m) => s + (o[m] || 0), 0);
      const opening = (Number((storeSettings as any).initialBalance ?? (storeSettings as any).initial_balance) || 0) + sum(befIn) - sum(befOut);
      const totalIn = sum(dayIn), totalOut = sum(dayOut);
      // الرصيد الحالي في خزنة المحل لكل وسيلة (كل الفترات) — للتحويل لخزنة الادخار.
      const shopAvail: Record<string, number> = zero();
      methods.forEach((m) => { shopAvail[m] = (befIn[m] + dayIn[m]) - (befOut[m] + dayOut[m]); });
      shopAvail.cash += Number((storeSettings as any).initialBalance ?? (storeSettings as any).initial_balance) || 0;
      setDayBudget({ opening, closing: opening + totalIn - totalOut, totalIn, totalOut, dayIn, dayOut, shopAvail });
    } catch (e) { console.error(e); alert('تعذّر تحميل ميزانية اليوم'); }
    setDayBudgetLoading(false);
  };

  useEffect(() => { if (showDayBudget) computeDayBudget(dayBudgetDate); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showDayBudget, dayBudgetDate]);

  const [activeReturnOrder, setActiveReturnOrder] = useState<any>(null);
  const [pendingReturns, setPendingReturns] = useState<Record<string, { returnQty: number, refundAmount: number, returnType?: 'debt' | 'cash' }>>({});
  // Amount of the return value applied to the customer's debt. null = automatic
  // (settle as much debt as possible first); a number = cashier override (0 = don't deduct).
  const [returnDebtDeduction, setReturnDebtDeduction] = useState<number | null>(null);
  // Method used to refund cash to the customer on a return.
  const [refundMethod, setRefundMethod] = useState<'cash' | 'visa' | 'wallet' | 'instapay'>('cash');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastInvoiceId, setLastInvoiceId] = useState('');
  const [lastCustomerInfo, setLastCustomerInfo] = useState<any>(null);
  const [lastOrderDetails, setLastOrderDetails] = useState<any>(null);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showHeldModal, setShowHeldModal] = useState(false);
  const [holdBusy, setHoldBusy] = useState(false);
  const [shouldPrint, setShouldPrint] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [isSendingNote, setIsSendingNote] = useState(false);
  const [showFinanceModal, setShowFinanceModal] = useState(false);
  const [financeType, setFinanceType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [financeCategory, setFinanceCategory] = useState('عام');
  // مبالغ المعاملة المالية لكل طريقة دفع مفعّلة
  const [financePay, setFinancePay] = useState<Record<string, string>>({});
  const financeVal = (k: string) => parseFloat(financePay[k] || '') || 0;
  const financeTotal = activePayKeys.reduce((s, k) => s + financeVal(k), 0);
  const [financeNote, setFinanceNote] = useState('');
  const [financeTransferFrom, setFinanceTransferFrom] = useState('instapay');
  const [financeTransferTo, setFinanceTransferTo] = useState('cash');
  const [financeTransferAmount, setFinanceTransferAmount] = useState('');
  const [isSubmittingFinance, setIsSubmittingFinance] = useState(false);

  // ── سلفة موظف (صرف سلفة تُخصم من راتب الشهر) ──
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceEmpId, setAdvanceEmpId] = useState('');
  const [advancePay, setAdvancePay] = useState<Record<string, string>>({});
  const setAdvance = (k: string, v: string) => setAdvancePay((s) => ({ ...s, [k]: v }));
  const advanceVal = (k: string) => parseFloat(advancePay[k] || '') || 0;
  const [advanceNote, setAdvanceNote] = useState('');
  const [isSubmittingAdvance, setIsSubmittingAdvance] = useState(false);
  const canEmployeeAdvance = isMaster || !!(storeSettings as any).allowCashierEmployeeAdvance;
  const advanceTotal = activePayKeys.reduce((s, k) => s + advanceVal(k), 0);

  const resetAdvanceForm = () => {
    setAdvanceEmpId(''); setAdvancePay({}); setAdvanceNote('');
  };

  // ── طباعة باركود منتج من الكاشير ──
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const [barcodeProductId, setBarcodeProductId] = useState('');
  const [barcodeCount, setBarcodeCount] = useState('1');
  const canBarcodePrint = perm('barcodePrint');
  const barcodeMatches = (() => {
    const q = normalizeArabic(barcodeSearch.trim());
    const list = q === ''
      ? products
      : products.filter((p) => normalizeArabic(p.name).includes(q) || (p.barcode && p.barcode.includes(barcodeSearch.trim())));
    return list.slice(0, 30);
  })();
  const barcodeProduct = products.find((p) => p.id === barcodeProductId) || null;

  const handlePrintBarcode = () => {
    if (!barcodeProduct) { alert('يرجى اختيار منتج أولاً'); return; }
    const n = Math.max(1, parseInt(barcodeCount) || 1);
    let code = barcodeProduct.barcode || '';
    if (!code) {
      code = generateBarcode(new Set(products.map((p) => p.barcode).filter(Boolean) as string[]));
      updateProduct(barcodeProduct.id, { barcode: code });
    }
    printBarcodeLabels({
      name: barcodeProduct.name,
      code,
      price: barcodeProduct.sale_price,
      discountPrice: (barcodeProduct as any).discount_price,
      currency: storeSettings.currency,
      count: n,
      storeName: storeSettings.name,
    });
  };

  const handleAdvanceSubmit = async () => {
    if (!advanceEmpId) { alert('يرجى اختيار الموظف'); return; }
    const total = advanceTotal;
    if (total <= 0) { alert('يرجى إدخال مبلغ السلفة أولاً'); return; }

    const emp = employees.find((x: any) => x.id === advanceEmpId);
    const paymentMethod = activePayKeys
      .map((k) => ({ name: k, amount: advanceVal(k) }))
      .sort((a, b) => b.amount - a.amount)[0].name as any;
    const actorName = activeCashier?.name || 'كاشير';

    setIsSubmittingAdvance(true);
    try {
      // يسجّل السلفة (تُخصم تلقائياً من راتب الشهر) + يخصم المبلغ من الخزنة كمصروف رواتب
      await addEmployeeTransaction({
        employee_id: advanceEmpId,
        amount: total,
        type: 'advance',
        payment_method: paymentMethod,
        paid_cash: advanceVal('cash'),
        paid_visa: advanceVal('visa'),
        paid_wallet: advanceVal('wallet'),
        paid_instapay: advanceVal('instapay'),
        paid_method5: advanceVal('method5'),
        paid_method6: advanceVal('method6'),
        month: new Date().toISOString().slice(0, 7),
        deductions: 0,
        note: (advanceNote ? `${advanceNote} - ` : '') + `سلفة بواسطة ${actorName}`,
      } as any);

      // تنبيه المدير على تليجرام
      fetch('/api/telegram-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'cashier_expense',
          actor: actorName,
          date: new Date().toISOString(),
          amount: total,
          description: `سلفة موظف: ${emp?.name || ''}`,
          noteText: advanceNote || '',
          paymentMethod: payLabel(paymentMethod)
        })
      }).catch(() => {});

      alert('تم صرف السلفة بنجاح ✅ (سيتم خصمها من راتب الشهر)');
      setShowAdvanceModal(false);
      resetAdvanceForm();
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء صرف السلفة');
    } finally {
      setIsSubmittingAdvance(false);
    }
  };

  const handleSendNote = async () => {
    if (!noteText.trim()) return;
    setIsSendingNote(true);
    try {
      const actorName = activeCashier?.name || 'كاشير';
      // 1. Send Telegram Alert
      await fetch('/api/telegram-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'custom_note',
          actor: actorName,
          date: new Date().toISOString(),
          noteText: noteText.trim()
        })
      });

      // 2. Save note to database
      await addCashierNote(actorName, noteText.trim());

      alert('تم إرسال الرسالة بنجاح');
      setShowNoteModal(false);
      setNoteText('');
    } catch (e) {
      alert('حدث خطأ أثناء الإرسال');
    } finally {
      setIsSendingNote(false);
    }
  };

  const handleFinanceSubmit = async () => {
    const actorName = activeCashier?.name || 'كاشير';
    setIsSubmittingFinance(true);
    try {
      if (financeType === 'transfer') {
        const amt = parseFloat(financeTransferAmount) || 0;
        if (amt <= 0) { alert('يرجى إدخال مبلغ صحيح'); return; }
        if (financeTransferFrom === financeTransferTo) { alert('لا يمكن التحويل لنفس وسيلة الدفع'); return; }
        const splits: Record<string, number> = {};
        activePayKeys.forEach((k) => { splits[k] = 0; });
        splits[financeTransferFrom] = -amt;
        splits[financeTransferTo] = amt;
        await addExpense({
          category: 'تحويل داخلي',
          amount: 0,
          paid_cash: splits.cash || 0,
          paid_visa: splits.visa || 0,
          paid_wallet: splits.wallet || 0,
          paid_instapay: splits.instapay || 0,
          paid_method5: splits.method5 || 0,
          paid_method6: splits.method6 || 0,
          note: financeNote || `تحويل ${amt} من ${payLabel(financeTransferFrom)} إلى ${payLabel(financeTransferTo)} - بواسطة ${actorName}`,
          payment_method: 'cash'
        } as any);
        // Send telegram
        fetch('/api/telegram-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'transfer',
            actor: actorName,
            date: new Date().toISOString(),
            description: `تحويل ${amt} من ${payLabel(financeTransferFrom)} إلى ${payLabel(financeTransferTo)}`,
            amount: amt,
            noteText: financeNote || ''
          })
        }).catch(() => {});
      } else {
        const total = financeTotal;
        if (total <= 0) { alert('يرجى إدخال مبالغ الدفع أولاً'); return; }
        const multiplier = financeType === 'income' ? -1 : 1;
        const primaryM = activePayKeys.map((k) => ({ name: k, amount: financeVal(k) })).sort((a, b) => b.amount - a.amount)[0].name;
        await addExpense({
          category: financeCategory,
          amount: total * multiplier,
          paid_cash: financeVal('cash') * multiplier,
          paid_visa: financeVal('visa') * multiplier,
          paid_wallet: financeVal('wallet') * multiplier,
          paid_instapay: financeVal('instapay') * multiplier,
          paid_method5: financeVal('method5') * multiplier,
          paid_method6: financeVal('method6') * multiplier,
          note: (financeNote || (financeType === 'income' ? 'إيراد' : 'مصروف')) + ` - بواسطة ${actorName}`,
          payment_method: primaryM
        } as any);
        // Send telegram
        fetch('/api/telegram-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: financeType === 'income' ? 'cashier_income' : 'cashier_expense',
            actor: actorName,
            date: new Date().toISOString(),
            amount: total,
            description: `${financeType === 'income' ? 'إيراد' : 'مصروف'}: ${financeCategory}`,
            noteText: financeNote || '',
            paymentMethod: payLabel(primaryM)
          })
        }).catch(() => {});
      }
      alert('تم تسجيل المعاملة بنجاح');
      setShowFinanceModal(false);
      setFinancePay({});
      setFinanceNote(''); setFinanceTransferAmount(''); setFinanceCategory('عام');
      setFinanceType('expense');
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء حفظ المعاملة');
    } finally {
      setIsSubmittingFinance(false);
    }
  };

  // Camera Scanner Logic
  useEffect(() => {
    let scanner: Html5Qrcode | null = null;
    
    if (showCameraScanner && !html5QrCode) {
      scanner = new Html5Qrcode("reader");
      setHtml5QrCode(scanner);
      scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText: string) => {
          if (scanner && scanner.getState() === 2) { // 2 = SCANNING
            scanner.pause();
          }
          const product = useStore.getState().products.find(p => p.barcode === decodedText);
          if (product) {
            playSuccessSound();
            setScannedProduct(product);
            setScanQty(1);
          } else {
            playErrorSound();
            alert('لم يتم العثور على المنتج');
            if (scanner && scanner.getState() === 3) { // 3 = PAUSED
              scanner.resume();
            }
          }
        },
        (_error: any) => {
          // ignore continuous scan errors
        }
      ).catch((err: any) => {
        console.error(err);
        alert('حدث خطأ في تشغيل الكاميرا، تأكد من إعطاء الصلاحيات.');
        setShowCameraScanner(false);
      });
    }

    return () => {
      // Cleanup is handled manually in handleCloseCamera to avoid unmount race conditions
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCameraScanner]);

  const handleConfirmScanAdd = () => {
    if (scannedProduct) {
      if (isFractionalUnit(scannedProduct.unit)) {
        // منتج بالوزن: افتح نافذة إدخال الوزن بدل تكرار الإضافة
        setWeightProduct(scannedProduct as Product);
        setWeightUnitInput('');
        setWeightSubInput('');
      } else {
        for (let i = 0; i < scanQty; i++) {
          addToCart(scannedProduct);
        }
      }
      setScannedProduct(null);
      if (html5QrCode && html5QrCode.getState() === 3) {
        html5QrCode.resume();
      }
    }
  };

  const handleCloseCamera = () => {
    if (html5QrCode) {
      if (html5QrCode.getState() === 2 || html5QrCode.getState() === 3) {
        html5QrCode.stop().then(() => {
          html5QrCode.clear();
          setHtml5QrCode(null);
          setShowCameraScanner(false);
          setScannedProduct(null);
        }).catch(console.error);
      } else {
        html5QrCode.clear();
        setHtml5QrCode(null);
        setShowCameraScanner(false);
        setScannedProduct(null);
      }
    } else {
      setShowCameraScanner(false);
      setScannedProduct(null);
    }
  };

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  // Online/Offline sync listener
  useEffect(() => {
    const handleOnline = () => {
      useStore.setState({ isOnline: true });
      syncOfflineQueue();
      syncOfflineReturnsQueue();
    };
    const handleOffline = () => {
      useStore.setState({ isOnline: false });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check
    useStore.setState({ isOnline: navigator.onLine });
    if (navigator.onLine) {
      syncOfflineQueue();
      syncOfflineReturnsQueue();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchOrder = () => {
    const order = orders.find(o => o.id.toLowerCase() === returnSearchQuery.toLowerCase());
    if (order) {
      setActiveReturnOrder(order);
      setPendingReturns({}); setReturnDebtDeduction(null); setRefundMethod('cash');
    } else {
      alert("لم يتم العثور على فاتورة بهذا الرقم");
      setActiveReturnOrder(null);
      setPendingReturns({}); setReturnDebtDeduction(null); setRefundMethod('cash');
    }
  };

  const handleConfirmReturns = async () => {
    if (!activeReturnOrder) return;
    
    const itemsSum = activeReturnOrder.items.reduce((sum: number, item: any) => sum + (item.quantity * item.sale_price), 0);
    const dr = itemsSum > 0 ? activeReturnOrder.total / itemsSum : 1;

    // Value of the goods selected for return (after invoice discount).
    const selected = Object.keys(pendingReturns).map(productId => {
       const pr = pendingReturns[productId];
       const item = activeReturnOrder.items.find((i: any) => i.id === productId);
       const effectivePrice = item ? item.sale_price * dr : 0;
       return { productId, returnQty: pr.returnQty || 0, itemValue: (pr.returnQty || 0) * effectivePrice };
    }).filter(r => r.returnQty > 0);

    if (selected.length === 0) {
       alert("الرجاء تحديد كميات للإرجاع");
       return;
    }

    // Settle the customer's outstanding debt on this invoice first, then refund
    // only the remainder as cash. The cash is distributed across items.
    const totalReturnValue = selected.reduce((sum, r) => sum + r.itemValue, 0);
    const outstandingDebt = Math.max(0, activeReturnOrder.total - activeReturnOrder.paid_amount);
    const maxDebtDeduction = Math.min(totalReturnValue, outstandingDebt);
    const debtSettled = returnDebtDeduction === null
      ? maxDebtDeduction
      : Math.max(0, Math.min(returnDebtDeduction, maxDebtDeduction));
    const cashToRefund = Math.max(0, totalReturnValue - debtSettled);
    const cashRatio = totalReturnValue > 0 ? cashToRefund / totalReturnValue : 0;

    const returnsArray = selected.map(r => ({
      productId: r.productId,
      returnQty: r.returnQty,
      refundAmount: r.itemValue * cashRatio,
    }));

    if (!confirm(
      `تأكيد المرتجعات المحددة؟\n` +
      `قيمة المرتجع: ${totalReturnValue.toFixed(2)} ${storeSettings.currency}\n` +
      `يُخصم من المديونية: ${debtSettled.toFixed(2)} ${storeSettings.currency}\n` +
      `يُرد كاش للعميل: ${cashToRefund.toFixed(2)} ${storeSettings.currency}`
    )) return;

    const success = await processReturn(activeReturnOrder.id, returnsArray, cashToRefund > 0 ? refundMethod : 'cash');
    if (success) {
      alert('تم إرجاع المنتجات المحددة بنجاح!');
      const updatedOrder = useStore.getState().orders.find(o => o.id === activeReturnOrder.id);
      setActiveReturnOrder(updatedOrder);
      setPendingReturns({}); setReturnDebtDeduction(null); setRefundMethod('cash');
    } else {
      alert("حدث خطأ أثناء الإرجاع. قد تكون الكمية غير متاحة.");
    }
  };

  const printInvoice = (invId: string, orderDetails: any) => {
    const currentSettings = { ...storeSettings };
    const printDate = new Date().toLocaleString('ar-EG', { calendar: 'gregory', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const itemsHtml = orderDetails.cart.map((item: any, index: number) => {
      const prod = products.find(p => p.id === item.id);
      const hasDisc = prod && (prod.discount_price || 0) > 0 && Math.abs(item.sale_price - (prod.discount_price || 0)) < 0.01 && prod.sale_price > (prod.discount_price || 0);
      const priceCell = hasDisc
        ? `<span style="display:block;text-decoration:line-through;color:#000;font-size:10px;font-weight:600;">${prod!.sale_price.toFixed(2)}</span><span style="font-weight:900;">${item.sale_price.toFixed(2)}</span>`
        : item.sale_price.toFixed(2);
      return `<tr>
        <td style="text-align:center;">${index + 1}</td>
        <td style="text-align:right;font-weight:bold;">${escapeHtml(item.name)}</td>
        <td style="text-align:center;">${formatQty(item.quantity, item.unit)}</td>
        <td style="text-align:center;">${priceCell}</td>
        <td style="text-align:left;font-weight:bold;">${(item.sale_price * item.quantity).toFixed(2)}</td>
      </tr>`;
    }).join('');

    const invoiceUrl = `${window.location.origin}/view-invoice/${invId}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(invoiceUrl)}`;

    const debtLine = (orderDetails.totalDebt || 0) > 0.5
      ? `<div class="info-item" style="border-top:1px dashed #000;padding-top:3px;margin-top:2px;"><strong>إجمالي المديونية الحالية:</strong> <span style="color:#000;font-weight:900;font-size:14px;">${(orderDetails.totalDebt || 0).toFixed(2)} ${currentSettings.currency}</span></div>`
      : '';
    const customerBlock = (orderDetails.customerName || orderDetails.customerPhone || orderDetails.customId)
      ? `<div class="customer-info-grid">
            <div class="info-item"><strong>اسم العميل:</strong> <span>${escapeHtml(orderDetails.customerName || '—')}</span></div>
            <div class="info-item"><strong>رقم الهاتف:</strong> <span dir="ltr">${escapeHtml(orderDetails.customerPhone || '—')}</span></div>
            <div class="info-item"><strong>رقم الفاتورة:</strong> <span>#${invId}</span></div>
            <div class="info-item"><strong>التاريخ:</strong> <span>${printDate}</span></div>
            ${debtLine}
         </div>`
      : `<div class="customer-info-grid">
            <div class="info-item"><strong>اسم العميل:</strong> <span>عميل نقدي</span></div>
            <div class="info-item"><strong>رقم الفاتورة:</strong> <span>#${invId}</span></div>
            <div class="info-item"><strong>التاريخ:</strong> <span>${printDate}</span></div>
         </div>`;

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title>فاتورة بيع #${invId}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;font-family:'Cairo', sans-serif;}
  body{background:#fff;color:#000;margin:0;}
  .invoice-container{width:72mm;margin:0 auto;padding:0 1.5mm 2mm;display:flex;flex-direction:column;}

  .header-main{text-align:center;border-bottom:1px dashed #000;padding-bottom:3px;margin-bottom:3px;}
  .logo{max-height:42px;max-width:48mm;width:auto;object-fit:contain;display:block;margin:0 auto 1px;}
  .store-name{font-size:18px;font-weight:900;color:#000;line-height:1.1;}
  .store-details{font-size:10px;color:#000;margin-top:1px;line-height:1.3;font-weight:bold;}

  .customer-info-grid{display:flex;flex-direction:column;gap:1px;margin-bottom:4px;font-size:11px;}
  .info-item{display:flex;justify-content:space-between;gap:6px;padding:1px 0;}
  .info-item strong{color:#000;white-space:nowrap;}
  .info-item span{color:#000;font-weight:700;}

  table{width:100%;border-collapse:collapse;margin-bottom:3px;}
  thead th{font-size:11px;padding:3px 1px;border-bottom:1.5px solid #000;font-weight:900;white-space:nowrap;}
  thead th:nth-child(2){text-align:right;}
  thead th:last-child{text-align:left;}
  tbody td{font-size:12px;padding:3px 1px;border-bottom:1px dotted #999;vertical-align:middle;font-weight:700;}
  tbody td:nth-child(1),tbody td:nth-child(3),tbody td:nth-child(4),tbody td:nth-child(5){white-space:nowrap;}

  .summary-section{width:100%;margin-top:3px;}
  .summary-row{display:flex;justify-content:space-between;padding:2px 0;font-size:12px;font-weight:700;}
  .summary-row.total{border-top:1.5px solid #000;border-bottom:1.5px solid #000;margin-top:2px;padding:4px 0;font-size:18px;font-weight:900;color:#000;}

  .payment-status{margin-top:5px;padding:5px;border:1.5px solid #000;border-radius:4px;text-align:center;font-weight:900;font-size:13px;color:#000;}
  .status-paid{background:#fff;color:#000;}
  .status-debt{background:#fff;color:#000;}

  .qr-code-container{display:flex;flex-direction:column;align-items:center;gap:1px;margin-top:4px;}
  .qr-code-img{width:68px;height:68px;}
  .qr-label{font-size:9px;font-weight:900;color:#000;}

  .footer{text-align:center;margin-top:4px;padding-top:3px;border-top:1px dashed #000;font-size:9px;color:#000;font-weight:bold;}

  @media print{
    @page{size:72mm auto;margin:0;}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .invoice-container{width:72mm;padding:2mm 1.5mm;}
  }
</style>
</head>
<body>
<div class="invoice-container">
  <div class="header-main">
    ${currentSettings.logo ? `<img class="logo" src="${escapeHtml(currentSettings.logo)}" onerror="this.style.display='none'" />` : `<div class="store-name">${escapeHtml(currentSettings.name)}</div>`}
    <div class="store-details">
      ${currentSettings.address ? `${escapeHtml(currentSettings.address)}<br/>` : ''}
      ${currentSettings.phone ? `${escapeHtml(currentSettings.phone)}` : ''}
      ${currentSettings.phone2 ? ` | ${escapeHtml(currentSettings.phone2)}` : ''}
    </div>
  </div>

  ${customerBlock}
  ${orderDetails.salesperson ? `<div class="customer-info-grid"><div class="info-item"><strong>مسؤول المبيعات:</strong> <span>${escapeHtml(orderDetails.salesperson)}</span></div></div>` : ''}

  <table>
    <thead><tr>
      <th style="width:8%">#</th>
      <th style="text-align:right">الصنف</th>
      <th style="width:14%">كمية</th>
      <th style="width:20%">سعر</th>
      <th style="width:22%;text-align:left">إجمالي</th>
    </tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="summary-section">
    <div class="summary-row"><span>المجموع الفرعي:</span><span>${orderDetails.subtotal.toFixed(2)} ${currentSettings.currency}</span></div>
    ${orderDetails.couponCode ? `<div class="summary-row" style="color:#000;font-weight:900;"><span>كوبون (${escapeHtml(orderDetails.couponCode)}):</span><span>- ${(orderDetails.couponDiscountAmount || 0).toFixed(2)} ${currentSettings.currency}</span></div>` : ''}
    ${(orderDetails.discount - (orderDetails.couponDiscountAmount || 0)) > 0.5 ? `<div class="summary-row" style="color:#000;font-weight:900;"><span>خصم الفاتورة:</span><span>- ${(orderDetails.discount - (orderDetails.couponDiscountAmount || 0)).toFixed(2)} ${currentSettings.currency}</span></div>` : ''}
    ${(Number(currentSettings.taxRate) > 0) ? `<div class="summary-row"><span>الضريبة (${currentSettings.taxRate}%):</span><span>${orderDetails.tax.toFixed(2)} ${currentSettings.currency}</span></div>` : ''}
    <div class="summary-row total"><span>الإجمالي النهائي:</span><span>${orderDetails.total.toFixed(2)} ${currentSettings.currency}</span></div>
  
    ${(orderDetails.paidAmount !== undefined && orderDetails.paidAmount < orderDetails.total) ? `
      <div class="payment-status status-debt">
        <div>متبقي للتحصيل (آجل): ${(orderDetails.total - (orderDetails.paidAmount || 0)).toFixed(2)} ${currentSettings.currency}</div>
        <div style="font-size:12px;font-weight:700;margin-top:2px;">تم سداد: ${(orderDetails.paidAmount || 0).toFixed(2)} ${currentSettings.currency}</div>
      </div>
    ` : `
      <div class="payment-status status-paid">✓ تم سداد الفاتورة بالكامل</div>
    `}

    ${orderDetails.notes ? `
      <div style="margin-top:5px; padding:4px 5px; border:1px solid #000; border-radius:4px;">
        <span style="font-size:10px; font-weight:900;">ملاحظات: </span>
        <span style="font-size:11px; font-weight:700;">${escapeHtml(orderDetails.notes)}</span>
      </div>
    ` : ''}
    
    ${(() => {
      const sp = orderDetails.splitPayments || {};
      const parts = activePayKeys
        .filter((k) => (Number(sp[k]) || 0) > 0)
        .map((k) => `${payLabel(k)}: ${(Number(sp[k]) || 0).toFixed(2)}`);
      if (parts.length === 0) return '';
      const cells = parts.map(p => `<div style="width:50%;font-size:11px;font-weight:700;padding:1px 0;">${p}</div>`).join('');
      return `<div style="margin-top:4px;padding:4px 5px;border:1px solid #000;border-radius:4px;"><div style="font-size:10px;font-weight:900;margin-bottom:2px;">طرق الدفع:</div><div style="display:flex;flex-wrap:wrap;">${cells}</div></div>`;
    })()}
  </div>

  <div class="qr-code-container">
    <img class="qr-code-img" src="${qrCodeUrl}" alt="QR Code" />
    <div class="qr-label">امسح الكود لعرض الفاتورة</div>
  </div>

  <div class="footer">شكراً لتعاملكم معنا</div>
</div>
<script>window.onload=()=>{setTimeout(()=>{window.print();window.onafterprint=()=>window.close();},500);}<\/script>
</body></html>`;

    void printDocument('invoice', html);
  };

  // Opens payment method modal before checkout
  const handleCheckoutClick = (shouldPrint: boolean) => {
    if (cart.length === 0) return;
    doCheckout(shouldPrint);
  };

  const doCheckout = async (shouldPrint: boolean) => {
    const currentCart = [...cart];
    const currentSubtotal = subtotal;
    const currentDiscount = totalDiscount;
    const currentTax = tax;
    const currentTotal = total;
    const currentCustomerName = customerName;
    const currentCustomerPhone = customerPhone;
    const currentCustomerCard = customerId;
    const currentCouponCode = validCoupon?.code;
    const currentCouponDiscount = couponDiscountAmount;
    const currentSalesperson = salesperson?.name || ''; // قبل ما الـ checkout يصفّره
    const matchedCustomer = customers.find(c =>
      (currentCustomerPhone && c.phone === currentCustomerPhone) ||
      (currentCustomerCard && (c.card_number === currentCustomerCard || c.custom_id === currentCustomerCard))
    );
    const currentCustomId = matchedCustomer?.custom_id || currentCustomerCard;

    // مبالغ كل طريقة دفع مفعّلة
    const splitPayments: Record<string, number> = {};
    activePayKeys.forEach((k) => { splitPayments[k] = paidVal(k); });

    const finalPaidAmount = activePayKeys.reduce((s, k) => s + splitPayments[k], 0);

    // Handle overpayment (Change): اخصم الباقي من كل طريقة بالترتيب
    const change = Math.max(0, finalPaidAmount - currentTotal);
    let remainingChange = change;
    const adjustedSplit: Record<string, number> = { ...splitPayments };
    for (const k of activePayKeys) {
      if (remainingChange <= 0) break;
      const ded = Math.min(adjustedSplit[k], remainingChange);
      adjustedSplit[k] -= ded;
      remainingChange -= ded;
    }

    const isAllEmpty = activePayKeys.every((k) => !payInput[k]);

    // لو ما دخلتش أي مبلغ → الفاتورة كلها آجل (0 مدفوع)
    const effectivePaidAmount = isAllEmpty ? 0 : (finalPaidAmount - change);
    const zeroSplit: Record<string, number> = {};
    activePayKeys.forEach((k) => { zeroSplit[k] = 0; });
    const finalSplit = isAllEmpty ? zeroSplit : adjustedSplit;

    // لو كلها صفر (آجل كامل) → الطريقة الافتراضية cash
    const primaryMethod = isAllEmpty
      ? 'cash'
      : activePayKeys.map((k) => ({ name: k, amount: finalSplit[k] })).sort((a, b) => b.amount - a.amount)[0].name;

    // ── Validate credit (آجل) sales ──────────────────────────────────────────
    if (effectivePaidAmount < currentTotal) {
      // لازم يكون عنده اسم + هاتف. العميل الجديد يُسجَّل تلقائياً أثناء إتمام البيع (checkout)
      // فلا حاجة لأن يكون مسجلاً مسبقاً في قاعدة البيانات.
      if (!currentCustomerName.trim() || !currentCustomerPhone.trim()) {
        alert("⚠️ برجاء إدخال بيانات العميل أولاً\n\nلا يمكن إتمام البيع بالآجل بدون اسم العميل ورقم الهاتف.\nاكتب الاسم والرقم في الكاشير وسيتم تسجيل العميل تلقائياً.");
        return;
      }
    }

    const invoiceId = await checkout(currentTotal, { name: currentCustomerName, phone: currentCustomerPhone, custom_id: currentCustomId }, effectivePaidAmount, 'sale', primaryMethod as any, finalSplit as any, undefined, deferredNote, currentCouponCode, currentCouponDiscount);

    const details: any = {
      cart: currentCart,
      subtotal: currentSubtotal,
      discount: currentDiscount,
      tax: currentTax,
      total: currentTotal,
      paidAmount: effectivePaidAmount,
      splitPayments: finalSplit,
      customerName: currentCustomerName,
      customerPhone: currentCustomerPhone,
      customId: currentCustomId,
      paymentMethod: primaryMethod,
      totalDebt: (customerDebt || 0) + (currentTotal - effectivePaidAmount),
      couponCode: currentCouponCode,
      couponDiscountAmount: currentCouponDiscount,
      salesperson: currentSalesperson
    };

    const actualCustomer = useStore.getState().customers.find(c =>
      (currentCustomerPhone && c.phone === currentCustomerPhone) ||
      (currentCustomerCard && (c.card_number === currentCustomerCard || c.custom_id === currentCustomerCard)) ||
      (currentCustomId && c.custom_id === currentCustomId)
    );
    details.customerId = actualCustomer?.id || '';
    details.customId = actualCustomer?.card_number || actualCustomer?.custom_id || currentCustomerCard;

    setLastInvoiceId(invoiceId);
    setLastCustomerInfo({ name: currentCustomerName, phone: currentCustomerPhone });
    setLastOrderDetails(details);
    playSuccessSound();
    setShowSuccessModal(true);

    if (shouldPrint) {
      printInvoice(invoiceId, details);
    }

    setCustomerName('');
    setCustomerPhone('');
    setCustomerId('');
    setPayInput({});
    setDiscountStr('');
    setCouponInput('');
    setCustomerDebt(0);
    setShowCustomerSuggestions(false);
  };

  // ── فواتير معلقة (محجوزة) ──────────────────────────────────
  // حفظ السلة الحالية كفاتورة معلقة (تحجز الكمية من المخزون).
  const handleHoldInvoice = async () => {
    if (cart.length === 0 || holdBusy) return;
    setHoldBusy(true);
    const ok = await holdInvoice({
      customerName,
      customerPhone,
      customerCustomId: customerId,
      notes: deferredNote,
    });
    setHoldBusy(false);
    if (ok) {
      setCustomerName('');
      setCustomerPhone('');
      setCustomerId('');
      setPayInput({});
      setDiscountStr('');
      setCouponInput('');
      setCustomerDebt(0);
      setDeferredNote('');
      setShowCustomerSuggestions(false);
      alert('✅ تم حفظ الفاتورة في الفواتير المعلقة وحجز الكمية من المخزون.');
    }
  };

  // تأكيد بيع فاتورة معلقة: تُحمَّل في الكاشير ليُكمل الكاشير التحصيل والطباعة.
  const handleConfirmHeld = async (id: string) => {
    if (cart.length > 0 && !window.confirm('يوجد أصناف في السلة الحالية وسيتم استبدالها بالفاتورة المعلقة. هل تريد المتابعة؟')) return;
    const held = await confirmHeldInvoice(id);
    if (held) {
      setCustomerName(held.customer_name || '');
      setCustomerPhone(held.customer_phone || '');
      setCustomerId(held.customer_custom_id || '');
      setDeferredNote(held.notes || '');
      setPayInput({});
      setShowHeldModal(false);
      setMobileView('cart');
      alert('✅ تم تحميل الفاتورة المعلقة. أكمل التحصيل والطباعة لإتمام البيع.');
    }
  };

  const handleReturnHeld = async (id: string) => {
    if (!window.confirm('سيتم إرجاع كمية هذه الفاتورة للمخزون وإلغاؤها. متابعة؟')) return;
    await returnHeldInvoice(id);
  };

  const filteredCustomers = customerName.trim()
    ? customers.filter(c => {
      const normalizedName = normalizeArabic(c.name);
      const normalizedQuery = normalizeArabic(customerName);
      const customerIdShort = (c.custom_id || c.id.substring(0, 8)).toLowerCase();
      const cardNumber = (c.card_number || '').toLowerCase();
      return (
        normalizedName.includes(normalizedQuery) ||
        c.phone.includes(customerName) ||
        customerIdShort.includes(customerName.toLowerCase()) ||
        cardNumber.includes(customerName.toLowerCase())
      );
    })
    : [];



  const handleSelectCustomer = (customer: any) => {
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone);
    setCustomerId(customer.card_number || customer.custom_id || '');
    setShowCustomerSuggestions(false);
  };

  const normalizedSearch = normalizeArabic(searchQuery);
  const searchTerms = normalizedSearch.split(' ').filter(t => t.trim() !== '');

  const filteredProducts = products.filter(
    (p) => {
      const normalizedName = normalizeArabic(p.name);
      const matchesSearch = searchTerms.length === 0 || searchTerms.every(term => normalizedName.includes(term)) || (p.barcode && p.barcode.includes(searchQuery));
      const matchesSeason = posSeason === 'all' || p.season === posSeason;
      return !p.is_hidden && (activeCategory === 'all' || p.category_id === activeCategory) && matchesSearch && matchesSeason;
    }
  );

  const subtotal = cart.reduce((sum, item) => sum + item.sale_price * item.quantity, 0);
  const totalCost = cart.reduce((sum, item) => sum + (item.average_purchase_price || item.purchase_price || 0) * item.quantity, 0);
  const manualDiscount = Math.min(parseFloat(discountStr) || 0, subtotal);
  
  // Coupon Validation and Calculation
  const appliedCoupon = couponInput.trim() ? useStore.getState().coupons.find(c => c.code === couponInput.trim().toUpperCase() && c.is_active) : null;
  let couponDiscountAmount = 0;
  let validCoupon: any = null;
  let couponErrorMsg = '';
  
  if (appliedCoupon) {
    const now = new Date();
    const isValidDate = (!appliedCoupon.start_date || new Date(appliedCoupon.start_date) <= now) && (!appliedCoupon.end_date || new Date(appliedCoupon.end_date) >= now);
    const isUnderTotalLimit = !appliedCoupon.max_uses_total || appliedCoupon.used_count < appliedCoupon.max_uses_total;
    
    // Calculate customer usages
    let isUnderCustomerLimit = true;
    if (appliedCoupon.max_uses_per_customer) {
      if (!customerPhone && !customerId) {
        // If coupon requires customer tracking but no customer is selected, it's invalid
        isUnderCustomerLimit = false;
        couponErrorMsg = 'يجب اختيار عميل لتطبيق الكوبون';
      } else {
        const customerUsages = useStore.getState().orders.filter(o => 
          (o.customer?.id === customerId || o.customer?.phone === customerPhone) && 
          o.coupon_code === appliedCoupon.code
        ).length;
        isUnderCustomerLimit = customerUsages < appliedCoupon.max_uses_per_customer;
        if (!isUnderCustomerLimit) {
            couponErrorMsg = 'تخطى العميل حد الاستخدام المسموح';
        }
      }
    }
    
    if (!isValidDate) couponErrorMsg = 'تاريخ الكوبون غير صالح';
    else if (!isUnderTotalLimit) couponErrorMsg = 'تخطى الكوبون إجمالي مرات الاستخدام';
    
    if (isValidDate && isUnderTotalLimit && isUnderCustomerLimit) {
      validCoupon = appliedCoupon;
      if (appliedCoupon.discount_type === 'percentage') {
        couponDiscountAmount = (subtotal - manualDiscount) * (appliedCoupon.discount_value / 100);
      } else {
        couponDiscountAmount = appliedCoupon.discount_value;
      }
    }
  }

  const totalDiscount = manualDiscount + couponDiscountAmount;
  const discountedSubtotal = Math.max(0, subtotal - totalDiscount);
  const tax = discountedSubtotal * (storeSettings.taxRate / 100);
  const total = discountedSubtotal + tax;
  const profit = discountedSubtotal - totalCost;


  // Sync customer debt calculation only
  useEffect(() => {
    if (!customerPhone && !customerId) {
      setCustomerDebt(0);
      return;
    }
    const existingCust = customers.find(c =>
      (customerPhone && c.phone === customerPhone) ||
      (customerId && (c.card_number === customerId || c.custom_id === customerId))
    );

    if (existingCust) {
      const cOrders = orders.filter(o => o.customer?.id === existingCust.id && !o.is_deleted);
      const cDebt = cOrders.reduce((sum, o) => {
        const debt = (o.type === 'payment' ? 0 : (o.total || 0)) - (o.paid_amount || 0);
        
        if (debt > 0.009 && o.type !== 'payment') {
          return sum + debt;
        } else if (o.type === 'payment' && !(o.notes && o.notes.includes('سداد أجل للفاتورة رقم'))) {
          return sum + debt;
        }
        return sum;
      }, 0);
      setCustomerDebt(cDebt > 0 ? cDebt : 0);
    } else {
      setCustomerDebt(0);
    }
  }, [customerPhone, customerId, orders, customers]);

  const handleReturnAll = async () => {
    if (!activeReturnOrder) return;

    const itemsSum = activeReturnOrder.items.reduce((sum: number, item: any) => sum + (item.quantity * item.sale_price), 0);
    const discountRatio = itemsSum > 0 ? activeReturnOrder.total / itemsSum : 1;

    // Total value of the goods being returned (after the invoice discount).
    const totalReturnValue = activeReturnOrder.items.reduce((sum: number, item: any) => {
      const available = Math.max(0, item.quantity - item.returned_quantity);
      return sum + (available * item.sale_price * discountRatio);
    }, 0);

    // For a deferred invoice, settle the outstanding debt first and only refund
    // the remainder as cash out of the drawer.
    const outstandingDebt = Math.max(0, activeReturnOrder.total - activeReturnOrder.paid_amount);
    const maxDebtDeduction = Math.min(totalReturnValue, outstandingDebt);
    const debtSettled = returnDebtDeduction === null
      ? maxDebtDeduction
      : Math.max(0, Math.min(returnDebtDeduction, maxDebtDeduction));
    const cashToRefund = Math.max(0, totalReturnValue - debtSettled);
    const cashRatio = totalReturnValue > 0 ? cashToRefund / totalReturnValue : 0;

    if (!confirm(
      `استرجاع الفاتورة بالكامل؟\n` +
      `قيمة المرتجع: ${totalReturnValue.toFixed(2)} ${storeSettings.currency}\n` +
      `يُخصم من المديونية: ${debtSettled.toFixed(2)} ${storeSettings.currency}\n` +
      `يُرد كاش للعميل: ${cashToRefund.toFixed(2)} ${storeSettings.currency}`
    )) return;

    const returnsArray = activeReturnOrder.items.map((item: any) => {
      const available = item.quantity - item.returned_quantity;
      const itemValue = available * item.sale_price * discountRatio;
      return {
        productId: item.id,
        returnQty: available,
        // Distribute the cash refund across items proportionally; the rest of
        // each item's value is implicitly settled against the customer's debt.
        refundAmount: itemValue * cashRatio
      };
    }).filter((r: any) => r.returnQty > 0);

    if (returnsArray.length > 0) {
      await processReturn(activeReturnOrder.id, returnsArray, cashToRefund > 0 ? refundMethod : 'cash');
      alert('تم استرجاع الفاتورة بالكامل بنجاح');
      const updatedOrder = useStore.getState().orders.find(o => o.id === activeReturnOrder.id);
      setActiveReturnOrder(updatedOrder);
      setPendingReturns({}); setReturnDebtDeduction(null); setRefundMethod('cash');
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomerPhone(val);
    if (val) {
      const match = customers.find(c => c.phone === val);
      if (match) {
        setCustomerName(match.name);
        setCustomerId(match.card_number || match.custom_id || '');
      }
    }
  };

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomerId(val);
    if (val) {
      const match = customers.find(c => c.card_number === val || c.custom_id === val);
      if (match) {
        setCustomerName(match.name);
        setCustomerPhone(match.phone);
      }
    }
  };


  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-900 transition-colors duration-300 overflow-hidden font-sans text-gray-900 dark:text-gray-100">

      {/* SUCCESS MODAL */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-[40px] shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-slate-700 animate-in zoom-in-95 duration-200">
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                <Banknote size={40} />
              </div>
              <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-2">تم الدفع بنجاح!</h2>
              <p className="text-slate-500 dark:text-slate-400 font-bold mb-6 font-mono text-lg">رقم الفاتورة: #{lastInvoiceId}</p>

              <div className="space-y-3">
                {lastCustomerInfo?.phone && (
                  <button
                    onClick={() => {
                      const sendWhatsApp = (invId: string, customerPhone: string, orderDetails: any) => {
                        if (!customerPhone.trim()) return;
                        let itemsText = orderDetails.cart.map((item: any) => `• ${item.name} (${formatQty(item.quantity, item.unit)}) - ${(item.sale_price * item.quantity).toFixed(2)} ${storeSettings.currency}`).join('\n');
                        const publicBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                          ? 'https://cashier-branch3.vercel.app'
                          : window.location.origin;
                        const invoiceLink = `${publicBaseUrl}/view-invoice/${invId}`;
                        const branchAddress = storeSettings.address || '';
                        const branchLocationLink = storeSettings.locationUrl || '';
                        const message = `*فاتورة جديدة من ${storeSettings.name}*\n\n` +
                          `*رقم الفاتورة:* #${invId}\n` +
                          `*التاريخ:* ${new Date().toLocaleString('ar-SA')}\n` +
                          (orderDetails.salesperson ? `*مسؤول المبيعات:* ${orderDetails.salesperson}\n` : '') +
                          `*الإجمالي:* ${orderDetails.total.toFixed(2)} ${storeSettings.currency}\n\n` +
                          `*عرض الفاتورة بالتفاصيل:*\n${invoiceLink}\n\n` +
                          `*تفاصيل الطلب:*\n${itemsText}\n\n` +
                          (branchAddress ? `*عنوان الفرع:* ${branchAddress}\n` : '') +
                          (branchLocationLink ? `*لوكيشن الفرع على Google Maps:*\n${branchLocationLink}\n` : '') +
                          `${(storeSettings.phone || storeSettings.phone2) ? `*للتواصل أو الشحن:* ${[storeSettings.phone, storeSettings.phone2].filter(Boolean).join(' - ')}\nيمكنكم التواصل هاتفيا أو واتساب، أو زيارة الفرع على العنوان الموضح.\n` : ''}` +
                          `\n*شكراً لتعاملكم معنا، في انتظاركم مرة أخرى!*\n` +
                          `*ما رأيك في خدمتنا؟ نسعد بتلقي ملاحظاتك.*`;
                        let cleanPhone = customerPhone.replace(/\D/g, '');
                        const code = storeSettings.whatsappCountryCode || '2';

                        // Generic cleaning: if it starts with 0, remove and add code. 
                        // If it doesn't have the code yet, add it.
                        if (cleanPhone.startsWith('0')) {
                          cleanPhone = code + cleanPhone.substring(1);
                        } else if (!cleanPhone.startsWith(code)) {
                          cleanPhone = code + cleanPhone;
                        }

                        const encodedMsg = encodeURIComponent(message);
                        window.open(`https://wa.me/${cleanPhone}?text=${encodedMsg}`, '_blank');
                      };
                      sendWhatsApp(lastInvoiceId, lastCustomerInfo.phone, lastOrderDetails);
                    }}
                    className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white py-4 rounded-2xl font-black flex items-center justify-center gap-3 transition-all shadow-lg scale-105"
                  >
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                    إرسال للفاتورة لواتساب
                  </button>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => printInvoice(lastInvoiceId, lastOrderDetails)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all border border-slate-200"
                  >
                    <Printer size={20} /> إعادة طباعة
                  </button>
                  <button
                    autoFocus
                    onClick={() => {
                      setShowSuccessModal(false);
                      clearCart();
                      focusById('pos-cust-name');
                    }}
                    className="flex-1 bg-slate-900 hover:bg-black text-white py-3.5 rounded-2xl font-bold transition-all focus:ring-4 focus:ring-slate-400"
                  >
                    إغلاق وفاتورة جديدة
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNoteModal && (
        <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-gray-200 dark:border-slate-700">
            <div className="p-6 bg-gradient-to-r from-blue-500 to-indigo-500 text-white flex justify-between items-center">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <MessageSquare size={24} /> إرسال رسالة للمدير
              </h2>
              <button onClick={() => setShowNoteModal(false)} className="hover:bg-white/20 p-2 rounded-full transition">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="اكتب رسالتك هنا وسيتم إرسالها فوراً للمدير عبر تليجرام..."
                className="w-full h-32 bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-bold placeholder-gray-400"
              />
              <button
                onClick={handleSendNote}
                disabled={!noteText.trim() || isSendingNote}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSendingNote ? 'جاري الإرسال...' : <><Send size={20} /> إرسال الآن</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFinanceModal && (
        <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-gray-200 dark:border-slate-700 max-h-[90vh]">
            <div className="p-6 bg-gradient-to-r from-emerald-500 to-teal-500 text-white flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Wallet size={24} /> معاملة مالية
              </h2>
              <button onClick={() => setShowFinanceModal(false)} className="hover:bg-white/20 p-2 rounded-full transition">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4 overflow-y-auto" dir="rtl">
              {/* Type Tabs */}
              <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-2xl">
                <button
                  onClick={() => setFinanceType('expense')}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${financeType === 'expense' ? 'bg-white dark:bg-slate-600 text-red-600 dark:text-red-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                >
                  مصروف
                </button>
                <button
                  onClick={() => setFinanceType('income')}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${financeType === 'income' ? 'bg-white dark:bg-slate-600 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                >
                  إيراد
                </button>
                <button
                  onClick={() => setFinanceType('transfer')}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${financeType === 'transfer' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                >
                  تحويل
                </button>
              </div>

              {financeType === 'transfer' ? (
                <>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">من وسيلة الدفع</label>
                    <select
                      className="w-full bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                      value={financeTransferFrom}
                      onChange={e => setFinanceTransferFrom(e.target.value)}
                    >
                      {activePayKeys.map((k) => <option key={k} value={k}>{payLabel(k)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">إلى وسيلة الدفع</label>
                    <select
                      className="w-full bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                      value={financeTransferTo}
                      onChange={e => setFinanceTransferTo(e.target.value)}
                    >
                      {activePayKeys.map((k) => <option key={k} value={k}>{payLabel(k)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">المبلغ</label>
                    <input
                      type="number" dir="ltr" placeholder="0.00"
                      className="w-full bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold text-right"
                      value={financeTransferAmount}
                      onChange={e => setFinanceTransferAmount(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{financeType === 'expense' ? 'فئة المصروف' : 'فئة الإيراد'}</label>
                    <select
                      className="w-full bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold"
                      value={financeCategory}
                      onChange={e => setFinanceCategory(e.target.value)}
                    >
                      {financeType === 'expense' ? (
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
                  <div className="grid grid-cols-2 gap-3">
                    {activePayKeys.map((k) => (
                      <div key={k}>
                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1 text-right">{payLabel(k)}</label>
                        <input type="number" dir="ltr" placeholder="0.00"
                          className="w-full bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 font-bold text-right"
                          value={financePay[k] || ''} onChange={e => setFinancePay((s) => ({ ...s, [k]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="bg-gray-100 dark:bg-slate-700 rounded-xl p-3 flex justify-between items-center">
                    <span className="text-sm font-bold text-slate-500 dark:text-slate-400">إجمالي المبلغ:</span>
                    <span className={`text-xl font-black ${financeType === 'income' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {financeTotal.toLocaleString()} {storeSettings.currency}
                    </span>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">ملاحظات</label>
                <textarea
                  value={financeNote}
                  onChange={(e) => setFinanceNote(e.target.value)}
                  placeholder="اكتب ملاحظاتك هنا..."
                  className="w-full h-20 bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none font-bold placeholder-gray-400"
                />
              </div>

              <button
                onClick={handleFinanceSubmit}
                disabled={isSubmittingFinance}
                className={`w-full font-black py-4 rounded-2xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white ${
                  financeType === 'transfer' ? 'bg-blue-600 hover:bg-blue-700' : financeType === 'income' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {isSubmittingFinance ? 'جاري الحفظ...' : financeType === 'transfer' ? 'تنفيذ التحويل' : 'تسجيل المعاملة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdvanceModal && canEmployeeAdvance && (
        <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-gray-200 dark:border-slate-700 max-h-[90vh]">
            <div className="p-6 bg-gradient-to-r from-amber-500 to-orange-500 text-white flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <HandCoins size={24} /> صرف سلفة لموظف
              </h2>
              <button onClick={() => { setShowAdvanceModal(false); resetAdvanceForm(); }} className="hover:bg-white/20 p-2 rounded-full transition">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4 overflow-y-auto" dir="rtl">
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">الموظف</label>
                <select
                  className="w-full bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-500 font-bold"
                  value={advanceEmpId}
                  onChange={(e) => setAdvanceEmpId(e.target.value)}
                >
                  <option value="">— اختر الموظف —</option>
                  {employees.filter((emp: any) => emp.is_active !== false).map((emp: any) => (
                    <option key={emp.id} value={emp.id}>{emp.name}{emp.job_title ? ` (${emp.job_title})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">طريقة صرف السلفة (المبلغ)</label>
                <div className="grid grid-cols-2 gap-3">
                  {activePayKeys.map((k) => (
                    <div key={k}>
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1 text-right">{payLabel(k)}</label>
                      <input type="number" dir="ltr" placeholder="0.00"
                        className="w-full bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 font-bold text-right"
                        value={advancePay[k] || ''} onChange={(e) => setAdvance(k, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-100 dark:bg-slate-700 rounded-xl p-3 flex justify-between items-center">
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400">إجمالي السلفة:</span>
                <span className="text-xl font-black text-amber-600">{advanceTotal.toLocaleString()} {storeSettings.currency}</span>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">سبب / ملاحظة السلفة</label>
                <textarea
                  value={advanceNote}
                  onChange={(e) => setAdvanceNote(e.target.value)}
                  placeholder="مثال: سلفة مقدمة على الراتب..."
                  className="w-full h-20 bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none font-bold placeholder-gray-400"
                />
              </div>

              <p className="text-[11px] text-amber-700 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2 text-center">سيتم خصم السلفة تلقائياً من راتب هذا الشهر للموظف.</p>

              <button
                onClick={handleAdvanceSubmit}
                disabled={isSubmittingAdvance}
                className="w-full font-black py-4 rounded-2xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white bg-amber-600 hover:bg-amber-700"
              >
                {isSubmittingAdvance ? 'جاري الصرف...' : <><HandCoins size={20} /> صرف السلفة</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBarcodeModal && canBarcodePrint && (
        <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-gray-200 dark:border-slate-700 max-h-[90vh]">
            <div className="p-6 bg-gradient-to-r from-slate-700 to-slate-900 text-white flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ScanLine size={24} /> طباعة باركود منتج
              </h2>
              <button onClick={() => { setShowBarcodeModal(false); setBarcodeSearch(''); setBarcodeProductId(''); setBarcodeCount('1'); }} className="hover:bg-white/20 p-2 rounded-full transition">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4 overflow-y-auto" dir="rtl">
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">ابحث عن المنتج (بالاسم أو الباركود)</label>
                <div className="relative">
                  <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    autoFocus
                    value={barcodeSearch}
                    onChange={(e) => { setBarcodeSearch(e.target.value); setBarcodeProductId(''); }}
                    placeholder="اكتب اسم المنتج..."
                    className="w-full bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl pr-10 pl-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-500 font-bold"
                  />
                </div>
              </div>

              <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                {barcodeMatches.length === 0 ? (
                  <p className="text-center text-slate-400 py-6 text-sm font-bold">لا توجد منتجات مطابقة</p>
                ) : barcodeMatches.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setBarcodeProductId(p.id); setBarcodeCount(String(Math.max(1, Math.floor(Number(p.stock_quantity) || 1)))); }}
                    className={`w-full text-right px-4 py-2.5 flex items-center justify-between gap-2 transition ${barcodeProductId === p.id ? 'bg-slate-800 text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                  >
                    <span className="font-bold text-sm truncate">{p.name}</span>
                    <span className={`text-[11px] font-mono shrink-0 ${barcodeProductId === p.id ? 'text-slate-200' : 'text-slate-400'}`}>{p.barcode || 'بدون باركود'}</span>
                  </button>
                ))}
              </div>

              {barcodeProduct && (
                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300 truncate">{barcodeProduct.name}</span>
                  <span className="text-sm font-black text-slate-800 dark:text-slate-100 shrink-0">{barcodeProduct.sale_price.toLocaleString()} {storeSettings.currency}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">عدد الملصقات المطلوب طباعتها</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setBarcodeCount(String(Math.max(1, (parseInt(barcodeCount) || 1) - 1)))} className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 font-black text-xl hover:bg-slate-200">−</button>
                  <input
                    type="number" min="1" dir="ltr"
                    value={barcodeCount}
                    onChange={(e) => setBarcodeCount(e.target.value)}
                    className="flex-1 bg-gray-100 dark:bg-slate-700 dark:text-white border-none rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-500 font-black text-center text-lg"
                  />
                  <button onClick={() => setBarcodeCount(String((parseInt(barcodeCount) || 0) + 1))} className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 font-black text-xl hover:bg-slate-200">+</button>
                </div>
              </div>

              <button
                onClick={handlePrintBarcode}
                disabled={!barcodeProduct}
                className="w-full font-black py-4 rounded-2xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white bg-slate-800 hover:bg-slate-900"
              >
                <Printer size={20} /> طباعة الباركود
              </button>
            </div>
          </div>
        </div>
      )}

      {showDayBudget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3" onClick={() => setShowDayBudget(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="bg-emerald-600 text-white px-5 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black flex items-center gap-2"><Banknote size={22} /> تقفيل اليوم (عرض)</h2>
              <button onClick={() => setShowDayBudget(false)} className="hover:bg-white/20 p-1.5 rounded-lg"><X size={22} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-sm font-bold text-slate-600 dark:text-slate-300">التاريخ:</label>
                <input type="date" value={dayBudgetDate} onChange={(e) => setDayBudgetDate(e.target.value)} className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 font-bold text-sm" />
                <button onClick={() => setDayBudgetDate(todayStr())} className="text-xs font-bold text-emerald-600 hover:underline">اليوم</button>
              </div>
              {dayBudgetLoading || !dayBudget ? (
                <p className="text-center text-slate-400 py-10 font-bold">جاري الحساب...</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-100 dark:bg-slate-900/40 rounded-xl p-4 text-center">
                      <div className="text-[11px] font-bold text-slate-500">رصيد بداية اليوم</div>
                      <div className="text-xl font-black text-slate-800 dark:text-slate-100">{dayBudget.opening.toFixed(2)}</div>
                    </div>
                    <div className="bg-emerald-600 text-white rounded-xl p-4 text-center">
                      <div className="text-[11px] font-bold opacity-90">رصيد نهاية اليوم</div>
                      <div className="text-xl font-black">{dayBudget.closing.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center border border-green-100 dark:border-green-800"><div className="text-[11px] font-bold text-green-700 dark:text-green-400">إجمالي الداخل</div><div className="text-lg font-black text-green-700 dark:text-green-400">{dayBudget.totalIn.toFixed(2)}</div></div>
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center border border-red-100 dark:border-red-800"><div className="text-[11px] font-bold text-red-700 dark:text-red-400">إجمالي الخارج</div><div className="text-lg font-black text-red-700 dark:text-red-400">{dayBudget.totalOut.toFixed(2)}</div></div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-500 mb-2">الرصيد الحالي الفعلي في الخزنة (بالتقسيمة):</div>
                    <div className="grid grid-cols-2 gap-3">
                      {activePayKeys.map((k) => {
                        const bal = (dayBudget.shopAvail?.[k]) ?? (dayBudget.dayIn[k] - dayBudget.dayOut[k]);
                        const net = dayBudget.dayIn[k] - dayBudget.dayOut[k];
                        return (
                          <div key={k} className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                            <div className="text-[11px] font-bold text-slate-500">{payLabel(k)}</div>
                            <div className={`text-lg font-black ${bal < 0 ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{bal.toFixed(2)} {storeSettings.currency}</div>
                            <div className="text-[10px] text-slate-400">صافي اليوم: {net.toFixed(2)} (داخل {dayBudget.dayIn[k].toFixed(2)} · خارج {dayBudget.dayOut[k].toFixed(2)})</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 text-center">اليوم من 12 منتصف الليل إلى 12 منتصف الليل.</p>

                  {/* Transfer to savings */}
                  {perm('savings') && (
                  <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
                    {!showSaveXfer ? (
                      <button onClick={() => { setShowSaveXfer(true); const a = dayBudget.shopAvail || {}; setSaveXfer({ cash: String(Math.max(0, a.cash || 0) || ''), visa: String(Math.max(0, a.visa || 0) || ''), wallet: String(Math.max(0, a.wallet || 0) || ''), instapay: String(Math.max(0, a.instapay || 0) || '') }); }} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-xl flex items-center justify-center gap-2">🏦 تحويل لخزنة الادخار</button>
                    ) : (
                      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-black text-indigo-800 dark:text-indigo-300">تحويل لخزنة الادخار</span>
                          <button onClick={() => { setShowSaveXfer(false); setSaveXferSent(false); }} className="text-xs font-bold text-slate-500">إغلاق</button>
                        </div>
                        <p className="text-[11px] text-slate-500">المبالغ مملوءة بكامل الموجود في خزنة المحل — عدّليها لو عايزة مبلغ محدد (مش أكبر من المتاح). كل طريقة بتتحوّل بنفسها.</p>
                        <div className="grid grid-cols-2 gap-2">
                          {PAY_KEYS.map(([k]) => (
                            <div key={k}>
                              <label className="text-[11px] font-bold text-slate-500">{payLabel(k)} <span className="text-slate-400">(متاح {((dayBudget.shopAvail?.[k]) || 0).toFixed(0)})</span></label>
                              <input className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-bold" type="number" min="0" value={saveXfer[k]} onChange={(e) => { setSaveXfer((s) => ({ ...s, [k]: e.target.value })); setSaveXferSent(false); }} />
                            </div>
                          ))}
                        </div>
                        <div className="text-center font-black text-slate-700 dark:text-slate-200">الإجمالي: {saveXferTotal.toFixed(2)} {storeSettings.currency}</div>
                        {!saveXferSent ? (
                          <button onClick={saveXferRequest} disabled={saveXferBusy} className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-black py-2.5 rounded-xl">{saveXferBusy ? 'جاري...' : '📲 إرسال للمدير وطلب رمز التأكيد'}</button>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <input className="flex-1 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-700 rounded-lg px-3 py-2 text-center font-black tracking-widest" dir="ltr" placeholder="رمز التأكيد" value={saveXferOtp} onChange={(e) => setSaveXferOtp(e.target.value)} />
                              <button onClick={saveXferConfirm} disabled={saveXferBusy} className="shrink-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black px-4 rounded-lg">تأكيد</button>
                            </div>
                            <button onClick={saveXferRequest} disabled={saveXferBusy} className="text-[11px] font-bold text-amber-700">إعادة إرسال الرمز</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3" onClick={() => setShowHistory(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-indigo-600 text-white px-5 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black flex items-center gap-2"><FileText size={22} /> {historyToday ? 'فواتير اليوم' : 'كل الفواتير'}</h2>
              <button onClick={() => setShowHistory(false)} className="hover:bg-white/20 p-1.5 rounded-lg"><X size={22} /></button>
            </div>
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 space-y-3">
              <div className="flex gap-2">
                <button onClick={() => setHistoryToday(true)} className={`flex-1 py-2 rounded-xl text-sm font-black transition ${historyToday ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>اليوم</button>
                <button onClick={() => setHistoryToday(false)} className={`flex-1 py-2 rounded-xl text-sm font-black transition ${!historyToday ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>الكل</button>
              </div>
              <div className="relative">
                <Search className="absolute right-3 top-3 text-slate-400" size={18} />
                <input
                  autoFocus
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="ابحث برقم الفاتورة أو اسم العميل أو رقم التليفون..."
                  className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 pr-10 pl-3 text-sm font-semibold focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {(() => {
                const q = historySearch.trim().toLowerCase();
                const todayStr = new Date().toDateString();
                const list = orders
                  .filter((o) => !o.is_deleted && o.type !== 'payment')
                  .filter((o) => !historyToday || new Date(o.date).toDateString() === todayStr)
                  .filter((o) => !q || o.id.toLowerCase().includes(q) || (o.customer?.name || '').toLowerCase().includes(q) || (o.customer?.phone || '').includes(q))
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .slice(0, 100);
                if (list.length === 0) return <p className="text-center text-slate-400 py-10 font-bold">لا توجد فواتير</p>;
                return list.map((o) => (
                  <div key={o.id} className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-black text-slate-800 dark:text-slate-100 text-sm">#{o.id} · {o.customer?.name || 'عميل نقدي'}</p>
                        <p className="text-[11px] text-slate-500">{new Date(o.date).toLocaleString('ar-EG')} · الإجمالي: <b>{(o.total || 0).toFixed(2)} {storeSettings.currency}</b>{(o.total - o.paid_amount) > 0.5 ? ` · باقي: ${(o.total - o.paid_amount).toFixed(2)}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => window.open(`/view-invoice/${o.id}`, '_blank')} className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300">عرض</button>
                        <button onClick={() => reprintOrder(o)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 flex items-center gap-1"><Printer size={14} /> طباعة</button>
                        <button onClick={() => sendOrderWhatsApp(o)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#25D366] text-white hover:bg-[#1da851]">واتساب</button>
                        {o.exchange_data ? (
                          <button onClick={() => setViewExchange(o)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 flex items-center gap-1"><Eye size={14} /> تم الاستبدال</button>
                        ) : perm('editDelete') && (
                          <button onClick={() => openEditOrder(o)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 flex items-center gap-1"><RefreshCcw size={14} /> استبدال</button>
                        )}
                        {perm('editDelete') && (
                          <button onClick={() => deleteOrderWithOtp(o)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 flex items-center gap-1"><Trash2 size={14} /> حذف</button>
                        )}
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {editingOrder && (
        <EditInvoiceModal invoice={editingOrder} onClose={() => setEditingOrder(null)} requireOtp exchangeMode />
      )}

      {viewExchange && (() => {
        const ex = viewExchange.exchange_data || {};
        const cur = storeSettings.currency;
        const list = (arr: any[]) => (arr || []).map((i: any, idx: number) => (
          <div key={idx} className="flex justify-between text-sm py-1 border-b border-slate-100 dark:border-slate-700/50">
            <span className="font-bold text-slate-700 dark:text-slate-200">{i.name} ×{i.quantity}</span>
            <span>{((Number(i.sale_price) || 0) * (Number(i.quantity) || 0)).toFixed(2)}</span>
          </div>
        ));
        const diff = Number(ex.diff) || 0;
        return (
          <div className="fixed inset-0 bg-black/50 z-[160] flex items-center justify-center p-3" onClick={() => setViewExchange(null)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="bg-slate-700 text-white px-5 py-4 flex items-center justify-between">
                <h2 className="text-lg font-black flex items-center gap-2"><RefreshCcw size={18} /> تفاصيل استبدال #{viewExchange.id}</h2>
                <button onClick={() => setViewExchange(null)} className="hover:bg-white/20 p-1.5 rounded-lg"><X size={22} /></button>
              </div>
              <div className="p-4 overflow-y-auto space-y-4">
                <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 border border-red-100 dark:border-red-800">
                  <div className="text-xs font-black text-red-600 mb-1">قبل الاستبدال — الإجمالي: {(Number(ex.oldTotal) || 0).toFixed(2)} {cur}</div>
                  {list(ex.before)}
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-100 dark:border-emerald-800">
                  <div className="text-xs font-black text-emerald-700 mb-1">بعد الاستبدال — الإجمالي: {(Number(ex.newTotal) || 0).toFixed(2)} {cur}</div>
                  {list(ex.after)}
                </div>
                <div className={`rounded-xl p-3 text-center font-black ${Math.abs(diff) < 0.01 ? 'bg-slate-100 dark:bg-slate-900/40 text-slate-600' : diff > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {Math.abs(diff) < 0.01 ? 'لا يوجد فرق' : `${diff > 0 ? 'تم تحصيل' : 'تم رد'}: ${Math.abs(diff).toFixed(2)} ${cur}`}
                  {ex.date ? <div className="text-[11px] font-bold text-slate-500 mt-1">{new Date(ex.date).toLocaleString('ar-EG')}</div> : null}
                </div>
                <button onClick={() => reprintOrder(viewExchange)} className="w-full bg-indigo-600 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2"><Printer size={16} /> طباعة الفاتورة الحالية</button>
              </div>
            </div>
          </div>
        );
      })()}

      {showDebtModal && (
        <div className="fixed inset-0 bg-black/50 z-[150] flex items-center justify-center p-3" onClick={() => setShowDebtModal(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-amber-500 text-white px-5 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black flex items-center gap-2"><CreditCard size={20} /> سداد آجل للعملاء</h2>
              <button onClick={() => setShowDebtModal(false)} className="hover:bg-white/20 p-1.5 rounded-lg"><X size={22} /></button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              {!selectedDebtCustomer ? (
                <>
                  <input autoFocus value={debtSearch} onChange={(e) => setDebtSearch(e.target.value)} placeholder="ابحث باسم العميل أو رقم التليفون..." className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-amber-500" />
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {debtFiltered.length === 0 ? <p className="text-center text-slate-400 py-8 font-bold">لا يوجد عملاء عليهم آجل</p>
                      : debtFiltered.map((c) => (
                        <button key={c.id} onClick={() => { setDebtCustId(c.id); setDebtAmount(String(c.debt.toFixed(2))); }} className="w-full text-right bg-slate-50 dark:bg-slate-900/40 hover:bg-amber-50 rounded-xl p-3 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                          <div><p className="font-black text-slate-800 dark:text-slate-100 text-sm">{c.name}</p><p className="text-[11px] text-slate-500" dir="ltr">{c.phone || '—'}</p></div>
                          <span className="bg-red-500 text-white text-xs font-black px-2.5 py-1 rounded-lg">{c.debt.toFixed(2)} {storeSettings.currency}</span>
                        </button>
                      ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 flex items-center justify-between">
                    <div><p className="font-black text-slate-800 dark:text-slate-100">{selectedDebtCustomer.name}</p><p className="text-[11px] text-slate-500" dir="ltr">{selectedDebtCustomer.phone || '—'}</p></div>
                    <button onClick={() => { setDebtCustId(''); setDebtAmount(''); }} className="text-xs font-bold text-amber-600">تغيير</button>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-center">
                    <div className="text-[11px] font-bold text-red-600">إجمالي المديونية</div>
                    <div className="text-2xl font-black text-red-700">{selectedDebtCustomer.debt.toFixed(2)} {storeSettings.currency}</div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-1">المبلغ المدفوع</label>
                    <input autoFocus type="number" value={debtAmount} onChange={(e) => setDebtAmount(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-3 px-3 text-lg font-black outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-1">طريقة الدفع</label>
                    <select value={debtMethod} onChange={(e) => setDebtMethod(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 px-3 text-sm font-bold outline-none">
                      <option value="cash">{payLabel('cash')}</option><option value="visa">{payLabel('visa')}</option><option value="wallet">{payLabel('wallet')}</option><option value="instapay">{payLabel('instapay')}</option>
                    </select>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-900 rounded-xl p-3 text-center">
                    <span className="text-xs font-bold text-slate-500">المتبقي بعد السداد: </span>
                    <span className="font-black text-slate-800 dark:text-slate-100">{Math.max(0, selectedDebtCustomer.debt - (Number(debtAmount) || 0)).toFixed(2)} {storeSettings.currency}</span>
                  </div>
                  <button onClick={submitDebtPayment} disabled={debtSaving} className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-black py-3 rounded-xl flex items-center justify-center gap-2">
                    <Printer size={18} /> {debtSaving ? 'جاري...' : 'تأكيد السداد وطباعة الإيصال'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showReturnsModal && (
        <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-start md:items-center justify-center p-4 pt-8 md:pt-4 pb-20 md:pb-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col border border-gray-200 dark:border-slate-700">
            <div className="p-6 bg-gradient-to-r from-red-500 to-orange-500 text-white flex justify-between items-center">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ArrowRightLeft size={24} /> نظام المرتجعات
              </h2>
              <button onClick={() => setShowReturnsModal(false)} className="hover:bg-white/20 p-2 rounded-full transition">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 flex-1 flex flex-col gap-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="أدخل رقم الفاتورة للبحث..."
                  className="flex-1 bg-gray-100 dark:bg-slate-700 dark:text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono text-left"
                  dir="ltr"
                  value={returnSearchQuery}
                  onChange={(e) => setReturnSearchQuery(e.target.value)}
                />
                <button onClick={handleSearchOrder} className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-xl font-bold transition shadow-lg shrink-0">بحث برقم الفاتورة</button>
              </div>

              {activeReturnOrder && (() => {
                const itemsSum = activeReturnOrder.items.reduce((sum: number, item: any) => sum + (item.quantity * item.sale_price), 0);
                const discountRatio = itemsSum > 0 ? activeReturnOrder.total / itemsSum : 1;
                
                // calculate past refunds
                const pastRefunds = activeReturnOrder.items.reduce((sum: number, item: any) => sum + (item.refunded_amount || 0), 0);

                // Value of goods selected for return, and how it splits between
                // settling the customer's debt and cash refunded to them.
                const selectedReturnValue = Object.keys(pendingReturns).reduce((s, pid) => {
                  const pr = pendingReturns[pid];
                  const it = activeReturnOrder.items.find((i: any) => i.id === pid);
                  return it ? s + ((pr.returnQty || 0) * it.sale_price * discountRatio) : s;
                }, 0);
                const outstandingDebt = Math.max(0, activeReturnOrder.total - activeReturnOrder.paid_amount);
                const maxDebtDeduction = Math.min(selectedReturnValue, outstandingDebt);
                const debtSettled = returnDebtDeduction === null
                  ? maxDebtDeduction
                  : Math.max(0, Math.min(returnDebtDeduction, maxDebtDeduction));
                const cashToCustomer = Math.max(0, selectedReturnValue - debtSettled);

                return (
                  <>
                    {/* Financial Summary Card */}
                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">العميل</span>
                        <span className="text-sm font-black text-slate-800 dark:text-slate-200">{activeReturnOrder.customer?.name || 'عميل نقدي'}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">إجمالي الفاتورة (بعد الخصم)</span>
                        <span className="text-sm font-black text-slate-800 dark:text-slate-200">{activeReturnOrder.total.toFixed(2)} {storeSettings.currency}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">المبلغ المدفوع</span>
                        <span className="text-sm font-black text-green-600 dark:text-green-400">{activeReturnOrder.paid_amount.toFixed(2)} {storeSettings.currency}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">نسبة خصم الفاتورة</span>
                        <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">{((1 - discountRatio) * 100).toFixed(1)}%</span>
                      </div>
                    </div>

                    {/* Return split: debt settlement vs cash to customer */}
                    {selectedReturnValue > 0 && (
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-700">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">قيمة المرتجع</div>
                          <div className="text-lg font-black text-slate-800 dark:text-slate-200">{selectedReturnValue.toFixed(2)}</div>
                        </div>
                        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center border border-amber-200 dark:border-amber-800">
                          <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">يُخصم من المديونية</div>
                          {maxDebtDeduction > 0 ? (
                            <>
                              <input
                                type="number"
                                min="0"
                                max={maxDebtDeduction}
                                step="0.01"
                                value={Number(debtSettled.toFixed(2))}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  setReturnDebtDeduction(isNaN(v) ? 0 : Math.max(0, Math.min(v, maxDebtDeduction)));
                                }}
                                className="w-full mt-1 bg-white dark:bg-slate-700 border border-amber-300 dark:border-amber-700 rounded-lg px-2 py-1 text-center text-lg font-black text-amber-700 dark:text-amber-400 focus:ring-2 focus:ring-amber-400 outline-none"
                              />
                              <div className="flex gap-1 mt-1 justify-center">
                                <button type="button" onClick={() => setReturnDebtDeduction(0)} className="text-[9px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200">بدون خصم</button>
                                <button type="button" onClick={() => setReturnDebtDeduction(null)} className="text-[9px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200">تلقائي</button>
                              </div>
                            </>
                          ) : (
                            <div className="text-lg font-black text-amber-700 dark:text-amber-400">{debtSettled.toFixed(2)}</div>
                          )}
                        </div>
                        <div className="bg-emerald-500 text-white rounded-xl p-3 text-center shadow-lg shadow-emerald-200 dark:shadow-none">
                          <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">تدّي العميل</div>
                          <div className="text-lg font-black">{cashToCustomer.toFixed(2)}</div>
                          {cashToCustomer > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2 justify-center">
                              {([['cash', 'كاش'], ['visa', 'فيزا'], ['wallet', 'محفظة'], ['instapay', 'انستا']] as const).map(([m, label]) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setRefundMethod(m)}
                                  className={`text-[9px] font-bold px-2 py-0.5 rounded transition ${refundMethod === m ? 'bg-white text-emerald-700' : 'bg-emerald-600/60 text-white hover:bg-emerald-600'}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex-1 border border-gray-200 dark:border-slate-700 flex flex-col rounded-xl overflow-hidden">
                      <div className="bg-gray-100 dark:bg-slate-700 p-4 flex justify-between items-center border-b border-gray-200 dark:border-slate-600">
                        <div className="flex flex-col">
                          <span className="font-bold text-gray-700 dark:text-gray-200 font-mono tracking-wider">الأصناف المتاحة للإرجاع</span>
                          <span className="text-[10px] text-slate-500 font-bold">رقم الفاتورة: #{activeReturnOrder.id} | المرتجع مسبقاً: {pastRefunds.toFixed(2)} {storeSettings.currency}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleReturnAll}
                            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-black shadow-lg transition-all"
                          >
                            إرجاع الفاتورة بالكامل
                          </button>
                          <button
                            onClick={handleConfirmReturns}
                            disabled={Object.values(pendingReturns).filter(pr => pr.returnQty > 0).length === 0}
                            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-black shadow-lg transition-all"
                          >
                            تأكيد المرتجعات المحددة
                          </button>
                        </div>
                      </div>
                      <div className="p-4 space-y-3 max-h-72 overflow-y-auto hide-scrollbar">
                        {activeReturnOrder.items.map((item: any) => {
                          const available = item.quantity - item.returned_quantity;
                          const effectivePrice = item.sale_price * discountRatio;
                          const pr = pendingReturns[item.id] || { returnQty: 0, refundAmount: 0, returnType: 'cash' };

                          return (
                            <div key={item.id} className="flex flex-col md:flex-row justify-between items-start md:items-center p-4 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-600 rounded-xl shadow-sm hover:shadow-md transition-shadow gap-4">
                              <div className="flex flex-col flex-1">
                                <span className="font-bold text-md text-gray-800 dark:text-gray-100">{item.name}</span>
                                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                                  <span>مباع: {item.quantity}</span>
                                  <span>مسترجع مسبقاً: <span className="text-red-500 font-bold">{item.returned_quantity}</span></span>
                                  <span>سعر الوحدة الأصلي: {item.sale_price.toFixed(2)}</span>
                                  <span className="text-indigo-500 font-bold">سعر الوحدة بعد الخصم: {effectivePrice.toFixed(2)}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 w-full md:w-auto">
                                <div className="flex flex-col gap-1 w-24">
                                  <label className="text-[10px] font-bold text-slate-500">كمية الإرجاع</label>
                                  <input 
                                    type="number" 
                                    min="0" 
                                    max={available}
                                    value={pr.returnQty || ''}
                                    onChange={(e) => {
                                      let qty = parseInt(e.target.value) || 0;
                                      if (qty > available) qty = available;
                                      if (qty < 0) qty = 0;
                                      setPendingReturns(prev => ({
                                        ...prev,
                                        [item.id]: {
                                          returnQty: qty,
                                          refundAmount: prev[item.id]?.returnType === 'debt' ? 0 : qty * effectivePrice,
                                          returnType: prev[item.id]?.returnType || 'cash'
                                        }
                                      }));
                                    }}
                                    className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-center font-bold focus:ring-2 focus:ring-red-500 outline-none"
                                    placeholder="0"
                                    disabled={available === 0}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col h-full pb-16 lg:pb-0 bg-white dark:bg-slate-900 shadow-2xl z-10 w-full lg:w-2/3 ${mobileView === 'cart' ? 'hidden lg:flex' : 'flex'}`}>
        <header className="flex flex-col p-3 md:p-5 gap-4 border-b border-gray-100 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
          {/* Top Row: Avatar (Right), Text (Center), Dark Mode (Left) */}
          <div className="flex justify-between items-start w-full">
            {/* Right: Avatar and Message */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative group cursor-pointer" onClick={() => { if (confirm('هل تريد تسجيل الخروج؟')) { logoutPOS(); navigate('/pos-login'); } }}>
                <img src={activeCashier?.photo_url || storeSettings.logo} alt="Logo" className="w-12 h-12 object-contain rounded-xl shadow-md border border-gray-100 dark:border-slate-700 bg-white p-0.5 group-hover:scale-110 transition-transform" />
                <div className="absolute -bottom-1 -right-1 bg-green-500 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900"></div>
              </div>
              <button 
                onClick={() => setShowNoteModal(true)}
                className="w-12 h-12 flex items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors shadow-sm border border-blue-100 dark:border-blue-800/50"
                title="إرسال رسالة للمدير"
              >
                <MessageSquare size={20} />
              </button>
              <button
                onClick={() => setShowFinanceModal(true)}
                className="w-12 h-12 flex items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors shadow-sm border border-emerald-100 dark:border-emerald-800/50"
                title="معاملة مالية"
              >
                <Wallet size={20} />
              </button>
              {canEmployeeAdvance && (
                <button
                  onClick={() => setShowAdvanceModal(true)}
                  className="w-12 h-12 flex items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors shadow-sm border border-amber-100 dark:border-amber-800/50"
                  title="صرف سلفة لموظف"
                >
                  <HandCoins size={20} />
                </button>
              )}
              {canBarcodePrint && (
                <button
                  onClick={() => setShowBarcodeModal(true)}
                  className="w-12 h-12 flex items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/70 transition-colors shadow-sm border border-slate-200 dark:border-slate-700"
                  title="طباعة باركود منتج"
                >
                  <ScanLine size={20} />
                </button>
              )}
            </div>

            {/* Center: Text & Badges */}
            <div className="flex flex-col items-center flex-1 px-2 text-center">
              <div className="flex flex-col md:flex-row items-center gap-2 mb-1">
                <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-l from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 leading-tight">
                  أهلاً، {activeCashier?.name?.split(' ')[0] || 'المحاسب'}
                </h1>
                
                {/* Offline Status Badge */}
                {!isOnline ? (
                  <span className="bg-red-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse shadow-sm">
                    🔴 أوفلاين ({offlineQueue.length + offlineReturnsQueue.length} محلياً)
                  </span>
                ) : isSyncing ? (
                  <span className="bg-amber-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                    ⏳ جاري الرفع...
                  </span>
                ) : (offlineQueue.length > 0 || offlineReturnsQueue.length > 0) ? (
                  <button 
                    onClick={() => { syncOfflineQueue(); syncOfflineReturnsQueue(); }}
                    className="bg-indigo-600 text-white hover:bg-indigo-700 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1 transition shadow-sm"
                  >
                    🔁 مزامنة ({offlineQueue.length + offlineReturnsQueue.length} معاملات)
                  </button>
                ) : (
                  <span className="bg-emerald-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                    🟢 متصل
                  </span>
                )}
              </div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-tight">{storeSettings.name}</span>
            </div>

            {/* Left: Dark Mode Toggle */}
            <button onClick={toggleTheme} className="p-3 lg:p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 transition shadow-sm shrink-0">
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>

          {/* Bottom Row: Camera (Right), Scanner/Search (Center), Returns (Left) */}
          <div className="flex items-center justify-between gap-2 lg:gap-4 w-full">
            {/* Right: Camera Button */}
            <button 
              onClick={() => setShowCameraScanner(true)}
              className="p-3 lg:p-3.5 rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800 hover:bg-indigo-100 transition shadow-sm flex items-center justify-center shrink-0 w-[44px] h-[44px] lg:w-[52px] lg:h-[52px]"
              title="مسح بالكاميرا"
            >
              <Camera size={20} />
            </button>

            {/* Center: Barcode Scanner & Search */}
            <div className="flex-1 flex gap-2 lg:gap-4 justify-center max-w-2xl">
              <div className="relative w-full group flex-1">
                 <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full z-10 shadow-sm opacity-0 group-focus-within:opacity-100 transition-opacity whitespace-nowrap">SCAN (Enter)</span>
                 <div className={`relative flex items-center border-2 rounded-2xl transition-colors bg-white dark:bg-slate-800 h-[44px] lg:h-[52px] w-full ${scanStatus === 'success' ? 'border-emerald-500 ring-2 ring-emerald-200' : scanStatus === 'error' ? 'border-red-500 ring-2 ring-red-200' : 'border-indigo-200 dark:border-slate-700 focus-within:border-indigo-500 shadow-inner'}`}>
                   <ScanLine className={`absolute right-2 lg:right-3 ${scanStatus === 'success' ? 'text-emerald-500' : scanStatus === 'error' ? 'text-red-500' : 'text-indigo-500'}`} size={18} />
                   <input
                     type="text"
                     dir="ltr"
                     placeholder="قارئ الباركود"
                     className="w-full bg-transparent border-none h-full pr-8 lg:pr-10 pl-2 lg:pl-3 text-xs lg:text-sm focus:outline-none focus:ring-0 font-mono font-bold placeholder-indigo-300 dark:placeholder-slate-500 text-indigo-700 dark:text-indigo-400 text-center"
                     value={barcodeInput}
                     onChange={e => setBarcodeInput(e.target.value)}
                     onKeyDown={handleBarcodeScan}
                   />
                 </div>
              </div>

              {/* Desktop Only Search */}
              <div className="relative flex-1 hidden lg:block">
                <Search className="absolute right-4 top-3.5 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder="ابحث باسم المنتج..."
                  style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
                  className="w-full h-[52px] bg-slate-100 dark:bg-slate-800 dark:text-white border-none rounded-2xl py-3.5 pr-12 pl-4 text-sm focus:outline-none focus:ring-2 shadow-inner transition"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Left: Invoices history + Returns Button */}
            {perm('invoices') && (
            <button onClick={() => setShowHistory(true)} className="flex items-center justify-center gap-1.5 lg:gap-2 px-3 lg:px-5 h-[44px] lg:h-[52px] bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 rounded-2xl font-bold transition border border-indigo-100 dark:border-indigo-900/30 whitespace-nowrap shadow-sm shrink-0">
              <FileText size={18} /> <span className="text-sm">الفواتير</span>
            </button>
            )}
            {perm('debt') && (
            <button onClick={() => setShowDebtModal(true)} className="flex items-center justify-center gap-1.5 lg:gap-2 px-3 lg:px-5 h-[44px] lg:h-[52px] bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 rounded-2xl font-bold transition border border-amber-100 dark:border-amber-900/30 whitespace-nowrap shadow-sm shrink-0">
              <CreditCard size={18} /> <span className="text-sm">سداد آجل</span>
            </button>
            )}
            {perm('dayClosing') && (
            <button onClick={() => setShowDayBudget(true)} className="flex items-center justify-center gap-1.5 lg:gap-2 px-3 lg:px-5 h-[44px] lg:h-[52px] bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 rounded-2xl font-bold transition border border-emerald-100 dark:border-emerald-900/30 whitespace-nowrap shadow-sm shrink-0">
              <Banknote size={18} /> <span className="text-sm">تقفيل اليوم</span>
            </button>
            )}
            {perm('returns') && (
            <button onClick={() => setShowReturnsModal(true)} className="flex items-center justify-center gap-1.5 lg:gap-2 px-3 lg:px-5 h-[44px] lg:h-[52px] bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 rounded-2xl font-bold transition border border-red-100 dark:border-red-900/30 whitespace-nowrap shadow-sm shrink-0">
              <RefreshCcw size={18} /> <span className="text-sm">مرتجع</span>
            </button>
            )}
            {perm('held') && (
            <button onClick={() => setShowHeldModal(true)} className="relative flex items-center justify-center gap-1.5 lg:gap-2 px-3 lg:px-5 h-[44px] lg:h-[52px] bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 rounded-2xl font-bold transition border border-orange-100 dark:border-orange-900/30 whitespace-nowrap shadow-sm shrink-0">
              <Clock size={18} /> <span className="text-sm">فواتير معلقة</span>
              {heldInvoices.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 flex items-center justify-center text-[10px] font-black text-white bg-orange-500 rounded-full shadow">{heldInvoices.length}</span>
              )}
            </button>
            )}
          </div>
        </header>

        {/* Invoice type + season bar */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-5 px-3 py-2 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
            <span className="text-[11px] font-bold text-slate-400 shrink-0">الفاتورة</span>
            {([['retail', 'قطاعي'], ['half', 'نص جملة'], ['wholesale', 'جملة']] as const).filter(([k]) => k === 'retail' || perm('wholesale')).map(([k, label]) => (
              <button key={k} onClick={() => setInvoiceType(k)}
                className={`shrink-0 px-4 py-2 rounded-xl text-xs font-black transition ${invoiceType === k ? 'bg-purple-600 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
            <span className="text-[11px] font-bold text-slate-400 shrink-0">الموسم</span>
            {([['all', 'الكل'], ['summer', 'صيفي'], ['winter', 'شتوي']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setPosSeason(k)}
                className={`shrink-0 px-4 py-2 rounded-xl text-xs font-black transition ${posSeason === k ? 'bg-amber-500 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Categories Tabs */}
        <div className="relative group bg-slate-50/50 dark:bg-slate-800/20 border-b border-gray-100 dark:border-slate-800">
          <button 
            onClick={() => scrollCategories('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 dark:bg-slate-800/90 shadow-md p-2 rounded-l-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ChevronRight size={20} className="text-gray-600 dark:text-gray-300" />
          </button>
          
          <div ref={categoriesRef} className="flex gap-2 md:gap-3 p-3 md:p-5 overflow-x-auto hide-scrollbar items-center scroll-smooth">
            <button
              onClick={() => setActiveCategory('all')}
              style={activeCategory === 'all' ? { background: storeSettings.themeColor } : {}}
              className={`px-4 py-2 md:px-6 md:py-2.5 text-sm md:text-base rounded-2xl whitespace-nowrap font-bold transition shadow-sm border ${activeCategory === 'all'
                  ? 'text-white border-transparent'
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
                }`}
            >
              الكل
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                style={activeCategory === c.id ? { background: storeSettings.themeColor } : {}}
                className={`px-4 py-2 md:px-6 md:py-2.5 text-sm md:text-base rounded-2xl whitespace-nowrap font-bold transition shadow-sm border ${activeCategory === c.id
                    ? 'text-white border-transparent'
                    : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <button 
            onClick={() => scrollCategories('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 dark:bg-slate-800/90 shadow-md p-2 rounded-r-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ChevronLeft size={20} className="text-gray-600 dark:text-gray-300" />
          </button>
        </div>

        {/* Product Catalog Grid */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 dark:bg-slate-900 border-l border-gray-100 dark:border-slate-800 relative">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredProducts.map((product) => {
              const isOutOfStock = product.stock_quantity <= 0;
              const isLowStock = product.stock_quantity > 0 && product.stock_quantity < 5;
              const avgPrice = product.average_purchase_price || product.purchase_price || 0;
              const lastPrice = product.purchase_price || 0;

              return (
                <div
                  key={product.id}
                  onClick={() => !isOutOfStock && handleAddProduct(product)}
                  className={`bg-white dark:bg-slate-800 p-4 rounded-3xl shadow-sm hover:shadow-xl cursor-pointer transition-all duration-300 transform hover:-translate-y-1 flex flex-col justify-between border border-gray-100 dark:border-slate-700 ring-1 ring-black/5 dark:ring-white/5 relative overflow-hidden group ${isOutOfStock ? 'opacity-60 cursor-not-allowed grayscale' : ''}`}
                >
                  <div className={`absolute top-0 right-0 rounded-bl-3xl rounded-tr-xl px-3 py-1 text-xs font-bold text-white shadow-sm transition-colors ${isOutOfStock ? 'bg-slate-500' : isLowStock ? 'bg-red-500' : 'bg-green-500 dark:bg-green-600'}`}>
                    {isOutOfStock ? 'نفذت' : formatQty(product.stock_quantity, product.unit)}
                  </div>

                  <div className="pt-2">
                    <h3 className="font-bold text-gray-800 dark:text-gray-100 line-clamp-2 leading-tight text-base">{product.name}</h3>
                    {/* Purchase cost info for cashier */}
                    {!pricesHidden && (
                    <div className="mt-2 space-y-0.5">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-slate-400 font-medium">آخر شراء:</span>
                        <span className="font-bold text-orange-500">{lastPrice.toFixed(2)} {storeSettings.currency}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-slate-400 font-medium">متوسط:</span>
                        <span className="font-bold text-indigo-500">{avgPrice.toFixed(2)} {storeSettings.currency}</span>
                      </div>
                    </div>
                    )}
                  </div>
                  <div className="flex items-end justify-between mt-3 pt-2 border-t border-gray-100 dark:border-slate-700">
                    <div>
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">سعر البيع / {getUnitConfig(product.unit).label}</p>
                      {(() => {
                        if (pricesHidden) return <span className="text-slate-400 font-black text-lg">🔒</span>;
                        const wholesale = invoiceType === 'wholesale' && (product.wholesale_price || 0) > 0;
                        const half = invoiceType === 'half' && (product.half_wholesale_price || 0) > 0;
                        if (wholesale || half) {
                          const price = wholesale ? product.wholesale_price : product.half_wholesale_price;
                          return (
                            <span className="flex items-center gap-1.5">
                              <span style={{ color: storeSettings.themeColor }} className="text-lg font-black">{price} <span className="text-xs text-gray-500 dark:text-gray-400">{storeSettings.currency}</span></span>
                              <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{wholesale ? 'جملة' : 'نص جملة'}</span>
                            </span>
                          );
                        }
                        if ((product.discount_price || 0) > 0 && (product.discount_price || 0) < product.sale_price) {
                          return (
                            <span className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-400 line-through">{product.sale_price}</span>
                              <span style={{ color: storeSettings.themeColor }} className="text-lg font-black">{product.discount_price} <span className="text-xs text-gray-500 dark:text-gray-400">{storeSettings.currency}</span></span>
                            </span>
                          );
                        }
                        return <span style={{ color: storeSettings.themeColor }} className="text-lg font-black dark:opacity-90">{product.sale_price} <span className="text-xs text-gray-500 dark:text-gray-400">{storeSettings.currency}</span></span>;
                      })()}
                    </div>
                    <div style={!isOutOfStock ? { backgroundColor: storeSettings.themeColor + '15', color: storeSettings.themeColor, borderColor: storeSettings.themeColor + '30' } : {}} className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all ${isOutOfStock ? 'bg-gray-100 text-gray-400 border-gray-200 dark:bg-slate-700 dark:border-slate-600' : ''}`}>
                      <Plus size={18} strokeWidth={3} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Cart Sidebar */}
      <div className={`w-full pb-16 lg:pb-0 lg:w-1/3 min-w-0 lg:min-w-[320px] xl:min-w-[420px] bg-white dark:bg-slate-800 flex flex-col z-20 shadow-2xl relative ${mobileView === 'catalog' ? 'hidden lg:flex' : 'flex'}`}>
        <div
          style={{
            background: `linear-gradient(160deg, ${storeSettings.themeColor} 0%, ${storeSettings.themeColor}dd 100%)`,
            boxShadow: `0 8px 32px ${storeSettings.themeColor}66`
          }}
          className="p-4 text-white flex flex-col relative h-auto rounded-bl-[40px] gap-3 z-[60]"
        >

          <div className="absolute inset-0 bg-black/20 rounded-bl-[40px]"></div>

          <div className="relative flex justify-between items-center mb-4">
            <h2 className="text-xl font-black flex items-center gap-2 drop-shadow">
              <ShoppingCart size={24} />
              الفاتورة
            </h2>
            <div className="flex items-center gap-2">
              <div className="font-mono flex items-center gap-1.5 bg-black/20 px-2.5 py-1 rounded-lg border border-white/20 text-xs">
                <span className="opacity-80 font-sans">رقم:</span> <span className="font-bold tracking-widest">{activeInvoiceId}</span>
              </div>
              <div className="bg-black/20 px-3 py-1 rounded-lg text-xs font-bold border border-white/20">
                {cart.length} الأصناف
              </div>
            </div>
          </div>

          {/* Customer Inputs Grid */}
          <div className="relative flex gap-1.5 text-sm h-11">
            <div className="flex-1 relative group">
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-indigo-400 group-focus-within:scale-110 transition-transform"><CreditCard size={14} /></span>
              <input
                id="pos-cust-card"
                type="text" dir="ltr" value={customerId} onChange={handleIdChange}
                onKeyDown={(e) => keyNext(e, 'pos-salesperson')}
                className="w-full bg-white/95 text-indigo-600 dark:text-indigo-400 placeholder-slate-400 border-0 py-2 pr-8 pl-2 rounded-xl focus:ring-2 focus:ring-white focus:outline-none transition font-black shadow-inner text-xs h-full"
                placeholder="رقم الكارت"
              />
            </div>
            <div className="flex-1 relative group">
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:scale-110 transition-transform"><Smartphone size={14} /></span>
              <input
                id="pos-cust-phone"
                type="text" dir="ltr" value={customerPhone} onChange={handlePhoneChange}
                onKeyDown={(e) => keyNext(e, 'pos-cust-card')}
                className="w-full bg-white/95 text-slate-800 placeholder-slate-400 border-0 py-2 pr-8 pl-2 rounded-xl focus:ring-2 focus:ring-white focus:outline-none transition font-medium shadow-inner text-xs h-full"
                placeholder="الموبايل"
              />
            </div>
            <div className="flex-[1.2] relative group">
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:scale-110 transition-transform"><ShoppingCart size={14} /></span>
              <input
                id="pos-cust-name"
                type="text" value={customerName}
                onChange={e => { setCustomerName(e.target.value); setShowCustomerSuggestions(true); }}
                onFocus={() => setShowCustomerSuggestions(true)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setShowCustomerSuggestions(false); focusById('pos-cust-phone'); } }}
                className="w-full bg-white/95 text-slate-800 placeholder-slate-400 border-0 py-2 pr-8 pl-2 rounded-xl focus:ring-2 focus:ring-white focus:outline-none transition font-medium shadow-inner text-xs h-full"
                placeholder="الاسم"
              />
              {showCustomerSuggestions && filteredCustomers.length > 0 && (
                <div className="absolute z-[200] left-0 right-0 top-full mt-2 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-700 max-h-64 overflow-y-auto">
                  {filteredCustomers.map(c => (
                    <button
                      key={c.id} onClick={() => handleSelectCustomer(c)}
                      className="w-full text-right px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center justify-between border-b border-gray-50 dark:border-slate-700 last:border-0"
                    >
                      <div className="flex flex-col text-right">
                        <span className="font-bold text-slate-800 dark:text-slate-100">{c.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono" dir="ltr">{c.phone}</span>
                      </div>
                      <div className="bg-indigo-600 px-3 py-1.5 rounded-lg text-white font-mono text-[10px] font-black">{c.card_number || c.custom_id || c.id.substring(0, 6)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {customerDebt > 0 && (
            <div className="relative mt-3 bg-black/20 border border-white/20 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between">
              <span>⚠️ مديونية سابقة:</span>
              <span className="bg-red-500 text-white px-2 py-0.5 rounded-lg font-mono border border-red-400">{customerDebt.toFixed(2)} {storeSettings.currency}</span>
            </div>
          )}
        </div>

        {/* Cart Listing */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50 dark:bg-slate-900/50" style={{ scrollbarWidth: 'thin' }}>
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-600 transition-opacity opacity-70">
              <ShoppingCart size={70} className="mb-4 opacity-30 drop-shadow-md" />
              <p className="text-xl font-semibold">السلة فارغة</p>
              <p className="text-xs mt-2 opacity-70">أضف بعض المنتجات للبدء بحساب الفاتورة.</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="bg-white dark:bg-slate-800 p-3 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 flex flex-col gap-2 relative overflow-hidden group hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <h4 className="font-bold text-gray-800 dark:text-gray-100 leading-tight w-4/5 text-sm">{item.name}</h4>
                  <button onClick={() => removeFromCart(item.id)} aria-label="حذف الصنف" className="text-red-500 hover:text-white hover:bg-red-500 dark:text-red-400 transition-colors bg-red-50 dark:bg-red-900/30 p-2 rounded-lg absolute left-3 top-3 border border-red-100 dark:border-red-900/50 shadow-sm">
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex items-center justify-between pt-2 mt-0.5 border-t border-gray-50 dark:border-slate-700/50">
                  <div className="flex flex-col">
                    {pricesHidden ? (
                      <span className="font-black text-lg text-slate-400">🔒 السعر مخفي</span>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">سعر {getUnitConfig(item.unit).label}:</label>
                          {(() => { const prod = products.find(p => p.id === item.id); return prod && (prod.discount_price || 0) > 0 && Math.abs(item.sale_price - (prod.discount_price || 0)) < 0.01 && prod.sale_price > (prod.discount_price || 0) ? (<span className="text-[9px] text-gray-400 line-through">{prod.sale_price}</span>) : null; })()}
                          <input
                            type="number"
                            dir="ltr"
                            value={item.sale_price}
                            onChange={(e) => updatePrice(item.id, parseFloat(e.target.value) || 0)}
                            className="w-16 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-none rounded-md px-1.5 py-0.5 text-xs font-black focus:ring-1 focus:ring-indigo-400 transition text-center"
                          />
                        </div>
                        <span className="font-black text-lg text-indigo-600 dark:text-indigo-400">
                          {(item.sale_price * item.quantity).toFixed(2)} <span className="text-[10px] text-gray-500">{storeSettings.currency}</span>
                        </span>
                      </>
                    )}
                  </div>

                  {isFractionalUnit(item.unit) ? (
                    <button
                      onClick={() => { setWeightProduct(item); setWeightUnitInput(String(item.quantity)); setWeightSubInput(''); }}
                      className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 rounded-lg px-3 py-1.5 text-amber-700 dark:text-amber-300 font-bold text-sm shadow-inner hover:bg-amber-100 transition"
                      title="تعديل الوزن"
                    >
                      <span>{formatQty(item.quantity, item.unit)}</span>
                      <Edit2 size={13} strokeWidth={2.5} />
                    </button>
                  ) : (
                    <div className="flex items-center bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg p-0.5 shadow-inner">
                      <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="p-1.5 hover:bg-white dark:hover:bg-slate-600 rounded-md text-gray-600 dark:text-gray-300 transition-colors shadow-sm">
                        <Minus size={14} strokeWidth={3} />
                      </button>
                      <span className="w-8 text-center text-sm font-bold dark:text-white">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="p-1.5 hover:bg-white dark:hover:bg-slate-600 rounded-md text-gray-600 dark:text-gray-300 transition-colors shadow-sm">
                        <Plus size={14} strokeWidth={3} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Checkout */}
        <div className="p-3 bg-white dark:bg-slate-800 border-t border-gray-100 dark:border-slate-700 shadow-2xl">
          {/* Salesperson (for commission tracking) */}
          <div className="mb-3">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block mb-1">👤 الموظف البائع (لحساب مبيعاته وعمولته)</label>
            <select
              id="pos-salesperson"
              value={salesperson?.id || ''}
              onChange={(e) => { const emp = employees.find((x) => x.id === e.target.value); setSalesperson(emp ? { id: emp.id, name: emp.name } : null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusById('pos-checkout-print-btn'); } }}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">— بدون تحديد —</option>
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}{emp.job_title ? ` (${emp.job_title})` : ''}</option>)}
            </select>
          </div>

          {/* Wholesale / half OTP gate */}
          {pricesHidden && (
            <div className="mb-3 bg-purple-50 dark:bg-purple-900/20 rounded-2xl p-3 border-2 border-purple-300 dark:border-purple-700">
              <div className="text-sm font-black text-purple-800 dark:text-purple-300 flex items-center gap-2">🔒 فاتورة {invoiceType === 'wholesale' ? 'جملة' : 'نص جملة'} — الأسعار مقفولة</div>
              <p className="text-[11px] text-purple-600 dark:text-purple-400 mt-1 mb-2">محتاج رمز تأكيد (OTP) بيوصل على تليجرام عشان تشوف الأسعار وتعمل الفاتورة.</p>
              <div className="flex gap-2">
                <button onClick={requestOtp} disabled={otpBusy} className="shrink-0 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-lg">{otpSent ? 'إعادة إرسال' : 'اطلب رمز'}</button>
                <input value={otpInput} onChange={(e) => setOtpInput(e.target.value)} placeholder="الرمز" dir="ltr" className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-700 rounded-lg px-3 py-2 text-center font-black tracking-widest text-slate-800 dark:text-slate-100" />
                <button onClick={verifyOtp} disabled={otpBusy} className="shrink-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-lg">تأكيد</button>
              </div>
            </div>
          )}

          <div className="space-y-2 mb-3 px-1">
            <div className="flex justify-between items-center text-sm font-bold text-slate-500 dark:text-slate-400">
              <span>المجموع: <span className="text-slate-800 dark:text-slate-200 text-lg">{pricesHidden ? '🔒' : subtotal.toFixed(2)}</span></span>
              <div className="flex items-center gap-2 bg-orange-100/50 dark:bg-orange-900/30 px-4 py-2 rounded-2xl border-2 border-orange-200 dark:border-orange-800/50 shadow-sm transition-all focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100">
                <span className="text-xs text-orange-600 dark:text-orange-400 font-black flex items-center gap-1">🏷️ خصم:</span>
                <input
                  type="number" dir="ltr" value={discountStr}
                  onChange={(e) => setDiscountStr(e.target.value)}
                  placeholder="0.00"
                  className="w-20 bg-transparent border-0 p-0 text-base font-black focus:ring-0 text-left text-orange-700 dark:text-orange-300 placeholder-orange-300"
                />
              </div>
            </div>

            <div className="flex justify-between items-center text-sm font-bold mt-2 text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                كوبون:
                {validCoupon && (
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 rounded-full">
                    مفعل (خصم {couponDiscountAmount} ج.م)
                  </span>
                )}
                {couponInput.trim() && !validCoupon && (
                  <div className="flex flex-col text-right">
                    <span className="text-xs text-red-500 font-bold">غير صالح</span>
                    <span className="text-[10px] text-red-400 max-w-[200px] break-words">{couponErrorMsg || 'الكوبون غير موجود أو غير مفعل'}</span>
                  </div>
                )}
              </span>
              <div className="flex items-center gap-2 bg-rose-50/50 dark:bg-rose-900/30 px-4 py-2 rounded-2xl border-2 border-rose-200 dark:border-rose-800/50 shadow-sm transition-all focus-within:border-rose-400 focus-within:ring-2 focus-within:ring-rose-100">
                <input
                  type="text" dir="ltr" value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="كود الخصم"
                  className="w-28 uppercase bg-transparent border-0 p-0 text-sm font-black focus:ring-0 text-left text-rose-700 dark:text-rose-300 placeholder-rose-300"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/50">
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest">الإجمالي النهائي</span>
              <div className="flex flex-col items-end">
                <span className="text-3xl font-black text-indigo-600 dark:text-indigo-400 tracking-tighter">
                  {pricesHidden ? '🔒' : total.toFixed(2)} <span className="text-xs text-slate-400 font-bold tracking-normal">{storeSettings.currency}</span>
                </span>
                {cart.length > 0 && !pricesHidden && ((storeSettings as any).showInvoiceProfit !== false) && (
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-md mt-1 border ${
                    profit >= 0 
                      ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-100 dark:border-emerald-800' 
                      : 'text-red-500 bg-red-50 dark:bg-red-900/30 border-red-100 dark:border-red-800'
                  }`}>
                    ربح الفاتورة: {profit.toFixed(2)} {storeSettings.currency}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              id="pos-checkout-btn"
              onClick={() => { setShouldPrint(false); setShowCheckoutModal(true); }}
              disabled={cart.length === 0 || pricesHidden}
              style={cart.length > 0 && !pricesHidden ? { background: storeSettings.themeColor } : {}}
              className="flex-1 disabled:bg-gray-300 text-white py-4 rounded-2xl font-black flex flex-col items-center justify-center gap-1 transition-all text-sm active:scale-95 shadow-lg disabled:shadow-none group"
            >
              <Banknote size={20} className="group-hover:scale-110 transition-transform" />
              <span>تحصيل ودفع</span>
            </button>
            <button
              id="pos-checkout-print-btn"
              onClick={() => { setShouldPrint(true); setShowCheckoutModal(true); }}
              disabled={cart.length === 0 || pricesHidden}
              className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 disabled:from-gray-300 disabled:to-gray-300 text-white py-4 rounded-2xl font-black flex flex-col items-center justify-center gap-1 transition-all text-sm active:scale-95 shadow-lg shadow-emerald-500/20 disabled:shadow-none group"
            >
              <Printer size={20} className="group-hover:rotate-12 transition-transform" />
              <span>دفع وطباعة</span>
            </button>
          </div>
          {perm('held') && (
          <button
            onClick={handleHoldInvoice}
            disabled={cart.length === 0 || pricesHidden || holdBusy}
            className="w-full mt-2 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed py-3 rounded-2xl font-black flex items-center justify-center gap-2 transition-all text-sm active:scale-95 border border-orange-100 dark:border-orange-900/30"
          >
            <PauseCircle size={18} /> {holdBusy ? 'جاري الحفظ...' : 'حفظ كفاتورة معلقة'}
          </button>
          )}
          <button onClick={clearCart} className="w-full text-slate-400 hover:text-red-500 text-xs font-bold py-3 transition-colors">
            إلغاء الطلب والتفريغ
          </button>
        </div>
      </div>
      {/* Checkout Payment Modal */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 rounded-[32px] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 border border-white/20">
            <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-600 p-2.5 rounded-2xl text-white shadow-lg shadow-indigo-200">
                  <Banknote size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-800 dark:text-white">توزيع مبالغ الدفع</h3>
                  <p className="text-xs text-slate-400 font-bold">يرجى تحديد كيفية تحصيل مبلغ الفاتورة</p>
                </div>
              </div>
              <button onClick={() => setShowCheckoutModal(false)} className="p-2 hover:bg-red-50 hover:text-red-500 rounded-xl transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              {/* Total Amount Card */}
              <div className="bg-indigo-50 dark:bg-indigo-900/20 p-6 rounded-[24px] border border-indigo-100 dark:border-indigo-800/50 flex justify-between items-center">
                <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">إجمالي المطلوب سداده</span>
                <span className="text-4xl font-black text-indigo-600 dark:text-indigo-400 tracking-tighter">
                  {total.toFixed(2)} <span className="text-sm font-bold opacity-60">{storeSettings.currency}</span>
                </span>
              </div>

              {/* Payment Inputs Grid */}
              <div className="grid grid-cols-2 gap-4">
                {activePayKeys.map((k, idx) => (
                  <div key={k} className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1 flex items-center gap-1.5">
                      {k === 'cash' ? <Banknote size={18} /> : k === 'visa' ? <CreditCard size={18} /> : k === 'wallet' ? <Smartphone size={18} /> : k === 'instapay' ? <Zap size={18} /> : <Wallet size={18} />} {payLabel(k)}
                    </label>
                    <input
                      autoFocus={idx === 0}
                      type="number" dir="ltr" value={payInput[k] || ''} onChange={(e) => setPay(k, e.target.value)} placeholder="0.00"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCheckoutClick(shouldPrint); } }}
                      className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-indigo-500 py-3 px-4 rounded-2xl focus:outline-none transition-all font-black text-lg text-left shadow-inner"
                    />
                  </div>
                ))}
              </div>

              {/* Summary Bar */}
              <div className="bg-slate-100 dark:bg-slate-900 p-4 rounded-2xl flex justify-between items-center">
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block font-bold uppercase">إجمالي المدفوع</span>
                  <span className="text-lg font-black text-slate-700 dark:text-slate-200">
                    {paidTotal.toFixed(2)}
                  </span>
                </div>

                <div className="flex gap-6">
                  <div className="text-center">
                    <span className="text-[10px] text-slate-400 block font-bold uppercase">المتبقي (آجل)</span>
                    <span className={`text-lg font-black ${total - paidTotal > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {Math.max(0, total - paidTotal).toFixed(2)}
                    </span>
                  </div>

                  <div className="text-left">
                    <span className="text-[10px] text-slate-400 block font-bold uppercase">الباقي (للعميل)</span>
                    <span className={`text-lg font-black ${paidTotal - total > 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
                      {Math.max(0, paidTotal - total).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Deferred Note Input */}
              {Math.max(0, total - paidTotal) > 0 && (
                <div className="mt-4">
                  <label className="text-sm font-bold text-slate-600 dark:text-slate-300 block mb-2 flex items-center gap-2">
                    <FileText size={16} />
                    ملاحظة / سبب الآجل (اختياري)
                  </label>
                  <textarea
                    value={deferredNote}
                    onChange={(e) => setDeferredNote(e.target.value)}
                    placeholder="مثال: باقي الحساب سيتم دفعه الأسبوع القادم..."
                    className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl p-3 outline-none text-sm font-medium resize-none min-h-[80px]"
                  />
                </div>
              )}
            </div>

            <div className="p-6 bg-slate-50 dark:bg-slate-900/50 flex gap-3">
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="flex-1 py-4 px-6 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-black border border-slate-200 dark:border-slate-700 hover:bg-slate-50 transition-all active:scale-95"
              >
                تراجع
              </button>
              <button
                onClick={() => {
                  handleCheckoutClick(shouldPrint);
                  setShowCheckoutModal(false);
                }}
                className="flex-[2] py-4 px-6 bg-indigo-600 text-white rounded-2xl font-black shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {shouldPrint ? <Printer size={20} /> : <Banknote size={20} />}
                تأكيد العملية وإنهاء الفاتورة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Held / Reserved Invoices Modal */}
      {showHeldModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 rounded-[32px] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-white/20">
            <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="bg-orange-500 p-2.5 rounded-2xl text-white shadow-lg shadow-orange-200">
                  <Clock size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-800 dark:text-white">الفواتير المعلقة</h3>
                  <p className="text-xs text-slate-400 font-bold">الكمية محجوزة من المخزون · تُرجَّع تلقائياً بعد أسبوع</p>
                </div>
              </div>
              <button onClick={() => setShowHeldModal(false)} className="p-2 hover:bg-red-50 hover:text-red-500 rounded-xl transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto">
              {heldInvoices.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <Clock size={48} className="mx-auto mb-3 opacity-30" />
                  <p className="font-bold">لا توجد فواتير معلقة</p>
                </div>
              ) : (
                heldInvoices.map((h) => {
                  const created = new Date(h.created_at);
                  const expires = new Date(h.expires_at);
                  const daysLeft = Math.ceil((expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  const itemsCount = h.items.reduce((s, i) => s + (i.quantity || 0), 0);
                  return (
                    <div key={h.id} className="border border-slate-200 dark:border-slate-700 rounded-2xl p-4 bg-slate-50/50 dark:bg-slate-900/40">
                      <div className="flex justify-between items-start gap-3 mb-2">
                        <div className="min-w-0">
                          <div className="font-black text-slate-800 dark:text-white truncate">
                            {h.customer_name?.trim() || 'عميل نقدي'}
                            {h.customer_phone ? <span className="text-xs font-bold text-slate-400 mr-2">{h.customer_phone}</span> : null}
                          </div>
                          <div className="text-[11px] font-bold text-slate-400">
                            {created.toLocaleString('ar-EG', { calendar: 'gregory', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {h.cashier_name ? ` · ${h.cashier_name}` : ''}
                          </div>
                        </div>
                        <div className="text-left shrink-0">
                          <div className="text-lg font-black text-indigo-600 dark:text-indigo-400">{Number(h.total).toFixed(2)} <span className="text-[10px] text-slate-400">{storeSettings.currency}</span></div>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${daysLeft <= 1 ? 'text-red-500 bg-red-50 border-red-100' : 'text-amber-600 bg-amber-50 border-amber-100'}`}>
                            {daysLeft > 0 ? `يتبقى ${daysLeft} يوم` : 'منتهية'}
                          </span>
                        </div>
                      </div>

                      <div className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-3 line-clamp-2">
                        {itemsCount} قطعة · {h.items.map((i) => `${i.name}×${formatQty(i.quantity, i.unit || 'قطعة')}`).join(' ، ')}
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleConfirmHeld(h.id)}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-1.5 transition active:scale-95"
                        >
                          <Check size={16} /> تأكيد البيع
                        </button>
                        <button
                          onClick={() => handleReturnHeld(h.id)}
                          className="flex-1 bg-white dark:bg-slate-800 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/40 hover:bg-red-50 py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-1.5 transition active:scale-95"
                        >
                          <Undo2 size={16} /> إرجاع للمخزون
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Camera Scanner Modal */}
      {showCameraScanner && (
        <div className="fixed inset-0 bg-black z-[200] flex flex-col">
          <div className="flex justify-between items-center p-4 bg-black text-white">
            <h3 className="font-bold flex items-center gap-2"><Camera size={20} /> مسح الباركود بالكاميرا</h3>
            <button onClick={handleCloseCamera} className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition-colors"><X size={20} /></button>
          </div>
          <div className="flex-1 relative flex flex-col items-center justify-center bg-black p-4">
            <div id="reader" className="w-full max-w-md mx-auto rounded-2xl overflow-hidden shadow-2xl bg-white/5"></div>
            
            {/* Scanned Product Popup */}
            {scannedProduct && (
              <div className="absolute bottom-10 left-4 right-4 bg-white dark:bg-slate-800 p-5 rounded-3xl shadow-2xl z-[210] animate-in slide-in-from-bottom-10 max-w-md mx-auto">
                <div className="flex items-start gap-4 border-b border-gray-100 dark:border-slate-700 pb-4 mb-4">
                  <div className="bg-emerald-100 text-emerald-600 p-3 rounded-2xl shrink-0"><Check size={24} strokeWidth={3} /></div>
                  <div className="flex-1">
                    <h4 className="font-black text-lg text-slate-800 dark:text-white leading-tight mb-1">{scannedProduct.name}</h4>
                    <p className="text-emerald-600 font-bold">{scannedProduct.sale_price} {storeSettings.currency}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4 mb-6">
                  <label className="font-bold text-slate-600 dark:text-slate-300">الكمية:</label>
                  <div className="flex flex-1 items-center bg-gray-50 dark:bg-slate-700 rounded-xl p-1 border border-gray-200 dark:border-slate-600">
                    <button onClick={() => setScanQty(Math.max(1, scanQty - 1))} className="p-3 hover:bg-white dark:hover:bg-slate-600 rounded-lg text-gray-600 dark:text-gray-300 shadow-sm"><Minus size={18} /></button>
                    <span className="flex-1 text-center font-black text-xl dark:text-white">{scanQty}</span>
                    <button onClick={() => setScanQty(scanQty + 1)} className="p-3 hover:bg-white dark:hover:bg-slate-600 rounded-lg text-gray-600 dark:text-gray-300 shadow-sm"><Plus size={18} /></button>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={handleConfirmScanAdd} className="flex-1 bg-indigo-600 text-white font-black py-4 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition">إضافة للفاتورة</button>
                  <button onClick={() => {
                    setScannedProduct(null);
                    if (html5QrCode && html5QrCode.getState() === 3) html5QrCode.resume();
                  }} className="bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 font-bold px-6 py-4 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 transition">تخطي</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── نافذة إدخال الوزن/الكمية للمنتجات المباعة بالوزن ── */}
      {weightProduct && (() => {
        const cfg = getUnitConfig(weightProduct.unit);
        const qty = computeWeightQty();
        const lineTotal = qty * weightProduct.sale_price;
        const overStock = qty > weightProduct.stock_quantity;
        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4" onClick={() => setWeightProduct(null)}>
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-sm animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-slate-700">
                <div>
                  <h3 className="font-black text-lg text-slate-800 dark:text-white leading-tight">{weightProduct.name}</h3>
                  <p className="text-sm text-emerald-600 font-bold mt-1">{weightProduct.sale_price} {storeSettings.currency} / {cfg.label}</p>
                  <p className="text-[11px] text-slate-400 font-bold mt-0.5">المتاح: {formatQty(weightProduct.stock_quantity, weightProduct.unit)}</p>
                </div>
                <button onClick={() => setWeightProduct(null)} className="text-slate-400 hover:text-slate-600 bg-slate-50 dark:bg-slate-700 p-2 rounded-xl"><X size={18} /></button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">الكمية بالـ {cfg.label}</label>
                  <input
                    type="number" dir="ltr" min="0" step="0.001" autoFocus
                    value={weightUnitInput}
                    onChange={(e) => { setWeightUnitInput(e.target.value); setWeightSubInput(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmWeight(); }}
                    placeholder={`مثال: 0.5 ${cfg.label}`}
                    className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 py-3 px-4 rounded-xl text-center font-black text-lg focus:ring-2 focus:ring-indigo-400 focus:outline-none dark:text-white"
                  />
                </div>

                {cfg.subUnit && (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
                      <span className="text-[11px] font-bold text-slate-400">أو أدخل بالـ {cfg.subUnit}</span>
                      <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">الكمية بالـ {cfg.subUnit}</label>
                      <input
                        type="number" dir="ltr" min="0" step="1"
                        value={weightSubInput}
                        onChange={(e) => { setWeightSubInput(e.target.value); setWeightUnitInput(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') confirmWeight(); }}
                        placeholder={`مثال: 250 ${cfg.subUnit}`}
                        className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 py-3 px-4 rounded-xl text-center font-black text-lg focus:ring-2 focus:ring-indigo-400 focus:outline-none dark:text-white"
                      />
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl px-4 py-3">
                  <span className="text-sm font-bold text-slate-500 dark:text-slate-400">الإجمالي ({formatQty(qty, weightProduct.unit)})</span>
                  <span className="text-xl font-black text-indigo-600 dark:text-indigo-400">{lineTotal.toFixed(2)} {storeSettings.currency}</span>
                </div>
                {overStock && <p className="text-xs text-red-500 font-bold text-center">⚠️ الكمية أكبر من المتاح بالمخزون</p>}
              </div>

              <div className="p-5 pt-0">
                <button
                  onClick={confirmWeight}
                  disabled={qty <= 0}
                  style={{ backgroundColor: storeSettings.themeColor }}
                  className="w-full text-white font-black py-4 rounded-xl shadow-lg hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  إضافة للفاتورة
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Mobile Bottom Navigation (Visible only on small screens) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 shadow-[0_-10px_30px_rgba(0,0,0,0.1)] z-[100] flex items-center justify-around px-2 pb-5 pt-2">
        <button 
          onClick={() => setMobileView('catalog')}
          className={`flex flex-col items-center p-2 rounded-xl flex-1 transition-all ${mobileView === 'catalog' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 shadow-inner' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <Box size={20} className={mobileView === 'catalog' ? 'animate-bounce' : ''} />
          <span className="text-[11px] font-bold mt-1">المنتجات</span>
        </button>
        <button 
          onClick={() => setMobileView('cart')}
          className={`flex flex-col items-center p-2 rounded-xl flex-1 relative transition-all ${mobileView === 'cart' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 shadow-inner' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <ShoppingCart size={20} className={mobileView === 'cart' ? 'animate-bounce' : ''} />
          <span className="text-[11px] font-bold mt-1">الفاتورة</span>
          {cart.length > 0 && (
             <span className="absolute top-1 right-[25%] bg-red-500 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full shadow-md animate-pulse border-2 border-white dark:border-slate-800">{cart.length}</span>
          )}
        </button>
      </div>
    </div>
  );
}
