import React, { useState, useMemo } from 'react';
import {
  X,
  ArrowLeftRight,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  Check,
  Package,
  Layers,
  Percent,
  Zap,
  Clock,
  ChevronRight,
  Plus,
  Minus,
} from 'lucide-react';
import { Product } from '../../types';
import {
  ActiveCampaignProduct,
  ActiveInvestmentCampaign,
  ProductLiveTracking,
  SkuReplacementCandidate,
} from '../../types/investment';

interface CampaignRebalanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaign: ActiveInvestmentCampaign;
  flaggedProduct: ActiveCampaignProduct;
  tracking: ProductLiveTracking;
  recommendedCandidates: SkuReplacementCandidate[];
  allProducts: Product[];
  onConfirmSubstitution: (
    incomingProduct: Product,
    newUnits: number,
    reason: 'slow_velocity' | 'tenure_overrun' | 'manual_optimization'
  ) => void;
  currencySymbol?: string;
}

export const CampaignRebalanceModal: React.FC<CampaignRebalanceModalProps> = ({
  isOpen,
  onClose,
  campaign,
  flaggedProduct,
  tracking,
  recommendedCandidates,
  allProducts,
  onConfirmSubstitution,
  currencySymbol = '₦',
}) => {
  const cs = currencySymbol;
  const trappedCapital = tracking.remainingUnits * flaggedProduct.costPrice;

  // Selected replacement SKU
  const [selectedProductId, setSelectedProductId] = useState<string | null>(() => {
    return recommendedCandidates.length > 0 ? recommendedCandidates[0].productId : null;
  });

  const [customUnits, setCustomUnits] = useState<number | null>(null);

  // Find candidate details
  const selectedCandidate = useMemo(() => {
    if (!selectedProductId) return recommendedCandidates[0] || null;
    return recommendedCandidates.find((c) => c.productId === selectedProductId) || null;
  }, [selectedProductId, recommendedCandidates]);

  // Full product object from allProducts
  const selectedProductObj = useMemo(() => {
    if (!selectedCandidate) return null;
    return allProducts.find((p) => p.id === selectedCandidate.productId) || null;
  }, [selectedCandidate, allProducts]);

  // Active units for the new SKU
  const activeUnits = customUnits !== null ? customUnits : (selectedCandidate?.recommendedUnits || 1);
  const totalCost = activeUnits * (selectedCandidate?.costPrice || 0);
  const totalRevenue = activeUnits * (selectedCandidate?.retailPrice || 0);
  const totalProfit = totalRevenue - totalCost;
  const budgetDelta = trappedCapital - totalCost;

  if (!isOpen) return null;

  const handleSelectCandidate = (candidate: SkuReplacementCandidate) => {
    setSelectedProductId(candidate.productId);
    setCustomUnits(candidate.recommendedUnits);
  };

  const handleConfirm = () => {
    if (!selectedProductObj || activeUnits <= 0) return;
    const reason = tracking.isTenureOverrun ? 'tenure_overrun' : 'slow_velocity';
    onConfirmSubstitution(selectedProductObj, activeUnits, reason);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-3xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-2xl">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                Mid-Flight SKU Rebalance
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  Protect ROI
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Substitute stagnant inventory with high-turnover stock to recover capital and maintain target yield.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Outgoing Product Drag Diagnosis */}
          <div className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 rounded-2xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    Flagged Underperforming SKU
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    ({flaggedProduct.sku})
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white mt-0.5">
                  {flaggedProduct.productName}
                </h3>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                  {tracking.underperformanceReason || 'Capital drag detected due to sluggish sales velocity.'}
                </p>
              </div>

              <div className="flex items-center gap-3 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/50 shrink-0">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">Sold vs Target</div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-200">
                    {tracking.unitsSold} / {flaggedProduct.currentTargetQty} units ({tracking.sellThroughPct}%)
                  </div>
                </div>
                <div className="h-7 w-[1px] bg-slate-200 dark:bg-slate-700" />
                <div>
                  <div className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">Trapped Capital</div>
                  <div className="text-xs font-black text-amber-700 dark:text-amber-300">
                    {cs}{trappedCapital.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Replacement Candidate Selection */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                AI Recommended High-Velocity Replacements
              </label>
              <span className="text-[11px] text-slate-400 font-medium">
                Ranked by Composite Score & Velocity Multiplier
              </span>
            </div>

            {recommendedCandidates.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                No replacement candidates available in catalog meeting criteria.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recommendedCandidates.map((c) => {
                  const isSelected = selectedCandidate?.productId === c.productId;
                  return (
                    <div
                      key={c.productId}
                      onClick={() => handleSelectCandidate(c)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30 ring-2 ring-emerald-500/20'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />
                            {c.velocityMultiplier}x Velocity
                          </span>
                          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                            +{cs}{c.profitBoostDelta.toLocaleString()} Profit
                          </span>
                        </div>
                        <h4 className="text-xs font-black text-slate-900 dark:text-white mt-2 line-clamp-1">
                          {c.productName}
                        </h4>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          SKU: {c.sku} • {c.category}
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs">
                        <div>
                          <span className="text-slate-400 text-[10px]">Unit Cost:</span>{' '}
                          <span className="font-bold text-slate-700 dark:text-slate-300">{cs}{c.costPrice.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px]">Margin:</span>{' '}
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">{c.marginPct}%</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px]">Rec. Units:</span>{' '}
                          <span className="font-black text-slate-900 dark:text-white">{c.recommendedUnits}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Interactive Unit Configuration & Financial Impact */}
          {selectedCandidate && (
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Fine-Tune Replacement Allocation
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Adjust target units to deploy freed capital ({cs}{trappedCapital.toLocaleString()}) into {selectedCandidate.productName}.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCustomUnits(Math.max(1, activeUnits - 5))}
                    className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={activeUnits}
                    onChange={(e) => setCustomUnits(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 text-center font-black text-sm px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl"
                  />
                  <button
                    onClick={() => setCustomUnits(activeUnits + 5)}
                    className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 4 Financial Impact Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Capital Deployed</div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-200 mt-0.5">
                    {cs}{totalCost.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Projected Revenue</div>
                  <div className="text-xs font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {cs}{totalRevenue.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Projected Profit</div>
                  <div className="text-xs font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {cs}{totalProfit.toLocaleString()}
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Est. Runout</div>
                  <div className="text-xs font-black text-blue-600 dark:text-blue-400 mt-0.5">
                    {selectedCandidate.runOutDays} Days
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            disabled={!selectedCandidate || activeUnits <= 0}
            onClick={handleConfirm}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50"
          >
            <Zap className="w-4 h-4" />
            <span>Apply Substitution & Rebalance</span>
          </button>
        </div>
      </div>
    </div>
  );
};
