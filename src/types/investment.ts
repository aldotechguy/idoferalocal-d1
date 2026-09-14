export type ReturnModel = 'fixed_yield' | 'flat_roi' | 'profit_share';

export type RepaymentStructure = 'bullet_maturity' | 'amortized_installments' | 'lump_sum_end';

export type PayoutFrequency = 'monthly' | 'bi_monthly' | 'end_of_tenure';

export type AllocationStrategy = 'fast_turnover' | 'max_profit' | 'balanced';

export interface AllocatedProduct {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  costPrice: number;
  retailPrice: number;
  marginPerUnit: number;
  marginPct: number;
  dailyVelocity: number;
  runOutDays: number;
  recommendedQty: number;
  allocatedCapital: number;
  projectedRevenue: number;
  projectedGrossProfit: number;
  turnoverCycles: number;
  historicalUnitsSold60d?: number;
  historicalUnitsSold?: number;
  lookbackDaysUsed?: number;
}

export interface MilestonePayout {
  periodIndex: number;
  periodLabel: string;
  dueDate: string;
  principalDue: number;
  returnDue: number;
  totalPayout: number;
  cumulativePayout: number;
  projectedCashInflow: number;
  projectedRetainedSurplus: number;
}

export interface ReturnModelComparisonItem {
  model: ReturnModel;
  label: string;
  description: string;
  investorTotalReturn: number;
  investorEffectiveROI: number;
  totalPayout: number;
  businessRetainedProfit: number;
  coverageRatio: number;
  coverageRating: 'Safe' | 'Healthy' | 'Caution';
  recommended?: boolean;
}

export interface InvestmentSimulationResult {
  investmentAmount: number;
  tenureMonths: number;
  payoutFrequency: PayoutFrequency;
  returnModel: ReturnModel;
  repaymentStructure: RepaymentStructure;
  yieldRate: number; // e.g. 2.5% monthly or 15% flat or 25% profit share
  totalAllocatedCapital: number;
  unallocatedCapital: number;
  projectedGrossRevenue: number;
  projectedGrossProfit: number;
  totalInvestorReturn: number;
  totalInvestorPayout: number; // Principal + Return
  netBusinessProfit: number;
  coverageRatio: number;
  coverageRating: 'Safe' | 'Healthy' | 'Caution';
  lookbackDays: number;
  salesAnalyzedCount?: number;
  allocatedProducts: AllocatedProduct[];
  schedule: MilestonePayout[];
  comparison: ReturnModelComparisonItem[];
}

export interface SavedSimulation {
  id: string;
  name: string;
  createdAt: string;
  investmentAmount: number;
  tenureMonths: number;
  payoutFrequency: PayoutFrequency;
  returnModel: ReturnModel;
  repaymentStructure: RepaymentStructure;
  yieldRate: number;
  strategy: AllocationStrategy;
  lookbackDays?: number;
}
