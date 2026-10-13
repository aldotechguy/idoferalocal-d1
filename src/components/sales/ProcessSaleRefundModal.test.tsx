import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ProcessSaleRefundModal } from './ProcessSaleRefundModal';
import type { Sale } from '../../types';

// A simple sale with no discount/tax/delivery so the net refund equals the gross
// returned subtotal (keeps the money assertions exact).
const baseSale: Sale = {
  id: 'sale-1',
  invoiceNo: 'INV-12345',
  customerId: 'cust-1',
  customerName: 'Test Customer',
  type: 'Retail',
  items: [
    { productId: 'prod-1', productName: 'Product A', sku: 'SKU-001', quantity: 3, returnedQuantity: 0, unitPrice: 10000, costPrice: 5000, total: 30000, isWholesale: false, useRetailPrice: false, isClearance: false },
    { productId: 'prod-2', productName: 'Product B', sku: 'SKU-002', quantity: 2, returnedQuantity: 0, unitPrice: 15000, costPrice: 8000, total: 30000, isWholesale: false, useRetailPrice: false, isClearance: false },
  ],
  subtotal: 60000,
  discount: 0,
  tax: 0,
  deliveryFee: 0,
  totalAmount: 60000,
  paidAmount: 60000,
  paymentMethod: 'Cash',
  paymentBreakdown: { Cash: 60000 },
  status: 'Completed',
  notes: '',
  refunds: [],
  totalRefunded: 0,
  createdBy: 'Staff',
  createdAt: new Date().toISOString(),
};

const settings = {
  storeName: 'Test Store', phone: '', email: '', address: '',
  currencySymbol: '₦', currencyCode: 'NGN', taxRatePct: 0, defaultMinWholesaleQty: 25,
  receiptHeader: '', receiptFooter: '', enableLoyaltyProgram: false, pointsPerDollar: 0, loyaltyPointValue: 0,
};

const customers = [
  { id: 'cust-1', name: 'Test Customer', phone: '08031234567', email: '', address: '', purchaseHistoryCount: 0, outstandingBalance: 0, overageBalance: 0, loyaltyPoints: 0, lifetimeValue: 0, createdAt: new Date().toISOString() },
];

const { mockUseApp, mockUseAuth, mockUseInteractions, mockRefundSale } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
  mockUseAuth: vi.fn(),
  mockUseInteractions: vi.fn(),
  mockRefundSale: vi.fn(),
}));

vi.mock('../../context/AppContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../context/AppContext')>();
  return { ...actual, useApp: () => mockUseApp() };
});

vi.mock('../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../context/AuthContext')>();
  return { ...actual, useAuth: () => mockUseAuth() };
});

vi.mock('../../context/InteractionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../context/InteractionContext')>();
  return { ...actual, useInteractions: () => mockUseInteractions() };
});

