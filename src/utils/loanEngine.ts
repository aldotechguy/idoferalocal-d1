import { Product, Sale } from '../types';
import {
  LoanTranche,
  LoanRepaymentStructure,
  LoanRepaymentFrequency,
  StockAllocationStrategy,
  StockMetrics,
  StockAllocation,
  LoanMilestone,
  RiskMetrics,
  LoanSimulationResult,
  LoanModelComparisonItem,
  ActiveLoanCampaign,
  CampaignStockHolding,
  LoanCampaignMilestone,
  CampaignLiveProgress,
  CampaignStockTracking,
  CampaignStockSubstitution,
  StockSubstitutionCandidate,
  CampaignAttributedDividend,
  CampaignAttributedSale,
} from '../types/loan';

export interface LoanCalculationParams {
  tranches: LoanTranche[];
  stockStrategy: StockAllocationStrategy;
  customStockAllocations?: Record<string, number>;
  lookbackDays?: number;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function deriveSymbol(name: string, sku: string): string {
  const cleanSku = sku.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return cleanSku.length >= 4 ? cleanSku.substring(0, 6) : cleanSku.padEnd(6, 'X');
}

function getSectorFromCategory(category: string): string {
  const sectorMap: Record<string, string> = {
    'Electronics': 'Technology',
    'Accessories': 'Consumer Discretionary',
    'Clothing': 'Consumer Discretionary',
    'Food': 'Consumer Staples',
    'Health': 'Healthcare',
    'Industrial': 'Industrials',
    'Financial': 'Financials',
    'Energy': 'Energy',
    'Utilities': 'Utilities',
    'Real Estate': 'Real Estate',
    'Materials': 'Materials',
    'Communication': 'Communication Services',
  };
  return sectorMap[category] || 'General';
}

export function calculateStockMetrics(
  products: Product[],
  sales: Sale[],
  lookbackDays = 60
): StockMetrics[] {
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
    effectiveLookbackDays = hasValidSales
      ? Math.max(14, Math.round((Date.now() - earliestTime) / (24 * 60 * 60 * 1000)))
      : 60;
    cutoffTime = 0;
  } else {
    cutoffTime = Date.now() - effectiveLookbackDays * 24 * 60 * 60 * 1000;
  }

  const velocityMap: Record<string, { unitsSold: number; dailyVelocity: number; revenue: number; prices: number[] }> = {};

  products.forEach((p) => {
    velocityMap[p.id] = { unitsSold: 0, dailyVelocity: 0, revenue: 0, prices: [] };
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
        velocityMap[item.productId] = { unitsSold: 0, dailyVelocity: 0, revenue: 0, prices: [] };
      }
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || 0;
      const rev = Number(item.total) || unitPrice * qty;
      velocityMap[item.productId].unitsSold += qty;
      velocityMap[item.productId].revenue += rev;
      if (unitPrice > 0) {
        velocityMap[item.productId].prices.push(unitPrice);
      }
    });
  });

  Object.keys(velocityMap).forEach((id) => {
    const units = velocityMap[id].unitsSold;
    velocityMap[id].dailyVelocity = units / Math.max(1, effectiveLookbackDays);
  });

  const metrics: StockMetrics[] = products.map((p) => {
    const stats = velocityMap[p.id] || { unitsSold: 0, dailyVelocity: 0, revenue: 0, prices: [] };
    const velocity = stats.dailyVelocity > 0 ? stats.dailyVelocity : 0.1;
    const marginPerUnit = p.retailPrice - p.costPrice;
    const marginPct = p.retailPrice > 0 ? (marginPerUnit / p.retailPrice) * 100 : 0;

    const prices = stats.prices;
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : p.retailPrice;
    const priceStdDev = prices.length > 1
      ? Math.sqrt(prices.reduce((sum, price) => sum + Math.pow(price - avgPrice, 2), 0) / (prices.length - 1))
      : avgPrice * 0.15;
    const historicalVolatility = avgPrice > 0 ? (priceStdDev / avgPrice) * Math.sqrt(252) : 0.3;

    const expectedReturnPct = Math.max(5, Math.min(40, marginPct * 1.2));
    const dividendYield = Math.min(expectedReturnPct * 0.35, 8);
    const priceAppreciation = expectedReturnPct - dividendYield;
    const volatilityProxy = Math.max(0.15, Math.min(0.8, velocity * 2 + 0.1));
    const beta = Math.max(0.5, Math.min(2.0, volatilityProxy * 1.5));
    const maxAllocationPct = Math.min(25, Math.max(5, 20 / Math.max(0.5, beta)));
    const liquidityScore = Math.min(100, Math.max(10, velocity * 100));

    return {
      productId: p.id,
      symbol: deriveSymbol(p.name, p.sku),
      name: p.name,
      sector: getSectorFromCategory(p.category),
      purchasePrice: p.costPrice,
      currentPrice: p.retailPrice,
      expectedReturnPct,
      volatilityProxy,
      dividendYield,
      priceAppreciation,
      beta,
      maxAllocationPct,
      liquidityScore,
      historicalVolatility,
      avgDailyVolume: velocity,
    };
  }).filter(m => m.purchasePrice > 0 && m.currentPrice > m.purchasePrice);

  return metrics;
}

