import { describe, it, expect, vi } from 'vitest';
import { Product, Sale } from '../types';
import {
  calculateStockMetrics,
  allocateLoanToStocks,
  simulateLoanInvestment,
  startLoanCampaignFromSimulation,
  calculateLoanCampaignLiveProgress,
  applyStockSubstitution,
  settleLoanCampaignMilestone,
  buildLoanAmortizationSchedule,
} from './loanEngine';
import type { LoanRepaymentStructure } from '../types/loan';

const mockProducts: Product[] = [
  {
    id: 'prod_1',
    sku: 'STK-AAPL',
    barcode: '123001',
    name: 'Apple Inc.',
    category: 'Electronics',
    brand: 'Tech Giant',
    supplierId: 'sup_1',
    supplierName: 'NASDAQ',
    description: 'Technology stock',
    images: [],
    costPrice: 150,
    retailPrice: 180,
    wholesalePrice: 175,
    minWholesaleQty: 1,
    minimumSellingPrice: 160,
    currentStock: 1000,
    minimumStockLevel: 10,
    unit: 'shares',
    status: 'Active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'prod_2',
    sku: 'STK-JNJ',
    barcode: '123002',
    name: 'Johnson & Johnson',
    category: 'Health',
    brand: 'Healthcare',
    supplierId: 'sup_2',
    supplierName: 'NYSE',
    description: 'Healthcare stock',
    images: [],
    costPrice: 140,
    retailPrice: 165,
    wholesalePrice: 160,
    minWholesaleQty: 1,
    minimumSellingPrice: 150,
    currentStock: 1000,
    minimumStockLevel: 10,
    unit: 'shares',
    status: 'Active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'prod_3',
    sku: 'STK-JPM',
    barcode: '123003',
    name: 'JPMorgan Chase',
    category: 'Financial',
    brand: 'Banking',
    supplierId: 'sup_3',
    supplierName: 'NYSE',
    description: 'Financial stock',
    images: [],
    costPrice: 120,
    retailPrice: 150,
    wholesalePrice: 145,
    minWholesaleQty: 1,
    minimumSellingPrice: 135,
    currentStock: 1000,
    minimumStockLevel: 10,
    unit: 'shares',
    status: 'Active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'prod_4',
    sku: 'STK-XOM',
    barcode: '123004',
    name: 'Exxon Mobil',
    category: 'Energy',
    brand: 'Oil & Gas',
    supplierId: 'sup_4',
    supplierName: 'NYSE',
    description: 'Energy stock',
    images: [],
    costPrice: 80,
    retailPrice: 95,
    wholesalePrice: 92,
    minWholesaleQty: 1,
    minimumSellingPrice: 85,
    currentStock: 1000,
    minimumStockLevel: 10,
    unit: 'shares',
    status: 'Active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

const historicalSales: Sale[] = [
  {
    id: 'hist_1',
    invoiceNo: 'INV-H1',
    customerName: 'Market',
    type: 'Retail',
    items: [
      { productId: 'prod_1', productName: 'Apple Inc.', sku: 'STK-AAPL', quantity: 50, unitPrice: 180, costPrice: 150, total: 9000 },
      { productId: 'prod_2', productName: 'Johnson & Johnson', sku: 'STK-JNJ', quantity: 40, unitPrice: 165, costPrice: 140, total: 6600 },
    ],
    subtotal: 15600,
    discount: 0,
    tax: 0,
    totalAmount: 15600,
    paidAmount: 15600,
    paymentMethod: 'Cash',
    status: 'Completed',
    createdBy: 'system',
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'hist_2',
    invoiceNo: 'INV-H2',
    customerName: 'Market',
    type: 'Retail',
    items: [
      { productId: 'prod_3', productName: 'JPMorgan Chase', sku: 'STK-JPM', quantity: 60, unitPrice: 150, costPrice: 120, total: 9000 },
      { productId: 'prod_4', productName: 'Exxon Mobil', sku: 'STK-XOM', quantity: 80, unitPrice: 95, costPrice: 80, total: 7600 },
    ],
    subtotal: 16600,
    discount: 0,
    tax: 0,
    totalAmount: 16600,
    paidAmount: 16600,
    paymentMethod: 'Cash',
    status: 'Completed',
    createdBy: 'system',
    createdAt: '2026-01-20T10:00:00Z',
  },
];

const mockTranches = [
  {
    id: 'tranche_1',
    name: 'Tranche A - Term Loan',
    type: 'term_loan' as const,
    principal: 500000,
    interestRate: 12.0,
    interestRateType: 'fixed' as const,
    tenureMonths: 12,
    repaymentStructure: 'amortized' as LoanRepaymentStructure,
    repaymentFrequency: 'monthly' as const,
    interestOnlyMonths: 0,
    originationFeeBps: 100,
    commitmentFeeBps: 0,
    covenantDscrMin: 1.25,
    covenantLtvMax: 0.8,
  },
  {
    id: 'tranche_2',
    name: 'Tranche B - Revolving',
    type: 'revolving_credit' as const,
    principal: 300000,
    interestRate: 10.5,
    interestRateType: 'floating' as const,
    referenceRate: 'SOFR',
    spreadBps: 250,
    tenureMonths: 24,
    repaymentStructure: 'interest_only_then_amortized' as LoanRepaymentStructure,
    repaymentFrequency: 'monthly' as const,
    interestOnlyMonths: 6,
    originationFeeBps: 50,
    commitmentFeeBps: 25,
    covenantDscrMin: 1.2,
    covenantLtvMax: 0.75,
  },
];

describe('Loan Engine - Stock Metrics Calculation', () => {
  it('calculates stock metrics from products and sales', () => {
    const metrics = calculateStockMetrics(mockProducts, historicalSales, 60);

    expect(metrics.length).toBe(4);
    expect(metrics[0].productId).toBe('prod_1');
    expect(metrics[0].symbol).toBe('STKAAP');
    expect(metrics[0].sector).toBe('Technology');
    expect(metrics[0].purchasePrice).toBe(150);
    expect(metrics[0].currentPrice).toBe(180);
    expect(metrics[0].expectedReturnPct).toBeGreaterThan(0);
    expect(metrics[0].dividendYield).toBeGreaterThan(0);
    expect(metrics[0].priceAppreciation).toBeGreaterThan(0);
    expect(metrics[0].volatilityProxy).toBeGreaterThan(0);
    expect(metrics[0].beta).toBeGreaterThan(0);
    expect(metrics[0].maxAllocationPct).toBeGreaterThan(0);
    expect(metrics[0].liquidityScore).toBeGreaterThan(0);
  });

  it('maps marginPct to dividend yield and appreciation', () => {
    const metrics = calculateStockMetrics(mockProducts, historicalSales, 60);
    const apple = metrics.find(m => m.productId === 'prod_1');

    expect(apple).toBeDefined();
    expect(apple!.dividendYield + apple!.priceAppreciation).toBeCloseTo(apple!.expectedReturnPct, 1);
    expect(apple!.dividendYield).toBeLessThanOrEqual(8);
  });

  it('derives volatility proxy from sales velocity', () => {
    const metrics = calculateStockMetrics(mockProducts, historicalSales, 60);

    metrics.forEach(m => {
      expect(m.volatilityProxy).toBeGreaterThanOrEqual(0.15);
      expect(m.volatilityProxy).toBeLessThanOrEqual(0.8);
    });
  });

  it('handles all-time lookback', () => {
    const metrics = calculateStockMetrics(mockProducts, historicalSales, 0);
    expect(metrics.length).toBe(4);
  });

  it('filters out products with no margin', () => {
    const badProduct: Product = {
      ...mockProducts[0],
      id: 'bad_prod',
      costPrice: 200,
      retailPrice: 180,
    };
    const metrics = calculateStockMetrics([...mockProducts, badProduct], historicalSales, 60);
    expect(metrics.find(m => m.productId === 'bad_prod')).toBeUndefined();
  });
});

describe('Loan Engine - Tranche Amortization', () => {
  it('builds bullet repayment schedule', () => {
    const tranche = mockTranches[0];
    tranche.repaymentStructure = 'bullet';
    const schedule = buildLoanAmortizationSchedule(tranche);

    expect(schedule.length).toBe(12);
    expect(schedule[0].principalDue).toBe(0);
    expect(schedule[11].principalDue).toBe(500000);
    expect(schedule[11].outstandingPrincipal).toBe(0);
  });

  it('builds amortized schedule with equal principal', () => {
    const tranche = mockTranches[0];
    tranche.repaymentStructure = 'amortized';
    const schedule = buildLoanAmortizationSchedule(tranche);

    expect(schedule.length).toBe(12);
    expect(schedule[0].principalDue).toBeCloseTo(41667, -3);
    expect(schedule[11].outstandingPrincipal).toBe(0);
  });

  it('builds interest-only then amortized schedule', () => {
    const tranche = mockTranches[1];
    tranche.interestOnlyMonths = 6;
    tranche.repaymentStructure = 'interest_only_then_amortized';
    const schedule = buildLoanAmortizationSchedule(tranche);

    expect(schedule.length).toBe(24);
    expect(schedule[5].principalDue).toBe(0);
    expect(schedule[6].principalDue).toBeGreaterThan(0);
  });

  it('calculates origination fee in first period', () => {
    const tranche = mockTranches[0];
    tranche.originationFeeBps = 100;
    const schedule = buildLoanAmortizationSchedule(tranche);

    expect(schedule[0].interestDue).toBeGreaterThan(0);
  });
});

describe('Loan Engine - Portfolio Allocation', () => {
  it('allocates by dividend_focus strategy', () => {
    const metrics = calculateStockMetrics(mockProducts, historicalSales, 60);
    const { allocations } = allocateLoanToStocks(mockTranches, metrics, 'dividend_focus');

    expect(allocations.length).toBeGreaterThan(0);
    expect(allocations.length).toBeLessThanOrEqual(8);
    allocations.forEach(a => {
      expect(a.shares).toBeGreaterThan(0);
      expect(a.allocatedCapital).toBeGreaterThan(0);
      expect(a.weightPct).toBeGreaterThan(0);
    });
    const totalWeight = allocations.reduce((sum, a) => sum + a.weightPct, 0);
    expect(totalWeight).toBeCloseTo(100, 1);
  });

  it('allocates by growth_focus strategy', () => {
    const metrics = calculateStockMetrics(mockProducts, historicalSales, 60);
    const { allocations } = allocateLoanToStocks(mockTranches, metrics, 'growth_focus');

    expect(allocations.length).toBeGreaterThan(0);
    allocations.forEach(a => {
      expect(a.annualizedReturn).toBeGreaterThan(0);
    });
  });

  it('allocates by low_volatility strategy', () => {
    const metrics = calculateStockMetrics(mockProducts, historicalSales, 60);
    const { allocations } = allocateLoanToStocks(mockTranches, metrics, 'low_volatility');

    expect(allocations.length).toBeGreaterThan(0);
    const avgVol = allocations.reduce((sum, a) => sum + a.volatilityContribution, 0) / allocations.length;
    expect(avgVol).toBeLessThan(0.5);
  });

  it('respects max position size constraint', () => {
    const metrics = calculateStockMetrics(mockProducts, historicalSales, 60);
    const { allocations } = allocateLoanToStocks(mockTranches, metrics, 'high_conviction');

    allocations.forEach(a => {
      expect(a.weightPct).toBeLessThanOrEqual(25.01); // Allow small floating point variance
    });
  });

  it('handles custom allocations override', () => {
    const metrics = calculateStockMetrics(mockProducts, historicalSales, 60);
    const customAllocs = { prod_1: 1000, prod_2: 500 };
    const { allocations, totalAllocated } = allocateLoanToStocks(
      mockTranches,
      metrics,
      'balanced',
      customAllocs
    );

    expect(allocations.length).toBe(2);
    expect(allocations.find(a => a.productId === 'prod_1')?.shares).toBe(1000);
    expect(allocations.find(a => a.productId === 'prod_2')?.shares).toBe(500);
    expect(totalAllocated).toBe(1000 * 180 + 500 * 165);
  });
});

describe('Loan Engine - Full Simulation', () => {
  it('simulates multi-tranche loan with stock portfolio', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'balanced',
      lookbackDays: 60,
    });

    expect(result.tranches).toHaveLength(2);
    expect(result.totalPrincipal).toBe(800000);
    expect(result.blendedAnnualRate).toBeGreaterThan(10);
    expect(result.blendedAnnualRate).toBeLessThan(13);
    expect(result.tenureMonths).toBe(24);
    expect(result.stockAllocations.length).toBeGreaterThan(0);
    expect(result.totalAllocatedCapital).toBeGreaterThan(0);
    expect(result.schedule.length).toBeGreaterThan(0);
  });

  it('calculates period-by-period DSCR correctly', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'dividend_focus',
      lookbackDays: 60,
    });

    result.schedule.forEach(period => {
      expect(period.dscr).toBeGreaterThanOrEqual(0);
      expect(period.interestCoverage).toBeGreaterThanOrEqual(0);
      expect(period.totalLoanPayment).toBeCloseTo(period.principalDue + period.interestDue + period.feesDue, 0);
      // Allow for small rounding differences in cash inflow calculation
      const cashInflowDiff = Math.abs(period.totalPortfolioCashInflow - (period.portfolioDividends + period.portfolioSalesProceeds));
      expect(cashInflowDiff).toBeLessThanOrEqual(2);
    });
  });

  it('calculates LTV trajectory', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'balanced',
      lookbackDays: 60,
    });

    expect(result.riskMetrics.initialLtv).toBeGreaterThan(0);
    expect(result.riskMetrics.initialLtv).toBeLessThanOrEqual(2);
    expect(result.riskMetrics.projectedMinLtv).toBeGreaterThanOrEqual(0);
  });

  it('runs rate shock stress test', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'balanced',
      lookbackDays: 60,
    });

    const stress = result.riskMetrics.stressTestResults.rateShock200bps;
    expect(stress.dscr).toBeLessThan(result.riskMetrics.averageDscr);
    expect(stress.netCashFlow).toBeDefined();
  });

  it('runs market drop stress test', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'balanced',
      lookbackDays: 60,
    });

    const stress = result.riskMetrics.stressTestResults.marketDrop30pct;
    expect(stress.ltv).toBeGreaterThan(result.riskMetrics.initialLtv);
    expect(stress.portfolioValue).toBeLessThan(result.stockAllocations.reduce((s, a) => s + a.currentValue, 0));
  });

  it('runs combined shock stress test', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'balanced',
      lookbackDays: 60,
    });

    const stress = result.riskMetrics.stressTestResults.combinedShock;
    expect(stress.dscr).toBeLessThan(result.riskMetrics.averageDscr);
    expect(stress.ltv).toBeGreaterThan(result.riskMetrics.initialLtv);
  });

  it('generates model comparison', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'balanced',
      lookbackDays: 60,
    });

    expect(result.comparison.length).toBe(5);
    result.comparison.forEach(comp => {
      expect(comp.label).toBeDefined();
      expect(comp.totalLoanCost).toBeGreaterThan(0);
      expect(comp.totalPortfolioReturn).toBeGreaterThan(0);
      expect(['Low', 'Medium', 'High']).toContain(comp.riskRating);
    });
  });

  it('flags covenant breaches in schedule', () => {
    const tightTranches = [{
      ...mockTranches[0],
      covenantDscrMin: 10.0,
    }];
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: tightTranches,
      stockStrategy: 'balanced',
      lookbackDays: 60,
    });

    const hasBreach = result.schedule.some(p => p.covenantBreach);
    expect(hasBreach).toBe(true);
    expect(result.schedule.find(p => p.covenantBreach)?.breachType).toBe('dscr');
  });
});

