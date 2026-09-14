import React, { useState, useMemo } from 'react';
import {
  Users,
  Plus,
  Phone,
  Mail,
  Award,
  Search,
  Check,
  X,
  Trash2,
  Edit,
  CreditCard,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  ShoppingBag,
  AlertCircle,
} from 'lucide-react';
import { NairaSign } from '../common/NairaSign';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Customer } from '../../types';
import { ConfirmModal } from '../common/ConfirmModal';

export const CustomersView: React.FC = () => {
  const { customers, sales, addCustomer, updateCustomer, updateCustomerBalance, deleteCustomer, settings } = useApp();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'Administrator';
  const isSalesStaff = currentUser?.role === 'Sales Staff';

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [settleCustomer, setSettleCustomer] = useState<Customer | null>(null);
  const [settleAmount, setSettleAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash');
  const [paymentNote, setPaymentNote] = useState<string>('');

  const [formData, setFormData] = useState({ name: '', phone: '', email: '', address: '' });

  // Augment customer records with real-time sales log calculations for complete accuracy
  const augmentedCustomers = useMemo(() => {
    return customers.map((cust) => {
      if (!cust) return cust;
      const custSales = sales.filter(
        (s) =>
          s &&
          s.status !== 'Refunded' &&
          ((s.customerId && s.customerId === cust.id) ||
            (s.customerName && cust.name && s.customerName.trim().toLowerCase() === cust.name.trim().toLowerCase()))
      );

      const calculatedOrders = custSales.length;
      const purchaseHistoryCount = Math.max(Number(cust.purchaseHistoryCount) || 0, calculatedOrders);

      const calculatedLTV = custSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
      const lifetimeValue = Math.max(Number(cust.lifetimeValue) || 0, calculatedLTV);

      const calculatedPoints = Math.floor(lifetimeValue * (settings.pointsPerDollar || 0.01));
      const loyaltyPoints = Math.max(Number(cust.loyaltyPoints) || 0, calculatedPoints);

      const calculatedUnpaid = custSales.reduce(
        (acc, s) => acc + Math.max(0, (Number(s.totalAmount) || 0) - (Number(s.paidAmount !== undefined ? s.paidAmount : s.totalAmount) || 0)),
        0
      );

      const rawBalance = Number(cust.outstandingBalance);
      const outstandingBalance = isNaN(rawBalance)
        ? calculatedUnpaid
        : rawBalance;

      return {
        ...cust,
        purchaseHistoryCount,
        lifetimeValue,
        loyaltyPoints,
        outstandingBalance,
      };
    }).filter(Boolean);
  }, [customers, sales, settings.pointsPerDollar]);

  // Aggregate KPI summary metrics
  const totalCustomerCount = customers.length;
  const totalCustomerRevenue = augmentedCustomers.reduce((sum, c) => sum + (c.lifetimeValue || 0), 0);
  const totalOutstandingDebt = augmentedCustomers.reduce((sum, c) => sum + (c.outstandingBalance || 0), 0);
  const debtorCount = augmentedCustomers.filter((c) => (c.outstandingBalance || 0) > 0).length;
  const totalCustomerOrders = augmentedCustomers.reduce((sum, c) => sum + (c.purchaseHistoryCount || 0), 0);
  const totalLoyaltyPoints = augmentedCustomers.reduce((sum, c) => sum + (c.loyaltyPoints || 0), 0);

  const filteredCustomers = augmentedCustomers.filter((c) => {
    if (!c) return false;
    const q = (searchQuery || '').toLowerCase();
    return (
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(searchQuery)) ||
      (c.email && c.email.toLowerCase().includes(q))
    );
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;
    addCustomer(formData);
    setShowAddModal(false);
    setFormData({ name: '', phone: '', email: '', address: '' });
  };

  const handleOpenEdit = (cust: Customer) => {
    setEditingCustomer(cust);
    setFormData({
      name: cust.name || '',
      phone: cust.phone || '',
      email: cust.email || '',
      address: cust.address || '',
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || !formData.name) return;
    updateCustomer(editingCustomer.id, {
      name: formData.name,
      phone: formData.phone,
      email: formData.email,
      address: formData.address,
    });
    setEditingCustomer(null);
    setFormData({ name: '', phone: '', email: '', address: '' });
  };

  const handleOpenSettle = (cust: Customer) => {
    setSettleCustomer(cust);
    const bal = Number(cust.outstandingBalance) || 0;
    setSettleAmount(bal.toFixed(2));
    setPaymentMethod('Cash');
    setPaymentNote('');
  };

  const handleSettleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleCustomer) return;
    const payVal = parseFloat(settleAmount);
    if (isNaN(payVal) || payVal <= 0) return;

    updateCustomerBalance(settleCustomer.id, -payVal, {
      paymentMethod: paymentMethod as any,
      paymentNote: paymentNote.trim() || undefined,
      performedBy: currentUser?.displayName || currentUser?.username || 'Admin',
    });
    setSettleCustomer(null);
    setSettleAmount('');
    setPaymentNote('');
  };

  const handleClearEntireDebt = () => {
    if (!settleCustomer) return;
    const bal = Number(settleCustomer.outstandingBalance) || 0;
    if (bal <= 0) return;
    updateCustomerBalance(settleCustomer.id, -bal, {
      paymentMethod: paymentMethod as any,
      paymentNote: paymentNote.trim() || undefined,
      performedBy: currentUser?.displayName || currentUser?.username || 'Admin',
    });
    setSettleCustomer(null);
    setPaymentNote('');
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Customer Directory & Loyalty
          </h1>
          <p className="text-xs text-slate-500">
            Track customer purchase history, outstanding balance statements, and loyalty rewards.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Customer</span>
        </button>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Customers */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
              Customer Directory
            </span>
            <p className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {totalCustomerCount.toLocaleString()}
            </p>
            <span className="text-[11px] text-slate-500 font-medium">
              {filteredCustomers.length === totalCustomerCount
                ? 'Total Registered Customers'
                : `Showing ${filteredCustomers.length} of ${totalCustomerCount}`}
            </span>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 rounded-2xl">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Total Revenue Generated by Customers */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
              Total Revenue Generated
            </span>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
              {settings.currencySymbol}{totalCustomerRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <span className="text-[11px] text-slate-500 font-medium">
              Lifetime sales across customers
            </span>
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 rounded-2xl">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>

        {/* Total Outstanding Balance */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
              Outstanding Balance
            </span>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400 tracking-tight">
              {settings.currencySymbol}{totalOutstandingDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <span className="text-[11px] text-slate-500 font-medium">
              {debtorCount} customer{debtorCount === 1 ? '' : 's'} with unpaid debt
            </span>
          </div>
          <div className="p-3 bg-rose-50 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 rounded-2xl">
            <CreditCard className="w-6 h-6" />
          </div>
        </div>

        {/* Total Orders & Loyalty Points */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
              Total Orders & Loyalty
            </span>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
              {totalCustomerOrders.toLocaleString()} <span className="text-xs font-bold text-slate-400 uppercase">Orders</span>
            </p>
            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
              <Award className="w-3.5 h-3.5" />
              <span>{totalLoyaltyPoints.toLocaleString()} Loyalty Points Issued</span>
            </span>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 rounded-2xl">
            <ShoppingBag className="w-6 h-6" />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div className="relative w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search customer by name, phone, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-9 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 text-slate-900 dark:text-slate-100 text-xs rounded-xl focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4">Customer Name</th>
                <th className="py-3 px-3">Contact Details</th>
                <th className="py-3 px-3">Orders Count</th>
                <th className="py-3 px-3">Loyalty Points</th>
                <th className="py-3 px-3">Lifetime Value</th>
                <th className="py-3 px-3">Outstanding Balance</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="max-w-xs mx-auto space-y-2">
                      <Users className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700" />
                      <p className="font-extrabold text-slate-700 dark:text-slate-300 text-sm">No customers found</p>
                      <p className="text-xs text-slate-500">
                        {searchQuery ? 'No customer matching your search criteria.' : 'Click "Add New Customer" to register your first customer.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((cust) => (
                  <tr key={cust.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                      {cust.name}
                    </td>
                    <td className="py-3 px-3">
                      <p className="flex items-center gap-1 text-[11px]"><Phone className="w-3 h-3 text-slate-400" /> {cust.phone || 'N/A'}</p>
                      <p className="flex items-center gap-1 text-[10px] text-slate-400"><Mail className="w-3 h-3 text-slate-400" /> {cust.email || 'N/A'}</p>
                    </td>
                    <td className="py-3 px-3 font-bold">{(cust.purchaseHistoryCount || 0).toLocaleString()} orders</td>
                    <td className="py-3 px-3 font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Award className="w-3.5 h-3.5" />
                      <span>{(cust.loyaltyPoints || 0).toLocaleString()} pts</span>
                    </td>
                    <td className="py-3 px-3 font-bold text-emerald-600 dark:text-emerald-400">
                      {settings.currencySymbol}{(cust.lifetimeValue || 0).toFixed(2)}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`font-bold ${(cust.outstandingBalance || 0) > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                        {settings.currencySymbol}{(cust.outstandingBalance || 0).toFixed(2)}
                      </span>
                    </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {cust.outstandingBalance > 0 && (
                        <button
                          onClick={() => handleOpenSettle(cust)}
                          className="px-2.5 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 text-[10px] font-bold rounded-lg hover:bg-emerald-200 transition-colors flex items-center gap-1"
                        >
                          <NairaSign className="w-3 h-3" />
                          <span>Settle Balance</span>
                        </button>
                      )}
                      {!isSalesStaff && (
                        <>
                          <button
                            onClick={() => handleOpenEdit(cust)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Edit Customer Details"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setCustomerToDelete(cust)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Delete Customer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Add New Customer</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAddSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">Customer Full Name *</label>
                <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
              <div>
                <label className="block font-bold mb-1">Phone Number</label>
                <input type="text" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
              <div>
                <label className="block font-bold mb-1">Email Address</label>
                <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
              <div>
                <label className="block font-bold mb-1">Street Address</label>
                <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 font-semibold">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white font-bold rounded-xl">Save Customer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Edit Customer Profile</h3>
                <p className="text-[11px] text-slate-500">ID: {editingCustomer.id}</p>
              </div>
              <button onClick={() => setEditingCustomer(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">Customer Full Name *</label>
                <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium" />
              </div>
              <div>
                <label className="block font-bold mb-1">Phone Number</label>
                <input type="text" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium" />
              </div>
              <div>
                <label className="block font-bold mb-1">Email Address</label>
                <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium" />
              </div>
              <div>
                <label className="block font-bold mb-1">Street Address</label>
                <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingCustomer(null)} className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-400">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs transition-colors">Update Customer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settle Debt Modal */}
      {settleCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 rounded-2xl">
                  <NairaSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Settle Customer Debt</h3>
                  <p className="text-[11px] text-slate-500 font-medium">Record payment & clear account balance</p>
                </div>
              </div>
              <button
                onClick={() => setSettleCustomer(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customer Debt Card */}
            <div className="p-4 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-900/40 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold text-rose-500 uppercase tracking-wider block">Customer</span>
                <p className="font-black text-slate-900 dark:text-white text-sm">{settleCustomer.name}</p>
                <p className="text-[11px] text-slate-500 font-medium">{settleCustomer.phone || settleCustomer.email || 'No contact info'}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-extrabold text-rose-500 uppercase tracking-wider block">Outstanding Debt</span>
                <p className="font-black text-rose-600 dark:text-rose-400 text-lg">
                  {settings.currencySymbol}{(Number(settleCustomer.outstandingBalance) || 0).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Quick Clear Debt Banner */}
            <button
              type="button"
              onClick={handleClearEntireDebt}
              className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs transition-all flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Clear Entire Debt ({settings.currencySymbol}{(Number(settleCustomer.outstandingBalance) || 0).toFixed(2)})</span>
            </button>

            <div className="relative flex items-center my-1">
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
              <span className="flex-shrink mx-2 text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">or enter partial amount</span>
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
            </div>

            <form onSubmit={handleSettleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Amount ({settings.currencySymbol}) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-extrabold text-slate-400 text-sm">
                    {settings.currencySymbol}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={settleAmount}
                    onChange={(e) => setSettleAmount(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 rounded-xl text-slate-900 dark:text-white font-black text-base"
                    placeholder="0.00"
                  />
                </div>

                {/* Preset amount chips */}
                <div className="flex items-center gap-1.5 mt-2">
                  <button
                    type="button"
                    onClick={() => setSettleAmount((Number(settleCustomer.outstandingBalance) || 0).toFixed(2))}
                    className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-700 dark:text-slate-300"
                  >
                    100% Full ({settings.currencySymbol}{(Number(settleCustomer.outstandingBalance) || 0).toFixed(2)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettleAmount(((Number(settleCustomer.outstandingBalance) || 0) / 2).toFixed(2))}
                    className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-700 dark:text-slate-300"
                  >
                    50% Half ({settings.currencySymbol}{((Number(settleCustomer.outstandingBalance) || 0) / 2).toFixed(2)})
                  </button>
                </div>
              </div>

              {/* Balance preview card */}
              {settleAmount && !isNaN(parseFloat(settleAmount)) && (
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">New Remaining Balance:</span>
                  <span className={`font-black text-sm ${
                    (Number(settleCustomer.outstandingBalance) || 0) - parseFloat(settleAmount) <= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}>
                    {settings.currencySymbol}{Math.max(0, (Number(settleCustomer.outstandingBalance) || 0) - parseFloat(settleAmount)).toFixed(2)}
                  </span>
                </div>
              )}

              {/* Payment Method */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Method
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {['Cash', 'Card', 'Bank Transfer', 'Mobile'].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`py-1.5 px-1 rounded-xl text-[10px] font-bold border transition-all text-center ${
                        paymentMethod === method
                          ? 'bg-blue-50 dark:bg-blue-950 border-blue-500 text-blue-600 dark:text-blue-400 shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800 border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              {/* Optional Reference / Note */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Reference / Note (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., Transfer ID or Cash receipt"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  className="w-full p-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSettleCustomer(null)}
                  className="px-4 py-2 font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!settleAmount || isNaN(parseFloat(settleAmount)) || parseFloat(settleAmount) <= 0}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Record Payment ({settings.currencySymbol}{parseFloat(settleAmount || '0').toFixed(2)})</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Customer Confirmation Modal */}
      <ConfirmModal
        isOpen={!!customerToDelete}
        title="Delete Customer"
        message={`Are you sure you want to delete customer "${customerToDelete?.name}"? Their purchase history records will remain in sales logs.`}
        confirmText="Delete Customer"
        variant="danger"
        onClose={() => setCustomerToDelete(null)}
        onConfirm={() => {
          if (customerToDelete) {
            deleteCustomer(customerToDelete.id);
            setCustomerToDelete(null);
          }
        }}
      />
    </div>
  );
};