export function buildLoanAmortizationSchedule(tranche: LoanTranche): Array<{
  period: number;
  principalDue: number;
  interestDue: number;
  outstandingPrincipal: number;
  daysInPeriod: number;
}> {
  const schedule: Array<{
    period: number;
    principalDue: number;
    interestDue: number;
    outstandingPrincipal: number;
    daysInPeriod: number;
  }> = [];

  const frequencyMonths = tranche.repaymentFrequency === 'monthly' ? 1 : tranche.repaymentFrequency === 'quarterly' ? 3 : 6;
  const totalPeriods = Math.ceil(tranche.tenureMonths / frequencyMonths);
  const annualRate = tranche.interestRate / 100;
  const periodRate = annualRate / (12 / frequencyMonths);
  const interestOnlyPeriods = Math.floor((tranche.interestOnlyMonths || 0) / frequencyMonths);

  let outstandingPrincipal = tranche.principal;
  const originationFee = tranche.originationFeeBps ? tranche.principal * (tranche.originationFeeBps / 10000) : 0;

  for (let period = 1; period <= totalPeriods; period++) {
    const isInterestOnly = period <= interestOnlyPeriods;
    const daysInPeriod = frequencyMonths * 30;

    let principalDue = 0;
    let interestDue = 0;

    if (tranche.repaymentStructure === 'bullet') {
      interestDue = outstandingPrincipal * periodRate;
      principalDue = period === totalPeriods ? outstandingPrincipal : 0;
    } else if (tranche.repaymentStructure === 'lump_sum') {
      interestDue = period === totalPeriods ? outstandingPrincipal * periodRate * totalPeriods : 0;
      principalDue = period === totalPeriods ? outstandingPrincipal : 0;
    } else if (tranche.repaymentStructure === 'interest_only_then_amortized') {
      if (isInterestOnly) {
        interestDue = outstandingPrincipal * periodRate;
        principalDue = 0;
      } else {
        const remainingPeriods = totalPeriods - interestOnlyPeriods;
        const amortizedPrincipal = tranche.principal / remainingPeriods;
        principalDue = Math.min(amortizedPrincipal, outstandingPrincipal);
        interestDue = outstandingPrincipal * periodRate;
      }
    } else {
      const amortizedPrincipal = tranche.principal / totalPeriods;
      principalDue = Math.min(amortizedPrincipal, outstandingPrincipal);
      interestDue = outstandingPrincipal * periodRate;
    }

    outstandingPrincipal -= principalDue;

    schedule.push({
      period,
      principalDue: Math.round(principalDue),
      interestDue: Math.round(interestDue),
      outstandingPrincipal: Math.round(Math.max(0, outstandingPrincipal)),
      daysInPeriod,
    });
  }

  return schedule;
}

function aggregateTrancheSchedules(tranches: LoanTranche[]): Array<{
  periodIndex: number;
  periodLabel: string;
  dueDate: string;
  principalDue: number;
  interestDue: number;
  feesDue: number;
  outstandingPrincipal: number;
}> {
  const maxPeriods = Math.max(...tranches.map(t => Math.ceil(t.tenureMonths / (t.repaymentFrequency === 'monthly' ? 1 : t.repaymentFrequency === 'quarterly' ? 3 : 6))));
  const baseDate = new Date();
  const aggregated: Array<{
    periodIndex: number;
    periodLabel: string;
    dueDate: string;
    principalDue: number;
    interestDue: number;
    feesDue: number;
    outstandingPrincipal: number;
  }> = [];

  for (let i = 1; i <= maxPeriods; i++) {
    let totalPrincipalDue = 0;
    let totalInterestDue = 0;
    let totalFeesDue = 0;
    let totalOutstanding = 0;

    tranches.forEach((tranche) => {
      const freqMonths = tranche.repaymentFrequency === 'monthly' ? 1 : tranche.repaymentFrequency === 'quarterly' ? 3 : 6;
      const tranchePeriod = Math.ceil(i * freqMonths / freqMonths);
      const schedule = buildLoanAmortizationSchedule(tranche);
      const periodSchedule = schedule[tranchePeriod - 1];

      if (periodSchedule) {
        totalPrincipalDue += periodSchedule.principalDue;
        totalInterestDue += periodSchedule.interestDue;
        totalOutstanding += periodSchedule.outstandingPrincipal;
        if (tranchePeriod === 1 && tranche.originationFeeBps) {
          totalFeesDue += tranche.principal * (tranche.originationFeeBps / 10000);
        }
        if (tranche.commitmentFeeBps && periodSchedule.outstandingPrincipal > 0) {
          totalFeesDue += tranche.principal * (tranche.commitmentFeeBps / 10000) * (freqMonths / 12);
        }
      }
    });

    const dueDate = new Date(baseDate);
    dueDate.setMonth(baseDate.getMonth() + i);
    const periodLabel = `Month ${i}`;

    aggregated.push({
      periodIndex: i,
      periodLabel,
      dueDate: dueDate.toISOString().split('T')[0],
      principalDue: Math.round(totalPrincipalDue),
      interestDue: Math.round(totalInterestDue),
      feesDue: Math.round(totalFeesDue),
      outstandingPrincipal: Math.round(totalOutstanding),
    });
  }

  return aggregated;
}

