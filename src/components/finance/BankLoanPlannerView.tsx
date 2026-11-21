import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  DollarSign,
  Calendar,
  Percent,
  Clock,
  ShieldCheck,
  Sparkles,
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
  Play,
  Zap,
  CreditCard,
  Landmark,
  PieChart,
  Activity,
  Target,
  RefreshCw,
  Settings,
  Eye,
  Edit2,
  Copy,
  Download,
  Upload,
  Search,
  Filter,
  Flag,
  Bell,
  ArrowUpRight,
  ArrowDownRight,
  MinusCircle,
  PlusCircle,
  GripVertical,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
} from 'recharts';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import {
  LoanTranche,
  LoanType,
  InterestRateType,
  LoanRepaymentStructure,
  LoanRepaymentFrequency,
  StockAllocationStrategy,
  SavedLoanScenario,
  LoanSimulationResult,
  ActiveLoanCampaign,
  LoanMilestone,
  RiskMetrics,
  StockAllocation,
} from '../../types/loan';
import {
  simulateLoanInvestment,
  startLoanCampaignFromSimulation,
  calculateLoanCampaignLiveProgress,
  applyStockSubstitution,
  settleLoanCampaignMilestone,
  buildLoanAmortizationSchedule,
} from '../../utils/loanEngine';
import { Product, Sale } from '../../types';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];