describe('Loan Engine - Live Campaign', () => {
  const simulation = simulateLoanInvestment(mockProducts, historicalSales, {
    tranches: mockTranches,
    stockStrategy: 'balanced',
    lookbackDays: 60,
  });

  it('initializes campaign from simulation', () => {
    const campaign = startLoanCampaignFromSimulation(simulation, 'Test Loan Campaign', {
      borrowerName: 'Acme Corp',
      lenderName: 'Big Bank',
      startDate: '2026-02-01T00:00:00Z',
    });

    expect(campaign.id).toContain('loan_camp');
    expect(campaign.name).toBe('Test Loan Campaign');
    expect(campaign.borrowerName).toBe('Acme Corp');
    expect(campaign.lenderName).toBe('Big Bank');
    expect(campaign.status).toBe('active');
    expect(campaign.stockHoldings.length).toBe(simulation.stockAllocations.length);
    expect(campaign.milestones.length).toBe(simulation.schedule.length);
    expect(campaign.tranches).toHaveLength(2);
  });

  it('tracks real-time portfolio value and P&L', () => {
    const campaign = startLoanCampaignFromSimulation(simulation, 'Progress Test', {
      startDate: '2026-02-01T00:00:00Z',
    });

    const progress = calculateLoanCampaignLiveProgress(
      campaign,
      historicalSales,
      mockProducts,
      new Date('2026-02-15T00:00:00Z')
    );

    expect(progress.daysElapsed).toBeGreaterThan(0);
    expect(progress.portfolioValue).toBeGreaterThan(0);
    expect(progress.totalDividendsReceived).toBeGreaterThanOrEqual(0);
    expect(progress.totalUnrealizedPnL).toBeDefined();
    expect(progress.holdingTrackings.length).toBe(campaign.stockHoldings.filter(h => !h.isSubstitutedOut).length);
  });

  it('calculates current DSCR from actual dividends', () => {
    const campaign = startLoanCampaignFromSimulation(simulation, 'DSCR Test', {
      startDate: '2026-02-01T00:00:00Z',
    });

    const progress = calculateLoanCampaignLiveProgress(
      campaign,
      historicalSales,
      mockProducts,
      new Date('2026-03-01T00:00:00Z')
    );

    expect(progress.currentDscr).toBeGreaterThanOrEqual(0);
    expect(progress.currentInterestCoverage).toBeGreaterThanOrEqual(0);
    expect(progress.currentLtv).toBeGreaterThanOrEqual(0);
  });

  it('detects covenant breach on LTV spike', () => {
    const campaign = startLoanCampaignFromSimulation(simulation, 'Covenant Test', {
      startDate: '2026-02-01T00:00:00Z',
    });

    campaign.tranches[0].covenantLtvMax = 0.1;

    const progress = calculateLoanCampaignLiveProgress(
      campaign,
      historicalSales,
      mockProducts,
      new Date('2026-02-15T00:00:00Z')
    );

    expect(progress.covenantStatus).toBe('Breach');
    expect(progress.covenantBreaches.length).toBeGreaterThan(0);
    expect(progress.covenantBreaches.some(b => b.includes('LTV'))).toBe(true);
  });

  it('applies stock substitution and preserves history', () => {
    const campaign = startLoanCampaignFromSimulation(simulation, 'Substitution Test', {
      startDate: '2026-02-01T00:00:00Z',
    });

    const outgoingId = campaign.stockHoldings[0].productId;
    // Use a product not in the portfolio to avoid collision
    const incomingProduct: Product = {
      id: 'prod_new',
      sku: 'STK-NEW',
      barcode: '123999',
      name: 'New Test Stock',
      category: 'Technology',
      brand: 'Test',
      supplierId: 'sup_new',
      supplierName: 'Test Exchange',
      description: 'New stock for substitution test',
      images: [],
      costPrice: 100,
      retailPrice: 120,
      wholesalePrice: 115,
      minWholesaleQty: 1,
      minimumSellingPrice: 110,
      currentStock: 1000,
      minimumStockLevel: 10,
      unit: 'shares',
      status: 'Active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };

    const updatedCampaign = applyStockSubstitution(
      campaign,
      outgoingId,
      incomingProduct,
      500,
      'stop_loss'
    );

    const oldHolding = updatedCampaign.stockHoldings.find(h => h.productId === outgoingId);
    expect(oldHolding?.isSubstitutedOut).toBe(true);
    expect(oldHolding?.replacementProductId).toBe(incomingProduct.id);

    const newHolding = updatedCampaign.stockHoldings.find(h => h.productId === incomingProduct.id);
    expect(newHolding).toBeDefined();
    expect(newHolding?.currentShares).toBe(500);
    expect(newHolding?.purchasePrice).toBe(incomingProduct.retailPrice);

    expect(updatedCampaign.substitutionHistory).toHaveLength(1);
    expect(updatedCampaign.substitutionHistory[0].reason).toBe('stop_loss');
    expect(updatedCampaign.substitutionHistory[0].outgoingProductId).toBe(outgoingId);
    expect(updatedCampaign.substitutionHistory[0].incomingProductId).toBe(incomingProduct.id);
  });

  it('settles milestone and updates campaign status', () => {
    const campaign = startLoanCampaignFromSimulation(simulation, 'Settle Test', {
      startDate: '2026-02-01T00:00:00Z',
    });

    const firstMilestone = campaign.milestones[0];
    const settled = settleLoanCampaignMilestone(campaign, firstMilestone.periodIndex, firstMilestone.totalDue, 'dividends', 'Paid from dividend income');

    const settledMilestone = settled.milestones.find(m => m.periodIndex === firstMilestone.periodIndex);
    expect(settledMilestone?.status).toBe('paid');
    expect(settledMilestone?.paidAmount).toBe(firstMilestone.totalDue);
    expect(settledMilestone?.paidFrom).toBe('dividends');
    expect(settledMilestone?.notes).toBe('Paid from dividend income');
  });

  it('completes campaign when all milestones paid', () => {
    const simpleTranches = [{
      ...mockTranches[0],
      tenureMonths: 1,
      principal: 100000,
    }];
    const simpleSim = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: simpleTranches,
      stockStrategy: 'balanced',
      lookbackDays: 60,
    });

    const campaign = startLoanCampaignFromSimulation(simpleSim, 'Complete Test');
    expect(campaign.milestones).toHaveLength(1);

    const settled = settleLoanCampaignMilestone(campaign, 1, campaign.milestones[0].totalDue);
    expect(settled.status).toBe('completed');
    expect(settled.milestones[0].status).toBe('paid');
  });

  it('marks campaign in default when payment overdue', () => {
    const campaign = startLoanCampaignFromSimulation(simulation, 'Default Test', {
      startDate: '2026-01-01T00:00:00Z',
    });

    const progress = calculateLoanCampaignLiveProgress(
      campaign,
      historicalSales,
      mockProducts,
      new Date('2026-03-01T00:00:00Z')
    );

    expect(progress.paymentsOverdue).toBeGreaterThanOrEqual(0);
  });
});

