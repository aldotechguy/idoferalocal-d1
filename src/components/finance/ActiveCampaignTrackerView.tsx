import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  DollarSign,
  Calendar,
  Layers,
  Percent,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Zap,
  CheckCircle2,
  Package,
  Plus,
  ArrowRight,
  ArrowLeftRight,
  HelpCircle,
  FileText,
  Search,
  Check,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { Product, Sale } from '../../types';
import {
  ActiveCampaignProduct,
  ActiveInvestmentCampaign,
  CampaignLiveProgress,
  ProductLiveTracking,
} from '../../types/investment';
import {
  calculateCampaignLiveProgress,
  applySkuSubstitution,
  settleCampaignMilestone,
} from '../../utils/investmentEngine';
import { CampaignRebalanceModal } from '../modals/CampaignRebalanceModal';

interface ActiveCampaignTrackerViewProps {
  campaigns: ActiveInvestmentCampaign[];
  onUpdateCampaign: (updated: ActiveInvestmentCampaign) => void;
  onDeleteCampaign?: (id: string) => void;
  sales: Sale[];
  products: Product[];
  currencySymbol?: string;
  onNavigateToSimulator?: () => void;
}

export const ActiveCampaignTrackerView: React.FC<ActiveCampaignTrackerViewProps> = ({
  campaigns,
  onUpdateCampaign,
  onDeleteCampaign,
  sales,
  products,
  currencySymbol = '₦',
  onNavigateToSimulator,
}) => {
  const cs = currencySymbol;

  // Selected campaign ID
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(() => {
    return campaigns.length > 0 ? campaigns[0].id : '';
  });

  // Active section tab inside tracker
  const [activeTrackerTab, setActiveTrackerTab] = useState<'portfolio' | 'sales' | 'milestones' | 'history'>('portfolio');

  // Rebalance modal state
  const [rebalanceTarget, setRebalanceTarget] = useState<{
    product: ActiveCampaignProduct;
    tracking: ProductLiveTracking;
  } | null>(null);

  // Milestone settlement modal state
  const [settlingPeriodIndex, setSettlingPeriodIndex] = useState<number | null>(null);
  const [settlementNote, setSettlementNote] = useState('');

  // Selected campaign object
  const currentCampaign = useMemo(() => {
    return campaigns.find((c) => c.id === selectedCampaignId) || campaigns[0] || null;
  }, [campaigns, selectedCampaignId]);

  // Derived live progress
  const progress: CampaignLiveProgress | null = useMemo(() => {
    if (!currentCampaign) return null;
    return calculateCampaignLiveProgress(currentCampaign, sales, products);
  }, [currentCampaign, sales, products]);

  if (!currentCampaign || !progress) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-10 text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-3xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <TrendingUp className="w-7 h-7" />
        </div>
        <div>
          <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
            No Active Investment Campaigns Running
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            Design an inventory capital allocation plan in the simulator and click "Start Campaign" to begin real-time sales tracking and yield monitoring.
          </p>
        </div>
        {onNavigateToSimulator && (
          <button
            onClick={onNavigateToSimulator}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
          >
            <span>Open Investment Planner</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  // Handle mid-flight SKU substitution
  const handleConfirmSubstitution = (
    incomingProduct: Product,
    newUnits: number,
    reason: 'slow_velocity' | 'tenure_overrun' | 'manual_optimization'
  ) => {
    if (!rebalanceTarget) return;
    const updated = applySkuSubstitution(
      currentCampaign,
      rebalanceTarget.product.productId,
      incomingProduct,
      newUnits,
      reason,
      sales
    );
    onUpdateCampaign(updated);
    setRebalanceTarget(null);
  };

  // Handle milestone settlement
  const handleConfirmSettlement = (periodIndex: number, amount?: number) => {
    const updated = settleCampaignMilestone(currentCampaign, periodIndex, amount, settlementNote.trim());
    onUpdateCampaign(updated);
    setSettlingPeriodIndex(null);
    setSettlementNote('');
  };

  return (
    <div className="space-y-6">
      {/* Campaign Selector & Switcher Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider shrink-0 mr-1">
            Campaigns:
          </span>
          {campaigns.map((c) => {
            const isSelected = c.id === currentCampaign.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedCampaignId(c.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span>{c.name}</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    c.status === 'completed'
                      ? 'bg-blue-400'
                      : c.status === 'paused'
                      ? 'bg-amber-400'
                      : 'bg-emerald-500 animate-pulse'
                  }`}
                />
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 capitalize">
            {currentCampaign.status}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Started: {new Date(currentCampaign.startedAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Proactive Rebalancing Advisory Alert Banner */}
      {progress.flaggedDragProducts.length > 0 && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 bg-amber-500 text-white rounded-2xl shrink-0 shadow-md shadow-amber-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-black text-slate-900 dark:text-white">
                  Capital Drag Warning: {progress.flaggedDragProducts.length} Underperforming SKU(s)
                </h4>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-950 text-amber-900 dark:text-amber-200">
                  Action Advised
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-2xl">
                {progress.flaggedDragProducts[0].reason}{' '}
                The system has found fast-moving replacement candidates to protect investor yield and recover capital.
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              const firstFlagged = progress.flaggedDragProducts[0];
              setRebalanceTarget({
                product: firstFlagged.tracking.product,
                tracking: firstFlagged.tracking,
              });
            }}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-md transition-all shrink-0 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Review & Rebalance SKU</span>
          </button>
        </div>
      )}

      {/* 4 Real-Time Executive KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Capital Payback */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Principal Recovered
            </span>
            <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              {cs}{progress.totalPrincipalRecovered.toLocaleString()}
            </span>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              {progress.principalPaybackPct}%
            </span>
          </div>
          <div className="mt-3">
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, progress.principalPaybackPct)}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1.5">
              <span>Target: {cs}{currentCampaign.investmentAmount.toLocaleString()}</span>
              {progress.isPrincipalRecovered && (
                <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                  <CheckCircle2 className="w-3 h-3" /> Fully Recovered
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Metric 2: Realized Gross Profit */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Realized Gross Profit
            </span>
            <div className="p-2 bg-teal-500/10 text-teal-600 dark:text-teal-400 rounded-xl">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-black text-teal-600 dark:text-teal-400">
              {cs}{progress.totalRealizedGrossProfit.toLocaleString()}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Gross Revenue Generated: <span className="font-bold text-slate-700 dark:text-slate-300">{cs}{progress.totalRevenueGenerated.toLocaleString()}</span>
          </p>
        </div>

        {/* Metric 3: Investor Return Accrual / DSCR */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Investor Yield Accrued
            </span>
            <div className="p-2 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-black text-indigo-600 dark:text-indigo-400">
              {cs}{progress.investorAccruedReturn.toLocaleString()}
            </span>
            <span className="text-[11px] font-bold text-slate-400">
              ({currentCampaign.returnModel.replace('_', ' ')})
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-400 text-[11px]">Business Retained:</span>
            <span className="font-black text-slate-800 dark:text-slate-200">
              {cs}{progress.businessRetainedProfit.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Metric 4: Campaign Health & Pacing */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Health & Pacing
            </span>
            <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-black ${
                progress.healthStatus === 'Ahead of Pace'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : progress.healthStatus === 'On Track'
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              }`}
            >
              {progress.healthStatus}
            </span>
            <span className="text-xs text-slate-400">
              Day {progress.daysElapsed} of {progress.totalTenureDays}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 line-clamp-2">
            {progress.healthReason}
          </p>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-1.5 flex flex-wrap gap-1">
        <button
          onClick={() => setActiveTrackerTab('portfolio')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTrackerTab === 'portfolio'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Package className="w-3.5 h-3.5" />
          <span>Portfolio Depletion & Health ({progress.productTrackings.length})</span>
        </button>

        <button
          onClick={() => setActiveTrackerTab('sales')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTrackerTab === 'sales'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span>Live Sales Feed ({progress.attributedSales.length})</span>
        </button>

        <button
          onClick={() => setActiveTrackerTab('milestones')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTrackerTab === 'milestones'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Milestone Schedule & Settlements</span>
        </button>

        {currentCampaign.substitutionHistory.length > 0 && (
          <button
            onClick={() => setActiveTrackerTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTrackerTab === 'history'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>Rebalance History ({currentCampaign.substitutionHistory.length})</span>
          </button>
        )}
      </div>

      {/* Tab 1: Portfolio Depletion & SKU Health Table */}
      {activeTrackerTab === 'portfolio' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white">
                Allocated Inventory Status
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time sell-through, actual daily run-rate, and rebalance triggers per SKU.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Product / SKU</th>
                  <th className="py-3 px-3">Target Qty</th>
                  <th className="py-3 px-3">Units Sold</th>
                  <th className="py-3 px-3">Remaining</th>
                  <th className="py-3 px-3">Sell-Through</th>
                  <th className="py-3 px-3">Live Velocity</th>
                  <th className="py-3 px-3">Capital Recov.</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {progress.productTrackings.map((t) => {
                  const prod = t.product;
                  const isSubbed = prod.isSubstitutedOut;

                  return (
                    <tr
                      key={prod.productId}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                        t.isUnderperforming ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white">
                        <div className="font-bold line-clamp-1">{prod.productName}</div>
                        <div className="text-[10px] text-slate-400">
                          SKU: {prod.sku} • Cost: {cs}{prod.costPrice.toLocaleString()}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300">
                        {prod.currentTargetQty}
                      </td>
                      <td className="py-3 px-3 font-bold text-emerald-600 dark:text-emerald-400">
                        {t.unitsSold}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-600 dark:text-slate-400">
                        {t.remainingUnits}
                      </td>
                      <td className="py-3 px-3">
                        <div className="w-20">
                          <div className="flex justify-between text-[10px] font-bold mb-0.5">
                            <span>{t.sellThroughPct}%</span>
                          </div>
                          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                t.sellThroughPct >= 80 ? 'bg-emerald-500' : 'bg-teal-500'
                              }`}
                              style={{ width: `${Math.min(100, t.sellThroughPct)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          {t.actualDailyVelocity} / day
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Target: {prod.projectedDailyVelocity}/day
                        </div>
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                        {cs}{t.cogsRecovered.toLocaleString()}
                      </td>
                      <td className="py-3 px-3">
                        {isSubbed ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            Substituted Out
                          </span>
                        ) : t.isUnderperforming ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 w-fit">
                            <AlertTriangle className="w-2.5 h-2.5" /> Capital Drag
                          </span>
                        ) : t.sellThroughPct >= 100 ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            Depleted
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            On Track
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {!isSubbed && t.remainingUnits > 0 && (
                          <button
                            onClick={() => {
                              setRebalanceTarget({
                                product: prod,
                                tracking: t,
                              });
                            }}
                            className={`px-3 py-1.5 rounded-xl font-bold text-[11px] transition-all cursor-pointer inline-flex items-center gap-1 ${
                              t.isUnderperforming
                                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            <ArrowLeftRight className="w-3 h-3" />
                            <span>Replace SKU</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Live Attributed Sales Feed */}
      {activeTrackerTab === 'sales' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              Live Attributed Transactions
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Every completed POS and Hub sale matching the campaign portfolio, updating capital recovery in real-time.
            </p>
          </div>

          {progress.attributedSales.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No sales recorded for this portfolio since campaign start ({new Date(currentCampaign.startedAt).toLocaleDateString()}).
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Date / Time</th>
                    <th className="py-2.5 px-3">Invoice #</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Product Sold</th>
                    <th className="py-2.5 px-3">Qty</th>
                    <th className="py-2.5 px-3">Revenue</th>
                    <th className="py-2.5 px-3">COGS Recovered</th>
                    <th className="py-2.5 px-4 text-right">Realized Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {progress.attributedSales.map((s, idx) => (
                    <tr key={`${s.saleId}-${s.productId}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px]">
                        {new Date(s.saleDate).toLocaleDateString()} {new Date(s.saleDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">
                        {s.invoiceNo}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                        {s.customerName}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                        {s.productName}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-emerald-600">
                        {s.quantity}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">
                        {cs}{s.totalRevenue.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-600 dark:text-slate-300">
                        {cs}{s.totalCogs.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right font-black text-teal-600 dark:text-teal-400">
                        {cs}{s.realizedProfit.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Milestone Schedule & Settlements */}
      {activeTrackerTab === 'milestones' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              Investor Milestone Schedule & Settlements
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Scheduled milestone dues, settlement statuses, and payment disbursement logs.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">Milestone</th>
                  <th className="py-3 px-3">Due Date</th>
                  <th className="py-3 px-3">Principal Due</th>
                  <th className="py-3 px-3">Yield Due</th>
                  <th className="py-3 px-3">Total Payout</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {currentCampaign.milestones.map((m) => {
                  const isSettled = m.status === 'settled';

                  return (
                    <tr key={m.periodIndex} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                        {m.periodLabel}
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                        {new Date(m.dueDate).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-700 dark:text-slate-300">
                        {cs}{m.principalDue.toLocaleString()}
                      </td>
                      <td className="py-3 px-3 font-bold text-indigo-600 dark:text-indigo-400">
                        {cs}{m.returnDue.toLocaleString()}
                      </td>
                      <td className="py-3 px-3 font-black text-slate-900 dark:text-white">
                        {cs}{m.totalDue.toLocaleString()}
                      </td>
                      <td className="py-3 px-3">
                        {isSettled ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 w-fit">
                            <Check className="w-3 h-3" /> Settled
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800 w-fit">
                            Pending Due
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {!isSettled ? (
                          <button
                            onClick={() => setSettlingPeriodIndex(m.periodIndex)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] rounded-xl shadow-xs transition-all cursor-pointer"
                          >
                            Disburse & Settle
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {m.settledAt ? new Date(m.settledAt).toLocaleDateString() : 'Paid'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Substitution History */}
      {activeTrackerTab === 'history' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              Mid-Flight SKU Substitution Audit Trail
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Historical record of slow SKUs substituted with fast-moving alternatives to protect campaign ROI.
            </p>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {currentCampaign.substitutionHistory.map((sub) => (
              <div key={sub.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-400 text-[10px]">
                      {new Date(sub.substitutedAt).toLocaleDateString()}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      {sub.reason.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 font-bold text-slate-900 dark:text-white">
                    <span className="line-through text-slate-400">{sub.outgoingProductName}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400">{sub.incomingProductName} ({sub.incomingTargetQty} units)</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-right">
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Capital Freed</div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      {cs}{sub.outgoingCapitalFreed.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Projected Profit Boost</div>
                    <div className="font-black text-emerald-600 dark:text-emerald-400">
                      +{cs}{sub.projectedAdditionalProfit.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rebalance Modal */}
      {rebalanceTarget && (
        <CampaignRebalanceModal
          isOpen={true}
          onClose={() => setRebalanceTarget(null)}
          campaign={currentCampaign}
          flaggedProduct={rebalanceTarget.product}
          tracking={rebalanceTarget.tracking}
          recommendedCandidates={
            progress.replacementRecommendations[rebalanceTarget.product.productId] || []
          }
          allProducts={products}
          onConfirmSubstitution={handleConfirmSubstitution}
          currencySymbol={cs}
        />
      )}

      {/* Settle Milestone Confirmation Prompt */}
      {settlingPeriodIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="text-base font-black text-slate-900 dark:text-white">
              Confirm Milestone Disbursement
            </h3>
            <p className="text-xs text-slate-500">
              Record that milestone payout #{settlingPeriodIndex} has been transferred/paid to the investor.
            </p>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                Settlement Note / Reference
              </label>
              <input
                type="text"
                placeholder="e.g. Bank Transfer Ref: GTB-492034"
                value={settlementNote}
                onChange={(e) => setSettlementNote(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setSettlingPeriodIndex(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmSettlement(settlingPeriodIndex)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                Confirm Settlement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
