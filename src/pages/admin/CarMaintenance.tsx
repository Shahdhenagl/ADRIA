import React, { useState, useMemo } from 'react';
import { useStore, type CarSubscription, type MaintenanceAppointment } from '../../store/useStore';
import { 
  Car, Calendar, Plus, Search, CheckCircle, Clock, 
  MessageCircle, AlertTriangle, X, Edit, Edit2, RefreshCw, Trash2, Power, Eye, Wallet, TrendingUp, TrendingDown, Receipt, Printer, Filter, DollarSign,
  BarChart3, Users, PieChart, ArrowUpRight, CreditCard
} from 'lucide-react';
import { printMaintenanceInvoice } from '../../utils/printMaintenanceInvoice';
import { escapeHtml } from '../../utils/escapeHtml';

export default function CarMaintenance() {
  const { 
    carSubscriptions, 
    maintenanceAppointments,
    customers, 
    addCarSubscription,
    updateCarSubscription,
    addMaintenanceAppointment, 
    updateMaintenanceAppointment,
    completeMaintenanceAppointment,
    completeAppointmentWithRegisteredTransactions,
    generateSubscriptionAppointments,
    deleteCarSubscription,
    toggleCarSubscriptionStatus,
    orders,
    expenses,
    checkout,
    addExpense,
    deleteOrder,
    editOrder,
    updateExpense,
    deleteExpense,
    payInvoiceDebt,
    deleteMaintenanceAppointment,
    storeSettings
  } = useStore();

  const [activeTab, setActiveTab] = useState<'cars' | 'appointments'>('appointments');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  
  // Modals
  const [showAddCarModal, setShowAddCarModal] = useState(false);
  const [showEditCarModal, setShowEditCarModal] = useState(false);
  const [showAddAppointmentModal, setShowAddAppointmentModal] = useState(false);
  const [showEditAppointmentModal, setShowEditAppointmentModal] = useState(false);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showCarProfileModal, setShowCarProfileModal] = useState(false);
  
  // Selected Data
  const [selectedCarId, setSelectedCarId] = useState<string>('');
  const [selectedAppointment, setSelectedAppointment] = useState<MaintenanceAppointment | null>(null);
  const [profileTab, setProfileTab] = useState<'appointments' | 'financial'>('appointments');

  // Forms
  const [carForm, setCarForm] = useState({
    car_number: '',
    car_details: '',
    customer_name: '',
    customer_phone: ''
  });

  const [appointmentForm, setAppointmentForm] = useState({
    appointment_date: new Date().toISOString().split('T')[0],
    description: ''
  });

  const [completeForm, setCompleteForm] = useState<{
    report: string;
    payment_method: 'cash' | 'visa' | 'wallet' | 'instapay';
    items: { type: 'part' | 'labor', name: string, costPrice: number, salePrice: number }[];
  }>({
    report: '',
    payment_method: 'cash',
    items: []
  });

  const [subscriptionForm, setSubscriptionForm] = useState({
    durationMonths: 3, 
    frequencyDays: 30 
  });

  const [revenueForm, setRevenueForm] = useState({ 
    revenue_type: 'product',
    amount: '', 
    payment_method: 'cash', 
    notes: '', 
    appointment_id: '',
    is_pending: false 
  });

  const [expenseForm, setExpenseForm] = useState({
    expense_type: 'other' as 'labor' | 'product' | 'service_cost' | 'other',
    costPrice: '',
    salePrice: '',
    payment_method: 'cash' as 'cash' | 'visa' | 'wallet' | 'instapay',
    note: '',
    appointment_id: '',
    is_sale_pending: true
  });

  const [financialVisitFilter, setFinancialVisitFilter] = useState<string>('all');

  const [editingTransaction, setEditingTransaction] = useState<any>(null);
  const [showEditTransactionModal, setShowEditTransactionModal] = useState(false);
  const [collectingTransaction, setCollectingTransaction] = useState<any>(null);
  const [showCollectTransactionModal, setShowCollectTransactionModal] = useState(false);
  const [showCollectAllModal, setShowCollectAllModal] = useState(false);
  const [collectAllForm, setCollectAllForm] = useState({
    cash: 0,
    visa: 0,
    wallet: 0,
    instapay: 0
  });

  // Handlers
  const handleCustomerSelect = (name: string) => {
    const existingCustomer = customers.find(c => c.name === name);
    if (existingCustomer) {
      setCarForm(prev => ({
        ...prev,
        customer_name: name,
        customer_phone: existingCustomer.phone || prev.customer_phone
      }));
    } else {
      setCarForm(prev => ({ ...prev, customer_name: name }));
    }
  };

  const handlePhoneSelect = (phone: string) => {
    const existingCustomer = customers.find(c => c.phone === phone);
    if (existingCustomer) {
      setCarForm(prev => ({
        ...prev,
        customer_phone: phone,
        customer_name: existingCustomer.name || prev.customer_name
      }));
    } else {
      setCarForm(prev => ({ ...prev, customer_phone: phone }));
    }
  };

  const handleAddCar = async (e: React.FormEvent) => {
    e.preventDefault();
    await addCarSubscription(carForm);
    setShowAddCarModal(false);
    setCarForm({ car_number: '', car_details: '', customer_name: '', customer_phone: '' });
  };

  const handleAddAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCarId) return alert('الرجاء اختيار سيارة');
    
    let carId = selectedCarId;
    if (selectedCarId === 'NEW_CAR') {
      if (!carForm.car_number || !carForm.customer_name || !carForm.customer_phone) {
        return alert('الرجاء ملء جميع بيانات السيارة المطلوبة');
      }
      const createdCar = await addCarSubscription(carForm);
      if (!createdCar) {
        return alert('حدث خطأ أثناء تسجيل السيارة الجديدة');
      }
      carId = createdCar.id;
    }

    await addMaintenanceAppointment({
      subscription_id: carId,
      appointment_date: appointmentForm.appointment_date,
      description: appointmentForm.description
    });
    
    setShowAddAppointmentModal(false);
    setAppointmentForm({ appointment_date: new Date().toISOString().split('T')[0], description: '' });
    setCarForm({ car_number: '', car_details: '', customer_name: '', customer_phone: '' });
  };

  const handleCompleteAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppointment) return;
    
    if (completeForm.items.length === 0 && !confirm('هل أنت متأكد من إغلاق الموعد بدون إضافة قطع أو مصنعية؟')) return;

    await completeMaintenanceAppointment(
      selectedAppointment.id,
      completeForm.report,
      completeForm.items,
      undefined,
      completeForm.payment_method
    );

    // Open car profile modal, select financial tab, and set visit filter to this appointment
    const appointmentCar = carSubscriptions.find(c => c.id === selectedAppointment.subscription_id);
    if (appointmentCar) {
      setSelectedCarId(appointmentCar.id);
      setProfileTab('financial');
      setFinancialVisitFilter(selectedAppointment.id);
      setShowCarProfileModal(true);
    }

    setShowCompleteModal(false);
    setCompleteForm({ report: '', payment_method: 'cash', items: [] });
  };

  const getAppointmentCost = (appointment: MaintenanceAppointment, car: CarSubscription) => {
    const linkedOrders = orders.filter(o => 
      o.car_id === car.id && 
      (!o.is_deleted) &&
      (((o.notes || '').includes(`[زيارة:${appointment.id}]`)) || 
       o.items?.some(i => i.id?.startsWith(`maint-${appointment.id}`)))
    );
    if (linkedOrders.length > 0) {
      return linkedOrders.reduce((sum, o) => sum + (o.total || o.paid_amount || 0), 0);
    }
    return appointment.cost || 0;
  };

  const handlePrintInvoice = (appointment: MaintenanceAppointment, car: CarSubscription) => {
    const linkedOrders = orders.filter(o => 
      o.car_id === car.id && 
      (!o.is_deleted) &&
      (((o.notes || '').includes(`[زيارة:${appointment.id}]`)) || 
       o.items?.some(i => i.id?.startsWith(`maint-${appointment.id}`)))
    );

    let order;
    if (linkedOrders.length > 0) {
      const consolidatedItems = linkedOrders.flatMap(o => {
        if (!o.items || o.items.length === 0) {
          const name = (o.notes || '').replace(/\[زيارة:[^\]]+\]/g, '').trim() || 'إيراد صيانة';
          return [{
            id: `virtual-${o.id}`,
            name,
            barcode: '',
            purchase_price: 0,
            average_purchase_price: 0,
            sale_price: o.total || o.paid_amount || 0,
            stock_quantity: 99999,
            category_id: '',
            unit: 'قطعة',
            quantity: 1,
            returned_quantity: 0,
            refunded_amount: 0,
            date: new Date(o.date).toLocaleDateString('ar-SA')
          }];
        }
        return o.items.map(item => ({
          ...item,
          date: new Date(o.date).toLocaleDateString('ar-SA')
        }));
      });

      const grandTotal = consolidatedItems.reduce((sum, item) => sum + item.sale_price * item.quantity, 0);
      const paymentMethod = linkedOrders[0]?.payment_method || 'cash';

      order = {
        id: appointment.id,
        total: grandTotal,
        paid_amount: grandTotal,
        paid_cash: paymentMethod === 'cash' ? grandTotal : 0,
        paid_visa: paymentMethod === 'visa' ? grandTotal : 0,
        paid_wallet: paymentMethod === 'wallet' ? grandTotal : 0,
        paid_instapay: paymentMethod === 'instapay' ? grandTotal : 0,
        type: 'sale' as const,
        payment_method: paymentMethod,
        date: appointment.appointment_date || new Date().toISOString(),
        items: consolidatedItems,
        is_deleted: false,
        report: appointment.report || appointment.description || ''
      };
    } else {
      order = {
        id: appointment.id,
        total: appointment.cost || 0,
        paid_amount: appointment.cost || 0,
        paid_cash: appointment.cost || 0,
        paid_visa: 0,
        paid_wallet: 0,
        paid_instapay: 0,
        type: 'sale' as const,
        payment_method: 'cash' as const,
        date: appointment.appointment_date || appointment.created_at || new Date().toISOString(),
        items: [
          {
            id: `maint-${appointment.id}-fallback`,
            name: `زيارة صيانة - ${appointment.report || 'بدون تقرير'}`,
            barcode: '',
            purchase_price: 0,
            average_purchase_price: 0,
            sale_price: appointment.cost || 0,
            stock_quantity: 99999,
            category_id: '',
            unit: 'قطعة',
            quantity: 1,
            returned_quantity: 0,
            refunded_amount: 0
          }
        ],
        is_deleted: false,
        report: appointment.report || appointment.description || ''
      };
    }
    
    printMaintenanceInvoice(order, {
      carNumber: car.car_number,
      carDetails: car.car_details,
      customerName: car.customer_name,
      customerPhone: car.customer_phone
    }, storeSettings);
  };

  const handleSendWhatsAppInvoice = (appointment: MaintenanceAppointment, car: CarSubscription) => {
    const linkedOrders = orders.filter(o => 
      o.car_id === car.id && 
      (!o.is_deleted) &&
      (((o.notes || '').includes(`[زيارة:${appointment.id}]`)) || 
       o.items?.some(i => i.id?.startsWith(`maint-${appointment.id}`)))
    );

    const consolidatedItems = linkedOrders.flatMap(o => {
      if (!o.items || o.items.length === 0) {
        const name = (o.notes || '').replace(/\[زيارة:[^\]]+\]/g, '').trim() || 'إيراد صيانة';
        return [{
          id: `virtual-${o.id}`,
          name,
          sale_price: o.total || o.paid_amount || 0,
          quantity: 1
        }];
      }
      return o.items;
    });

    const formattedDate = new Date(appointment.appointment_date).toLocaleDateString('ar-SA');
    const getPublicInvoiceUrl = (appointmentId: string) => {
      const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'https://cashier-branch3.vercel.app'
        : window.location.origin;
      return `${baseUrl}/view-invoice/${appointmentId}`;
    };
    const invoiceUrl = getPublicInvoiceUrl(appointment.id);
    
    let message = `*فاتورة صيانة إلكترونية 🚗*\n\n` +
      `*بيانات العميل:*\n` +
      `👤 الاسم: ${car.customer_name}\n` +
      `📱 الهاتف: ${car.customer_phone}\n\n` +
      `*بيانات السيارة:*\n` +
      `🚘 رقم السيارة: ${car.car_number}\n` +
      `📝 تفاصيل: ${car.car_details || '-'}\n\n` +
      `*تفاصيل الزيارة (${formattedDate}):*\n` +
      `🔧 تقرير الفحص: ${appointment.report || appointment.description || 'تمت الصيانة بنجاح'}\n\n` +
      `*البنود والخدمات:*\n`;

    if (consolidatedItems.length > 0) {
      consolidatedItems.forEach((item, index) => {
        const qty = item.quantity || 1;
        const total = qty * item.sale_price;
        message += `${index + 1}. ${item.name} (عدد ${qty}) - ${total.toFixed(2)} ج.م\n`;
      });
    } else {
      message += `- زيارة صيانة دورية\n`;
    }

    const totalCost = getAppointmentCost(appointment, car);
    message += `\n*الإجمالي المطلوب:* ${totalCost.toFixed(2)} ج.م\n` +
      `*رابط الفاتورة الإلكترونية:* ${invoiceUrl}\n\n` +
      (storeSettings.locationUrl ? `📍 *موقعنا على الخريطة:*\n${storeSettings.locationUrl}\n\n` : '') +
      `شكراً لتعاملكم معنا ونتمنى لكم سلامة دائمًا على الطريق ❤️`;

    let phone = car.customer_phone.replace(/\D/g, '');
    if (phone.startsWith('01')) phone = '2' + phone; 
    
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const handleCompleteWithRegisteredTransactions = async (appointment: MaintenanceAppointment, car: CarSubscription) => {
    try {
      const linkedOrders = orders.filter(o => 
        o.car_id === car.id && 
        (!o.is_deleted) &&
        (((o.notes || '').includes(`[زيارة:${appointment.id}]`)) || 
         o.items?.some(i => i.id?.startsWith(`maint-${appointment.id}`)))
      );

      const linkedExpenses = expenses.filter(e => 
        e.car_id === car.id && 
        (e.note || '').includes(`[زيارة:${appointment.id}]`)
      );

      const cost = linkedOrders.reduce((sum, o) => sum + (o.total || o.paid_amount || 0), 0);

      const itemNames = linkedOrders.flatMap(o => {
        if (!o.items || o.items.length === 0) {
          return [(o.notes || '').replace(/\[زيارة:[^\]]+\]/g, '').trim()];
        }
        return o.items.map(i => i.name);
      });
      const expenseNotes = linkedExpenses.map(e => (e.note || '').replace(/\[زيارة:[^\]]+\]/g, '').trim());
      const uniqueDetails = Array.from(new Set([...itemNames, ...expenseNotes])).filter(Boolean).join(' + ');
      const report = uniqueDetails || appointment.description || 'زيارة صيانة';

      await completeAppointmentWithRegisteredTransactions(appointment.id, cost, report);

      alert('تم إنهاء موعد الصيانة بالمعاملات المسجلة بنجاح.');

      const consolidatedItems = linkedOrders.flatMap(o => {
        if (!o.items || o.items.length === 0) {
          const name = (o.notes || '').replace(/\[زيارة:[^\]]+\]/g, '').trim() || 'إيراد صيانة';
          return [{
            id: `virtual-${o.id}`,
            name,
            barcode: '',
            purchase_price: 0,
            average_purchase_price: 0,
            sale_price: o.total || o.paid_amount || 0,
            stock_quantity: 99999,
            category_id: '',
            unit: 'قطعة',
            quantity: 1,
            returned_quantity: 0,
            refunded_amount: 0,
            date: new Date(o.date).toLocaleDateString('ar-SA')
          }];
        }
        return o.items.map(item => ({
          ...item,
          date: new Date(o.date).toLocaleDateString('ar-SA')
        }));
      });

      const paymentMethod = linkedOrders[0]?.payment_method || 'cash';

      const consolidatedOrder = {
        id: appointment.id,
        total: cost,
        paid_amount: cost,
        paid_cash: paymentMethod === 'cash' ? cost : 0,
        paid_visa: paymentMethod === 'visa' ? cost : 0,
        paid_wallet: paymentMethod === 'wallet' ? cost : 0,
        paid_instapay: paymentMethod === 'instapay' ? cost : 0,
        type: 'sale' as const,
        payment_method: paymentMethod,
        date: appointment.appointment_date || new Date().toISOString(),
        items: consolidatedItems,
        is_deleted: false,
        report: report
      };

      printMaintenanceInvoice(consolidatedOrder, {
        carNumber: car.car_number,
        carDetails: car.car_details,
        customerName: car.customer_name,
        customerPhone: car.customer_phone
      }, storeSettings);

      const updatedAppt = { ...appointment, status: 'completed', cost, report } as MaintenanceAppointment;
      handleSendWhatsAppInvoice(updatedAppt, car);

    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء إنهاء الموعد بالمعاملات.');
    }
  };

  const handleEditCar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCarId) return;
    await updateCarSubscription(selectedCarId, carForm);
    setShowEditCarModal(false);
    setCarForm({ car_number: '', car_details: '', customer_name: '', customer_phone: '' });
  };

  const handleEditAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppointment) return;
    await updateMaintenanceAppointment(selectedAppointment.id, {
      appointment_date: appointmentForm.appointment_date,
      description: appointmentForm.description
    });
    setShowEditAppointmentModal(false);
    setAppointmentForm({ appointment_date: new Date().toISOString().split('T')[0], description: '' });
  };

  const handleGenerateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCarId) return;
    await generateSubscriptionAppointments(selectedCarId, subscriptionForm.durationMonths, subscriptionForm.frequencyDays);
    setShowSubscriptionModal(false);
    setActiveTab('appointments');
  };

  const handleAddCarRevenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCarId || !revenueForm.amount) return;
    if (!revenueForm.appointment_id) {
      return alert('الرجاء اختيار زيارة صيانة أو فتح زيارة جديدة');
    }
    const car = carSubscriptions.find(c => c.id === selectedCarId);
    const typeLabelsRev: Record<string, string> = {
      'product': 'إيراد بيع منتج صيانة',
      'labor': 'إيراد مصنعية صيانة',
      'other': 'إيراد أخرى'
    };
    const revTypeLabel = typeLabelsRev[revenueForm.revenue_type] || 'إيراد أخرى';

    let finalAppId = revenueForm.appointment_id;
    if (finalAppId === 'NEW_ONE_TIME') {
      const createdApp = await addMaintenanceAppointment({
        subscription_id: selectedCarId,
        appointment_date: new Date().toISOString(),
        description: 'زيارة صيانة لمرة واحدة'
      });
      finalAppId = createdApp?.id || '';
    }

    const noteText = finalAppId ? `${revTypeLabel}: ${revenueForm.notes} [زيارة:${finalAppId}]` : `${revTypeLabel}: ${revenueForm.notes}`;

    const tempCart = useStore.getState().cart;
    useStore.setState({ cart: [{
      id: `maint-rev-${Date.now()}`,
      name: noteText,
      category_id: '',
      barcode: '',
      purchase_price: 0,
      average_purchase_price: 0,
      sale_price: Number(revenueForm.amount),
      stock_quantity: 99999,
      unit: 'قطعة',
      quantity: 1,
      returned_quantity: 0
    }] });

    await checkout(
      Number(revenueForm.amount),
      { name: car?.customer_name || 'بدون اسم', phone: car?.customer_phone || '' },
      revenueForm.is_pending ? 0 : Number(revenueForm.amount),
      'sale',
      revenueForm.is_pending ? ('debt' as any) : revenueForm.payment_method,
      undefined, 
      undefined, 
      noteText,
      undefined, 
      undefined, 
      selectedCarId
    );
    
    useStore.setState({ cart: tempCart });
    setRevenueForm({ revenue_type: 'product', amount: '', payment_method: 'cash', notes: '', appointment_id: '', is_pending: false });
  };

  const handleAddCarExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCarId || !expenseForm.costPrice) return;
    if (!expenseForm.appointment_id) {
      return alert('الرجاء اختيار زيارة صيانة أو فتح زيارة جديدة');
    }
    const costAmount = Number(expenseForm.costPrice);
    const saleAmount = Number(expenseForm.salePrice) || 0;
    const typeLabels: Record<string, string> = { labor: 'مصنعية', product: 'شراء منتج', service_cost: 'مصاريف خدمة', other: 'أخرى' };
    const typeLabel = typeLabels[expenseForm.expense_type] || 'أخرى';
    
    let finalAppId = expenseForm.appointment_id;
    if (finalAppId === 'NEW_ONE_TIME') {
      const createdApp = await addMaintenanceAppointment({
        subscription_id: selectedCarId,
        appointment_date: new Date().toISOString(),
        description: 'زيارة صيانة لمرة واحدة'
      });
      finalAppId = createdApp?.id || '';
    }

    const noteText = finalAppId ? `${typeLabel}: ${expenseForm.note} [زيارة:${finalAppId}]` : `${typeLabel}: ${expenseForm.note}`;
    
    // 1. Record the cost as expense
    if (costAmount > 0) {
      await addExpense({
        category: typeLabel,
        amount: costAmount,
        paid_cash: expenseForm.payment_method === 'cash' ? costAmount : 0,
        paid_visa: expenseForm.payment_method === 'visa' ? costAmount : 0,
        paid_wallet: expenseForm.payment_method === 'wallet' ? costAmount : 0,
        paid_instapay: expenseForm.payment_method === 'instapay' ? costAmount : 0,
        note: noteText,
        payment_method: expenseForm.payment_method,
        car_id: selectedCarId
      });
    }
    
    // 2. If there's a sale price, record it as revenue (customer pays this amount)
    if (saleAmount > 0) {
      const car = carSubscriptions.find(c => c.id === selectedCarId);
      const tempCart = useStore.getState().cart;
      useStore.setState({ cart: [{
        id: `svc-${Date.now()}`,
        name: `${typeLabel}: ${expenseForm.note}`,
        category_id: '',
        barcode: '',
        purchase_price: costAmount,
        average_purchase_price: costAmount,
        sale_price: saleAmount,
        stock_quantity: 99999,
        unit: 'قطعة',
        quantity: 1,
        returned_quantity: 0
      }] });
      await checkout(
        saleAmount,
        { name: car?.customer_name || 'بدون اسم', phone: car?.customer_phone || '' },
        expenseForm.is_sale_pending ? 0 : saleAmount,
        'sale',
        expenseForm.is_sale_pending ? ('debt' as any) : expenseForm.payment_method,
        undefined,
        undefined,
        noteText,
        undefined,
        undefined,
        selectedCarId
      );
      useStore.setState({ cart: tempCart });
    }
    setExpenseForm({ expense_type: 'other', costPrice: '', salePrice: '', payment_method: 'cash', note: '', appointment_id: '', is_sale_pending: true });
  };

  const handleDeleteCar = async (id: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذه السيارة؟ سيتم حذف جميع المواعيد المرتبطة بها نهائياً.')) {
      await deleteCarSubscription(id);
    }
  };

  const handleToggleStatus = async (car: CarSubscription) => {
    const newStatus = car.status === 'inactive' ? 'active' : 'inactive';
    await toggleCarSubscriptionStatus(car.id, newStatus);
  };

  const sendWhatsAppReminder = (appointment: MaintenanceAppointment, car: CarSubscription) => {
    const formattedDate = new Date(appointment.appointment_date).toLocaleDateString('ar-SA');
    const locationLine = storeSettings.locationUrl ? `\n📍 موقعنا على الخريطة: ${storeSettings.locationUrl}` : '';
    const message = `أهلاً بك أستاذ ${car.customer_name}،
نود تذكيرك بموعد الصيانة لسيارتك رقم (${car.car_number}) الموافق ${formattedDate}.
المطلوب عمله: ${appointment.description || 'صيانة دورية'}${locationLine}
شكراً لثقتكم.`;
    
    let phone = car.customer_phone.replace(/\D/g, '');
    if (phone.startsWith('01')) phone = '2' + phone; 
    
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const sendWhatsAppRenewal = (car: CarSubscription) => {
    const renewalLocationLine = storeSettings.locationUrl ? `\n📍 موقعنا على الخريطة: ${storeSettings.locationUrl}` : '';
    const message = `أهلاً بك أستاذ ${car.customer_name}،
نود تذكيرك بأن باقة الصيانة الخاصة بسيارتك رقم (${car.car_number}) قد اقتربت من الانتهاء أو انتهت بالفعل.
نتشرف بزيارتكم لتجديد الباقة والتمتع بخدمات الصيانة المستمرة.${renewalLocationLine}
شكراً لثقتكم.`;
    let phone = car.customer_phone.replace(/\D/g, '');
    if (phone.startsWith('01')) phone = '2' + phone; 
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const getRemainingVisits = (carId: string) => {
    return maintenanceAppointments.filter(a => a.subscription_id === carId && a.status === 'pending').length;
  };

  const filteredCars = useMemo(() => {
    return carSubscriptions.filter(c => {
      if (statusFilter === 'active' && c.status === 'inactive') return false;
      if (statusFilter === 'inactive' && c.status !== 'inactive') return false;

      return (
        c.car_number.includes(searchTerm) || 
        c.customer_name.includes(searchTerm) ||
        c.customer_phone.includes(searchTerm)
      );
    });
  }, [carSubscriptions, searchTerm, statusFilter]);

  const handleDeleteTransaction = async (t: any) => {
    if (!confirm('هل أنت متأكد من حذف هذه الحركة المالية؟')) return;
    if (t._type === 'revenue') {
      await deleteOrder(t.id, 'تم الحذف من ملف السيارة');
    } else {
      await deleteExpense(t.id);
    }
  };

  const handleDeleteAppointment = async (appointment: MaintenanceAppointment) => {
    const isCompleted = appointment.status === 'completed';
    const message = isCompleted
      ? 'هل أنت متأكد من حذف هذا الموعد؟ سيتم حذف الموعد وجميع المعاملات المالية المرتبطة به (فاتورة الإيراد ومصروفات قطع الغيار) بشكل نهائي واسترجاع الكميات للمخزن.'
      : 'هل أنت متأكد من حذف هذا الموعد؟';
    
    if (window.confirm(message)) {
      try {
        await deleteMaintenanceAppointment(appointment.id);
        alert('تم حذف موعد الصيانة بنجاح.');
      } catch (e) {
        console.error(e);
        alert('حدث خطأ أثناء حذف موعد الصيانة.');
      }
    }
  };

  const handleEditTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTransaction) return;
    if (editingTransaction._type === 'revenue') {
      await editOrder(
        editingTransaction.id,
        {
          notes: editingTransaction.notes,
          paid_amount: Number(editingTransaction.paid_amount),
          payment_method: editingTransaction.payment_method,
          date: editingTransaction.date
        },
        editingTransaction.items || [], // Same items
        'تعديل من ملف السيارة'
      );
    } else {
      await updateExpense(editingTransaction.id, {
        category: editingTransaction.category,
        amount: Number(editingTransaction.amount),
        paid_cash: editingTransaction.payment_method === 'cash' ? Number(editingTransaction.amount) : 0,
        paid_visa: editingTransaction.payment_method === 'visa' ? Number(editingTransaction.amount) : 0,
        paid_wallet: editingTransaction.payment_method === 'wallet' ? Number(editingTransaction.amount) : 0,
        paid_instapay: editingTransaction.payment_method === 'instapay' ? Number(editingTransaction.amount) : 0,
        note: editingTransaction.note,
        payment_method: editingTransaction.payment_method,
        date: editingTransaction.date
      } as any);
    }
    setShowEditTransactionModal(false);
    setEditingTransaction(null);
  };

  const handleCollectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectingTransaction) return;
    
    let cid = collectingTransaction.customer?.id;
    if (!cid && selectedCarId) {
      const car = carSubscriptions.find(c => c.id === selectedCarId);
      if (car) {
        const existingCust = customers.find(cust => 
          (car.customer_phone && cust.phone === car.customer_phone) || 
          (car.customer_name && cust.name === car.customer_name)
        );
        cid = existingCust?.id;
      }
    }

    await payInvoiceDebt(
      collectingTransaction.id,
      cid || '',
      Number(collectingTransaction.amountToCollect),
      undefined,
      collectingTransaction.payment_method
    );
    setShowCollectTransactionModal(false);
    setCollectingTransaction(null);
  };


  const filteredAppointments = useMemo(() => {
    return maintenanceAppointments.filter(a => {
      const car = carSubscriptions.find(c => c.id === a.subscription_id);
      if (!car || car.status === 'inactive') return false;
      return (
        car.car_number.includes(searchTerm) || 
        car.customer_name.includes(searchTerm) ||
        car.customer_phone.includes(searchTerm) ||
        (car.car_details && car.car_details.includes(searchTerm))
      );
    });
  }, [maintenanceAppointments, carSubscriptions, searchTerm]);

  // === Maintenance Statistics ===
  const maintenanceStats = useMemo(() => {
    const activeCars = carSubscriptions.filter(c => c.status !== 'inactive');
    const allCarIds = new Set(carSubscriptions.map(c => c.id));
    
    // All maintenance-related orders (linked to any car)
    const maintenanceOrders = orders.filter(o => o.car_id && allCarIds.has(o.car_id) && !o.is_deleted);
    const maintenanceExpenses = expenses.filter(e => e.car_id && allCarIds.has(e.car_id));
    
    const totalRevenue = maintenanceOrders.reduce((sum, o) => sum + Number(o.total || o.paid_amount || 0), 0);
    const totalCollected = maintenanceOrders.reduce((sum, o) => sum + Number(o.paid_amount || 0), 0);
    const totalExpensesAmount = maintenanceExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const netProfit = totalCollected - totalExpensesAmount;
    
    // Pending debts (آجل)
    const pendingOrders = maintenanceOrders.filter(o => (o.paid_amount || 0) < (o.total || 0));
    const totalPendingDebt = pendingOrders.reduce((sum, o) => sum + ((o.total || 0) - (o.paid_amount || 0)), 0);
    
    // Appointment stats
    const completedAppointments = maintenanceAppointments.filter(a => a.status === 'completed');
    const pendingAppointments = maintenanceAppointments.filter(a => a.status === 'pending');
    
    // This month stats
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthOrders = maintenanceOrders.filter(o => new Date(o.date) >= thisMonthStart);
    const thisMonthRevenue = thisMonthOrders.reduce((sum, o) => sum + Number(o.total || o.paid_amount || 0), 0);
    const thisMonthExpenses = maintenanceExpenses.filter(e => new Date(e.date) >= thisMonthStart);
    const thisMonthExpenseAmount = thisMonthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const thisMonthProfit = thisMonthRevenue - thisMonthExpenseAmount;
    
    // Customer count with debts
    const customersWithDebt = new Set(pendingOrders.map(o => o.car_id)).size;
    
    return {
      activeCars: activeCars.length,
      totalCars: carSubscriptions.length,
      totalRevenue,
      totalCollected,
      totalExpenses: totalExpensesAmount,
      netProfit,
      totalPendingDebt,
      customersWithDebt,
      completedAppointments: completedAppointments.length,
      pendingAppointments: pendingAppointments.length,
      thisMonthRevenue,
      thisMonthProfit,
      pendingOrdersCount: pendingOrders.length
    };
  }, [carSubscriptions, orders, expenses, maintenanceAppointments]);

  return (
    <>
      <div className="p-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
              <Car className="text-indigo-600" size={32} />
              إدارة صيانات السيارات
            </h1>
            <p className="text-slate-500 mt-2">تسجيل السيارات ومتابعة مواعيد الصيانة والاشتراكات</p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => setShowAddCarModal(true)}
            className="bg-slate-800 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-700 transition"
          >
            <Plus size={20} />
            تسجيل سيارة جديدة
          </button>
          <button
            onClick={() => {
              setSelectedCarId('');
              setCarForm({ car_number: '', car_details: '', customer_name: '', customer_phone: '' });
              setAppointmentForm({ appointment_date: new Date().toISOString().split('T')[0], description: '' });
              setShowAddAppointmentModal(true);
            }}
            className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition"
          >
            <Calendar size={20} />
            حجز موعد صيانة
          </button>
        </div>
      </div>

      {/* === Statistics Dashboard === */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {/* Total Revenue */}
        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl p-5 text-white shadow-lg shadow-emerald-500/25 group hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300 hover:-translate-y-1">
          <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6 group-hover:scale-125 transition-transform duration-500" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                <TrendingUp size={18} />
              </div>
              <span className="text-emerald-100 text-xs font-bold">إجمالي الإيرادات</span>
            </div>
            <p className="text-2xl font-black tracking-tight">{maintenanceStats.totalRevenue.toLocaleString('ar-EG')} <span className="text-sm font-medium opacity-80">ج.م</span></p>
            <div className="flex items-center gap-1 mt-2 text-emerald-200 text-[11px]">
              <ArrowUpRight size={12} />
              <span>هذا الشهر: {maintenanceStats.thisMonthRevenue.toLocaleString('ar-EG')} ج.م</span>
            </div>
          </div>
        </div>

        {/* Total Expenses */}
        <div className="relative overflow-hidden bg-gradient-to-br from-red-500 to-red-700 rounded-2xl p-5 text-white shadow-lg shadow-red-500/25 group hover:shadow-xl hover:shadow-red-500/30 transition-all duration-300 hover:-translate-y-1">
          <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6 group-hover:scale-125 transition-transform duration-500" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                <TrendingDown size={18} />
              </div>
              <span className="text-red-100 text-xs font-bold">إجمالي المصروفات</span>
            </div>
            <p className="text-2xl font-black tracking-tight">{maintenanceStats.totalExpenses.toLocaleString('ar-EG')} <span className="text-sm font-medium opacity-80">ج.م</span></p>
            <div className="flex items-center gap-1 mt-2 text-red-200 text-[11px]">
              <Receipt size={12} />
              <span>تكاليف قطع غيار ومصنعيات</span>
            </div>
          </div>
        </div>

        {/* Net Profit */}
        <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-5 text-white shadow-lg shadow-indigo-500/25 group hover:shadow-xl hover:shadow-indigo-500/30 transition-all duration-300 hover:-translate-y-1">
          <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6 group-hover:scale-125 transition-transform duration-500" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                <DollarSign size={18} />
              </div>
              <span className="text-indigo-100 text-xs font-bold">صافي الربح</span>
            </div>
            <p className={`text-2xl font-black tracking-tight ${maintenanceStats.netProfit < 0 ? 'text-red-300' : ''}`}>{maintenanceStats.netProfit.toLocaleString('ar-EG')} <span className="text-sm font-medium opacity-80">ج.م</span></p>
            <div className="flex items-center gap-1 mt-2 text-indigo-200 text-[11px]">
              <BarChart3 size={12} />
              <span>ربح الشهر: {maintenanceStats.thisMonthProfit.toLocaleString('ar-EG')} ج.م</span>
            </div>
          </div>
        </div>

        {/* Pending Debts */}
        <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-5 text-white shadow-lg shadow-amber-500/25 group hover:shadow-xl hover:shadow-amber-500/30 transition-all duration-300 hover:-translate-y-1">
          <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6 group-hover:scale-125 transition-transform duration-500" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                <CreditCard size={18} />
              </div>
              <span className="text-amber-100 text-xs font-bold">آجل على العملاء</span>
            </div>
            <p className="text-2xl font-black tracking-tight">{maintenanceStats.totalPendingDebt.toLocaleString('ar-EG')} <span className="text-sm font-medium opacity-80">ج.م</span></p>
            <div className="flex items-center gap-1 mt-2 text-amber-200 text-[11px]">
              <Users size={12} />
              <span>{maintenanceStats.customersWithDebt} عميل عليه آجل ({maintenanceStats.pendingOrdersCount} فاتورة)</span>
            </div>
          </div>
        </div>

        {/* Completed Appointments */}
        <div className="relative overflow-hidden bg-gradient-to-br from-teal-500 to-cyan-600 rounded-2xl p-5 text-white shadow-lg shadow-teal-500/25 group hover:shadow-xl hover:shadow-teal-500/30 transition-all duration-300 hover:-translate-y-1">
          <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6 group-hover:scale-125 transition-transform duration-500" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                <CheckCircle size={18} />
              </div>
              <span className="text-teal-100 text-xs font-bold">زيارات مكتملة</span>
            </div>
            <p className="text-2xl font-black tracking-tight">{maintenanceStats.completedAppointments}</p>
            <div className="flex items-center gap-1 mt-2 text-teal-200 text-[11px]">
              <Clock size={12} />
              <span>{maintenanceStats.pendingAppointments} موعد قادم</span>
            </div>
          </div>
        </div>

        {/* Active Cars */}
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-700 to-slate-900 rounded-2xl p-5 text-white shadow-lg shadow-slate-500/25 group hover:shadow-xl hover:shadow-slate-500/30 transition-all duration-300 hover:-translate-y-1">
          <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6 group-hover:scale-125 transition-transform duration-500" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                <Car size={18} />
              </div>
              <span className="text-slate-300 text-xs font-bold">سيارات مسجلة</span>
            </div>
            <p className="text-2xl font-black tracking-tight">{maintenanceStats.activeCars} <span className="text-sm font-medium opacity-60">/ {maintenanceStats.totalCars}</span></p>
            <div className="flex items-center gap-1 mt-2 text-slate-400 text-[11px]">
              <PieChart size={12} />
              <span>نشطة من إجمالي المسجلة</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden mb-8">
        <div className="flex p-2 bg-slate-50/80 backdrop-blur border-b border-slate-200 gap-2">
          <button
            onClick={() => setActiveTab('appointments')}
            className={`flex-1 py-3 px-6 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all duration-300 ${
              activeTab === 'appointments' 
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/50 transform scale-100' 
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transform scale-95 opacity-80'
            }`}
          >
            <Calendar size={22} className={activeTab === 'appointments' ? 'animate-pulse' : ''} />
            مواعيد الصيانة
          </button>
          <button
            onClick={() => setActiveTab('cars')}
            className={`flex-1 py-3 px-6 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all duration-300 ${
              activeTab === 'cars' 
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/50 transform scale-100' 
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transform scale-95 opacity-80'
            }`}
          >
            <Car size={22} className={activeTab === 'cars' ? 'animate-bounce' : ''} />
            السيارات المسجلة
          </button>
        </div>
        
        <div className="p-6 border-b border-slate-200 bg-slate-50">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative w-full">
              <input
                type="text"
                placeholder="ابحث برقم السيارة أو اسم العميل..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-6 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-medium text-lg bg-white shadow-sm"
              />
              <Search className="absolute left-4 top-4 text-slate-400" size={24} />
            </div>

            {activeTab === 'cars' && (
              <div className="flex gap-2 w-full md:w-auto shrink-0 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-4 py-2 rounded-xl font-bold transition-all flex-1 md:flex-none ${
                    statusFilter === 'all' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  الكل
                </button>
                <button
                  onClick={() => setStatusFilter('active')}
                  className={`px-4 py-2 rounded-xl font-bold transition-all flex-1 md:flex-none ${
                    statusFilter === 'active' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  نشط
                </button>
                <button
                  onClick={() => setStatusFilter('inactive')}
                  className={`px-4 py-2 rounded-xl font-bold transition-all flex-1 md:flex-none ${
                    statusFilter === 'inactive' ? 'bg-red-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  خامل
                </button>
              </div>
            )}
          </div>
        </div>

        {activeTab === 'appointments' && (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-4 font-bold">التاريخ</th>
                  <th className="p-4 font-bold">السيارة</th>
                  <th className="p-4 font-bold">العميل</th>
                  <th className="p-4 font-bold">المطلوب</th>
                  <th className="p-4 font-bold">التقرير/التكلفة</th>
                  <th className="p-4 font-bold">الحالة</th>
                  <th className="p-4 font-bold text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredAppointments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      لا يوجد مواعيد صيانة
                    </td>
                  </tr>
                ) : (
                  filteredAppointments.map(appointment => {
                    const car = carSubscriptions.find(c => c.id === appointment.subscription_id);
                    if (!car) return null;
                    const isCompleted = appointment.status === 'completed';
                    
                    return (
                      <tr key={appointment.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-4 font-medium text-slate-700">
                          {new Date(appointment.appointment_date).toLocaleDateString('ar-SA')}
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-slate-900">{car.car_number}</div>
                          <div className="text-sm text-slate-500 truncate max-w-[150px]" title={car.car_details}>{car.car_details}</div>
                        </td>
                        <td className="p-4">
                          <div className="font-medium text-slate-900">{car.customer_name}</div>
                          <div className="text-sm text-slate-500" dir="ltr">{car.customer_phone}</div>
                        </td>
                        <td className="p-4">
                          <div className="text-slate-700 max-w-[200px] truncate" title={appointment.description}>{appointment.description || '-'}</div>
                        </td>
                        <td className="p-4">
                          {isCompleted ? (
                            <div>
                              <div className="font-medium text-green-700 truncate max-w-[200px]">{appointment.report}</div>
                              <div className="text-sm text-slate-500 font-bold">{getAppointmentCost(appointment, car)} ج.م</div>
                            </div>
                          ) : '-'}
                        </td>
                        <td className="p-4">
                          <span className={`px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1 w-max ${
                            isCompleted ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {isCompleted ? <CheckCircle size={16} /> : <Clock size={16} />}
                            {isCompleted ? 'مكتمل' : 'قيد الانتظار'}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {!isCompleted && (
                              <>
                                <button
                                  onClick={() => handleCompleteWithRegisteredTransactions(appointment, car)}
                                  className="bg-emerald-100 text-emerald-700 px-3 py-2 rounded-lg hover:bg-emerald-200 transition flex items-center gap-1"
                                  title="إنهاء بالمعاملات المالية المسجلة"
                                >
                                  <CheckCircle size={18} />
                                  <span className="text-xs font-bold">إنهاء بالمعاملات</span>
                                </button>
                                <button
                                  onClick={() => { 
                                    setSelectedAppointment(appointment); 
                                    setAppointmentForm({
                                      appointment_date: appointment.appointment_date,
                                      description: appointment.description || ''
                                    });
                                    setShowEditAppointmentModal(true); 
                                  }}
                                  className="bg-blue-100 text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-200 transition"
                                  title="تعديل الموعد"
                                >
                                  <Edit size={18} />
                                </button>
                                <button
                                  onClick={() => sendWhatsAppReminder(appointment, car)}
                                  className="bg-green-100 text-green-700 px-3 py-2 rounded-lg hover:bg-green-200 transition"
                                  title="تذكير واتساب"
                                >
                                  <MessageCircle size={18} />
                                </button>
                              </>
                            )}

                            {isCompleted && (
                              <>
                                <button
                                  onClick={() => {
                                    setSelectedCarId(car.id);
                                    setProfileTab('financial');
                                    setFinancialVisitFilter(appointment.id);
                                    setShowCarProfileModal(true);
                                  }}
                                  className="bg-emerald-100 text-emerald-700 px-3 py-2 rounded-lg hover:bg-emerald-200 transition flex items-center justify-center"
                                  title="عرض المعاملات المالية للزيارة"
                                >
                                  <Eye size={18} />
                                </button>
                                <button
                                  onClick={() => handleSendWhatsAppInvoice(appointment, car)}
                                  className="bg-green-100 text-green-700 px-3 py-2 rounded-lg hover:bg-green-200 transition"
                                  title="إرسال الفاتورة واتساب"
                                >
                                  <MessageCircle size={18} />
                                </button>
                                <button
                                  onClick={() => handlePrintInvoice(appointment, car)}
                                  className="bg-indigo-100 text-indigo-700 px-3 py-2 rounded-lg hover:bg-indigo-200 transition"
                                  title="طباعة الفاتورة"
                                >
                                  <Printer size={18} />
                                </button>
                              </>
                            )}

                            <button
                              onClick={() => handleDeleteAppointment(appointment)}
                              className="bg-red-100 text-red-700 px-3 py-2 rounded-lg hover:bg-red-200 transition"
                              title="حذف الموعد"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'cars' && (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-4 font-bold">تاريخ التسجيل</th>
                  <th className="p-4 font-bold">رقم السيارة</th>
                  <th className="p-4 font-bold">بيانات السيارة</th>
                  <th className="p-4 font-bold">العميل</th>
                  <th className="p-4 font-bold">رقم الهاتف</th>
                  <th className="p-4 font-bold text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredCars.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      لا يوجد سيارات مسجلة
                    </td>
                  </tr>
                ) : (
                  filteredCars.map(car => (
                    <tr key={car.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-4 text-slate-500">
                        {new Date(car.created_at).toLocaleDateString('ar-SA')}
                      </td>
                      <td className="p-4 font-black text-lg text-slate-900 border-l border-slate-100 flex items-center gap-2">
                        {car.car_number}
                        {car.status === 'inactive' && (
                          <span className="bg-red-100 text-red-600 text-xs px-2 py-1 rounded-full">خامل</span>
                        )}
                        {car.subscription_duration_months && car.status !== 'inactive' && (
                          <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                            getRemainingVisits(car.id) === 0 
                              ? 'bg-red-100 text-red-700' 
                              : getRemainingVisits(car.id) <= 2
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-indigo-100 text-indigo-700'
                          }`}>
                            {getRemainingVisits(car.id) === 0 
                              ? 'انتهى' 
                              : getRemainingVisits(car.id) <= 2
                                ? 'اقترب من الانتهاء'
                                : 'ساري'}
                            ({getRemainingVisits(car.id)} متبقي)
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-slate-700">
                        {car.car_details}
                      </td>
                      <td className="p-4 font-medium text-slate-900">
                        {car.customer_name}
                      </td>
                      <td className="p-4 font-mono text-slate-600" dir="ltr">
                        {car.customer_phone}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedCarId(car.id);
                              setCarForm({
                                car_number: car.car_number,
                                car_details: car.car_details || '',
                                customer_name: car.customer_name,
                                customer_phone: car.customer_phone
                              });
                              setShowEditCarModal(true);
                            }}
                            className="bg-blue-100 text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-200 transition"
                            title="تعديل بيانات السيارة"
                          >
                            <Edit size={18} />
                          </button>

                          <button
                            onClick={() => {
                              setSelectedCarId(car.id);
                              setShowCarProfileModal(true);
                            }}
                            className="bg-indigo-50 text-indigo-700 px-3 py-2 rounded-lg hover:bg-indigo-100 transition"
                            title="بروفايل السيارة"
                          >
                            <Receipt size={18} />
                          </button>

                          <button
                            onClick={() => {
                              setSelectedCarId(car.id);
                              setAppointmentForm({
                                appointment_date: new Date().toISOString().split('T')[0],
                                description: ''
                              });
                              setShowAddAppointmentModal(true);
                            }}
                            className="bg-amber-100 text-amber-700 px-3 py-2 rounded-lg hover:bg-amber-200 transition"
                            title="حجز موعد صيانة"
                          >
                            <Calendar size={18} />
                          </button>

                          {car.subscription_duration_months ? (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedCarId(car.id);
                                  setSubscriptionForm({
                                    durationMonths: car.subscription_duration_months || 3,
                                    frequencyDays: car.subscription_frequency_days || 30
                                  });
                                  setShowSubscriptionModal(true);
                                }}
                                className="bg-indigo-100 text-indigo-700 px-3 py-2 rounded-lg hover:bg-indigo-200 transition flex items-center gap-1"
                                title="عرض / تعديل التعاقد"
                              >
                                <Eye size={16} />
                              </button>
                              
                              {getRemainingVisits(car.id) <= 2 && (
                                <button
                                  onClick={() => sendWhatsAppRenewal(car)}
                                  className="bg-green-100 text-green-700 px-3 py-2 rounded-lg hover:bg-green-200 transition"
                                  title="إرسال رسالة تجديد"
                                >
                                  <MessageCircle size={18} />
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                setSelectedCarId(car.id);
                                setSubscriptionForm({ durationMonths: 3, frequencyDays: 30 });
                                setShowSubscriptionModal(true);
                              }}
                              className="bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 transition flex items-center gap-1"
                              title="توليد مواعيد الصيانة"
                            >
                              <RefreshCw size={16} />
                              <span className="text-xs">باقة صيانة</span>
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleStatus(car)}
                            className={`px-3 py-2 rounded-lg flex items-center gap-1 font-bold transition ${
                              car.status === 'inactive'
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                            title={car.status === 'inactive' ? 'تنشيط التعاقد' : 'إيقاف التعاقد'}
                          >
                            <Power size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteCar(car.id)}
                            className="bg-red-100 text-red-700 px-3 py-2 rounded-lg hover:bg-red-200 transition"
                            title="حذف السيارة"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Car Modal */}
      {showAddCarModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden transform transition-all scale-100">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white">
              <h2 className="text-2xl font-black flex items-center gap-3 text-slate-800">
                <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                  <Car size={24} />
                </div>
                تسجيل سيارة جديدة
              </h2>
              <button onClick={() => setShowAddCarModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleAddCar} className="p-8 space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">رقم السيارة <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={carForm.car_number}
                  onChange={e => setCarForm({...carForm, car_number: e.target.value})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-black text-xl bg-slate-50 focus:bg-white"
                  placeholder="مثال: أ ب ج 123"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">بيانات السيارة (الماركة، الموديل، اللون)</label>
                <input
                  type="text"
                  value={carForm.car_details}
                  onChange={e => setCarForm({...carForm, car_details: e.target.value})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-medium bg-slate-50 focus:bg-white"
                  placeholder="مثال: تويوتا كورولا 2022 أسود"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">اسم العميل <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    list="customers-list"
                    value={carForm.customer_name}
                    onChange={e => handleCustomerSelect(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-medium bg-slate-50 focus:bg-white"
                  />
                  <datalist id="customers-list">
                    {customers.map(c => (
                      <option key={c.id} value={c.name}>{c.phone}</option>
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">رقم الهاتف <span className="text-red-500">*</span></label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    list="phones-list"
                    value={carForm.customer_phone}
                    onChange={e => handlePhoneSelect(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-mono text-lg bg-slate-50 focus:bg-white text-left"
                  />
                  <datalist id="phones-list">
                    {customers.filter(c => c.phone).map(c => (
                      <option key={c.id} value={c.phone}>{c.name}</option>
                    ))}
                  </datalist>
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-600/30 transition-all mt-8 transform hover:-translate-y-1"
              >
                تسجيل السيارة
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Add Appointment Modal */}
      {showAddAppointmentModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden transform transition-all scale-100">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white">
              <h2 className="text-2xl font-black flex items-center gap-3 text-slate-800">
                <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                  <Calendar size={24} />
                </div>
                حجز موعد صيانة
              </h2>
              <button onClick={() => setShowAddAppointmentModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleAddAppointment} className="p-8 space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">السيارة المسجلة <span className="text-red-500">*</span></label>
                <select
                  required
                  value={selectedCarId}
                  onChange={e => setSelectedCarId(e.target.value)}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-bold text-lg bg-slate-50 focus:bg-white"
                >
                  <option value="">-- اختر سيارة --</option>
                  <option value="NEW_CAR">+ تسجيل سيارة جديدة...</option>
                  {carSubscriptions.map(car => (
                    <option key={car.id} value={car.id}>
                      {car.car_number} ({car.customer_name})
                    </option>
                  ))}
                </select>
              </div>
              {selectedCarId === 'NEW_CAR' && (
                <div className="space-y-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
                  <h3 className="font-bold text-slate-800 text-sm">بيانات السيارة الجديدة</h3>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">رقم السيارة <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      required
                      value={carForm.car_number}
                      onChange={e => setCarForm({...carForm, car_number: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold text-sm bg-white"
                      placeholder="أ ب ج 123"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">بيانات السيارة</label>
                    <input
                      type="text"
                      value={carForm.car_details}
                      onChange={e => setCarForm({...carForm, car_details: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm bg-white"
                      placeholder="توينتا، مرسيدس..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">اسم العميل <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        required
                        list="modal-customers-list"
                        value={carForm.customer_name}
                        onChange={e => handleCustomerSelect(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm bg-white"
                      />
                      <datalist id="modal-customers-list">
                        {customers.map(c => (
                          <option key={c.id} value={c.name}>{c.phone}</option>
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">رقم الهاتف <span className="text-red-500">*</span></label>
                      <input
                        type="tel"
                        required
                        dir="ltr"
                        list="modal-phones-list"
                        value={carForm.customer_phone}
                        onChange={e => handlePhoneSelect(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-mono text-sm bg-white text-left"
                      />
                      <datalist id="modal-phones-list">
                        {customers.filter(c => c.phone).map(c => (
                          <option key={c.id} value={c.phone}>{c.name}</option>
                        ))}
                      </datalist>
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">تاريخ الموعد <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  required
                  value={appointmentForm.appointment_date}
                  onChange={e => setAppointmentForm({...appointmentForm, appointment_date: e.target.value})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-bold text-lg bg-slate-50 focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">وصف الأعمال المطلوبة</label>
                <textarea
                  value={appointmentForm.description}
                  onChange={e => setAppointmentForm({...appointmentForm, description: e.target.value})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-medium text-lg bg-slate-50 focus:bg-white h-32 resize-none"
                  placeholder="مثال: تغيير زيت وفلتر، فحص شامل..."
                />
              </div>
              <button
                type="submit"
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-600/30 transition-all mt-8 transform hover:-translate-y-1"
              >
                تأكيد حجز الموعد
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Complete Appointment Modal */}
      {showCompleteModal && selectedAppointment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden transform transition-all scale-100">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-emerald-50 to-white">
              <h2 className="text-2xl font-black flex items-center gap-3 text-slate-800">
                <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
                  <CheckCircle size={24} />
                </div>
                إنهاء الصيانة وتحصيل الإيراد
              </h2>
              <button onClick={() => setShowCompleteModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <div className="bg-amber-50 p-5 border-y border-amber-100 flex items-start gap-4">
              <div className="p-2 bg-amber-100 rounded-lg shrink-0 mt-1">
                <AlertTriangle className="text-amber-600" size={24} />
              </div>
              <p className="text-sm text-amber-800 font-bold leading-relaxed">
                إنهاء عملية الصيانة سيقوم بإضافة التكلفة كإيراد فعلي في قسم <span className="underline">المالية والخزينة</span> تحت بند "إيراد صيانة سيارات". يرجى التأكد من التكلفة النهائية وطريقة الدفع.
              </p>
            </div>

            <form onSubmit={handleCompleteAppointment} className="p-8 space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">تقرير الصيانة (ما تم إنجازه) <span className="text-red-500">*</span></label>
                <textarea
                  required
                  value={completeForm.report}
                  onChange={e => setCompleteForm({...completeForm, report: e.target.value})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20 transition-all font-medium text-lg bg-slate-50 focus:bg-white h-32 resize-none"
                  placeholder="مثال: تم تغيير الزيت والفلتر وإصلاح الفرامل..."
                />
              </div>

              {/* Items Section */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-bold text-slate-700">عناصر الفاتورة (قطع غيار ومصنعية)</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setCompleteForm(p => ({ ...p, items: [...p.items, { type: 'part', name: '', costPrice: 0, salePrice: 0 }] }))} className="bg-white border border-slate-200 hover:border-emerald-500 hover:text-emerald-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-sm">
                      <Plus size={14} /> إضافة قطعة
                    </button>
                    <button type="button" onClick={() => setCompleteForm(p => ({ ...p, items: [...p.items, { type: 'labor', name: '', costPrice: 0, salePrice: 0 }] }))} className="bg-white border border-slate-200 hover:border-indigo-500 hover:text-indigo-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-sm">
                      <Plus size={14} /> إضافة مصنعية
                    </button>
                  </div>
                </div>

                {completeForm.items.map((item, index) => (
                  <div key={index} className={`flex flex-wrap md:flex-nowrap items-start gap-3 p-3 rounded-xl border ${item.type === 'part' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-indigo-50/50 border-indigo-100'}`}>
                    <div className="w-full md:flex-1">
                      <input
                        type="text"
                        placeholder={item.type === 'part' ? 'اسم قطعة الغيار' : 'وصف المصنعية'}
                        value={item.name}
                        onChange={e => {
                          const newItems = [...completeForm.items];
                          newItems[index].name = e.target.value;
                          setCompleteForm({...completeForm, items: newItems});
                        }}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-emerald-500 outline-none font-bold"
                        required
                      />
                    </div>
                    {item.type === 'part' && (
                      <div className="w-1/2 md:w-28 relative">
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">سعر الشراء</label>
                        <input
                          type="number"
                          placeholder="0"
                          value={item.costPrice || ''}
                          onChange={e => {
                            const newItems = [...completeForm.items];
                            newItems[index].costPrice = Number(e.target.value);
                            setCompleteForm({...completeForm, items: newItems});
                          }}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-red-500 outline-none font-bold text-red-600"
                          required
                          min="0"
                        />
                      </div>
                    )}
                    <div className="w-1/2 md:w-28 relative">
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">سعر البيع للعميل</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={item.salePrice || ''}
                        onChange={e => {
                          const newItems = [...completeForm.items];
                          newItems[index].salePrice = Number(e.target.value);
                          setCompleteForm({...completeForm, items: newItems});
                        }}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-emerald-500 outline-none font-bold text-emerald-600"
                        required
                        min="0"
                      />
                    </div>
                    <button type="button" onClick={() => {
                      const newItems = completeForm.items.filter((_, i) => i !== index);
                      setCompleteForm({...completeForm, items: newItems});
                    }} className="mt-5 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
                {completeForm.items.length === 0 && (
                  <div className="text-center p-6 bg-white rounded-xl border border-dashed border-slate-200 text-slate-400 font-bold text-sm">
                    لم يتم إضافة عناصر (قطع غيار أو مصنعية) للفاتورة بعد
                  </div>
                )}
                <div className="pt-4 flex justify-between items-center border-t border-slate-200 mt-2">
                  <div className="text-slate-500 text-sm font-bold flex gap-4">
                    <span>إجمالي الشراء: <span className="text-red-600">{completeForm.items.reduce((s, i) => s + i.costPrice, 0)} ج.م</span></span>
                  </div>
                  <div className="text-emerald-700 text-lg font-black bg-emerald-100 px-4 py-1 rounded-xl">
                    الإجمالي المطلوب: {completeForm.items.reduce((s, i) => s + i.salePrice, 0)} ج.م
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-3">طريقة الدفع</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setCompleteForm({...completeForm, payment_method: 'cash'})}
                    className={`p-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 border-2 transition-all duration-300 ${
                      completeForm.payment_method === 'cash' 
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700 shadow-md shadow-emerald-100 scale-105' 
                        : 'border-slate-200 text-slate-500 hover:border-slate-300 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    كاش
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompleteForm({...completeForm, payment_method: 'visa'})}
                    className={`p-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 border-2 transition-all duration-300 ${
                      completeForm.payment_method === 'visa' 
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700 shadow-md shadow-emerald-100 scale-105' 
                        : 'border-slate-200 text-slate-500 hover:border-slate-300 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    فيزا
                  </button>
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-lg hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-600/30 transition-all mt-8 transform hover:-translate-y-1 flex items-center justify-center gap-3"
              >
                <CheckCircle size={24} />
                حفظ وإنهاء وتحصيل الإيراد
              </button>
            </form>
          </div>
        </div>
      )}
      {/* Edit Car Modal */}
      {showEditCarModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden transform transition-all scale-100">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-blue-50 to-white">
              <h2 className="text-2xl font-black flex items-center gap-3 text-slate-800">
                <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
                  <Edit size={24} />
                </div>
                تعديل بيانات السيارة
              </h2>
              <button onClick={() => setShowEditCarModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleEditCar} className="p-8 space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">رقم السيارة <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={carForm.car_number}
                  onChange={e => setCarForm({...carForm, car_number: e.target.value})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-black text-xl bg-slate-50 focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">بيانات السيارة</label>
                <input
                  type="text"
                  value={carForm.car_details}
                  onChange={e => setCarForm({...carForm, car_details: e.target.value})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-medium bg-slate-50 focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">اسم العميل <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    list="customers-list-edit"
                    value={carForm.customer_name}
                    onChange={e => handleCustomerSelect(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-medium bg-slate-50 focus:bg-white"
                  />
                  <datalist id="customers-list-edit">
                    {customers.map(c => (
                      <option key={c.id} value={c.name}>{c.phone}</option>
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">رقم الهاتف <span className="text-red-500">*</span></label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    list="phones-list-edit"
                    value={carForm.customer_phone}
                    onChange={e => handlePhoneSelect(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-mono text-lg bg-slate-50 focus:bg-white text-left"
                  />
                  <datalist id="phones-list-edit">
                    {customers.filter(c => c.phone).map(c => (
                      <option key={c.id} value={c.phone}>{c.name}</option>
                    ))}
                  </datalist>
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/30 transition-all mt-8 transform hover:-translate-y-1 flex justify-center items-center gap-2"
              >
                <Edit size={20} />
                حفظ التعديلات
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Appointment Modal */}
      {showEditAppointmentModal && selectedAppointment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden transform transition-all scale-100">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-blue-50 to-white">
              <h2 className="text-2xl font-black flex items-center gap-3 text-slate-800">
                <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
                  <Calendar size={24} />
                </div>
                تعديل الموعد
              </h2>
              <button onClick={() => setShowEditAppointmentModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleEditAppointment} className="p-8 space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">تاريخ الموعد <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  required
                  value={appointmentForm.appointment_date}
                  onChange={e => setAppointmentForm({...appointmentForm, appointment_date: e.target.value})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-bold text-lg bg-slate-50 focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">وصف الأعمال المطلوبة</label>
                <textarea
                  value={appointmentForm.description}
                  onChange={e => setAppointmentForm({...appointmentForm, description: e.target.value})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-medium text-lg bg-slate-50 focus:bg-white h-32 resize-none"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/30 transition-all mt-8 transform hover:-translate-y-1"
              >
                تحديث الموعد
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Subscription Generator Modal */}
      {showSubscriptionModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden transform transition-all scale-100">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-indigo-50 to-white">
              <h2 className="text-2xl font-black flex items-center gap-3 text-slate-800">
                <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                  <RefreshCw size={24} />
                </div>
                {carSubscriptions.find(c => c.id === selectedCarId)?.subscription_duration_months ? 'عرض وتعديل التعاقد' : 'إنشاء باقة مواعيد'}
              </h2>
              <button onClick={() => setShowSubscriptionModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <div className="bg-indigo-50 p-5 border-y border-indigo-100 flex items-start gap-4">
              <div className="p-2 bg-indigo-100 rounded-lg shrink-0 mt-1">
                <Calendar className="text-indigo-600" size={24} />
              </div>
              <p className="text-sm text-indigo-800 font-bold leading-relaxed">
                {carSubscriptions.find(c => c.id === selectedCarId)?.subscription_duration_months 
                  ? 'يمكنك تعديل نوع الباقة وتكرار الزيارات. عند الحفظ سيتم مسح المواعيد المستقبلية وإعادة توليدها بناءً على التعديلات الجديدة.' 
                  : 'سيقوم هذا النظام بتوليد وتخطيط مواعيد صيانة مستقبلية تلقائياً للسيارة. يمكنك لاحقاً تعديل أي موعد بشكل فردي.'}
              </p>
            </div>

            <form onSubmit={handleGenerateSubscription} className="p-8 space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">نوع الباقة (المدة الزمنية)</label>
                <select
                  value={subscriptionForm.durationMonths}
                  onChange={e => setSubscriptionForm({...subscriptionForm, durationMonths: Number(e.target.value)})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-black text-xl bg-slate-50 focus:bg-white"
                >
                  <option value={3}>ربع سنوي (3 أشهر)</option>
                  <option value={6}>نصف سنوي (6 أشهر)</option>
                  <option value={12}>سنوي (12 شهر)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">تكرار الزيارة (المعدل)</label>
                <select
                  value={subscriptionForm.frequencyDays}
                  onChange={e => setSubscriptionForm({...subscriptionForm, frequencyDays: Number(e.target.value)})}
                  className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all font-black text-xl bg-slate-50 focus:bg-white"
                >
                  <option value={7}>زيارة أسبوعية (كل 7 أيام)</option>
                  <option value={30}>زيارة شهرية (كل 30 يوم)</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-lg hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-600/30 transition-all mt-8 transform hover:-translate-y-1 flex items-center justify-center gap-3"
              >
                <RefreshCw size={24} />
                {carSubscriptions.find(c => c.id === selectedCarId)?.subscription_duration_months ? 'تحديث وإعادة توليد المواعيد' : 'توليد المواعيد الآن'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Car Profile Modal */}
      {showCarProfileModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden transform transition-all scale-100">
            {(() => {
              const car = carSubscriptions.find(c => c.id === selectedCarId);
              if (!car) return null;
              
              const carOrders = orders.filter(o => o.car_id === car.id && !o.is_deleted);
              const carExpenses = expenses.filter(e => e.car_id === car.id);
              const completedAppointments = maintenanceAppointments.filter(a => a.subscription_id === car.id && a.status === 'completed');
              
              const totalRevenue = carOrders.reduce((sum, o) => sum + Number(o.paid_amount || 0), 0);
              const totalExpense = carExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
              const netProfit = totalRevenue - totalExpense;

              const pendingCarDebts = carOrders.filter(o => o.paid_amount < o.total);
              const totalPendingDebt = pendingCarDebts.reduce((sum, o) => sum + (o.total - (o.paid_amount || 0)), 0);

              return (
                <>
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-indigo-900 to-indigo-800 text-white">
                    <div className="flex items-center gap-4">
                      <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm">
                        <Car size={32} className="text-indigo-200" />
                      </div>
                      <div>
                        <h2 className="text-3xl font-black">{car.car_number}</h2>
                        <p className="text-indigo-200 mt-1">{car.customer_name} - {car.car_details}</p>
                      </div>
                    </div>
                    <button onClick={() => setShowCarProfileModal(false)} className="p-2 hover:bg-white/10 rounded-full text-indigo-200 hover:text-white transition-colors">
                      <X size={24} />
                    </button>
                  </div>

                  <div className="flex bg-slate-50 border-b border-slate-200 px-6 pt-4 gap-4">
                    <button
                      onClick={() => setProfileTab('appointments')}
                      className={`px-6 py-3 font-bold text-lg rounded-t-xl transition-all ${
                        profileTab === 'appointments' ? 'bg-white text-indigo-600 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] border-t-2 border-indigo-600' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                      }`}
                    >
                      المواعيد والتقارير
                    </button>
                    <button
                      onClick={() => setProfileTab('financial')}
                      className={`px-6 py-3 font-bold text-lg rounded-t-xl transition-all ${
                        profileTab === 'financial' ? 'bg-white text-indigo-600 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] border-t-2 border-indigo-600' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                      }`}
                    >
                      السجل المالي
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                    {profileTab === 'appointments' && (
                      <div className="space-y-4">
                        <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
                          <CheckCircle className="text-emerald-500" />
                          سجل الزيارات المنتهية
                        </h3>
                        {completedAppointments.length === 0 ? (
                          <div className="text-center p-12 bg-white rounded-2xl border border-slate-100 text-slate-500">
                            لا يوجد مواعيد منتهية حتى الآن
                          </div>
                        ) : (
                          completedAppointments.map(app => (
                            <div key={app.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-start gap-6 hover:shadow-md transition-shadow">
                              <div className="bg-emerald-50 p-4 rounded-2xl text-emerald-600 flex flex-col items-center justify-center shrink-0 w-32">
                                <span className="text-sm font-bold opacity-80">التكلفة</span>
                                <span className="text-xl font-black">{getAppointmentCost(app, car)} ج.م</span>
                              </div>
                              <div className="flex-1">
                                <div className="flex justify-between items-start mb-3">
                                  <h4 className="font-bold text-lg text-slate-800">
                                    {new Date(app.appointment_date).toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                  </h4>
                                  <div className="flex gap-2 shrink-0">
                                    <button 
                                      onClick={() => {
                                        setProfileTab('financial');
                                        setFinancialVisitFilter(app.id);
                                      }}
                                      className="p-2 text-emerald-600 hover:text-emerald-700 bg-emerald-50 rounded-lg flex items-center gap-2 text-xs md:text-sm font-bold transition-all"
                                      title="عرض المعاملات المالية للزيارة"
                                    >
                                      <DollarSign size={16} /> عرض المالية
                                    </button>
                                    <button onClick={() => handlePrintInvoice(app, car)} className="p-2 text-indigo-500 hover:text-indigo-700 bg-indigo-50 rounded-lg flex items-center gap-2 text-xs md:text-sm font-bold transition-all">
                                      <Printer size={16} /> طباعة الفاتورة
                                    </button>
                                    <button 
                                      onClick={() => handleDeleteAppointment(app)}
                                      className="p-2 text-red-600 hover:text-red-700 bg-red-50 rounded-lg flex items-center gap-2 text-xs md:text-sm font-bold transition-all"
                                      title="حذف الزيارة بالكامل"
                                    >
                                      <Trash2 size={16} /> حذف
                                    </button>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <div className="text-slate-600"><span className="font-bold text-slate-700">المطلوب:</span> {app.description || '-'}</div>
                                  <div className="text-slate-600"><span className="font-bold text-slate-700">تقرير الفني:</span> {app.report || '-'}</div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {profileTab === 'financial' && (
                      <div className="space-y-8">
                        {/* Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
                            <div className="p-4 bg-emerald-100 text-emerald-600 rounded-2xl"><TrendingUp size={28} /></div>
                            <div>
                              <p className="text-slate-500 font-bold text-sm">إجمالي الإيرادات</p>
                              <p className="text-2xl font-black text-slate-800">{totalRevenue.toFixed(2)} ج.م</p>
                            </div>
                          </div>
                          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
                            <div className="p-4 bg-red-100 text-red-600 rounded-2xl"><TrendingDown size={28} /></div>
                            <div>
                              <p className="text-slate-500 font-bold text-sm">إجمالي المصروفات</p>
                              <p className="text-2xl font-black text-slate-800">{totalExpense.toFixed(2)} ج.م</p>
                            </div>
                          </div>
                          <div className={`bg-gradient-to-r rounded-2xl p-6 shadow-sm flex items-center gap-4 text-white ${netProfit >= 0 ? 'from-emerald-500 to-emerald-400' : 'from-red-500 to-red-400'}`}>
                            <div className="p-4 bg-white/20 rounded-2xl"><Wallet size={28} /></div>
                            <div>
                              <p className="text-white/80 font-bold text-sm">صافي ربح السيارة</p>
                              <p className="text-3xl font-black">{netProfit.toFixed(2)} ج.م</p>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          {/* Add Revenue */}
                          <div className="bg-gradient-to-br from-white to-emerald-50/30 rounded-3xl p-6 shadow-sm border border-emerald-100 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-bl-[100px] -z-10 group-hover:scale-110 transition-transform"></div>
                            <h3 className="text-xl font-black text-emerald-800 mb-6 flex items-center gap-3">
                              <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl shadow-sm">
                                <TrendingUp size={24} />
                              </div>
                              إضافة إيراد / تحصيل
                            </h3>
                            <form onSubmit={handleAddCarRevenue} className="space-y-5 relative z-10">
                              <div className="flex gap-4">
                                <div className="flex-1">
                                  <label className="block text-sm font-bold text-slate-700 mb-2">المبلغ</label>
                                  <input type="number" required value={revenueForm.amount} onChange={e => setRevenueForm({...revenueForm, amount: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50" placeholder="0.00" />
                                </div>
                                <div className="flex-1">
                                  <label className="block text-sm font-bold text-slate-700 mb-2">نوع الإيراد</label>
                                  <select required value={revenueForm.revenue_type} onChange={e => setRevenueForm({...revenueForm, revenue_type: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50">
                                    <option value="product">إيراد بيع منتج صيانة</option>
                                    <option value="labor">إيراد مصنعية صيانة</option>
                                    <option value="other">أخرى</option>
                                  </select>
                                </div>
                                <div className="flex-1">
                                  <label className="block text-sm font-bold text-slate-700 mb-2">حالة الإيراد</label>
                                  <div className="flex items-center gap-3 bg-slate-50 border-2 border-slate-200 px-4 py-3 rounded-xl">
                                    <input 
                                      type="checkbox" 
                                      id="is_pending_rev"
                                      checked={revenueForm.is_pending}
                                      onChange={e => setRevenueForm({...revenueForm, is_pending: e.target.checked})}
                                      className="w-5 h-5 accent-emerald-500"
                                    />
                                    <label htmlFor="is_pending_rev" className="font-bold text-slate-700 cursor-pointer select-none">
                                      إيراد معلق (يُضاف كدين)
                                    </label>
                                  </div>
                                </div>
                                {!revenueForm.is_pending && (
                                  <div className="flex-1">
                                    <label className="block text-sm font-bold text-slate-700 mb-2">طريقة الدفع</label>
                                    <select required value={revenueForm.payment_method} onChange={e => setRevenueForm({...revenueForm, payment_method: e.target.value as any})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50">
                                      <option value="cash">كاش</option>
                                      <option value="visa">فيزا</option>
                                      <option value="wallet">محفظة</option>
                                      <option value="instapay">انستا باي</option>
                                    </select>
                                  </div>
                                )}
                              </div>
                              <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">تابعة لزيارة <span className="text-red-500">*</span></label>
                                <select required value={revenueForm.appointment_id} onChange={e => setRevenueForm({...revenueForm, appointment_id: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50">
                                  <option value="">-- اختر زيارة --</option>
                                  <option value="NEW_ONE_TIME" className="font-bold text-emerald-600 bg-emerald-50">➕ فتح زيارة لمرة واحدة (اليوم)</option>
                                  {maintenanceAppointments.filter(a => a.subscription_id === selectedCarId).map(a => (
                                    <option key={a.id} value={a.id}>
                                      زيارة {new Date(a.appointment_date).toLocaleDateString('ar-SA')} - {a.description} {a.status === 'completed' ? '(منتهية)' : '(قيد التنفيذ)'}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">البيان</label>
                                <input type="text" required value={revenueForm.notes} onChange={e => setRevenueForm({...revenueForm, notes: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50" />
                              </div>
                              <button type="submit" className="w-full bg-emerald-500 text-white py-3 rounded-xl font-bold hover:bg-emerald-600 transition">تأكيد إضافة الإيراد</button>
                            </form>
                          </div>

                          {/* Add Expense / Service Item */}
                          <div className="bg-gradient-to-br from-white to-red-50/30 rounded-3xl p-6 shadow-sm border border-red-100 relative overflow-hidden group">
                            <div className="absolute top-0 left-0 w-32 h-32 bg-red-500/5 rounded-br-[100px] -z-10 group-hover:scale-110 transition-transform"></div>
                            <h3 className="text-xl font-black text-red-800 mb-6 flex items-center gap-3">
                              <div className="p-3 bg-red-100 text-red-600 rounded-xl shadow-sm">
                                <TrendingDown size={24} />
                              </div>
                              إضافة مصروف / خدمة
                            </h3>
                            <form onSubmit={handleAddCarExpense} className="space-y-5 relative z-10">
                              <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">نوع المصروف</label>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                  {([
                                    { val: 'product', label: 'شراء منتج', active: 'border-amber-500 bg-amber-50 text-amber-700 shadow-sm scale-105' },
                                    { val: 'labor', label: 'مصنعية', active: 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm scale-105' },
                                    { val: 'service_cost', label: 'مصاريف خدمة', active: 'border-purple-500 bg-purple-50 text-purple-700 shadow-sm scale-105' },
                                    { val: 'other', label: 'أخرى', active: 'border-slate-500 bg-slate-100 text-slate-700 shadow-sm scale-105' }
                                  ] as const).map(opt => (
                                    <button
                                      key={opt.val}
                                      type="button"
                                      onClick={() => setExpenseForm({...expenseForm, expense_type: opt.val as any})}
                                      className={`p-3 rounded-xl text-sm font-bold border-2 transition-all ${
                                        expenseForm.expense_type === opt.val
                                          ? opt.active
                                          : 'border-slate-200 text-slate-500 hover:border-slate-300 bg-slate-50'
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="flex gap-4">
                                <div className="flex-1">
                                  <label className="block text-sm font-bold text-slate-700 mb-2">سعر الشراء / التكلفة <span className="text-red-500">*</span></label>
                                  <input type="number" required min="0" value={expenseForm.costPrice} onChange={e => setExpenseForm({...expenseForm, costPrice: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-red-500 bg-slate-50 font-bold text-red-600" placeholder="0.00" />
                                </div>
                                <div className="flex-1">
                                  <label className="block text-sm font-bold text-slate-700 mb-2">سعر البيع للعميل <span className="text-slate-400 text-xs">(اختياري)</span></label>
                                  <input type="number" min="0" value={expenseForm.salePrice} onChange={e => setExpenseForm({...expenseForm, salePrice: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50 font-bold text-emerald-600" placeholder="0.00" />
                                </div>
                              </div>
                              
                              <div className="flex gap-4">
                                <div className="flex-1">
                                  <label className="block text-sm font-bold text-slate-700 mb-2">طريقة الدفع <span className="text-slate-400 text-xs">(للتكلفة)</span></label>
                                  <select required value={expenseForm.payment_method} onChange={e => setExpenseForm({...expenseForm, payment_method: e.target.value as any})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-red-500 bg-slate-50">
                                    <option value="cash">كاش</option>
                                    <option value="visa">فيزا</option>
                                    <option value="wallet">محفظة</option>
                                    <option value="instapay">انستا باي</option>
                                  </select>
                                </div>
                                {Number(expenseForm.salePrice) > 0 && (
                                  <div className="flex-1">
                                    <label className="block text-sm font-bold text-slate-700 mb-2">حالة البيع للعميل</label>
                                    <div className="flex items-center gap-3 bg-slate-50 border-2 border-slate-200 px-4 py-3 rounded-xl h-[52px]">
                                      <input 
                                        type="checkbox" 
                                        id="is_pending_exp"
                                        checked={expenseForm.is_sale_pending}
                                        onChange={e => setExpenseForm({...expenseForm, is_sale_pending: e.target.checked})}
                                        className="w-5 h-5 accent-emerald-500"
                                      />
                                      <label htmlFor="is_pending_exp" className="font-bold text-slate-700 cursor-pointer select-none">
                                        يُضاف كدين معلق
                                      </label>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {Number(expenseForm.salePrice) > 0 && Number(expenseForm.costPrice) > 0 && (
                                <div className="bg-gradient-to-r from-emerald-50 to-indigo-50 p-3 rounded-xl border border-emerald-100 flex justify-between items-center">
                                  <span className="text-sm font-bold text-slate-600">صافي الربح من هذه العملية:</span>
                                  <span className={`font-black text-lg ${Number(expenseForm.salePrice) - Number(expenseForm.costPrice) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {(Number(expenseForm.salePrice) - Number(expenseForm.costPrice)).toFixed(2)} ج.م
                                  </span>
                                </div>
                              )}
                              <div className="flex gap-4">
                                <div className="flex-1">
                                  <label className="block text-sm font-bold text-slate-700 mb-2">طريقة الدفع</label>
                                  <select required value={expenseForm.payment_method} onChange={e => setExpenseForm({...expenseForm, payment_method: e.target.value as any})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-red-500 bg-slate-50">
                                    <option value="cash">كاش</option>
                                    <option value="visa">فيزا</option>
                                    <option value="wallet">محفظة</option>
                                    <option value="instapay">انستا باي</option>
                                  </select>
                                </div>
                                <div className="flex-1">
                                  <label className="block text-sm font-bold text-slate-700 mb-2">تابعة لزيارة <span className="text-red-500">*</span></label>
                                  <select required value={expenseForm.appointment_id} onChange={e => setExpenseForm({...expenseForm, appointment_id: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-red-500 bg-slate-50">
                                    <option value="">-- اختر زيارة --</option>
                                    <option value="NEW_ONE_TIME" className="font-bold text-red-600 bg-red-50">➕ فتح زيارة لمرة واحدة (اليوم)</option>
                                    {maintenanceAppointments.filter(a => a.subscription_id === selectedCarId).map(a => (
                                      <option key={a.id} value={a.id}>
                                        زيارة {new Date(a.appointment_date).toLocaleDateString('ar-SA')} - {a.description} {a.status === 'completed' ? '(منتهية)' : '(قيد التنفيذ)'}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">البيان / الوصف</label>
                                <input type="text" required value={expenseForm.note} onChange={e => setExpenseForm({...expenseForm, note: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-red-500 bg-slate-50" placeholder="وصف المصروف أو الخدمة..." />
                              </div>
                              <button type="submit" className="w-full bg-red-500 text-white py-3 rounded-xl font-bold hover:bg-red-600 transition">تأكيد إضافة المصروف / الخدمة</button>
                            </form>
                          </div>
                        </div>

                        {/* Transaction History */}
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                            <h3 className="text-xl font-black text-slate-800">سجل الحركات</h3>
                            <div className="flex items-center gap-3 w-full md:w-auto">
                              <div className="flex items-center gap-2 flex-1 md:flex-none">
                                <Filter size={16} className="text-slate-400" />
                                <select value={financialVisitFilter} onChange={e => setFinancialVisitFilter(e.target.value)} className="px-3 py-2 rounded-xl border-2 border-slate-200 text-sm font-bold bg-slate-50 focus:border-indigo-500">
                                  <option value="all">كل الحركات</option>
                                  {completedAppointments.map(a => (
                                    <option key={a.id} value={a.id}>زيارة {new Date(a.appointment_date).toLocaleDateString('ar-SA')}</option>
                                  ))}
                                  <option value="unlinked">بدون زيارة</option>
                                </select>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  if (totalPendingDebt > 0) {
                                    setCollectAllForm({ cash: totalPendingDebt, visa: 0, wallet: 0, instapay: 0 });
                                    setShowCollectAllModal(true);
                                  }
                                }}
                                disabled={totalPendingDebt <= 0}
                                className="p-2 bg-emerald-50 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100 rounded-xl flex items-center gap-2 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                💰 تحصيل الكل ({totalPendingDebt.toFixed(2)})
                              </button>
                              
                              <button
                                type="button"
                                onClick={() => {
                                  let phone = car.customer_phone.replace(/\D/g, '');
                                  if (phone.startsWith('01')) phone = '2' + phone;
                                  
                                  const getPublicInvoiceUrl = (invoiceId: string) => {
                                    const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                                      ? 'https://cashier-branch3.vercel.app'
                                      : window.location.origin;
                                    return `${baseUrl}/view-invoice/${invoiceId}`;
                                  };

                                  // If a specific visit is filtered, send detailed invoice
                                  if (financialVisitFilter !== 'all' && financialVisitFilter !== 'unlinked') {
                                    const visitAppointment = maintenanceAppointments.find(a => a.id === financialVisitFilter);
                                    const visitDate = visitAppointment ? new Date(visitAppointment.appointment_date).toLocaleDateString('ar-SA') : '';
                                    const visitReport = visitAppointment?.report || visitAppointment?.description || 'زيارة صيانة';
                                    
                                    // Get filtered transactions for this visit
                                    const visitOrders = carOrders.filter(o => {
                                      const n = (o as any).notes || '';
                                      return n.includes(`[زيارة:${financialVisitFilter}]`) || (o as any).items?.some((i: any) => i.id?.startsWith(`maint-${financialVisitFilter}`));
                                    });
                                    
                                    const visitRevenue = visitOrders.reduce((sum, o) => sum + Number((o as any).total || (o as any).paid_amount || 0), 0);
                                    const visitPaid = visitOrders.reduce((sum, o) => sum + Number((o as any).paid_amount || 0), 0);
                                    const visitDebt = visitRevenue - visitPaid;
                                    
                                    // Build detailed items list
                                    let itemsText = '';
                                    let itemIndex = 1;
                                    visitOrders.forEach(o => {
                                      const items = (o as any).items || [];
                                      if (items.length > 0) {
                                        items.forEach((item: any) => {
                                          const itemTotal = (item.sale_price || 0) * (item.quantity || 1);
                                          itemsText += `${itemIndex}. ${item.name} — ${itemTotal.toLocaleString('ar-EG')} ج.م\n`;
                                          itemIndex++;
                                        });
                                      } else {
                                        const note = ((o as any).notes || '').replace(/\[زيارة:[^\]]+\]/g, '').trim() || 'إيراد صيانة';
                                        const amount = Number((o as any).total || (o as any).paid_amount || 0);
                                        itemsText += `${itemIndex}. ${note} — ${amount.toLocaleString('ar-EG')} ج.م\n`;
                                        itemIndex++;
                                      }
                                    });
                                    
                                    const invoiceUrl = getPublicInvoiceUrl(financialVisitFilter);
                                    
                                    const text = `*فاتورة صيانة إلكترونية 🚗*\n\n` +
                                      `*بيانات العميل:*\n` +
                                      `👤 الاسم: ${car.customer_name}\n` +
                                      `📱 الهاتف: ${car.customer_phone}\n\n` +
                                      `*بيانات السيارة:*\n` +
                                      `🚘 رقم السيارة: ${car.car_number}\n` +
                                      `📝 تفاصيل: ${car.car_details || '-'}\n\n` +
                                      `*تفاصيل الزيارة (${visitDate}):*\n` +
                                      `🔧 ${visitReport}\n\n` +
                                      `*البنود والخدمات:*\n` +
                                      itemsText + `\n` +
                                      `━━━━━━━━━━━━━━━\n` +
                                      `💰 *الإجمالي: ${visitRevenue.toLocaleString('ar-EG')} ج.م*\n` +
                                      (visitDebt > 0 ? `✅ المدفوع: ${visitPaid.toLocaleString('ar-EG')} ج.م\n⏳ المتبقي: ${visitDebt.toLocaleString('ar-EG')} ج.م\n` : `✅ تم السداد بالكامل\n`) +
                                      `━━━━━━━━━━━━━━━\n\n` +
                                      `📄 رابط الفاتورة الإلكترونية:\n${invoiceUrl}\n\n` +
                                      (storeSettings.locationUrl ? `📍 *موقعنا على الخريطة:*\n${storeSettings.locationUrl}\n\n` : '') +
                                      `شكراً لثقتكم بنا 🙏`;
                                    
                                    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
                                  } else {
                                    // Default: send summary
                                    const latestOrder = carOrders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
                                    const invoiceUrl = latestOrder ? getPublicInvoiceUrl(latestOrder.id) : '';
                                    const invoiceLine = invoiceUrl ? `\nرابط الفاتورة الإلكترونية: ${invoiceUrl}` : '';
                                    
                                    const locationText = storeSettings.locationUrl ? `\n📍 موقعنا على الخريطة: ${storeSettings.locationUrl}` : '';
                                    const text = `أهلاً بك عميلنا العزيز ${car.customer_name}،\n\nملخص حساب سيارة (${car.car_number}):\nإجمالي الحساب: ${totalRevenue.toFixed(2)} ج.م\nالمدفوع: ${(totalRevenue - totalPendingDebt).toFixed(2)} ج.م\nالمتبقي (ديون معلقة): ${totalPendingDebt.toFixed(2)} ج.م${invoiceLine}${locationText}\n\nشكراً لتعاملكم معنا.`;
                                    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
                                  }
                                }}
                                className="p-2 bg-green-50 text-green-600 hover:text-green-700 hover:bg-green-100 rounded-xl flex items-center gap-2 text-sm font-bold transition-all"
                              >
                                <MessageCircle size={16} /> واتساب
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  // Filter transactions based on current filter
                                  let txOrders = [...carOrders];
                                  let txExpenses = [...carExpenses];
                                  if (financialVisitFilter !== 'all') {
                                    if (financialVisitFilter === 'unlinked') {
                                      txOrders = txOrders.filter(o => { const n = (o as any).notes || ''; return !n.includes('[زيارة:') && !(o as any).items?.some((i: any) => i.id?.startsWith('maint-')); });
                                      txExpenses = txExpenses.filter(e => { const n = (e as any).note || ''; return !n.includes('[زيارة:'); });
                                    } else {
                                      txOrders = txOrders.filter(o => { const n = (o as any).notes || ''; return n.includes(`[زيارة:${financialVisitFilter}]`) || (o as any).items?.some((i: any) => i.id?.startsWith(`maint-${financialVisitFilter}`)); });
                                      txExpenses = txExpenses.filter(e => { const n = (e as any).note || ''; return n.includes(`[زيارة:${financialVisitFilter}]`); });
                                    }
                                  }
                                  const allTx = [
                                    ...txOrders.map(o => ({ type: 'إيراد', date: new Date(o.date).toLocaleString('ar-SA'), amount: (o as any).paid_amount, method: (o as any).payment_method, note: ((o as any).notes || '').replace(/\[زيارة:[^\]]+\]/g, '').trim() })),
                                    ...txExpenses.map(e => ({ type: 'مصروف', date: new Date(e.date).toLocaleString('ar-SA'), amount: (e as any).amount, method: (e as any).payment_method, note: ((e as any).note || '').replace(/\[زيارة:[^\]]+\]/g, '').trim() }))
                                  ];
                                  const pw = window.open('', '_blank');
                                  if (!pw) return;
                                  pw.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير مالي - ${escapeHtml(car.car_number)}</title><style>@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');body{font-family:'Cairo',sans-serif;padding:30px;color:#1e293b}h1{font-size:22px}h2{font-size:16px;color:#475569;margin-bottom:20px}table{width:100%;border-collapse:collapse;margin-top:15px}th{background:#f1f5f9;padding:10px;text-align:right;border-bottom:2px solid #cbd5e1;font-size:13px}td{padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px}.summary{display:flex;gap:20px;margin:20px 0}.summary div{flex:1;padding:15px;border-radius:12px;text-align:center}.rev{background:#ecfdf5;color:#059669}.exp{background:#fef2f2;color:#dc2626}.net{background:#eef2ff;color:#4f46e5}@media print{body{padding:0}}</style></head><body><h1>تقرير مالي - سيارة ${escapeHtml(car.car_number)}</h1><h2>${escapeHtml(car.car_details)} | العميل: ${escapeHtml(car.customer_name)}</h2><div class="summary"><div class="rev"><b>الإيرادات</b><br/>${totalRevenue.toFixed(2)} ج.م</div><div class="exp"><b>المصروفات</b><br/>${totalExpense.toFixed(2)} ج.م</div><div class="net"><b>صافي الربح</b><br/>${netProfit.toFixed(2)} ج.م</div></div><table><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>طريقة الدفع</th><th>البيان</th></tr></thead><tbody>${allTx.map(t => `<tr><td>${escapeHtml(t.date)}</td><td>${escapeHtml(t.type)}</td><td>${t.amount} ج.م</td><td>${t.method === 'cash' ? 'كاش' : t.method === 'visa' ? 'فيزا' : t.method === 'wallet' ? 'محفظة' : 'انستا باي'}</td><td>${escapeHtml(t.note)}</td></tr>`).join('')}</tbody></table><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500)}</script></body></html>`);
                                  pw.document.close();
                                }}
                                className="p-2 bg-indigo-50 text-indigo-600 hover:text-indigo-700 rounded-xl flex items-center gap-2 text-sm font-bold transition-all"
                              >
                                <Printer size={16} /> طباعة التقرير
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  let invoiceOrders = [...carOrders];
                                  if (financialVisitFilter !== 'all' && financialVisitFilter !== 'unlinked') {
                                    invoiceOrders = invoiceOrders.filter(o => {
                                      const n = (o as any).notes || '';
                                      return n.includes(`[زيارة:${financialVisitFilter}]`) || (o as any).items?.some((i: any) => i.id?.startsWith(`maint-${financialVisitFilter}`));
                                    });
                                  }
                                  const visitInfo = financialVisitFilter !== 'all' && financialVisitFilter !== 'unlinked'
                                    ? completedAppointments.find(a => a.id === financialVisitFilter)
                                    : null;
                                  const invoiceItems = invoiceOrders.flatMap(o => {
                                    if (!o.items || o.items.length === 0) {
                                      const name = (o.notes || '').replace(/\[زيارة:[^\]]+\]/g, '').trim() || 'إيراد صيانة';
                                      return [{
                                        id: `virtual-${o.id}`,
                                        name,
                                        barcode: '',
                                        purchase_price: 0,
                                        average_purchase_price: 0,
                                        sale_price: o.total || o.paid_amount || 0,
                                        stock_quantity: 99999,
                                        category_id: '',
                                        unit: 'قطعة',
                                        quantity: 1,
                                        returned_quantity: 0,
                                        refunded_amount: 0,
                                        date: new Date(o.date).toLocaleDateString('ar-SA')
                                      }];
                                    }
                                    return o.items.map((item: any) => ({
                                      id: item.id,
                                      name: item.name,
                                      barcode: item.barcode || '',
                                      purchase_price: item.purchase_price || 0,
                                      average_purchase_price: item.purchase_price || 0,
                                      sale_price: item.sale_price,
                                      stock_quantity: 99999,
                                      category_id: item.category_id || '',
                                      unit: item.unit || 'قطعة',
                                      quantity: item.quantity || 1,
                                      returned_quantity: item.returned_quantity || 0,
                                      refunded_amount: item.refunded_amount || 0,
                                      date: new Date(o.date || (o as any).created_at || new Date().toISOString()).toLocaleDateString('ar-SA')
                                    }));
                                  });
                                  const grandTotal = invoiceItems.reduce((sum, item) => sum + item.sale_price * item.quantity, 0);
                                  const payment_method = invoiceOrders[0]?.payment_method || 'cash';
                                  
                                  const mockOrder = {
                                    id: visitInfo?.id || `maint-${car.id}-${Date.now()}`,
                                    total: grandTotal,
                                    paid_amount: grandTotal,
                                    paid_cash: payment_method === 'cash' ? grandTotal : 0,
                                    paid_visa: payment_method === 'visa' ? grandTotal : 0,
                                    paid_wallet: payment_method === 'wallet' ? grandTotal : 0,
                                    paid_instapay: payment_method === 'instapay' ? grandTotal : 0,
                                    type: 'sale' as const,
                                    payment_method,
                                    date: visitInfo?.appointment_date || new Date().toISOString(),
                                    items: invoiceItems,
                                    is_deleted: false,
                                    report: visitInfo?.report || visitInfo?.description || ''
                                  };
                                  
                                  printMaintenanceInvoice(mockOrder, {
                                    carNumber: car.car_number,
                                    carDetails: car.car_details,
                                    customerName: car.customer_name,
                                    customerPhone: car.customer_phone
                                  }, storeSettings);
                                }}
                                className="p-2 bg-emerald-50 text-emerald-600 hover:text-emerald-700 rounded-xl flex items-center gap-2 text-sm font-bold transition-all"
                              >
                                <Receipt size={16} /> فاتورة للعميل
                              </button>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-right">
                              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                                <tr>
                                  <th className="p-4 font-bold">التاريخ</th>
                                  <th className="p-4 font-bold">النوع</th>
                                  <th className="p-4 font-bold">المبلغ</th>
                                  <th className="p-4 font-bold">طريقة الدفع</th>
                                  <th className="p-4 font-bold">البيان</th>
                                  <th className="p-4 font-bold text-center">إجراءات</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(() => {
                                  let filteredTransactions = [
                                    ...carOrders.map(o => ({ ...o, _type: 'revenue' as const, _date: new Date(o.date) })),
                                    ...carExpenses.map(e => ({ ...e, _type: 'expense' as const, _date: new Date(e.date) }))
                                  ].sort((a, b) => b._date.getTime() - a._date.getTime());

                                  if (financialVisitFilter !== 'all') {
                                    if (financialVisitFilter === 'unlinked') {
                                      filteredTransactions = filteredTransactions.filter(t => {
                                        const note = (t as any).notes || (t as any).note || '';
                                        return !note.includes('[زيارة:') && !(t as any).items?.some((i: any) => i.id?.startsWith('maint-'));
                                      });
                                    } else {
                                      filteredTransactions = filteredTransactions.filter(t => {
                                        const note = (t as any).notes || (t as any).note || '';
                                        return note.includes(`[زيارة:${financialVisitFilter}]`) || (t as any).items?.some((i: any) => i.id?.startsWith(`maint-${financialVisitFilter}`));
                                      });
                                    }
                                  }

                                  if (filteredTransactions.length === 0) {
                                    return <tr><td colSpan={5} className="p-8 text-center text-slate-500">لا يوجد حركات مسجلة</td></tr>;
                                  }

                                  return filteredTransactions.map((t, idx) => (
                                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                                      <td className="p-4 text-slate-600">{t._date.toLocaleString('ar-SA')}</td>
                                      <td className="p-4">
                                        <span className={`px-2 py-1 rounded-lg text-xs font-bold ${t._type === 'revenue' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                          {t._type === 'revenue' ? 'إيراد' : 'مصروف'}
                                        </span>
                                      </td>
                                      <td className={`p-4 font-black ${t._type === 'revenue' ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {t._type === 'revenue' ? '+' : '-'}{t._type === 'revenue' && (t as any).paid_amount === 0 ? (t as any).total : t._type === 'revenue' ? (t as any).paid_amount : (t as any).amount} ج.م
                                        {t._type === 'revenue' && (t as any).paid_amount === 0 && (
                                          <span className="mr-2 text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full whitespace-nowrap">آجل (معلق)</span>
                                        )}
                                      </td>
                                      <td className="p-4 text-slate-600">{(t as any).payment_method === 'cash' ? 'كاش' : (t as any).payment_method === 'visa' ? 'فيزا' : (t as any).payment_method === 'wallet' ? 'محفظة' : 'انستا باي'}</td>
                                      <td className="p-4 text-slate-700 max-w-xs truncate" title={(t as any).notes || (t as any).note}>
                                        {((t as any).notes || (t as any).note || '-').replace(/\[زيارة:[^\]]+\]/g, '').trim() || '-'}
                                      </td>
                                      <td className="p-4 flex items-center justify-center gap-2">
                                        {t._type === 'revenue' && (t as any).paid_amount === 0 && (
                                          <button
                                            onClick={() => { setCollectingTransaction({...t, amountToCollect: (t as any).total}); setShowCollectTransactionModal(true); }}
                                            className="px-2 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded text-xs font-bold transition-colors"
                                          >
                                            تحصيل
                                          </button>
                                        )}
                                        <button
                                          onClick={() => { setEditingTransaction(t); setShowEditTransactionModal(true); }}
                                          className="p-1 text-slate-400 hover:text-indigo-600 transition-colors rounded hover:bg-indigo-50"
                                        >
                                          <Edit2 size={16} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteTransaction(t)}
                                          className="p-1 text-slate-400 hover:text-red-600 transition-colors rounded hover:bg-red-50"
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                      </td>
                                    </tr>
                                  ));
                                })()}
                              </tbody>
                            </table>
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>

      {showCollectTransactionModal && collectingTransaction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl relative">
            <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3">
              <span className="p-2 bg-emerald-100 text-emerald-600 rounded-xl"><Receipt size={24} /></span>
              تحصيل إيراد معلق
            </h2>
            <form onSubmit={handleCollectSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">المبلغ المراد تحصيله</label>
                <input type="number" required max={collectingTransaction.total} value={collectingTransaction.amountToCollect} onChange={e => setCollectingTransaction({...collectingTransaction, amountToCollect: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50" placeholder="0.00" />
                <p className="text-xs text-slate-500 mt-1">المبلغ الإجمالي المعلق: {collectingTransaction.total} ج.م</p>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">طريقة الدفع</label>
                <select required value={collectingTransaction.payment_method} onChange={e => setCollectingTransaction({...collectingTransaction, payment_method: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50">
                  <option value="cash">كاش</option>
                  <option value="visa">فيزا</option>
                  <option value="wallet">محفظة</option>
                  <option value="instapay">انستا باي</option>
                </select>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="submit" className="flex-1 bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700 transition">تأكيد التحصيل</button>
                <button type="button" onClick={() => setShowCollectTransactionModal(false)} className="flex-1 bg-slate-100 text-slate-700 font-bold py-3 rounded-xl hover:bg-slate-200 transition">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditTransactionModal && editingTransaction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl relative">
            <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3">
              <span className="p-2 bg-indigo-100 text-indigo-600 rounded-xl"><Edit2 size={24} /></span>
              تعديل {editingTransaction._type === 'revenue' ? 'إيراد' : 'مصروف'}
            </h2>
            <form onSubmit={handleEditTransactionSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">المبلغ</label>
                <input type="number" required value={editingTransaction._type === 'revenue' ? editingTransaction.paid_amount : editingTransaction.amount} onChange={e => setEditingTransaction({...editingTransaction, [editingTransaction._type === 'revenue' ? 'paid_amount' : 'amount']: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 bg-slate-50" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">البيان / الوصف</label>
                <input type="text" required value={editingTransaction._type === 'revenue' ? editingTransaction.notes : editingTransaction.note} onChange={e => setEditingTransaction({...editingTransaction, [editingTransaction._type === 'revenue' ? 'notes' : 'note']: e.target.value})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 bg-slate-50" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">طريقة الدفع</label>
                <select value={editingTransaction.payment_method || 'cash'} onChange={e => setEditingTransaction({...editingTransaction, payment_method: e.target.value as any})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 bg-slate-50">
                  <option value="cash">كاش</option>
                  <option value="visa">فيزا</option>
                  <option value="wallet">محفظة</option>
                  <option value="instapay">انستا باي</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">تاريخ الحركة</label>
                <input 
                  type="datetime-local" 
                  value={editingTransaction.date ? new Date(new Date(editingTransaction.date).getTime() - new Date().getTimezoneOffset()*60000).toISOString().slice(0, 16) : ''} 
                  onChange={e => {
                    const localTime = new Date(e.target.value);
                    setEditingTransaction({...editingTransaction, date: localTime.toISOString()});
                  }} 
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 bg-slate-50" 
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button type="submit" className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition">حفظ التعديلات</button>
                <button type="button" onClick={() => setShowEditTransactionModal(false)} className="flex-1 bg-slate-100 text-slate-700 font-bold py-3 rounded-xl hover:bg-slate-200 transition">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCollectAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 w-full max-w-lg shadow-2xl relative">
            <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3">
              <span className="p-2 bg-emerald-100 text-emerald-600 rounded-xl"><Wallet size={24} /></span>
              تحصيل مجمع لكل الديون
            </h2>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const car = carSubscriptions.find(c => c.id === selectedCarId);
              if (!car) return;
              const pendingCarDebts = orders.filter(o => o.car_id === car.id && !o.is_deleted && o.paid_amount < o.total);
              
              let remainingCash = Number(collectAllForm.cash) || 0;
              let remainingVisa = Number(collectAllForm.visa) || 0;
              let remainingWallet = Number(collectAllForm.wallet) || 0;
              let remainingInstapay = Number(collectAllForm.instapay) || 0;

              for (const debt of pendingCarDebts) {
                const debtAmount = debt.total - (debt.paid_amount || 0);
                let toPayFromCash = Math.min(remainingCash, debtAmount); remainingCash -= toPayFromCash;
                let toPayFromVisa = Math.min(remainingVisa, debtAmount - toPayFromCash); remainingVisa -= toPayFromVisa;
                let toPayFromWallet = Math.min(remainingWallet, debtAmount - toPayFromCash - toPayFromVisa); remainingWallet -= toPayFromWallet;
                let toPayFromInstapay = Math.min(remainingInstapay, debtAmount - toPayFromCash - toPayFromVisa - toPayFromWallet); remainingInstapay -= toPayFromInstapay;
                
                const totalPaidNow = toPayFromCash + toPayFromVisa + toPayFromWallet + toPayFromInstapay;
                if (totalPaidNow > 0) {
                  const splitObj = { cash: toPayFromCash, visa: toPayFromVisa, wallet: toPayFromWallet, instapay: toPayFromInstapay };
                  const methods = [
                    { name: 'cash', amount: toPayFromCash },
                    { name: 'visa', amount: toPayFromVisa },
                    { name: 'wallet', amount: toPayFromWallet },
                    { name: 'instapay', amount: toPayFromInstapay }
                  ];
                  const primaryMethod = methods.sort((a, b) => b.amount - a.amount)[0].name;
                  let cid = debt.customer?.id;
                  if (!cid) {
                    const existingCust = customers.find(cust => 
                      (car.customer_phone && cust.phone === car.customer_phone) || 
                      (car.customer_name && cust.name === car.customer_name)
                    );
                    cid = existingCust?.id;
                  }
                  await payInvoiceDebt(debt.id, cid || '', totalPaidNow, splitObj, primaryMethod);
                }
              }

              setShowCollectAllModal(false);
              const totalAmount = Number(collectAllForm.cash) + Number(collectAllForm.visa) + Number(collectAllForm.wallet) + Number(collectAllForm.instapay);
              
              const totalPendingDebt = pendingCarDebts.reduce((sum, d) => sum + (d.total - (d.paid_amount || 0)), 0);
              if (totalAmount >= totalPendingDebt) {
                const pendingApps = maintenanceAppointments.filter(a => a.subscription_id === car.id && a.status === 'pending');
                for (const app of pendingApps) {
                  const appOrders = orders.filter(o => 
                    o.car_id === car.id && 
                    (!o.is_deleted) &&
                    (((o.notes || '').includes(`[زيارة:${app.id}]`)) || 
                     o.items?.some(i => i.id?.startsWith(`maint-${app.id}`)))
                  );
                  const appExpenses = expenses.filter(e => 
                    e.car_id === car.id && 
                    (e.note || '').includes(`[زيارة:${app.id}]`)
                  );

                  const cost = appOrders.reduce((sum, o) => sum + (o.total || o.paid_amount || 0), 0);
                  const itemNames = appOrders.flatMap(o => {
                    if (!o.items || o.items.length === 0) {
                      return [(o.notes || '').replace(/\[زيارة:[^\]]+\]/g, '').trim()];
                    }
                    return o.items.map(i => i.name);
                  });
                  const expenseNotes = appExpenses.map(e => (e.note || '').replace(/\[زيارة:[^\]]+\]/g, '').trim());
                  const uniqueDetails = Array.from(new Set([...itemNames, ...expenseNotes])).filter(Boolean).join(' + ');
                  const report = uniqueDetails || 'تم إنهاء الزيارة تلقائياً بعد التحصيل الشامل';

                  await completeAppointmentWithRegisteredTransactions(app.id, cost, report);
                }
              }

              const qrData = encodeURIComponent(JSON.stringify({ inv: 'COLL_ALL', total: totalAmount, date: new Date().toISOString() }));
              
              const pw = window.open('', '_blank');
              if (pw) {
                pw.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إيصال سداد - ${escapeHtml(car.car_number)}</title><style>@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');body{font-family:'Cairo',sans-serif;padding:30px;text-align:center;color:#1e293b}h1{color:#10b981;margin-bottom:10px}p{font-size:18px;margin:5px 0}.qr{margin-top:30px}</style></head><body><h1>إيصال سداد مجمع</h1><p>العميل: ${escapeHtml(car.customer_name)}</p><p>رقم السيارة: ${escapeHtml(car.car_number)}</p><p>المبلغ المسدد: ${totalAmount} ج.م</p><img class="qr" src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${qrData}" /><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500)}</script></body></html>`);
                pw.document.close();
              }
            }} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">كاش</label>
                  <input type="number" min="0" step="0.01" value={collectAllForm.cash} onChange={e => setCollectAllForm({...collectAllForm, cash: Number(e.target.value)})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">فيزا</label>
                  <input type="number" min="0" step="0.01" value={collectAllForm.visa} onChange={e => setCollectAllForm({...collectAllForm, visa: Number(e.target.value)})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">محفظة</label>
                  <input type="number" min="0" step="0.01" value={collectAllForm.wallet} onChange={e => setCollectAllForm({...collectAllForm, wallet: Number(e.target.value)})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">انستا باي</label>
                  <input type="number" min="0" step="0.01" value={collectAllForm.instapay} onChange={e => setCollectAllForm({...collectAllForm, instapay: Number(e.target.value)})} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-slate-50" />
                </div>
              </div>
              <div className="bg-emerald-50 p-4 rounded-xl flex justify-between items-center text-emerald-800 font-bold">
                <span>الإجمالي المُدخل:</span>
                <span className="text-xl">{(Number(collectAllForm.cash) + Number(collectAllForm.visa) + Number(collectAllForm.wallet) + Number(collectAllForm.instapay)).toFixed(2)} ج.م</span>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="submit" className="flex-1 bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700 transition">سداد الديون وإصدار إيصال</button>
                <button type="button" onClick={() => setShowCollectAllModal(false)} className="flex-1 bg-slate-100 text-slate-700 font-bold py-3 rounded-xl hover:bg-slate-200 transition">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
