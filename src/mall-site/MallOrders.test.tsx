import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MallOrders } from './MallOrders';
import { MallProvider } from '../context/MallContext';
import { ToastProvider } from '../context/ToastContext';
import type { MallOrderLookup } from '../types/mall';

const mockOrders: MallOrderLookup[] = [
  {
    orderNo: 'ORD-12345',
    status: 'confirmed',
    totalKobo: 175000,
    createdAt: new Date().toISOString(),
    itemCount: 3,
    paymentStatus: 'pending',
    updatedAt: new Date().toISOString(),
  },
  {
    orderNo: 'ORD-67890',
    status: 'completed',
    totalKobo: 50000,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    itemCount: 1,
    paymentStatus: 'paid',
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

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
    cart: vi.fn(() => Promise.resolve({ items: [], subtotalKobo: 0, cartId: 'cart-1' })),
    checkout: vi.fn(),
    resetSession: vi.fn(() => 'mall-test-session'),
    ordersByPhone: vi.fn(),
    getBuyerProfile: vi.fn(() => ({ phone: '08031234567', name: '', email: '', address: '', savedAt: new Date().toISOString() })),
    saveBuyerProfile: vi.fn(),
    clearBuyerProfile: vi.fn(),
    setMallStaleListener: vi.fn(),
  },
}));

vi.mock('../services/mallClient', () => ({
  mallClient: mockMallClient,
  setMallStaleListener: mockMallClient.setMallStaleListener,
  getBuyerProfile: mockMallClient.getBuyerProfile,
  saveBuyerProfile: mockMallClient.saveBuyerProfile,
  clearBuyerProfile: mockMallClient.clearBuyerProfile,
}));

// useRoute is imported transitively; give it a stable no-op navigator.
vi.mock('../hooks/useRoute', () => ({
  useNavigateMall: () => vi.fn(),
}));

const phoneInput = () => screen.getByPlaceholderText('0803…');
const orderNoInput = () => screen.getByLabelText(/order number/i);

describe('MallOrders (tracking)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMallClient.ordersByPhone.mockResolvedValue({ orders: mockOrders, total: 2 });
    mockMallClient.getBuyerProfile.mockReturnValue({ phone: '08031234567', name: '', email: '', address: '', savedAt: new Date().toISOString() });
  });

  it('renders order lookup form', () => {
    render(<MallOrders />, { wrapper: TestWrapper });

    expect(screen.getByRole('heading', { name: /track my orders/i })).toBeInTheDocument();
    expect(phoneInput()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find/i })).toBeInTheDocument();
  });

  it('pre-fills phone from the buyer profile', async () => {
    render(<MallOrders />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(phoneInput()).toHaveValue('08031234567');
    });
  });

  it('shows an error when the phone number is too short', async () => {
    render(<MallOrders />, { wrapper: TestWrapper });

    fireEvent.change(phoneInput(), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /find/i }));

    await waitFor(() => {
      expect(screen.getByText('Enter the phone number used at checkout.')).toBeInTheDocument();
    });
  });

  it('renders order list with orderNo, status, total, payment status and updated time', async () => {
    render(<MallOrders />, { wrapper: TestWrapper });

    fireEvent.change(phoneInput(), { target: { value: '08031234567' } });
    fireEvent.click(screen.getByRole('button', { name: /find/i }));

    await waitFor(() => {
      expect(screen.getByText('ORD-12345')).toBeInTheDocument();
      expect(screen.getByText('ORD-67890')).toBeInTheDocument();
      expect(screen.getByText('confirmed')).toBeInTheDocument();
      expect(screen.getByText('completed')).toBeInTheDocument();
      expect(screen.getByText('₦1,750')).toBeInTheDocument();
      expect(screen.getByText('₦500')).toBeInTheDocument();
      expect(screen.getByText('Payment: pending')).toBeInTheDocument();
      expect(screen.getByText('Payment: paid')).toBeInTheDocument();
    });
  });

  it('shows "No orders found" when the API has none', async () => {
    mockMallClient.ordersByPhone.mockResolvedValue({ orders: [], total: 0 });

    render(<MallOrders />, { wrapper: TestWrapper });

    fireEvent.change(phoneInput(), { target: { value: '08031234567' } });
    fireEvent.click(screen.getByRole('button', { name: /find/i }));

    await waitFor(() => {
      expect(screen.getByText('No orders found for that phone number yet.')).toBeInTheDocument();
    });
  });

  it('calls mallClient.ordersByPhone with the phone and order number', async () => {
    render(<MallOrders />, { wrapper: TestWrapper });

    fireEvent.change(phoneInput(), { target: { value: '08031234567' } });
    fireEvent.change(orderNoInput(), { target: { value: 'ORD-12345' } });
    fireEvent.click(screen.getByRole('button', { name: /find/i }));

    await waitFor(() => {
      expect(mockMallClient.ordersByPhone).toHaveBeenCalledWith('08031234567', 'ORD-12345');
    });
  });
});
