export type LoanType = 'term_loan' | 'revolving_credit' | 'bridge_loan';
export type InterestRateType = 'fixed' | 'floating';
export type LoanRepaymentStructure = 'bullet' | 'amortized' | 'interest_only_then_amortized' | 'lump_sum';
export type LoanRepaymentFrequency = 'monthly' | 'quarterly' | 'semi_annual';
export type StockAllocationStrategy = 'dividend_focus' | 'growth_focus' | 'balanced' | 'low_volatility' | 'high_conviction';

export interface AllocationConfig {
  maxStocks: number;
  minStocks: number;
  maxSectorPct: number;
  liquidityFactor: number;
  tenureBufferPct: number;
  minDailyVelocity: number;
}

export const DEFAULT_ALLOCATION_CONFIG: AllocationConfig = {
  maxStocks: 15,
  minStocks: 5,
  maxSectorPct: 35,
  liquidityFactor: 1.0,
  tenureBufferPct: 1.2,
  minDailyVelocity: 0.05,
};

export interface LoanTranche {
  id: string;
  name: string;
  type: LoanType;
  principal: number;
  interestRate: number;
  interestRateType: InterestRateType;
  referenceRate?: string;
  spreadBps?: number;
  tenureMonths: number;
  repaymentStructure: LoanRepaymentStructure;
  repaymentFrequency: LoanRepaymentFrequency;
  interestOnlyMonths?: number;
  originationFeeBps?: number;
  commitmentFeeBps?: number;
  covenantDscrMin?: number;
  covenantLtvMax?: number;
}

export interface SavedLoanScenario {
  id: string;
  name: string;
  createdAt: string;
  tranches: LoanTranche[];
  totalPrincipal: number;
  blendedRate: number;
  stockStrategy: StockAllocationStrategy;
  lookbackDays: number;
  customStockAllocations?: Record<string, number>;
}

export interface StockMetrics {
  productId: string;
  symbol: string;
  name: string;
  sector: string;
  purchasePrice: number;
  currentPrice: number;
  expectedReturnPct: number;
  volatilityProxy: number;
  dividendYield: number;
  priceAppreciation: number;
  beta: number;
  maxAllocationPct: number;
  liquidityScore: number;
  historicalVolatility: number;
  avgDailyVolume: number;
  // Allocation engine fields
  maxSharesByLiquidity: number;
  maxSharesByTenure: number;
  runOutDays: number;
  turnoverCycles: number;
}

export interface StockAllocation {
  productId: string;
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  allocatedCapital: number;
  currentValue: number;
  expectedMonthlyDividend: number;
  expectedMonthlyAppreciation: number;
  expectedMonthlyReturn: number;
  weightPct: number;
  volatilityContribution: number;
  annualizedReturn: number;
  sharpeRatio: number;
  // Allocation engine fields
  runOutDays: number;
  turnoverCycles: number;
  maxSharesByLiquidity: number;
  maxSharesByTenure: number;
}

export interface LoanMilestone {
  periodIndex: number;
  periodLabel: string;
  dueDate: string;
  principalDue: number;
  interestDue: number;
  feesDue: number;
  totalLoanPayment: number;
  cumulativeLoanPayment: number;
  outstandingPrincipal: number;
  portfolioDividends: number;
  portfolioSalesProceeds: number;
  totalPortfolioCashInflow: number;
  dscr: number;
  interestCoverage: number;
  netCashFlow: number;
  cumulativeNetCashFlow: number;
  covenantBreach: boolean;
  breachType?: 'dscr' | 'ltv' | 'concentration';
}

export interface RiskMetrics {
  averageDscr: number;
  minDscr: number;
  dscrRating: 'Strong' | 'Adequate' | 'Weak' | 'Breach';
  initialLtv: number;
  projectedMinLtv: number;
  ltvRating: 'Conservative' | 'Moderate' | 'Aggressive' | 'Breach';
  averageInterestCoverage: number;
  minInterestCoverage: number;
  maxSinglePositionPct: number;
  sectorConcentration: Record<string, number>;
  hhiIndex: number;
  portfolioVar95: number;
  maxDrawdownEstimate: number;
  stressTestResults: {
    rateShock200bps: { dscr: number; netCashFlow: number; };
    marketDrop30pct: { ltv: number; portfolioValue: number; };
    combinedShock: { dscr: number; ltv: number; };
  };
}

