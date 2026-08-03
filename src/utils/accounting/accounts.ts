/**
 * ── شجرة الحسابات (Chart of Accounts) ────────────────────────────────────────
 *
 * ليه الموديول ده موجود:
 *   النظام بيسجّل كل حركة مالية في **جدول مستقل** حسب نوعها (فواتير، مصروفات،
 *   مشتريات، حركات موظفين، دفتر الخزنة الرئيسية)، وكل شاشة بتعيد حساب الأرصدة
 *   بفلاترها الخاصة. النتيجة: لو حركة اتمسحت من ناحية وفضلت من الناحية التانية،
 *   مفيش أي حاجة بتصرخ — الفرق بيفضل مستخبّي لشهور (زي الـ 10 جنيه اللي فضلت
 *   من ٧ يوليو، والـ 500 اللي اتعدّت مرتين).
 *
 *   القيد المزدوج بيحل ده هيكلياً: كل حركة = طرفين متساويين. لو الطرفين مش
 *   متساويين، أو طرف اتمسح من غير التاني، **الميزان بيختل فوراً** ويبان.
 *
 * الطريقة هنا **اشتقاقية (derived)**: مابنغيّرش أي مسار كتابة قايم — بنقرا نفس
 * الجداول ونحوّلها لقيود. يعني:
 *   • مفيش خطر على البيانات الحقيقية ولا هجرة كبيرة.
 *   • أي خلل موجود دلوقتي بيظهر كفرق في الميزان بدل ما يفضل مخفي.
 *   • لما نيجي نحوّل الكتابة نفسها لقيد مزدوج، الشجرة دي بتبقى المرجع.
 *
 * الإشارة: debit موجب = زيادة أصول/مصروفات. credit موجب = زيادة خصوم/إيرادات/ملكية.
 * والمعادلة اللي لازم تتحقق دايماً:  الأصول = الخصوم + حقوق الملكية
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface AccountDef {
  /** كود هرمي: 1 أصول، 2 خصوم، 3 ملكية، 4 إيرادات، 5 مصروفات. */
  code: string;
  name: string;
  type: AccountType;
  /** كود الحساب الأب — فاضي للحسابات الرئيسية. */
  parent?: string;
  /** شرح بيظهر في الواجهة: الرصيد ده جاي منين في الداتا. */
  source?: string;
}

/**
 * الحسابات الثابتة. حسابات الخزنة بتتولّد لكل وسيلة دفع مفعّلة (شوف
 * `expandAccounts`) عشان الشجرة تفضل مطابقة لإعدادات المحل.
 */
