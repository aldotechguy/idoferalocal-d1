import React, { useRef } from 'react';
import {
  X,
  Printer,
  TrendingUp,
  ShieldCheck,
  Calendar,
  Layers,
  ArrowRight,
  Package,
  Sparkles,
  Download,
  Building,
} from 'lucide-react';
import { InvestmentSimulationResult } from '../../types/investment';
import { useApp } from '../../context/AppContext';

interface InvestorProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  simulation: InvestmentSimulationResult;
}

export const InvestorProposalModal: React.FC<InvestorProposalModalProps> = ({
  isOpen,
  onClose,
  simulation,
}) => {
  const { settings } = useApp();
  const printRef = useRef<HTMLDivElement>(null);
  const cs = settings.currencySymbol || '₦';

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const proposalNumber = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const proposalDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const getReturnModelLabel = (model: string) => {
    switch (model) {
      case 'fixed_yield':
        return `Fixed Monthly Yield (${simulation.yieldRate}% / month)`;
      case 'flat_roi':
        return `Flat Maturity ROI (${simulation.yieldRate}% flat)`;
      case 'profit_share':
        return `Gross Profit Share (${simulation.yieldRate}% of gross profit)`;
      default:
        return model;
    }
  };

  const getRepaymentStructureLabel = (struct: string) => {
    switch (struct) {
      case 'bullet_maturity':
        return 'Bullet Repayment (100% Principal Returned at Final Month)';
      case 'amortized_installments':
        return 'Amortized (Equal Installments of Principal + Returns)';
      case 'lump_sum_end':
        return 'Lump Sum at Maturity (Principal & Returns Paid in Single Final Installment)';
      default:
        return struct;
    }
  };

  const getFrequencyLabel = (freq: string) => {
    switch (freq) {
      case 'monthly':
        return 'Monthly Distributions';
      case 'bi_monthly':
        return 'Bi-Monthly Distributions (Every 2 Months)';
      case 'end_of_tenure':
        return 'At Maturity (End of Tenure)';
      default:
        return freq;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden my-auto">
        {/* Modal Top Bar (Hidden in Print) */}
        <div className="print:hidden flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Investor Memorandum & Term Sheet
              </h2>
              <p className="text-[11px] text-slate-500">
                Official presentation document for external capital providers
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / Save PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Proposal Body */}
        <div ref={printRef} className="flex-1 overflow-y-auto p-6 sm:p-10 space-y-8 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 print:text-black print:bg-white print:p-0">
          {/* Header & Metadata */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 border-b border-slate-200 dark:border-slate-800 pb-6">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                CONFIDENTIAL CAPITAL PROPOSAL
              </div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                {settings.storeName || 'Idofera Packaging'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
                {settings.storeAddress || 'Commercial Wholesale & Retail Distribution Hub'}
              </p>
              {settings.storePhone && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tel: {settings.storePhone} {settings.storeEmail && `• Email: ${settings.storeEmail}`}
                </p>
              )}
            </div>

            <div className="sm:text-right space-y-1 text-xs text-slate-500 dark:text-slate-400">
              <div className="font-mono font-bold text-slate-800 dark:text-slate-200">
                Ref: {proposalNumber}
              </div>
              <div>Date: {proposalDate}</div>
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                Asset-Backed Inventory Financing
              </div>
            </div>
          </div>

          {/* Executive Summary Cards */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              1. Investment Summary & Core Terms
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block">
                  Capital Sought
                </span>
                <span className="text-base font-black text-slate-900 dark:text-white">
                  {cs}{simulation.investmentAmount.toLocaleString()}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block">
                  Tenure Duration
                </span>
                <span className="text-base font-black text-slate-900 dark:text-white">
                  {simulation.tenureMonths} Months
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block">
                  Projected Return (Yield)
                </span>
                <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                  +{cs}{simulation.totalInvestorReturn.toLocaleString()}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block">
                  Total Investor Payout
                </span>
                <span className="text-base font-black text-blue-600 dark:text-blue-400">
                  {cs}{simulation.totalInvestorPayout.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Term Details Box */}
            <div className="mt-3 p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-400">Return Structure:</span>{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {getReturnModelLabel(simulation.returnModel)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Repayment Framework:</span>{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {getRepaymentStructureLabel(simulation.repaymentStructure)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Payout Frequency:</span>{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {getFrequencyLabel(simulation.payoutFrequency)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Safety Coverage Factor:</span>{' '}
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {simulation.coverageRatio}x Inflow-to-Debt Cover ({simulation.coverageRating})
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Capital Deployment / Recommended Stock Basket */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  2. Capital Deployment Plan (Allocated High-Velocity Stock)
                </h3>
                <p className="text-[10px] text-slate-500">
                  Grounded in audited sales velocity over the past {simulation.lookbackDays > 0 ? `${simulation.lookbackDays} days` : 'all-time historical sales'}.
                </p>
              </div>
              <span className="text-[11px] text-slate-500">
                Total Allocated: {cs}{simulation.totalAllocatedCapital.toLocaleString()} ({((simulation.totalAllocatedCapital / simulation.investmentAmount) * 100).toFixed(0)}%)
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="py-2.5 px-3">Product / SKU</th>
                    <th className="py-2.5 px-3">Cost Price</th>
                    <th className="py-2.5 px-3">Selling Price</th>
                    <th className="py-2.5 px-3 text-center">Allocated Units</th>
                    <th className="py-2.5 px-3 text-right">Capital Allocated</th>
                    <th className="py-2.5 px-3 text-right">Est. Turnaround</th>
                    <th className="py-2.5 px-3 text-right">Projected Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {simulation.allocatedProducts.map((item) => (
                    <tr key={item.productId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {item.productName}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {item.sku} • {item.category}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                        {cs}{item.costPrice.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                        {cs}{item.retailPrice.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-slate-800 dark:text-slate-200">
                        {item.recommendedQty.toLocaleString()} units
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-slate-900 dark:text-white">
                        {cs}{item.allocatedCapital.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-500">
                        ~{item.runOutDays} days ({item.turnoverCycles}x in tenure)
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                        {cs}{item.projectedRevenue.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 font-bold border-t border-slate-200 dark:border-slate-800">
                    <td colSpan={4} className="py-2.5 px-3 text-slate-800 dark:text-slate-200">
                      Total Inventory Deployment
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-900 dark:text-white">
                      {cs}{simulation.totalAllocatedCapital.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-400 text-[10px]">
                      Gross Margin: {cs}{simulation.projectedGrossProfit.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400">
                      {cs}{simulation.projectedGrossRevenue.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Milestone Repayment Schedule */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              3. Milestone Repayment & Distribution Schedule
            </h3>
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="py-2 px-3">Milestone</th>
                    <th className="py-2 px-3">Scheduled Date</th>
                    <th className="py-2 px-3 text-right">Principal Return</th>
                    <th className="py-2 px-3 text-right">Yield / Return</th>
                    <th className="py-2 px-3 text-right">Total Payout</th>
                    <th className="py-2 px-3 text-right">Cumulative Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {simulation.schedule.map((row) => (
                    <tr key={row.periodIndex} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                        {row.periodLabel}
                      </td>
                      <td className="py-2 px-3 text-slate-500">{row.dueDate}</td>
                      <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-300">
                        {cs}{row.principalDue.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right text-emerald-600 dark:text-emerald-400 font-medium">
                        +{cs}{row.returnDue.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-900 dark:text-white">
                        {cs}{row.totalPayout.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-500 font-mono text-[11px]">
                        {cs}{row.cumulativePayout.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Risk Mitigation & Safeguards */}
          <div className="p-4 rounded-2xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 space-y-2">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-bold text-xs">
              <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Investment Safeguards & Risk Controls</span>
            </div>
            <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1 list-disc list-inside">
              <li>
                <strong>Physical Asset Backing:</strong> 100% of the invested capital is directly converted into verifiable, physical fast-moving inventory stored in our secured warehouse.
              </li>
              <li>
                <strong>High Turnover Velocity:</strong> Stock selected is constrained to proven historical sales run rates, preventing inventory stagnation.
              </li>
              <li>
                <strong>Diversified Basket:</strong> Capital is distributed across multiple distinct product lines rather than a single speculative SKU.
              </li>
              <li>
                <strong>Liquid Coverage:</strong> Scheduled repayments are comfortably covered by gross sales turnover with an inflow coverage factor of {simulation.coverageRatio}x.
              </li>
            </ul>
          </div>

          {/* Sign-off Section */}
          <div className="pt-6 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-8 text-xs">
            <div className="space-y-10">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                For the Business ({settings.storeName || 'Idofera Packaging'}):
              </div>
              <div className="border-b border-slate-300 dark:border-slate-700 pb-1">
                <span className="text-[10px] text-slate-400">Authorized Signature & Stamp</span>
              </div>
            </div>
            <div className="space-y-10">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                For the Investor / Capital Partner:
              </div>
              <div className="border-b border-slate-300 dark:border-slate-700 pb-1">
                <span className="text-[10px] text-slate-400">Accepted & Agreed Signature</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
