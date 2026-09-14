import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  DollarSign,
  Calendar,
  Percent,
  Clock,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Package,
  Layers,
  ChevronDown,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Bookmark,
  BookmarkCheck,
  Plus,
  Minus,
  Trash2,
  Info,
  Building,
  BarChart3,
  HelpCircle,
  ArrowLeftRight,
  SlidersHorizontal,
  Link2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { useApp } from '../../context/AppContext';
import {
  AllocatedProduct,
  AllocationStrategy,
  PayoutFrequency,
  RepaymentStructure,
  ReturnModel,
  SavedSimulation,
} from '../../types/investment';
import { simulateInvestment, calculateSalesVelocity } from '../../utils/investmentEngine';
import { InvestorProposalModal } from '../modals/InvestorProposalModal';
import { SwapProductModal } from '../modals/SwapProductModal';

export const InvestmentPlannerView: React.FC = () => {
  const { products, sales, settings } = useApp();
  const cs = settings.currencySymbol || '₦';

  // --- Input Parameters State ---
  const [investmentAmount, setInvestmentAmount] = useState<number>(5000000);
  const [tenureMonths, setTenureMonths] = useState<number>(6);
  const [payoutFrequency, setPayoutFrequency] = useState<PayoutFrequency>('monthly');
  const [returnModel, setReturnModel] = useState<ReturnModel>('fixed_yield');
  const [repaymentStructure, setRepaymentStructure] = useState<RepaymentStructure>('bullet_maturity');
  const [yieldRate, setYieldRate] = useState<number>(3.0); // e.g. 3% monthly
  const [strategy, setStrategy] = useState<AllocationStrategy>('balanced');
  const [showComparison, setShowComparison] = useState<boolean>(false);
  const [customQuantities, setCustomQuantities] = useState<Record<string, number>>({});
  const [isProposalModalOpen, setIsProposalModalOpen] = useState<boolean>(false);

  // --- Sales Velocity Lookback Period State ---
  const [lookbackDays, setLookbackDays] = useState<number>(60);
  const [syncLookbackWithTenure, setSyncLookbackWithTenure] = useState<boolean>(false);

  // --- Product Swap Modal State ---
  const [swapModalTarget, setSwapModalTarget] = useState<AllocatedProduct | null>(null);
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState<boolean>(false);

  // Saved scenarios in localStorage
  const [savedScenarios, setSavedScenarios] = useState<SavedSimulation[]>(() => {
    try {
      const stored = localStorage.getItem('idofera_saved_investment_scenarios');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [scenarioNameInput, setScenarioNameInput] = useState<string>('');
  const [isSavingScenario, setIsSavingScenario] = useState<boolean>(false);

  // Quick capital presets
  const capitalPresets = [1000000, 2500000, 5000000, 10000000, 20000000];

  // Lookback selector presets
  const lookbackOptions = [
    { label: '14 Days', value: 14, desc: 'Hot spikes & short-term demand' },
    { label: '30 Days', value: 30, desc: '1-Month run-rate' },
    { label: '60 Days', value: 60, desc: 'Standard 2-Month baseline (Default)' },
    { label: '90 Days', value: 90, desc: 'Quarterly average' },
    { label: '180 Days', value: 180, desc: 'Semi-annual consistency' },
    { label: 'All Time', value: 0, desc: 'Entire historical sales transactions' },
  ];

  // Auto-Sync Lookback with Tenure when toggle is active
  useEffect(() => {
    if (!syncLookbackWithTenure) return;
    if (tenureMonths <= 1) {
      setLookbackDays(30);
    } else if (tenureMonths <= 2) {
      setLookbackDays(60);
    } else if (tenureMonths <= 3) {
      setLookbackDays(90);
    } else if (tenureMonths <= 6) {
      setLookbackDays(180);
    } else {
      setLookbackDays(0); // All time
    }
  }, [tenureMonths, syncLookbackWithTenure]);

  // Adjust default yield rates when model changes
  const handleModelChange = (newModel: ReturnModel) => {
    setReturnModel(newModel);
    if (newModel === 'fixed_yield' && yieldRate > 10) {
      setYieldRate(3.0);
    } else if (newModel === 'flat_roi' && yieldRate < 10) {
      setYieldRate(18.0);
    } else if (newModel === 'profit_share' && yieldRate < 10) {
      setYieldRate(25.0);
    }
  };

  // Precompute sales velocity map for the current lookback setting
  const { velocityMap: currentVelocityMap } = useMemo(() => {
    return calculateSalesVelocity(sales, products, lookbackDays);
  }, [sales, products, lookbackDays]);

  // Run the mathematical simulation
  const simulation = useMemo(() => {
    return simulateInvestment(products, sales, {
      investmentAmount,
      tenureMonths,
      payoutFrequency,
      returnModel,
      repaymentStructure,
      yieldRate,
      strategy,
      customProductAllocations: Object.keys(customQuantities).length > 0 ? customQuantities : undefined,
      lookbackDays,
    });
  }, [
    products,
    sales,
    investmentAmount,
    tenureMonths,
    payoutFrequency,
    returnModel,
    repaymentStructure,
    yieldRate,
    strategy,
    customQuantities,
    lookbackDays,
  ]);

  // Adjust product quantity manually
  const handleQuantityStep = (productId: string, step: number) => {
    setCustomQuantities((prev) => {
      // If prev is empty, initialize from current simulation allocations
      const baseMap =
        Object.keys(prev).length > 0
          ? { ...prev }
          : simulation.allocatedProducts.reduce((acc, p) => {
              acc[p.productId] = p.recommendedQty;
              return acc;
            }, {} as Record<string, number>);

      const currentQty =
        baseMap[productId] !== undefined
          ? baseMap[productId]
          : simulation.allocatedProducts.find((p) => p.productId === productId)?.recommendedQty || 0;
      const nextQty = Math.max(0, currentQty + step);
      return { ...baseMap, [productId]: nextQty };
    });
  };

  // Swap an existing product or add a new one
  const handleConfirmSwap = (oldProductId: string | null, newProductId: string, newUnits: number) => {
    setCustomQuantities((prev) => {
      // Pre-fill existing auto-allocated quantities so other items are not lost
      const baseMap =
        Object.keys(prev).length > 0
          ? { ...prev }
          : simulation.allocatedProducts.reduce((acc, p) => {
              acc[p.productId] = p.recommendedQty;
              return acc;
            }, {} as Record<string, number>);

      if (oldProductId) {
        delete baseMap[oldProductId];
      }
      baseMap[newProductId] = newUnits;
      return { ...baseMap };
    });
    setSwapModalTarget(null);
    setIsAddProductModalOpen(false);
  };

  // Remove a product from the portfolio
  const handleRemoveProduct = (productId: string) => {
    setCustomQuantities((prev) => {
      const baseMap =
        Object.keys(prev).length > 0
          ? { ...prev }
          : simulation.allocatedProducts.reduce((acc, p) => {
              acc[p.productId] = p.recommendedQty;
              return acc;
            }, {} as Record<string, number>);

      delete baseMap[productId];
      return { ...baseMap };
    });
  };

  // Automatically deploy remaining unallocated budget
  const handleRedistributeUnallocated = () => {
    if (simulation.unallocatedCapital <= 0) return;
    setCustomQuantities((prev) => {
      const baseMap =
        Object.keys(prev).length > 0
          ? { ...prev }
          : simulation.allocatedProducts.reduce((acc, p) => {
              acc[p.productId] = p.recommendedQty;
              return acc;
            }, {} as Record<string, number>);

      let extra = simulation.unallocatedCapital;
      const items = simulation.allocatedProducts;
      if (items.length === 0) return prev;

      for (const item of items) {
        if (extra < item.costPrice) break;
        const addQty = Math.floor(extra / items.length / item.costPrice);
        if (addQty > 0) {
          baseMap[item.productId] = (baseMap[item.productId] || item.recommendedQty) + addQty;
          extra -= addQty * item.costPrice;
        }
      }
      return { ...baseMap };
    });
  };

  const handleResetAllocations = () => {
    setCustomQuantities({});
  };

  // Save current scenario
  const handleSaveScenario = () => {
    if (!scenarioNameInput.trim()) return;
    const newScenario: SavedSimulation = {
      id: `scen_${Date.now()}`,
      name: scenarioNameInput.trim(),
      createdAt: new Date().toISOString(),
      investmentAmount,
      tenureMonths,
      payoutFrequency,
      returnModel,
      repaymentStructure,
      yieldRate,
      strategy,
      lookbackDays,
    };
    const updated = [newScenario, ...savedScenarios];
    setSavedScenarios(updated);
    try {
      localStorage.setItem('idofera_saved_investment_scenarios', JSON.stringify(updated));
    } catch {}
    setScenarioNameInput('');
    setIsSavingScenario(false);
  };

  const handleLoadScenario = (scen: SavedSimulation) => {
    setInvestmentAmount(scen.investmentAmount);
    setTenureMonths(scen.tenureMonths);
    setPayoutFrequency(scen.payoutFrequency);
    setReturnModel(scen.returnModel);
    setRepaymentStructure(scen.repaymentStructure);
    setYieldRate(scen.yieldRate);
    setStrategy(scen.strategy);
    if (scen.lookbackDays !== undefined) {
      setLookbackDays(scen.lookbackDays);
    }
    setCustomQuantities({});
  };

  const handleDeleteScenario = (id: string) => {
    const updated = savedScenarios.filter((s) => s.id !== id);
    setSavedScenarios(updated);
    try {
      localStorage.setItem('idofera_saved_investment_scenarios', JSON.stringify(updated));
    } catch {}
  };

  // Prepare chart data for cash flow projection
  const chartData = useMemo(() => {
    return simulation.schedule.map((item) => ({
      name: item.periodLabel,
      'Projected Cash Inflow': item.projectedCashInflow,
      'Investor Payout': item.totalPayout,
      'Retained Cash Surplus': Math.max(0, item.projectedRetainedSurplus),
    }));
  }, [simulation.schedule]);

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="p-3 bg-gradient-to-br from-emerald-500/10 to-teal-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-2xl shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Capital Investment & Inventory Planner
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Data-Backed Simulator
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Simulate capital injections, allocate funds across fast-turnover stock, project investor payout milestones, and produce executive term sheets.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Save scenario trigger */}
            {!isSavingScenario ? (
              <button
                onClick={() => setIsSavingScenario(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition-all cursor-pointer"
              >
                <Bookmark className="w-3.5 h-3.5 text-slate-500" />
                <span>Save Scenario</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-300 dark:border-slate-700">
                <input
                  type="text"
                  placeholder="Scenario name (e.g. 5M Growth)..."
                  value={scenarioNameInput}
                  onChange={(e) => setScenarioNameInput(e.target.value)}
                  className="px-2 py-1 text-xs bg-transparent focus:outline-none text-slate-900 dark:text-white w-44"
                  autoFocus
                />
                <button
                  onClick={handleSaveScenario}
                  disabled={!scenarioNameInput.trim()}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 cursor-pointer"
                >
                  Save
                </button>
                <button
                  onClick={() => setIsSavingScenario(false)}
                  className="px-2 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-xs"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Saved Scenarios Picker */}
            {savedScenarios.length > 0 && (
              <div className="relative group">
                <button className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition-all cursor-pointer">
                  <BookmarkCheck className="w-3.5 h-3.5 text-blue-500" />
                  <span>Saved ({savedScenarios.length})</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>
                <div className="absolute right-0 top-full mt-1.5 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-2 hidden group-hover:block z-30 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1">
                    Load Saved Scenario
                  </div>
                  {savedScenarios.map((scen) => (
                    <div
                      key={scen.id}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/60 text-xs"
                    >
                      <button
                        onClick={() => handleLoadScenario(scen)}
                        className="text-left flex-1 font-medium text-slate-800 dark:text-slate-200 hover:text-blue-600 truncate"
                      >
                        <div className="truncate">{scen.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {cs}{scen.investmentAmount.toLocaleString()} • {scen.tenureMonths}mo
                        </div>
                      </button>
                      <button
                        onClick={() => handleDeleteScenario(scen.id)}
                        className="text-slate-400 hover:text-rose-500 p-1"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Export Proposal Button */}
            <button
              onClick={() => setIsProposalModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>Generate Investor Proposal</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Control Panel (Left/Top) & KPI Summary (Right/Top) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Interactive Input Panel */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              Simulation Parameters
            </h2>
            <span className="text-[11px] text-slate-400">Step 1: Configure terms</span>
          </div>

          {/* Investment Capital Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Target Investment Capital
              </label>
              <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                {cs}{investmentAmount.toLocaleString()}
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                {cs}
              </span>
              <input
                type="number"
                min={50000}
                step={50000}
                value={investmentAmount}
                onChange={(e) => setInvestmentAmount(Math.max(0, Number(e.target.value)))}
                className="w-full pl-8 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {/* Preset quick buttons */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {capitalPresets.map((val) => (
                <button
                  key={val}
                  onClick={() => setInvestmentAmount(val)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    investmentAmount === val
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {cs}{(val / 1000000).toFixed(val % 1000000 === 0 ? 0 : 1)}M
                </button>
              ))}
            </div>
          </div>

          {/* Tenure & Frequency in 2 Columns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Tenure Duration */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Tenure Duration</span>
                </label>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {tenureMonths} Months
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {[1, 2, 3, 6, 9, 12].map((m) => (
                  <button
                    key={m}
                    onClick={() => setTenureMonths(m)}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer text-center ${
                      tenureMonths === m
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            {/* Payout Frequency */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Payout Frequency</span>
              </label>
              <div className="grid grid-cols-3 gap-1">
                <button
                  onClick={() => setPayoutFrequency('monthly')}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                    payoutFrequency === 'monthly'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setPayoutFrequency('bi_monthly')}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                    payoutFrequency === 'bi_monthly'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  Bi-Monthly
                </button>
                <button
                  onClick={() => setPayoutFrequency('end_of_tenure')}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                    payoutFrequency === 'end_of_tenure'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  At Maturity
                </button>
              </div>
            </div>
          </div>

          {/* Investor Return Model (All 3 Options) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Percent className="w-3.5 h-3.5 text-slate-400" />
                <span>Investor Return Model</span>
              </label>
              <button
                onClick={() => setShowComparison(!showComparison)}
                className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span>{showComparison ? 'Hide Comparison' : 'Compare All Models'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                onClick={() => handleModelChange('fixed_yield')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  returnModel === 'fixed_yield'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 ring-1 ring-blue-500/30'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="font-bold text-xs text-slate-900 dark:text-white">
                  Fixed Monthly Yield
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Consistent % paid per month
                </div>
              </button>

              <button
                onClick={() => handleModelChange('flat_roi')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  returnModel === 'flat_roi'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 ring-1 ring-blue-500/30'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="font-bold text-xs text-slate-900 dark:text-white">
                  Flat Tenure ROI
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Fixed % across whole tenure
                </div>
              </button>

              <button
                onClick={() => handleModelChange('profit_share')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  returnModel === 'profit_share'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 ring-1 ring-blue-500/30'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="font-bold text-xs text-slate-900 dark:text-white">
                  Gross Profit Share
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  % of actual profit generated
                </div>
              </button>
            </div>

            {/* Dynamic Yield Rate Slider */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2 mt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {returnModel === 'fixed_yield' && 'Monthly Yield Rate (%):'}
                  {returnModel === 'flat_roi' && 'Flat Tenure ROI (%):'}
                  {returnModel === 'profit_share' && 'Investor Share of Gross Profit (%):'}
                </span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400 text-sm">
                  {yieldRate}%
                </span>
              </div>
              <input
                type="range"
                min={returnModel === 'fixed_yield' ? 1 : 5}
                max={returnModel === 'fixed_yield' ? 10 : 50}
                step={0.5}
                value={yieldRate}
                onChange={(e) => setYieldRate(Number(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>{returnModel === 'fixed_yield' ? '1%' : '5%'}</span>
                <span>
                  {returnModel === 'fixed_yield'
                    ? `Total Tenure Return: ${(yieldRate * tenureMonths).toFixed(1)}%`
                    : returnModel === 'flat_roi'
                    ? `Annualized: ${((yieldRate / tenureMonths) * 12).toFixed(1)}%/yr`
                    : 'Calculated from batch turnover'}
                </span>
                <span>{returnModel === 'fixed_yield' ? '10%' : '50%'}</span>
              </div>
            </div>
          </div>

          {/* Repayment Structure & Stock Strategy in 2 Columns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Repayment Structure */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Principal Repayment Framework
              </label>
              <select
                value={repaymentStructure}
                onChange={(e) => setRepaymentStructure(e.target.value as RepaymentStructure)}
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="bullet_maturity">Bullet (100% Principal at Final Month)</option>
                <option value="amortized_installments">Amortized (Equal Principal Installments)</option>
                <option value="lump_sum_end">Lump Sum at End (All Principal + Return at End)</option>
              </select>
              <p className="text-[10px] text-slate-400">
                {repaymentStructure === 'bullet_maturity' && 'Pay periodic yield, return capital when stock is fully sold.'}
                {repaymentStructure === 'amortized_installments' && 'Pay back principal gradually alongside profit distributions.'}
                {repaymentStructure === 'lump_sum_end' && 'Zero payouts until the final day of tenure.'}
              </p>
            </div>

            {/* Stock Allocation Strategy */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Stock Allocation Strategy
              </label>
              <select
                value={strategy}
                onChange={(e) => {
                  setStrategy(e.target.value as AllocationStrategy);
                  setCustomQuantities({});
                }}
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="balanced">Balanced Optimal (Velocity × Margin)</option>
                <option value="fast_turnover">Fastest Turnover (Rapid Liquidation)</option>
                <option value="max_profit">Maximum Gross Profit (Highest Margin %)</option>
              </select>
              <p className="text-[10px] text-slate-400">
                {strategy === 'balanced' && 'Best overall risk-adjusted return and healthy turnover.'}
                {strategy === 'fast_turnover' && 'Minimizes capital lockup by selecting items that sell in < 25 days.'}
                {strategy === 'max_profit' && 'Maximizes profit shillings for items with high gross margins.'}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Real-time Executive Financial Metrics Card */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-5 sm:p-6 shadow-md border border-slate-800 space-y-5 flex-1">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Projected Financial Outcomes
                </h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  simulation.coverageRating === 'Safe'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : simulation.coverageRating === 'Healthy'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}
              >
                {simulation.coverageRatio}x Inflow Cover ({simulation.coverageRating})
              </span>
            </div>

            {/* Big Numbers Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-[11px] text-slate-400 font-medium">
                  Total Investor Payout
                </span>
                <div className="text-xl font-black text-blue-400">
                  {cs}{simulation.totalInvestorPayout.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-400">
                  Principal: {cs}{simulation.investmentAmount.toLocaleString()}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] text-slate-400 font-medium">
                  Investor Pure Yield
                </span>
                <div className="text-xl font-black text-emerald-400">
                  +{cs}{simulation.totalInvestorReturn.toLocaleString()}
                </div>
                <div className="text-[10px] text-emerald-400/80">
                  {((simulation.totalInvestorReturn / simulation.investmentAmount) * 100).toFixed(1)}% tenure yield
                </div>
              </div>
            </div>

            {/* Business Retained & Sales Inflows */}
            <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">Projected Batch Sales Revenue:</span>
                <span className="font-bold text-white font-mono">
                  {cs}{simulation.projectedGrossRevenue.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">Projected Gross Profit:</span>
                <span className="font-bold text-emerald-400 font-mono">
                  +{cs}{simulation.projectedGrossProfit.toLocaleString()}
                </span>
              </div>
              <div className="border-t border-slate-700 pt-2 flex items-center justify-between text-xs">
                <span className="text-slate-200 font-bold">Net Retained Profit for Biz:</span>
                <span className="font-black text-emerald-300 font-mono text-sm">
                  {cs}{simulation.netBusinessProfit.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Capital Allocation Progress Bar */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-400 text-[11px]">
                <span>Allocated to Stock:</span>
                <span className="text-slate-200 font-medium">
                  {cs}{simulation.totalAllocatedCapital.toLocaleString()} / {cs}{simulation.investmentAmount.toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (simulation.totalAllocatedCapital / simulation.investmentAmount) * 100)}%`,
                  }}
                />
              </div>
              {simulation.unallocatedCapital > 0 && (
                <div className="text-[10px] text-amber-400 flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  <span>{cs}{simulation.unallocatedCapital.toLocaleString()} remaining to be deployed</span>
                </div>
              )}
            </div>

            {/* Quick Periodic Repayment Summary */}
            <div className="text-xs text-slate-400 border-t border-slate-800 pt-3 flex items-center justify-between">
              <span>
                {payoutFrequency === 'monthly' && `${tenureMonths} Monthly Payouts:`}
                {payoutFrequency === 'bi_monthly' && `${Math.ceil(tenureMonths / 2)} Bi-monthly Payouts:`}
                {payoutFrequency === 'end_of_tenure' && 'Single Payout at Maturity:'}
              </span>
              <span className="text-slate-200 font-bold">
                {repaymentStructure === 'amortized_installments' && payoutFrequency !== 'end_of_tenure'
                  ? `~${cs}${Math.round(simulation.totalInvestorPayout / simulation.schedule.length).toLocaleString()} / period`
                  : repaymentStructure === 'bullet_maturity' && payoutFrequency !== 'end_of_tenure'
                  ? `~${cs}${Math.round(simulation.totalInvestorReturn / simulation.schedule.length).toLocaleString()} yield/mo + Principal at end`
                  : `${cs}${simulation.totalInvestorPayout.toLocaleString()} at end`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-Side Model Comparison (Toggleable) */}
      {showComparison && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                Side-by-Side Return Structure Comparison
              </h3>
              <p className="text-xs text-slate-500">
                Evaluate all 3 models against your target investment of {cs}{investmentAmount.toLocaleString()} over {tenureMonths} months.
              </p>
            </div>
            <button
              onClick={() => setShowComparison(false)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {simulation.comparison.map((comp) => {
              const isSelected = returnModel === comp.model;
              return (
                <div
                  key={comp.model}
                  className={`p-4 rounded-xl border transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/30 ring-1 ring-blue-500/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-xs text-slate-900 dark:text-white">
                      {comp.label}
                    </span>
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mb-3">{comp.description}</p>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Investor Total Return:</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        +{cs}{comp.investorTotalReturn.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Effective Tenure Yield:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                        {comp.investorEffectiveROI}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Biz Retained Profit:</span>
                      <span className="font-bold text-blue-600 dark:text-blue-400 font-mono">
                        {cs}{comp.businessRetainedProfit.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Inflow Cover Factor:</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {comp.coverageRatio}x ({comp.coverageRating})
                      </span>
                    </div>
                  </div>

                  {!isSelected && (
                    <button
                      onClick={() => handleModelChange(comp.model)}
                      className="mt-3 w-full py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                    >
                      Select This Model
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommended Products Allocation Basket */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        {/* Basket Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-500" />
              <span>Recommended High-Turnover Inventory Basket</span>
            </h2>
            <p className="text-xs text-slate-500">
              Grounded in historical sales velocity over the past{' '}
              <strong className="text-slate-700 dark:text-slate-300">
                {simulation.lookbackDays > 0 ? `${simulation.lookbackDays} days` : 'all-time history'}
              </strong>{' '}
              ({simulation.salesAnalyzedCount ?? sales.length} orders analyzed). Optimized for rapid turnover and healthy profit margins.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsAddProductModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Product</span>
            </button>

            {Object.keys(customQuantities).length > 0 && (
              <button
                onClick={handleResetAllocations}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl cursor-pointer transition-colors"
                title="Revert manual changes and restore algorithmic allocation"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset to AI Allocation</span>
              </button>
            )}

            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl">
              {simulation.allocatedProducts.length} SKUs
            </span>
          </div>
        </div>

        {/* Days Selector & Velocity Lookback Toolbar */}
        <div className="bg-slate-50 dark:bg-slate-800/60 p-3 sm:p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/60 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 mr-1">
              <SlidersHorizontal className="w-3.5 h-3.5 text-blue-500" />
              <span>Sales Velocity Window:</span>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
              {lookbackOptions.map((opt) => {
                const isCurrent = lookbackDays === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setLookbackDays(opt.value);
                      setSyncLookbackWithTenure(false);
                    }}
                    title={opt.desc}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      isCurrent
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/60 dark:border-slate-600/40'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Auto-Match Lookback to Tenure Toggle */}
          <div className="flex items-center gap-2 pt-1 md:pt-0 border-t md:border-t-0 border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setSyncLookbackWithTenure(!syncLookbackWithTenure)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                syncLookbackWithTenure
                  ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
              }`}
              title="Automatically calibrate sales lookback period to the investment tenure duration"
            >
              <Link2 className="w-3 h-3 text-emerald-500" />
              <span>Auto-Match to Tenure</span>
              {syncLookbackWithTenure && (
                <span className="text-[10px] px-1 py-0.2 bg-emerald-600 text-white rounded font-mono font-bold">
                  ON
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Unallocated Budget Alert with Quick Redistribute Action */}
        {simulation.unallocatedCapital > 0 && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-medium">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                <strong>{cs}{simulation.unallocatedCapital.toLocaleString()}</strong> unallocated capital remaining from the total {cs}{investmentAmount.toLocaleString()} investment budget.
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleRedistributeUnallocated}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-xs cursor-pointer transition-colors whitespace-nowrap"
              >
                Top-Up Active SKUs
              </button>
              <button
                onClick={() => setIsAddProductModalOpen(true)}
                className="px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold text-xs cursor-pointer transition-colors whitespace-nowrap"
              >
                Pick Another SKU
              </button>
            </div>
          </div>
        )}

        {/* Product Table */}
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-3">Product Name & SKU</th>
                <th className="py-3 px-3">Unit Cost</th>
                <th className="py-3 px-3">Retail Price</th>
                <th className="py-3 px-3">Margin %</th>
                <th className="py-3 px-3">
                  Daily Velocity
                  <span className="text-[10px] text-slate-400 block font-normal">
                    ({simulation.lookbackDays > 0 ? `${simulation.lookbackDays}d window` : 'All-time'})
                  </span>
                </th>
                <th className="py-3 px-3 text-center">Allocated Units</th>
                <th className="py-3 px-3 text-right">Budget Allocated</th>
                <th className="py-3 px-3 text-right">Liquidation Time</th>
                <th className="py-3 px-3 text-right">Projected Profit</th>
                <th className="py-3 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {simulation.allocatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400">
                    <div className="space-y-2">
                      <Package className="w-8 h-8 mx-auto text-slate-300" />
                      <p className="text-xs">No products currently allocated in this investment basket.</p>
                      <button
                        onClick={handleResetAllocations}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold"
                      >
                        Restore AI Auto-Allocation
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                simulation.allocatedProducts.map((item) => (
                  <tr key={item.productId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {item.productName}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {item.sku} • {item.category}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300 font-mono">
                      {cs}{item.costPrice.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300 font-mono">
                      {cs}{item.retailPrice.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
                      {item.marginPct}%
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {item.dailyVelocity}
                      </span>{' '}
                      <span className="text-[10px] text-slate-400">units/day</span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
                        <button
                          onClick={() => handleQuantityStep(item.productId, -10)}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300"
                          title="Reduce 10 units"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="px-2 font-mono font-bold text-slate-900 dark:text-white min-w-[3rem] text-center">
                          {item.recommendedQty}
                        </span>
                        <button
                          onClick={() => handleQuantityStep(item.productId, 10)}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300"
                          title="Add 10 units"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-white font-mono">
                      {cs}{item.allocatedCapital.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-500">
                      ~{item.runOutDays} days{' '}
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                        ({item.turnoverCycles}x turns)
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                      +{cs}{item.projectedGrossProfit.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setSwapModalTarget(item)}
                          className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 transition-colors cursor-pointer"
                          title="Swap with a higher-margin or faster-velocity alternative"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleRemoveProduct(item.productId)}
                          className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/60 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                          title="Remove product from this investment basket"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 dark:bg-slate-800/80 font-bold border-t border-slate-200 dark:border-slate-800 text-xs">
                <td colSpan={5} className="py-3 px-3 text-slate-800 dark:text-slate-200">
                  Total Inventory Deployment
                </td>
                <td className="py-3 px-3 text-center text-slate-900 dark:text-white">
                  {simulation.allocatedProducts.reduce((sum, p) => sum + p.recommendedQty, 0).toLocaleString()} units
                </td>
                <td className="py-3 px-3 text-right text-slate-900 dark:text-white font-mono">
                  {cs}{simulation.totalAllocatedCapital.toLocaleString()}
                </td>
                <td className="py-3 px-3 text-right text-slate-500 text-[10px]">
                  Revenue: {cs}{simulation.projectedGrossRevenue.toLocaleString()}
                </td>
                <td className="py-3 px-3 text-right text-emerald-600 dark:text-emerald-400 font-mono">
                  +{cs}{simulation.projectedGrossProfit.toLocaleString()}
                </td>
                <td className="py-3 px-3 text-center text-slate-400 text-[10px]">
                  {simulation.allocatedProducts.length} items
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Milestone Repayment & Cash-Flow Projection Schedule */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Milestone Table */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-500" />
                Scheduled Milestone Repayment Table
              </h3>
              <p className="text-xs text-slate-500">
                Calculated distribution amounts for the investor across the {tenureMonths}-month tenure.
              </p>
            </div>
            <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
              {simulation.schedule.length} Milestones
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2.5 px-3">Period</th>
                  <th className="py-2.5 px-3">Due Date</th>
                  <th className="py-2.5 px-3 text-right">Principal Repaid</th>
                  <th className="py-2.5 px-3 text-right">Profit Yield</th>
                  <th className="py-2.5 px-3 text-right">Total Outflow</th>
                  <th className="py-2.5 px-3 text-right">Cumulative Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {simulation.schedule.map((row) => (
                  <tr key={row.periodIndex} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                      {row.periodLabel}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">{row.dueDate}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {cs}{row.principalDue.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                      +{cs}{row.returnDue.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {cs}{row.totalPayout.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-500 text-[11px]">
                      {cs}{row.cumulativePayout.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 dark:bg-slate-800/80 font-bold border-t border-slate-200 dark:border-slate-800 text-xs">
                  <td colSpan={2} className="py-2.5 px-3 text-slate-800 dark:text-slate-200">
                    Total Investor Payout
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-900 dark:text-white">
                    {cs}{simulation.investmentAmount.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                    +{cs}{simulation.totalInvestorReturn.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-blue-600 dark:text-blue-400 font-black">
                    {cs}{simulation.totalInvestorPayout.toLocaleString()}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Right: Cash Flow Inflow vs Outflow Chart */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-500" />
              Cash Flow Inflows vs. Investor Obligations
            </h3>
            <p className="text-xs text-slate-500">
              Visualizes period sales liquidation against required repayment amounts.
            </p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(val) => `${cs}${(val / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip
                  formatter={(val: any) => [`${cs}${Number(val).toLocaleString()}`, '']}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar dataKey="Projected Cash Inflow" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Investor Payout" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Retained Cash Surplus" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Printable Investor Proposal Modal */}
      <InvestorProposalModal
        isOpen={isProposalModalOpen}
        onClose={() => setIsProposalModalOpen(false)}
        simulation={simulation}
      />

      {/* Product Substitution & Smart Alternative Modal */}
      <SwapProductModal
        isOpen={swapModalTarget !== null || isAddProductModalOpen}
        onClose={() => {
          setSwapModalTarget(null);
          setIsAddProductModalOpen(false);
        }}
        targetProduct={swapModalTarget}
        allProducts={products}
        currentAllocatedProducts={simulation.allocatedProducts}
        salesVelocityMap={currentVelocityMap}
        tenureMonths={tenureMonths}
        availableBudgetForSwap={
          swapModalTarget ? swapModalTarget.allocatedCapital : simulation.unallocatedCapital
        }
        onConfirmSwap={handleConfirmSwap}
        currencySymbol={cs}
      />
    </div>
  );
};