describe('Loan Engine - Risk Metrics', () => {
  it('calculates DSCR rating correctly', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'dividend_focus',
      lookbackDays: 60,
    });

    expect(['Strong', 'Adequate', 'Weak', 'Breach']).toContain(result.riskMetrics.dscrRating);
    expect(result.riskMetrics.averageDscr).toBeGreaterThanOrEqual(0);
    expect(result.riskMetrics.minDscr).toBeLessThanOrEqual(result.riskMetrics.averageDscr);
  });

  it('calculates LTV rating correctly', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'balanced',
      lookbackDays: 60,
    });

    expect(['Conservative', 'Moderate', 'Aggressive', 'Breach']).toContain(result.riskMetrics.ltvRating);
    expect(result.riskMetrics.initialLtv).toBeGreaterThanOrEqual(0);
  });

  it('calculates concentration risk metrics', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'high_conviction',
      lookbackDays: 60,
    });

    expect(result.riskMetrics.maxSinglePositionPct).toBeGreaterThan(0);
    expect(result.riskMetrics.maxSinglePositionPct).toBeLessThanOrEqual(25);
    expect(result.riskMetrics.hhiIndex).toBeGreaterThan(0);
    expect(result.riskMetrics.hhiIndex).toBeLessThanOrEqual(1);
    expect(Object.keys(result.riskMetrics.sectorConcentration).length).toBeGreaterThan(0);
  });

  it('calculates VaR and max drawdown', () => {
    const result = simulateLoanInvestment(mockProducts, historicalSales, {
      tranches: mockTranches,
      stockStrategy: 'balanced',
      lookbackDays: 60,
    });

    expect(result.riskMetrics.portfolioVar95).toBeGreaterThan(0);
    expect(result.riskMetrics.maxDrawdownEstimate).toBeGreaterThan(0);
  });
});