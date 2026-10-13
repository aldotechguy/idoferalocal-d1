import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MallCheckout } from './MallCheckout';
import type { MallCart } from '../types/mall';

const cart: MallCart = {
  items: [
    { productId: 'prod-1', name: 'Test Product', unit: 'pcs', price: 10000, qty: 1, stock: 10, image: '', available: true },
  ],
  subtotalKobo: 10000,
  cartId: 'cart-1',
};

const { mockUseMall, mockCheckout, mockGo, mockCustomerLookup } = vi.hoisted(() => ({
  mockUseMall: vi.fn(),
  mockCheckout: vi.fn(),
  mockGo: vi.fn(),
  mockCustomerLookup: vi.fn(() => Promise.resolve({ known: false })),
}));

vi.mock('../services/mallClient', () => ({
  mallClient: { customerLookup: mockCustomerLookup },
  getBuyerProfile: () => ({ phone: '', name: '', email: '', address: '', savedAt: new Date().toISOString() }),
  saveBuyerProfile: vi.fn(),
  setMallStaleListener: vi.fn(),
}));

vi.mock('../context/MallContext', () => ({
  useMall: () => mockUseMall(),
}));

vi.mock('../hooks/useRoute', () => ({
  useNavigateMall: () => mockGo,
}));

// Real <label htmlFor> via FormField, so getByLabelText works for the fields.
const phoneInput = () => screen.getByLabelText(/phone number/i);
const nameInput = () => screen.getByLabelText(/full name/i);
const emailInput = () => screen.getByLabelText(/email/i);
const placeOrder = () => screen.getByRole('button', { name: /place order/i });
// Submit the buyer form directly so we exercise the submit() validation logic and
// not jsdom's HTML5 constraint validation (which would block a type=email submit).
const submitForm = () => {
  const form = placeOrder().closest('form');
  if (!form) throw new Error('checkout form not found');
  fireEvent.submit(form);
};
const selectZone = (id: string) => {
  const radio = screen.getByRole('radio', { name: new RegExp(id.replace('_', ' '), 'i') });
  fireEvent.click(radio);
};

describe('MallCheckout (buyer form validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMall.mockReturnValue({ cart, checkout: mockCheckout });
    mockCheckout.mockResolvedValue(true);
  });

  it('blocks submit and flags the name and phone when the form is empty', () => {
    render(<MallCheckout />);
    submitForm();

    // validateBuyer returns the name message first; both name and phone fields
    // are flagged. The phone string appears in both the field error and the alert.
    expect(screen.getByText('Please enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Please enter your full name.')).toBeInTheDocument();
    expect(screen.getAllByText('Enter a valid phone number.').length).toBeGreaterThanOrEqual(1);
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it('flags a too-short phone number', () => {
    render(<MallCheckout />);
    fireEvent.change(nameInput(), { target: { value: 'Ada' } });
    fireEvent.change(phoneInput(), { target: { value: '123' } });
    submitForm();

    expect(screen.getAllByText('Enter a valid phone number.').length).toBeGreaterThanOrEqual(1);
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it('flags an invalid email when one is present', async () => {
    render(<MallCheckout />);
    fireEvent.change(nameInput(), { target: { value: 'Ada' } });
    fireEvent.change(phoneInput(), { target: { value: '08031234567' } });
    fireEvent.change(emailInput(), { target: { value: 'not-an-email' } });
    submitForm();

    expect((await screen.findAllByText('Enter a valid email address.')).length).toBeGreaterThanOrEqual(1);
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it('requires a delivery address once a non-pickup zone is selected', () => {
    render(<MallCheckout />);
    fireEvent.change(nameInput(), { target: { value: 'Ada' } });
    fireEvent.change(phoneInput(), { target: { value: '08031234567' } });
    selectZone('uyo_central');
    submitForm();

    expect(screen.getByText('Enter a delivery address.')).toBeInTheDocument();
    expect(screen.getByText('Enter the delivery address for this zone.')).toBeInTheDocument();
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it('calls checkout and navigates on a valid pickup order', async () => {
    render(<MallCheckout />);
    fireEvent.change(nameInput(), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(phoneInput(), { target: { value: '08031234567' } });
    fireEvent.change(emailInput(), { target: { value: 'ada@example.com' } });
    submitForm();

    await waitFor(() => {
      expect(mockCheckout).toHaveBeenCalledWith({
        customerName: 'Ada Lovelace',
        customerPhone: '08031234567',
        customerEmail: 'ada@example.com',
        deliveryAddress: '',
        deliveryZone: 'pickup',
        paymentMethod: 'pay_on_pickup',
      });
      expect(mockGo).toHaveBeenCalledWith('/order-success');
    });
    expect(screen.queryByText('Enter a valid phone number.')).not.toBeInTheDocument();
  });

  it('calls checkout with the selected delivery zone', async () => {
    render(<MallCheckout />);
    fireEvent.change(nameInput(), { target: { value: 'Ada' } });
    fireEvent.change(phoneInput(), { target: { value: '08031234567' } });
    selectZone('uyo_central');
    fireEvent.change(screen.getByLabelText(/delivery address/i), { target: { value: '12 Test Road, Uyo' } });
    submitForm();

    await waitFor(() => {
      expect(mockCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryZone: 'uyo_central', deliveryAddress: '12 Test Road, Uyo' }),
      );
    });
  });

  it('disables Place Order when there are no items', () => {
    mockUseMall.mockReturnValue({ cart: { items: [], subtotalKobo: 0, cartId: 'c' }, checkout: mockCheckout });
    render(<MallCheckout />);
    expect(placeOrder()).toBeDisabled();
  });
});
