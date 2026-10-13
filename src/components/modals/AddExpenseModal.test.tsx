import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AddExpenseModal } from './AddExpenseModal';

const settings = {
  storeName: 'Test Store', phone: '', email: '', address: '',
  currencySymbol: '₦', currencyCode: 'NGN', taxRatePct: 0, defaultMinWholesaleQty: 25,
  receiptHeader: '', receiptFooter: '', enableLoyaltyProgram: false, pointsPerDollar: 0, loyaltyPointValue: 0,
};

const { mockUseApp, mockAddExpense } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
  mockAddExpense: vi.fn(),
}));

vi.mock('../../context/AppContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../context/AppContext')>();
  return { ...actual, useApp: () => mockUseApp() };
});

describe('AddExpenseModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddExpense.mockReturnValue('exp-1');
    mockUseApp.mockReturnValue({ addExpense: mockAddExpense, settings, expenses: [] });
  });

  // The modal's labels are unassociated siblings (no htmlFor/id), so fields are
  // located by placeholder and role rather than getByLabelText.
  const titleInput = () => screen.getByPlaceholderText(/Shop Rent/i);
  const amountInput = () => screen.getByRole('spinbutton'); // the single number input
  const selects = () => screen.getAllByRole('combobox'); // [category, paymentMethod]

  it('renders nothing when not open', () => {
    const { container } = render(<AddExpenseModal isOpen={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the expense form when open', () => {
    render(<AddExpenseModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Record New Expense')).toBeInTheDocument();
    expect(titleInput()).toBeInTheDocument();
    expect(amountInput()).toBeInTheDocument();
    // Two selects: category and payment method.
    expect(selects()).toHaveLength(2);
  });

  it('offers the fixed category options', () => {
    render(<AddExpenseModal isOpen={true} onClose={() => {}} />);
    const category = selects()[0] as HTMLSelectElement;
    expect(category).toHaveValue('Rent');
    const labels = Array.from(category.options).map((o) => o.value);
    expect(labels).toEqual(expect.arrayContaining(['Rent', 'Electricity', 'Packaging', 'Logistics', 'Salaries', 'Marketing', 'Lunch', 'Maintenance', 'Other']));
  });

  it('offers the payment-method options', () => {
    render(<AddExpenseModal isOpen={true} onClose={() => {}} />);
    const payment = selects()[1] as HTMLSelectElement;
    expect(payment).toHaveValue('Bank Transfer');
    const labels = Array.from(payment.options).map((o) => o.value);
    expect(labels).toEqual(expect.arrayContaining(['Bank Transfer', 'Cash', 'Card', 'Mobile Transfer']));
  });

  it('calls addExpense with the submitted form data (money-movement side effect)', async () => {
    render(<AddExpenseModal isOpen={true} onClose={() => {}} />);

    fireEvent.change(titleInput(), { target: { value: 'Shop Rent' } });
    fireEvent.change(amountInput(), { target: { value: '50000' } });
    fireEvent.change(selects()[0], { target: { value: 'Rent' } });
    fireEvent.change(selects()[1], { target: { value: 'Bank Transfer' } });

    fireEvent.click(screen.getByRole('button', { name: /save expense/i }));

    await waitFor(() => {
      expect(mockAddExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Shop Rent',
          amount: 50000,
          category: 'Rent',
          paymentMethod: 'Bank Transfer',
        }),
      );
    });
  });

  it('does not call addExpense when the title is empty', async () => {
    render(<AddExpenseModal isOpen={true} onClose={() => {}} />);

    fireEvent.change(amountInput(), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: /save expense/i }));

    await waitFor(() => {
      expect(mockAddExpense).not.toHaveBeenCalled();
    });
  });

  it('does not call addExpense when the amount is zero or negative', async () => {
    render(<AddExpenseModal isOpen={true} onClose={() => {}} />);

    fireEvent.change(titleInput(), { target: { value: 'Refund' } });
    fireEvent.change(amountInput(), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /save expense/i }));

    await waitFor(() => {
      expect(mockAddExpense).not.toHaveBeenCalled();
    });
  });

  it('closes the modal when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<AddExpenseModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
