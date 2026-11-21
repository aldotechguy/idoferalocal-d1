import React, { useState } from 'react';
import {
  X,
  Play,
  TrendingUp,
  DollarSign,
  Calendar,
  Layers,
  Percent,
  CheckCircle2,
  Clock,
  Sparkles,
  Info,
} from 'lucide-react';
import { AllocationStrategy, InvestmentSimulationResult } from '../../types/investment';

interface StartCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  simulation: InvestmentSimulationResult;
  strategy: AllocationStrategy;
  scenarioName?: string;
  scenarioId?: string;
  onConfirmLaunch: (
    campaignName: string,
    investorName: string,
    investorContact: string,
    startDate: string
  ) => void;
  currencySymbol?: string;
}

export const StartCampaignModal: React.FC<StartCampaignModalProps> = ({
  isOpen,
  onClose,
  simulation,
  strategy,
  scenarioName,
  onConfirmLaunch,
  currencySymbol = '₦',
}) => {
  const cs = currencySymbol;

  const defaultName = scenarioName || `Venture Tranche ${new Date().toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
  const [campaignName, setCampaignName] = useState(defaultName);
  const [investorName, setInvestorName] = useState('');
  const [investorContact, setInvestorContact] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignName.trim()) return;
    onConfirmLaunch(
      campaignName.trim(),
      investorName.trim(),
      investorContact.trim(),
      new Date(startDate).toISOString()
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-2xl">
              <Play className="w-5 h-5 fill-current" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                Launch Live Investment Campaign
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Lock in allocation parameters and start tracking sales and investor returns in real-time.
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Summary Snapshot Card */}
          <div className="bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-900/40 rounded-2xl p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Capital</span>
                <div className="font-black text-slate-900 dark:text-white mt-0.5">
                  {cs}{simulation.investmentAmount.toLocaleString()}
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Tenure</span>
                <div className="font-black text-slate-900 dark:text-white mt-0.5">
                  {simulation.tenureMonths} Months
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Return Model</span>
                <div className="font-black text-slate-900 dark:text-white mt-0.5 capitalize">
                  {simulation.returnModel.replace('_', ' ')} ({simulation.yieldRate}%)
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">SKUs Funded</span>
                <div className="font-black text-slate-900 dark:text-white mt-0.5">
                  {simulation.allocatedProducts.length} Products
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Campaign / Tranche Name *
            </label>
            <input
              type="text"
              required
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="e.g. Q1 Working Capital Tranche"
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Investor Name (Optional)
              </label>
              <input
                type="text"
                value={investorName}
                onChange={(e) => setInvestorName(e.target.value)}
                placeholder="e.g. Adeola Balogun"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Investor Contact / Phone
              </label>
              <input
                type="text"
                value={investorContact}
                onChange={(e) => setInvestorContact(e.target.value)}
                placeholder="e.g. +234 803 123 4567"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Campaign Start Date
            </label>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Only sales recorded on or after this date will contribute to capital recovery and investor yield.
            </p>
          </div>

          {/* Allocation preview */}
          <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3 border border-slate-200 dark:border-slate-700/60">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Allocated Inventory Ceiling ({simulation.allocatedProducts.length} items)
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {simulation.allocatedProducts.map((p) => (
                <div key={p.productId} className="flex items-center justify-between text-xs py-1 border-b border-slate-200/50 dark:border-slate-700/40 last:border-0">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">{p.productName}</span>
                  <span className="font-bold text-slate-600 dark:text-slate-300 shrink-0 ml-2">
                    {p.recommendedQty} units ({cs}{p.allocatedCapital.toLocaleString()})
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 rounded-xl flex items-start gap-2 text-xs text-blue-700 dark:text-blue-300">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Once started, the system will track live sales velocity. If any SKU sells significantly slower than projected, the system will alert you and recommend fast-moving replacements to protect your yield.
            </span>
          </div>

          {/* Footer Submit */}
          <div className="pt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-600/20 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Confirm & Start Tracking</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
