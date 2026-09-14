import React, { useState, useMemo } from 'react';
import {
  X,
  ArrowLeftRight,
  Plus,
  TrendingUp,
  Percent,
  Zap,
  Search,
  Check,
  Package,
  Layers,
  Info,
  Clock,
  ChevronRight,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { Product } from '../../types';
import { AllocatedProduct } from '../../types/investment';

interface SwapProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetProduct: AllocatedProduct | null; // null if adding a brand new product
  allProducts: Product[];
  currentAllocatedProducts: AllocatedProduct[];
  salesVelocityMap: Record<string, { unitsSold: number; dailyVelocity: number; revenue: number }>;
  tenureMonths: number;
  availableBudgetForSwap: number;
  onConfirmSwap: (oldProductId: string | null, newProductId: string, newUnits: number) => void;
  currencySymbol?: string;
}

type TabType = 'higher_margin' | 'faster_velocity' | 'higher_cash' | 'all';

export const SwapProductModal: React.FC<SwapProductModalProps> = ({
  isOpen,
  onClose,
  targetProduct,
  allProducts,
  currentAllocatedProducts,
  salesVelocityMap,
  tenureMonths,
  availableBudgetForSwap,
  onConfirmSwap,
  currencySymbol = '₦',
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('higher_margin');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [customUnitsInput, setCustomUnitsInput] = useState<number | null>(null);

  if (!isOpen) return null;

  const cs = currencySymbol;
  const tenureDays = tenureMonths * 30;

  // Capital being re-deployed
  const swapBudget =
    targetProduct?.allocatedCapital && targetProduct.allocatedCapital > 0
      ? targetProduct.allocatedCapital
      : availableBudgetForSwap > 0
      ? availableBudgetForSwap
      : 500000;

  // Active products in catalog excluding already allocated products (except targetProduct itself)
  const candidateProducts = useMemo(() => {
    const allocatedIdSet = new Set(
      currentAllocatedProducts
        .map((p) => p.productId)
        .filter((id) => id !== targetProduct?.productId)
    );

    return allProducts
      .filter((p) => p.status !== 'Archived' && p.costPrice > 0 && p.retailPrice > p.costPrice)
      .filter((p) => !allocatedIdSet.has(p.id))
      .map((p) => {
        const stats = salesVelocityMap[p.id] || { unitsSold: 0, dailyVelocity: 0, revenue: 0 };
        const marginPerUnit = p.retailPrice - p.costPrice;
        const marginPct = (marginPerUnit / p.retailPrice) * 100;
        const velocity = stats.dailyVelocity > 0 ? stats.dailyVelocity : 0.15;

        // Demand ceiling
        const maxDemand = Math.max(5, Math.ceil(velocity * tenureDays * 1.2));

        // How many units the swapBudget can buy
        const affordableUnits = Math.max(1, Math.floor(swapBudget / p.costPrice));
        const recommendedUnits = Math.min(affordableUnits, maxDemand);

        const projectedBatchCost = recommendedUnits * p.costPrice;
        const projectedBatchRevenue = recommendedUnits * p.retailPrice;
        const projectedBatchProfit = projectedBatchRevenue - projectedBatchCost;
        const runOutDays = Math.max(1, Math.round(recommendedUnits / Math.max(0.05, velocity)));

        return {
          product: p,
          stats,
          marginPerUnit,
          marginPct,
          dailyVelocity: velocity,
          maxDemand,
          recommendedUnits,
          projectedBatchCost,
          projectedBatchRevenue,
          projectedBatchProfit,
          runOutDays,
        };
      });
  }, [allProducts, currentAllocatedProducts, salesVelocityMap, targetProduct, swapBudget, tenureDays]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    candidateProducts.forEach((item) => {
      if (item.product.category) set.add(item.product.category);
    });
    return ['All', ...Array.from(set)];
  }, [candidateProducts]);

  // Filter and sort products according to activeTab and search
  const filteredProducts = useMemo(() => {
    return candidateProducts
      .filter((item) => {
        // Category filter
        if (selectedCategory !== 'All' && item.product.category !== selectedCategory) {
          return false;
        }

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = item.product.name.toLowerCase().includes(q);
          const matchSku = item.product.sku.toLowerCase().includes(q);
          const matchCat = (item.product.category || '').toLowerCase().includes(q);
          if (!matchName && !matchSku && !matchCat) return false;
        }

        // Smart tab condition
        if (activeTab === 'higher_margin') {
          if (targetProduct) {
            return item.marginPct > targetProduct.marginPct;
          }
          return item.marginPct >= 35;
        }

        if (activeTab === 'faster_velocity') {
          if (targetProduct) {
            return item.dailyVelocity > targetProduct.dailyVelocity;
          }
          return item.dailyVelocity >= 0.5;
        }

        if (activeTab === 'higher_cash') {
          if (targetProduct) {
            return item.marginPerUnit > targetProduct.marginPerUnit;
          }
          return item.marginPerUnit >= 500;
        }

        return true;
      })
      .sort((a, b) => {
        if (activeTab === 'higher_margin') {
          return b.marginPct - a.marginPct;
        }
        if (activeTab === 'faster_velocity') {
          return b.dailyVelocity - a.dailyVelocity;
        }
        if (activeTab === 'higher_cash') {
          return b.marginPerUnit - a.marginPerUnit;
        }
        // Default sort by projected profit
        return b.projectedBatchProfit - a.projectedBatchProfit;
      });
  }, [candidateProducts, activeTab, selectedCategory, searchQuery, targetProduct]);

  // Currently inspected product in the modal
  const selectedItem = useMemo(() => {
    if (!selectedProductId) {
      return filteredProducts[0] || null;
    }
    return candidateProducts.find((p) => p.product.id === selectedProductId) || filteredProducts[0] || null;
  }, [selectedProductId, filteredProducts, candidateProducts]);

  // Calculate units to allocate
  const finalUnits = useMemo(() => {
    if (!selectedItem) return 0;
    if (customUnitsInput !== null && customUnitsInput > 0) {
      return customUnitsInput;
    }
    return selectedItem.recommendedUnits;
  }, [selectedItem, customUnitsInput]);

  // Delta comparisons vs target product
  const comparisonDelta = useMemo(() => {
    if (!selectedItem || !targetProduct) return null;

    const newProfit = finalUnits * selectedItem.marginPerUnit;
    const oldProfit = targetProduct.projectedGrossProfit;
    const profitDiff = newProfit - oldProfit;

    const newRunOut = Math.max(1, Math.round(finalUnits / Math.max(0.05, selectedItem.dailyVelocity)));
    const oldRunOut = targetProduct.runOutDays;
    const daysDiff = oldRunOut - newRunOut; // positive means faster

    const marginPctDiff = selectedItem.marginPct - targetProduct.marginPct;
    const velocityDiff = selectedItem.dailyVelocity - targetProduct.dailyVelocity;

    return {
      profitDiff,
      daysDiff,
      marginPctDiff,
      velocityDiff,
      newProfit,
      oldProfit,
      newRunOut,
      oldRunOut,
    };
  }, [selectedItem, targetProduct, finalUnits]);

  const handleConfirm = () => {
    if (!selectedItem || finalUnits <= 0) return;
    onConfirmSwap(targetProduct ? targetProduct.productId : null, selectedItem.product.id, finalUnits);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 rounded-2xl border border-emerald-200 dark:border-emerald-800">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <span>{targetProduct ? 'Substitute / Swap Product' : 'Add High-Value Product to Basket'}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold">
                  Capital: {cs}{swapBudget.toLocaleString()}
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {targetProduct
                  ? `Replace "${targetProduct.productName}" with a higher-margin or faster-moving packaging line.`
                  : 'Select an additional profitable product to allocate your investment capital.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Target Snapshot (if swapping) */}
        {targetProduct && (
          <div className="bg-amber-50/50 dark:bg-amber-950/20 border-b border-amber-200/50 dark:border-amber-900/30 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="font-bold text-amber-900 dark:text-amber-200">Current SKU:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {targetProduct.productName}
              </span>
              <span className="font-mono text-[11px] text-slate-500">({targetProduct.sku})</span>
            </div>
            <div className="flex items-center gap-4 text-slate-600 dark:text-slate-300">
              <span>
                Margin: <strong className="text-emerald-600 font-mono">{targetProduct.marginPct}%</strong> ({cs}{targetProduct.marginPerUnit.toLocaleString()}/unit)
              </span>
              <span>•</span>
              <span>
                Velocity: <strong className="text-slate-900 dark:text-white font-mono">{targetProduct.dailyVelocity}</strong> units/day
              </span>
              <span>•</span>
              <span>
                Allocated: <strong className="text-slate-900 dark:text-white font-mono">{targetProduct.recommendedQty}</strong> units ({cs}{targetProduct.allocatedCapital.toLocaleString()})
              </span>
            </div>
          </div>
        )}

        {/* Filter Toolbar & Smart Tabs */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3 bg-white dark:bg-slate-900">
          {/* Smart Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => {
                setActiveTab('higher_margin');
                setSelectedProductId(null);
                setCustomUnitsInput(null);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === 'higher_margin'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Percent className="w-3.5 h-3.5" />
              <span>Higher Gross Margin %</span>
              {targetProduct && (
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/20 text-white font-mono">
                  &gt;{targetProduct.marginPct}%
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveTab('faster_velocity');
                setSelectedProductId(null);
                setCustomUnitsInput(null);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === 'faster_velocity'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Faster Daily Velocity</span>
              {targetProduct && (
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-blue-500/20 text-white font-mono">
                  &gt;{targetProduct.dailyVelocity} u/d
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveTab('higher_cash');
                setSelectedProductId(null);
                setCustomUnitsInput(null);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === 'higher_cash'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Higher Cash Return (₦/unit)</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('all');
                setSelectedProductId(null);
                setCustomUnitsInput(null);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === 'all'
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>All Catalog Products</span>
            </button>
          </div>

          {/* Search and Category Filter */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search candidate packaging by name, SKU, or category..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
                >
                  Clear
                </button>
              )}
            </div>

            {categories.length > 2 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                      selectedCategory === cat
                        ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Content Body: Left List, Right "What-If" Live Impact Inspector */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-100 dark:divide-slate-800">
          {/* Products List (7 Cols) */}
          <div className="lg:col-span-7 p-4 space-y-2 overflow-y-auto max-h-[480px]">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">
              Available Alternatives ({filteredProducts.length} items found)
            </div>

            {filteredProducts.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <Package className="w-8 h-8 text-slate-300 mx-auto" />
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  No products match the selected criteria
                </div>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Try switching to &quot;All Catalog Products&quot; or clearing your search filter to see more items.
                </p>
                <button
                  onClick={() => {
                    setActiveTab('all');
                    setSearchQuery('');
                    setSelectedCategory('All');
                  }}
                  className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold"
                >
                  View All Products
                </button>
              </div>
            ) : (
              filteredProducts.map((item) => {
                const isSelected = selectedItem?.product.id === item.product.id;
                const marginDelta = targetProduct ? item.marginPct - targetProduct.marginPct : null;

                return (
                  <div
                    key={item.product.id}
                    onClick={() => {
                      setSelectedProductId(item.product.id);
                      setCustomUnitsInput(null);
                    }}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 ring-1 ring-emerald-500/20'
                        : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-900 dark:text-white">
                            {item.product.name}
                          </span>
                          {marginDelta !== null && marginDelta > 0 && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              +{marginDelta.toFixed(1)}% Margin
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {item.product.sku} • {item.product.category}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-bold text-xs text-emerald-600 dark:text-emerald-400 font-mono">
                          {item.marginPct.toFixed(1)}% Margin
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          +{cs}{item.marginPerUnit.toLocaleString()} / unit
                        </div>
                      </div>
                    </div>

                    {/* Mini Metrics Line */}
                    <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                      <div className="flex items-center gap-3">
                        <span>
                          Cost: <strong className="text-slate-800 dark:text-slate-200">{cs}{item.product.costPrice.toLocaleString()}</strong>
                        </span>
                        <span>
                          Retail: <strong className="text-slate-800 dark:text-slate-200">{cs}{item.product.retailPrice.toLocaleString()}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-medium">
                        <Zap className="w-3 h-3 text-amber-500" />
                        <span className="text-slate-700 dark:text-slate-300 font-mono">
                          {item.dailyVelocity.toFixed(2)}
                        </span>{' '}
                        <span>u/day</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Inspector: Live What-If Comparison & Confirmation (5 Cols) */}
          <div className="lg:col-span-5 p-4 sm:p-5 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between space-y-4">
            {selectedItem ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <span>Projected Simulation Delta</span>
                  </div>
                  <h3 className="font-black text-sm text-slate-900 dark:text-white">
                    {selectedItem.product.name}
                  </h3>
                  <div className="text-xs text-slate-500 font-mono">
                    {selectedItem.product.sku} • {selectedItem.product.category}
                  </div>
                </div>

                {/* Units Allocation Stepper */}
                <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                      Units to Stock:
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Ceiling: {selectedItem.maxDemand} units
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setCustomUnitsInput(Math.max(5, (customUnitsInput ?? selectedItem.recommendedUnits) - 10))
                      }
                      className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 font-bold"
                    >
                      -10
                    </button>
                    <input
                      type="number"
                      value={finalUnits}
                      onChange={(e) => setCustomUnitsInput(Math.max(1, Number(e.target.value) || 1))}
                      className="flex-1 text-center py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold font-mono text-sm text-slate-900 dark:text-white"
                    />
                    <button
                      onClick={() =>
                        setCustomUnitsInput((customUnitsInput ?? selectedItem.recommendedUnits) + 10)
                      }
                      className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 font-bold"
                    >
                      +10
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>Total Batch Cost:</span>
                    <span className="font-bold text-slate-900 dark:text-white font-mono">
                      {cs}{(finalUnits * selectedItem.product.costPrice).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* What-If Live Delta Card */}
                {comparisonDelta && (
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                      <span>Impact vs. Current Product</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${
                          comparisonDelta.profitDiff >= 0
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {comparisonDelta.profitDiff >= 0 ? '+' : ''}
                        {cs}{comparisonDelta.profitDiff.toLocaleString()} Profit
                      </span>
                    </div>

                    <div className="space-y-2 text-xs divide-y divide-slate-100 dark:divide-slate-800">
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-slate-500">Projected Gross Profit:</span>
                        <div className="text-right">
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                            {cs}{comparisonDelta.newProfit.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-slate-400 block">
                            (was {cs}{comparisonDelta.oldProfit.toLocaleString()})
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1.5">
                        <span className="text-slate-500">Gross Margin %:</span>
                        <div className="text-right">
                          <span className="font-bold text-slate-900 dark:text-white font-mono">
                            {selectedItem.marginPct.toFixed(1)}%
                          </span>
                          <span
                            className={`text-[10px] ml-1 font-semibold ${
                              comparisonDelta.marginPctDiff >= 0 ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            ({comparisonDelta.marginPctDiff >= 0 ? '+' : ''}
                            {comparisonDelta.marginPctDiff.toFixed(1)}%)
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1.5">
                        <span className="text-slate-500">Turnaround / Liquidation:</span>
                        <div className="text-right">
                          <span className="font-bold text-slate-900 dark:text-white font-mono">
                            ~{comparisonDelta.newRunOut} days
                          </span>
                          {comparisonDelta.daysDiff !== 0 && (
                            <span
                              className={`text-[10px] ml-1 font-semibold ${
                                comparisonDelta.daysDiff > 0 ? 'text-emerald-600' : 'text-amber-600'
                              }`}
                            >
                              ({comparisonDelta.daysDiff > 0 ? `${comparisonDelta.daysDiff}d faster` : `${Math.abs(comparisonDelta.daysDiff)}d slower`})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Guidance Tip */}
                <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 flex items-start gap-2 text-[11px] text-blue-700 dark:text-blue-300">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Confirming this swap will automatically update all investor yield milestone schedules, total profit margins, and proposal term sheets.
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center p-8 text-slate-400 text-xs">
                Select a product from the list to preview the financial impact.
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selectedItem || finalUnits <= 0}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>{targetProduct ? 'Confirm Swap' : 'Add to Portfolio'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
