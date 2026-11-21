import { Product, Sale } from '../types';
import {
  LoanTranche,
  LoanRepaymentStructure,
  LoanRepaymentFrequency,
  StockAllocationStrategy,
  StockMetrics,
  StockAllocation,
  LoanSimulationResult,
  LoanMilestone,
  AutoSetupMode,
  AutoSetupObjective,
  BankLoanOffer,
  AutoSetupConstraints,
  AutoSetupParams,
  AutoSetupResult,
  AutoSetupVariant,
  SalesOpportunityAnalysis,
  AllocationConfig,
  DEFAULT_ALLOCATION_CONFIG,
} from '../types/loan';
import {
  calculateStockMetrics,
  allocateLoanToStocks,
  simulateLoanInvestment,
} from './loanEngine';

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function getDefaultWeights(objective: AutoSetupObjective): { profitWeight: number; safetyWeight: number; liquidityWeight: number } {
  switch (objective) {
    case 'max_profit':
      return { profitWeight: 1.0, safetyWeight: 0.1, liquidityWeight: 0.1 };
    case 'max_safety':
      return { profitWeight: 0.1, safetyWeight: 1.0, liquidityWeight: 0.3 };
    case 'balanced':
      return { profitWeight: 0.6, safetyWeight: 0.6, liquidityWeight: 0.3 };
    case 'custom':
      return { profitWeight: 0.5, safetyWeight: 0.5, liquidityWeight: 0.3 };
    default:
      return { profitWeight: 0.6, safetyWeight: 0.6, liquidityWeight: 0.3 };
  }
}

export function analyzeSalesOpportunity(
  products: Product[],
  sales: Sale[],
  lookbackDays: number,
  maxTenureMonths: number,
  config: Partial<AllocationConfig> = {}
): SalesOpportunityAnalysis {
  const cfg = { ...DEFAULT_ALLOCATION_CONFIG, ...config };
  const stockMetrics = calculateStockMetrics(products, sales, lookbackDays, maxTenureMonths, config);
  const eligibleStocks = stockMetrics.filter(s => s.currentPrice > s.purchasePrice && s.avgDailyVolume >= cfg.minDailyVelocity);

  if (eligibleStocks.length === 0) {
    return {
      totalDeployableCapital: 0,
      topSectors: [],
      avgStockReturn: 0,
      avgStockVolatility: 0,
      liquidityScore: 0,
      recommendedMaxPrincipal: 0,
      recommendedTenureMonths: maxTenureMonths,
      warnings: ['No eligible stocks with positive margin and adequate liquidity'],
    };
  }

  const totalDeployableCapital = eligibleStocks.reduce((sum, s) => {
    const maxShares = Math.min(s.maxSharesByLiquidity, s.maxSharesByTenure);
    return sum + maxShares * s.currentPrice;
  }, 0);

  const sectorOpp: Record<string, number> = {};
  eligibleStocks.forEach(s => {
    const maxShares = Math.min(s.maxSharesByLiquidity, s.maxSharesByTenure);
    const capital = maxShares * s.currentPrice;
    sectorOpp[s.sector] = (sectorOpp[s.sector] || 0) + capital * (s.expectedReturnPct / 100);
  });

  const topSectors = Object.entries(sectorOpp)
    .map(([sector, opportunity]) => ({ sector, opportunity }))
    .sort((a, b) => b.opportunity - a.opportunity)
    .slice(0, 5);

  const avgStockReturn = eligibleStocks.reduce((sum, s) => sum + s.expectedReturnPct, 0) / eligibleStocks.length;
  const avgStockVolatility = eligibleStocks.reduce((sum, s) => sum + s.volatilityProxy, 0) / eligibleStocks.length;
  const liquidityScore = eligibleStocks.reduce((sum, s) => sum + s.liquidityScore, 0) / eligibleStocks.length;

  const avgTurnoverCycles = eligibleStocks.reduce((sum, s) => sum + s.turnoverCycles, 0) / eligibleStocks.length;
  const recommendedTenureMonths = Math.min(maxTenureMonths, Math.max(3, Math.round(maxTenureMonths / Math.max(1, avgTurnoverCycles))));

  const warnings: string[] = [];
  const lowLiquidityCount = eligibleStocks.filter(s => s.avgDailyVolume < 0.2).length;
  if (lowLiquidityCount > eligibleStocks.length * 0.3) {
    warnings.push(`${lowLiquidityCount} of ${eligibleStocks.length} stocks have low liquidity (velocity < 0.2/day)`);
  }
  if (avgStockReturn < 8) {
    warnings.push(`Average expected stock return (${avgStockReturn.toFixed(1)}%) is low relative to typical loan rates`);
  }
  if (totalDeployableCapital < 100000) {
    warnings.push(`Total deployable capital (₦${totalDeployableCapital.toLocaleString()}) is very limited`);
  }

  return {
    totalDeployableCapital,
    topSectors,
    avgStockReturn,
    avgStockVolatility,
    liquidityScore,
    recommendedMaxPrincipal: totalDeployableCapital,
    recommendedTenureMonths,
    warnings,
  };
}

