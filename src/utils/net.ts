/**
 * مهلات الشبكة — عشان النت الضعيف مايعطّلش الشاشة.
 *
 * المشكلة اللي بتحصل في المحل: الراوتر شغّال بس النت نفسه فاصل أو بطيء جداً،
 * فـ navigator.onLine بيقول «متصل» والطلب بيفضل معلّق لحد ما المتصفح يقرر
 * يفشّله (ممكن يوصل نص دقيقة). طول الوقت ده الكاشير قاعد مستني.
 *
 * الحل: كل طلب حرج بيتلف في مهلة قصيرة، ولو عدّاها بنكمّل من النسخة المحفوظة.
 */

export class TimeoutError extends Error {
  constructor(label = '') {
    super(`انتهت مهلة الاتصال${label ? `: ${label}` : ''}`);
    this.name = 'TimeoutError';
  }
}

/** يرجّع نتيجة الوعد أو يرمي TimeoutError بعد ms. الطلب الأصلي بيكمل في الخلفية. */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label = ''): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** خطأ شبكة (مش خطأ منطقي زي كلمة سر غلط)؟ */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  const msg = typeof err === 'string' ? err : ((err as any)?.message || '');
  return /fetch|network|timeout|offline|abort|connection|تعذّر الاتصال|انتهت مهلة/i.test(msg);
}

// مهلات مضبوطة على تجربة الكاشير: الدخول وشاشة الدخول لازم يبقوا سريعين،
// والتحميل الكامل بياخد وقت أطول شوية لأنه بيجيب كل المنتجات والفواتير.
export const NET_TIMEOUT = {
  login: 6000,
  loginScreen: 5000,
  fullLoad: 12000,
  quickCheck: 4000,
} as const;
