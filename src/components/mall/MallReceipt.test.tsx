import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MallReceipt } from './MallReceipt';
import type { MallOrder } from '../../types/mall';

const mockOrder: MallOrder = {
  orderNo: 'ORD-12345',
  status: 'confirmed',
  items: [
    { productId: 'prod-1', name: 'Test Product 1', unit: 'pcs', price: 10000, qty: 2 },
    { productId: 'prod-2', name: 'Test Product 2', unit: 'pcs', price: 5000, qty: 1 },
  ],
  subtotalKobo: 25000,
  deliveryFeeKobo: 150000,
  totalKobo: 175000,
  deliveryZone: 'uyo_central',
  deliveryLabel: 'Uyo central',
  customerName: 'Test Customer',
  createdAt: new Date().toISOString(),
};

const mockOrderWithQuote: MallOrder = {
  ...mockOrder,
  quoteRequired: true,
  deliveryFeeKobo: 0,
  totalKobo: undefined,
  paidKobo: 100000,
};

describe('MallReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders order number and status', () => {
    render(<MallReceipt order={mockOrder} onClose={() => {}} />);

    expect(screen.getByText('Order Placed')).toBeInTheDocument();
    // The order number appears in the green banner and the "Order" row.
    expect(screen.getAllByText('ORD-12345').length).toBeGreaterThan(0);
    expect(screen.getByText('confirmed')).toBeInTheDocument();
  });

  it('renders delivery fee and total for non-quote orders', () => {
    render(<MallReceipt order={mockOrder} onClose={() => {}} />);

    // toNaira drops trailing zeros: 150000 -> ₦1,500, 175000 -> ₦1,750.
    expect(screen.getByText('₦1,500')).toBeInTheDocument();
    expect(screen.getByText('₦1,750')).toBeInTheDocument();
  });

  it('renders "Staff quote pending" for quote-required orders and hides Total', () => {
    render(<MallReceipt order={mockOrderWithQuote} onClose={() => {}} />);

    expect(screen.getByText('Staff quote pending')).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });

  it('renders customer name when present', () => {
    render(<MallReceipt order={mockOrder} onClose={() => {}} />);

    expect(screen.getByText('Test Customer')).toBeInTheDocument();
  });

  it('renders paid amount when present', () => {
    render(<MallReceipt order={mockOrderWithQuote} onClose={() => {}} />);

    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('₦1,000')).toBeInTheDocument();
  });

  it('renders item list with quantities and line totals', () => {
    render(<MallReceipt order={mockOrder} onClose={() => {}} />);

    expect(screen.getByText('2× Test Product 1')).toBeInTheDocument();
    expect(screen.getByText('1× Test Product 2')).toBeInTheDocument();
    // Line totals: 2×10000 -> ₦200, 1×5000 -> ₦50.
    expect(screen.getByText('₦200')).toBeInTheDocument();
    expect(screen.getByText('₦50')).toBeInTheDocument();
  });

  it('calls window.print when print button clicked', async () => {
    render(<MallReceipt order={mockOrder} onClose={() => {}} />);

    const printButton = screen.getByRole('button', { name: /print/i });
    fireEvent.click(printButton);

    await waitFor(() => {
      expect(window.print).toHaveBeenCalled();
    });
  });

  it('calls onClose when done button clicked', () => {
    const onClose = vi.fn();
    render(<MallReceipt order={mockOrder} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('shows subtotal correctly (₦250)', () => {
    render(<MallReceipt order={mockOrder} onClose={() => {}} />);

    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('₦250')).toBeInTheDocument();
  });

  it('shows the item count row and the item list header', () => {
    render(<MallReceipt order={mockOrder} onClose={() => {}} />);

    // "Items" appears in the summary row and as the item-list header.
    expect(screen.getAllByText('Items').length).toBeGreaterThanOrEqual(1);
  });
});
