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
