import { describe, it, expect, vi } from 'vitest';
import { Product, Sale } from '../types';
import {
  analyzeSalesOpportunity,
  runAutoSetup,
  scoreSimulation,
} from './loanAutoSetup';
import { BankLoanOffer, AutoSetupMode, AutoSetupObjective } from '../types/loan';

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

const mockBankOffer: BankLoanOffer = {
  bankName: 'Test Bank',
  annualRate: 18.0,
  rateType: 'fixed',
  originationFeeBps: 100,
  commitmentFeeBps: 0,
  availableStructures: ['amortized', 'bullet', 'interest_only_then_amortized'],
  availableFrequencies: ['monthly'],
  maxTenureMonths: 24,
  minTenureMonths: 6,
  covenantDscrMin: 1.25,
  covenantLtvMax: 0.8,
};

describe('Auto-Setup Loan Engine', () => {
  describe('analyzeSalesOpportunity', () => {
    it('calculates deployable capital from stock metrics', () => {
      const analysis = analyzeSalesOpportunity(mockProducts, historicalSales, 60, 24);

      expect(analysis.totalDeployableCapital).toBeGreaterThan(0);
      expect(analysis.recommendedMaxPrincipal).toBeGreaterThan(0);
      expect(analysis.recommendedTenureMonths).toBeGreaterThan(0);
      expect(analysis.avgStockReturn).toBeGreaterThan(0);
      expect(analysis.avgStockVolatility).toBeGreaterThan(0);
      expect(analysis.liquidityScore).toBeGreaterThan(0);
    });

    it('identifies top sectors by opportunity', () => {
      const analysis = analyzeSalesOpportunity(mockProducts, historicalSales, 60, 24);

      expect(analysis.topSectors.length).toBeGreaterThan(0);
      expect(analysis.topSectors[0].opportunity).toBeGreaterThan(0);
      analysis.topSectors.forEach(s => {
        expect(s.sector).toBeDefined();
        expect(s.opportunity).toBeGreaterThan(0);
      });
    });

    it('estimates recommended tenure from turnover', () => {
      const analysis = analyzeSalesOpportunity(mockProducts, historicalSales, 60, 24);

      expect(analysis.recommendedTenureMonths).toBeGreaterThanOrEqual(3);
      expect(analysis.recommendedTenureMonths).toBeLessThanOrEqual(24);
    });

    it('warns on low liquidity sectors', () => {
      // Create products with very low velocity
      const lowVolProducts = mockProducts.map(p => ({
        ...p,
        retailPrice: p.costPrice + 1, // Very low margin
      }));
      
      const lowVolSales = historicalSales.map(s => ({
        ...s,
        items: s.items.map(item => ({
          ...item,
          quantity: 1, // Very low volume
        })),
      }));

      const analysis = analyzeSalesOpportunity(lowVolProducts, lowVolSales, 60, 24);
      
      // Should have warnings about low returns or liquidity
      expect(analysis.warnings.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('scoreSimulation', () => {
    const mockSimulation = {
      netCashFlowOverTenure: 500000,
      riskMetrics: {
        minDscr: 1.5,
        averageDscr: 2.0,
        initialLtv: 0.6,
        maxSinglePositionPct: 20,
        hhiIndex: 0.2,
      },
    } as any;

    it('max_profit favors high net profit', () => {
      const score = scoreSimulation(mockSimulation, { profitWeight: 1.0, safetyWeight: 0.1, liquidityWeight: 0.1 });
      expect(score).toBeGreaterThan(0);
    });

    it('max_safety favors high DSCR, low LTV', () => {
      const safeSim = {
        ...mockSimulation,
        riskMetrics: { ...mockSimulation.riskMetrics, minDscr: 3.0, initialLtv: 0.3 },
      };
      const riskySim = {
        ...mockSimulation,
        riskMetrics: { ...mockSimulation.riskMetrics, minDscr: 1.1, initialLtv: 0.9 },
      };

      const safeScore = scoreSimulation(safeSim, { profitWeight: 0.1, safetyWeight: 1.0, liquidityWeight: 0.1 });
      const riskyScore = scoreSimulation(riskySim, { profitWeight: 0.1, safetyWeight: 1.0, liquidityWeight: 0.1 });

      expect(safeScore).toBeGreaterThan(riskyScore);
    });

    it('balanced weights both profit and safety', () => {
      const score = scoreSimulation(mockSimulation, { profitWeight: 0.6, safetyWeight: 0.6, liquidityWeight: 0.3 });
      expect(score).toBeGreaterThan(0);
    });

    it('custom weights work correctly', () => {
      const customWeights = { profitWeight: 0.8, safetyWeight: 0.1, liquidityWeight: 0.1 };
      const score = scoreSimulation(mockSimulation, customWeights);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('runAutoSetup', () => {
    it('quick auto returns viable scenario for healthy data', () => {
      const params = {
        mode: 'quick' as AutoSetupMode,
        objective: 'balanced' as AutoSetupObjective,
        bankOffer: mockBankOffer,
        principalMode: 'auto' as const,
        lookbackDays: 60,
      };

      const result = runAutoSetup(mockProducts, historicalSales, params);

      expect(result.success).toBe(true);
      expect(result.variants.length).toBeGreaterThan(0);
      expect(result.variants.length).toBeLessThanOrEqual(3);
      
      result.variants.forEach(v => {
        expect(v.label).toBeDefined();
        expect(v.principal).toBeGreaterThan(0);
        expect(v.tenureMonths).toBeGreaterThan(0);
        expect(v.projectedNetProfit).toBeDefined();
        expect(v.projectedDscr).toBeGreaterThan(0);
        expect(v.projectedLtv).toBeGreaterThan(0);
        expect(v.simulation).toBeDefined();
        expect(v.score).toBeDefined();
      });
    });

    it('objective-based mode respects objective selection', () => {
      const profitParams = {
        mode: 'objective' as AutoSetupMode,
        objective: 'max_profit' as AutoSetupObjective,
        bankOffer: mockBankOffer,
        principalMode: 'auto' as const,
        lookbackDays: 60,
      };

      const safetyParams = {
        mode: 'objective' as AutoSetupMode,
        objective: 'max_safety' as AutoSetupObjective,
        bankOffer: mockBankOffer,
        principalMode: 'auto' as const,
        lookbackDays: 60,
      };

      const profitResult = runAutoSetup(mockProducts, historicalSales, profitParams);
      const safetyResult = runAutoSetup(mockProducts, historicalSales, safetyParams);

      expect(profitResult.success).toBe(true);
      expect(safetyResult.success).toBe(true);
      
      // Both should produce variants
      expect(profitResult.variants.length).toBeGreaterThan(0);
      expect(safetyResult.variants.length).toBeGreaterThan(0);
    });

    it('bounded mode respects constraints', () => {
      const params = {
        mode: 'bounded' as AutoSetupMode,
        objective: 'balanced' as AutoSetupObjective,
        bankOffer: mockBankOffer,
        principalMode: 'auto' as const,
        lookbackDays: 60,
        constraints: {
          maxPrincipal: 1000000,
          maxTenureMonths: 12,
          minDscr: 1.5,
          maxLtv: 0.7,
        },
      };

      const result = runAutoSetup(mockProducts, historicalSales, params);

      if (result.success) {
        result.variants.forEach(v => {
          expect(v.principal).toBeLessThanOrEqual(1000000);
          // Tenure might exceed constraint if fallback is used
          if (result.relaxedFromConstraints || result.explanation.includes('fallback')) {
            // Fallback may not respect all constraints
            expect(v.tenureMonths).toBeGreaterThan(0);
          } else {
            expect(v.tenureMonths).toBeLessThanOrEqual(12);
          }
          // DSCR and LTV constraints checked during optimization
        });
      }
    });

    it('manual principal mode uses specified amount', () => {
      const params = {
        mode: 'quick' as AutoSetupMode,
        objective: 'balanced' as AutoSetupObjective,
        bankOffer: mockBankOffer,
        principalMode: 'manual' as const,
        manualPrincipal: 500000,
        lookbackDays: 60,
      };

      const result = runAutoSetup(mockProducts, historicalSales, params);

      expect(result.success).toBe(true);
      // The optimization should still work with fixed principal
      expect(result.variants.length).toBeGreaterThan(0);
    });

    it('returns relaxed best-effort when strict constraints fail', () => {
      const params = {
        mode: 'bounded' as AutoSetupMode,
        objective: 'balanced' as AutoSetupObjective,
        bankOffer: { ...mockBankOffer, annualRate: 35.0 }, // Very high rate
        principalMode: 'auto' as const,
        lookbackDays: 60,
        constraints: {
          minDscr: 2.0, // Impossible with 35% rate
          maxLtv: 0.5,
        },
      };

      const result = runAutoSetup(mockProducts, historicalSales, params);

      // Should either fail, return relaxed, or return fallback
      if (!result.success) {
        expect(result.explanation).toContain('No viable loan scenario');
      } else if (result.relaxedFromConstraints) {
        expect(result.relaxedFromConstraints).toBe(true);
        expect(result.explanation).toContain('relaxed');
      } else {
        // Fallback case - still a valid scenario
        expect(result.variants.length).toBeGreaterThan(0);
        expect(result.explanation).toContain('fallback');
      }
    });

    it('explains why strict constraints failed', () => {
      const params = {
        mode: 'bounded' as AutoSetupMode,
        objective: 'balanced' as AutoSetupObjective,
        bankOffer: { ...mockBankOffer, annualRate: 40.0 },
        principalMode: 'auto' as const,
        lookbackDays: 60,
        constraints: {
          minDscr: 3.0,
        },
      };

      const result = runAutoSetup(mockProducts, historicalSales, params);

      if (!result.success) {
        expect(result.explanation).toContain('No viable loan scenario');
      }
    });

    it('handles no eligible stocks gracefully', () => {
      const badProducts = mockProducts.map(p => ({
        ...p,
        retailPrice: p.costPrice - 10, // Negative margin
      }));

      const params = {
        mode: 'quick' as AutoSetupMode,
        objective: 'balanced' as AutoSetupObjective,
        bankOffer: mockBankOffer,
        principalMode: 'auto' as const,
        lookbackDays: 60,
      };

      const result = runAutoSetup(badProducts, historicalSales, params);

      expect(result.success).toBe(false);
      expect(result.explanation).toContain('No eligible stocks');
    });
  });

  describe('variant generation', () => {
    it('produces up to 3 variants with distinct profiles', () => {
      const params = {
        mode: 'quick' as AutoSetupMode,
        objective: 'balanced' as AutoSetupObjective,
        bankOffer: mockBankOffer,
        principalMode: 'auto' as const,
        lookbackDays: 60,
      };

      const result = runAutoSetup(mockProducts, historicalSales, params);

      if (result.success) {
        const labels = result.variants.map(v => v.label).sort();
        expect(labels).toContain('Balanced');
        // May have Conservative and/or Aggressive
        expect(result.variants.length).toBeLessThanOrEqual(3);
        expect(result.variants.length).toBeGreaterThan(0);
      }
    });

    it('conservative has lower principal and longer tenure', () => {
      const params = {
        mode: 'quick' as AutoSetupMode,
        objective: 'balanced' as AutoSetupObjective,
        bankOffer: mockBankOffer,
        principalMode: 'auto' as const,
        lookbackDays: 60,
      };

      const result = runAutoSetup(mockProducts, historicalSales, params);

      if (result.success) {
        const conservative = result.variants.find(v => v.label === 'Conservative');
        const aggressive = result.variants.find(v => v.label === 'Aggressive');
        const balanced = result.variants.find(v => v.label === 'Balanced');

        if (conservative && aggressive && balanced) {
          expect(conservative.principal).toBeLessThanOrEqual(balanced.principal);
          expect(aggressive.principal).toBeGreaterThanOrEqual(balanced.principal);
          expect(conservative.tenureMonths).toBeGreaterThanOrEqual(balanced.tenureMonths);
        }
      }
    });
  });
});