import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MoneyMovementView } from './MoneyMovementView';
import type { MoneyMovement, TreasuryBalances } from '../../types';

const settings = {
  storeName: 'Test Store', phone: '', email: '', address: '',
  currencySymbol: '₦', currencyCode: 'NGN', taxRatePct: 0, defaultMinWholesaleQty: 25,
  receiptHeader: '', receiptFooter: '', enableLoyaltyProgram: false, pointsPerDollar: 0, loyaltyPointValue: 0,
};

const treasuryBalances: TreasuryBalances = {
  bizAccountBalance: 150000,
  physicalCashBalance: 50000,
  totalLiquidCash: 200000,
  totalOwnerDrawings: 25000,
  totalOwnerLoans: 10000,
};

const movements: MoneyMovement[] = [
  { id: 'mm-1', date: new Date().toISOString(), type: 'Sale Inflow', destinationAccount: 'Biz Account', amount: 75000, notes: 'Sale INV-12345', referenceNo: 'INV-12345', performedBy: 'Staff', createdAt: new Date().toISOString() },
  { id: 'mm-2', date: new Date().toISOString(), type: 'Expense Outflow', sourceAccount: 'Physical Cash', amount: 25000, notes: 'Shop rent', referenceNo: 'EXP-001', performedBy: 'Accountant', createdAt: new Date().toISOString() },
  { id: 'mm-3', date: new Date().toISOString(), type: 'Internal Transfer', sourceAccount: 'Biz Account', destinationAccount: 'Physical Cash', amount: 20000, notes: 'Till withdrawal', subtype: 'Bank to Till', performedBy: 'Manager', createdAt: new Date().toISOString() },
];

const { mockUseApp, mockUseAuth, mockUseToast, mockDelete, mockPurge } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
  mockUseAuth: vi.fn(),
  mockUseToast: vi.fn(),
  mockDelete: vi.fn(),
  mockPurge: vi.fn(() => ({ purgedCount: 0 })),
}));

vi.mock('../../context/AppContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../context/AppContext')>();
  return { ...actual, useApp: () => mockUseApp() };
});

vi.mock('../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../context/AuthContext')>();
  return { ...actual, useAuth: () => mockUseAuth() };
});

vi.mock('../../context/ToastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../context/ToastContext')>();
  return { ...actual, useToast: () => mockUseToast() };
});

// Isolate the view from its modal sub-components.
vi.mock('./TransferModal', () => ({ TransferModal: () => <div data-testid="transfer-modal" /> }));
vi.mock('./OwnerWithdrawalModal', () => ({ OwnerWithdrawalModal: () => <div data-testid="owner-modal" /> }));
vi.mock('./RecalibrateModal', () => ({ RecalibrateModal: () => <div data-testid="recalibrate-modal" /> }));
vi.mock('../common/ConfirmModal', () => ({ ConfirmModal: () => <div data-testid="confirm-modal" /> }));

