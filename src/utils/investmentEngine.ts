import { Product, Sale } from '../types';
import {
  AllocationStrategy,
  AllocatedProduct,
  MilestonePayout,
  PayoutFrequency,
  RepaymentStructure,
  ReturnModel,
  ReturnModelComparisonItem,
  InvestmentSimulationResult,
  ActiveCampaignProduct,
  ActiveInvestmentCampaign,
  CampaignAttributedSale,
  CampaignLiveProgress,
  CampaignMilestone,
  CampaignSkuSubstitution,
  ProductLiveTracking,
  SkuReplacementCandidate,
} from '../types/investment';

export interface CalculationParams {
  investmentAmount: number;
  tenureMonths: number;
  payoutFrequency: PayoutFrequency;
  returnModel: ReturnModel;
  repaymentStructure: RepaymentStructure;
  yieldRate: number; // percentage (e.g. 2.5 for 2.5% monthly, or 15 for 15% flat, or 25 for 25% profit share)
  strategy: AllocationStrategy;
  customProductAllocations?: Record<string, number>; // optional override quantity per productId
  lookbackDays?: number; // e.g. 14, 30, 60, 90, 180, or 0 (All Time)
}

/**
 * Computes historical unit sales and daily velocity over the specified lookback days
 */
export function calculateSalesVelocity(
  sales: Sale[],
  products: Product[],
  lookbackDays = 60
): {
  velocityMap: Record<string, { unitsSold: number; dailyVelocity: number; revenue: number }>;
  effectiveLookbackDays: number;
  salesAnalyzedCount: number;
} {
  const isAllTime = !lookbackDays || lookbackDays <= 0 || lookbackDays >= 9999;
  let effectiveLookbackDays = lookbackDays;
  let cutoffTime = 0;

  if (isAllTime) {
    let earliestTime = Date.now();
    let hasValidSales = false;
    sales.forEach((s) => {
      const t = new Date(s.createdAt).getTime();
      if (!isNaN(t)) {
        hasValidSales = true;
        if (t < earliestTime) earliestTime = t;
      }
    });
    const spanDays = hasValidSales
      ? Math.max(14, Math.round((Date.now() - earliestTime) / (24 * 60 * 60 * 1000)))
      : 60;
    effectiveLookbackDays = spanDays;
    cutoffTime = 0;
  } else {
    cutoffTime = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  }

  const velocityMap: Record<string, { unitsSold: number; dailyVelocity: number; revenue: number }> = {};

  products.forEach((p) => {
    velocityMap[p.id] = { unitsSold: 0, dailyVelocity: 0, revenue: 0 };
  });

  let salesAnalyzedCount = 0;

  sales.forEach((s) => {
    const saleTime = new Date(s.createdAt).getTime();
    if (!isAllTime && (isNaN(saleTime) || saleTime < cutoffTime)) return;
    if (s.status === 'Refunded' || s.status === 'Held') return;

    salesAnalyzedCount++;

    (s.items || []).forEach((item) => {
      if (!item.productId) return;
      if (!velocityMap[item.productId]) {
        velocityMap[item.productId] = { unitsSold: 0, dailyVelocity: 0, revenue: 0 };
      }
      const qty = Number(item.quantity) || 1;
      const rev = Number(item.total) || (Number(item.unitPrice) || 0) * qty;
      velocityMap[item.productId].unitsSold += qty;
      velocityMap[item.productId].revenue += rev;
    });
  });

  // Calculate daily run rate
  Object.keys(velocityMap).forEach((id) => {
    const units = velocityMap[id].unitsSold;
    velocityMap[id].dailyVelocity = units / Math.max(1, effectiveLookbackDays);
  });

  return { velocityMap, effectiveLookbackDays, salesAnalyzedCount };
}

/**
 * Recommends products and distributes the investment amount based on selected strategy
 */
