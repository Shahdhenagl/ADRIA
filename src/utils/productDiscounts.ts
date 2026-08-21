import { supabase } from '../lib/supabase';

export type DiscountType = 'fixed' | 'percentage';
export type BarcodeFormat = 'standard' | 'sale' | 'clearance';

export interface ProductDiscount {
  id: string;
  product_id: string;
  discount_type: DiscountType;
  original_price: number;
  discounted_price: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  label_text: string | null;
  barcode_format: BarcodeFormat;
  quantity_limit?: number | null;
  created_at?: string;
  product?: { id: string; name: string; barcode: string | null; sale_price: number };
}

export function isDiscountActive(discount: ProductDiscount, at = new Date()) {
  if (!discount.is_active) return false;
  const time = at.getTime();
  return new Date(discount.starts_at).getTime() <= time &&
    (!discount.ends_at || new Date(discount.ends_at).getTime() > time);
}

export function chooseActiveDiscount(discounts: ProductDiscount[], at = new Date()) {
  return discounts.filter(d => isDiscountActive(d, at)).sort((a, b) =>
    new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()
  )[0] || null;
}

export async function loadActiveProductDiscounts(productIds?: string[]) {
  let query = supabase.from('product_discounts').select('*').eq('is_active', true);
  if (productIds?.length) query = query.in('product_id', productIds);
  const { data, error } = await query;
  if (error) {
    // قبل تنفيذ db/discounts_module.sql، الكاشير يستمر بالعمل بالأسعار الحالية.
    console.warn('Product discounts unavailable:', error.message);
    return [] as ProductDiscount[];
  }
  return (data || []) as ProductDiscount[];
}

export function applyActiveDiscountPrices<T extends { id: string; sale_price: number; discount_price?: number | null }>(products: T[], discounts: ProductDiscount[]) {
  const now = new Date();
  const byProduct = new Map<string, ProductDiscount[]>();
  for (const discount of discounts) {
    const list = byProduct.get(discount.product_id) || [];
    list.push(discount);
    byProduct.set(discount.product_id, list);
  }
  return products.map(product => {
    const active = chooseActiveDiscount(byProduct.get(product.id) || [], now);
    return active
      ? { ...product, discount_price: Number(active.discounted_price), active_discount_id: active.id }
      : { ...product, active_discount_id: null };
  });
}
