import { describe, it, expect } from 'vitest';
import { Product, Sale } from '../types';
import {
  simulateInvestment,
  startCampaignFromSimulation,
  calculateCampaignLiveProgress,
  findReplacementCandidates,
  applySkuSubstitution,
  settleCampaignMilestone,
} from './investmentEngine';

describe('Active Investment Campaign Engine', () => {
  const mockProducts: Product[] = [
    {
      id: 'prod_1',
      sku: 'SKU-SLOW',
      barcode: '123001',
      name: 'Slow Moving Item',
      category: 'Electronics',
      brand: 'Generic',
      supplierId: 'sup_1',
      supplierName: 'Main Supplier',
      description: 'Slow item',
      images: [],
      costPrice: 1000,
      retailPrice: 2000,
      wholesalePrice: 1800,
      minWholesaleQty: 5,
      minimumSellingPrice: 1500,
      currentStock: 100,
      minimumStockLevel: 5,
      unit: 'pcs',
      status: 'Active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'prod_2',
      sku: 'SKU-FAST',
      barcode: '123002',
      name: 'Fast Moving Item',
      category: 'Electronics',
      brand: 'Generic',
      supplierId: 'sup_1',
      supplierName: 'Main Supplier',
      description: 'Fast item',
      images: [],
      costPrice: 1500,
      retailPrice: 3000,
      wholesalePrice: 2700,
      minWholesaleQty: 5,
      minimumSellingPrice: 2200,
      currentStock: 200,
      minimumStockLevel: 10,
      unit: 'pcs',
      status: 'Active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'prod_3',
      sku: 'SKU-HERO',
      barcode: '123003',
      name: 'Super High Margin Hero',
      category: 'Accessories',
      brand: 'HeroBrand',
      supplierId: 'sup_2',
      supplierName: 'Accessory Supplier',
      description: 'Hero item',
      images: [],
      costPrice: 500,
      retailPrice: 2000,
      wholesalePrice: 1800,
      minWholesaleQty: 5,
      minimumSellingPrice: 1200,
      currentStock: 300,
      minimumStockLevel: 10,
      unit: 'pcs',
      status: 'Active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  const historicalSales: Sale[] = [
    {
      id: 'hist_1',
      invoiceNo: 'INV-H1',
      customerName: 'Alice',
      type: 'Retail',
      items: [{ productId: 'prod_1', productName: 'Slow Moving Item', sku: 'SKU-SLOW', quantity: 10, unitPrice: 2000, costPrice: 1000, total: 20000 }],
      subtotal: 20000,
      discount: 0,
      tax: 0,
      totalAmount: 20000,
      paidAmount: 20000,
      paymentMethod: 'Cash',
      status: 'Completed',
      createdBy: 'user',
      createdAt: '2026-01-15T10:00:00Z',
    },
    {
      id: 'hist_2',
      invoiceNo: 'INV-H2',
      customerName: 'Bob',
      type: 'Retail',
      items: [{ productId: 'prod_2', productName: 'Fast Moving Item', sku: 'SKU-FAST', quantity: 60, unitPrice: 3000, costPrice: 1500, total: 180000 }],
      subtotal: 180000,
      discount: 0,
      tax: 0,
      totalAmount: 180000,
      paidAmount: 180000,
      paymentMethod: 'Cash',
      status: 'Completed',
      createdBy: 'user',
      createdAt: '2026-01-20T10:00:00Z',
    },
  ];

  it('initializes an active campaign from simulation result', () => {
    const simulation = simulateInvestment(mockProducts, historicalSales, {
      investmentAmount: 100000,
      tenureMonths: 3,
      payoutFrequency: 'monthly',
      returnModel: 'profit_share',
      repaymentStructure: 'bullet_maturity',
      yieldRate: 25,
      strategy: 'balanced',
      customProductAllocations: {
        prod_1: 40, // 40 * 1000 = 40,000
        prod_2: 40, // 40 * 1500 = 60,000
      },
    });

    const campaign = startCampaignFromSimulation(simulation, 'Q1 Expansion Tranche', {
      investorName: 'Chief Ade',
      startDate: '2026-02-01T00:00:00Z',
    });

    expect(campaign.id).toContain('camp_');
    expect(campaign.name).toBe('Q1 Expansion Tranche');
    expect(campaign.investorName).toBe('Chief Ade');
    expect(campaign.status).toBe('active');
    expect(campaign.allocatedProducts).toHaveLength(2);
    expect(campaign.allocatedProducts[0].initialTargetQty).toBe(40);
    expect(campaign.milestones).toHaveLength(3);
    expect(campaign.milestones[0].status).toBe('pending');
  });

  it('attributes real-time sales made after start date and caps at target quantity', () => {
    const simulation = simulateInvestment(mockProducts, historicalSales, {
      investmentAmount: 100000,
      tenureMonths: 3,
      payoutFrequency: 'monthly',
      returnModel: 'profit_share',
      repaymentStructure: 'bullet_maturity',
      yieldRate: 25,
      strategy: 'balanced',
      customProductAllocations: {
        prod_1: 10, // 10 units max ceiling
      },
    });

    const campaign = startCampaignFromSimulation(simulation, 'Test Cap', {
      startDate: '2026-02-01T00:00:00Z',
    });

    const sales: Sale[] = [
      // Pre-start sale (must be ignored)
      {
        id: 'sale_before',
        invoiceNo: 'INV-0',
        customerName: 'Prior',
        type: 'Retail',
        items: [{ productId: 'prod_1', productName: 'Slow', sku: 'SKU-SLOW', quantity: 5, unitPrice: 2000, costPrice: 1000, total: 10000 }],
        subtotal: 10000,
        discount: 0,
        tax: 0,
        totalAmount: 10000,
        paidAmount: 10000,
        paymentMethod: 'Cash',
        status: 'Completed',
        createdBy: 'u',
        createdAt: '2026-01-31T23:59:59Z',
      },
      // Valid campaign sale (6 units)
      {
        id: 'sale_1',
        invoiceNo: 'INV-1',
        customerName: 'Dave',
        type: 'Retail',
        items: [{ productId: 'prod_1', productName: 'Slow', sku: 'SKU-SLOW', quantity: 6, unitPrice: 2000, costPrice: 1000, total: 12000 }],
        subtotal: 12000,
        discount: 0,
        tax: 0,
        totalAmount: 12000,
        paidAmount: 12000,
        paymentMethod: 'Cash',
        status: 'Completed',
        createdBy: 'u',
        createdAt: '2026-02-05T10:00:00Z',
      },
      // Another sale (6 units, but should cap at 4 units remaining)
      {
        id: 'sale_2',
        invoiceNo: 'INV-2',
        customerName: 'Emma',
        type: 'Retail',
        items: [{ productId: 'prod_1', productName: 'Slow', sku: 'SKU-SLOW', quantity: 6, unitPrice: 2000, costPrice: 1000, total: 12000 }],
        subtotal: 12000,
        discount: 0,
        tax: 0,
        totalAmount: 12000,
        paidAmount: 12000,
        paymentMethod: 'Cash',
        status: 'Completed',
        createdBy: 'u',
        createdAt: '2026-02-10T10:00:00Z',
      },
    ];

    const progress = calculateCampaignLiveProgress(
      campaign,
      sales,
      mockProducts,
      new Date('2026-02-15T00:00:00Z')
    );

    const tracking = progress.productTrackings.find((p) => p.product.productId === 'prod_1');
    expect(tracking).toBeDefined();
    expect(tracking?.unitsSold).toBe(10); // Capped at target 10
    expect(tracking?.remainingUnits).toBe(0);
    expect(tracking?.sellThroughPct).toBe(100);
    expect(tracking?.grossRevenue).toBe(20000); // 10 * 2000
    expect(tracking?.cogsRecovered).toBe(10000); // 10 * 1000
    expect(tracking?.realizedGrossProfit).toBe(10000);

    // Profit share is 25% of 10,000 profit = 2,500
    expect(progress.investorAccruedReturn).toBe(2500);
    expect(progress.businessRetainedProfit).toBe(7500);
  });

  it('correctly handles returned quantities in sales', () => {
    const simulation = simulateInvestment(mockProducts, historicalSales, {
      investmentAmount: 50000,
      tenureMonths: 1,
      payoutFrequency: 'monthly',
      returnModel: 'profit_share',
      repaymentStructure: 'bullet_maturity',
      yieldRate: 20,
      strategy: 'balanced',
      customProductAllocations: {
        prod_1: 20,
      },
    });

    const campaign = startCampaignFromSimulation(simulation, 'Refund Test', {
      startDate: '2026-02-01T00:00:00Z',
    });

    const sales: Sale[] = [
      {
        id: 'sale_with_return',
        invoiceNo: 'INV-RET',
        customerName: 'Sam',
        type: 'Retail',
        items: [
          {
            productId: 'prod_1',
            productName: 'Slow',
            sku: 'SKU-SLOW',
            quantity: 5,
            returnedQuantity: 2, // 2 returned, net 3 sold
            unitPrice: 2000,
            costPrice: 1000,
            total: 10000,
          },
        ],
        subtotal: 10000,
        discount: 0,
        tax: 0,
        totalAmount: 10000,
        paidAmount: 10000,
        paymentMethod: 'Cash',
        status: 'Completed',
        createdBy: 'u',
        createdAt: '2026-02-03T10:00:00Z',
      },
    ];

    const progress = calculateCampaignLiveProgress(
      campaign,
      sales,
      mockProducts,
      new Date('2026-02-05T00:00:00Z')
    );

    const tracking = progress.productTrackings.find((p) => p.product.productId === 'prod_1');
    expect(tracking?.unitsSold).toBe(3);
    expect(tracking?.grossRevenue).toBe(6000);
  });

  it('diagnoses underperforming/drag SKUs and generates smart replacement recommendations', () => {
    const simulation = simulateInvestment(mockProducts, historicalSales, {
      investmentAmount: 100000,
      tenureMonths: 2, // 60 days
      payoutFrequency: 'monthly',
      returnModel: 'profit_share',
      repaymentStructure: 'bullet_maturity',
      yieldRate: 25,
      strategy: 'balanced',
      customProductAllocations: {
        prod_1: 50, // 50 units * 1000 = 50,000
      },
    });

    const campaign = startCampaignFromSimulation(simulation, 'Underperforming Test', {
      startDate: '2026-02-01T00:00:00Z',
    });

    // prod_1 projected velocity is > 0.15, but only 1 unit sold in 20 days (velocity 0.05 / day)
    const sales: Sale[] = [
      {
        id: 'sale_drag',
        invoiceNo: 'INV-DRAG',
        customerName: 'Tardy',
        type: 'Retail',
        items: [{ productId: 'prod_1', productName: 'Slow', sku: 'SKU-SLOW', quantity: 1, unitPrice: 2000, costPrice: 1000, total: 2000 }],
        subtotal: 2000,
        discount: 0,
        tax: 0,
        totalAmount: 2000,
        paidAmount: 2000,
        paymentMethod: 'Cash',
        status: 'Completed',
        createdBy: 'u',
        createdAt: '2026-02-05T10:00:00Z',
      },
    ];

    const progress = calculateCampaignLiveProgress(
      campaign,
      sales,
      mockProducts,
      new Date('2026-02-21T00:00:00Z') // 20 days elapsed
    );

    expect(progress.healthStatus).toBe('At Risk');
    expect(progress.flaggedDragProducts.length).toBeGreaterThan(0);
    expect(progress.flaggedDragProducts[0].tracking.isUnderperforming).toBe(true);

    const recs = progress.replacementRecommendations['prod_1'];
    expect(recs).toBeDefined();
    expect(recs.length).toBeGreaterThan(0);
    // Best candidate should be prod_3 or prod_2 (faster velocity and high margin)
    expect(recs[0].productId).not.toBe('prod_1');
    expect(recs[0].compositeScore).toBeGreaterThan(0);
    expect(recs[0].recommendedUnits).toBeGreaterThan(0);
  });

  it('applies mid-flight SKU substitution and preserves realized sales history', () => {
    const simulation = simulateInvestment(mockProducts, historicalSales, {
      investmentAmount: 100000,
      tenureMonths: 2,
      payoutFrequency: 'monthly',
      returnModel: 'profit_share',
      repaymentStructure: 'bullet_maturity',
      yieldRate: 25,
      strategy: 'balanced',
      customProductAllocations: {
        prod_1: 50,
      },
    });

    const campaign = startCampaignFromSimulation(simulation, 'Swap Test', {
      startDate: '2026-02-01T00:00:00Z',
    });

    const sales: Sale[] = [
      {
        id: 'sale_prior',
        invoiceNo: 'INV-P1',
        customerName: 'Shopper',
        type: 'Retail',
        items: [{ productId: 'prod_1', productName: 'Slow', sku: 'SKU-SLOW', quantity: 5, unitPrice: 2000, costPrice: 1000, total: 10000 }],
        subtotal: 10000,
        discount: 0,
        tax: 0,
        totalAmount: 10000,
        paidAmount: 10000,
        paymentMethod: 'Cash',
        status: 'Completed',
        createdBy: 'u',
        createdAt: '2026-02-10T10:00:00Z',
      },
    ];

    // Outgoing prod_1 had 50 target, 5 sold. 45 units unsold * 1000 = 45,000 freed.
    // Replace with prod_3 (cost 500), can afford up to 45,000 / 500 = 90 units
    const updatedCampaign = applySkuSubstitution(
      campaign,
      'prod_1',
      mockProducts[2], // prod_3
      90,
      'slow_velocity',
      sales
    );

    // Old product should be frozen to realized 5 units
    const oldProd = updatedCampaign.allocatedProducts.find((p) => p.productId === 'prod_1');
    expect(oldProd?.currentTargetQty).toBe(5);
    expect(oldProd?.isSubstitutedOut).toBe(true);
    expect(oldProd?.replacementProductId).toBe('prod_3');

    // New product added
    const newProd = updatedCampaign.allocatedProducts.find((p) => p.productId === 'prod_3');
    expect(newProd).toBeDefined();
    expect(newProd?.currentTargetQty).toBe(90);
    expect(newProd?.costPrice).toBe(500);

    // Substitution history recorded
    expect(updatedCampaign.substitutionHistory).toHaveLength(1);
    expect(updatedCampaign.substitutionHistory[0].outgoingRealizedUnitsSold).toBe(5);
    expect(updatedCampaign.substitutionHistory[0].outgoingCapitalFreed).toBe(45000);
    expect(updatedCampaign.substitutionHistory[0].incomingProductId).toBe('prod_3');
  });

  it('settles campaign milestone and completes when final payout made', () => {
    const simulation = simulateInvestment(mockProducts, historicalSales, {
      investmentAmount: 50000,
      tenureMonths: 1, // 1 milestone
      payoutFrequency: 'end_of_tenure',
      returnModel: 'fixed_yield',
      repaymentStructure: 'lump_sum_end',
      yieldRate: 5,
      strategy: 'balanced',
      customProductAllocations: {
        prod_2: 30,
      },
    });

    const campaign = startCampaignFromSimulation(simulation, 'Settle Test');
    expect(campaign.milestones).toHaveLength(1);
    expect(campaign.milestones[0].status).toBe('pending');

    const settled = settleCampaignMilestone(campaign, 1, 52500, 'Paid via GTBank Transfer');
    expect(settled.milestones[0].status).toBe('settled');
    expect(settled.milestones[0].settledAmount).toBe(52500);
    expect(settled.milestones[0].settledNotes).toBe('Paid via GTBank Transfer');
    expect(settled.status).toBe('completed');
  });
});