export function allocateInvestmentToProducts(
  products: Product[],
  salesVelocityMap: Record<string, { unitsSold: number; dailyVelocity: number; revenue: number }>,
  investmentAmount: number,
  tenureMonths: number,
  strategy: AllocationStrategy,
  customAllocations?: Record<string, number>,
  lookbackDays = 60
): { allocated: AllocatedProduct[]; totalAllocated: number; unallocated: number } {
  const activeProducts = products.filter(
    (p) => p.status !== 'Archived' && p.costPrice > 0 && p.retailPrice > p.costPrice
  );

  const tenureDays = tenureMonths * 30;

  // Score each product
  const scoredProducts = activeProducts.map((p) => {
    const stats = salesVelocityMap[p.id] || { unitsSold: 0, dailyVelocity: 0, revenue: 0 };
    const marginPerUnit = p.retailPrice - p.costPrice;
    const marginPct = (marginPerUnit / p.retailPrice) * 100;
    
    // Baseline daily velocity: if 0 historical sales, assume conservative 0.15 units/day based on active stock
    const velocity = stats.dailyVelocity > 0 ? stats.dailyVelocity : 0.15;
    
    // Max demand ceiling across the tenure (prevents overstocking into dead inventory)
    // Add 20% growth buffer
    const maxDemandDuringTenure = Math.max(
      10,
      Math.ceil(velocity * tenureDays * 1.2)
    );

    let score = 0;
    if (strategy === 'fast_turnover') {
      // Prioritize velocity heavily
      score = velocity * 100 + marginPct * 0.5;
    } else if (strategy === 'max_profit') {
      // Prioritize profit margin
      score = marginPct * 10 + velocity * 20;
    } else {
      // Balanced: Velocity * Margin per unit
      score = (velocity * marginPerUnit) / Math.max(1, p.costPrice) * 100;
    }

    return {
      product: p,
      marginPerUnit,
      marginPct,
      dailyVelocity: velocity,
      historicalUnitsSold60d: stats.unitsSold,
      maxDemandDuringTenure,
      score,
    };
  });

  // Sort descending by strategy score
  scoredProducts.sort((a, b) => b.score - a.score);

  // If custom allocations are provided by the user in the interactive cart
  if (customAllocations && Object.keys(customAllocations).length > 0) {
    const allocated: AllocatedProduct[] = [];
    let totalAllocated = 0;

    Object.entries(customAllocations).forEach(([productId, qty]) => {
      const sp = scoredProducts.find((item) => item.product.id === productId);
      if (!sp || qty <= 0) return;

      const cost = qty * sp.product.costPrice;
      totalAllocated += cost;
      const projectedRev = qty * sp.product.retailPrice;
      const projectedGrossProfit = projectedRev - cost;
      const runOutDays = Math.max(1, Math.round(qty / Math.max(0.05, sp.dailyVelocity)));
      const turnoverCycles = Number((tenureDays / Math.max(1, runOutDays)).toFixed(1));

      allocated.push({
        productId: sp.product.id,
        productName: sp.product.name,
        sku: sp.product.sku,
        category: sp.product.category,
        costPrice: sp.product.costPrice,
        retailPrice: sp.product.retailPrice,
        marginPerUnit: sp.marginPerUnit,
        marginPct: Number(sp.marginPct.toFixed(1)),
        dailyVelocity: Number(sp.dailyVelocity.toFixed(2)),
        runOutDays,
        recommendedQty: qty,
        allocatedCapital: cost,
        projectedRevenue: projectedRev,
        projectedGrossProfit,
        turnoverCycles,
        historicalUnitsSold60d: sp.historicalUnitsSold60d,
        historicalUnitsSold: sp.historicalUnitsSold60d,
        lookbackDaysUsed: lookbackDays,
      });
    });

    return {
      allocated,
      totalAllocated,
      unallocated: Math.max(0, investmentAmount - totalAllocated),
    };
  }

  // Automatic Greedy Allocation across top performers (select 3 to 6 top diverse products)
  const targetSKUsCount = Math.min(6, Math.max(2, scoredProducts.length));
  const candidateList = scoredProducts.slice(0, targetSKUsCount);

  let remainingBudget = investmentAmount;
  const allocatedMap: Record<string, number> = {};

  // First pass: allocate proportional base batches (e.g. 15-30% of max demand each)
  candidateList.forEach((item) => {
    const unitCost = item.product.costPrice;
    if (remainingBudget >= unitCost * 5) {
      const initialQty = Math.min(
        item.maxDemandDuringTenure,
        Math.max(5, Math.floor((investmentAmount / targetSKUsCount) / unitCost))
      );
      const batchCost = initialQty * unitCost;
      if (batchCost <= remainingBudget) {
        allocatedMap[item.product.id] = initialQty;
        remainingBudget -= batchCost;
      }
    }
  });

  // Second pass: distribute remaining budget to top-scoring candidates up to their maxDemand ceiling
  for (const item of candidateList) {
    if (remainingBudget < item.product.costPrice) break;
    const currentQty = allocatedMap[item.product.id] || 0;
    const remainingHeadroom = Math.max(0, item.maxDemandDuringTenure - currentQty);
    if (remainingHeadroom > 0) {
      const affordableQty = Math.min(
        remainingHeadroom,
        Math.floor(remainingBudget / item.product.costPrice)
      );
      if (affordableQty > 0) {
        allocatedMap[item.product.id] = currentQty + affordableQty;
        remainingBudget -= affordableQty * item.product.costPrice;
      }
    }
  }

  // Build the final allocated products array
  const allocated: AllocatedProduct[] = [];
  let totalAllocated = 0;

  candidateList.forEach((item) => {
    const qty = allocatedMap[item.product.id];
    if (!qty || qty <= 0) return;

    const cost = qty * item.product.costPrice;
    totalAllocated += cost;
    const projectedRev = qty * item.product.retailPrice;
    const projectedGrossProfit = projectedRev - cost;
    const runOutDays = Math.max(1, Math.round(qty / Math.max(0.05, item.dailyVelocity)));
    const turnoverCycles = Number((tenureDays / Math.max(1, runOutDays)).toFixed(1));

    allocated.push({
      productId: item.product.id,
      productName: item.product.name,
      sku: item.product.sku,
      category: item.product.category,
      costPrice: item.product.costPrice,
      retailPrice: item.product.retailPrice,
      marginPerUnit: item.marginPerUnit,
      marginPct: Number(item.marginPct.toFixed(1)),
      dailyVelocity: Number(item.dailyVelocity.toFixed(2)),
      runOutDays,
      recommendedQty: qty,
      allocatedCapital: cost,
      projectedRevenue: projectedRev,
      projectedGrossProfit,
      turnoverCycles,
      historicalUnitsSold60d: item.historicalUnitsSold60d,
      historicalUnitsSold: item.historicalUnitsSold60d,
      lookbackDaysUsed: lookbackDays,
    });
  });

  return {
    allocated,
    totalAllocated,
    unallocated: Math.max(0, investmentAmount - totalAllocated),
  };
}

/**
 * Calculates investor payout schedules, business retained margin, and multi-model comparison
 */
