import React, { useState, useMemo } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Info,
  Building,
  DollarSign,
  Calendar,
  SlidersHorizontal,
  Target,
  Shield,
  TrendingUp,
  Zap,
  HelpCircle,
  RotateCcw,
  Plus,
  Minus,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  AutoSetupMode,
  AutoSetupObjective,
  BankLoanOffer,
  AutoSetupConstraints,
  AutoSetupParams,
  AutoSetupResult,
  AutoSetupVariant,
  LoanTranche,
  StockAllocationStrategy,
  LoanRepaymentStructure,
  LoanRepaymentFrequency,
  LoanSimulationResult,
} from '../../types/loan';
import { runAutoSetup } from '../../utils/loanAutoSetup';

interface AutoSetupLoanModalProps {
  products: any[];
  sales: any[];
  onClose: () => void;
  onApply: (variant: AutoSetupVariant, simulation: LoanSimulationResult) => void;
}

const STRUCTURE_LABELS: Record<LoanRepaymentStructure, string> = {
  bullet: 'Bullet (Principal at Maturity)',
  amortized: 'Amortized (Equal Principal)',
  interest_only_then_amortized: 'Interest-Only Then Amortized',
  lump_sum: 'Lump Sum at End',
};

const FREQUENCY_LABELS: Record<LoanRepaymentFrequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Semi-Annual',
};

const MODE_CONFIG = {
  quick: {
    label: 'Quick Auto',
    description: 'One-click balanced optimization with sensible defaults',
    icon: Zap,
    color: 'bg-blue-500',
  },
  objective: {
    label: 'Objective-Based',
    description: 'Choose your goal: Max Profit, Max Safety, or Balanced',
    icon: Target,
    color: 'bg-emerald-500',
  },
  bounded: {
    label: 'Bounded Optimization',
    description: 'Set hard limits (max rate, tenure, min DSCR, max LTV)',
    icon: Shield,
    color: 'bg-amber-500',
  },
} as const;

const OBJECTIVE_CONFIG = {
  max_profit: {
    label: 'Maximize Net Profit',
    description: 'Aggressive allocation for highest total return after loan cost',
    icon: TrendingUp,
    color: 'text-emerald-600',
  },
  max_safety: {
    label: 'Maximize Safety (DSCR)',
    description: 'Conservative allocation prioritizing debt coverage and low LTV',
    icon: Shield,
    color: 'text-blue-600',
  },
  balanced: {
    label: 'Balanced Risk-Adjusted',
    description: 'Optimize Sharpe-like ratio: return per unit of risk',
    icon: SlidersHorizontal,
    color: 'text-purple-600',
  },
  custom: {
    label: 'Custom Weights',
    description: 'Manually tune Profit / Safety / Liquidity importance',
    icon: SlidersHorizontal,
    color: 'text-amber-600',
  },
} as const;