export function allocateLoanToStocks(
  tranches: LoanTranche[],
  stockMetrics: StockMetrics[],
  strategy: StockAllocationStrategy,
  customAllocations?: Record<string, number>,
  totalCapital?: number
): { allocations: StockAllocation[]; totalAllocated: number; unallocated: number } {
  const capital = totalCapital || tranches.reduce((sum, t) => sum + t.principal, 0);
  const activeStocks = stockMetrics.filter(s => s.currentPrice > s.purchasePrice);

  if (customAllocations && Object.keys(customAllocations).length > 0) {
    const allocations: StockAllocation[] = [];
    let totalAllocated = 0;

    Object.entries(customAllocations).forEach(([productId, shares]) => {
      const stock = activeStocks.find(s => s.productId === productId);
      if (!stock || shares <= 0) return;

      const allocatedCapital = shares * stock.currentPrice;
      totalAllocated += allocatedCapital;

      const monthlyDividend = shares * stock.currentPrice * (stock.dividendYield / 100) / 12;
      const monthlyAppreciation = shares * stock.currentPrice * (stock.priceAppreciation / 100) / 12;
      const monthlyReturn = monthlyDividend + monthlyAppreciation;

      allocations.push({
        productId: stock.productId,
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector,
        shares,
        allocatedCapital,
        currentValue: allocatedCapital,
        expectedMonthlyDividend: monthlyDividend,
        expectedMonthlyAppreciation: monthlyAppreciation,
        expectedMonthlyReturn: monthlyReturn,
        weightPct: 0,
        volatilityContribution: stock.volatilityProxy * (allocatedCapital / capital),
        annualizedReturn: stock.expectedReturnPct,
        sharpeRatio: stock.expectedReturnPct / Math.max(0.1, stock.volatilityProxy * 100),
      });
    });

    allocations.forEach(a => {
      a.weightPct = (a.allocatedCapital / Math.max(1, totalAllocated)) * 100;
    });

    return { allocations, totalAllocated, unallocated: Math.max(0, capital - totalAllocated) };
  }

  let scoredStocks = activeStocks.map(stock => {
    let score = 0;
    switch (strategy) {
      case 'dividend_focus':
        score = stock.dividendYield * 10 + stock.liquidityScore * 0.5;
        break;
      case 'growth_focus':
        score = stock.priceAppreciation * 10 - stock.volatilityProxy * 5;
        break;
      case 'low_volatility':
        score = (100 - stock.volatilityProxy * 100) * 2 + stock.dividendYield;
        break;
      case 'high_conviction':
        score = stock.expectedReturnPct * 5 - stock.volatilityProxy * 10 + stock.liquidityScore * 0.3;
        break;
      case 'balanced':
      default:
        score = (stock.expectedReturnPct / Math.max(0.1, stock.volatilityProxy * 100)) * 100 + stock.liquidityScore * 0.5;
        break;
    }
    return { ...stock, score };
  });

  scoredStocks.sort((a, b) => b.score - a.score);

  const targetStockCount = Math.min(8, Math.max(3, scoredStocks.length));
  const candidates = scoredStocks.slice(0, targetStockCount);

  let remainingBudget = capital;
  const allocationMap: Record<string, number> = {};

  candidates.forEach((stock, index) => {
    const maxPositionCapital = capital * (stock.maxAllocationPct / 100);
    const targetCapital = Math.min(maxPositionCapital, capital / targetStockCount * (1 + (targetStockCount - index) * 0.1));
    const shares = Math.floor(Math.min(targetCapital, remainingBudget) / stock.currentPrice);
    if (shares > 0) {
      allocationMap[stock.productId] = shares;
      remainingBudget -= shares * stock.currentPrice;
    }
  });

  const allocations: StockAllocation[] = [];
  let totalAllocated = 0;

  candidates.forEach((stock) => {
    const shares = allocationMap[stock.productId];
    if (!shares || shares <= 0) return;

    const allocatedCapital = shares * stock.currentPrice;
    totalAllocated += allocatedCapital;

    const monthlyDividend = shares * stock.currentPrice * (stock.dividendYield / 100) / 12;
    const monthlyAppreciation = shares * stock.currentPrice * (stock.priceAppreciation / 100) / 12;
    const monthlyReturn = monthlyDividend + monthlyAppreciation;

    allocations.push({
      productId: stock.productId,
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      shares,
      allocatedCapital,
      currentValue: allocatedCapital,
      expectedMonthlyDividend: monthlyDividend,
      expectedMonthlyAppreciation: monthlyAppreciation,
      expectedMonthlyReturn: monthlyReturn,
      weightPct: 0,
      volatilityContribution: stock.volatilityProxy * (allocatedCapital / capital),
      annualizedReturn: stock.expectedReturnPct,
      sharpeRatio: stock.expectedReturnPct / Math.max(0.1, stock.volatilityProxy * 100),
    });
  });

  allocations.forEach(a => {
    a.weightPct = (a.allocatedCapital / Math.max(1, totalAllocated)) * 100;
  });

  return { allocations, totalAllocated, unallocated: Math.max(0, capital - totalAllocated) };
}

function calculatePortfolioCashFlows(
  allocations: StockAllocation[],
  periods: number
): Array<{ dividends: number; salesProceeds: number; totalInflow: number }> {
  const monthlyDividends = allocations.reduce((sum, a) => sum + a.expectedMonthlyDividend, 0);
  const monthlyAppreciation = allocations.reduce((sum, a) => sum + a.expectedMonthlyAppreciation, 0);

  const cashFlows: Array<{ dividends: number; salesProceeds: number; totalInflow: number }> = [];

  for (let i = 1; i <= periods; i++) {
    const dividends = monthlyDividends;
    const salesProceeds = monthlyAppreciation * 0.1;
    cashFlows.push({
      dividends: Math.round(dividends),
      salesProceeds: Math.round(salesProceeds),
      totalInflow: Math.round(dividends + salesProceeds),
    });
  }

  return cashFlows;
}

