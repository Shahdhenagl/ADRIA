import { useEffect, useMemo, useState } from 'react';
import { useStore, type Customer } from '../../store/useStore';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Image,
  MessageCircle,
  MousePointer2,
  Plus,
  RotateCcw,
  Search,
  Send,
  Users,
  XCircle
} from 'lucide-react';

type CampaignRecipient = {
  customerId: string;
  sentAt?: string;
  skippedAt?: string;
};

type WhatsAppCampaign = {
  id: string;
  name: string;
  message: string;
  imageUrl: string;
  customerIds: string[];
  recipients: CampaignRecipient[];
  createdAt: string;
};

const STORAGE_KEY = 'cashier_whatsapp_campaigns';

const readCampaigns = (): WhatsAppCampaign[] => {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as WhatsAppCampaign[];
  } catch {
    return [];
  }
};

const normalizePhone = (phone: string, countryCode: string) => {
  let cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone) return '';
  const code = countryCode || '2';

  if (cleanPhone.startsWith('0')) {
    cleanPhone = code + cleanPhone.substring(1);
  } else if (!cleanPhone.startsWith(code)) {
    cleanPhone = code + cleanPhone;
  }

  return cleanPhone;
};

export default function WhatsAppCampaigns() {
  const { customers, storeSettings } = useStore();
  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [selectionMode, setSelectionMode] = useState<'all' | 'custom'>('all');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [selectedTableCustomerIds, setSelectedTableCustomerIds] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    name: '',
    message: '',
    imageUrl: ''
  });

  useEffect(() => {
    const saved = readCampaigns();
    setCampaigns(saved);
    if (saved[0]) setSelectedCampaignId(saved[0].id);
  }, []);

  const saveCampaigns = (nextCampaigns: WhatsAppCampaign[]) => {
    setCampaigns(nextCampaigns);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextCampaigns));
  };

  const customersWithPhones = useMemo(
    () => customers.filter((customer) => normalizePhone(customer.phone || '', storeSettings.whatsappCountryCode)),
    [customers, storeSettings.whatsappCountryCode]
  );

  const filteredCustomers = useMemo(() => {
    const term = recipientSearch.trim().toLowerCase();
    if (!term) return customersWithPhones;

    return customersWithPhones.filter((customer) =>
      customer.name.toLowerCase().includes(term) ||
      (customer.phone || '').includes(term) ||
      (customer.custom_id || '').toLowerCase().includes(term)
    );
  }, [customersWithPhones, recipientSearch]);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) || null;

  const campaignCustomers = useMemo(() => {
    if (!selectedCampaign) return [];
    const ids = new Set(selectedCampaign.customerIds);
    return customersWithPhones.filter((customer) => ids.has(customer.id));
  }, [customersWithPhones, selectedCampaign]);

  const visibleCampaigns = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return campaigns;
    return campaigns.filter((campaign) => campaign.name.toLowerCase().includes(term));
  }, [campaigns, searchTerm]);

  const currentRecipient = useMemo(() => {
    if (!selectedCampaign) return null;
    return campaignCustomers.find((customer) => {
      const row = selectedCampaign.recipients.find((recipient) => recipient.customerId === customer.id);
      return !row?.sentAt && !row?.skippedAt;
    }) || null;
  }, [campaignCustomers, selectedCampaign]);

  const selectedStats = useMemo(() => {
    if (!selectedCampaign) return { total: 0, sent: 0, skipped: 0, pending: 0 };
    const sent = selectedCampaign.recipients.filter((recipient) => recipient.sentAt).length;
    const skipped = selectedCampaign.recipients.filter((recipient) => recipient.skippedAt).length;
    const total = selectedCampaign.customerIds.length;
    return { total, sent, skipped, pending: Math.max(0, total - sent - skipped) };
  }, [selectedCampaign]);

  const buildMessage = (campaign: WhatsAppCampaign, customer?: Customer) => {
    const imageBlock = campaign.imageUrl.trim()
      ? `\n\nرابط صورة العرض:\n${campaign.imageUrl.trim()}`
      : '';
    return campaign.message
      .replaceAll('{name}', customer?.name || 'عميلنا العزيز')
      .replaceAll('{store}', storeSettings.name)
      .trim() + imageBlock;
  };

  const getWaLink = (campaign: WhatsAppCampaign, customer: Customer) => {
    const phone = normalizePhone(customer.phone || '', storeSettings.whatsappCountryCode);
    return `https://wa.me/${phone}?text=${encodeURIComponent(buildMessage(campaign, customer))}`;
  };

  const resetForm = () => {
    setFormData({
      name: '',
      message: `مرحباً {name}\n\nلدينا عرض جديد من {store}.\nيسعدنا تواصلكم معنا لمعرفة التفاصيل.`,
      imageUrl: ''
    });
    setSelectionMode('all');
    setSelectedCustomerIds(customersWithPhones.map((customer) => customer.id));
    setRecipientSearch('');
    setSelectedCampaignId(null);
  };

  const createCampaign = () => {
    if (!formData.name.trim()) return alert('اكتب اسم الحملة');
    if (!formData.message.trim()) return alert('اكتب نص الرسالة');

    const customerIds = selectionMode === 'all'
      ? customersWithPhones.map((customer) => customer.id)
      : selectedCustomerIds;

    if (customerIds.length === 0) return alert('اختار عميل واحد على الأقل');

    const campaign: WhatsAppCampaign = {
      id: `camp-${Date.now()}`,
      name: formData.name.trim(),
      message: formData.message.trim(),
      imageUrl: formData.imageUrl.trim(),
      customerIds,
      recipients: customerIds.map((customerId) => ({ customerId })),
      createdAt: new Date().toISOString()
    };

    const nextCampaigns = [campaign, ...campaigns];
    saveCampaigns(nextCampaigns);
    setSelectedCampaignId(campaign.id);
  };

  const updateRecipient = (customerId: string, status: 'sent' | 'skipped' | 'pending') => {
    if (!selectedCampaign) return;
    const nextCampaigns = campaigns.map((campaign) => {
      if (campaign.id !== selectedCampaign.id) return campaign;
      return {
        ...campaign,
        recipients: campaign.recipients.map((recipient) => {
          if (recipient.customerId !== customerId) return recipient;
          if (status === 'sent') return { customerId, sentAt: new Date().toISOString() };
          if (status === 'skipped') return { customerId, skippedAt: new Date().toISOString() };
          return { customerId };
        })
      };
    });
    saveCampaigns(nextCampaigns);
  };

  const openCurrentRecipient = () => {
    if (!selectedCampaign || !currentRecipient) return;
    window.open(getWaLink(selectedCampaign, currentRecipient), '_blank');
  };

  const openMultipleRecipients = (customers: Customer[]) => {
    if (!selectedCampaign) return;
    
    // فتح كل رابط في تبويب جديد بفاصل زمني صغير لتجنب حظر المتصفح
    customers.forEach((customer, index) => {
      setTimeout(() => {
        window.open(getWaLink(selectedCampaign, customer), '_blank');
      }, index * 300); // فاصل 300ms بين كل فتح
    });
  };

  const openRemainingRecipients = () => {
    if (!selectedCampaign) return;
    const pending = campaignCustomers.filter((customer) => {
      const row = selectedCampaign.recipients.find((recipient) => recipient.customerId === customer.id);
      return !row?.sentAt && !row?.skippedAt;
    });
    
    if (pending.length === 0) return alert('لا يوجد عملاء متبقيين للإرسال');
    
    const confirmed = confirm(`سيتم فتح ${pending.length} رابط واتساب. هل تريد المتابعة؟`);
    if (!confirmed) return;
    
    openMultipleRecipients(pending);
  };

  const copyCurrentMessage = async () => {
    if (!selectedCampaign || !currentRecipient) return;
    await navigator.clipboard.writeText(buildMessage(selectedCampaign, currentRecipient));
    alert('تم نسخ الرسالة');
  };

  const deleteCampaign = (campaignId: string) => {
    if (!confirm('هل تريد حذف الحملة من السجل المحلي؟')) return;
    const nextCampaigns = campaigns.filter((campaign) => campaign.id !== campaignId);
    saveCampaigns(nextCampaigns);
    setSelectedCampaignId(nextCampaigns[0]?.id || null);
  };

  const toggleCustomer = (customerId: string) => {
    setSelectedCustomerIds((current) =>
      current.includes(customerId)
        ? current.filter((id) => id !== customerId)
        : [...current, customerId]
    );
  };

  const toggleTableCustomer = (customerId: string) => {
    const newSet = new Set(selectedTableCustomerIds);
    if (newSet.has(customerId)) {
      newSet.delete(customerId);
    } else {
      newSet.add(customerId);
    }
    setSelectedTableCustomerIds(newSet);
  };

  const openSelectedTableCustomers = () => {
    if (selectedTableCustomerIds.size === 0) return alert('اختر عملاء من القائمة أولاً');
    
    const customersToOpen = campaignCustomers.filter(c => selectedTableCustomerIds.has(c.id));
    const confirmed = confirm(`سيتم فتح ${customersToOpen.length} رابط واتساب. هل تريد المتابعة؟`);
    if (!confirmed) return;
    
    openMultipleRecipients(customersToOpen);
    setSelectedTableCustomerIds(new Set());
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto h-[calc(100vh-2rem)] overflow-y-auto" dir="rtl">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8 bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <MessageCircle size={26} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-800">حملات واتساب</h1>
              <p className="text-slate-500 font-medium">إرسال يدوي مجاني لعملاء لديهم أرقام واتساب</p>
            </div>
          </div>
        </div>

        <button
          onClick={resetForm}
          style={{ backgroundColor: storeSettings.themeColor }}
          className="flex items-center gap-2 text-white px-6 py-3 rounded-2xl font-bold hover:opacity-90 transition shadow-lg"
        >
          <Plus size={20} /> حملة جديدة
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
        <div className="space-y-6">
          <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-black text-slate-800 mb-4">إنشاء حملة</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">اسم الحملة</label>
                  <input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 outline-none font-bold focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="مثال: عرض عيد"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">نص الرسالة</label>
                  <textarea
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 h-40 outline-none font-medium resize-none focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="اكتب نص الحملة. يمكنك استخدام {name} لاسم العميل و {store} لاسم المحل."
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">رابط صورة العرض</label>
                  <div className="relative">
                    <Image className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      value={formData.imageUrl}
                      onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl pr-12 pl-4 py-4 outline-none font-medium focus:ring-2 focus:ring-emerald-500/20"
                      placeholder="https://..."
                      dir="ltr"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">اختيار العملاء</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        setSelectionMode('all');
                        setSelectedCustomerIds(customersWithPhones.map((customer) => customer.id));
                      }}
                      className={`py-3 rounded-2xl font-black border transition ${selectionMode === 'all' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                    >
                      كل العملاء
                    </button>
                    <button
                      onClick={() => setSelectionMode('custom')}
                      className={`py-3 rounded-2xl font-black border transition ${selectionMode === 'custom' ? 'bg-slate-800 text-white border-slate-800' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                    >
                      تحديد يدوي
                    </button>
                  </div>
                </div>

                {selectionMode === 'custom' && (
                  <div className="border border-slate-100 rounded-2xl overflow-hidden">
                    <div className="p-3 bg-slate-50 border-b border-slate-100 relative">
                      <Search className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input
                        value={recipientSearch}
                        onChange={(e) => setRecipientSearch(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl pr-10 pl-3 py-2 outline-none text-sm font-bold"
                        placeholder="ابحث عن عميل..."
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
                      {filteredCustomers.map((customer) => (
                        <label key={customer.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedCustomerIds.includes(customer.id)}
                            onChange={() => toggleCustomer(customer.id)}
                            className="w-4 h-4 accent-emerald-600"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-black text-slate-800 truncate">{customer.name}</p>
                            <p className="text-xs text-slate-500 font-mono" dir="ltr">{customer.phone}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={createCampaign}
                  className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-emerald-700 transition"
                >
                  حفظ وتجهيز الحملة
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-black text-slate-800 mb-4">الحملات المحفوظة</h2>
              <div className="relative">
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pr-12 pl-4 py-3 outline-none font-bold"
                  placeholder="بحث في الحملات..."
                />
              </div>
            </div>
            <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
              {visibleCampaigns.map((campaign) => {
                const sent = campaign.recipients.filter((recipient) => recipient.sentAt).length;
                return (
                  <button
                    key={campaign.id}
                    onClick={() => setSelectedCampaignId(campaign.id)}
                    className={`w-full text-right p-4 transition ${selectedCampaignId === campaign.id ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-800">{campaign.name}</p>
                        <p className="text-xs text-slate-500 mt-1">{new Date(campaign.createdAt).toLocaleDateString('ar-SA')}</p>
                      </div>
                      <span className="text-xs font-black text-emerald-600 bg-white px-2 py-1 rounded-lg border border-emerald-100">
                        {sent}/{campaign.customerIds.length}
                      </span>
                    </div>
                  </button>
                );
              })}
              {visibleCampaigns.length === 0 && (
                <div className="p-8 text-center text-slate-400 font-bold">لا توجد حملات محفوظة</div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {selectedCampaign ? (
            <>
              <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 p-6">
                <div className="flex flex-col lg:flex-row justify-between gap-5 mb-6">
                  <div>
                    <h2 className="text-2xl font-black text-slate-800">{selectedCampaign.name}</h2>
                    <p className="text-slate-500 font-medium mt-1">الإرسال يدوي واحد واحد عبر واتساب Web</p>
                  </div>
                  <button
                    onClick={() => deleteCampaign(selectedCampaign.id)}
                    className="self-start px-4 py-2 rounded-xl bg-red-50 text-red-600 font-bold hover:bg-red-100 transition"
                  >
                    حذف الحملة
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-xs font-bold text-slate-400 mb-1">إجمالي العملاء</p>
                    <p className="text-2xl font-black text-slate-800">{selectedStats.total}</p>
                  </div>
                  <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                    <p className="text-xs font-bold text-emerald-500 mb-1">تم الإرسال</p>
                    <p className="text-2xl font-black text-emerald-700">{selectedStats.sent}</p>
                  </div>
                  <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                    <p className="text-xs font-bold text-amber-500 mb-1">متبقي</p>
                    <p className="text-2xl font-black text-amber-700">{selectedStats.pending}</p>
                  </div>
                  <div className="bg-red-50 p-4 rounded-2xl border border-red-100">
                    <p className="text-xs font-bold text-red-500 mb-1">تم التخطي</p>
                    <p className="text-2xl font-black text-red-700">{selectedStats.skipped}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 p-6">
                <h3 className="text-xl font-black text-slate-800 mb-4 flex items-center gap-2">
                  <MousePointer2 size={20} className="text-emerald-600" />
                  العميل الحالي
                </h3>

                {currentRecipient ? (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between gap-4 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                      <div>
                        <p className="text-xl font-black text-slate-800">{currentRecipient.name}</p>
                        <p className="text-slate-500 font-mono" dir="ltr">{currentRecipient.phone}</p>
                      </div>
                      <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <Users size={26} />
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                      <p className="text-xs font-bold text-slate-400 mb-2">معاينة الرسالة</p>
                      <pre className="whitespace-pre-wrap text-sm leading-7 font-sans text-slate-700 break-words overflow-x-hidden max-w-full" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>{buildMessage(selectedCampaign, currentRecipient)}</pre>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <button
                        onClick={openCurrentRecipient}
                        className="flex items-center justify-center gap-2 bg-emerald-600 text-white py-4 rounded-2xl font-black hover:bg-emerald-700 transition shadow-lg"
                      >
                        <Send size={18} /> فتح واتساب
                      </button>
                      <button
                        onClick={() => updateRecipient(currentRecipient.id, 'sent')}
                        className="flex items-center justify-center gap-2 bg-slate-900 text-white py-4 rounded-2xl font-black hover:bg-black transition"
                      >
                        <CheckCircle2 size={18} /> تم الإرسال
                      </button>
                      <button
                        onClick={copyCurrentMessage}
                        className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-4 rounded-2xl font-black hover:bg-slate-200 transition"
                      >
                        <Copy size={18} /> نسخ الرسالة
                      </button>
                    </div>

                    <button
                      onClick={openRemainingRecipients}
                      className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white py-4 rounded-2xl font-black hover:from-orange-600 hover:to-amber-600 transition shadow-lg mt-2"
                    >
                      <Send size={18} /> 📲 فتح {selectedStats.pending} روابط متبقية مرة واحدة
                    </button>
                  </div>
                ) : (
                  <div className="p-10 text-center bg-emerald-50 rounded-3xl border border-emerald-100">
                    <CheckCircle2 size={42} className="mx-auto text-emerald-600 mb-3" />
                    <p className="text-xl font-black text-emerald-700">الحملة مكتملة</p>
                    <p className="text-sm font-bold text-emerald-500 mt-1">كل العملاء تم تعليمهم كمرسل أو متخطى</p>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center gap-4">
                  <h3 className="text-xl font-black text-slate-800">قائمة العملاء في الحملة</h3>
                  <div className="flex items-center gap-3">
                    {selectedTableCustomerIds.size > 0 && (
                      <button
                        onClick={openSelectedTableCustomers}
                        className="flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-xl font-black hover:from-purple-600 hover:to-pink-600 transition shadow-lg text-sm"
                      >
                        <Send size={16} /> فتح {selectedTableCustomerIds.size} روابط
                      </button>
                    )}
                    <span className="text-xs font-bold text-slate-400">{campaignCustomers.length} عميل</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right">
                    <thead>
                      <tr className="bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                        <th className="p-4 w-8">
                          <input 
                            type="checkbox"
                            checked={selectedTableCustomerIds.size === campaignCustomers.length && campaignCustomers.length > 0}
                            onChange={() => {
                              if (selectedTableCustomerIds.size === campaignCustomers.length) {
                                setSelectedTableCustomerIds(new Set());
                              } else {
                                setSelectedTableCustomerIds(new Set(campaignCustomers.map(c => c.id)));
                              }
                            }}
                            className="w-4 h-4 accent-purple-600 cursor-pointer"
                          />
                        </th>
                        <th className="p-4">العميل</th>
                        <th className="p-4">رقم الهاتف</th>
                        <th className="p-4">الحالة</th>
                        <th className="p-4 text-left">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {campaignCustomers.map((customer) => {
                        const row = selectedCampaign.recipients.find((recipient) => recipient.customerId === customer.id);
                        const status = row?.sentAt ? 'sent' : row?.skippedAt ? 'skipped' : 'pending';
                        return (
                          <tr key={customer.id} className="hover:bg-slate-50/60 transition">
                            <td className="p-4 text-center">
                              <input 
                                type="checkbox"
                                checked={selectedTableCustomerIds.has(customer.id)}
                                onChange={() => toggleTableCustomer(customer.id)}
                                className="w-4 h-4 accent-purple-600 cursor-pointer"
                              />
                            </td>
                            <td className="p-4 font-black text-slate-800">{customer.name}</td>
                            <td className="p-4 font-mono text-slate-500" dir="ltr">{customer.phone}</td>
                            <td className="p-4">
                              <span className={`px-3 py-1 rounded-lg text-xs font-black ${
                                status === 'sent'
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : status === 'skipped'
                                    ? 'bg-red-50 text-red-600'
                                    : 'bg-amber-50 text-amber-600'
                              }`}>
                                {status === 'sent' ? 'تم الإرسال' : status === 'skipped' ? 'تم التخطي' : 'في الانتظار'}
                              </span>
                            </td>
                            <td className="p-4">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => window.open(getWaLink(selectedCampaign, customer), '_blank')}
                                  className="p-2 text-slate-400 hover:text-emerald-600 transition"
                                  title="فتح واتساب"
                                >
                                  <ExternalLink size={16} />
                                </button>
                                <button
                                  onClick={() => updateRecipient(customer.id, 'sent')}
                                  className="p-2 text-slate-400 hover:text-emerald-600 transition"
                                  title="تم الإرسال"
                                >
                                  <CheckCircle2 size={16} />
                                </button>
                                <button
                                  onClick={() => updateRecipient(customer.id, 'skipped')}
                                  className="p-2 text-slate-400 hover:text-red-600 transition"
                                  title="تخطي"
                                >
                                  <XCircle size={16} />
                                </button>
                                <button
                                  onClick={() => updateRecipient(customer.id, 'pending')}
                                  className="p-2 text-slate-400 hover:text-slate-700 transition"
                                  title="إعادة للانتظار"
                                >
                                  <RotateCcw size={16} />
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
            </>
          ) : (
            <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 p-12 text-center">
              <MessageCircle size={48} className="mx-auto text-slate-300 mb-4" />
              <p className="text-xl font-black text-slate-700">ابدأ بإنشاء حملة واتساب</p>
              <p className="text-slate-400 font-bold mt-2">سيتم تجهيز روابط الإرسال للعملاء المسجل لهم رقم هاتف</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
