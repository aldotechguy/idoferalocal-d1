import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MallCartDrawer } from './MallCartDrawer';
import { MallProvider } from '../../context/MallContext';
import { ToastProvider } from '../../context/ToastContext';
import type { MallCart } from '../../types/mall';

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
  ],
  subtotalKobo: 20000,
  cartId: 'cart-1',
};

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <MallProvider>{children}</MallProvider>
    </ToastProvider>
  );
}

const { mockMallClient } = vi.hoisted(() => ({
  mockMallClient: {
    ensureSession: vi.fn(() => 'mall-test-session'),
    products: vi.fn(() => Promise.resolve({ products: [], categories: [], total: 0, limit: 24, offset: 0 })),
    cart: vi.fn(),
    setCartQty: vi.fn(),
    addToCart: vi.fn(),
    checkout: vi.fn(),
    resetSession: vi.fn(() => 'mall-test-session'),
    setMallStaleListener: vi.fn(),
  },
}));

vi.mock('../../services/mallClient', () => ({
  mallClient: mockMallClient,
  setMallStaleListener: mockMallClient.setMallStaleListener,
}));

describe('MallCartDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMallClient.cart.mockResolvedValue(mockCart);
    mockMallClient.setCartQty.mockResolvedValue(mockCart);
  });

  it('renders nothing when open is false', () => {
    render(<MallCartDrawer open={false} onClose={() => {}} />, { wrapper: TestWrapper });
    expect(screen.queryByText('Your Cart')).not.toBeInTheDocument();
  });

  it('renders cart items and subtotal when open', async () => {
    render(<MallCartDrawer open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('Your Cart')).toBeInTheDocument();
      expect(screen.getByText('Test Product 1')).toBeInTheDocument();
      expect(screen.getByText('Subtotal')).toBeInTheDocument();
      // The drawer's local toNaira drops trailing zeros: 20000 kobo -> "₦200".
      // "₦200" also appears as the line total for the single 2x item.
      expect(screen.getAllByText('₦200').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows the empty-cart message when there are no items', async () => {
    mockMallClient.cart.mockResolvedValue({ items: [], subtotalKobo: 0, cartId: 'cart-1' });

    render(<MallCartDrawer open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
    });
  });

  it('updates the quantity through the row control', async () => {
    render(<MallCartDrawer open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    // Clicking "+" commits value+1 (2 -> 3) directly, without blur timing.
    const increase = await screen.findByRole('button', { name: 'Increase test product 1 quantity' });
    fireEvent.click(increase);

    await waitFor(() => {
      expect(mockMallClient.setCartQty).toHaveBeenCalledWith('prod-1', 3);
    });
  });

  it('removes the item through the row remove button', async () => {
    mockMallClient.setCartQty.mockResolvedValue({ items: [], subtotalKobo: 0, cartId: 'cart-1' });

    render(<MallCartDrawer open={true} onClose={() => {}} />, { wrapper: TestWrapper });

    const removeButton = await screen.findByRole('button', { name: 'Remove item' });
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(mockMallClient.setCartQty).toHaveBeenCalledWith('prod-1', 0);
    });
  });

  it('closes the drawer when "Continue Shopping" is clicked', async () => {
    const onClose = vi.fn();
    render(<MallCartDrawer open={true} onClose={onClose} />, { wrapper: TestWrapper });

    const continueButton = await screen.findByRole('button', { name: /continue shopping/i });
    fireEvent.click(continueButton);

    expect(onClose).toHaveBeenCalled();
  });
});