export const BankLoanPlannerView: React.FC = () => {
  const { products, sales, settings } = useApp();
  const { isPrivacyMode } = useAuth();
  const cs = settings.currencySymbol || '₦';

  // --- Main View Mode (Simulator vs Live Tracker) ---
  const [activeMainTab, setActiveMainTab] = useState<'simulator' | 'tracker'>('simulator');

  // --- Loan Tranches State ---
  const [tranches, setTranches] = useState<LoanTranche[]>([
    {
      id: 'tranche_1',
      name: 'Tranche A - Term Loan',
      type: 'term_loan',
      principal: 5000000,
      interestRate: 18.0,
      interestRateType: 'fixed',
      tenureMonths: 12,
      repaymentStructure: 'amortized',
      repaymentFrequency: 'monthly',
      interestOnlyMonths: 0,
      originationFeeBps: 100,
      commitmentFeeBps: 0,
      covenantDscrMin: 1.25,
      covenantLtvMax: 0.8,
    },
  ]);

  // --- Stock Portfolio State ---
  const [stockStrategy, setStockStrategy] = useState<StockAllocationStrategy>('balanced');
  const [customStockQuantities, setCustomStockQuantities] = useState<Record<string, number>>({});
  const [lookbackDays, setLookbackDays] = useState<number>(60);

  // --- Simulation Results ---
  const [simulation, setSimulation] = useState<LoanSimulationResult | null>(null);
  const [showComparison, setShowComparison] = useState<boolean>(false);
  const [showRiskDetails, setShowRiskDetails] = useState<boolean>(false);
  const [selectedComparisonIndex, setSelectedComparisonIndex] = useState<number>(-1);

  // --- Saved Scenarios ---
  const [savedScenarios, setSavedScenarios] = useState<SavedLoanScenario[]>(() => {
    try {
      const stored = localStorage.getItem('idofera_bank_loan_scenarios');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [scenarioNameInput, setScenarioNameInput] = useState<string>('');
  const [isSavingScenario, setIsSavingScenario] = useState<boolean>(false);

  // --- Live Campaigns ---
  const [activeCampaigns, setActiveCampaigns] = useState<ActiveLoanCampaign[]>(() => {
    try {
      const stored = localStorage.getItem('idofera_bank_loan_campaigns');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [campaignProgress, setCampaignProgress] = useState<Record<string, ReturnType<typeof calculateLoanCampaignLiveProgress>>>({});

  // --- Modals ---
  const [isStartCampaignModalOpen, setIsStartCampaignModalOpen] = useState<boolean>(false);
  const [campaignModalData, setCampaignModalData] = useState<{
    simulation: LoanSimulationResult;
    scenarioName?: string;
    scenarioId?: string;
  } | null>(null);
  const [isSwapStockModalOpen, setIsSwapStockModalOpen] = useState<boolean>(false);
  const [swapModalData, setSwapModalData] = useState<{ outgoingId: string; outgoingName: string } | null>(null);
  const [isSettleMilestoneModalOpen, setIsSettleMilestoneModalOpen] = useState<boolean>(false);
  const [settleModalData, setSettleModalData] = useState<{ campaign: ActiveLoanCampaign; milestone: any } | null>(null);

  // --- Helpers ---
  const handleUpdateCampaign = (updated: ActiveLoanCampaign) => {
    setActiveCampaigns((prev) => {
      const next = prev.map((c) => (c.id === updated.id ? updated : c));
      try {
        localStorage.setItem('idofera_bank_loan_campaigns', JSON.stringify(next));
      } catch {}
      return next;
    });
    // Recalculate progress
    const progress = calculateLoanCampaignLiveProgress(updated, sales, products);
    setCampaignProgress((prev) => ({ ...prev, [updated.id]: progress }));
  };

  // --- Tranche Management ---
  const addTranche = () => {
    const newTranche: LoanTranche = {
      id: `tranche_${Date.now()}`,
      name: `Tranche ${String.fromCharCode(65 + tranches.length)}`,
      type: 'term_loan',
      principal: 1000000,
      interestRate: 18.0,
      interestRateType: 'fixed',
      tenureMonths: 12,
      repaymentStructure: 'amortized',
      repaymentFrequency: 'monthly',
      interestOnlyMonths: 0,
      originationFeeBps: 100,
      commitmentFeeBps: 0,
    };
    setTranches([...tranches, newTranche]);
  };

  const updateTranche = (id: string, updates: Partial<LoanTranche>) => {
    setTranches((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const removeTranche = (id: string) => {
    if (tranches.length <= 1) return;
    setTranches((prev) => prev.filter((t) => t.id !== id));
  };

  const duplicateTranche = (id: string) => {
    const tranche = tranches.find(t => t.id === id);
    if (!tranche) return;
    const newTranche: LoanTranche = {
      ...tranche,
      id: `tranche_${Date.now()}`,
      name: `${tranche.name} (Copy)`,
    };
    setTranches([...tranches, newTranche]);
  };

  // --- Run Simulation ---
  const runSimulation = useMemo(() => {
    if (tranches.length === 0) return null;
    return simulateLoanInvestment(products, sales, {
      tranches,
      stockStrategy,
      customStockAllocations: Object.keys(customStockQuantities).length > 0 ? customStockQuantities : undefined,
      lookbackDays,
    });
  }, [products, sales, tranches, stockStrategy, customStockQuantities, lookbackDays]);

  // Update simulation state when it changes
  useEffect(() => {
    if (runSimulation) {
      setSimulation(runSimulation);
    }
  }, [runSimulation]);

  // --- Stock Quantity Management ---
  const handleStockQuantityStep = (productId: string, step: number) => {
    setCustomStockQuantities((prev) => {
      const baseMap = Object.keys(prev).length > 0
        ? { ...prev }
        : (simulation?.stockAllocations.reduce((acc, a) => {
            acc[a.productId] = a.shares;
            return acc;
          }, {} as Record<string, number>) || {});

      const currentQty = baseMap[productId] || 0;
      const nextQty = Math.max(0, currentQty + step);
      return { ...baseMap, [productId]: nextQty };
    });
  };

  const handleConfirmStockSwap = (outgoingId: string, incomingProductId: string, newShares: number) => {
    setCustomStockQuantities((prev) => {
      const baseMap = Object.keys(prev).length > 0
        ? { ...prev }
        : (simulation?.stockAllocations.reduce((acc, a) => {
            acc[a.productId] = a.shares;
            return acc;
          }, {} as Record<string, number>) || {});

      delete baseMap[outgoingId];
      baseMap[incomingProductId] = newShares;
      return { ...baseMap };
    });
    setIsSwapStockModalOpen(false);
    setSwapModalData(null);
  };

  const handleRemoveStock = (productId: string) => {
    setCustomStockQuantities((prev) => {
      const baseMap = Object.keys(prev).length > 0
        ? { ...prev }
        : (simulation?.stockAllocations.reduce((acc, a) => {
            acc[a.productId] = a.shares;
            return acc;
          }, {} as Record<string, number>) || {});

      delete baseMap[productId];
      return { ...baseMap };
    });
  };

  const handleResetStockAllocations = () => {
    setCustomStockQuantities({});
  };

  // --- Scenario Management ---
  const handleSaveScenario = () => {
    if (!scenarioNameInput.trim() || !simulation) return;
    const newScenario: SavedLoanScenario = {
      id: `scen_${Date.now()}`,
      name: scenarioNameInput.trim(),
      createdAt: new Date().toISOString(),
      tranches: simulation.tranches,
      totalPrincipal: simulation.totalPrincipal,
      blendedRate: simulation.blendedAnnualRate,
      stockStrategy,
      lookbackDays,
      customStockAllocations: Object.keys(customStockQuantities).length > 0 ? customStockQuantities : undefined,
    };
    const updated = [newScenario, ...savedScenarios];
    setSavedScenarios(updated);
    try {
      localStorage.setItem('idofera_bank_loan_scenarios', JSON.stringify(updated));
    } catch {}
    setScenarioNameInput('');
    setIsSavingScenario(false);
  };

  const handleLoadScenario = (scen: SavedLoanScenario) => {
    setTranches(scen.tranches.map((t, i) => ({ ...t, id: `tranche_${Date.now()}_${i}` })));
    setStockStrategy(scen.stockStrategy);
    setLookbackDays(scen.lookbackDays);
    if (scen.customStockAllocations) {
      setCustomStockQuantities(scen.customStockAllocations);
    } else {
      setCustomStockQuantities({});
    }
  };

  const handleDeleteScenario = (id: string) => {
    const updated = savedScenarios.filter((s) => s.id !== id);
    setSavedScenarios(updated);
    try {
      localStorage.setItem('idofera_bank_loan_scenarios', JSON.stringify(updated));
    } catch {}
  };

  const handleStartCampaignFromScenario = (scen: SavedLoanScenario) => {
    const sim = simulateLoanInvestment(products, sales, {
      tranches: scen.tranches,
      stockStrategy: scen.stockStrategy,
      lookbackDays: scen.lookbackDays,
      customStockAllocations: scen.customStockAllocations,
    });
    setCampaignModalData({
      simulation: sim,
      scenarioName: scen.name,
      scenarioId: scen.id,
    });
    setIsStartCampaignModalOpen(true);
  };

  // --- Start Campaign ---
  const handleLaunchCampaign = (
    campaignName: string,
    borrowerName: string,
    lenderName: string,
    startDate: string
  ) => {
    const targetSim = campaignModalData?.simulation || simulation;
    if (!targetSim) return;

    const newCamp = startLoanCampaignFromSimulation(targetSim, campaignName, {
      borrowerName,
      lenderName,
      startDate,
      scenarioId: campaignModalData?.scenarioId,
    });

    const next = [newCamp, ...activeCampaigns];
    setActiveCampaigns(next);
    try {
      localStorage.setItem('idofera_bank_loan_campaigns', JSON.stringify(next));
    } catch {}

    // Calculate initial progress
    const progress = calculateLoanCampaignLiveProgress(newCamp, sales, products);
    setCampaignProgress((prev) => ({ ...prev, [newCamp.id]: progress }));

    setIsStartCampaignModalOpen(false);
    setCampaignModalData(null);
    setActiveMainTab('tracker');
  };

  // --- Swap Stock ---
  const handleOpenSwapModal = (outgoingId: string, outgoingName: string) => {
    setSwapModalData({ outgoingId, outgoingName });
    setIsSwapStockModalOpen(true);
  };

  // --- Settle Milestone ---
  const handleOpenSettleModal = (campaign: ActiveLoanCampaign, milestone: any) => {
    setSettleModalData({ campaign, milestone });
    setIsSettleMilestoneModalOpen(true);
  };

  const handleSettleMilestone = (paidAmount: number, paidFrom: 'dividends' | 'sales' | 'external', notes: string) => {
    if (!settleModalData) return;
    const updated = settleLoanCampaignMilestone(settleModalData.campaign, settleModalData.milestone.periodIndex, paidAmount, paidFrom, notes);
    handleUpdateCampaign(updated);
    setIsSettleMilestoneModalOpen(false);
    setSettleModalData(null);
  };

  // --- Campaign Actions ---
  const handleSubstituteStock = (campaignId: string, outgoingId: string, incomingProduct: Product, newShares: number, reason: any) => {
    const campaign = activeCampaigns.find(c => c.id === campaignId);
    if (!campaign) return;
    const updated = applyStockSubstitution(campaign, outgoingId, incomingProduct, newShares, reason);
    handleUpdateCampaign(updated);
  };

  const handleRefreshCampaignProgress = (campaignId: string) => {
    const campaign = activeCampaigns.find(c => c.id === campaignId);
    if (!campaign) return;
    const progress = calculateLoanCampaignLiveProgress(campaign, sales, products);
    setCampaignProgress((prev) => ({ ...prev, [campaignId]: progress }));
  };

  // --- Chart Data ---
  const cashFlowChartData = useMemo(() => {
    if (!simulation) return [];
    return simulation.schedule.map((item) => ({
      name: item.periodLabel,
      'Loan Payment': item.totalLoanPayment,
      'Portfolio Inflow': item.totalPortfolioCashInflow,
      'Net Cash Flow': item.netCashFlow,
      'Cumulative Net': item.cumulativeNetCashFlow,
    }));
  }, [simulation]);

  const portfolioAllocationData = useMemo(() => {
    if (!simulation) return [];
    return simulation.stockAllocations.map((a, i) => ({
      name: a.symbol,
      value: a.allocatedCapital,
      color: COLORS[i % COLORS.length],
      sector: a.sector,
      return: a.annualizedReturn,
    }));
  }, [simulation]);

  const riskMetricsData = useMemo(() => {
    if (!simulation) return [];
    const rm = simulation.riskMetrics;
    return [
      { metric: 'Avg DSCR', value: rm.averageDscr, rating: rm.dscrRating, threshold: 1.5 },
      { metric: 'Min DSCR', value: rm.minDscr, rating: rm.dscrRating, threshold: 1.25 },
      { metric: 'Initial LTV', value: rm.initialLtv * 100, rating: rm.ltvRating, threshold: 80 },
      { metric: 'Interest Coverage', value: rm.averageInterestCoverage, rating: rm.dscrRating, threshold: 2.0 },
      { metric: 'Max Position %', value: rm.maxSinglePositionPct, rating: 'N/A', threshold: 25 },
      { metric: 'HHI Index', value: rm.hhiIndex * 100, rating: 'N/A', threshold: 25 },
    ];
  }, [simulation]);

  const comparisonData = useMemo(() => {
    if (!simulation) return [];
    return simulation.comparison.map((c, i) => ({
      ...c,
      color: COLORS[i % COLORS.length],
    }));
  }, [simulation]);

  return (
    <div className="space-y-6">
      {/* Mode Switcher Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <button
          onClick={() => setActiveMainTab('simulator')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeMainTab === 'simulator'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Loan Simulator & Planner</span>
        </button>

        <button
          onClick={() => setActiveMainTab('tracker')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeMainTab === 'tracker'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>Live Campaign Tracker</span>
          {activeCampaigns.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              {activeCampaigns.filter((c) => c.status === 'active').length}
            </span>
          )}
        </button>
      </div>

      {activeMainTab === 'tracker' ? (
        <LoanCampaignTrackerView
          campaigns={activeCampaigns}
          onUpdateCampaign={handleUpdateCampaign}
          onSubstituteStock={handleSubstituteStock}
          onRefreshProgress={handleRefreshCampaignProgress}
          onOpenSettleModal={handleOpenSettleModal}
          sales={sales}
          products={products}
          currencySymbol={cs}
          campaignProgress={campaignProgress}
          onNavigateToSimulator={() => setActiveMainTab('simulator')}
        />
      ) : (
        <>
          {/* Top Banner & Header */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3.5">
                <div className="p-3 bg-gradient-to-br from-blue-500/10 to-indigo-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded-2xl shrink-0">
                  <Landmark className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                      Bank Loan Investment Planner
                    </h1>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      Multi-Tranche Loan + Stock Portfolio
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                    Plan multi-tranche bank loans, simulate stock portfolio investments, project debt service coverage, and launch live tracking campaigns.
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
                      placeholder="Scenario name (e.g. 10M Expansion)..."
                      value={scenarioNameInput}
                      onChange={(e) => setScenarioNameInput(e.target.value)}
                      className="px-2 py-1 text-xs bg-transparent focus:outline-none text-slate-900 dark:text-white w-44"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveScenario}
                      disabled={!scenarioNameInput.trim() || !simulation}
                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 cursor-pointer"
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
                    <div className="absolute right-0 top-full mt-1.5 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-2 hidden group-hover:block z-30 space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1">
                        Load or Start Saved Scenario
                      </div>
                      {savedScenarios.map((scen) => (
                        <div
                          key={scen.id}
                          className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/60 text-xs gap-2"
                        >
                          <button
                            onClick={() => handleLoadScenario(scen)}
                            className="text-left flex-1 font-medium text-slate-800 dark:text-slate-200 hover:text-blue-600 truncate"
                          >
                            <div className="truncate">{scen.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {cs}{scen.totalPrincipal.toLocaleString()} • {scen.blendedRate}% blended • {scen.tranches.length} tranches
                            </div>
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleStartCampaignFromScenario(scen)}
                              className="p-1 hover:bg-blue-100 dark:hover:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-md"
                              title="Start Live Campaign from this scenario"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                            </button>
                            <button
                              onClick={() => handleDeleteScenario(scen.id)}
                              className="text-slate-400 hover:text-rose-500 p-1"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Start Live Campaign Button */}
                <button
                  onClick={() => {
                    if (simulation) {
                      setCampaignModalData({ simulation });
                      setIsStartCampaignModalOpen(true);
                    }
                  }}
                  disabled={!simulation}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Campaign</span>
                </button>
              </div>
            </div>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Loan Tranche Config & Stock Portfolio */}
            <div className="lg:col-span-7 space-y-6">
              {/* Loan Tranches Section */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Landmark className="w-4 h-4 text-blue-500" />
                    <span>Loan Tranches ({tranches.length})</span>
                  </h2>
                  <button
                    onClick={addTranche}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Tranche</span>
                  </button>
                </div>

                <div className="space-y-4">
                  {tranches.map((tranche, index) => (
                    <TrancheConfigPanel
                      key={tranche.id}
                      tranche={tranche}
                      index={index}
                      onUpdate={(updates) => updateTranche(tranche.id, updates)}
                      onRemove={() => removeTranche(tranche.id)}
                      onDuplicate={() => duplicateTranche(tranche.id)}
                      canRemove={tranches.length > 1}
                    />
                  ))}
                </div>

                {/* Total Loan Summary */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-black text-blue-600 dark:text-blue-400">
                        {cs}{tranches.reduce((sum, t) => sum + t.principal, 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500">Total Principal</div>
                    </div>
                    <div>
                      <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                        {simulation ? simulation.blendedAnnualRate.toFixed(2) : '0.00'}%
                      </div>
                      <div className="text-xs text-slate-500">Blended Rate</div>
                    </div>
                    <div>
                      <div className="text-2xl font-black text-amber-600 dark:text-amber-400">
                        {Math.max(...tranches.map(t => t.tenureMonths))} mo
                      </div>
                      <div className="text-xs text-slate-500">Max Tenure</div>
                    </div>
                    <div>
                      <div className="text-2xl font-black text-purple-600 dark:text-purple-400">
                        {tranches.length}
                      </div>
                      <div className="text-xs text-slate-500">Tranches</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stock Portfolio Allocation */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Package className="w-4 h-4 text-emerald-500" />
                      <span>Stock Portfolio Allocation</span>
                    </h2>
                    <p className="text-xs text-slate-500">
                      Strategy: <strong className="text-slate-700 dark:text-slate-300 capitalize">{stockStrategy.replace('_', ' ')}</strong>
                      {' | '}
                      Lookback: <strong className="text-slate-700 dark:text-slate-300">{lookbackDays > 0 ? `${lookbackDays} days` : 'All Time'}</strong>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={stockStrategy}
                      onChange={(e) => {
                        setStockStrategy(e.target.value as StockAllocationStrategy);
                        setCustomStockQuantities({});
                      }}
                      className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="dividend_focus">Dividend Focus</option>
                      <option value="growth_focus">Growth Focus</option>
                      <option value="balanced">Balanced</option>
                      <option value="low_volatility">Low Volatility</option>
                      <option value="high_conviction">High Conviction</option>
                    </select>

                    <button
                      onClick={() => setIsSwapStockModalOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Stock</span>
                    </button>

                    {Object.keys(customStockQuantities).length > 0 && (
                      <button
                        onClick={handleResetStockAllocations}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl cursor-pointer transition-colors"
                        title="Revert manual changes and restore algorithmic allocation"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reset to AI Allocation</span>
                      </button>
                    )}

                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl">
                      {simulation?.stockAllocations.length || 0} Stocks
                    </span>
                  </div>
                </div>

                {/* Stock Allocation Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="pb-2 pr-4">Stock</th>
                        <th className="pb-2 pr-4 text-right">Shares</th>
                        <th className="pb-2 pr-4 text-right">Price</th>
                        <th className="pb-2 pr-4 text-right">Capital</th>
                        <th className="pb-2 pr-4 text-right">Weight</th>
                        <th className="pb-2 pr-4 text-right">Exp. Return</th>
                        <th className="pb-2 pr-4 text-right">Div. Yield</th>
                        <th className="pb-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simulation?.stockAllocations.map((allocation, i) => (
                        <tr key={allocation.productId} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-2 pr-4">
                            <div className="font-medium text-slate-900 dark:text-white">{allocation.symbol}</div>
                            <div className="text-xs text-slate-500 truncate max-w-xs">{allocation.name}</div>
                            <div className="text-[10px] text-slate-400">{allocation.sector}</div>
                          </td>
                          <td className="py-2 pr-4 text-right font-mono">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleStockQuantityStep(allocation.productId, -1)}
                                className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-[10px]"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="w-16 text-right">{customStockQuantities[allocation.productId] || allocation.shares}</span>
                              <button
                                onClick={() => handleStockQuantityStep(allocation.productId, 1)}
                                className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-[10px]"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-right font-mono text-slate-700 dark:text-slate-300">
                            {cs}{allocation.currentValue / allocation.shares}
                          </td>
                          <td className="py-2 pr-4 text-right font-mono text-slate-900 dark:text-white">
                            {cs}{allocation.allocatedCapital.toLocaleString()}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className="bg-blue-500 h-full rounded-full transition-all"
                                style={{ width: `${allocation.weightPct}%` }}
                              />
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">{allocation.weightPct.toFixed(1)}%</div>
                          </td>
                          <td className="py-2 pr-4 text-right text-emerald-600 dark:text-emerald-400 font-mono">
                            {allocation.annualizedReturn.toFixed(1)}%
                          </td>
                          <td className="py-2 pr-4 text-right text-blue-600 dark:text-blue-400 font-mono">
                            {((allocation.expectedMonthlyDividend * 12) / allocation.allocatedCapital * 100).toFixed(1)}%
                          </td>
                          <td className="py-2 pr-4">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleOpenSwapModal(allocation.productId, allocation.name)}
                                className="p-1 hover:bg-blue-100 dark:hover:bg-blue-950 text-blue-600 dark:text-blue-400 rounded text-[10px]"
                                title="Swap Stock"
                              >
                                <ArrowLeftRight className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRemoveStock(allocation.productId)}
                                className="p-1 hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-600 dark:text-rose-400 rounded text-[10px]"
                                title="Remove"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Unallocated Capital Warning */}
                {simulation && simulation.unallocatedCapital > 0 && (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-xs text-amber-800 dark:text-amber-200">
                      {cs}{simulation.unallocatedCapital.toLocaleString()} unallocated. Adjust quantities or change strategy to deploy fully.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Risk Metrics & Cash Flow */}
            <div className="lg:col-span-5 flex flex-col space-y-4">
              {/* Risk Metrics Dashboard */}
              <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-5 shadow-md border border-slate-800 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Risk Metrics Dashboard
                    </h3>
                  </div>
                  <button
                    onClick={() => setShowRiskDetails(!showRiskDetails)}
                    className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
                  >
                    {showRiskDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    <span>{showRiskDetails ? 'Hide' : 'Show'} Details</span>
                  </button>
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-3">
                  <RiskMetricCard
                    label="Avg DSCR"
                    value={simulation?.riskMetrics.averageDscr.toFixed(2) || '0.00'}
                    rating={simulation?.riskMetrics.dscrRating || 'N/A'}
                    threshold={1.5}
                    color="emerald"
                  />
                  <RiskMetricCard
                    label="Min DSCR"
                    value={simulation?.riskMetrics.minDscr.toFixed(2) || '0.00'}
                    rating={simulation?.riskMetrics.dscrRating || 'N/A'}
                    threshold={1.25}
                    color="blue"
                  />
                  <RiskMetricCard
                    label="Initial LTV"
                    value={`${(simulation?.riskMetrics.initialLtv || 0) * 100}%`}
                    rating={simulation?.riskMetrics.ltvRating || 'N/A'}
                    threshold={80}
                    color="amber"
                    inverse
                  />
                  <RiskMetricCard
                    label="Int. Coverage"
                    value={simulation?.riskMetrics.averageInterestCoverage.toFixed(2) || '0.00'}
                    rating={simulation?.riskMetrics.dscrRating || 'N/A'}
                    threshold={2.0}
                    color="purple"
                  />
                </div>

                {showRiskDetails && (
                  <div className="border-t border-slate-800 pt-4 space-y-3">
                    <h4 className="text-xs font-bold text-slate-300">Detailed Risk Metrics</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 bg-slate-800/50 rounded">
                        <div className="text-slate-400">Max Drawdown Est.</div>
                        <div className="font-mono text-red-400">{cs}{simulation?.riskMetrics.maxDrawdownEstimate.toLocaleString() || '0'}</div>
                      </div>
                      <div className="p-2 bg-slate-800/50 rounded">
                        <div className="text-slate-400">95% VaR</div>
                        <div className="font-mono text-red-400">{cs}{simulation?.riskMetrics.portfolioVar95.toLocaleString() || '0'}</div>
                      </div>
                      <div className="p-2 bg-slate-800/50 rounded">
                        <div className="text-slate-400">Max Position</div>
                        <div className="font-mono">{simulation?.riskMetrics.maxSinglePositionPct.toFixed(1) || '0'}%</div>
                      </div>
                      <div className="p-2 bg-slate-800/50 rounded">
                        <div className="text-slate-400">HHI Index</div>
                        <div className="font-mono">{(simulation?.riskMetrics.hhiIndex || 0) * 10000}%</div>
                      </div>
                    </div>

                    {/* Stress Tests */}
                    <div className="border-t border-slate-800 pt-4">
                      <h4 className="text-xs font-bold text-slate-300 mb-2">Stress Test Results</h4>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <StressTestCard
                          title="Rate +200bps"
                          dscr={simulation?.riskMetrics.stressTestResults.rateShock200bps.dscr || 0}
                          cashFlow={simulation?.riskMetrics.stressTestResults.rateShock200bps.netCashFlow || 0}
                        />
                        <StressTestCard
                          title="Market -30%"
                          dscr={0}
                          ltv={simulation?.riskMetrics.stressTestResults.marketDrop30pct.ltv || 0}
                          portfolioValue={simulation?.riskMetrics.stressTestResults.marketDrop30pct.portfolioValue || 0}
                        />
                        <StressTestCard
                          title="Combined"
                          dscr={simulation?.riskMetrics.stressTestResults.combinedShock.dscr || 0}
                          ltv={simulation?.riskMetrics.stressTestResults.combinedShock.ltv || 0}
                        />
                      </div>
                    </div>

                    {/* Sector Concentration */}
                    {simulation && Object.keys(simulation.riskMetrics.sectorConcentration).length > 0 && (
                      <div className="border-t border-slate-800 pt-4">
                        <h4 className="text-xs font-bold text-slate-300 mb-2">Sector Concentration</h4>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(simulation.riskMetrics.sectorConcentration).map(([sector, pct]) => (
                            <span
                              key={sector}
                              className="px-2 py-1 bg-slate-800 rounded text-xs text-slate-300"
                            >
                              {sector}: {pct.toFixed(1)}%
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Cash Flow Projection Chart */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-500" />
                  Cash Flow Projection
                </h3>
                <div className="h-64">
                  {cashFlowChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={cashFlowChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorLoan" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorPortfolio" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${cs}${v / 1000}k`} />
                        <Tooltip
                          formatter={(value: number) => [`${cs}${value.toLocaleString()}`, '']}
                          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                        />
                        <Legend />
                        <Area type="monotone" dataKey="Loan Payment" stroke="#ef4444" fillOpacity={1} fill="url(#colorLoan)" name="Loan Payment" strokeWidth={2} />
                        <Area type="monotone" dataKey="Portfolio Inflow" stroke="#10b981" fillOpacity={1} fill="url(#colorPortfolio)" name="Portfolio Inflow" strokeWidth={2} />
                        <Line type="monotone" dataKey="Net Cash Flow" stroke="#3b82f6" strokeWidth={2} dot={false} name="Net Cash Flow" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                      Run simulation to see cash flow projection
                    </div>
                  )}
                </div>
              </div>

              {/* Portfolio Allocation Pie Chart */}
              {simulation && simulation.stockAllocations.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-emerald-500" />
                    Portfolio Allocation
                  </h3>
                  <div className="h-64 flex flex-col">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={portfolioAllocationData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={2}
                          dataKey="value"
                          nameKey="name"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                          labelLine={false}
                        >
                          {portfolioAllocationData.map((entry, i) => (
                            <Cell key={`cell-${i}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, name: string) => [`${cs}${value.toLocaleString()}`, name]}
                          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                        />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Side-by-Side Strategy Comparison */}
          {showComparison && simulation && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    Strategy Comparison
                  </h3>
                  <p className="text-xs text-slate-500">
                    Compare all 5 allocation strategies against your loan terms.
                  </p>
                </div>
                <button
                  onClick={() => setShowComparison(false)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {comparisonData.map((comp, i) => {
                  const isSelected = selectedComparisonIndex === i;
                  return (
                    <div
                      key={comp.label}
                      onClick={() => setSelectedComparisonIndex(isSelected ? -1 : i)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/30 ring-1 ring-blue-500/20'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                          {comp.label}
                        </span>
                        {isSelected && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mb-3">
                        {comp.description}
                      </p>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Portfolio Return:</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                            +{cs}{comp.totalPortfolioReturn.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Net Benefit:</span>
                          <span className={`font-bold font-mono ${comp.netBenefit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {comp.netBenefit >= 0 ? '+' : ''}{cs}{comp.netBenefit.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Avg DSCR:</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                            {comp.averageDscr}x
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Risk:</span>
                          <span className={`font-semibold ${comp.riskRating === 'Low' ? 'text-emerald-600' : comp.riskRating === 'Medium' ? 'text-amber-600' : 'text-rose-600'}`}>
                            {comp.riskRating}
                          </span>
                        </div>
                      </div>

                      {!isSelected && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setStockStrategy(comp.label.toLowerCase().replace(' ', '_') as StockAllocationStrategy);
                            setShowComparison(false);
                          }}
                          className="mt-3 w-full py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                        >
                          Use This Strategy
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Loan Amortization Schedule */}
          {simulation && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-500" />
                <span>Loan Amortization Schedule</span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-left font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="pb-2 pr-4">Period</th>
                      <th className="pb-2 pr-4 text-right">Due Date</th>
                      <th className="pb-2 pr-4 text-right">Principal</th>
                      <th className="pb-2 pr-4 text-right">Interest</th>
                      <th className="pb-2 pr-4 text-right">Fees</th>
                      <th className="pb-2 pr-4 text-right">Total Payment</th>
                      <th className="pb-2 pr-4 text-right">Outstanding</th>
                      <th className="pb-2 pr-4 text-right">Portfolio Inflow</th>
                      <th className="pb-2 pr-4 text-right">DSCR</th>
                      <th className="pb-2 pr-4 text-right">Net Cash Flow</th>
                      <th className="pb-2">Covenant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulation.schedule.map((period) => (
                      <tr
                        key={period.periodIndex}
                        className={`border-b border-slate-100 dark:border-slate-800 ${period.covenantBreach ? 'bg-rose-50 dark:bg-rose-950/30' : ''}`}
                      >
                        <td className="py-2 pr-4 font-medium">{period.periodLabel}</td>
                        <td className="py-2 pr-4 text-right text-slate-500">{period.dueDate}</td>
                        <td className="py-2 pr-4 text-right font-mono">{cs}{period.principalDue.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right font-mono text-blue-600 dark:text-blue-400">{cs}{period.interestDue.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right font-mono text-amber-600 dark:text-amber-400">{cs}{period.feesDue.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right font-bold text-slate-900 dark:text-white">{cs}{period.totalLoanPayment.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right font-mono text-slate-600 dark:text-slate-400">{cs}{period.outstandingPrincipal.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right font-mono text-emerald-600 dark:text-emerald-400">{cs}{period.totalPortfolioCashInflow.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right">
                          <span className={period.dscr >= 1.5 ? 'text-emerald-600' : period.dscr >= 1.25 ? 'text-amber-600' : 'text-rose-600'}>
                            {period.dscr.toFixed(2)}x
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right font-mono {period.netCashFlow >= 0 ? 'text-emerald-600' : 'text-rose-600'}">
                          {period.netCashFlow >= 0 ? '+' : ''}{cs}{period.netCashFlow.toLocaleString()}
                        </td>
                        <td className="py-2 pr-4">
                          {period.covenantBreach ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              Breach
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                              OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Modals */}
          {isStartCampaignModalOpen && campaignModalData && (
            <StartLoanCampaignModal
              simulation={campaignModalData.simulation}
              scenarioName={campaignModalData.scenarioName}
              onClose={() => {
                setIsStartCampaignModalOpen(false);
                setCampaignModalData(null);
              }}
              onLaunch={handleLaunchCampaign}
            />
          )}

          {isSwapStockModalOpen && swapModalData && simulation && (
            <SwapStockModal
              outgoingId={swapModalData.outgoingId}
              outgoingName={swapModalData.outgoingName}
              availableStocks={simulation.stockAllocations.map(a => ({
                productId: a.productId,
                symbol: a.symbol,
                name: a.name,
                currentPrice: a.currentValue / a.shares,
                expectedReturn: a.annualizedReturn,
              }))}
              onClose={() => {
                setIsSwapStockModalOpen(false);
                setSwapModalData(null);
              }}
              onConfirm={handleConfirmStockSwap}
            />
          )}

          {isSettleMilestoneModalOpen && settleModalData && (
            <SettleMilestoneModal
              campaign={settleModalData.campaign}
              milestone={settleModalData.milestone}
              onClose={() => {
                setIsSettleMilestoneModalOpen(false);
                setSettleModalData(null);
              }}
              onSettle={handleSettleMilestone}
            />
          )}
        </>
      )}
    </div>
  );
};

// --- Sub Components ---

interface TrancheConfigPanelProps {
  tranche: LoanTranche;
  index: number;
  onUpdate: (updates: Partial<LoanTranche>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  canRemove: boolean;
}

const TrancheConfigPanel: React.FC<TrancheConfigPanelProps> = ({
  tranche,
  index,
  onUpdate,
  onRemove,
  onDuplicate,
  canRemove,
}) => {
  const trancheTypeLabels: Record<LoanType, string> = {
    term_loan: 'Term Loan',
    revolving_credit: 'Revolving Credit',
    bridge_loan: 'Bridge Loan',
  };

  const repaymentLabels: Record<LoanRepaymentStructure, string> = {
    bullet: 'Bullet (Principal at Maturity)',
    amortized: 'Amortized (Equal Principal)',
    interest_only_then_amortized: 'Interest-Only Then Amortized',
    lump_sum: 'Lump Sum at End',
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 rounded text-xs font-bold">
            {index + 1}
          </span>
          <input
            type="text"
            value={tranche.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="font-bold text-slate-900 dark:text-white bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-blue-500 px-2 py-1 rounded"
          />
          <select
            value={tranche.type}
            onChange={(e) => onUpdate({ type: e.target.value as LoanType })}
            className="px-2 py-1 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="term_loan">Term Loan</option>
            <option value="revolving_credit">Revolving Credit</option>
            <option value="bridge_loan">Bridge Loan</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onDuplicate} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500" title="Duplicate">
            <Copy className="w-3.5 h-3.5" />
          </button>
          {canRemove && (
            <button onClick={onRemove} className="p-1 hover:bg-rose-100 dark:hover:bg-rose-950 rounded text-rose-500" title="Remove">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Principal</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">₦</span>
            <input
              type="number"
              value={tranche.principal}
              onChange={(e) => onUpdate({ principal: Math.max(0, Number(e.target.value)) })}
              className="w-full pl-6 pr-2 py-1.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
              step={100000}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Interest Rate (%/yr)</label>
          <input
            type="number"
            value={tranche.interestRate}
            onChange={(e) => onUpdate({ interestRate: Math.max(0, Number(e.target.value)) })}
            className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            step={0.1}
            min={0}
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Rate Type</label>
          <select
            value={tranche.interestRateType}
            onChange={(e) => onUpdate({ interestRateType: e.target.value as InterestRateType })}
            className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="fixed">Fixed</option>
            <option value="floating">Floating</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Tenure (Months)</label>
          <input
            type="number"
            value={tranche.tenureMonths}
            onChange={(e) => onUpdate({ tenureMonths: Math.max(1, Number(e.target.value)) })}
            className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            step={1}
            min={1}
          />
        </div>

        {tranche.interestRateType === 'floating' && (
          <>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Reference Rate</label>
              <input
                type="text"
                value={tranche.referenceRate || ''}
                onChange={(e) => onUpdate({ referenceRate: e.target.value })}
                className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. SOFR, Prime"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Spread (bps)</label>
              <input
                type="number"
                value={tranche.spreadBps || 0}
                onChange={(e) => onUpdate({ spreadBps: Math.max(0, Number(e.target.value)) })}
                className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                step={1}
                min={0}
              />
            </div>
          </>
        )}

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Repayment</label>
          <select
            value={tranche.repaymentStructure}
            onChange={(e) => onUpdate({ repaymentStructure: e.target.value as LoanRepaymentStructure })}
            className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="bullet">Bullet</option>
            <option value="amortized">Amortized</option>
            <option value="interest_only_then_amortized">IO then Amortized</option>
            <option value="lump_sum">Lump Sum</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Frequency</label>
          <select
            value={tranche.repaymentFrequency}
            onChange={(e) => onUpdate({ repaymentFrequency: e.target.value as LoanRepaymentFrequency })}
            className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="semi_annual">Semi-Annual</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">IO Period (Months)</label>
          <input
            type="number"
            value={tranche.interestOnlyMonths || 0}
            onChange={(e) => onUpdate({ interestOnlyMonths: Math.max(0, Number(e.target.value)) })}
            className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            step={1}
            min={0}
            max={tranche.tenureMonths}
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Origination Fee (bps)</label>
          <input
            type="number"
            value={tranche.originationFeeBps || 0}
            onChange={(e) => onUpdate({ originationFeeBps: Math.max(0, Number(e.target.value)) })}
            className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            step={1}
            min={0}
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Commitment Fee (bps/yr)</label>
          <input
            type="number"
            value={tranche.commitmentFeeBps || 0}
            onChange={(e) => onUpdate({ commitmentFeeBps: Math.max(0, Number(e.target.value)) })}
            className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            step={1}
            min={0}
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Min DSCR Covenant</label>
          <input
            type="number"
            value={tranche.covenantDscrMin || ''}
            onChange={(e) => onUpdate({ covenantDscrMin: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            step={0.05}
            min={0}
            placeholder="Optional"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Max LTV Covenant</label>
          <input
            type="number"
            value={tranche.covenantLtvMax || ''}
            onChange={(e) => onUpdate({ covenantLtvMax: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full py-1.5 px-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            step={0.05}
            min={0}
            max={1}
            placeholder="Optional"
          />
        </div>
      </div>
    </div>
  );
};

interface RiskMetricCardProps {
  label: string;
  value: string;
  rating: string;
  threshold: number;
  color: 'emerald' | 'blue' | 'amber' | 'purple' | 'red';
  inverse?: boolean;
}

const RiskMetricCard: React.FC<RiskMetricCardProps> = ({
  label,
  value,
  rating,
  threshold,
  color,
  inverse = false,
}) => {
  const colorMap = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    red: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  };

  const ratingColors: Record<string, string> = {
    Strong: 'text-emerald-400',
    Adequate: 'text-blue-400',
    Weak: 'text-amber-400',
    Breach: 'text-rose-400',
    Conservative: 'text-emerald-400',
    Moderate: 'text-blue-400',
    Aggressive: 'text-amber-400',
    'N/A': 'text-slate-400',
  };

  return (
    <div className={`p-3 rounded-xl border ${colorMap[color]}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      <div className="text-xl font-black font-mono">{value}</div>
      <div className="flex items-center justify-between mt-2">
        <span className={`text-[10px] font-semibold ${ratingColors[rating] || 'text-slate-400'}`}>
          {rating}
        </span>
        <span className="text-[10px] text-slate-500">Threshold: {inverse ? `≤${threshold}` : `≥${threshold}`}</span>
      </div>
    </div>
  );
};

interface StressTestCardProps {
  title: string;
  dscr?: number;
  ltv?: number;
  portfolioValue?: number;
  cashFlow?: number;
}

const StressTestCard: React.FC<StressTestCardProps> = ({ title, dscr, ltv, portfolioValue, cashFlow }) => {
  return (
    <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700">
      <div className="text-[10px] font-bold text-slate-400 mb-2">{title}</div>
      {dscr !== undefined && (
        <div className="text-sm font-mono text-blue-400">DSCR: {dscr.toFixed(2)}x</div>
      )}
      {ltv !== undefined && (
        <div className="text-sm font-mono text-amber-400">LTV: {(ltv * 100).toFixed(1)}%</div>
      )}
      {portfolioValue !== undefined && (
        <div className="text-sm font-mono text-slate-400">Portfolio: ₦{portfolioValue.toLocaleString()}</div>
      )}
      {cashFlow !== undefined && (
        <div className={`text-sm font-mono ${cashFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          Net CF: {cashFlow >= 0 ? '+' : ''}₦{cashFlow.toLocaleString()}
        </div>
      )}
    </div>
  );
};

// --- Modals ---

interface StartLoanCampaignModalProps {
  simulation: LoanSimulationResult;
  scenarioName?: string;
  onClose: () => void;
  onLaunch: (name: string, borrower: string, lender: string, startDate: string) => void;
}

const StartLoanCampaignModal: React.FC<StartLoanCampaignModalProps> = ({
  simulation,
  scenarioName,
  onClose,
  onLaunch,
}) => {
  const [name, setName] = useState(scenarioName || `Loan Campaign ${new Date().toLocaleDateString()}`);
  const [borrower, setBorrower] = useState('');
  const [lender, setLender] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in zoom-in duration-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Start Live Campaign</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500">
            <span className="sr-only">Close</span>
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Campaign Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Borrower Name</label>
            <input
              type="text"
              value={borrower}
              onChange={(e) => setBorrower(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Acme Corporation"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Lender Name</label>
            <input
              type="text"
              value={lender}
              onChange={(e) => setLender(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. First Bank"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-xs text-slate-600 dark:text-slate-400">
            <strong>Loan Summary:</strong> {simulation.tranches.length} tranches, ₦{simulation.totalPrincipal.toLocaleString()}, {simulation.blendedAnnualRate}% blended rate, {simulation.tenureMonths} months max tenure.
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onLaunch(name, borrower, lender, startDate)}
            disabled={!name.trim()}
            className="flex-1 py-2 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg font-semibold text-sm shadow-md transition-all disabled:opacity-50"
          >
            Launch Campaign
          </button>
        </div>
      </div>
    </div>
  );
};

interface SwapStockModalProps {
  outgoingId: string;
  outgoingName: string;
  availableStocks: Array<{
    productId: string;
    symbol: string;
    name: string;
    currentPrice: number;
    expectedReturn: number;
  }>;
  onClose: () => void;
  onConfirm: (outgoingId: string, incomingProductId: string, newShares: number) => void;
}

const SwapStockModal: React.FC<SwapStockModalProps> = ({
  outgoingId,
  outgoingName,
  availableStocks,
  onClose,
  onConfirm,
}) => {
  const [selectedStockId, setSelectedStockId] = useState<string>('');
  const [newShares, setNewShares] = useState<number>(0);

  const selectedStock = availableStocks.find(s => s.productId === selectedStockId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in zoom-in duration-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Swap Stock</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500">✕</button>
        </div>

        <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg">
          <div className="text-xs font-bold text-rose-700 dark:text-rose-300">Replacing:</div>
          <div className="text-sm text-slate-900 dark:text-white">{outgoingName}</div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Select Replacement Stock</label>
            <select
              value={selectedStockId}
              onChange={(e) => {
                setSelectedStockId(e.target.value);
                if (e.target.value) {
                  const stock = availableStocks.find(s => s.productId === e.target.value);
                  if (stock) setNewShares(Math.floor(1000000 / stock.currentPrice));
                }
              }}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose a stock...</option>
              {availableStocks.filter(s => s.productId !== outgoingId).map((stock) => (
                <option key={stock.productId} value={stock.productId}>
                  {stock.symbol} - {stock.name} (₦{stock.currentPrice.toLocaleString()})
                </option>
              ))}
            </select>
          </div>

          {selectedStock && (
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Shares to Buy</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">₦</span>
                <input
                  type="number"
                  value={newShares}
                  onChange={(e) => setNewShares(Math.max(0, Number(e.target.value)))}
                  className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min={1}
                />
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Est. Cost: ₦{(newShares * selectedStock.currentPrice).toLocaleString()} | Exp. Return: {selectedStock.expectedReturn.toFixed(1)}%/yr
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedStockId && onConfirm(outgoingId, selectedStockId, newShares)}
            disabled={!selectedStockId || newShares <= 0}
            className="flex-1 py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
          >
            Confirm Swap
          </button>
        </div>
      </div>
    </div>
  );
};

interface SettleMilestoneModalProps {
  campaign: ActiveLoanCampaign;
  milestone: any;
  onClose: () => void;
  onSettle: (amount: number, source: 'dividends' | 'sales' | 'external', notes: string) => void;
}

const SettleMilestoneModal: React.FC<SettleMilestoneModalProps> = ({
  campaign,
  milestone,
  onClose,
  onSettle,
}) => {
  const [amount, setAmount] = useState(milestone.totalDue);
  const [source, setSource] = useState<'dividends' | 'sales' | 'external'>('dividends');
  const [notes, setNotes] = useState('');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in zoom-in duration-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Settle Milestone</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500">✕</button>
        </div>

        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
          <div className="text-xs text-slate-500">Campaign: {campaign.name}</div>
          <div className="text-sm font-bold text-slate-900 dark:text-white">{milestone.periodLabel} - Due {milestone.dueDate}</div>
          <div className="text-sm font-mono text-blue-600 dark:text-blue-400">Total Due: ₦{milestone.totalDue.toLocaleString()}</div>
          <div className="text-xs text-slate-500">Principal: ₦{milestone.principalDue.toLocaleString()} | Interest: ₦{milestone.interestDue.toLocaleString()}</div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Payment Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">₦</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={0}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Payment Source</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as 'dividends' | 'sales' | 'external')}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="dividends">Dividend Income</option>
              <option value="sales">Stock Sale Proceeds</option>
              <option value="external">External Funds</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional notes..."
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => onSettle(amount, source, notes)}
            className="flex-1 py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm"
          >
            Record Payment
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Live Campaign Tracker View ---

interface LoanCampaignTrackerViewProps {
  campaigns: ActiveLoanCampaign[];
  onUpdateCampaign: (campaign: ActiveLoanCampaign) => void;
  onSubstituteStock: (campaignId: string, outgoingId: string, incomingProduct: Product, newShares: number, reason: any) => void;
  onRefreshProgress: (campaignId: string) => void;
  onOpenSettleModal: (campaign: ActiveLoanCampaign, milestone: any) => void;
  sales: Sale[];
  products: Product[];
  currencySymbol: string;
  campaignProgress: Record<string, any>;
  onNavigateToSimulator: () => void;
}

const LoanCampaignTrackerView: React.FC<LoanCampaignTrackerViewProps> = ({
  campaigns,
  onUpdateCampaign,
  onSubstituteStock,
  onRefreshProgress,
  onOpenSettleModal,
  sales,
  products,
  currencySymbol,
  campaignProgress,
  onNavigateToSimulator,
}) => {
  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  const completedCampaigns = campaigns.filter(c => c.status === 'completed');
  const defaultedCampaigns = campaigns.filter(c => c.status === 'in_default');

  if (campaigns.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center">
        <Zap className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">No Active Loan Campaigns</h3>
        <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto">
          Create a loan scenario in the Simulator tab and launch a live campaign to track portfolio performance against debt obligations.
        </p>
        <button
          onClick={onNavigateToSimulator}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-md"
        >
          <ArrowLeftRight className="w-4 h-4" />
          Go to Simulator
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Campaign Status Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        {[
          { key: 'active', label: 'Active', count: activeCampaigns.length, color: 'emerald' },
          { key: 'completed', label: 'Completed', count: completedCampaigns.length, color: 'blue' },
          { key: 'defaulted', label: 'In Default', count: defaultedCampaigns.length, color: 'rose' },
        ].map((tab) => (
          <button
            key={tab.key}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              tab.color === 'emerald'
                ? 'bg-emerald-600 text-white'
                : tab.color === 'blue'
                ? 'bg-blue-600 text-white'
                : 'bg-rose-600 text-white'
            }`}
          >
            <span className="capitalize">{tab.label}</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-white/20">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Campaign Cards */}
      <div className="space-y-4">
        {activeCampaigns.map((campaign) => (
          <CampaignDetailCard
            key={campaign.id}
            campaign={campaign}
            progress={campaignProgress[campaign.id]}
            products={products}
            currencySymbol={currencySymbol}
            onUpdateCampaign={onUpdateCampaign}
            onSubstituteStock={onSubstituteStock}
            onRefreshProgress={onRefreshProgress}
            onOpenSettleModal={onOpenSettleModal}
          />
        ))}
        {completedCampaigns.map((campaign) => (
          <CompletedCampaignCard key={campaign.id} campaign={campaign} currencySymbol={currencySymbol} />
        ))}
        {defaultedCampaigns.map((campaign) => (
          <DefaultedCampaignCard key={campaign.id} campaign={campaign} currencySymbol={currencySymbol} onOpenSettleModal={onOpenSettleModal} />
        ))}
      </div>
    </div>
  );
};

interface CampaignDetailCardProps {
  campaign: ActiveLoanCampaign;
  progress: any;
  products: Product[];
  currencySymbol: string;
  onUpdateCampaign: (campaign: ActiveLoanCampaign) => void;
  onSubstituteStock: (campaignId: string, outgoingId: string, incomingProduct: Product, newShares: number, reason: any) => void;
  onRefreshProgress: (campaignId: string) => void;
  onOpenSettleModal: (campaign: ActiveLoanCampaign, milestone: any) => void;
}

const CampaignDetailCard: React.FC<CampaignDetailCardProps> = ({
  campaign,
  progress,
  products,
  currencySymbol,
  onUpdateCampaign,
  onSubstituteStock,
  onRefreshProgress,
  onOpenSettleModal,
}) => {
  const [expanded, setExpanded] = useState(false);

  const p = progress || {
    portfolioValue: campaign.stockHoldings.reduce((sum, h) => sum + h.currentAllocatedCapital, 0),
    totalDividendsReceived: 0,
    totalUnrealizedPnL: 0,
    currentDscr: 0,
    currentLtv: 0,
    covenantStatus: 'Compliant',
    covenantBreaches: [],
    healthStatus: 'On Track',
    healthReason: 'No live data yet',
    holdingTrackings: [],
    flaggedHoldings: [],
    substitutionRecommendations: {},
    paymentsOverdue: 0,
    nextPaymentDue: campaign.milestones[0]?.totalDue || 0,
    nextPaymentDate: campaign.milestones[0]?.dueDate || '',
    principalPaydownPct: 0,
    totalPrincipalPaid: 0,
    totalInterestPaid: 0,
  };

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'Ahead': return 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-400';
      case 'On Track': return 'text-blue-600 bg-blue-100 dark:bg-blue-950 dark:text-blue-400';
      case 'At Risk': return 'text-amber-600 bg-amber-100 dark:bg-amber-950 dark:text-amber-400';
      case 'Critical': return 'text-rose-600 bg-rose-100 dark:bg-rose-950 dark:text-rose-400';
      default: return 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-400';
    }
  };

  const getCovenantColor = (status: string) => {
    switch (status) {
      case 'Compliant': return 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-400';
      case 'Watch': return 'text-amber-600 bg-amber-100 dark:bg-amber-950 dark:text-amber-400';
      case 'Breach': return 'text-rose-600 bg-rose-100 dark:bg-rose-950 dark:text-rose-400';
      default: return 'text-slate-600 bg-slate-100';
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="p-2 bg-blue-100 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-xl">
            <Landmark className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-slate-900 dark:text-white truncate">{campaign.name}</h4>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${campaign.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-700'}`}>
                {campaign.status}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getHealthColor(p.healthStatus)}`}>
                {p.healthStatus}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getCovenantColor(p.covenantStatus)}`}>
                {p.covenantStatus}
              </span>
            </div>
            <div className="text-xs text-slate-500 flex flex-wrap gap-4 mt-1">
              <span>Borrower: {campaign.borrowerName || 'N/A'}</span>
              <span>Lender: {campaign.lenderName || 'N/A'}</span>
              <span>{campaign.tranches.length} Tranches</span>
              <span>₦{campaign.totalPrincipal.toLocaleString()} Principal</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <div className="text-lg font-black text-slate-900 dark:text-white">
              {currencySymbol}{p.portfolioValue?.toLocaleString() || '0'}
            </div>
            <div className="text-xs text-slate-500">Portfolio Value</div>
          </div>
          <div className="w-px h-8 bg-slate-200 dark:bg-slate-700 mx-2" />
          <div className="text-right">
            <div className="text-lg font-black text-blue-600 dark:text-blue-400">
              {currencySymbol}{p.nextPaymentDue?.toLocaleString() || '0'}
            </div>
            <div className="text-xs text-slate-500">Next Payment</div>
          </div>
          <div className="w-px h-8 bg-slate-200 dark:bg-slate-700 mx-2" />
          <div className="text-right">
            <div className="text-lg font-black text-emerald-600 dark:text-emerald-400">
              {p.currentDscr?.toFixed(2) || '0.00'}x
            </div>
            <div className="text-xs text-slate-500">Current DSCR</div>
          </div>
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-6 animate-in slide-in-from-top duration-200">
          {/* Key Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricBox label="Principal Paid" value={`${currencySymbol}${p.totalPrincipalPaid?.toLocaleString() || '0'}`} color="blue" />
            <MetricBox label="Interest Paid" value={`${currencySymbol}${p.totalInterestPaid?.toLocaleString() || '0'}`} color="amber" />
            <MetricBox label="Paydown" value={`${(p.principalPaydownPct || 0).toFixed(1)}%`} color="emerald" />
            <MetricBox label="Overdue" value={p.paymentsOverdue || 0} color={p.paymentsOverdue > 0 ? 'rose' : 'emerald'} />
          </div>

          {/* Covenant Breaches */}
          {p.covenantBreaches.length > 0 && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl">
              <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 mb-2">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-bold">Covenant Breaches Detected</span>
              </div>
              <ul className="text-sm text-rose-600 dark:text-rose-400 space-y-1">
                {p.covenantBreaches.map((breach: string, i: number) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    {breach}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Holdings Table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h5 className="font-bold text-slate-900 dark:text-white">Portfolio Holdings</h5>
              <button
                onClick={() => onRefreshProgress(campaign.id)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-lg"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-left font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="pb-2 pr-4">Stock</th>
                    <th className="pb-2 pr-4 text-right">Shares</th>
                    <th className="pb-2 pr-4 text-right">Cost</th>
                    <th className="pb-2 pr-4 text-right">Current</th>
                    <th className="pb-2 pr-4 text-right">Unrealized P&L</th>
                    <th className="pb-2 pr-4 text-right">Return %</th>
                    <th className="pb-2 pr-4 text-right">Dividends</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {p.holdingTrackings?.map((tracking: any) => (
                    <tr key={tracking.holding.productId} className={`border-b border-slate-100 dark:border-slate-800 ${tracking.isUnderperforming ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                      <td className="py-2 pr-4">
                        <div className="font-medium text-slate-900 dark:text-white">{tracking.holding.symbol}</div>
                        <div className="text-[10px] text-slate-500">{tracking.holding.name}</div>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">{tracking.holding.currentShares.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right font-mono text-slate-600 dark:text-slate-400">
                        {currencySymbol}{tracking.holding.purchasePrice.toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-slate-900 dark:text-white">
                        {currencySymbol}{tracking.currentValue.toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        <span className={tracking.unrealizedPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {tracking.unrealizedPnL >= 0 ? '+' : ''}{currencySymbol}{tracking.unrealizedPnL.toLocaleString()}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <span className={tracking.totalReturnPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {tracking.totalReturnPct >= 0 ? '+' : ''}{tracking.totalReturnPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-blue-600 dark:text-blue-400">
                        {currencySymbol}{tracking.dividendsReceived.toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">
                        {tracking.isUnderperforming ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 flex items-center gap-1">
                            <Flag className="w-2.5 h-2.5" />
                            Underperforming
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                            Healthy
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Underperforming Holdings & Substitution Recommendations */}
          {p.flaggedHoldings && p.flaggedHoldings.length > 0 && (
            <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
              <h5 className="font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <Flag className="w-4 h-4 text-amber-500" />
                Underperforming Holdings & Recommendations
              </h5>
              <div className="space-y-4">
                {p.flaggedHoldings.map((flagged: any, idx: number) => {
                  const recs = p.substitutionRecommendations?.[flagged.tracking.holding.productId] || [];
                  return (
                    <div key={idx} className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white">{flagged.tracking.holding.symbol}</div>
                          <div className="text-sm text-slate-600 dark:text-slate-400">{flagged.tracking.holding.name}</div>
                          <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">{flagged.reason}</div>
                        </div>
                      </div>
                      {recs.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {recs.slice(0, 3).map((rec: any, rIdx: number) => (
                            <button
                              key={rIdx}
                              onClick={() => {
                                const product = products.find(p => p.id === rec.productId);
                                if (product) {
                                  onSubstituteStock(
                                    campaign.id,
                                    flagged.tracking.holding.productId,
                                    product,
                                    rec.recommendedShares,
                                    'covenant_cure'
                                  );
                                }
                              }}
                              className="p-3 bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 rounded-lg text-left hover:border-amber-400 transition-colors"
                            >
                              <div className="font-medium text-slate-900 dark:text-white">{rec.symbol}</div>
                              <div className="text-xs text-slate-500">{rec.name}</div>
                              <div className="text-xs text-slate-400">{rec.sector}</div>
                              <div className="flex justify-between text-xs mt-1">
                                <span className="text-emerald-600">+{rec.projectedAdditionalReturn?.toLocaleString() || 0}/yr</span>
                                <span className="text-blue-600">{rec.recommendedShares} shares</span>
                              </div>
                              <div className="text-[10px] text-slate-500 mt-1">Click to substitute</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upcoming Milestones */}
          <div>
            <h5 className="font-bold text-slate-900 dark:text-white mb-3">Upcoming Milestones</h5>
            <div className="space-y-2">
              {campaign.milestones.slice(0, 5).map((milestone) => (
                <div
                  key={milestone.periodIndex}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    milestone.status === 'paid' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200' :
                    milestone.status === 'overdue' ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200' :
                    'bg-slate-50 dark:bg-slate-800/50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      milestone.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                      milestone.status === 'overdue' ? 'bg-rose-100 text-rose-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {milestone.status === 'paid' ? '✓' : milestone.periodIndex}
                    </span>
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white">{milestone.periodLabel}</div>
                      <div className="text-xs text-slate-500">Due: {milestone.dueDate}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-mono text-slate-900 dark:text-white">{currencySymbol}{milestone.totalDue.toLocaleString()}</div>
                      <div className="text-xs text-slate-500">P: {currencySymbol}{milestone.principalDue.toLocaleString()} | I: {currencySymbol}{milestone.interestDue.toLocaleString()}</div>
                    </div>
                    {milestone.status === 'pending' && (
                      <button
                        onClick={() => onOpenSettleModal(campaign, milestone)}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
                      >
                        Settle
                      </button>
                    )}
                    {milestone.status === 'overdue' && (
                      <span className="px-2 py-1 text-rose-600 text-xs font-bold bg-rose-100 rounded">OVERDUE</span>
                    )}
                    {milestone.status === 'paid' && (
                      <span className="px-2 py-1 text-emerald-600 text-xs font-bold bg-emerald-100 rounded">PAID</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface CompletedCampaignCardProps {
  campaign: ActiveLoanCampaign;
  currencySymbol: string;
}

const CompletedCampaignCard: React.FC<CompletedCampaignCardProps> = ({ campaign, currencySymbol }) => {
  const totalPaid = campaign.milestones.reduce((sum, m) => sum + (m.paidAmount || m.totalDue), 0);
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white">{campaign.name}</h4>
            <div className="text-xs text-slate-500">Completed on {campaign.completedAt ? new Date(campaign.completedAt).toLocaleDateString() : 'N/A'}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-black text-emerald-600 dark:text-emerald-400">{currencySymbol}{totalPaid.toLocaleString()}</div>
          <div className="text-xs text-slate-500">Total Paid</div>
        </div>
      </div>
    </div>
  );
};

interface DefaultedCampaignCardProps {
  campaign: ActiveLoanCampaign;
  currencySymbol: string;
  onOpenSettleModal: (campaign: ActiveLoanCampaign, milestone: any) => void;
}

const DefaultedCampaignCard: React.FC<DefaultedCampaignCardProps> = ({ campaign, currencySymbol, onOpenSettleModal }) => {
  const overdueMilestones = campaign.milestones.filter(m => m.status === 'overdue');
  const nextOverdue = overdueMilestones[0];
  return (
    <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 rounded-2xl p-4 bg-rose-50 dark:bg-rose-950/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-rose-100 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 rounded-xl">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white">{campaign.name}</h4>
            <div className="text-xs text-rose-600 dark:text-rose-400">{overdueMilestones.length} overdue payment(s)</div>
          </div>
        </div>
        {nextOverdue && (
          <button
            onClick={() => onOpenSettleModal(campaign, nextOverdue)}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold"
          >
            Settle Overdue
          </button>
        )}
      </div>
    </div>
  );
};

const MetricBox: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
    rose: 'text-rose-600 bg-rose-50 dark:bg-rose-950/30',
  };
  return (
    <div className={`p-3 rounded-xl ${colorMap[color] || colorMap.blue}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className="text-lg font-black">{value}</div>
    </div>
  );
};

export default BankLoanPlannerView;