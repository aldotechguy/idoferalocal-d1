import React, { useState } from 'react';
import {
  History,
  ShieldCheck,
  TrendingUp,
  Percent,
  Calendar,
  AlertCircle,
  Check,
} from 'lucide-react';
import { NairaSign } from '../common/NairaSign';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useInteractions } from '../../context/InteractionContext';

export const PricingView: React.FC = () => {
  const { products, changeProductPrice, pricingHistory, settings } = useApp();
  const { currentUser } = useAuth();
  const { notify } = useInteractions();

  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [priceType, setPriceType] = useState<'Retail' | 'Wholesale' | 'Dealer' | 'Promotional'>('Retail');
  const [newPrice, setNewPrice] = useState<number>(0);
  const [reason, setReason] = useState<string>('');
  const [overrideRestrictions, setOverrideRestrictions] = useState<boolean>(false);
  const [showSuccessToast, setShowSuccessToast] = useState<boolean>(false);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const handlePriceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || newPrice <= 0) return;

    if (newPrice < (Number(selectedProduct.minimumSellingPrice) || 0) && !overrideRestrictions) {
      notify(`Cannot set price below ${settings.currencySymbol}${(Number(selectedProduct.minimumSellingPrice) || 0).toFixed(2)} without Administrator override permission.`, 'Minimum price restriction', 'warning');
      return;
    }

    changeProductPrice(
      selectedProductId,
      newPrice,
      priceType,
      reason || 'Routine margin adjustment',
      currentUser?.displayName || 'Administrator'
    );

    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3000);
    setReason('');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Multiple Pricing System
          </h1>
          <p className="text-xs text-slate-500">
            Manage multi-tier pricing, set discount limits, schedule future rates, and audit price movements.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 px-3 py-1.5 rounded-xl text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
          <ShieldCheck className="w-4 h-4" />
          <span>Audit Logging Active</span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Price Update Card */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="font-extrabold text-slate-900 dark:text-white text-base flex items-center gap-2">
              <NairaSign className="w-5 h-5 text-blue-600" />
              Change Tier Price
            </h3>
            {showSuccessToast && (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 animate-bounce">
                <Check className="w-4 h-4" /> Price updated & logged!
              </span>
            )}
          </div>

          <form onSubmit={handlePriceSubmit} className="space-y-4 text-xs">
            {/* Select Product */}
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Select Target Product
              </label>
              <select
                value={selectedProductId}
                onChange={(e) => {
                  setSelectedProductId(e.target.value);
                  const prod = products.find((p) => p.id === e.target.value);
                  if (prod) setNewPrice(prod.retailPrice);
                }}
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-medium"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (SKU: {p.sku})
                  </option>
                ))}
              </select>
            </div>

            {/* Current Tier Overview */}
            {selectedProduct && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                <div>
                  <span className="text-slate-400 text-[10px]">Cost Price</span>
                  <p className="font-bold text-slate-800 dark:text-slate-200">{settings.currencySymbol}{(Number(selectedProduct.costPrice) || 0).toFixed(2)}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px]">Retail Price</span>
                  <p className="font-bold text-emerald-600 dark:text-emerald-400">{settings.currencySymbol}{(Number(selectedProduct.retailPrice) || 0).toFixed(2)}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px]">Wholesale Price</span>
                  <p className="font-bold text-blue-600 dark:text-blue-400">{settings.currencySymbol}{(Number(selectedProduct.wholesalePrice) || 0).toFixed(2)}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px]">Min Sell Price</span>
                  <p className="font-bold text-rose-600 dark:text-rose-400">{settings.currencySymbol}{(Number(selectedProduct.minimumSellingPrice) || 0).toFixed(2)}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Pricing Tier Type
                </label>
                <select
                  value={priceType}
                  onChange={(e) => setPriceType(e.target.value as any)}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-medium"
                >
                  <option value="Retail">Retail Price</option>
                  <option value="Wholesale">Wholesale Price</option>
                  <option value="Dealer">Dealer Price</option>
                  <option value="Promotional">Promotional Price</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  New Price Amount ({settings.currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={newPrice}
                  onChange={(e) => setNewPrice(parseFloat(e.target.value) || 0)}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Reason for Change (Audit Note)
              </label>
              <input
                type="text"
                placeholder="e.g., Seasonal Q3 promo or supplier cost fluctuation"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500"
              />
            </div>

            {/* Admin Override */}
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="override"
                checked={overrideRestrictions}
                onChange={(e) => setOverrideRestrictions(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="override" className="text-slate-600 dark:text-slate-400 font-medium cursor-pointer">
                Administrator Override (Bypass minimum selling price restriction)
              </label>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs transition-colors"
            >
              Apply & Generate Audit Log
            </button>
          </form>
        </div>

        {/* Audit Log / History Sidebar */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center gap-2 font-extrabold text-slate-900 dark:text-white text-base">
            <History className="w-5 h-5 text-indigo-600" />
            <span>Recent Price History</span>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {pricingHistory.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">
                No pricing history recorded yet.
              </p>
            ) : (
              pricingHistory.map((ph) => (
                <div key={ph.id} className="pt-3 text-xs space-y-1">
                  <div className="flex justify-between items-start font-bold text-slate-900 dark:text-white">
                    <span className="truncate max-w-[150px]">{ph.productName}</span>
                    <span className="text-blue-600 font-mono">
                      {settings.currencySymbol}{(Number(ph.oldPrice) || 0).toFixed(2)} → {settings.currencySymbol}{(Number(ph.newPrice) || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Type: {ph.priceType}</span>
                    <span>By: {ph.changedBy}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 italic">"{ph.reason}"</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