export function simulateInvestment(
  products: Product[],
  sales: Sale[],
  params: CalculationParams
): InvestmentSimulationResult {
  const {
    investmentAmount,
    tenureMonths,
    payoutFrequency,
    returnModel,
    repaymentStructure,
    yieldRate,
    strategy,
    customProductAllocations,
    lookbackDays = 60,
  } = params;

  // 1. Calculate sales velocity
  const { velocityMap, effectiveLookbackDays, salesAnalyzedCount } = calculateSalesVelocity(
    sales,
    products,
    lookbackDays
  );

  // 2. Allocate capital to products
  const { allocated, totalAllocated, unallocated } = allocateInvestmentToProducts(
    products,
    velocityMap,
    investmentAmount,
    tenureMonths,
    strategy,
    customProductAllocations,
    effectiveLookbackDays
  );

  // 3. Projected totals from the inventory batch
  const projectedGrossRevenue = allocated.reduce((sum, p) => sum + p.projectedRevenue, 0);
  const projectedGrossProfit = allocated.reduce((sum, p) => sum + p.projectedGrossProfit, 0);

  // 4. Determine number of payout periods
  let periodsCount = 1;
  let periodIntervalMonths = tenureMonths;

  if (payoutFrequency === 'monthly') {
    periodsCount = Math.max(1, tenureMonths);
    periodIntervalMonths = 1;
  } else if (payoutFrequency === 'bi_monthly') {
    periodsCount = Math.max(1, Math.ceil(tenureMonths / 2));
    periodIntervalMonths = 2;
  } else {
    // end_of_tenure
    periodsCount = 1;
    periodIntervalMonths = tenureMonths;
  }

  // 5. Calculate Total Investor Return based on model
  let totalInvestorReturn = 0;

  if (returnModel === 'fixed_yield') {
    // yieldRate is % per month (e.g. 2.5)
    // Total return = capital * (monthly_rate * tenureMonths)
    totalInvestorReturn = investmentAmount * (yieldRate / 100) * tenureMonths;
  } else if (returnModel === 'flat_roi') {
    // yieldRate is flat % for the entire tenure (e.g. 15)
    totalInvestorReturn = investmentAmount * (yieldRate / 100);
  } else if (returnModel === 'profit_share') {
    // yieldRate is % of gross profit (e.g. 25)
    totalInvestorReturn = projectedGrossProfit * (yieldRate / 100);
  }

  const totalInvestorPayout = investmentAmount + totalInvestorReturn;
  const netBusinessProfit = projectedGrossProfit - totalInvestorReturn;

  // 6. Build Milestone Repayment Schedule
  const schedule: MilestonePayout[] = [];
  const baseStartDate = new Date();
  let cumulativePayout = 0;

  // Period principal & yield distribution
  const periodicReturn = periodsCount > 0 ? totalInvestorReturn / periodsCount : totalInvestorReturn;

  for (let i = 1; i <= periodsCount; i++) {
    const isLastPeriod = i === periodsCount;
    const dueDateObj = new Date(baseStartDate);
    dueDateObj.setMonth(baseStartDate.getMonth() + i * periodIntervalMonths);

    const dueDateStr = dueDateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    let principalDue = 0;
    let returnDue = periodicReturn;

    if (repaymentStructure === 'bullet_maturity') {
      // Principal is paid 100% at maturity
      principalDue = isLastPeriod ? investmentAmount : 0;
    } else if (repaymentStructure === 'amortized_installments') {
      // Principal is split evenly over all periods
      principalDue = investmentAmount / periodsCount;
    } else {
      // lump_sum_end
      principalDue = isLastPeriod ? investmentAmount : 0;
      returnDue = isLastPeriod ? totalInvestorReturn : 0;
    }

    const totalPeriodPayout = principalDue + returnDue;
    cumulativePayout += totalPeriodPayout;

    // Projected cash inflow from products sold in this period
    // Assumes linear liquidation of stock over tenure
    const periodInflow = periodsCount > 0 ? projectedGrossRevenue / periodsCount : projectedGrossRevenue;
    const projectedRetainedSurplus = periodInflow - totalPeriodPayout;

    schedule.push({
      periodIndex: i,
      periodLabel:
        payoutFrequency === 'end_of_tenure'
          ? `Maturity (${tenureMonths} mo)`
          : `Month ${i * periodIntervalMonths}`,
      dueDate: dueDateStr,
      principalDue: Math.round(principalDue),
      returnDue: Math.round(returnDue),
      totalPayout: Math.round(totalPeriodPayout),
      cumulativePayout: Math.round(cumulativePayout),
      projectedCashInflow: Math.round(periodInflow),
      projectedRetainedSurplus: Math.round(projectedRetainedSurplus),
    });
  }

  // Adjust any minor rounding discrepancy on final period
  if (schedule.length > 0) {
    const sumPayout = schedule.reduce((acc, s) => acc + s.totalPayout, 0);
    const diff = totalInvestorPayout - sumPayout;
    if (Math.abs(diff) > 0) {
      schedule[schedule.length - 1].totalPayout += diff;
      schedule[schedule.length - 1].cumulativePayout = totalInvestorPayout;
    }
  }

  // 7. Safety Coverage Ratio
  // Compares total projected revenue inflow to scheduled outflows
  const averagePeriodInflow = projectedGrossRevenue / Math.max(1, periodsCount);
  const maxPeriodOutflow = Math.max(...schedule.map((s) => s.totalPayout), 1);
  const coverageRatio = Number((projectedGrossRevenue / Math.max(1, totalInvestorPayout)).toFixed(2));

  let coverageRating: 'Safe' | 'Healthy' | 'Caution' = 'Safe';
  if (coverageRatio >= 1.4) {
    coverageRating = 'Safe';
  } else if (coverageRatio >= 1.15) {
    coverageRating = 'Healthy';
  } else {
    coverageRating = 'Caution';
  }

  // 8. Generate Side-by-Side Model Comparison
  const comparison: ReturnModelComparisonItem[] = [
    {
      model: 'fixed_yield',
      label: 'Fixed Monthly Yield',
      description: `${yieldRate}% periodic payout per month`,
      investorTotalReturn: investmentAmount * (yieldRate / 100) * tenureMonths,
      investorEffectiveROI: Number(((yieldRate * tenureMonths)).toFixed(1)),
      totalPayout: investmentAmount + investmentAmount * (yieldRate / 100) * tenureMonths,
      businessRetainedProfit: projectedGrossProfit - (investmentAmount * (yieldRate / 100) * tenureMonths),
      coverageRatio: Number((projectedGrossRevenue / (investmentAmount + investmentAmount * (yieldRate / 100) * tenureMonths)).toFixed(2)),
      coverageRating: (projectedGrossRevenue / (investmentAmount + investmentAmount * (yieldRate / 100) * tenureMonths)) >= 1.3 ? 'Safe' : 'Healthy',
      recommended: returnModel === 'fixed_yield',
    },
    {
      model: 'flat_roi',
      label: 'Flat Tenure ROI',
      description: `${Math.max(10, Math.round(yieldRate * 4))}% flat return at tenure completion`,
      investorTotalReturn: investmentAmount * (Math.max(10, yieldRate * 4) / 100),
      investorEffectiveROI: Number(Math.max(10, yieldRate * 4).toFixed(1)),
      totalPayout: investmentAmount + investmentAmount * (Math.max(10, yieldRate * 4) / 100),
      businessRetainedProfit: projectedGrossProfit - (investmentAmount * (Math.max(10, yieldRate * 4) / 100)),
      coverageRatio: Number((projectedGrossRevenue / (investmentAmount + investmentAmount * (Math.max(10, yieldRate * 4) / 100))).toFixed(2)),
      coverageRating: (projectedGrossRevenue / (investmentAmount + investmentAmount * (Math.max(10, yieldRate * 4) / 100))) >= 1.3 ? 'Safe' : 'Healthy',
      recommended: returnModel === 'flat_roi',
    },
    {
      model: 'profit_share',
      label: 'Gross Profit Share',
      description: '25% share of actual sales gross profit',
      investorTotalReturn: projectedGrossProfit * 0.25,
      investorEffectiveROI: Number(((projectedGrossProfit * 0.25) / Math.max(1, investmentAmount) * 100).toFixed(1)),
      totalPayout: investmentAmount + projectedGrossProfit * 0.25,
      businessRetainedProfit: projectedGrossProfit * 0.75,
      coverageRatio: Number((projectedGrossRevenue / (investmentAmount + projectedGrossProfit * 0.25)).toFixed(2)),
      coverageRating: 'Safe',
      recommended: returnModel === 'profit_share',
    },
  ];

  return {
    investmentAmount,
    tenureMonths,
    payoutFrequency,
    returnModel,
    repaymentStructure,
    yieldRate,
    lookbackDays: effectiveLookbackDays,
    salesAnalyzedCount,
    totalAllocatedCapital: Math.round(totalAllocated),
    unallocatedCapital: Math.round(unallocated),
    projectedGrossRevenue: Math.round(projectedGrossRevenue),
    projectedGrossProfit: Math.round(projectedGrossProfit),
    totalInvestorReturn: Math.round(totalInvestorReturn),
    totalInvestorPayout: Math.round(totalInvestorPayout),
    netBusinessProfit: Math.round(netBusinessProfit),
    coverageRatio,
    coverageRating,
    allocatedProducts: allocated,
    schedule,
    comparison,
  };
}