export interface LoanModelComparisonItem {
  label: string;
  description: string;
  totalLoanCost: number;
  totalPortfolioReturn: number;
  netBenefit: number;
  averageDscr: number;
  minDscr: number;
  riskRating: 'Low' | 'Medium' | 'High';
  recommended?: boolean;
}

export interface LoanSimulationResult {
  scenarioId?: string;
  scenarioName?: string;
  tranches: LoanTranche[];
  totalPrincipal: number;
  blendedAnnualRate: number;
  tenureMonths: number;
  stockAllocations: StockAllocation[];
  totalAllocatedCapital: number;
  unallocatedCapital: number;
  portfolioExpectedMonthlyReturn: number;
  portfolioExpectedAnnualReturn: number;
  portfolioDividendYield: number;
  portfolioVolatility: number;
  schedule: LoanMilestone[];
  totalLoanPayments: number;
  totalPortfolioInflows: number;
  netCashFlowOverTenure: number;
  riskMetrics: RiskMetrics;
  comparison: LoanModelComparisonItem[];
}

export interface CampaignStockHolding {
  productId: string;
  symbol: string;
  name: string;
  sector: string;
  initialShares: number;
  currentShares: number;
  purchasePrice: number;
  currentPrice: number;
  initialAllocatedCapital: number;
  currentAllocatedCapital: number;
  isSubstitutedOut: boolean;
  substitutedAt?: string;
  replacementProductId?: string;
  realizedDividends: number;
  realizedGains: number;
  unrealizedPnL: number;
}

export interface LoanCampaignMilestone {
  periodIndex: number;
  periodLabel: string;
  dueDate: string;
  principalDue: number;
  interestDue: number;
  totalDue: number;
  cumulativeDue: number;
  status: 'pending' | 'due' | 'paid' | 'overdue';
  paidAt?: string;
  paidAmount?: number;
  paidFrom?: 'dividends' | 'sales' | 'external';
  notes?: string;
}

export interface ActiveLoanCampaign {
  id: string;
  scenarioId?: string;
  name: string;
  borrowerName?: string;
  lenderName?: string;
  status: 'active' | 'paused' | 'completed' | 'in_default';
  createdAt: string;
  startedAt: string;
  completedAt?: string;
  tranches: LoanTranche[];
  totalPrincipal: number;
  stockHoldings: CampaignStockHolding[];
  milestones: LoanCampaignMilestone[];
  substitutionHistory: CampaignStockSubstitution[];
  notes?: string;
}

export interface CampaignStockSubstitution {
  id: string;
  substitutedAt: string;
  reason: 'stop_loss' | 'take_profit' | 'sector_rotation' | 'covenant_cure' | 'manual';
  outgoingProductId: string;
  outgoingSymbol: string;
  outgoingShares: number;
  outgoingProceeds: number;
  outgoingRealizedPnL: number;
  incomingProductId: string;
  incomingSymbol: string;
  incomingShares: number;
  incomingCost: number;
  projectedBenefit: number;
}

export interface CampaignLiveProgress {
  campaign: ActiveLoanCampaign;
  daysElapsed: number;
  totalTenureDays: number;
  progressPct: number;
  portfolioValue: number;
  totalDividendsReceived: number;
  totalRealizedGains: number;
  totalUnrealizedPnL: number;
  totalPortfolioReturn: number;
  portfolioReturnPct: number;
  totalPrincipalPaid: number;
  totalInterestPaid: number;
  totalFeesPaid: number;
  totalLoanServicePaid: number;
  principalPaydownPct: number;
  nextPaymentDue: number;
  nextPaymentDate: string;
  paymentsOverdue: number;
  currentDscr: number;
  currentInterestCoverage: number;
  currentLtv: number;
  covenantStatus: 'Compliant' | 'Watch' | 'Breach';
  covenantBreaches: string[];
  healthStatus: 'Ahead' | 'On Track' | 'At Risk' | 'Critical';
  healthReason: string;
  holdingTrackings: CampaignStockTracking[];
  flaggedHoldings: { tracking: CampaignStockTracking; reason: string }[];
  substitutionRecommendations: Record<string, StockSubstitutionCandidate[]>;
  attributedDividends: CampaignAttributedDividend[];
  attributedSales: CampaignAttributedSale[];
}

