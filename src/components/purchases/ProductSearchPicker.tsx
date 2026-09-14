import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  X,
  Plus,
  Check,
  Package,
  AlertCircle,
  AlertTriangle,
  Flame,
  TrendingUp,
  ArrowDownUp,
  Sparkles,
} from 'lucide-react';
import { Product, Sale } from '../../types';
import { useApp } from '../../context/AppContext';

export interface POItemFormState {
  productId: string;
  quantity: number;
  unitCost: number;
  updateCatalogCost: boolean;
  customRetailPrice?: number;
  updateCatalogRetailPrice?: boolean;
}

interface ProductSearchPickerProps {
  products: Product[];
  sales?: Sale[];
  poItems: POItemFormState[];
  onAddItem: (productId: string, suggestedQuantity?: number) => void;
  currencySymbol: string;
}

type UrgencyCategory =
  | 'OOS_HIGH_DEMAND'
  | 'LOW_STOCK_HIGH_DEMAND'
  | 'OOS_REGULAR'
  | 'LOW_STOCK_REGULAR'
  | 'HEALTHY_HIGH_DEMAND'
  | 'HEALTHY';

type SortOption = 'urgency' | 'lowest_stock' | 'highest_demand' | 'alphabetical';
type QuickFilter = 'all' | 'needs_restock' | 'high_demand';

interface ProductUrgencyProfile {
  product: Product;
  totalSold: number;
  orderCount: number;
  currentStock: number;
  minimumStock: number;
  deficit: number;
  urgencyScore: number;
  urgencyCategory: UrgencyCategory;
  urgencyLabel: string;
  suggestedReorder: number;
  isHighDemand: boolean;
}

