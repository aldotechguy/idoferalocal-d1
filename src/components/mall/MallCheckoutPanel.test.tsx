import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MallCheckoutPanel } from './MallCheckoutPanel';
import { MallProvider } from '../../context/MallContext';
import { ToastProvider } from '../../context/ToastContext';
import type { MallCart, MallOrder } from '../../types/mall';

const mockCart: MallCart = {
  items: [
    {
      productId: 'prod-1',
      name: 'Test Product 1',
      unit: 'pcs',
      price: 10000,
      qty: 2,
      stock: 10,
      image: 'https://example.com/img1.jpg',
      available: true,
    },
    {
      productId: 'prod-2',
      name: 'Test Product 2',
      unit: 'pcs',
      price: 5000,
      qty: 1,
      stock: 5,
      image: 'https://example.com/img2.jpg',
      available: true,
    },
  ],
  subtotalKobo: 25000,
  cartId: 'cart-1',
};

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
  customerName: 'Walk-in customer',
  createdAt: new Date().toISOString(),
};

// vi.hoisted runs before the (hoisted) vi.mock factories, so the hoisted object
// can be referenced inside the factory. This breaks the circular import between
// MallContext -> mallClient and the test, which is why the mock object must be
// created via vi.hoisted rather than a plain const.
const { mockMallClient } = vi.hoisted(() => ({
  mockMallClient: {
    ensureSession: vi.fn(() => 'mall-test-session'),
    products: vi.fn(),
    cart: vi.fn(),
    checkout: vi.fn(),
    resetSession: vi.fn(),
    setMallStaleListener: vi.fn(),
  },
}));

vi.mock('../../services/mallClient', () => ({
  mallClient: mockMallClient,
  setMallStaleListener: mockMallClient.setMallStaleListener,
}));

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <MallProvider>{children}</MallProvider>
    </ToastProvider>
  );
}

// The delivery-zone <select> is the only combobox on the checkout panel; its
// surrounding <label> is not associated via htmlFor, so it has no accessible
// name. Query it by role.
const zoneSelect = () => screen.getByRole('combobox');
// The customer name filed/label is likewise unassociated; use its placeholder.
const nameInput = () => screen.getByPlaceholderText('Walk-in customer');
const addressInput = () => screen.getByPlaceholderText('Enter full delivery address');

describe('MallCheckoutPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMallClient.ensureSession.mockReturnValue('mall-test-session');
    mockMallClient.products.mockResolvedValue({ products: [], categories: [], total: 0, limit: 24, offset: 0 });
    mockMallClient.cart.mockResolvedValue(mockCart);
    mockMallClient.checkout.mockResolvedValue(mockOrder);
    mockMallClient.resetSession.mockReturnValue('mall-test-session');
  });

  it('renders nothing when open is false', () => {
    render(<MallCheckoutPanel open={false} onClose={() => {}} />, { wrapper: TestWrapper });
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
    expect(screen.queryByText('Order Complete')).not.toBeInTheDocument();
  });

  it('renders cart items after async load via MallProvider', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('2× Test Product 1')).toBeInTheDocument();
      expect(screen.getByText('1× Test Product 2')).toBeInTheDocument();
    });
  });

  it('calculates subtotal correctly (₦250)', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      // For pickup, both Subtotal and Total render ₦250 (delivery fee is 0).
      expect(screen.getAllByText('₦250').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Subtotal')).toBeInTheDocument();
    });
  });

  it('shows delivery fee ₦0 and total ₦250 for pickup zone (default)', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('Delivery')).toBeInTheDocument();
      // toNaira drops trailing zeros: 0 kobo -> "₦0", 25000 kobo -> "₦250".
      expect(screen.getByText('₦0')).toBeInTheDocument();
      expect(screen.getByText('Total')).toBeInTheDocument();
    });
  });

  it('shows delivery fee ₦1,500 and total ₦1,750 for uyo_central zone', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('2× Test Product 1')).toBeInTheDocument();
    });

    fireEvent.change(zoneSelect(), { target: { value: 'uyo_central' } });

    await waitFor(() => {
      expect(screen.getByText('₦1,500')).toBeInTheDocument();
      expect(screen.getByText('₦1,750')).toBeInTheDocument();
    });
  });

  it('shows "Staff quote" for other zone and hides the Total row', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('2× Test Product 1')).toBeInTheDocument();
    });

    fireEvent.change(zoneSelect(), { target: { value: 'other' } });

    await waitFor(() => {
      // The Delivery row shows "Staff quote"; the Total row is not rendered for
      // a null-fee (staff-quote) zone.
      expect(screen.getAllByText('Staff quote').length).toBeGreaterThan(0);
      expect(screen.queryByText('Total')).not.toBeInTheDocument();
    });
  });

  it('disables submit when a non-pickup zone is selected but no address is entered', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('2× Test Product 1')).toBeInTheDocument();
    });

    fireEvent.change(zoneSelect(), { target: { value: 'uyo_central' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /place order/i })).toBeDisabled();
    });
  });

  it('enables submit when pickup zone is selected (no address required)', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled();
    });
  });

  it('enables submit when a non-pickup zone is selected and an address is entered', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('2× Test Product 1')).toBeInTheDocument();
    });

    fireEvent.change(zoneSelect(), { target: { value: 'uyo_central' } });
    fireEvent.change(addressInput(), { target: { value: '123 Test Street, Uyo' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled();
    });
  });

  it('shows receipt with orderNo, status and total after a successful checkout', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('2× Test Product 1')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /place order/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Order Complete')).toBeInTheDocument();
      expect(screen.getAllByText('ORD-12345').length).toBeGreaterThan(0);
      expect(screen.getByText('confirmed')).toBeInTheDocument();
      expect(screen.getByText('₦1,750')).toBeInTheDocument();
    });
  });

  it('calls mallClient.checkout with the resolved body', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('2× Test Product 1')).toBeInTheDocument();
    });

    fireEvent.change(zoneSelect(), { target: { value: 'uyo_outer' } });
    fireEvent.change(addressInput(), { target: { value: '55 Uyo Road' } });
    fireEvent.change(nameInput(), { target: { value: 'Ada Lovelace' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /place order/i }));
    });

    await waitFor(() => {
      expect(mockMallClient.checkout).toHaveBeenCalledWith({
        customerName: 'Ada Lovelace',
        deliveryZone: 'uyo_outer',
        deliveryAddress: '55 Uyo Road',
      });
    });
  });

  it('defaults the customer name to Walk-in customer when left empty', async () => {
    render(<MallCheckoutPanel open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('2× Test Product 1')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /place order/i }));
    });

    await waitFor(() => {
      expect(mockMallClient.checkout).toHaveBeenCalledWith(
        expect.objectContaining({ customerName: 'Walk-in customer', deliveryZone: 'pickup', deliveryAddress: '' })
      );
    });
  });
});