export const BASE_ACCOUNTS: AccountDef[] = [
  // ── 1 الأصول ──────────────────────────────────────────────────────────────
  { code: '1', name: 'الأصول', type: 'asset' },
  { code: '11', name: 'النقدية وما في حكمها', type: 'asset', parent: '1' },
  { code: '111', name: 'خزنة المحل (الدرج)', type: 'asset', parent: '11',
    source: 'الفواتير + المصروفات + المشتريات + الرواتب (غير الموسومة [MAIN_TREASURY])' },
  { code: '112', name: 'الخزنة الرئيسية', type: 'asset', parent: '11',
    source: 'savings_transactions + الأرصدة الافتتاحية للرئيسية' },
  { code: '12', name: 'المخزون', type: 'asset', parent: '1',
    source: 'products: الكمية × متوسط سعر الشراء' },
  { code: '13', name: 'ذمم مدينة (لينا عند الغير)', type: 'asset', parent: '1' },
  { code: '131', name: 'ذمم العملاء (الآجل)', type: 'asset', parent: '13',
    source: 'الفواتير: المستحق − المدفوع' },
  // للعرض بس — مستبعد من إجمالي الأصول لأنه محسوب ضمن مصروف الرواتب (52).
  // مفيش تسجيل مستقل لسداد السلفة (بتتخصم من صافي الراتب)، فلو اتحسبت أصل
  // مش هيبقى فيه حاجة تصفّيها وهتتراكم للأبد — وكمان هتتعدّ مرتين مع المصروف.
  { code: '132', name: 'سلف الموظفين (للعلم — ضمن الرواتب)', type: 'asset', parent: '13',
    source: 'employee_transactions نوع advance — مستبعد من إجمالي الأصول' },
  { code: '133', name: 'أرصدة لدى الموردين', type: 'asset', parent: '13',
    source: 'purchase_invoices: المدفوع الزائد عن قيمة الفواتير' },

  // ── 2 الخصوم ──────────────────────────────────────────────────────────────
  { code: '2', name: 'الخصوم', type: 'liability' },
  { code: '21', name: 'ذمم الموردين', type: 'liability', parent: '2',
    source: 'purchase_invoices: الإجمالي − المدفوع' },
  { code: '22', name: 'عرابين الحجوزات', type: 'liability', parent: '2',
    source: "expenses فئة «حجز» — فلوس عند العميل لسه مش إيراد" },

  // ── 3 حقوق الملكية ────────────────────────────────────────────────────────
  { code: '3', name: 'حقوق الملكية', type: 'equity' },
  { code: '31', name: 'الأرصدة الافتتاحية / رأس المال', type: 'equity', parent: '3',
    source: 'إعدادات المحل: الأرصدة الافتتاحية للخزنتين' },
  { code: '32', name: 'مسحوبات الشركاء والمدراء', type: 'equity', parent: '3',
    source: 'حركات الشركاء والمدراء على الخزنة الرئيسية' },
  { code: '33', name: 'الأرباح المحتجزة (الفترة)', type: 'equity', parent: '3',
    source: 'الإيرادات − المصروفات (بتتحسب، مش متخزّنة)' },
  // بضاعة دخلت المخزون من غير فاتورة شراء = أصل زاد من غير ما فلوس تخرج،
  // فالطرف المقابل حقوق ملكية (رأس مال عيني). من غير الحساب ده الميزان
  // بيختل بقيمة كل الإدخالات دي.
  { code: '34', name: 'مخزون داخل بدون فاتورة (رأس مال عيني)', type: 'equity', parent: '3',
    source: 'stock_intakes: صافي القيمة (الداخل − النقص اليدوي)' },

  // ── 4 الإيرادات ───────────────────────────────────────────────────────────
  { code: '4', name: 'الإيرادات', type: 'revenue' },
  { code: '41', name: 'المبيعات', type: 'revenue', parent: '4', source: 'orders نوع sale' },
  { code: '42', name: 'مرتجعات المبيعات (−)', type: 'revenue', parent: '4',
    source: 'order_items.refunded_amount + قيمة المرتجع' },
  { code: '43', name: 'إيرادات أخرى', type: 'revenue', parent: '4',
    source: 'expenses بمبلغ سالب (إيراد يدوي)' },

  // ── 5 المصروفات ───────────────────────────────────────────────────────────
  { code: '5', name: 'المصروفات', type: 'expense' },
  { code: '51', name: 'تكلفة البضاعة المباعة', type: 'expense', parent: '5',
    source: 'order_items: الكمية المباعة × سعر الشراء' },
  { code: '52', name: 'الرواتب والأجور', type: 'expense', parent: '5',
    source: 'employee_transactions نوع salary/incentive' },
  { code: '53', name: 'مصروفات تشغيلية', type: 'expense', parent: '5',
    source: 'expenses بمبلغ موجب (غير الرواتب والتحويلات)' },
  { code: '54', name: 'خصومات وتسويات', type: 'expense', parent: '5',
    source: 'تسوية الجرد + فروق الاستبدال' },
];

/** حسابات فرعية لكل وسيلة دفع تحت خزنة المحل والرئيسية. */
export function expandAccounts(methodKeys: string[], methodLabel: (k: string) => string): AccountDef[] {
  const perMethod: AccountDef[] = [];
  methodKeys.forEach((k, i) => {
    perMethod.push({ code: `111${i + 1}`, name: methodLabel(k), type: 'asset', parent: '111' });
    perMethod.push({ code: `112${i + 1}`, name: methodLabel(k), type: 'asset', parent: '112' });
  });
  return [...BASE_ACCOUNTS, ...perMethod];
}

/** الرصيد الطبيعي للحساب: الأصول والمصروفات مدينة، الباقي دائن. */
export function isDebitNormal(type: AccountType): boolean {
  return type === 'asset' || type === 'expense';
}

export const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات',
};
