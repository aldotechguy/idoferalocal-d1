import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Papa from 'papaparse';
import { CustomersView } from './CustomersView';

const mockUseApp = vi.fn();
const mockUseAuth = vi.fn();
const mockShowToast = vi.fn();

vi.mock('../../context/AppContext', () => ({
  useApp: () => mockUseApp(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../common/NairaSign', () => ({
  NairaSign: () => <span>₦</span>,
}));

vi.mock('../common/ConfirmModal', () => ({
  ConfirmModal: () => null,
}));

vi.mock('./CustomerDetailView', () => ({
  CustomerDetailView: () => null,
}));

vi.mock('react-window', () => ({
  List: ({ rowComponent: RowComponent, rowCount, rowProps, ...rest }: any) => (
    <div data-testid="virtual-customer-list" {...rest}>
      {Array.from({ length: Math.min(rowCount, 20) }).map((_, index) => (
        <RowComponent
          key={index}
          index={index}
          style={{}}
          ariaAttributes={{ 'aria-posinset': index + 1, 'aria-setsize': rowCount, role: 'listitem' }}
          {...rowProps}
        />
      ))}
    </div>
  ),
}));

const makeCustomer = (i: number) => ({
  id: `c-${i}`,
  name: `Customer ${i}`,
  phone: `0800000${String(i).padStart(4, '0')}`,
  email: `customer${i}@example.com`,
  address: `Address ${i}`,
  outstandingBalance: i === 1 ? 500 : 0,
  overageBalance: 0,
  loyaltyPoints: i * 10,
  lifetimeValue: i * 100,
  purchaseHistoryCount: i,
});

describe('CustomersView UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApp.mockReturnValue({
      customers: [makeCustomer(1), makeCustomer(2)],
      sales: [],
      moneyMovements: [],
      addCustomer: vi.fn(),
      updateCustomer: vi.fn(),
      updateCustomerBalance: vi.fn(),
      deleteCustomer: vi.fn(),
      settings: { currencySymbol: '₦', pointsPerDollar: 1 },
    });
    mockUseAuth.mockReturnValue({
      currentUser: { role: 'Administrator', displayName: 'Admin' },
      isPrivacyMode: false,
    });
  });

  it('shows Export CSV button only for admin users', () => {
    const { rerender } = render(<CustomersView />);
    expect(screen.getByText('Export CSV')).toBeInTheDocument();

    mockUseAuth.mockReturnValue({
      currentUser: { role: 'Sales Staff', displayName: 'Cashier' },
      isPrivacyMode: false,
    });
    rerender(<CustomersView />);
    expect(screen.queryByText('Export CSV')).not.toBeInTheDocument();
  });

  it('exports filtered customers as CSV when Export CSV is clicked', () => {
    const unparseSpy = vi.spyOn(Papa, 'unparse').mockReturnValue('id,name\nc-1,Customer 1');
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<CustomersView />);
    fireEvent.click(screen.getByText('Export CSV'));

    expect(unparseSpy).toHaveBeenCalledTimes(1);
    expect(unparseSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'c-1',
          name: 'Customer 1',
          email: 'customer1@example.com',
        }),
      ])
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    clickSpy.mockRestore();
    unparseSpy.mockRestore();
  });

  it('paginates at 100 rows and renders virtualized list when > 100 customers', () => {
    const manyCustomers = Array.from({ length: 150 }, (_, i) => makeCustomer(i + 1));
    mockUseApp.mockReturnValue({
      customers: manyCustomers,
      sales: [],
      moneyMovements: [],
      addCustomer: vi.fn(),
      updateCustomer: vi.fn(),
      updateCustomerBalance: vi.fn(),
      deleteCustomer: vi.fn(),
      settings: { currencySymbol: '₦', pointsPerDollar: 1 },
    });

    render(<CustomersView />);

    expect(screen.getByTestId('virtual-customer-list')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Customer 1')).toBeInTheDocument();
    expect(screen.queryByText('Customer 101')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Next'));

    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Customer 101')).toBeInTheDocument();
    expect(screen.queryByText('Customer 1')).not.toBeInTheDocument();
  }, 15000);
});