function calculateRiskMetrics(
  tranches: LoanTranche[],
  allocations: StockAllocation[],
  schedule: LoanMilestone[],
  totalCapital: number
): RiskMetrics {
  const validDscrs = schedule.map(s => s.dscr).filter(d => d > 0 && isFinite(d));
  const averageDscr = validDscrs.length > 0 ? validDscrs.reduce((a, b) => a + b, 0) / validDscrs.length : 0;
  const minDscr = validDscrs.length > 0 ? Math.min(...validDscrs) : 0;

  let dscrRating: RiskMetrics['dscrRating'] = 'Weak';
  if (averageDscr >= 2.0) dscrRating = 'Strong';
  else if (averageDscr >= 1.5) dscrRating = 'Adequate';
  else if (averageDscr >= 1.0) dscrRating = 'Weak';
  else dscrRating = 'Breach';

  const portfolioValue = allocations.reduce((sum, a) => sum + a.currentValue, 0);
  const initialLtv = totalCapital > 0 ? (totalCapital / portfolioValue) : 0;
  const minPortfolioValue = Math.min(...schedule.map(s => s.outstandingPrincipal > 0 ? s.totalPortfolioCashInflow * 12 : portfolioValue));
  const projectedMinLtv = minPortfolioValue > 0 ? (schedule[schedule.length - 1]?.outstandingPrincipal || 0) / minPortfolioValue : 0;

  let ltvRating: RiskMetrics['ltvRating'] = 'Aggressive';
  if (initialLtv <= 0.5) ltvRating = 'Conservative';
  else if (initialLtv <= 0.7) ltvRating = 'Moderate';
  else if (initialLtv <= 0.9) ltvRating = 'Aggressive';
  else ltvRating = 'Breach';

  const validCoverage = schedule.map(s => s.interestCoverage).filter(c => c > 0 && isFinite(c));
  const averageInterestCoverage = validCoverage.length > 0 ? validCoverage.reduce((a, b) => a + b, 0) / validCoverage.length : 0;
  const minInterestCoverage = validCoverage.length > 0 ? Math.min(...validCoverage) : 0;

  const maxSinglePositionPct = allocations.length > 0 ? Math.max(...allocations.map(a => a.weightPct)) : 0;
  const sectorConcentration: Record<string, number> = {};
  allocations.forEach(a => {
    sectorConcentration[a.sector] = (sectorConcentration[a.sector] || 0) + a.weightPct;
  });
  const hhiIndex = Object.values(sectorConcentration).reduce((sum, pct) => sum + Math.pow(pct / 100, 2), 0);

  const portfolioVolatility = allocations.reduce((sum, a) => sum + a.volatilityContribution, 0);
  const portfolioVar95 = portfolioValue * portfolioVolatility * 1.65;
  const maxDrawdownEstimate = portfolioVolatility * 2.5 * portfolioValue;

  const rateShockDscr = averageDscr / 1.2;
  const rateShockCashFlow = schedule[schedule.length - 1]?.cumulativeNetCashFlow || 0;
  const marketDropLtv = initialLtv / 0.7;
  const marketDropValue = portfolioValue * 0.7;
  const combinedDscr = averageDscr / 1.5;
  const combinedLtv = initialLtv / 0.6;

  return {
    averageDscr: Number(averageDscr.toFixed(2)),
    minDscr: Number(minDscr.toFixed(2)),
    dscrRating,
    initialLtv: Number(initialLtv.toFixed(2)),
    projectedMinLtv: Number(projectedMinLtv.toFixed(2)),
    ltvRating,
    averageInterestCoverage: Number(averageInterestCoverage.toFixed(2)),
    minInterestCoverage: Number(minInterestCoverage.toFixed(2)),
    maxSinglePositionPct: Number(maxSinglePositionPct.toFixed(1)),
    sectorConcentration,
    hhiIndex: Number(hhiIndex.toFixed(3)),
    portfolioVar95: Math.round(portfolioVar95),
    maxDrawdownEstimate: Math.round(maxDrawdownEstimate),
    stressTestResults: {
      rateShock200bps: { dscr: Number(rateShockDscr.toFixed(2)), netCashFlow: Math.round(rateShockCashFlow) },
      marketDrop30pct: { ltv: Number(marketDropLtv.toFixed(2)), portfolioValue: Math.round(marketDropValue) },
      combinedShock: { dscr: Number(combinedDscr.toFixed(2)), ltv: Number(combinedLtv.toFixed(2)) },
    },
  };
}

function generateComparison(
  tranches: LoanTranche[],
  stockMetrics: StockMetrics[],
  baseResult: LoanSimulationResult
): LoanModelComparisonItem[] {
  const totalPrincipal = tranches.reduce((sum, t) => sum + t.principal, 0);

  const strategies: { strategy: StockAllocationStrategy; label: string; description: string }[] = [
    { strategy: 'dividend_focus', label: 'Dividend Focus', description: 'High yield stocks, stable income for debt service' },
    { strategy: 'growth_focus', label: 'Growth Focus', description: 'Capital appreciation oriented, higher volatility' },
    { strategy: 'balanced', label: 'Balanced', description: 'Risk-adjusted return optimization' },
    { strategy: 'low_volatility', label: 'Low Volatility', description: 'Minimize drawdowns, preserve capital' },
    { strategy: 'high_conviction', label: 'High Conviction', description: 'Concentrated bets on best risk/reward' },
  ];

  return strategies.map(({ strategy, label, description }) => {
    const { allocations } = allocateLoanToStocks(tranches, stockMetrics, strategy, undefined, totalPrincipal);
    const portfolioReturn = allocations.reduce((sum, a) => sum + a.expectedMonthlyReturn, 0) * 12;
    const totalLoanCost = baseResult.totalLoanPayments;
    const netBenefit = portfolioReturn * (tranches[0]?.tenureMonths || 12) / 12 - totalLoanCost;

    const avgDscr = baseResult.riskMetrics.averageDscr * (strategy === 'dividend_focus' ? 1.1 : strategy === 'low_volatility' ? 1.05 : 1.0);
    const minDscr = baseResult.riskMetrics.minDscr * (strategy === 'dividend_focus' ? 1.1 : strategy === 'low_volatility' ? 1.05 : 1.0);

    let riskRating: 'Low' | 'Medium' | 'High' = 'Medium';
    if (avgDscr >= 2.0 && minDscr >= 1.5) riskRating = 'Low';
    else if (avgDscr < 1.2 || minDscr < 1.0) riskRating = 'High';

    return {
      label,
      description,
      totalLoanCost: Math.round(totalLoanCost),
      totalPortfolioReturn: Math.round(portfolioReturn * (tranches[0]?.tenureMonths || 12) / 12),
      netBenefit: Math.round(netBenefit),
      averageDscr: Number(avgDscr.toFixed(2)),
      minDscr: Number(minDscr.toFixed(2)),
      riskRating,
      recommended: false,
    };
  });
}

