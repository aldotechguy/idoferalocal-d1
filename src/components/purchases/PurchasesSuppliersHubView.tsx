import React, { useState, useEffect } from 'react';
import { Truck, Building } from 'lucide-react';
import { PurchasesView } from './PurchasesView';
import { SuppliersView } from '../suppliers/SuppliersView';
import { useApp } from '../../context/AppContext';

export type PurchasesSuppliersTab = 'purchases' | 'suppliers';

interface PurchasesSuppliersHubViewProps {
  initialTab?: PurchasesSuppliersTab;
}

export const PurchasesSuppliersHubView: React.FC<PurchasesSuppliersHubViewProps> = ({
  initialTab = 'purchases',
}) => {
  const [activeTab, setActiveTab] = useState<PurchasesSuppliersTab>(initialTab);
  const { suppliers, purchases } = useApp();

  const pendingPOs = purchases.filter((p) => p.status === 'Pending' || p.status === 'Partial').length;

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Purchases & Suppliers Hub Navigation Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 rounded-xl">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Purchases & Suppliers Hub
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  Unified Hub
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage stock purchases, Goods Received Notes (GRN), and supplier contact directories.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('purchases')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'purchases'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Purchase Orders (POs)</span>
            {pendingPOs > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-500 text-white">
                {pendingPOs} Active
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('suppliers')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'suppliers'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Building className="w-3.5 h-3.5" />
            <span>Suppliers Directory</span>
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {suppliers.length}
            </span>
          </button>
        </div>
      </div>

      {/* Active Tab Content */}
      <div>
        {activeTab === 'purchases' ? <PurchasesView /> : <SuppliersView />}
      </div>
    </div>
  );
};