function buildTrancheFromParams(
  params: {
    principal: number;
    tenureMonths: number;
    structure: LoanRepaymentStructure;
    frequency: LoanRepaymentFrequency;
    interestOnlyMonths?: number;
  },
  bankOffer: BankLoanOffer,
  index: number
): LoanTranche {
  return {
    id: `auto_tranche_${index}`,
    name: `Auto Tranche ${String.fromCharCode(65 + index)}`,
    type: 'term_loan',
    principal: params.principal,
    interestRate: bankOffer.annualRate,
    interestRateType: bankOffer.rateType,
    referenceRate: bankOffer.referenceRate,
    spreadBps: bankOffer.spreadBps,
    tenureMonths: params.tenureMonths,
    repaymentStructure: params.structure,
    repaymentFrequency: params.frequency,
    interestOnlyMonths: params.interestOnlyMonths,
    originationFeeBps: bankOffer.originationFeeBps,
    commitmentFeeBps: bankOffer.commitmentFeeBps,
    covenantDscrMin: bankOffer.covenantDscrMin,
    covenantLtvMax: bankOffer.covenantLtvMax,
  };
}

export function scoreSimulation(
  sim: LoanSimulationResult,
  weights: { profitWeight: number; safetyWeight: number; liquidityWeight: number }
): number {
  const netProfit = sim.netCashFlowOverTenure;
  const minDscr = sim.riskMetrics.minDscr || 0;
  const avgDscr = sim.riskMetrics.averageDscr || 0;
  const ltv = sim.riskMetrics.initialLtv || 1;
  const maxPos = sim.riskMetrics.maxSinglePositionPct || 0;
  const hhi = sim.riskMetrics.hhiIndex || 1;

  const profitScore = netProfit > 0 ? Math.log10(netProfit + 1) * 100 : netProfit * 0.1;
  const safetyScore = (minDscr * 200) + (avgDscr * 100) - (ltv * 500) - (maxPos * 5);
  const liquidityScore = (1 - hhi) * 100;

  return profitScore * weights.profitWeight + safetyScore * weights.safetyWeight + liquidityScore * weights.liquidityWeight;
}

function runSimulationForParams(
  products: Product[],
  sales: Sale[],
  tranches: LoanTranche[],
  stockStrategy: StockAllocationStrategy,
  lookbackDays: number,
  allocationConfig: Partial<AllocationConfig>
): LoanSimulationResult {
  return simulateLoanInvestment(products, sales, {
    tranches,
    stockStrategy,
    lookbackDays,
  });
}

function getStructureVariants(
  bankOffer: BankLoanOffer,
  tenureMonths: number
): { structure: LoanRepaymentStructure; frequency: LoanRepaymentFrequency; interestOnlyMonths?: number }[] {
  const variants: { structure: LoanRepaymentStructure; frequency: LoanRepaymentFrequency; interestOnlyMonths?: number }[] = [];

  bankOffer.availableStructures.forEach(struct => {
    bankOffer.availableFrequencies.forEach(freq => {
      if (struct === 'interest_only_then_amortized') {
        const maxIO = Math.min(6, Math.floor(tenureMonths / 2));
        for (let io = 1; io <= maxIO; io++) {
          variants.push({ structure: struct, frequency: freq, interestOnlyMonths: io });
        }
      } else {
        variants.push({ structure: struct, frequency: freq });
      }
    });
  });

  return variants.length > 0 ? variants : [{ structure: 'amortized', frequency: 'monthly' }];
}