export function simulateLoanInvestment(
  products: Product[],
  sales: Sale[],
  params: LoanCalculationParams
): LoanSimulationResult {
  const { tranches, stockStrategy, customStockAllocations, lookbackDays = 60 } = params;
  const totalPrincipal = tranches.reduce((sum, t) => sum + t.principal, 0);
  const weightedRate = tranches.reduce((sum, t) => sum + t.principal * t.interestRate, 0) / totalPrincipal;
  const maxTenure = Math.max(...tranches.map(t => t.tenureMonths));

  const stockMetrics = calculateStockMetrics(products, sales, lookbackDays);
  const { allocations, totalAllocated, unallocated } = allocateLoanToStocks(
    tranches,
    stockMetrics,
    stockStrategy,
    customStockAllocations,
    totalPrincipal
  );

  const portfolioExpectedMonthlyReturn = allocations.reduce((sum, a) => sum + a.expectedMonthlyReturn, 0);
  const portfolioExpectedAnnualReturn = portfolioExpectedMonthlyReturn * 12;
  const portfolioDividendYield = allocations.length > 0
    ? allocations.reduce((sum, a) => sum + a.expectedMonthlyDividend, 0) / allocations.reduce((sum, a) => sum + a.currentValue, 0) * 12 * 100
    : 0;
  const portfolioVolatility = allocations.reduce((sum, a) => sum + a.volatilityContribution, 0);

  const aggregatedSchedule = aggregateTrancheSchedules(tranches);
  const cashFlows = calculatePortfolioCashFlows(allocations, aggregatedSchedule.length);

  const schedule: LoanMilestone[] = [];
  let cumulativeLoanPayment = 0;
  let cumulativeNetCashFlow = 0;

  aggregatedSchedule.forEach((period, index) => {
    const cashFlow = cashFlows[index] || { dividends: 0, salesProceeds: 0, totalInflow: 0 };
    const totalLoanPayment = period.principalDue + period.interestDue + period.feesDue;
    cumulativeLoanPayment += totalLoanPayment;
    const netCashFlow = cashFlow.totalInflow - totalLoanPayment;
    cumulativeNetCashFlow += netCashFlow;

    const dscr = totalLoanPayment > 0 ? cashFlow.totalInflow / totalLoanPayment : 0;
    const interestCoverage = period.interestDue > 0 ? cashFlow.dividends / period.interestDue : 0;

    const covenantBreach = tranches.some(t =>
      (t.covenantDscrMin && dscr < t.covenantDscrMin) ||
      (t.covenantLtvMax && period.outstandingPrincipal / (cashFlow.totalInflow * 12) > t.covenantLtvMax)
    );

    let breachType: 'dscr' | 'ltv' | 'concentration' | undefined;
    if (tranches.some(t => t.covenantDscrMin && dscr < t.covenantDscrMin)) breachType = 'dscr';
    else if (tranches.some(t => t.covenantLtvMax && period.outstandingPrincipal / (cashFlow.totalInflow * 12) > t.covenantLtvMax)) breachType = 'ltv';

    schedule.push({
      periodIndex: period.periodIndex,
      periodLabel: period.periodLabel,
      dueDate: period.dueDate,
      principalDue: period.principalDue,
      interestDue: period.interestDue,
      feesDue: period.feesDue,
      totalLoanPayment,
      cumulativeLoanPayment,
      outstandingPrincipal: period.outstandingPrincipal,
      portfolioDividends: cashFlow.dividends,
      portfolioSalesProceeds: cashFlow.salesProceeds,
      totalPortfolioCashInflow: cashFlow.totalInflow,
      dscr: Number(dscr.toFixed(2)),
      interestCoverage: Number(interestCoverage.toFixed(2)),
      netCashFlow: Math.round(netCashFlow),
      cumulativeNetCashFlow: Math.round(cumulativeNetCashFlow),
      covenantBreach,
      breachType,
    });
  });

  const totalLoanPayments = schedule.reduce((sum, s) => sum + s.totalLoanPayment, 0);
  const totalPortfolioInflows = schedule.reduce((sum, s) => sum + s.totalPortfolioCashInflow, 0);
  const netCashFlowOverTenure = totalPortfolioInflows - totalLoanPayments;

  const riskMetrics = calculateRiskMetrics(tranches, allocations, schedule, totalPrincipal);

  const comparison = generateComparison(tranches, stockMetrics, {
    tranches,
    totalPrincipal,
    blendedAnnualRate: weightedRate,
    tenureMonths: maxTenure,
    stockAllocations: allocations,
    totalAllocatedCapital: totalAllocated,
    unallocatedCapital: unallocated,
    portfolioExpectedMonthlyReturn,
    portfolioExpectedAnnualReturn,
    portfolioDividendYield,
    portfolioVolatility,
    schedule,
    totalLoanPayments,
    totalPortfolioInflows,
    netCashFlowOverTenure,
    riskMetrics,
    comparison: [],
  });

  return {
    scenarioId: generateId('scen'),
    scenarioName: `Loan Scenario ${new Date().toLocaleDateString()}`,
    tranches,
    totalPrincipal,
    blendedAnnualRate: Number(weightedRate.toFixed(2)),
    tenureMonths: maxTenure,
    stockAllocations: allocations,
    totalAllocatedCapital: Math.round(totalAllocated),
    unallocatedCapital: Math.round(unallocated),
    portfolioExpectedMonthlyReturn: Math.round(portfolioExpectedMonthlyReturn),
    portfolioExpectedAnnualReturn: Math.round(portfolioExpectedAnnualReturn),
    portfolioDividendYield: Number(portfolioDividendYield.toFixed(2)),
    portfolioVolatility: Number(portfolioVolatility.toFixed(2)),
    schedule,
    totalLoanPayments: Math.round(totalLoanPayments),
    totalPortfolioInflows: Math.round(totalPortfolioInflows),
    netCashFlowOverTenure: Math.round(netCashFlowOverTenure),
    riskMetrics,
    comparison,
  };
}

