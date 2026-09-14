import React, { useState, useEffect } from 'react';
import { Package, Boxes, Archive } from 'lucide-react';
import { ProductsView } from './ProductsView';
import { InventoryView } from '../inventory/InventoryView';
import { PricingView } from '../pricing/PricingView';
import { ArchiveView } from './ArchiveView';
import { NairaSign } from '../common/NairaSign';
import { useApp } from '../../context/AppContext';

export type ProductsStockTab = 'products' | 'inventory' | 'pricing' | 'archive';

interface ProductsStockHubViewProps {
  initialTab?: ProductsStockTab;
  onNavigate: (page: string) => void;
}

export const ProductsStockHubView: React.FC<ProductsStockHubViewProps> = ({
  initialTab = 'products',
  onNavigate,
}) => {
  const [activeTab, setActiveTab] = useState<ProductsStockTab>(initialTab);
  const { products } = useApp();

  const archivedCount = products.filter((p) => p.status === 'Archived').length;
  const lowStockCount = products.filter(
    (p) => p.status !== 'Archived' && (p.currentStock || 0) <= (p.minimumStockLevel || 5)
  ).length;

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Products & Stock Hub Navigation Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 rounded-xl">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Products & Inventory Hub
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  Unified Hub
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Master product catalog, inventory stock balances, price tiers, and product archives.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('products')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'products'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Product Catalog</span>
          </button>

          <button
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'inventory'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>Stock Control & Movements</span>
            {lowStockCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-500 text-white">
                {lowStockCount} Low
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('pricing')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'pricing'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <NairaSign className="w-3.5 h-3.5" />
            <span>Multiple Pricing Tiers</span>
          </button>

          <button
            onClick={() => setActiveTab('archive')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'archive'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Archived Products</span>
            {archivedCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                {archivedCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Active Tab Content */}
      <div>
        {activeTab === 'products' && <ProductsView onNavigate={onNavigate} />}
        {activeTab === 'inventory' && <InventoryView />}
        {activeTab === 'pricing' && <PricingView />}
        {activeTab === 'archive' && <ArchiveView onNavigate={onNavigate} />}
      </div>
    </div>
  );
};