function findBestParams(
  products: Product[],
  sales: Sale[],
  bankOffer: BankLoanOffer,
  analysis: SalesOpportunityAnalysis,
  params: AutoSetupParams,
  allocationConfig: Partial<AllocationConfig>
): { tranches: LoanTranche[]; stockStrategy: StockAllocationStrategy; score: number; simulation: LoanSimulationResult } | null {
  const weights = params.customWeights || getDefaultWeights(params.objective);
  const maxPrincipal = params.constraints?.maxPrincipal || analysis.recommendedMaxPrincipal;
  const minPrincipal = params.constraints?.minPrincipal || Math.min(100000, maxPrincipal * 0.1);
  const effectiveMaxPrincipal = Math.min(maxPrincipal, analysis.totalDeployableCapital);
  
  if (effectiveMaxPrincipal < minPrincipal) return null;

  const principalStep = Math.max(100000, effectiveMaxPrincipal / 20);
  const tenuresToTry = params.constraints?.maxTenureMonths 
    ? [Math.min(params.constraints.maxTenureMonths, bankOffer.maxTenureMonths)]
    : [analysis.recommendedTenureMonths, Math.min(analysis.recommendedTenureMonths + 6, bankOffer.maxTenureMonths), bankOffer.maxTenureMonths].filter((v, i, a) => a.indexOf(v) === i);

  const structures = getStructureVariants(bankOffer, bankOffer.maxTenureMonths);
  const strategies: StockAllocationStrategy[] = ['dividend_focus', 'growth_focus', 'balanced', 'low_volatility', 'high_conviction'];

  let bestResult: { tranches: LoanTranche[]; stockStrategy: StockAllocationStrategy; score: number; simulation: LoanSimulationResult } | null = null;
  let bestScore = -Infinity;

  const principalToTry = params.principalMode === 'manual' && params.manualPrincipal
    ? [params.manualPrincipal]
    : Array.from({ length: 20 }, (_, i) => minPrincipal + i * principalStep).filter(p => p <= effectiveMaxPrincipal);

  for (const principal of principalToTry) {
    for (const tenureMonths of tenuresToTry) {
      for (const { structure, frequency, interestOnlyMonths } of structures) {
        if (tenureMonths < bankOffer.minTenureMonths || tenureMonths > bankOffer.maxTenureMonths) continue;

        const tranche = buildTrancheFromParams({ principal, tenureMonths, structure, frequency, interestOnlyMonths }, bankOffer, 0);

        for (const strategy of strategies) {
          try {
            const sim = runSimulationForParams(products, sales, [tranche], strategy, params.lookbackDays, allocationConfig);
            
            // Hard constraint checks
            if (params.constraints?.minDscr && sim.riskMetrics.minDscr < params.constraints.minDscr) continue;
            if (params.constraints?.maxLtv && sim.riskMetrics.initialLtv > params.constraints.maxLtv) continue;
            if (params.constraints?.maxAnnualRate && bankOffer.annualRate > params.constraints.maxAnnualRate) continue;
            if (params.constraints?.maxSectorConcentrationPct) {
              const maxSector = Object.values(sim.riskMetrics.sectorConcentration).reduce((a, b) => Math.max(a, b), 0);
              if (maxSector > params.constraints.maxSectorConcentrationPct) continue;
            }

            const score = scoreSimulation(sim, weights);
            if (score > bestScore) {
              bestScore = score;
              bestResult = { tranches: [tranche], stockStrategy: strategy, score, simulation: sim };
            }
          } catch (e) {
            // Skip invalid combinations
          }
        }
      }
    }
  }

  return bestResult;
}