export function startLoanCampaignFromSimulation(
  simulation: LoanSimulationResult,
  campaignName: string,
  options?: {
    borrowerName?: string;
    lenderName?: string;
    startDate?: string;
    notes?: string;
    scenarioId?: string;
  }
): ActiveLoanCampaign {
  const startedAt = options?.startDate || new Date().toISOString();

  const stockHoldings: CampaignStockHolding[] = simulation.stockAllocations.map(a => ({
    productId: a.productId,
    symbol: a.symbol,
    name: a.name,
    sector: a.sector,
    initialShares: a.shares,
    currentShares: a.shares,
    purchasePrice: a.currentValue / a.shares,
    currentPrice: a.currentValue / a.shares,
    initialAllocatedCapital: a.allocatedCapital,
    currentAllocatedCapital: a.allocatedCapital,
    isSubstitutedOut: false,
    realizedDividends: 0,
    realizedGains: 0,
    unrealizedPnL: 0,
  }));

  const milestones: LoanCampaignMilestone[] = simulation.schedule.map(s => ({
    periodIndex: s.periodIndex,
    periodLabel: s.periodLabel,
    dueDate: s.dueDate,
    principalDue: s.principalDue,
    interestDue: s.interestDue,
    totalDue: s.totalLoanPayment,
    cumulativeDue: s.cumulativeLoanPayment,
    status: 'pending' as const,
  }));

  return {
    id: generateId('loan_camp'),
    scenarioId: options?.scenarioId,
    name: campaignName.trim() || `Loan Campaign ${new Date().toLocaleDateString()}`,
    borrowerName: options?.borrowerName?.trim(),
    lenderName: options?.lenderName?.trim(),
    status: 'active',
    createdAt: new Date().toISOString(),
    startedAt,
    tranches: simulation.tranches,
    totalPrincipal: simulation.totalPrincipal,
    stockHoldings,
    milestones,
    substitutionHistory: [],
    notes: options?.notes,
  };
}

function simulatePriceMovement(price: number, volatility: number, days: number): number {
  const dailyVol = volatility / Math.sqrt(252);
  const drift = 0.08 / 252;
  const shock = (Math.random() - 0.5) * 2 * dailyVol;
  return Math.max(price * 0.5, price * Math.exp(drift + shock));
}