/**
 * Initializes a live, active investment campaign from a simulation result
 */
export function startCampaignFromSimulation(
  simulation: InvestmentSimulationResult,
  campaignName: string,
  options?: {
    investorName?: string;
    investorContact?: string;
    startDate?: string;
    strategy?: AllocationStrategy;
    notes?: string;
    scenarioId?: string;
  }
): ActiveInvestmentCampaign {
  const startedAt = options?.startDate || new Date().toISOString();
  const startTime = new Date(startedAt).getTime();
  const tenureDays = simulation.tenureMonths * 30;
  const targetMaturityDate = new Date(startTime + tenureDays * 24 * 60 * 60 * 1000).toISOString();

  const allocatedProducts: ActiveCampaignProduct[] = simulation.allocatedProducts.map((p) => ({
    productId: p.productId,
    productName: p.productName,
    sku: p.sku,
    category: p.category,
    costPrice: p.costPrice,
    retailPrice: p.retailPrice,
    marginPerUnit: p.marginPerUnit,
    marginPct: p.marginPct,
    initialTargetQty: p.recommendedQty,
    currentTargetQty: p.recommendedQty,
    projectedDailyVelocity: p.dailyVelocity,
    initialAllocatedCapital: p.allocatedCapital,
    currentAllocatedCapital: p.allocatedCapital,
    isSubstitutedOut: false,
  }));

  const milestones: CampaignMilestone[] = simulation.schedule.map((s) => ({
    periodIndex: s.periodIndex,
    periodLabel: s.periodLabel,
    dueDate: s.dueDate,
    principalDue: s.principalDue,
    returnDue: s.returnDue,
    totalDue: s.totalPayout,
    cumulativePayoutDue: s.cumulativePayout,
    status: 'pending',
  }));

  return {
    id: `camp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    scenarioId: options?.scenarioId,
    name: campaignName.trim() || `Campaign ${new Date().toLocaleDateString()}`,
    investorName: options?.investorName?.trim(),
    investorContact: options?.investorContact?.trim(),
    status: 'active',
    createdAt: new Date().toISOString(),
    startedAt,
    tenureMonths: simulation.tenureMonths,
    targetMaturityDate,
    investmentAmount: simulation.investmentAmount,
    payoutFrequency: simulation.payoutFrequency,
    returnModel: simulation.returnModel,
    repaymentStructure: simulation.repaymentStructure,
    yieldRate: simulation.yieldRate,
    strategy: options?.strategy || 'balanced',
    allocatedProducts,
    milestones,
    substitutionHistory: [],
    notes: options?.notes,
  };
}

/**
 * Finds top-performing candidate products from catalog to replace a slow or underperforming SKU
 */
export function findReplacementCandidates(
  trappedCapital: number,
  remainingTenureDays: number,
  allProducts: Product[],
  currentCampaignProductIds: string[],
  salesVelocityMap: Record<string, { unitsSold: number; dailyVelocity: number; revenue: number }>,
  outgoingVelocity: number,
  outgoingRemainingProfit: number,
  outgoingRemainingDays = 60
): SkuReplacementCandidate[] {
  const currentSet = new Set(currentCampaignProductIds);

  const candidates: SkuReplacementCandidate[] = [];

  allProducts.forEach((p) => {
    // Exclude current portfolio and non-salable items
    if (currentSet.has(p.id)) return;
    if (p.status === 'Archived') return;
    if (p.costPrice <= 0 || p.retailPrice <= p.costPrice) return;

    const stats = salesVelocityMap[p.id] || { unitsSold: 0, dailyVelocity: 0, revenue: 0 };
    const velocity = stats.dailyVelocity > 0 ? stats.dailyVelocity : 0.15;
    const marginPerUnit = p.retailPrice - p.costPrice;
    const marginPct = Number(((marginPerUnit / p.retailPrice) * 100).toFixed(1));

    // Calculate purchasing power and runout fit
    const affordableUnits = Math.max(1, Math.floor(trappedCapital / p.costPrice));
    const demandCeiling = Math.max(5, Math.ceil(velocity * Math.max(14, remainingTenureDays) * 1.2));
    const recommendedUnits = Math.min(affordableUnits, demandCeiling);

    if (recommendedUnits <= 0) return;

    const projectedBatchCost = recommendedUnits * p.costPrice;
    const projectedBatchRevenue = recommendedUnits * p.retailPrice;
    const projectedBatchProfit = projectedBatchRevenue - projectedBatchCost;
    const runOutDays = Math.max(1, Math.round(recommendedUnits / Math.max(0.05, velocity)));

    const velocityMultiplier = Number((velocity / Math.max(0.05, outgoingVelocity)).toFixed(1));
    const profitBoostDelta = Math.round(projectedBatchProfit - outgoingRemainingProfit);
    const turnoverDaysSaved = Math.max(0, outgoingRemainingDays - runOutDays);

    // Composite Replacement Score: Weighted by velocity, margin, and profit boost
    const compositeScore = Number(
      (
        velocity * 30 +
        marginPct * 0.4 +
        (projectedBatchProfit / Math.max(1, trappedCapital)) * 40
      ).toFixed(1)
    );

    const confidenceRating: 'High' | 'Moderate' =
      velocity >= 0.5 && marginPct >= 20 ? 'High' : 'Moderate';

    candidates.push({
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      category: p.category || 'General',
      costPrice: p.costPrice,
      retailPrice: p.retailPrice,
      marginPerUnit,
      marginPct,
      dailyVelocity: Number(velocity.toFixed(2)),
      affordableUnits,
      recommendedUnits,
      projectedBatchCost,
      projectedBatchRevenue,
      projectedBatchProfit,
      runOutDays,
      compositeScore,
      velocityMultiplier,
      profitBoostDelta,
      turnoverDaysSaved,
      confidenceRating,
    });
  });

  // Sort descending by composite score
  candidates.sort((a, b) => b.compositeScore - a.compositeScore);

  return candidates.slice(0, 5);
}

/**
 * Derives real-time campaign progress, capital recovery, velocity pacing, and alerts from sales
 */
export function calculateCampaignLiveProgress(
  campaign: ActiveInvestmentCampaign,
  sales: Sale[],
  allProducts: Product[],
  now = new Date()
): CampaignLiveProgress {
  const startTime = new Date(campaign.startedAt).getTime();
  const currentTime = now.getTime();
  const tenureDays = campaign.tenureMonths * 30;
  const daysElapsed = Math.max(1, Math.round((currentTime - startTime) / (24 * 60 * 60 * 1000)));
  const daysRemaining = Math.max(0, tenureDays - daysElapsed);
  const progressPct = Math.min(100, Number(((daysElapsed / tenureDays) * 100).toFixed(1)));

  // Fast product lookup map
  const campaignProductMap = new Map<string, ActiveCampaignProduct>();
  campaign.allocatedProducts.forEach((p) => {
    campaignProductMap.set(p.productId, p);
  });

  // Map to track allocated units depleted per product (to enforce lot ceiling)
  const productDepletedMap = new Map<
    string,
    {
      unitsSold: number;
      grossRevenue: number;
      cogsRecovered: number;
      realizedGrossProfit: number;
      salesCount: number;
    }
  >();

  campaign.allocatedProducts.forEach((p) => {
    productDepletedMap.set(p.productId, {
      unitsSold: 0,
      grossRevenue: 0,
      cogsRecovered: 0,
      realizedGrossProfit: 0,
      salesCount: 0,
    });
  });

  // Filter and sort sales chronologically ascending for precise lot accounting & break-even detection
  const relevantSales = sales
    .filter((s) => {
      const saleTime = new Date(s.createdAt).getTime();
      return (
        !isNaN(saleTime) &&
        saleTime >= startTime &&
        saleTime <= currentTime &&
        s.status !== 'Refunded' &&
        s.status !== 'Held'
      );
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const attributedSales: CampaignAttributedSale[] = [];
  let runningPrincipalRecovered = 0;
  let principalBreakEvenDate: string | undefined = undefined;

  relevantSales.forEach((s) => {
    (s.items || []).forEach((item) => {
      if (!item.productId) return;
      const campProd = campaignProductMap.get(item.productId);
      if (!campProd) return;

      const tracking = productDepletedMap.get(item.productId);
      if (!tracking) return;

      // Net quantity factoring in returns
      const netItemQty = Math.max(0, (Number(item.quantity) || 1) - (Number(item.returnedQuantity) || 0));
      if (netItemQty <= 0) return;

      // Lot ceiling: attribute up to currentTargetQty
      const availableCap = Math.max(0, campProd.currentTargetQty - tracking.unitsSold);
      const attributedQty = Math.min(netItemQty, availableCap);

      if (attributedQty <= 0) return;

      const unitSellingPrice = Number(item.unitPrice) || campProd.retailPrice;
      const unitCost = campProd.costPrice;
      const rev = attributedQty * unitSellingPrice;
      const cogs = attributedQty * unitCost;
      const profit = rev - cogs;

      tracking.unitsSold += attributedQty;
      tracking.grossRevenue += rev;
      tracking.cogsRecovered += cogs;
      tracking.realizedGrossProfit += profit;
      tracking.salesCount++;

      // Return accrual for this sale item
      let investorCut = 0;
      if (campaign.returnModel === 'profit_share') {
        investorCut = profit * (campaign.yieldRate / 100);
      }

      runningPrincipalRecovered += cogs;
      if (!principalBreakEvenDate && runningPrincipalRecovered >= campaign.investmentAmount) {
        principalBreakEvenDate = s.createdAt;
      }

      attributedSales.push({
        saleId: s.id,
        invoiceNo: s.invoiceNo,
        saleDate: s.createdAt,
        customerName: s.customerName || 'Walk-in Customer',
        productId: item.productId,
        productName: item.productName || campProd.productName,
        sku: item.sku || campProd.sku,
        quantity: attributedQty,
        unitPrice: unitSellingPrice,
        costPrice: unitCost,
        totalRevenue: Math.round(rev),
        totalCogs: Math.round(cogs),
        realizedProfit: Math.round(profit),
        investorAccruedCut: Math.round(investorCut),
      });
    });
  });

  // Reverse attributed sales for recent-first UI display
  attributedSales.reverse();

  // Compute live velocity map across general catalog (lookback 60 days) for substitution recommendations
  const { velocityMap: catalogVelocityMap } = calculateSalesVelocity(sales, allProducts, 60);

  // Compile individual product trackings
  const productTrackings: ProductLiveTracking[] = [];
  const flaggedDragProducts: { tracking: ProductLiveTracking; reason: string }[] = [];
  const replacementRecommendations: Record<string, SkuReplacementCandidate[]> = {};

  let totalRevenueGenerated = 0;
  let totalPrincipalRecovered = 0;
  let totalRealizedGrossProfit = 0;

  campaign.allocatedProducts.forEach((prod) => {
    const stats = productDepletedMap.get(prod.productId) || {
      unitsSold: 0,
      grossRevenue: 0,
      cogsRecovered: 0,
      realizedGrossProfit: 0,
      salesCount: 0,
    };

    totalRevenueGenerated += stats.grossRevenue;
    totalPrincipalRecovered += stats.cogsRecovered;
    totalRealizedGrossProfit += stats.realizedGrossProfit;

    const remainingUnits = Math.max(0, prod.currentTargetQty - stats.unitsSold);
    const sellThroughPct = Number(
      ((stats.unitsSold / Math.max(1, prod.currentTargetQty)) * 100).toFixed(1)
    );
    const actualDailyVelocity = Number((stats.unitsSold / daysElapsed).toFixed(2));
    const velocityRealizationRatio = Number(
      (actualDailyVelocity / Math.max(0.01, prod.projectedDailyVelocity)).toFixed(2)
    );

    const effectiveVelocityForRunout = actualDailyVelocity > 0 ? actualDailyVelocity : 0.05;
    const estimatedDaysToDeplete = Math.max(
      1,
      Math.round(remainingUnits / effectiveVelocityForRunout)
    );
    const depletionTimestamp = currentTime + estimatedDaysToDeplete * 24 * 60 * 60 * 1000;
    const estimatedDepletionDate = new Date(depletionTimestamp).toISOString().split('T')[0];

    const isTenureOverrun = estimatedDaysToDeplete > daysRemaining && remainingUnits > 0;

    // Diagnose underperformance:
    // If not substituted out, after 7 days warmup:
    // 1) Velocity realization < 40% with remaining units
    // 2) Tenure overrun with less than 70% sell-through
    let isUnderperforming = false;
    let underperformanceReason: string | undefined = undefined;

    if (!prod.isSubstitutedOut && daysElapsed >= 7 && remainingUnits > 0) {
      if (velocityRealizationRatio < 0.4) {
        isUnderperforming = true;
        underperformanceReason = `Slow velocity drag: selling at ${(velocityRealizationRatio * 100).toFixed(0)}% of target pace (${actualDailyVelocity}/day vs ${prod.projectedDailyVelocity}/day projected).`;
      } else if (isTenureOverrun && sellThroughPct < 70) {
        isUnderperforming = true;
        underperformanceReason = `Tenure overrun: remaining ${remainingUnits} units projected to take ${estimatedDaysToDeplete} days, exceeding remaining campaign tenure by ${estimatedDaysToDeplete - daysRemaining} days.`;
      }
    }

    const tracking: ProductLiveTracking = {
      product: prod,
      unitsSold: stats.unitsSold,
      remainingUnits,
      sellThroughPct,
      grossRevenue: Math.round(stats.grossRevenue),
      cogsRecovered: Math.round(stats.cogsRecovered),
      realizedGrossProfit: Math.round(stats.realizedGrossProfit),
      actualDailyVelocity,
      velocityRealizationRatio,
      daysElapsed,
      estimatedDaysToDeplete,
      estimatedDepletionDate,
      isTenureOverrun,
      isUnderperforming,
      underperformanceReason,
    };

    productTrackings.push(tracking);

    if (isUnderperforming) {
      flaggedDragProducts.push({ tracking, reason: underperformanceReason || 'Capital Drag' });

      // Calculate trapped capital
      const trappedCapital = remainingUnits * prod.costPrice;
      const outgoingRemainingProfit = remainingUnits * (prod.retailPrice - prod.costPrice);
      const currentCampaignIds = campaign.allocatedProducts
        .filter((p) => !p.isSubstitutedOut)
        .map((p) => p.productId);

      const recommendations = findReplacementCandidates(
        trappedCapital,
        daysRemaining,
        allProducts,
        currentCampaignIds,
        catalogVelocityMap,
        actualDailyVelocity,
        outgoingRemainingProfit,
        estimatedDaysToDeplete
      );

      replacementRecommendations[prod.productId] = recommendations;
    }
  });

  // Calculate Investor Accrued Return based on agreed model
  let investorAccruedReturn = 0;
  if (campaign.returnModel === 'profit_share') {
    investorAccruedReturn = Math.round(totalRealizedGrossProfit * (campaign.yieldRate / 100));
  } else if (campaign.returnModel === 'fixed_yield') {
    // Pro-rata monthly yield accrued over time elapsed
    const monthlyRate = campaign.yieldRate / 100;
    investorAccruedReturn = Math.round(
      campaign.investmentAmount * monthlyRate * (daysElapsed / 30)
    );
  } else {
    // Flat ROI amortized over tenure
    const totalFlatRate = Math.max(10, campaign.yieldRate * 4) / 100;
    investorAccruedReturn = Math.round(
      campaign.investmentAmount * totalFlatRate * (daysElapsed / tenureDays)
    );
  }

  const businessRetainedProfit = Math.round(
    Math.max(0, totalRealizedGrossProfit - investorAccruedReturn)
  );

  // Milestone dues and settlements
  let totalSettledPayouts = 0;
  let accruedMilestoneDueToDate = 0;

  campaign.milestones.forEach((m) => {
    if (m.status === 'settled') {
      totalSettledPayouts += m.settledAmount || m.totalDue;
    }
    const dueTime = new Date(m.dueDate).getTime();
    if (dueTime <= currentTime) {
      accruedMilestoneDueToDate += m.returnDue;
    }
  });

  const principalPaybackPct = Number(
    ((totalPrincipalRecovered / Math.max(1, campaign.investmentAmount)) * 100).toFixed(1)
  );
  const isPrincipalRecovered = totalPrincipalRecovered >= campaign.investmentAmount;

  // Debt Service Coverage Ratio (DSCR): realized profit vs obligation due
  const pendingObligation = Math.max(
    0,
    accruedMilestoneDueToDate - totalSettledPayouts
  );
  const dscrDivisor = accruedMilestoneDueToDate > 0 ? accruedMilestoneDueToDate : Math.max(1, investorAccruedReturn);
  const debtServiceCoverageRatio = Number(
    (totalRealizedGrossProfit / Math.max(1, dscrDivisor)).toFixed(2)
  );

  const coverageRating: 'Safe' | 'Healthy' | 'Caution' =
    debtServiceCoverageRatio >= 1.5 ? 'Safe' : debtServiceCoverageRatio >= 1.0 ? 'Healthy' : 'Caution';

  // Overall Campaign Health Status
  let healthStatus: 'Ahead of Pace' | 'On Track' | 'At Risk' = 'On Track';
  let healthReason = 'Campaign pacing in line with projected inventory velocity.';

  if (flaggedDragProducts.length > 0) {
    healthStatus = 'At Risk';
    healthReason = `${flaggedDragProducts.length} SKU(s) experiencing capital drag. Rebalance advised.`;
  } else if (principalPaybackPct >= (daysElapsed / tenureDays) * 100 * 1.25) {
    healthStatus = 'Ahead of Pace';
    healthReason = `Strong sales velocity: capital recovery is 25% ahead of timeline.`;
  }

  return {
    campaign,
    daysElapsed,
    totalTenureDays: tenureDays,
    daysRemaining,
    progressPct,
    totalRevenueGenerated: Math.round(totalRevenueGenerated),
    totalPrincipalRecovered: Math.round(totalPrincipalRecovered),
    principalPaybackPct,
    isPrincipalRecovered,
    principalBreakEvenDate,
    totalRealizedGrossProfit: Math.round(totalRealizedGrossProfit),
    investorAccruedReturn,
    businessRetainedProfit,
    totalSettledPayouts: Math.round(totalSettledPayouts),
    pendingObligation: Math.round(pendingObligation),
    debtServiceCoverageRatio,
    coverageRating,
    healthStatus,
    healthReason,
    productTrackings,
    attributedSales,
    flaggedDragProducts,
    replacementRecommendations,
  };
}

/**
 * Executes a mid-flight substitution of a slow SKU with a recommended high-performing SKU
 */
export function applySkuSubstitution(
  campaign: ActiveInvestmentCampaign,
  outgoingProductId: string,
  incomingProduct: Product,
  newUnits: number,
  reason: 'slow_velocity' | 'tenure_overrun' | 'manual_optimization' = 'slow_velocity',
  currentSales: Sale[] = []
): ActiveInvestmentCampaign {
  const outgoingIndex = campaign.allocatedProducts.findIndex(
    (p) => p.productId === outgoingProductId
  );
  if (outgoingIndex === -1) return campaign;

  const outgoing = campaign.allocatedProducts[outgoingIndex];

  // Calculate realized sold units for outgoing up to this point
  const startTime = new Date(campaign.startedAt).getTime();
  let outgoingSold = 0;
  currentSales.forEach((s) => {
    const saleTime = new Date(s.createdAt).getTime();
    if (saleTime >= startTime && s.status !== 'Refunded' && s.status !== 'Held') {
      (s.items || []).forEach((item) => {
        if (item.productId === outgoingProductId) {
          const qty = Math.max(0, (Number(item.quantity) || 1) - (Number(item.returnedQuantity) || 0));
          outgoingSold += qty;
        }
      });
    }
  });

  const realizedSold = Math.min(outgoingSold, outgoing.currentTargetQty);
  const unsoldUnits = Math.max(0, outgoing.currentTargetQty - realizedSold);
  const capitalFreed = unsoldUnits * outgoing.costPrice;
  const realizedProfit = realizedSold * (outgoing.retailPrice - outgoing.costPrice);

  // Incoming calculations
  const incomingUnits = Math.max(1, newUnits);
  const incomingAllocatedCapital = incomingUnits * incomingProduct.costPrice;
  const incomingMarginPerUnit = incomingProduct.retailPrice - incomingProduct.costPrice;
  const incomingMarginPct = Number(((incomingMarginPerUnit / incomingProduct.retailPrice) * 100).toFixed(1));
  const projectedAdditionalProfit = incomingUnits * incomingMarginPerUnit;

  // Freeze outgoing product target quantity to actual sold
  const updatedOutgoing: ActiveCampaignProduct = {
    ...outgoing,
    currentTargetQty: realizedSold,
    currentAllocatedCapital: realizedSold * outgoing.costPrice,
    isSubstitutedOut: true,
    substitutedAt: new Date().toISOString(),
    replacementProductId: incomingProduct.id,
  };

  // Add new incoming product
  const newActiveProduct: ActiveCampaignProduct = {
    productId: incomingProduct.id,
    productName: incomingProduct.name,
    sku: incomingProduct.sku,
    category: incomingProduct.category || 'General',
    costPrice: incomingProduct.costPrice,
    retailPrice: incomingProduct.retailPrice,
    marginPerUnit: incomingMarginPerUnit,
    marginPct: incomingMarginPct,
    initialTargetQty: incomingUnits,
    currentTargetQty: incomingUnits,
    projectedDailyVelocity: 0.5,
    initialAllocatedCapital: incomingAllocatedCapital,
    currentAllocatedCapital: incomingAllocatedCapital,
    isSubstitutedOut: false,
  };

  const substitutionRecord: CampaignSkuSubstitution = {
    id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    substitutedAt: new Date().toISOString(),
    reason,
    outgoingProductId: outgoing.productId,
    outgoingProductName: outgoing.productName,
    outgoingOriginalTargetQty: outgoing.currentTargetQty,
    outgoingRealizedUnitsSold: realizedSold,
    outgoingCapitalFreed: capitalFreed,
    outgoingRealizedGrossProfit: realizedProfit,
    incomingProductId: incomingProduct.id,
    incomingProductName: incomingProduct.name,
    incomingTargetQty: incomingUnits,
    incomingCostPrice: incomingProduct.costPrice,
    incomingRetailPrice: incomingProduct.retailPrice,
    incomingProjectedVelocity: 0.5,
    projectedAdditionalProfit,
  };

  const updatedAllocated = [...campaign.allocatedProducts];
  updatedAllocated[outgoingIndex] = updatedOutgoing;
  updatedAllocated.push(newActiveProduct);

  return {
    ...campaign,
    allocatedProducts: updatedAllocated,
    substitutionHistory: [substitutionRecord, ...campaign.substitutionHistory],
  };
}

/**
 * Records settlement / disbursement of a campaign milestone payout
 */
export function settleCampaignMilestone(
  campaign: ActiveInvestmentCampaign,
  periodIndex: number,
  settledAmount?: number,
  notes?: string
): ActiveInvestmentCampaign {
  const updatedMilestones = campaign.milestones.map((m) => {
    if (m.periodIndex === periodIndex) {
      return {
        ...m,
        status: 'settled' as const,
        settledAt: new Date().toISOString(),
        settledAmount: settledAmount !== undefined ? settledAmount : m.totalDue,
        settledNotes: notes,
      };
    }
    return m;
  });

  // Check if all milestones are settled
  const allSettled = updatedMilestones.every((m) => m.status === 'settled');

  return {
    ...campaign,
    status: allSettled ? 'completed' : campaign.status,
    completedAt: allSettled ? new Date().toISOString() : undefined,
    milestones: updatedMilestones,
  };
}
