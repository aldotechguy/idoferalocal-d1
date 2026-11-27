import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { CustomerDetailView } from './CustomerDetailView';

vi.mock('../common/ReceiptModal', () => ({
  ReceiptModal: ({ sale, onClose }: any) =>
    sale ? (
      <div data-testid="receipt-modal">
        <span>Invoice Modal: {sale.invoiceNo || sale.id}</span>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

const baseCustomer = {
  id: 'cust-1',
  name: 'Ada Lovelace',
  phone: '08012345678',
  email: 'ada@example.com',
  address: '10 Marina Road',
  tags: ['VIP'],
  notes: 'Prefers morning delivery',
  purchaseHistoryCount: 1,
  outstandingBalance: 0,
  overageBalance: 0,
  loyaltyPoints: 50,
  lifetimeValue: 5000,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const baseSettings = {
  storeName: 'Idofera',
  phone: '0800',
  email: 'store@example.com',
  address: 'Uyo',
  currencySymbol: '₦',
  currencyCode: 'NGN',
  taxRate: 0,
  pointsPerDollar: 0.01,
  lowStockThreshold: 5,
  receiptFooter: '',
};

describe('CustomerDetailView Sprint 3 (Tags & Activity Log)', () => {
  it('allows adding and removing CRM tags', () => {
    const onSaveTags = vi.fn();
    render(
      <CustomerDetailView
        customer={baseCustomer}
        sales={[]}
        moneyMovements={[]}
        auditLogs={[]}
        settings={baseSettings as any}
        isPrivacyMode={false}
        isSalesStaff={false}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSettleDebt={vi.fn()}
        onSaveNotes={vi.fn()}
        onSaveTags={onSaveTags}
      />
    );

    fireEvent.click(screen.getByText('+ Wholesale'));
    expect(onSaveTags).toHaveBeenCalledWith('cust-1', ['VIP', 'Wholesale']);

    fireEvent.click(screen.getByTitle('Remove tag VIP'));
    expect(onSaveTags).toHaveBeenCalledWith('cust-1', []);
  });

  it('displays customer-specific audit logs in the Activity Log tab', () => {
    const logs = [
      {
        id: 'log-1',
        action: 'UPDATE_CUSTOMER',
        entity: 'Customer',
        entityId: 'cust-1',
        performedBy: 'Admin',
        details: 'Updated customer "Ada Lovelace": tags [VIP].',
        createdAt: '2026-02-01T10:00:00.000Z',
      },
      {
        id: 'log-2',
        action: 'UPDATE_CUSTOMER',
        entity: 'Customer',
        entityId: 'cust-other',
        performedBy: 'Admin',
        details: 'Unrelated customer log',
        createdAt: '2026-02-01T10:00:00.000Z',
      },
    ];

    render(
      <CustomerDetailView
        customer={baseCustomer}
        sales={[]}
        moneyMovements={[]}
        auditLogs={logs}
        settings={baseSettings as any}
        isPrivacyMode={false}
        isSalesStaff={false}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSettleDebt={vi.fn()}
        onSaveNotes={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Activity Log'));
    expect(screen.getByText('Updated customer "Ada Lovelace": tags [VIP].')).toBeInTheDocument();
    expect(screen.queryByText('Unrelated customer log')).not.toBeInTheDocument();
  });

  it('opens ReceiptModal when clicking an invoice number in Purchase History', () => {
    const sampleSale = {
      id: 'sale-1',
      invoiceNo: 'INV-1001',
      customerId: 'cust-1',
      customerName: 'Ada Lovelace',
      type: 'Retail',
      items: [],
      subtotal: 5000,
      discount: 0,
      tax: 0,
      totalAmount: 5000,
      paidAmount: 5000,
      paymentMethod: 'Cash',
      status: 'Completed',
      createdAt: '2026-02-01T10:00:00.000Z',
    };

    render(
      <CustomerDetailView
        customer={baseCustomer}
        sales={[sampleSale as any]}
        moneyMovements={[]}
        auditLogs={[]}
        settings={baseSettings as any}
        isPrivacyMode={false}
        isSalesStaff={false}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSettleDebt={vi.fn()}
        onSaveNotes={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Purchase History'));
    fireEvent.click(screen.getByText('INV-1001'));
    expect(screen.getByTestId('receipt-modal')).toBeInTheDocument();
    expect(screen.getByText('Invoice Modal: INV-1001')).toBeInTheDocument();
  });
});
