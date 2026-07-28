/**
 * كاش أوفلاين للكاشير — يخلّي السيستم يفتح ويبيع والنت مقطوع من أول اليوم.
 *
 * ليه IndexedDB مش localStorage: قايمة المنتجات لوحدها ممكن تعدّي عدة ميجا،
 * و localStorage محدود بـ ~5MB وبيقفل الـ main thread وهو بيكتب.
 *
 * اللي بيتحفظ: الإعدادات + التصنيفات + المنتجات + العملاء + الكاشيرية + عدّاد
 * الفواتير. مش بيتحفظ: الفواتير القديمة والحسابات — الكاشير مش محتاجها أوفلاين،
 * وحفظها بيكبّر النسخة من غير فايدة.
 */

const DB_NAME = 'adria-offline';
const DB_VERSION = 1;
const STORE = 'snapshot';
const KEY = 'pos';

export interface OfflineSnapshot {
  savedAt: string;
  settings: any;
  categories: any[];
  products: any[];
  customers: any[];
  cashiers: any[];
  invoiceCounter: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(snapshot: Omit<OfflineSnapshot, 'savedAt'>): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...snapshot, savedAt: new Date().toISOString() }, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('offline snapshot save failed:', e);
  }
}

export async function loadSnapshot(): Promise<OfflineSnapshot | null> {
  try {
    const db = await openDb();
    const value = await new Promise<OfflineSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as OfflineSnapshot) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return value;
  } catch (e) {
    console.warn('offline snapshot load failed:', e);
    return null;
  }
}

// ── كلمة سر الدخول الأوفلاين ────────────────────────────────────────────────
// مش بنخزّن كلمة السر نفسها. أول دخول ناجح وإنترنت شغّال بنخزّن PBKDF2 بـ 150 ألف
// دورة (نفس اللي المتصفح بيعمله للباسوردات) — لو حد سحب الـ localStorage
// مش هيقدر يرجّع الكلمة، والتحقق الأوفلاين بيتم بمقارنة نفس الاشتقاق.
const PBKDF2_ITERATIONS = 150_000;
const STORAGE_PREFIX = 'adria_offline_pw_';

export async function hashPassword(cashierId: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(`adria::${cashierId}`), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function rememberOfflinePassword(cashierId: string, password: string): Promise<void> {
  try {
    localStorage.setItem(STORAGE_PREFIX + cashierId, await hashPassword(cashierId, password));
  } catch (e) {
    console.warn('offline password store failed:', e);
  }
}

export function hasOfflinePassword(cashierId: string): boolean {
  try { return !!localStorage.getItem(STORAGE_PREFIX + cashierId); } catch { return false; }
}

export async function verifyOfflinePassword(cashierId: string, password: string): Promise<boolean> {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + cashierId);
    if (!stored) return false;
    const candidate = await hashPassword(cashierId, password);
    // مقارنة ثابتة الوقت — مش حرجة هنا بس مجانية.
    if (candidate.length !== stored.length) return false;
    let diff = 0;
    for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ stored.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}