function generateVariants(
  bestResult: { tranches: LoanTranche[]; stockStrategy: StockAllocationStrategy; score: number; simulation: LoanSimulationResult },
  bankOffer: BankLoanOffer,
  analysis: SalesOpportunityAnalysis,
  params: AutoSetupParams,
  products: Product[],
  sales: Sale[]
): AutoSetupVariant[] {
  const baseTranche = bestResult.tranches[0];
  const baseStrategy = bestResult.stockStrategy;
  const baseSim = bestResult.simulation;

  const variants: AutoSetupVariant[] = [];

  // Conservative: 80% principal, longer tenure, amortized, dividend_focus
  const conservativeTranche = buildTrancheFromParams(
    {
      principal: Math.round(baseTranche.principal * 0.8),
      tenureMonths: Math.min(baseTranche.tenureMonths + 6, bankOffer.maxTenureMonths),
      structure: 'amortized',
      frequency: 'monthly',
    },
    bankOffer,
    0
  );
  try {
    const sim = runSimulationForParams(
      products, sales, [conservativeTranche], 'dividend_focus', params.lookbackDays, {}
    );
    variants.push({
      label: 'Conservative',
      description: 'Lower principal, longer tenure, amortized payments, dividend-focused stocks for maximum safety',
      tranches: [conservativeTranche],
      stockStrategy: 'dividend_focus',
      principal: conservativeTranche.principal,
      tenureMonths: conservativeTranche.tenureMonths,
      projectedNetProfit: sim.netCashFlowOverTenure,
      projectedDscr: sim.riskMetrics.minDscr,
      projectedLtv: sim.riskMetrics.initialLtv,
      riskRating: sim.riskMetrics.minDscr >= 1.5 ? 'Low' : sim.riskMetrics.minDscr >= 1.2 ? 'Medium' : 'High',
      score: scoreSimulation(sim, { profitWeight: 0.3, safetyWeight: 1.0, liquidityWeight: 0.3 }),
      simulation: sim,
    });
  } catch (e) {
    // Skip if simulation fails
  }

  // Balanced: the optimized result
  variants.push({
    label: 'Balanced',
    description: 'Optimized for best risk-adjusted return based on your objective',
    tranches: [baseTranche],
    stockStrategy: baseStrategy,
    principal: baseTranche.principal,
    tenureMonths: baseTranche.tenureMonths,
    projectedNetProfit: baseSim.netCashFlowOverTenure,
    projectedDscr: baseSim.riskMetrics.minDscr,
    projectedLtv: baseSim.riskMetrics.initialLtv,
    riskRating: baseSim.riskMetrics.minDscr >= 1.5 ? 'Low' : baseSim.riskMetrics.minDscr >= 1.2 ? 'Medium' : 'High',
    score: bestResult.score,
    simulation: baseSim,
  });

  // Aggressive: 110% principal (capped at deployable), shorter tenure, bullet, growth_focus
  const aggressivePrincipal = Math.min(Math.round(baseTranche.principal * 1.1), analysis.totalDeployableCapital);
  const aggressiveTranche = buildTrancheFromParams(
    {
      principal: aggressivePrincipal,
      tenureMonths: Math.max(baseTranche.tenureMonths - 3, bankOffer.minTenureMonths),
      structure: 'bullet',
      frequency: 'monthly',
    },
    bankOffer,
    0
  );
  try {
    const sim = runSimulationForParams(
      products, sales, [aggressiveTranche], 'growth_focus', params.lookbackDays, {}
    );
    variants.push({
      label: 'Aggressive',
      description: 'Higher principal, shorter tenure, bullet payment, growth-focused stocks for maximum profit potential',
      tranches: [aggressiveTranche],
      stockStrategy: 'growth_focus',
      principal: aggressiveTranche.principal,
      tenureMonths: aggressiveTranche.tenureMonths,
      projectedNetProfit: sim.netCashFlowOverTenure,
      projectedDscr: sim.riskMetrics.minDscr,
      projectedLtv: sim.riskMetrics.initialLtv,
      riskRating: sim.riskMetrics.minDscr >= 1.5 ? 'Low' : sim.riskMetrics.minDscr >= 1.2 ? 'Medium' : 'High',
      score: scoreSimulation(sim, { profitWeight: 1.0, safetyWeight: 0.3, liquidityWeight: 0.1 }),
      simulation: sim,
    });
  } catch (e) {
    // Skip if simulation fails
  }

  // Filter to only valid variants
  return variants.filter(v => v.simulation && v.projectedDscr > 0);
}

function buildExplanation(
  variants: AutoSetupVariant[],
  analysis: SalesOpportunityAnalysis,
  relaxed: boolean,
  params: AutoSetupParams
): string {
  const lines: string[] = [];

  if (relaxed) {
    lines.push('⚠️ No scenario met all your strict constraints. The variants below use relaxed constraints (shown with warning badges).');
    lines.push('');
  }

  lines.push(`Based on ${analysis.topSectors.length > 0 ? analysis.topSectors[0].sector : 'available stocks'} sector opportunity and ${analysis.topSectors.length} active sectors:`);
  lines.push('');

  variants.forEach(v => {
    lines.push(`• ${v.label}: ₦${v.principal.toLocaleString()} over ${v.tenureMonths} months → Net: ₦${v.projectedNetProfit.toLocaleString()}, Min DSCR: ${v.projectedDscr.toFixed(2)}x, LTV: ${(v.projectedLtv * 100).toFixed(1)}%`);
  });

  lines.push('');
  if (analysis.warnings.length > 0) {
    lines.push('⚠️ Warnings:');
    analysis.warnings.forEach(w => lines.push(`  - ${w}`));
  }

  return lines.join('\n');
}