describe('MoneyMovementView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApp.mockReturnValue({
      treasuryBalances, moneyMovements: movements, deleteMoneyMovement: mockDelete,
      purgeHistoricalMoneyMovements: mockPurge, settings,
    });
    mockUseAuth.mockReturnValue({
      currentUser: { id: 'u', displayName: 'Mgr', username: 'mgr', role: 'Store Manager', status: 'Active', createdAt: new Date().toISOString() },
      isSuperAdmin: false, isPrivacyMode: false,
    });
    mockUseToast.mockReturnValue({ showToast: vi.fn() });
  });

  it('renders the three liquidity balance cards from treasuryBalances', () => {
    render(<MoneyMovementView />);
    expect(screen.getByText('Total Business Liquid Cash')).toBeInTheDocument();
    expect(screen.getByText('₦200,000.00')).toBeInTheDocument();
    expect(screen.getByText('1. Biz Bank Account')).toBeInTheDocument();
    expect(screen.getByText('₦150,000.00')).toBeInTheDocument();
    expect(screen.getByText('2. Physical Cash (Till)')).toBeInTheDocument();
    expect(screen.getByText('₦50,000.00')).toBeInTheDocument();
  });

  it('renders the owner drawings and loans ledger', () => {
    render(<MoneyMovementView />);
    expect(screen.getByText('Business Owner Funds & Loans Ledger')).toBeInTheDocument();
    expect(screen.getByText('Total Owner Drawings:')).toBeInTheDocument();
    expect(screen.getByText('Active Owner Loans:')).toBeInTheDocument();
    // Drawings/loans use toLocaleString() without decimal places.
    expect(screen.getByText('₦25,000')).toBeInTheDocument();
    expect(screen.getByText('₦10,000')).toBeInTheDocument();
  });

  it('renders the audit ledger with each movement type badge', () => {
    render(<MoneyMovementView />);
    expect(screen.getByText('Money Movement Audit Ledger')).toBeInTheDocument();
    expect(screen.getByText('3 Records')).toBeInTheDocument();
    expect(screen.getByText('Sale Inflow')).toBeInTheDocument();
    expect(screen.getByText('Expense Outflow')).toBeInTheDocument();
    expect(screen.getByText('Internal Transfer')).toBeInTheDocument();
  });

  it('signs inflow and outflow amounts and leaves transfer amounts unsigned', () => {
    render(<MoneyMovementView />);
    expect(screen.getByText('+₦75,000.00')).toBeInTheDocument();
    expect(screen.getByText('-₦25,000.00')).toBeInTheDocument();
    expect(screen.getByText('₦20,000.00')).toBeInTheDocument();
  });

  it('marks external inflows and outflows explicitly', () => {
    render(<MoneyMovementView />);
    // Sale Inflow has no source (external); Expense Outflow has no destination.
    expect(screen.getByText('— External Inflow —')).toBeInTheDocument();
    expect(screen.getByText('— External Outflow —')).toBeInTheDocument();
  });

  it('filters by account so the matching movements remain', () => {
    render(<MoneyMovementView />);
    fireEvent.click(screen.getByRole('button', { name: 'Physical Cash' }));
    // Expense Outflow (from cash) and the Cash transfer remain; Sale Inflow goes to Biz only.
    expect(screen.getByText('Expense Outflow')).toBeInTheDocument();
    expect(screen.getByText('Internal Transfer')).toBeInTheDocument();
    expect(screen.queryByText('Sale Inflow')).not.toBeInTheDocument();
  });

  it('filters by transaction type', () => {
    render(<MoneyMovementView />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Sale Inflow' } });
    expect(screen.getByText('Sale Inflow')).toBeInTheDocument();
    expect(screen.queryByText('Expense Outflow')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal Transfer')).not.toBeInTheDocument();
  });

  it('searches by reference number', () => {
    render(<MoneyMovementView />);
    fireEvent.change(screen.getByPlaceholderText(/search reference/i), { target: { value: 'INV-12345' } });
    expect(screen.getByText('Sale Inflow')).toBeInTheDocument();
    expect(screen.queryByText('Expense Outflow')).not.toBeInTheDocument();
  });

  it('shows the empty state when no movement matches the filters', () => {
    render(<MoneyMovementView />);
    fireEvent.change(screen.getByPlaceholderText(/search reference/i), { target: { value: 'no-such-ref' } });
    expect(screen.getByText('No Money Movements Recorded')).toBeInTheDocument();
  });

  it('resets the filters back to every movement', () => {
    render(<MoneyMovementView />);
    const search = screen.getByPlaceholderText(/search reference/i);
    fireEvent.change(search, { target: { value: 'INV-12345' } });
    fireEvent.click(screen.getByTitle('Reset filters'));
    expect(search).toHaveValue('');
    expect(screen.getByText('Expense Outflow')).toBeInTheDocument();
  });

  it('shows the treasury management actions for a manager', () => {
    render(<MoneyMovementView />);
    expect(screen.getByRole('button', { name: /calibrate balances/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /purge past records/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /transfer funds/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /owner withdrawal/i })).toBeInTheDocument();
  });

  it('opens the delete confirmation for a movement (mocked modal)', () => {
    render(<MoneyMovementView />);
    const deleteButtons = screen.getAllByTitle('Delete this movement log');
    expect(deleteButtons).toHaveLength(3);
    fireEvent.click(deleteButtons[0]);
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
  });

  it('hides delete controls when there are no movements', () => {
    mockUseApp.mockReturnValue({
      treasuryBalances, moneyMovements: [], deleteMoneyMovement: mockDelete,
      purgeHistoricalMoneyMovements: mockPurge, settings,
    });
    render(<MoneyMovementView />);
    expect(screen.getByText('No Money Movements Recorded')).toBeInTheDocument();
    expect(screen.queryByTitle('Delete this movement log')).not.toBeInTheDocument();
  });
});