export function calculateLoanCampaignLiveProgress(
  campaign: ActiveLoanCampaign,
  sales: Sale[],
  allProducts: Product[],
  now = new Date()
): CampaignLiveProgress {
  const startTime = new Date(campaign.startedAt).getTime();
  const currentTime = now.getTime();
  const maxTenureMonths = Math.max(...campaign.tranches.map(t => t.tenureMonths));
  const totalTenureDays = maxTenureMonths * 30;
  const daysElapsed = Math.max(1, Math.round((currentTime - startTime) / (24 * 60 * 60 * 1000)));
  const progressPct = Math.min(100, Number(((daysElapsed / totalTenureDays) * 100).toFixed(1)));

  const productMap = new Map<string, Product>();
  allProducts.forEach(p => productMap.set(p.id, p));

  let portfolioValue = 0;
  let totalDividendsReceived = 0;
  let totalRealizedGains = 0;
  let totalUnrealizedPnL = 0;

  const holdingTrackings: CampaignStockTracking[] = [];
  const flaggedHoldings: { tracking: CampaignStockTracking; reason: string }[] = [];
  const substitutionRecommendations: Record<string, StockSubstitutionCandidate[]> = {};

  const attributedDividends: CampaignAttributedDividend[] = [];
  const attributedSales: CampaignAttributedSale[] = [];

  campaign.stockHoldings.forEach(holding => {
    if (holding.isSubstitutedOut) return;

    const product = productMap.get(holding.productId);
    const currentPrice = product ? product.retailPrice : holding.currentPrice;
    const simulatedPrice = simulatePriceMovement(holding.purchasePrice, 0.2, daysElapsed);
    const effectivePrice = Math.max(simulatedPrice, currentPrice * 0.8);

    holding.currentPrice = effectivePrice;
    const currentValue = holding.currentShares * effectivePrice;
    holding.currentAllocatedCapital = currentValue;
    const unrealizedPnL = currentValue - holding.initialAllocatedCapital;
    holding.unrealizedPnL = unrealizedPnL;

    const dividendYield = 0.04;
    const dividendsReceived = holding.currentShares * effectivePrice * dividendYield * (daysElapsed / 365);
    holding.realizedDividends += dividendsReceived;
    totalDividendsReceived += dividendsReceived;

    portfolioValue += currentValue;
    totalUnrealizedPnL += unrealizedPnL;

    const totalReturn = unrealizedPnL + dividendsReceived;
    const totalReturnPct = holding.initialAllocatedCapital > 0 ? (totalReturn / holding.initialAllocatedCapital) * 100 : 0;
    const annualizedReturn = daysElapsed > 0 ? (totalReturnPct / daysElapsed) * 365 : 0;

    let isUnderperforming = false;
    let underperformanceReason: string | undefined;

    if (totalReturnPct < -10) {
      isUnderperforming = true;
      underperformanceReason = `Position down ${Math.abs(totalReturnPct).toFixed(1)}% - consider stop loss`;
    } else if (annualizedReturn < 5 && daysElapsed > 30) {
      isUnderperforming = true;
      underperformanceReason = `Low annualized return (${annualizedReturn.toFixed(1)}%) - capital not working efficiently`;
    }

    const tracking: CampaignStockTracking = {
      holding,
      currentValue: Math.round(currentValue),
      unrealizedPnL: Math.round(unrealizedPnL),
      unrealizedPnLPct: Number(totalReturnPct.toFixed(1)),
      dividendsReceived: Math.round(dividendsReceived),
      totalReturn: Math.round(totalReturn),
      totalReturnPct: Number(totalReturnPct.toFixed(1)),
      daysHeld: daysElapsed,
      annualizedReturn: Number(annualizedReturn.toFixed(1)),
      isUnderperforming,
      underperformanceReason,
    };

    holdingTrackings.push(tracking);

    if (isUnderperforming) {
      flaggedHoldings.push({ tracking, reason: underperformanceReason || 'Underperforming' });

      const trappedCapital = currentValue;
      const candidates = allProducts
        .filter(p => p.id !== holding.productId && p.status !== 'Archived' && p.retailPrice > p.costPrice)
        .slice(0, 3)
        .map(p => ({
          productId: p.id,
          symbol: deriveSymbol(p.name, p.sku),
          name: p.name,
          sector: getSectorFromCategory(p.category),
          currentPrice: p.retailPrice,
          expectedReturn: ((p.retailPrice - p.costPrice) / p.retailPrice) * 100 * 1.2,
          volatility: 0.2,
          affordableShares: Math.floor(trappedCapital / p.retailPrice),
          recommendedShares: Math.floor(trappedCapital / p.retailPrice * 0.8),
          projectedAdditionalReturn: Math.round(trappedCapital * 0.15),
          riskReduction: 15,
          confidenceRating: 'Moderate' as const,
        }));

      substitutionRecommendations[holding.productId] = candidates;
    }

    const divRecord: CampaignAttributedDividend = {
      date: now.toISOString().split('T')[0],
      productId: holding.productId,
      symbol: holding.symbol,
      shares: holding.currentShares,
      dividendPerShare: effectivePrice * dividendYield / 365,
      totalDividend: Math.round(dividendsReceived),
      appliedToLoanPayment: false,
    };
    attributedDividends.push(divRecord);
  });

  const totalPortfolioReturn = totalUnrealizedPnL + totalDividendsReceived + totalRealizedGains;
  const portfolioReturnPct = campaign.totalPrincipal > 0 ? (totalPortfolioReturn / campaign.totalPrincipal) * 100 : 0;

  let totalPrincipalPaid = 0;
  let totalInterestPaid = 0;
  let totalFeesPaid = 0;
  let paymentsOverdue = 0;
  let nextPaymentDue = 0;
  let nextPaymentDate = '';

  campaign.milestones.forEach(m => {
    const dueTime = new Date(m.dueDate).getTime();
    if (m.status === 'paid') {
      totalPrincipalPaid += m.principalDue;
      totalInterestPaid += m.interestDue;
      totalFeesPaid += (m.totalDue - m.principalDue - m.interestDue);
    } else if (dueTime <= currentTime) {
      paymentsOverdue++;
      if (!nextPaymentDue) {
        nextPaymentDue = m.totalDue;
        nextPaymentDate = m.dueDate;
      }
    } else if (!nextPaymentDue) {
      nextPaymentDue = m.totalDue;
      nextPaymentDate = m.dueDate;
    }
  });

  const totalLoanServicePaid = totalPrincipalPaid + totalInterestPaid + totalFeesPaid;
  const principalPaydownPct = campaign.totalPrincipal > 0 ? (totalPrincipalPaid / campaign.totalPrincipal) * 100 : 0;

  const currentDscr = nextPaymentDue > 0 ? (totalDividendsReceived / 12) / (nextPaymentDue / 12) : 0;
  const currentInterestCoverage = totalInterestPaid > 0 ? totalDividendsReceived / totalInterestPaid : 0;
  const currentLtv = portfolioValue > 0 ? (campaign.totalPrincipal - totalPrincipalPaid) / portfolioValue : 0;

  let covenantStatus: 'Compliant' | 'Watch' | 'Breach' = 'Compliant';
  const covenantBreaches: string[] = [];

  campaign.tranches.forEach(t => {
    if (t.covenantDscrMin && currentDscr < t.covenantDscrMin) {
      covenantStatus = 'Breach';
      covenantBreaches.push(`DSCR below minimum: ${currentDscr.toFixed(2)} < ${t.covenantDscrMin}`);
    }
    if (t.covenantLtvMax && currentLtv > t.covenantLtvMax) {
      covenantStatus = covenantStatus === 'Breach' ? 'Breach' : 'Watch';
      covenantBreaches.push(`LTV above maximum: ${(currentLtv * 100).toFixed(1)}% > ${(t.covenantLtvMax * 100).toFixed(1)}%`);
    }
  });

  // Capture covenant status as string to avoid TS narrowing issues
  const covenantStatusStr: string = covenantStatus;

  // Check for implicit watch conditions
  if (covenantStatus === 'Compliant' && (currentDscr < 1.3 || currentLtv > 0.8)) {
    covenantStatus = 'Watch';
  }

  // Determine health status based on covenant status (use captured string value to avoid TS narrowing issues)
  const isCovenantBreach = covenantStatusStr === 'Breach';
  const isCovenantWatch = covenantStatus === 'Watch';

  let healthStatus: CampaignLiveProgress['healthStatus'] = 'On Track';
  let healthReason = 'Campaign performing within expected parameters.';

  if (isCovenantBreach) {
    healthStatus = 'Critical';
    healthReason = `Covenant breach detected: ${covenantBreaches.join('; ')}`;
  } else if (isCovenantWatch || flaggedHoldings.length > 2) {
    healthStatus = 'At Risk';
    healthReason = flaggedHoldings.length > 0
      ? `${flaggedHoldings.length} holding(s) underperforming; covenant metrics approaching limits`
      : 'Covenant metrics approaching limits; monitor closely';
  } else if (principalPaydownPct > (daysElapsed / totalTenureDays) * 100 * 1.2) {
    healthStatus = 'Ahead';
    healthReason = 'Principal paydown ahead of schedule with strong portfolio performance.';
  }

  return {
    campaign,
    daysElapsed,
    totalTenureDays,
    progressPct,
    portfolioValue: Math.round(portfolioValue),
    totalDividendsReceived: Math.round(totalDividendsReceived),
    totalRealizedGains: Math.round(totalRealizedGains),
    totalUnrealizedPnL: Math.round(totalUnrealizedPnL),
    totalPortfolioReturn: Math.round(totalPortfolioReturn),
    portfolioReturnPct: Number(portfolioReturnPct.toFixed(1)),
    totalPrincipalPaid: Math.round(totalPrincipalPaid),
    totalInterestPaid: Math.round(totalInterestPaid),
    totalFeesPaid: Math.round(totalFeesPaid),
    totalLoanServicePaid: Math.round(totalLoanServicePaid),
    principalPaydownPct: Number(principalPaydownPct.toFixed(1)),
    nextPaymentDue: Math.round(nextPaymentDue),
    nextPaymentDate,
    paymentsOverdue,
    currentDscr: Number(currentDscr.toFixed(2)),
    currentInterestCoverage: Number(currentInterestCoverage.toFixed(2)),
    currentLtv: Number(currentLtv.toFixed(2)),
    covenantStatus,
    covenantBreaches,
    healthStatus,
    healthReason,
    holdingTrackings,
    flaggedHoldings,
    substitutionRecommendations,
    attributedDividends,
    attributedSales,
  };
}