export function runAutoSetup(
  products: Product[],
  sales: Sale[],
  params: AutoSetupParams
): AutoSetupResult {
  const maxTenureMonths = params.bankOffer.maxTenureMonths;
  const allocationConfig: Partial<AllocationConfig> = {};

  // Step 1: Analyze sales opportunity
  const analysis = analyzeSalesOpportunity(products, sales, params.lookbackDays, maxTenureMonths, allocationConfig);

  if (analysis.totalDeployableCapital === 0) {
    return {
      success: false,
      variants: [],
      explanation: 'No eligible stocks found with positive margin and adequate liquidity. Cannot construct a viable loan scenario.',
      analysis,
    };
  }

  // Step 2: Find best parameters
  const bestResult = findBestParams(products, sales, params.bankOffer, analysis, params, allocationConfig);

  // Fallback: if no optimal params found, create a basic viable scenario
  if (!bestResult) {
    // Try relaxed constraints
    const relaxedParams = { ...params, constraints: { ...params.constraints, minDscr: undefined, maxLtv: undefined } };
    const relaxedResult = findBestParams(products, sales, params.bankOffer, analysis, relaxedParams, allocationConfig);
    
    if (relaxedResult) {
      const variants = generateVariants(relaxedResult, params.bankOffer, analysis, params, products, sales);
      return {
        success: true,
        variants,
        explanation: buildExplanation(variants, analysis, true, params),
        relaxedFromConstraints: true,
        analysis,
      };
    }

    // Ultimate fallback: create a basic scenario with sensible defaults
    const fallbackTranche = buildTrancheFromParams(
      {
        principal: Math.min(analysis.recommendedMaxPrincipal, 1000000),
        tenureMonths: Math.min(analysis.recommendedTenureMonths, params.bankOffer.maxTenureMonths),
        structure: 'amortized',
        frequency: 'monthly',
      },
      params.bankOffer,
      0
    );
    try {
      const fallbackSim = runSimulationForParams(
        products, sales, [fallbackTranche], 'balanced', params.lookbackDays, allocationConfig
      );
      const fallbackVariants: AutoSetupVariant[] = [{
        label: 'Balanced',
        description: 'Fallback scenario with sensible defaults (optimization could not find better)',
        tranches: [fallbackTranche],
        stockStrategy: 'balanced',
        principal: fallbackTranche.principal,
        tenureMonths: fallbackTranche.tenureMonths,
        projectedNetProfit: fallbackSim.netCashFlowOverTenure,
        projectedDscr: fallbackSim.riskMetrics.minDscr,
        projectedLtv: fallbackSim.riskMetrics.initialLtv,
        riskRating: fallbackSim.riskMetrics.minDscr >= 1.5 ? 'Low' : fallbackSim.riskMetrics.minDscr >= 1.2 ? 'Medium' : 'High',
        score: 0,
        simulation: fallbackSim,
      }];
      return {
        success: true,
        variants: fallbackVariants,
        explanation: 'Optimization did not find a clearly superior scenario. Showing a balanced fallback with sensible defaults. Consider adjusting bank terms or constraints for better results.',
        analysis,
      };
    } catch (e) {
      return {
        success: false,
        variants: [],
        explanation: 'No viable loan scenario found even with relaxed constraints. The stock returns may be too low relative to the loan rate.',
        analysis,
      };
    }
  }

  // Step 3: Generate variants
  const variants = generateVariants(bestResult, params.bankOffer, analysis, params, products, sales);

  if (variants.length === 0) {
    return {
      success: false,
      variants: [],
      explanation: 'Could not generate valid variants from the optimized parameters.',
      analysis,
    };
  }

  return {
    success: true,
    variants,
    explanation: buildExplanation(variants, analysis, false, params),
    analysis,
  };
}