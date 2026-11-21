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
  customProductAllocations?: Record<string, number>;
}

export interface ActiveCampaignProduct {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  costPrice: number;
  retailPrice: number;
  marginPerUnit: number;
  marginPct: number;
  initialTargetQty: number;
  currentTargetQty: number;
  projectedDailyVelocity: number;
  initialAllocatedCapital: number;
  currentAllocatedCapital: number;
  isSubstitutedOut?: boolean;
  substitutedAt?: string;
  replacementProductId?: string;
}

export interface CampaignSkuSubstitution {
  id: string;
  substitutedAt: string;
  reason: 'slow_velocity' | 'tenure_overrun' | 'manual_optimization';
  outgoingProductId: string;
  outgoingProductName: string;
  outgoingOriginalTargetQty: number;
  outgoingRealizedUnitsSold: number;
  outgoingCapitalFreed: number;
  outgoingRealizedGrossProfit: number;
  incomingProductId: string;
  incomingProductName: string;
  incomingTargetQty: number;
  incomingCostPrice: number;
  incomingRetailPrice: number;
  incomingProjectedVelocity: number;
  projectedAdditionalProfit: number;
}

export interface CampaignMilestone {
  periodIndex: number;
  periodLabel: string;
  dueDate: string;
  principalDue: number;
  returnDue: number;
  totalDue: number;
  cumulativePayoutDue: number;
  status: 'pending' | 'due' | 'settled';
  settledAt?: string;
  settledAmount?: number;
  settledNotes?: string;
}

export interface ActiveInvestmentCampaign {
  id: string;
  scenarioId?: string;
  name: string;
  investorName?: string;
  investorContact?: string;
  status: 'active' | 'paused' | 'completed';
  createdAt: string;
  startedAt: string;
  tenureMonths: number;
  targetMaturityDate: string;
  completedAt?: string;
  investmentAmount: number;
  payoutFrequency: PayoutFrequency;
  returnModel: ReturnModel;
  repaymentStructure: RepaymentStructure;
  yieldRate: number;
  strategy: AllocationStrategy;
  allocatedProducts: ActiveCampaignProduct[];
  milestones: CampaignMilestone[];
  substitutionHistory: CampaignSkuSubstitution[];
  notes?: string;
}

export interface ProductLiveTracking {
  product: ActiveCampaignProduct;
  unitsSold: number;
  remainingUnits: number;
  sellThroughPct: number;
  grossRevenue: number;
  cogsRecovered: number;
  realizedGrossProfit: number;
  actualDailyVelocity: number;
  velocityRealizationRatio: number; // actual / projected
  daysElapsed: number;
  estimatedDaysToDeplete: number;
  estimatedDepletionDate: string;
  isTenureOverrun: boolean;
  isUnderperforming: boolean;
  underperformanceReason?: string;
}

export interface CampaignAttributedSale {
  saleId: string;
  invoiceNo: string;
  saleDate: string;
  customerName: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  totalRevenue: number;
  totalCogs: number;
  realizedProfit: number;
  investorAccruedCut: number;
}

export interface SkuReplacementCandidate {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  costPrice: number;
  retailPrice: number;
  marginPerUnit: number;
  marginPct: number;
  dailyVelocity: number;
  affordableUnits: number;
  recommendedUnits: number;
  projectedBatchCost: number;
  projectedBatchRevenue: number;
  projectedBatchProfit: number;
  runOutDays: number;
  compositeScore: number;
  velocityMultiplier: number;
  profitBoostDelta: number;
  turnoverDaysSaved: number;
  confidenceRating: 'High' | 'Moderate';
}

export interface CampaignLiveProgress {
  campaign: ActiveInvestmentCampaign;
  daysElapsed: number;
  totalTenureDays: number;
  daysRemaining: number;
  progressPct: number; // time elapsed %
  totalRevenueGenerated: number;
  totalPrincipalRecovered: number;
  principalPaybackPct: number;
  isPrincipalRecovered: boolean;
  principalBreakEvenDate?: string;
  totalRealizedGrossProfit: number;
  investorAccruedReturn: number;
  businessRetainedProfit: number;
  totalSettledPayouts: number;
  pendingObligation: number;
  debtServiceCoverageRatio: number;
  coverageRating: 'Safe' | 'Healthy' | 'Caution';
  healthStatus: 'Ahead of Pace' | 'On Track' | 'At Risk';
  healthReason: string;
  productTrackings: ProductLiveTracking[];
  attributedSales: CampaignAttributedSale[];
  flaggedDragProducts: { tracking: ProductLiveTracking; reason: string }[];
  replacementRecommendations: Record<string, SkuReplacementCandidate[]>;
}