export const ProductSearchPicker: React.FC<ProductSearchPickerProps> = ({
  products,
  sales: propsSales,
  poItems,
  onAddItem,
  currencySymbol,
}) => {
  const app = useApp();
  const sales = propsSales ?? app?.sales ?? [];

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('urgency');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 1. Calculate historical sales demand per product
  const demandMap = useMemo(() => {
    const map = new Map<string, { totalSold: number; orderCount: number }>();
    (sales || []).forEach((sale) => {
      if (sale.status === 'Refunded') return;
      sale.items?.forEach((item) => {
        if (!item.productId) return;
        const current = map.get(item.productId) || { totalSold: 0, orderCount: 0 };
        current.totalSold += item.quantity || 0;
        current.orderCount += 1;
        map.set(item.productId, current);
      });
    });
    return map;
  }, [sales]);

  // Compute average sales to dynamically define high demand baseline
  const { avgDemand, maxDemand } = useMemo(() => {
    let sum = 0;
    let max = 0;
    let count = 0;
    demandMap.forEach((val) => {
      if (val.totalSold > 0) {
        sum += val.totalSold;
        count += 1;
        if (val.totalSold > max) max = val.totalSold;
      }
    });
    return {
      avgDemand: count > 0 ? Math.round(sum / count) : 3,
      maxDemand: max,
    };
  }, [demandMap]);

  // 2. Build full Urgency Profiles for all products
  const productProfiles = useMemo<ProductUrgencyProfile[]>(() => {
    return products.map((p) => {
      const demand = demandMap.get(p.id) || { totalSold: 0, orderCount: 0 };
      const currentStock = p.currentStock;
      const minStock = p.minimumStockLevel ?? 5;
      const isOutOfStock = currentStock <= 0;
      const isLowStock = currentStock > 0 && currentStock <= minStock;
      const deficit = Math.max(0, minStock - currentStock);

      // High demand condition: sold more than average or >= 5 units or in >= 2 distinct orders
      const isHighDemand =
        demand.totalSold >= Math.max(4, Math.ceil(avgDemand * 0.7)) || demand.orderCount >= 2;

      let urgencyCategory: UrgencyCategory = 'HEALTHY';
      let urgencyScore = 0;
      let urgencyLabel = 'In Stock';

      // Suggested reorder quantity: deficit + buffer based on demand velocity
      let suggestedReorder = 5;
      if (isOutOfStock) {
        suggestedReorder = Math.max(minStock * 2, Math.ceil(demand.totalSold * 0.7) || 10);
      } else if (isLowStock) {
        suggestedReorder = Math.max(deficit + minStock, Math.ceil(demand.totalSold * 0.5) || 5);
      }

      if (isOutOfStock) {
        if (isHighDemand || demand.totalSold > 0) {
          // TIER 1: Out of Stock with high/active demand (CRITICAL EMERGENCY)
          urgencyCategory = 'OOS_HIGH_DEMAND';
          urgencyScore = 100000 + demand.totalSold * 100 + demand.orderCount * 20 + minStock * 5;
          urgencyLabel = `Out of Stock • High Demand (${demand.totalSold} sold)`;
        } else {
          // TIER 3: Out of stock but zero recorded sales
          urgencyCategory = 'OOS_REGULAR';
          urgencyScore = 30000 + minStock * 10;
          urgencyLabel = 'Out of Stock • No Recent Sales';
        }
      } else if (isLowStock) {
        if (isHighDemand || demand.totalSold > 0) {
          // TIER 2: Low Stock with active/high demand (Fast runner on verge of stockout)
          const burnRate = demand.totalSold / Math.max(1, currentStock);
          urgencyCategory = 'LOW_STOCK_HIGH_DEMAND';
          urgencyScore =
            60000 + burnRate * 800 + deficit * 120 + demand.totalSold * 25;
          urgencyLabel = `Low Stock (${currentStock} left) • Fast Mover`;
        } else {
          // TIER 4: Low stock but low sales volume
          urgencyCategory = 'LOW_STOCK_REGULAR';
          urgencyScore = 15000 + deficit * 15;
          urgencyLabel = `Low Stock (${currentStock}/${minStock})`;
        }
      } else {
        // TIER 5: Healthy Stock Level
        if (isHighDemand) {
          urgencyCategory = 'HEALTHY_HIGH_DEMAND';
          urgencyScore = 5000 + (demand.totalSold / Math.max(1, currentStock)) * 50;
          urgencyLabel = `Adequate Stock • Active (${demand.totalSold} sold)`;
        } else {
          urgencyCategory = 'HEALTHY';
          urgencyScore = 0 - currentStock;
          urgencyLabel = `In Stock (${currentStock} ${p.unit})`;
        }
      }

      return {
        product: p,
        totalSold: demand.totalSold,
        orderCount: demand.orderCount,
        currentStock,
        minimumStock: minStock,
        deficit,
        urgencyScore,
        urgencyCategory,
        urgencyLabel,
        suggestedReorder,
        isHighDemand,
      };
    });
  }, [products, demandMap, avgDemand]);

  // Restock statistics for helper badges
  const restockCounts = useMemo(() => {
    let outOfStockHighDemand = 0;
    let lowStockHighDemand = 0;
    let totalNeedsRestock = 0;
    let totalHighDemand = 0;

    productProfiles.forEach((prof) => {
      if (prof.urgencyCategory === 'OOS_HIGH_DEMAND') outOfStockHighDemand++;
      if (prof.urgencyCategory === 'LOW_STOCK_HIGH_DEMAND') lowStockHighDemand++;
      if (
        prof.urgencyCategory === 'OOS_HIGH_DEMAND' ||
        prof.urgencyCategory === 'LOW_STOCK_HIGH_DEMAND' ||
        prof.urgencyCategory === 'OOS_REGULAR' ||
        prof.urgencyCategory === 'LOW_STOCK_REGULAR'
      ) {
        totalNeedsRestock++;
      }
      if (prof.isHighDemand) totalHighDemand++;
    });

    return {
      outOfStockHighDemand,
      lowStockHighDemand,
      totalNeedsRestock,
      totalHighDemand,
    };
  }, [productProfiles]);

  // Extract unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return ['All', ...Array.from(set).sort()];
  }, [products]);

  // Filter and sort the product profiles
  const filteredAndSortedProfiles = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();

    return productProfiles
      .filter((prof) => {
        const p = prof.product;

        // Quick filter: Needs restock vs High demand
        if (quickFilter === 'needs_restock') {
          const needs =
            prof.urgencyCategory === 'OOS_HIGH_DEMAND' ||
            prof.urgencyCategory === 'LOW_STOCK_HIGH_DEMAND' ||
            prof.urgencyCategory === 'OOS_REGULAR' ||
            prof.urgencyCategory === 'LOW_STOCK_REGULAR';
          if (!needs) return false;
        } else if (quickFilter === 'high_demand') {
          if (!prof.isHighDemand) return false;
        }

        // Category filter
        const matchCategory = selectedCategory === 'All' || p.category === selectedCategory;
        if (!matchCategory) return false;

        // Search query
        if (!q) return true;
        const matchName = (p.name || '').toLowerCase().includes(q);
        const matchSku = (p.sku || '').toLowerCase().includes(q);
        const matchCat = (p.category || '').toLowerCase().includes(q);
        return matchName || matchSku || matchCat;
      })
      .sort((a, b) => {
        if (sortBy === 'urgency') {
          // Primary: Urgency Score (Out of Stock against High Demand first!)
          return b.urgencyScore - a.urgencyScore;
        }
        if (sortBy === 'lowest_stock') {
          return a.currentStock - b.currentStock;
        }
        if (sortBy === 'highest_demand') {
          return b.totalSold - a.totalSold;
        }
        if (sortBy === 'alphabetical') {
          return a.product.name.localeCompare(b.product.name);
        }
        return b.urgencyScore - a.urgencyScore;
      });
  }, [productProfiles, searchTerm, selectedCategory, quickFilter, sortBy]);

  // Click outside to close results dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectProduct = (prof: ProductUrgencyProfile) => {
    onAddItem(prof.product.id, prof.suggestedReorder);
  };

  // Map product id to existing item in PO queue
  const poItemsMap = useMemo(() => {
    const map = new Map<string, number>();
    poItems.forEach((i) => {
      map.set(i.productId, (map.get(i.productId) || 0) + i.quantity);
    });
    return map;
  }, [poItems]);

  return (
    <div ref={containerRef} className="relative space-y-2.5">
      {/* Header with Restock Intelligence Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Smart Product Line Picker</span>
          </label>
          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/60">
            Demand-Ranked
          </span>
        </div>

        {restockCounts.totalNeedsRestock > 0 && (
          <div className="flex items-center gap-2 text-[11px]">
            {restockCounts.outOfStockHighDemand > 0 && (
              <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-extrabold">
                <Flame className="w-3.5 h-3.5" />
                <span>{restockCounts.outOfStockHighDemand} Out of Stock & High Demand</span>
              </span>
            )}
            <span className="text-slate-400">•</span>
            <span className="text-slate-500 dark:text-slate-400 font-semibold">
              {restockCounts.totalNeedsRestock} need restock
            </span>
          </div>
        )}
      </div>

      {/* Search Input Bar & Sort Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search products by name, SKU, or category to add..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            className="w-full pl-10 pr-9 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all shadow-2xs"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Sort Order Selector */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 px-2.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold shadow-2xs">
            <ArrowDownUp className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="text-[10px] text-slate-400 uppercase font-extrabold mr-1">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="bg-transparent border-none text-xs font-black text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer pr-1"
            >
              <option value="urgency">Restock Urgency (OOS & High Demand)</option>
              <option value="lowest_stock">Lowest Stock on Hand</option>
              <option value="highest_demand">Highest Sales Volume</option>
              <option value="alphabetical">Product Name (A - Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Quick Filter Tabs & Categories */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {/* Quick Filter: Restock Priority */}
        <button
          type="button"
          onClick={() => {
            setQuickFilter('all');
            setIsOpen(true);
          }}
          className={`px-3 py-1 rounded-lg font-black transition-all ${
            quickFilter === 'all'
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-2xs'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          All Items ({products.length})
        </button>

        <button
          type="button"
          onClick={() => {
            setQuickFilter(quickFilter === 'needs_restock' ? 'all' : 'needs_restock');
            setIsOpen(true);
          }}
          className={`flex items-center gap-1 px-3 py-1 rounded-lg font-black transition-all ${
            quickFilter === 'needs_restock'
              ? 'bg-rose-600 text-white shadow-2xs'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200/80 dark:border-rose-900 hover:bg-rose-100'
          }`}
        >
          <Flame className="w-3 h-3" />
          <span>Needs Restock ({restockCounts.totalNeedsRestock})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setQuickFilter(quickFilter === 'high_demand' ? 'all' : 'high_demand');
            setIsOpen(true);
          }}
          className={`flex items-center gap-1 px-3 py-1 rounded-lg font-black transition-all ${
            quickFilter === 'high_demand'
              ? 'bg-amber-600 text-white shadow-2xs'
              : 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200/80 dark:border-amber-900 hover:bg-amber-100'
          }`}
        >
          <TrendingUp className="w-3 h-3" />
          <span>High Demand ({restockCounts.totalHighDemand})</span>
        </button>

        {/* Separator */}
        <span className="text-slate-300 dark:text-slate-700 mx-0.5">|</span>

        {/* Category Filter Chips */}
        {categories.slice(0, 5).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => {
              setSelectedCategory(cat);
              setIsOpen(true);
            }}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap ${
              selectedCategory === cat
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {cat}
          </button>
        ))}

        {categories.length > 5 && (
          <select
            value={categories.slice(5).includes(selectedCategory) ? selectedCategory : ''}
            onChange={(e) => {
              if (e.target.value) {
                setSelectedCategory(e.target.value);
                setIsOpen(true);
              }
            }}
            className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-lg font-bold border-none text-[11px] focus:outline-none"
          >
            <option value="">More categories...</option>
            {categories.slice(5).map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Product Results Popover / Dropdown */}
      {isOpen && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 p-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Subheader summary bar */}
          <div className="px-3 py-2 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/80 dark:bg-slate-800/60 rounded-xl mb-1 sticky top-0 backdrop-blur-md z-10">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-blue-500" />
              <span>
                {filteredAndSortedProfiles.length} Products{' '}
                {sortBy === 'urgency' ? '• Ranked by Restock Urgency' : ''}
              </span>
            </span>
            <span className="text-slate-500 dark:text-slate-400 font-extrabold lowercase">
              click item to add to PO
            </span>
          </div>

          {filteredAndSortedProfiles.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Package className="w-9 h-9 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                No products match &quot;{searchTerm}&quot;
              </p>
              <p className="text-[11px] mt-0.5">
                Try switching the category or resetting your filter.
              </p>
            </div>
          ) : (
            filteredAndSortedProfiles.slice(0, 50).map((prof) => {
              const product = prof.product;
              const inPoQty = poItemsMap.get(product.id);
              const isOOS = prof.currentStock <= 0;
              const isLow = !isOOS && prof.currentStock <= prof.minimumStock;

              return (
                <div
                  key={product.id}
                  onClick={() => handleSelectProduct(prof)}
                  className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all group ${
                    isOOS && prof.isHighDemand
                      ? 'hover:bg-rose-50/80 dark:hover:bg-rose-950/40 bg-rose-50/20'
                      : isLow && prof.isHighDemand
                      ? 'hover:bg-amber-50/80 dark:hover:bg-amber-950/40 bg-amber-50/20'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <div className="flex-1 min-w-0 pr-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-black text-slate-900 dark:text-white truncate">
                        {product.name}
                      </p>

                      {/* In PO Quantity Pill */}
                      {inPoQty !== undefined && inPoQty > 0 && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[10px] font-black flex items-center gap-0.5">
                          <Check className="w-2.5 h-2.5" />
                          <span>In PO ({inPoQty})</span>
                        </span>
                      )}

                      {/* Restock Urgency Badge */}
                      {prof.urgencyCategory === 'OOS_HIGH_DEMAND' && (
                        <span className="shrink-0 px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/90 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[10px] font-black flex items-center gap-1 shadow-2xs animate-pulse">
                          <Flame className="w-2.5 h-2.5 text-rose-600 dark:text-rose-400" />
                          <span>OUT OF STOCK • HIGH DEMAND</span>
                        </span>
                      )}

                      {prof.urgencyCategory === 'LOW_STOCK_HIGH_DEMAND' && (
                        <span className="shrink-0 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/90 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[10px] font-black flex items-center gap-1 shadow-2xs">
                          <AlertTriangle className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                          <span>LOW STOCK • FAST MOVER</span>
                        </span>
                      )}

                      {prof.urgencyCategory === 'OOS_REGULAR' && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold">
                          Out of Stock
                        </span>
                      )}
                    </div>

                    {/* Stock & Demand Details */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
                      <span className="text-slate-600 dark:text-slate-300">SKU: {product.sku}</span>
                      <span>•</span>
                      <span>Cat: {product.category}</span>
                      <span>•</span>

                      {/* Stock on hand display */}
                      <span
                        className={`font-black flex items-center gap-1 ${
                          isOOS
                            ? 'text-rose-600 dark:text-rose-400'
                            : isLow
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {isOOS && <AlertCircle className="w-3 h-3 shrink-0" />}
                        {isLow && <AlertTriangle className="w-3 h-3 shrink-0" />}
                        <span>
                          Stock: {prof.currentStock} {product.unit} (Min: {prof.minimumStock})
                        </span>
                      </span>

                      {/* Demand / Sales Volume metric */}
                      {prof.totalSold > 0 ? (
                        <>
                          <span>•</span>
                          <span className="text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-0.5">
                            <TrendingUp className="w-3 h-3" />
                            <span>{prof.totalSold} sold ({prof.orderCount} orders)</span>
                          </span>
                        </>
                      ) : (
                        <>
                          <span>•</span>
                          <span className="text-slate-400 italic">No sales recorded</span>
                        </>
                      )}

                      {/* Reorder Recommendation */}
                      {(isOOS || isLow) && (
                        <>
                          <span>•</span>
                          <span className="text-blue-600 dark:text-blue-400 font-extrabold bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.2 rounded">
                            Rec: +{prof.suggestedReorder}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Price & Action Button */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-xs font-black font-mono text-slate-900 dark:text-white">
                        {currencySymbol}{product.costPrice.toFixed(2)}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        Retail: {currencySymbol}{product.retailPrice.toFixed(2)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectProduct(prof);
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-extrabold text-xs transition-all shadow-2xs ${
                        isOOS && prof.isHighDemand
                          ? 'bg-rose-600 hover:bg-rose-700 text-white'
                          : isLow && prof.isHighDemand
                          ? 'bg-amber-600 hover:bg-amber-700 text-white'
                          : 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white'
                      }`}
                      title={`Add to PO (Recommended: ${prof.suggestedReorder} units)`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Add</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