export function applyStockSubstitution(
  campaign: ActiveLoanCampaign,
  outgoingProductId: string,
  incomingProduct: Product,
  newShares: number,
  reason: 'stop_loss' | 'take_profit' | 'sector_rotation' | 'covenant_cure' | 'manual' = 'manual',
  currentSales: Sale[] = []
): ActiveLoanCampaign {
  const outgoingIndex = campaign.stockHoldings.findIndex(h => h.productId === outgoingProductId);
  if (outgoingIndex === -1) return campaign;

  const outgoing = campaign.stockHoldings[outgoingIndex];
  const outgoingProceeds = outgoing.currentShares * outgoing.currentPrice;
  const outgoingRealizedPnL = outgoingProceeds - outgoing.initialAllocatedCapital;

  outgoing.isSubstitutedOut = true;
  outgoing.substitutedAt = new Date().toISOString();
  outgoing.replacementProductId = incomingProduct.id;
  outgoing.currentShares = 0;
  outgoing.currentAllocatedCapital = 0;
  outgoing.realizedGains += Math.max(0, outgoingRealizedPnL);

  const incomingPrice = incomingProduct.retailPrice;
  const incomingCost = newShares * incomingPrice;

  const newHolding: CampaignStockHolding = {
    productId: incomingProduct.id,
    symbol: deriveSymbol(incomingProduct.name, incomingProduct.sku),
    name: incomingProduct.name,
    sector: getSectorFromCategory(incomingProduct.category),
    initialShares: newShares,
    currentShares: newShares,
    purchasePrice: incomingPrice,
    currentPrice: incomingPrice,
    initialAllocatedCapital: incomingCost,
    currentAllocatedCapital: incomingCost,
    isSubstitutedOut: false,
    realizedDividends: 0,
    realizedGains: 0,
    unrealizedPnL: 0,
  };

  const substitutionRecord: CampaignStockSubstitution = {
    id: generateId('sub'),
    substitutedAt: new Date().toISOString(),
    reason,
    outgoingProductId: outgoing.productId,
    outgoingSymbol: outgoing.symbol,
    outgoingShares: outgoing.initialShares,
    outgoingProceeds: Math.round(outgoingProceeds),
    outgoingRealizedPnL: Math.round(outgoingRealizedPnL),
    incomingProductId: incomingProduct.id,
    incomingSymbol: newHolding.symbol,
    incomingShares: newShares,
    incomingCost: Math.round(incomingCost),
    projectedBenefit: Math.round(incomingCost * 0.12),
  };

  const updatedHoldings = [...campaign.stockHoldings];
  updatedHoldings[outgoingIndex] = outgoing;
  updatedHoldings.push(newHolding);

  return {
    ...campaign,
    stockHoldings: updatedHoldings,
    substitutionHistory: [substitutionRecord, ...campaign.substitutionHistory],
  };
}

export function settleLoanCampaignMilestone(
  campaign: ActiveLoanCampaign,
  periodIndex: number,
  paidAmount?: number,
  paidFrom?: 'dividends' | 'sales' | 'external',
  notes?: string
): ActiveLoanCampaign {
  const updatedMilestones = campaign.milestones.map(m => {
    if (m.periodIndex === periodIndex) {
      return {
        ...m,
        status: 'paid' as const,
        paidAt: new Date().toISOString(),
        paidAmount: paidAmount !== undefined ? paidAmount : m.totalDue,
        paidFrom,
        notes,
      };
    }
    return m;
  });

  const allPaid = updatedMilestones.every(m => m.status === 'paid');
  const anyOverdue = updatedMilestones.some(m => m.status === 'overdue');

  return {
    ...campaign,
    status: allPaid ? 'completed' : anyOverdue ? 'in_default' : campaign.status,
    milestones: updatedMilestones,
  };
}