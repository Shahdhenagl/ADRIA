import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { AlertTriangle, PackageX, PackageMinus, Lightbulb, MessageSquare, Check, Trash2, Plus, Eye, EyeOff } from 'lucide-react';

export default function StockAlerts() {
  const { 
    products, 
    updateProduct,
    productSuggestions, 
    addProductSuggestion, 
    markSuggestionAsPurchased, 
    deleteProductSuggestion,
    cashierNotes,
    markCashierNoteAsRead
  } = useStore();

  const [newSuggestionName, setNewSuggestionName] = useState('');
  const [newSuggestionNotes, setNewSuggestionNotes] = useState('');
  const [isAddingSuggestion, setIsAddingSuggestion] = useState(false);

  // Constants
  const LOW_STOCK_THRESHOLD = 5;

  // Derived Data
  const outOfStockProducts = products.filter(p => p.stock_quantity <= 0);
  const lowStockProducts = products.filter(p => p.stock_quantity > 0 && p.stock_quantity <= LOW_STOCK_THRESHOLD);
  const unpurchasedSuggestions = productSuggestions.filter(s => !s.is_purchased);
  const unreadNotes = cashierNotes.filter(n => !n.is_read);

  const handleAddSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSuggestionName.trim()) return;
    setIsAddingSuggestion(true);
    await addProductSuggestion(newSuggestionName.trim(), newSuggestionNotes.trim());
    setNewSuggestionName('');
    setNewSuggestionNotes('');
    setIsAddingSuggestion(false);
  };

  return (
    <div className="p-6 md:p-8 space-y-8 animate-fade-in" dir="rtl">
      <div>
        <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3">
          <AlertTriangle className="text-orange-500" size={32} />
          نواقص ومقترحات
        </h1>
        <p className="text-slate-500 mt-2 font-medium">متابعة المنتجات الناقصة، مقترحات العملاء، وملاحظات الكاشير</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Out of Stock Section */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-red-100 dark:border-red-900/30 overflow-hidden flex flex-col">
          <div className="p-6 bg-red-50 dark:bg-red-900/10 border-b border-red-100 dark:border-red-900/30 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/50 flex items-center justify-center text-red-600 dark:text-red-400">
              <PackageX size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-red-700 dark:text-red-400">المنتجات التي نفدت</h2>
              <p className="text-sm text-red-600/70 mt-1">الرصيد 0 - تختفي تلقائياً عند إضافة مشتريات</p>
            </div>
          </div>
          <div className="p-6 flex-1 max-h-[400px] overflow-y-auto">
            {outOfStockProducts.length > 0 ? (
              <ul className="space-y-3">
                {outOfStockProducts.map(product => (
                  <li key={product.id} className={`flex justify-between items-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700 transition-opacity ${product.is_hidden ? 'opacity-50 grayscale' : ''}`}>
                    <div className="flex-1">
                      <p className="font-bold text-slate-800 dark:text-white">{product.name}</p>
                      <p className="text-xs text-slate-500 mt-1">الباركود: {product.barcode}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => updateProduct(product.id, { is_hidden: !product.is_hidden })}
                        className={`p-2 rounded-full transition-colors ${product.is_hidden ? 'bg-slate-200 text-slate-500' : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'}`}
                        title={product.is_hidden ? 'إظهار في الكاشير' : 'إخفاء من الكاشير'}
                      >
                        {product.is_hidden ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                      <span className="px-3 py-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-full text-sm font-bold">
                        نفد
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                <Check size={48} className="text-emerald-400 mb-4 opacity-50" />
                <p className="font-bold">لا توجد منتجات نافذة حالياً</p>
              </div>
            )}
          </div>
        </div>

        {/* Low Stock Section */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-orange-100 dark:border-orange-900/30 overflow-hidden flex flex-col">
          <div className="p-6 bg-orange-50 dark:bg-orange-900/10 border-b border-orange-100 dark:border-orange-900/30 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center text-orange-600 dark:text-orange-400">
              <PackageMinus size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-orange-700 dark:text-orange-400">أوشكت على النفاد</h2>
              <p className="text-sm text-orange-600/70 mt-1">الرصيد أقل من أو يساوي {LOW_STOCK_THRESHOLD}</p>
            </div>
          </div>
          <div className="p-6 flex-1 max-h-[400px] overflow-y-auto">
            {lowStockProducts.length > 0 ? (
              <ul className="space-y-3">
                {lowStockProducts.map(product => (
                  <li key={product.id} className={`flex justify-between items-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700 transition-opacity ${product.is_hidden ? 'opacity-50 grayscale' : ''}`}>
                    <div className="flex-1">
                      <p className="font-bold text-slate-800 dark:text-white">{product.name}</p>
                      <p className="text-xs text-slate-500 mt-1">الباركود: {product.barcode}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => updateProduct(product.id, { is_hidden: !product.is_hidden })}
                        className={`p-2 rounded-full transition-colors ${product.is_hidden ? 'bg-slate-200 text-slate-500' : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'}`}
                        title={product.is_hidden ? 'إظهار في الكاشير' : 'إخفاء من الكاشير'}
                      >
                        {product.is_hidden ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                      <span className="px-3 py-1 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded-full text-sm font-bold flex items-center gap-1">
                        متبقي: {product.stock_quantity}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                <Check size={48} className="text-emerald-400 mb-4 opacity-50" />
                <p className="font-bold">المخزون بوضع جيد ولا توجد نواقص</p>
              </div>
            )}
          </div>
        </div>

        {/* Customer Suggestions Section */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-indigo-100 dark:border-indigo-900/30 overflow-hidden flex flex-col lg:col-span-2">
          <div className="p-6 bg-indigo-50 dark:bg-indigo-900/10 border-b border-indigo-100 dark:border-indigo-900/30 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Lightbulb size={20} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-indigo-700 dark:text-indigo-400">المنتجات المقترحة</h2>
                <p className="text-sm text-indigo-600/70 mt-1">طلبات العملاء لمنتجات غير متوفرة بالمتجر</p>
              </div>
            </div>
          </div>
          <div className="p-6 flex flex-col md:flex-row gap-8">
            {/* Add Suggestion Form */}
            <div className="w-full md:w-1/3">
              <form onSubmit={handleAddSuggestion} className="space-y-4 p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                <h3 className="font-bold text-slate-700 dark:text-slate-300 mb-4">إضافة منتج مقترح</h3>
                
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">اسم المنتج</label>
                  <input
                    type="text"
                    value={newSuggestionName}
                    onChange={(e) => setNewSuggestionName(e.target.value)}
                    required
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="مثال: مشروب كذا..."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">ملاحظات (اختياري)</label>
                  <textarea
                    value={newSuggestionNotes}
                    onChange={(e) => setNewSuggestionNotes(e.target.value)}
                    rows={2}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    placeholder="سبب الطلب، العميل الخ..."
                  />
                </div>

                <button
                  type="submit"
                  disabled={isAddingSuggestion || !newSuggestionName.trim()}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Plus size={18} />
                  إضافة للقائمة
                </button>
              </form>
            </div>

            {/* Suggestions List */}
            <div className="w-full md:w-2/3 max-h-[400px] overflow-y-auto">
              {unpurchasedSuggestions.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {unpurchasedSuggestions.map(suggestion => (
                    <div key={suggestion.id} className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-indigo-100 dark:border-indigo-900/30 shadow-sm relative group transition-all hover:border-indigo-300">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-bold text-slate-800 dark:text-white">{suggestion.name}</h4>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => markSuggestionAsPurchased(suggestion.id)}
                            title="تم الشراء"
                            className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg transition"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={() => deleteProductSuggestion(suggestion.id)}
                            title="حذف"
                            className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      {suggestion.notes && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
                          {suggestion.notes}
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-3 flex justify-end">
                        {new Date(suggestion.created_at).toLocaleDateString('ar-EG', { calendar: 'gregory' })}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-3xl">
                  <Lightbulb size={48} className="mb-4 opacity-30" />
                  <p className="font-bold">لا توجد مقترحات مسجلة حالياً</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Cashier Notes Section */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-blue-100 dark:border-blue-900/30 overflow-hidden flex flex-col lg:col-span-2">
          <div className="p-6 bg-blue-50 dark:bg-blue-900/10 border-b border-blue-100 dark:border-blue-900/30 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <MessageSquare size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-blue-700 dark:text-blue-400">رسائل الكاشير</h2>
              <p className="text-sm text-blue-600/70 mt-1">الرسائل والملاحظات المرسلة من نقطة البيع</p>
            </div>
          </div>
          <div className="p-6 max-h-[400px] overflow-y-auto">
            {unreadNotes.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {unreadNotes.map(note => (
                  <div key={note.id} className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-blue-100 dark:border-blue-900/30 shadow-sm relative group">
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                          <span className="font-bold text-sm">{note.cashier_name.charAt(0)}</span>
                        </div>
                        <span className="font-bold text-slate-700 dark:text-slate-300 text-sm">{note.cashier_name}</span>
                      </div>
                      <button
                        onClick={() => markCashierNoteAsRead(note.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-bold flex items-center gap-1"
                      >
                        <Check size={14} /> مقروء
                      </button>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                      {note.note}
                    </p>
                    <div className="mt-3 text-left">
                      <span className="text-xs text-slate-400 font-medium">
                        {new Date(note.created_at).toLocaleString('ar-EG', { calendar: 'gregory', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-400 p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-3xl">
                <MessageSquare size={48} className="mb-4 opacity-30" />
                <p className="font-bold">لا توجد رسائل جديدة من الكاشير</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
