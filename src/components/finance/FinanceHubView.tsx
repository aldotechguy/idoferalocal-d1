import React, { useState, useEffect } from 'react';
import { Receipt, ArrowRightLeft, Wallet, Building, Banknote, TrendingUp } from 'lucide-react';
import { ExpensesView } from '../expenses/ExpensesView';
import { MoneyMovementView } from '../treasury/MoneyMovementView';
import { InvestmentPlannerView } from './InvestmentPlannerView';
import { useApp } from '../../context/AppContext';
import { NairaSign } from '../common/NairaSign';

export type FinanceTab = 'expenses' | 'money-movement' | 'investment-planner';

interface FinanceHubViewProps {
  initialTab?: FinanceTab;
  onNavigate?: (page: string) => void;
}

export const FinanceHubView: React.FC<FinanceHubViewProps> = ({ initialTab = 'expenses', onNavigate }) => {
  const [activeTab, setActiveTab] = useState<FinanceTab>(initialTab);
  const { treasuryBalances, settings } = useApp();

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Finance Hub Navigation Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 rounded-xl">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Finance & Treasury
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  Unified Hub
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage operating expenses, physical cash register, and company bank accounts in one place.
              </p>
            </div>
          </div>

          {/* Liquid Balances Quick Indicator */}
          {treasuryBalances && (
            <div className="flex items-center gap-2 sm:gap-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 px-3 py-1.5 rounded-xl text-xs">
              <div className="flex items-center gap-1.5">
                <Banknote className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Till:</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {settings.currencySymbol}{(treasuryBalances?.physicalCashBalance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <div className="flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Bank:</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {settings.currencySymbol}{(treasuryBalances?.bizAccountBalance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('expenses')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'expenses'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Operating Expenses</span>
          </button>

          <button
            onClick={() => setActiveTab('money-movement')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'money-movement'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Money Movement & Liquid Cash</span>
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200/50">
              Live
            </span>
          </button>

          <button
            onClick={() => setActiveTab('investment-planner')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'investment-planner'
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>Investment & Capital Planner</span>
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/50">
              Growth
            </span>
          </button>
        </div>
      </div>

      {/* Active Tab Content */}
      <div>
        {activeTab === 'expenses' ? (
          <ExpensesView />
        ) : activeTab === 'money-movement' ? (
          <MoneyMovementView />
        ) : (
          <InvestmentPlannerView />
        )}
      </div>
    </div>
  );
};