describe('ProcessSaleRefundModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApp.mockReturnValue({ customers, settings, refundSale: mockRefundSale });
    mockUseAuth.mockReturnValue({
      currentUser: { id: 'user-1', displayName: 'Test Staff', username: 'staff', role: 'Sales Staff', status: 'Active', createdAt: new Date().toISOString() },
      loading: false, isSuperAdmin: false, canSuperAdmin: false, ssoEmail: '', ssoUnregistered: false,
      stepUp: vi.fn().mockResolvedValue(true), isPrivacyMode: false, enablePrivacyMode: vi.fn(),
    });
    mockUseInteractions.mockReturnValue({ notify: vi.fn(), confirm: vi.fn() });
  });

  const qtyInputs = () => screen.getAllByRole('spinbutton');
  // A money amount appears in the per-line total AND the net refund card (and,
  // for the full case, the confirm button), so assert it appears at least once.
  const expectMoney = (text: string) =>
    expect(screen.getAllByText(text).length).toBeGreaterThanOrEqual(1);

  it('renders the modal header with invoice and customer', () => {
    render(<ProcessSaleRefundModal sale={baseSale} onClose={() => {}} />);
    expect(screen.getByText('Process Sale Return & Refund')).toBeInTheDocument();
    expect(screen.getByText('INV-12345')).toBeInTheDocument();
    expect(screen.getByText('Test Customer')).toBeInTheDocument();
  });

  it('defaults to partial mode with zero return quantities', () => {
    render(<ProcessSaleRefundModal sale={baseSale} onClose={() => {}} />);
    for (const input of qtyInputs()) {
      expect(input).toHaveValue(0);
    }
  });

  it('Return All sets every line to its remaining quantity and offers a full refund', () => {
    render(<ProcessSaleRefundModal sale={baseSale} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /return all remaining items/i }));

    // prod-1 has 3 remaining, prod-2 has 2 remaining.
    expect(qtyInputs()[0]).toHaveValue(3);
    expect(qtyInputs()[1]).toHaveValue(2);
    // Net refund = 3*10000 + 2*15000 = 60000 (no discount/tax/fee).
    expectMoney('₦60000.00');
    expect(screen.getByRole('button', { name: /confirm full refund/i })).toBeInTheDocument();
  });

  it('computes the net refund amount for a partial return', () => {
    render(<ProcessSaleRefundModal sale={baseSale} onClose={() => {}} />);

    fireEvent.change(qtyInputs()[0], { target: { value: '1' } });

    // 1 * 10000 = 10000, no discount/tax/fee.
    expectMoney('₦10000.00');
    expect(screen.getByRole('button', { name: /confirm partial return/i })).toBeInTheDocument();
  });

  it('shows the restock condition dropdown only once a return quantity is chosen', () => {
    render(<ProcessSaleRefundModal sale={baseSale} onClose={() => {}} />);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(qtyInputs()[0], { target: { value: '1' } });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('disables confirm while nothing is selected and enables it once a quantity is set', () => {
    render(<ProcessSaleRefundModal sale={baseSale} onClose={() => {}} />);

    const confirm = () => screen.getByRole('button', { name: /confirm (full|partial) (return|refund)/i });
    expect(confirm()).toBeDisabled();
    fireEvent.change(qtyInputs()[0], { target: { value: '1' } });
    expect(confirm()).toBeEnabled();
  });

  it('offers the delivery-fee refund only when the sale carried a delivery fee', () => {
    render(<ProcessSaleRefundModal sale={baseSale} onClose={() => {}} />);
    expect(screen.queryByText(/Delivery Fee/)).not.toBeInTheDocument();

    const withFee = { ...baseSale, deliveryFee: 1500, totalAmount: 61500 };
    render(<ProcessSaleRefundModal sale={withFee} onClose={() => {}} />);
    // (₦) + 1500.toFixed(2) = "₦1500.00".
    expect(screen.getByText('Delivery Fee (₦1500.00)')).toBeInTheDocument();
  });

  it('adds the delivery fee to the refund when the toggle is checked', () => {
    const withFee = { ...baseSale, deliveryFee: 1500, totalAmount: 61500, subtotal: 60000 };
    render(<ProcessSaleRefundModal sale={withFee} onClose={() => {}} />);

    fireEvent.change(qtyInputs()[0], { target: { value: '1' } }); // 10000
    // Without the fee: net = 10000.
    expectMoney('₦10000.00');

    fireEvent.click(screen.getByRole('checkbox', { name: /refund fee/i }));
    // With the fee: net = 10000 + 1500 = 11500.
    expectMoney('₦11500.00');
  });

  it('calls refundSale with the chosen items, settlement and restock decision', () => {
    render(<ProcessSaleRefundModal sale={baseSale} onClose={() => {}} />);

    fireEvent.change(qtyInputs()[0], { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm partial return/i }));

    expect(mockRefundSale).toHaveBeenCalledWith(
      'sale-1',
      'Customer returned item',
      'Test Staff',
      expect.objectContaining({
        itemsToReturn: [
          expect.objectContaining({ productId: 'prod-1', quantity: 1, condition: 'Restock' }),
        ],
        refundDeliveryFee: false,
        // The linked customer has no debt, so the smart default is Store Credit.
        settlementMethod: 'Store Credit',
      }),
    );
  });

  it('renders nothing when there is no sale', () => {
    const { container } = render(<ProcessSaleRefundModal sale={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
