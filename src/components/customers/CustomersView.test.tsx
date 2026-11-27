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
  tags: i === 1 ? ['VIP'] : ['Retail'],
});

describe('CustomersView UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApp.mockReturnValue({
      customers: [makeCustomer(1), makeCustomer(2)],
      sales: [],
      moneyMovements: [],
      auditLogs: [],
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
      auditLogs: [],
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

  it('filters customers by tag and supports bulk tagging', () => {
    const updateCustomer = vi.fn();
    mockUseApp.mockReturnValue({
      customers: [makeCustomer(1), makeCustomer(2)],
      sales: [],
      moneyMovements: [],
      auditLogs: [],
      addCustomer: vi.fn(),
      updateCustomer,
      updateCustomerBalance: vi.fn(),
      deleteCustomer: vi.fn(),
      settings: { currencySymbol: '₦', pointsPerDollar: 1 },
    });

    render(<CustomersView />);

    fireEvent.change(screen.getByLabelText('Filter by tag'), { target: { value: 'VIP' } });
    expect(screen.getByText('Customer 1')).toBeInTheDocument();
    expect(screen.queryByText('Customer 2')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by tag'), { target: { value: 'ALL' } });
    fireEvent.click(screen.getByLabelText('Select Customer 2'));
    fireEvent.change(screen.getByPlaceholderText('Bulk tag (e.g. VIP)...'), { target: { value: 'Wholesale' } });
    fireEvent.click(screen.getByText('Apply Tag'));

    expect(updateCustomer).toHaveBeenCalledWith('c-2', { tags: ['Retail', 'Wholesale'] });
  });

  it('grants Customer Support role read & write CRM access without delete/export', () => {
    mockUseAuth.mockReturnValue({
      currentUser: { role: 'Customer Support', displayName: 'Support Agent' },
      isPrivacyMode: false,
    });

    render(<CustomersView />);
    expect(screen.getByText('Add New Customer')).toBeInTheDocument();
    expect(screen.getAllByTitle('Edit Customer Details').length).toBeGreaterThan(0);
    expect(screen.queryByTitle('Delete Customer')).not.toBeInTheDocument();
    expect(screen.queryByText('Export CSV')).not.toBeInTheDocument();
  });

  it('supports expanded payment methods and transaction reference in Settle Balance modal', () => {
    const updateCustomerBalance = vi.fn();
    mockUseApp.mockReturnValue({
      customers: [makeCustomer(1)],
      sales: [],
      moneyMovements: [],
      auditLogs: [],
      addCustomer: vi.fn(),
      updateCustomer: vi.fn(),
      updateCustomerBalance,
      deleteCustomer: vi.fn(),
      settings: { currencySymbol: '₦', pointsPerDollar: 1 },
    });

    render(<CustomersView />);
    fireEvent.click(screen.getByText('Settle Balance'));
    fireEvent.change(screen.getByLabelText('Payment Method'), { target: { value: 'Mobile Transfer' } });
    fireEvent.change(screen.getByPlaceholderText('e.g., TRX-849201'), { target: { value: 'TRX-999' } });
    fireEvent.click(screen.getByText(/Record Payment/));

    expect(updateCustomerBalance).toHaveBeenCalledWith(
      'c-1',
      -500,
      expect.objectContaining({
        paymentMethod: 'Mobile Transfer',
        paymentNote: 'Ref: TRX-999',
      })
    );
  });

  it('renders Support Dashboard tab and logs a support ticket to customer record', () => {
    const updateCustomer = vi.fn();
    mockUseApp.mockReturnValue({
      customers: [makeCustomer(1)],
      sales: [],
      moneyMovements: [],
      auditLogs: [],
      addCustomer: vi.fn(),
      updateCustomer,
      updateCustomerBalance: vi.fn(),
      deleteCustomer: vi.fn(),
      settings: { currencySymbol: '₦', pointsPerDollar: 1 },
    });

    render(<CustomersView />);
    fireEvent.click(screen.getByText('Support Dashboard'));
    fireEvent.change(screen.getByLabelText('Select customer for ticket'), { target: { value: 'c-1' } });
    fireEvent.change(screen.getByPlaceholderText('Ticket subject...'), { target: { value: 'Missing item in order' } });
    fireEvent.click(screen.getByText('Create Ticket'));

    expect(updateCustomer).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({
        supportTickets: expect.arrayContaining([
          expect.objectContaining({ subject: 'Missing item in order', status: 'Open' }),
        ]),
      })
    );
  });
});