export const AutoSetupLoanModal: React.FC<AutoSetupLoanModalProps> = ({
  products,
  sales,
  onClose,
  onApply,
}) => {
  const [step, setStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AutoSetupResult | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<AutoSetupVariant | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Bank Terms
  const [bankOffer, setBankOffer] = useState<BankLoanOffer>({
    bankName: '',
    annualRate: 18,
    rateType: 'fixed',
    referenceRate: 'SOFR',
    spreadBps: 250,
    originationFeeBps: 100,
    commitmentFeeBps: 0,
    availableStructures: ['amortized', 'bullet', 'interest_only_then_amortized'],
    availableFrequencies: ['monthly'],
    maxTenureMonths: 24,
    minTenureMonths: 6,
    covenantDscrMin: 1.25,
    covenantLtvMax: 0.8,
  });

  // Step 2: Mode & Objective
  const [mode, setMode] = useState<AutoSetupMode>('quick');
  const [objective, setObjective] = useState<AutoSetupObjective>('balanced');
  const [constraints, setConstraints] = useState<AutoSetupConstraints>({
    maxPrincipal: undefined,
    minPrincipal: undefined,
    maxTenureMonths: undefined,
    maxAnnualRate: undefined,
    minDscr: 1.25,
    maxLtv: 0.8,
    maxSectorConcentrationPct: 35,
  });
  const [customWeights, setCustomWeights] = useState({
    profitWeight: 0.5,
    safetyWeight: 0.5,
    liquidityWeight: 0.3,
  });

  // Step 3: Capital
  const [principalMode, setPrincipalMode] = useState<'auto' | 'manual'>('auto');
  const [manualPrincipal, setManualPrincipal] = useState<number>(0);
  const [lookbackDays, setLookbackDays] = useState<number>(60);

  const canProceedStep1 = useMemo(() => {
    return bankOffer.bankName.trim() &&
      bankOffer.annualRate > 0 &&
      bankOffer.availableStructures.length > 0 &&
      bankOffer.availableFrequencies.length > 0 &&
      bankOffer.maxTenureMonths >= bankOffer.minTenureMonths;
  }, [bankOffer]);

  const canProceedStep2 = useMemo(() => {
    if (mode === 'bounded') {
      return constraints.minDscr !== undefined && constraints.minDscr > 0;
    }
    return true;
  }, [mode, constraints]);

  const canProceedStep3 = useMemo(() => {
    if (principalMode === 'manual') {
      return manualPrincipal > 0;
    }
    return true;
  }, [principalMode, manualPrincipal]);

  const handleNext = () => {
    if (step === 1 && !canProceedStep1) return;
    if (step === 2 && !canProceedStep2) return;
    if (step === 3 && !canProceedStep3) return;
    if (step < 4) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleRunAutoSetup = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    setSelectedVariant(null);

    const params: AutoSetupParams = {
      mode,
      objective,
      bankOffer,
      constraints: Object.keys(constraints).some(k => constraints[k as keyof AutoSetupConstraints] !== undefined) ? constraints : undefined,
      principalMode,
      manualPrincipal: principalMode === 'manual' ? manualPrincipal : undefined,
      lookbackDays,
      customWeights: objective === 'custom' ? customWeights : undefined,
    };

    try {
      const autoResult = runAutoSetup(products, sales, params);
      setResult(autoResult);
      if (autoResult.success && autoResult.variants.length > 0) {
        setSelectedVariant(autoResult.variants[1] || autoResult.variants[0]); // Default to Balanced or first
      }
    } catch (e) {
      setError('Failed to run auto-setup. Please check your inputs and try again.');
    } finally {
      setIsLoading(false);
      setStep(4);
    }
  };

  const handleApply = () => {
    if (selectedVariant && result) {
      onApply(selectedVariant, selectedVariant.simulation);
      onClose();
    }
  };

  const handleRestart = () => {
    setStep(1);
    setResult(null);
    setSelectedVariant(null);
    setError(null);
  };

  if (step === 1) {
    return (
      <ModalWrapper onClose={onClose} title="Auto-Setup Loan" subtitle="Step 1 of 3: Enter your bank's loan offer details">
        <div className="space-y-6 max-h-[70vh] overflow-y-auto">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800 dark:text-blue-200">
              <Info className="w-4 h-4" />
              <span>Enter the loan terms offered by your bank. These will be used to optimize the loan structure.</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Bank Name</label>
              <input
                type="text"
                value={bankOffer.bankName}
                onChange={e => setBankOffer({ ...bankOffer, bankName: e.target.value })}
                placeholder="e.g., First Bank, Access Bank"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Annual Interest Rate (%)</label>
              <input
                type="number"
                value={bankOffer.annualRate}
                onChange={e => setBankOffer({ ...bankOffer, annualRate: Math.max(0, Number(e.target.value)) })}
                step={0.1}
                min={0}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Rate Type</label>
              <select
                value={bankOffer.rateType}
                onChange={e => setBankOffer({ ...bankOffer, rateType: e.target.value as 'fixed' | 'floating' })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="fixed">Fixed Rate</option>
                <option value="floating">Floating Rate</option>
              </select>
            </div>

            {bankOffer.rateType === 'floating' && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Reference Rate</label>
                  <input
                    type="text"
                    value={bankOffer.referenceRate || ''}
                    onChange={e => setBankOffer({ ...bankOffer, referenceRate: e.target.value })}
                    placeholder="e.g., SOFR, Prime"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Spread (bps)</label>
                  <input
                    type="number"
                    value={bankOffer.spreadBps || 0}
                    onChange={e => setBankOffer({ ...bankOffer, spreadBps: Math.max(0, Number(e.target.value)) })}
                    step={1}
                    min={0}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Origination Fee (bps)</label>
              <input
                type="number"
                value={bankOffer.originationFeeBps}
                onChange={e => setBankOffer({ ...bankOffer, originationFeeBps: Math.max(0, Number(e.target.value)) })}
                step={1}
                min={0}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Commitment Fee (bps/yr)</label>
              <input
                type="number"
                value={bankOffer.commitmentFeeBps || 0}
                onChange={e => setBankOffer({ ...bankOffer, commitmentFeeBps: Math.max(0, Number(e.target.value)) })}
                step={1}
                min={0}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Available Repayment Structures</label>
              <div className="flex flex-wrap gap-2">
                {(['bullet', 'amortized', 'interest_only_then_amortized', 'lump_sum'] as LoanRepaymentStructure[]).map(s => (
                  <label key={s} className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm cursor-pointer hover:border-blue-500">
                    <input
                      type="checkbox"
                      checked={bankOffer.availableStructures.includes(s)}
                      onChange={e => setBankOffer({
                        ...bankOffer,
                        availableStructures: e.target.checked
                          ? [...bankOffer.availableStructures, s]
                          : bankOffer.availableStructures.filter(x => x !== s)
                      })}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <span className="text-slate-700 dark:text-slate-300">{STRUCTURE_LABELS[s]}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Available Payment Frequencies</label>
              <div className="flex flex-wrap gap-2">
                {(['monthly', 'quarterly', 'semi_annual'] as LoanRepaymentFrequency[]).map(f => (
                  <label key={f} className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm cursor-pointer hover:border-blue-500">
                    <input
                      type="checkbox"
                      checked={bankOffer.availableFrequencies.includes(f)}
                      onChange={e => setBankOffer({
                        ...bankOffer,
                        availableFrequencies: e.target.checked
                          ? [...bankOffer.availableFrequencies, f]
                          : bankOffer.availableFrequencies.filter(x => x !== f)
                      })}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <span className="text-slate-700 dark:text-slate-300">{FREQUENCY_LABELS[f]}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Min Tenure (months)</label>
              <input
                type="number"
                value={bankOffer.minTenureMonths}
                onChange={e => setBankOffer({ ...bankOffer, minTenureMonths: Math.max(1, Number(e.target.value)) })}
                step={1}
                min={1}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Max Tenure (months)</label>
              <input
                type="number"
                value={bankOffer.maxTenureMonths}
                onChange={e => setBankOffer({ ...bankOffer, maxTenureMonths: Math.max(bankOffer.minTenureMonths, Number(e.target.value)) })}
                step={1}
                min={bankOffer.minTenureMonths}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Covenant: Min DSCR</label>
              <input
                type="number"
                value={bankOffer.covenantDscrMin || ''}
                onChange={e => setBankOffer({ ...bankOffer, covenantDscrMin: e.target.value ? Number(e.target.value) : undefined })}
                step={0.05}
                min={0}
                placeholder="Optional"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Covenant: Max LTV</label>
              <input
                type="number"
                value={bankOffer.covenantLtvMax || ''}
                onChange={e => setBankOffer({ ...bankOffer, covenantLtvMax: e.target.value ? Number(e.target.value) : undefined })}
                step={0.05}
                min={0}
                max={1}
                placeholder="Optional"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
        <ModalFooter onBack={handleBack} onNext={handleNext} canProceed={canProceedStep1} isLastStep={false} />
      </ModalWrapper>
    );
  }

  if (step === 2) {
    return (
      <ModalWrapper onClose={onClose} title="Auto-Setup Loan" subtitle="Step 2 of 3: Choose optimization mode and objective">
        <div className="space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Mode Selection */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-3">Optimization Mode</label>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(MODE_CONFIG).map(([key, config]) => {
                const Icon = config.icon;
                const isSelected = mode === key;
                return (
                  <button
                    key={key}
                    onClick={() => setMode(key as AutoSetupMode)}
                    className={`p-4 rounded-xl border-2 transition-all relative ${
                      isSelected
                        ? `border-blue-500 bg-blue-50 dark:bg-blue-950/30 ring-2 ring-blue-500/20`
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`w-5 h-5 ${config.color}`} />
                    </div>
                    <div className="font-bold text-sm text-slate-900 dark:text-white">{config.label}</div>
                    <div className="text-xs text-slate-500 mt-1">{config.description}</div>
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-[10px]">
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Objective Selection */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-3">
              {mode === 'quick' ? 'Objective (Quick Auto uses Balanced)' : 'Optimization Objective'}
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(OBJECTIVE_CONFIG).map(([key, config]) => {
                const isSelected = mode !== 'quick' && objective === key;
                const isDisabled = mode === 'quick';
                return (
                  <button
                    key={key}
                    onClick={() => !isDisabled && setObjective(key as AutoSetupObjective)}
                    disabled={isDisabled}
                    className={`p-4 rounded-xl border-2 transition-all relative ${isDisabled ? 'opacity-60 cursor-not-allowed' : ''} ${
                      isSelected
                        ? `border-${config.color.replace('text-', '')}-500 bg-${config.color.replace('text-', '')}-50 dark:bg-${config.color.replace('text-', '')}-950/30 ring-2 ring-${config.color.replace('text-', '')}-500/20`
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <config.icon className={`w-5 h-5 ${config.color}`} />
                    </div>
                    <div className="font-bold text-sm text-slate-900 dark:text-white">{config.label}</div>
                    <div className="text-xs text-slate-500 mt-1">{config.description}</div>
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-[10px]">
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Weights */}
          {mode !== 'quick' && objective === 'custom' && (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-4">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Custom Weights (must sum to ~1.0)</label>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Profit Weight</label>
                  <input
                    type="number"
                    value={customWeights.profitWeight}
                    onChange={e => setCustomWeights({ ...customWeights, profitWeight: Math.max(0, Math.min(1, Number(e.target.value))) })}
                    step={0.1}
                    min={0}
                    max={1}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Safety Weight</label>
                  <input
                    type="number"
                    value={customWeights.safetyWeight}
                    onChange={e => setCustomWeights({ ...customWeights, safetyWeight: Math.max(0, Math.min(1, Number(e.target.value))) })}
                    step={0.1}
                    min={0}
                    max={1}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Liquidity Weight</label>
                  <input
                    type="number"
                    value={customWeights.liquidityWeight}
                    onChange={e => setCustomWeights({ ...customWeights, liquidityWeight: Math.max(0, Math.min(1, Number(e.target.value))) })}
                    step={0.1}
                    min={0}
                    max={1}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Sum: {(customWeights.profitWeight + customWeights.safetyWeight + customWeights.liquidityWeight).toFixed(1)}
              </div>
            </div>
          )}

          {/* Bounded Constraints */}
          {mode === 'bounded' && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl space-y-4">
              <label className="text-xs font-bold text-amber-800 dark:text-amber-200 block">Hard Constraints (optimization will not exceed these)</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Max Principal</label>
                  <input
                    type="number"
                    value={constraints.maxPrincipal || ''}
                    onChange={e => setConstraints({ ...constraints, maxPrincipal: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="Optional"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Max Tenure (months)</label>
                  <input
                    type="number"
                    value={constraints.maxTenureMonths || ''}
                    onChange={e => setConstraints({ ...constraints, maxTenureMonths: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="Optional"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Min DSCR</label>
                  <input
                    type="number"
                    value={constraints.minDscr || ''}
                    onChange={e => setConstraints({ ...constraints, minDscr: e.target.value ? Number(e.target.value) : undefined })}
                    step={0.05}
                    min={0}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Max LTV</label>
                  <input
                    type="number"
                    value={constraints.maxLtv || ''}
                    onChange={e => setConstraints({ ...constraints, maxLtv: e.target.value ? Number(e.target.value) : undefined })}
                    step={0.05}
                    min={0}
                    max={1}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Max Sector Concentration %</label>
                  <input
                    type="number"
                    value={constraints.maxSectorConcentrationPct || ''}
                    onChange={e => setConstraints({ ...constraints, maxSectorConcentrationPct: e.target.value ? Number(e.target.value) : undefined })}
                    step={1}
                    min={0}
                    max={100}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <ModalFooter onBack={handleBack} onNext={handleNext} canProceed={canProceedStep2} isLastStep={false} nextLabel="Next: Capital" />
      </ModalWrapper>
    );
  }

  if (step === 3) {
    return (
      <ModalWrapper onClose={onClose} title="Auto-Setup Loan" subtitle="Step 3 of 3: Capital amount and lookback settings">
        <div className="space-y-6 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-3">Loan Principal</label>
            <div className="space-y-3">
              <label className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer bg-slate-50/50 dark:bg-slate-800/40 hover:border-slate-300">
                <input
                  type="radio"
                  name="principalMode"
                  checked={principalMode === 'auto'}
                  onChange={() => setPrincipalMode('auto')}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <div className="font-bold text-slate-900 dark:text-white">Auto-Calculate Optimal</div>
                  <div className="text-xs text-slate-500">System determines optimal loan size based on stock opportunity and turnover</div>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer bg-slate-50/50 dark:bg-slate-800/40 hover:border-slate-300">
                <input
                  type="radio"
                  name="principalMode"
                  checked={principalMode === 'manual'}
                  onChange={() => setPrincipalMode('manual')}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex-1 flex items-center gap-3">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">Manual Amount</div>
                    <div className="text-xs text-slate-500">Specify exact loan amount you want</div>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">₦</span>
                    <input
                      type="number"
                      value={manualPrincipal}
                      onChange={e => setManualPrincipal(Math.max(0, Number(e.target.value)))}
                      step={100000}
                      min={0}
                      className="w-48 pl-8 pr-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-4">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Sales Lookback Period</label>
            <select
              value={lookbackDays}
              onChange={e => setLookbackDays(Number(e.target.value))}
              className="w-full md:w-48 px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={14}>14 Days (2 weeks)</option>
              <option value={30}>30 Days (1 month)</option>
              <option value={60}>60 Days (2 months)</option>
              <option value={90}>90 Days (3 months)</option>
              <option value={180}>180 Days (6 months)</option>
              <option value={0}>All Time</option>
            </select>
            <p className="text-xs text-slate-500">How much sales history to use for velocity and volatility calculations</p>
          </div>
        </div>
        <ModalFooter onBack={handleBack} onNext={handleNext} canProceed={canProceedStep3} isLastStep={true} nextLabel="Run Auto-Setup" onNextClick={handleRunAutoSetup} nextIcon={Sparkles} />
      </ModalWrapper>
    );
  }

  // Step 4: Results
  return (
    <ModalWrapper
      onClose={onClose}
      title="Auto-Setup Results"
      subtitle={result?.success ? `${result.variants.length} variant${result.variants.length > 1 ? 's' : ''} generated` : 'No viable scenario found'}
      isWide
    >
      <div className="space-y-6 max-h-[75vh] overflow-y-auto">
        {error && (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-5 h-5 inline-block mr-2" />
            {error}
          </div>
        )}

        {!error && !result && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="ml-3 text-slate-600 dark:text-slate-400">Running optimization...</span>
          </div>
        )}

        {result && !result.success && (
          <div className="text-center py-8">
            <AlertCircle className="w-16 h-16 mx-auto text-rose-500 mb-4" />
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">No Viable Scenario Found</h3>
            <p className="text-slate-600 dark:text-slate-400 mb-4">{result.explanation}</p>
            {result.analysis.warnings.length > 0 && (
              <div className="text-left p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl">
                <div className="font-bold text-rose-800 dark:text-rose-200 mb-2">Warnings:</div>
                <ul className="text-sm text-rose-700 dark:text-rose-300 space-y-1">
                  {result.analysis.warnings.map((w, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              onClick={handleRestart}
              className="px-6 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-sm"
            >
              <RotateCcw className="w-4 h-4 inline mr-1" />
              Try Again with Different Settings
            </button>
          </div>
        )}

        {result && result.success && (
          <>
            {result.relaxedFromConstraints && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                  <AlertCircle className="w-4 h-4" />
                  <span className="font-bold text-sm">Constraints Relaxed:</span>
                  <span className="text-sm">One or more strict constraints were relaxed to find a viable scenario.</span>
                </div>
              </div>
            )}

            {result.explanation && (
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">
                {result.explanation}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {result.variants.map((variant, index) => {
                const isSelected = selectedVariant === variant;
                const riskColor = variant.riskRating === 'Low' ? 'emerald' : variant.riskRating === 'Medium' ? 'amber' : 'rose';
                return (
                  <div
                    key={variant.label}
                    onClick={() => setSelectedVariant(variant)}
                    className={`p-4 rounded-xl border-2 transition-all cursor-pointer relative ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 ring-2 ring-blue-500/20'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold bg-${riskColor}-100 text-${riskColor}-700 dark:bg-${riskColor}-950 dark:text-${riskColor}-300`}>
                            {variant.label}
                          </span>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-blue-500" />
                          )}
                        </div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">{variant.description}</div>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Principal</span>
                        <span className="font-bold font-mono text-slate-900 dark:text-white">₦{variant.principal.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Tenure</span>
                        <span className="font-bold font-mono text-slate-900 dark:text-white">{variant.tenureMonths} months</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Net Profit</span>
                        <span className={`font-bold font-mono ${variant.projectedNetProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {variant.projectedNetProfit >= 0 ? '+' : ''}₦{variant.projectedNetProfit.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Min DSCR</span>
                        <span className={`font-bold font-mono ${variant.projectedDscr >= 1.5 ? 'text-emerald-600' : variant.projectedDscr >= 1.2 ? 'text-amber-600' : 'text-rose-600'}`}>
                          {variant.projectedDscr.toFixed(2)}x
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">LTV</span>
                        <span className={`font-bold font-mono ${variant.projectedLtv <= 0.5 ? 'text-emerald-600' : variant.projectedLtv <= 0.7 ? 'text-amber-600' : 'text-rose-600'}`}>
                          {(variant.projectedLtv * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Risk</span>
                        <span className={`font-bold text-${riskColor}-600 dark:text-${riskColor}-400`}>{variant.riskRating}</span>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-1 text-[10px] text-slate-500">
                        <Sparkles className="w-3 h-3" />
                        <span>Score: {variant.score.toFixed(0)}</span>
                        <span className="mx-1">|</span>
                        <span>Strategy: {variant.stockStrategy.replace('_', ' ')}</span>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500 rounded-b-xl" />
                    )}
                  </div>
                );
              })}
            </div>

            {selectedVariant && (
              <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-blue-800 dark:text-blue-200">Selected: {selectedVariant.label} Variant</div>
                    <div className="text-sm text-blue-700 dark:text-blue-300">₦{selectedVariant.principal.toLocaleString()} • {selectedVariant.tenureMonths} months • Min DSCR: {selectedVariant.projectedDscr.toFixed(2)}x</div>
                  </div>
                  <button
                    onClick={handleApply}
                    disabled={isLoading}
                    className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg font-semibold text-sm shadow-md disabled:opacity-50"
                  >
                    Apply to Simulator
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <ModalFooter
        onBack={handleBack}
        onNext={handleApply}
        canProceed={!!selectedVariant && result?.success}
        isLastStep={true}
        nextLabel="Apply to Simulator"
        showBack={!!result?.success}
      />
    </ModalWrapper>
  );
};

// Helper Components
interface ModalWrapperProps {
  onClose: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  isWide?: boolean;
}

const ModalWrapper: React.FC<ModalWrapperProps> = ({ onClose, title, subtitle, children, isWide }) => (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div className={`bg-white dark:bg-slate-900 rounded-2xl shadow-xl ${isWide ? 'max-w-4xl' : 'max-w-lg'} w-full max-h-[90vh] flex flex-col animate-in zoom-in duration-200`}>
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500">✕</button>
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  </div>
);

interface ModalFooterProps {
  onBack: () => void;
  onNext: () => void;
  onNextClick?: () => void;
  nextIcon?: React.ComponentType<{ className?: string }>;
  canProceed: boolean;
  isLastStep: boolean;
  nextLabel?: string;
  showBack?: boolean;
}

const ModalFooter: React.FC<ModalFooterProps> = ({
  onBack,
  onNext,
  onNextClick,
  nextIcon,
  canProceed,
  isLastStep,
  nextLabel = 'Next',
  showBack = true,
}) => {
  const NextIconComponent = nextIcon;
  return (
    <div className="flex items-center justify-between p-4 border-t border-slate-200 dark:border-slate-800">
      {showBack && (
        <button
          onClick={onBack}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-sm flex items-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
      )}
      <div className="flex-1" />
      <button
        onClick={onNextClick || onNext}
        disabled={!canProceed}
        className={`flex items-center gap-2 px-6 py-2 rounded-lg font-semibold text-sm transition-all ${
          canProceed
            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md'
            : 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
        }`}
      >
        {nextLabel}
        {isLastStep ? null : <ChevronRight className="w-4 h-4" />}
        {NextIconComponent && <NextIconComponent className="w-4 h-4" />}
      </button>
    </div>
  );
};

export default AutoSetupLoanModal;