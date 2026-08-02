import type { OrderItem } from '../store/useStore';

/**
 * ── فواتير الانتظار (سلال موقوفة مؤقتاً) ─────────────────────────────────
 *
 * ليه منفصلة عن «الفواتير المعلّقة (الحجز)»؟
 *   الحجز = وعد للعميل: بيخصم الكمية من المخزون، بياخد عربون بيدخل الخزنة،
 *   وبيتسجّل في الداتابيز عشان يظهر للإدارة. ده مناسب لعميل هيرجع بكرة.
 *
 *   الانتظار = وقفة لحظية: العميل واقف على الكاشير وراح يجيب حاجة تانية،
 *   والطابور مستنّي. فالمطلوب أسرع حاجة ممكنة: احفظ السلة، فضّي الشاشة،
 *   احسب اللي بعده، ورجّعها. مفيش مخزون بيتحجز (البضاعة لسه في إيد العميل
 *   مش مضمونة)، مفيش فلوس بتتحصّل، ومفيش أثر محاسبي خالص.
 *
 * التخزين محلي (localStorage) عن قصد:
 *   - فوري، من غير انتظار الشبكة — وده كل الفكرة.
 *   - بيشتغل والنت فاصل (زي باقي وضع الأوفلاين في الكاشير).
 *   - السلة الموقوفة تخصّ الجهاز اللي العميل واقف عليه، مالهاش معنى على جهاز تاني.
 *
 * أي سلة أقدم من PRUNE_AFTER_MS بتتشال تلقائياً — دي وقفة دقايق، ولو فضلت
 * يومين يبقى العميل مرجعش والسلة بقت زبالة على الشاشة.
 */

const STORAGE_KEY = 'adria_parked_carts_v1';
const MAX_PARKED = 20;
const PRUNE_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // يومين

export interface ParkedCart {
  id: string;
  /** علامة يعرف بيها الكاشير السلة دي بتاعة مين (اسم العميل أو أي وصف). */
  label: string;
  /** وقت الإيقاف — ISO. */
  at: string;
  /** الكاشير اللي أوقفها (للعرض لما يتبدّل الوردية على نفس الجهاز). */
  cashier: string;
  cart: OrderItem[];
  total: number;
  customerName: string;
  customerPhone: string;
  customerId: string;
  deferredNote: string;
  discountStr: string;
  invoiceType: 'retail' | 'half' | 'wholesale';
  salesperson: { id: string; name: string } | null;
}

/** كل السلال الموقوفة — الأحدث الأول، والقديمة المنتهية متشالة. */
export function loadParkedCarts(): ParkedCart[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    const alive = parsed.filter(
      (p: any) => p && Array.isArray(p.cart) && new Date(p.at).getTime() > cutoff,
    ) as ParkedCart[];
    if (alive.length !== parsed.length) writeAll(alive);
    return alive.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  } catch {
    return [];
  }
}

function writeAll(list: ParkedCart[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_PARKED)));
    return true;
  } catch {
    // مساحة التخزين اتملت (سلال كبيرة أو كاش أوفلاين ضخم).
    return false;
  }
}

/** بيضيف سلة للانتظار ويرجّع القائمة بعد الإضافة، أو null لو التخزين فشل. */
export function addParkedCart(entry: Omit<ParkedCart, 'id' | 'at'>): ParkedCart[] | null {
  const list = loadParkedCarts();
  const row: ParkedCart = {
    ...entry,
    id: `pk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
  };
  const next = [row, ...list].slice(0, MAX_PARKED);
  return writeAll(next) ? next : null;
}

export function removeParkedCart(id: string): ParkedCart[] {
  const next = loadParkedCarts().filter((p) => p.id !== id);
  writeAll(next);
  return next;
}

export function clearParkedCarts(): ParkedCart[] {
  writeAll([]);
  return [];
}

/** «من ٣ د» / «من ساعة و١٠ د» — الكاشير محتاج يعرف السلة واقفة من إمتى. */
export function parkedAgeLabel(at: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 60000));
  if (mins < 1) return 'الآن';
  if (mins < 60) return `من ${mins} د`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `من ${h} س و${m} د` : `من ${h} س`;
  return `من ${Math.floor(h / 24)} يوم`;
}
