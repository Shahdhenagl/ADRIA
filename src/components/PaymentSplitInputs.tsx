import { useStore } from '../store/useStore';
import { activePaymentKeys, payLabelOf } from '../utils/paymentMethods';

interface Props {
  /** Current amounts keyed by method name (cash/visa/wallet/instapay/method5/method6). */
  value: Record<string, any>;
  /** Called with (methodKey, newValue) on each input change. */
  onChange: (key: string, val: string) => void;
  /** Tailwind columns class suffix (2 by default). */
  cols?: 2 | 3;
  inputClassName?: string;
  labelClassName?: string;
}

/**
 * Renders an amount input per ACTIVE payment method (4 base + any enabled
 * extras), using the custom labels from settings. Keeps every money-entry
 * screen consistent at exactly the methods the store has turned on.
 */
export default function PaymentSplitInputs({ value, onChange, cols = 2, inputClassName, labelClassName }: Props) {
  const { storeSettings } = useStore();
  const keys = activePaymentKeys(storeSettings as any);
  return (
    <div className={`grid ${cols === 3 ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'} gap-3`}>
      {keys.map((k) => (
        <div key={k}>
          <label className={labelClassName || 'block text-[11px] font-bold text-slate-500 mb-1'}>{payLabelOf(storeSettings as any, k)}</label>
          <input
            type="number"
            dir="ltr"
            placeholder="0.00"
            value={value[k] ?? ''}
            onChange={(e) => onChange(k, e.target.value)}
            className={inputClassName || 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-right focus:outline-none focus:ring-2 focus:ring-indigo-500'}
          />
        </div>
      ))}
    </div>
  );
}