export interface CampaignStockTracking {
  holding: CampaignStockHolding;
  currentValue: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  dividendsReceived: number;
  totalReturn: number;
  totalReturnPct: number;
  daysHeld: number;
  annualizedReturn: number;
  isUnderperforming: boolean;
  underperformanceReason?: string;
}

export interface StockSubstitutionCandidate {
  productId: string;
  symbol: string;
  name: string;
  sector: string;
  currentPrice: number;
  expectedReturn: number;
  volatility: number;
  affordableShares: number;
  recommendedShares: number;
  projectedAdditionalReturn: number;
  riskReduction: number;
  confidenceRating: 'High' | 'Moderate';
}

export interface CampaignAttributedDividend {
  date: string;
  productId: string;
  symbol: string;
  shares: number;
  dividendPerShare: number;
  totalDividend: number;
  appliedToLoanPayment: boolean;
  loanPaymentPeriod?: number;
}

export interface CampaignAttributedSale {
  saleId: string;
  date: string;
  productId: string;
  symbol: string;
  shares: number;
  price: number;
  proceeds: number;
  costBasis: number;
  realizedGain: number;
  appliedToLoanPayment: boolean;
  loanPaymentPeriod?: number;
}

// ============================================
// AUTO-SETUP LOAN TYPES
// ============================================

export type AutoSetupMode = 'quick' | 'objective' | 'bounded';
export type AutoSetupObjective = 'max_profit' | 'max_safety' | 'balanced' | 'custom';

export interface BankLoanOffer {
  bankName: string;
  annualRate: number;
  rateType: 'fixed' | 'floating';
  referenceRate?: string;
  spreadBps?: number;
  originationFeeBps: number;
  commitmentFeeBps?: number;
  availableStructures: LoanRepaymentStructure[];
  availableFrequencies: LoanRepaymentFrequency[];
  maxTenureMonths: number;
  minTenureMonths: number;
  covenantDscrMin?: number;
  covenantLtvMax?: number;
}

export interface AutoSetupConstraints {
  maxPrincipal?: number;
  minPrincipal?: number;
  maxTenureMonths?: number;
  maxAnnualRate?: number;
  minDscr?: number;
  maxLtv?: number;
  maxSectorConcentrationPct?: number;
}

export interface AutoSetupParams {
  mode: AutoSetupMode;
  objective: AutoSetupObjective;
  bankOffer: BankLoanOffer;
  constraints?: AutoSetupConstraints;
  principalMode: 'auto' | 'manual';
  manualPrincipal?: number;
  lookbackDays: number;
  customWeights?: {
    profitWeight: number;
    safetyWeight: number;
    liquidityWeight: number;
  };
}

export interface AutoSetupResult {
  success: boolean;
  variants: AutoSetupVariant[];
  explanation: string;
  relaxedFromConstraints?: boolean;
  analysis: SalesOpportunityAnalysis;
}

export interface AutoSetupVariant {
  label: 'Conservative' | 'Balanced' | 'Aggressive';
  description: string;
  tranches: LoanTranche[];
  stockStrategy: StockAllocationStrategy;
  principal: number;
  tenureMonths: number;
  projectedNetProfit: number;
  projectedDscr: number;
  projectedLtv: number;
  riskRating: 'Low' | 'Medium' | 'High';
  score: number;
  simulation: LoanSimulationResult;
}

export interface SalesOpportunityAnalysis {
  totalDeployableCapital: number;
  topSectors: { sector: string; opportunity: number }[];
  avgStockReturn: number;
  avgStockVolatility: number;
  liquidityScore: number;
  recommendedMaxPrincipal: number;
  recommendedTenureMonths: number;
  warnings: string[];
}