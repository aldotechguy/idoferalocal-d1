import React, { useState } from 'react';
import {
  Building,
  Plus,
  Phone,
  Mail,
  FileText,
  Search,
  X,
  Trash2,
  Edit,
  CreditCard,
  Package,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowUpRight,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Supplier, PurchaseOrder } from '../../types';
import { ConfirmModal } from '../common/ConfirmModal';
import { NairaSign } from '../common/NairaSign';
import { POPaymentModal } from '../purchases/POPaymentModal';

export const SuppliersView: React.FC = () => {
  const { suppliers, purchases, addSupplier, updateSupplier, deleteSupplier, settings } = useApp();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'Administrator';
  const isSalesStaff = currentUser?.role === 'Sales Staff';

  const [searchQuery, setSearchQuery] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'with_debt' | 'settled'>('all');
  const [expandedSupplierId, setExpandedSupplierId] = useState<string | null>(null);
  const [selectedPoForPayment, setSelectedPoForPayment] = useState<PurchaseOrder | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    address: '',
    paymentTerms: 'Net 30',
    openingBalance: '',
  });

  // Calculate summary metrics across all suppliers
  const totalSuppliersCount = suppliers.length;
  const totalAccountsPayable = suppliers.reduce((sum, s) => sum + (Number(s.outstandingBalance) || 0), 0);
  const suppliersWithDebtCount = suppliers.filter((s) => (Number(s.outstandingBalance) || 0) > 0).length;
  const totalProductsLinked = suppliers.reduce((sum, s) => sum + (Number(s.productsCount) || 0), 0);

  // Helper to fetch unpaid/active POs for a specific supplier
  const getSupplierUnpaidPOs = (sup: Supplier): PurchaseOrder[] => {
    return purchases.filter(
      (p) =>
        (p.supplierId === sup.id ||
          (p.supplierName && sup.name && p.supplierName.trim().toLowerCase() === sup.name.trim().toLowerCase())) &&
        !p.isDraft &&
        p.deliveryStatus !== 'Cancelled' &&
        Math.max(0, (Number(p.totalAmount) || 0) - (Number(p.paidAmount) || 0)) > 0
    );
  };

  const filteredSuppliers = suppliers.filter((s) => {
    if (!s) return false;
    const q = (searchQuery || '').toLowerCase();
    const matchesQuery =
      (s.name || '').toLowerCase().includes(q) ||
      (s.contactPerson || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.phone || '').includes(searchQuery);

    if (!matchesQuery) return false;

    const bal = Number(s.outstandingBalance) || 0;
    if (balanceFilter === 'with_debt') return bal > 0;
    if (balanceFilter === 'settled') return bal === 0;
    return true;
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSalesStaff) return;
    if (!formData.name.trim()) return;

    addSupplier({
      name: formData.name.trim(),
      contactPerson: formData.contactPerson.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      address: formData.address.trim(),
      paymentTerms: formData.paymentTerms,
      outstandingBalance: formData.openingBalance ? Math.max(0, parseFloat(formData.openingBalance) || 0) : 0,
    });

    setShowAddModal(false);
    setFormData({ name: '', contactPerson: '', email: '', phone: '', address: '', paymentTerms: 'Net 30', openingBalance: '' });
  };

  const handleOpenEdit = (sup: Supplier) => {
    setEditingSupplier(sup);
    setFormData({
      name: sup.name || '',
      contactPerson: sup.contactPerson || '',
      email: sup.email || '',
      phone: sup.phone || '',
      address: sup.address || '',
      paymentTerms: sup.paymentTerms || 'Net 30',
      openingBalance: '',
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier || !formData.name.trim()) return;
    updateSupplier(editingSupplier.id, {
      name: formData.name.trim(),
      contactPerson: formData.contactPerson.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      address: formData.address.trim(),
      paymentTerms: formData.paymentTerms,
    });
    setEditingSupplier(null);
    setFormData({ name: '', contactPerson: '', email: '', phone: '', address: '', paymentTerms: 'Net 30', openingBalance: '' });
  };

  return (
    <div className="space-y-6 pb-12 text-slate-900 dark:text-white">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Building className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <span>Supplier Management & Accounts Payable</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Vendor profiles, credit terms, catalog associations, and outstanding accounts payable balances.
          </p>
        </div>

        {!isSalesStaff && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs transition-all hover:scale-[1.02] shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Supplier</span>
          </button>
        )}
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Total Suppliers */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
              Registered Vendors
            </span>
            <p className="text-2xl font-black tracking-tight">
              {totalSuppliersCount}
            </p>
            <span className="text-[11px] text-slate-500 font-medium">
              Active vendor accounts
            </span>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 rounded-2xl">
            <Building className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 2: Total Accounts Payable */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
              Total Accounts Payable
            </span>
            <p className={`text-2xl font-black tracking-tight ${totalAccountsPayable > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {settings.currencySymbol}{totalAccountsPayable.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <span className="text-[11px] text-slate-500 font-medium">
              {suppliersWithDebtCount > 0 ? `Owed across ${suppliersWithDebtCount} supplier${suppliersWithDebtCount === 1 ? '' : 's'}` : 'All supplier orders settled'}
            </span>
          </div>
          <div className={`p-3 rounded-2xl ${totalAccountsPayable > 0 ? 'bg-rose-50 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400' : 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400'}`}>
            <NairaSign className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 3: Suppliers with Pending Balances */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
              Vendors with Payables
            </span>
            <p className="text-2xl font-black tracking-tight">
              {suppliersWithDebtCount}
            </p>
            <span className="text-[11px] text-slate-500 font-medium">
              {totalSuppliersCount > 0 ? `${((suppliersWithDebtCount / totalSuppliersCount) * 100).toFixed(0)}% of total vendors` : '0% of vendors'}
            </span>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 rounded-2xl">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 4: Catalog Products Sourced */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
              Sourced Products
            </span>
            <p className="text-2xl font-black tracking-tight">
              {totalProductsLinked}
            </p>
            <span className="text-[11px] text-slate-500 font-medium">
              Items mapped to suppliers
            </span>
          </div>
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 rounded-2xl">
            <Package className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search vendor, contact, or email..."
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

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            <button
              onClick={() => setBalanceFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
                balanceFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              All Vendors ({totalSuppliersCount})
            </button>
            <button
              onClick={() => setBalanceFilter('with_debt')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
                balanceFilter === 'with_debt'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>With Payable Debt ({suppliersWithDebtCount})</span>
            </button>
            <button
              onClick={() => setBalanceFilter('settled')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
                balanceFilter === 'settled'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Settled / Zero Debt ({totalSuppliersCount - suppliersWithDebtCount})
            </button>
          </div>
        </div>
      </div>

      {/* Suppliers Grid */}
      {filteredSuppliers.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 p-12 rounded-3xl border border-slate-200/80 dark:border-slate-800 text-center space-y-3">
          <Building className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto" />
          <h3 className="font-extrabold text-base">No Suppliers Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery || balanceFilter !== 'all'
              ? 'No suppliers match your current filter parameters.'
              : 'Register your first vendor to begin tracking purchase orders and payable balances.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSuppliers.map((sup) => {
            const unpaidPOs = getSupplierUnpaidPOs(sup);
            const isExpanded = expandedSupplierId === sup.id;
            const hasDebt = (sup.outstandingBalance || 0) > 0;

            return (
              <div
                key={sup.id}
                className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-3"
              >
                <div className="space-y-3">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-900 dark:text-white leading-snug">
                        {sup.name}
                      </h3>
                      {sup.contactPerson && (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Contact: <span className="font-semibold text-slate-700 dark:text-slate-300">{sup.contactPerson}</span>
                        </p>
                      )}
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 font-bold text-[10px] whitespace-nowrap border border-blue-100/50 dark:border-blue-900/30">
                      {sup.paymentTerms}
                    </span>
                  </div>

                  {/* Contact Info */}
                  <div className="space-y-1 text-xs text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {sup.phone && (
                      <p className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{sup.phone}</span>
                      </p>
                    )}
                    {sup.email && (
                      <p className="flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{sup.email}</span>
                      </p>
                    )}
                    <p className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-1">
                      <Package className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span>{sup.productsCount || 0} catalog product{sup.productsCount === 1 ? '' : 's'} linked</span>
                    </p>
                  </div>

                  {/* Payable Balance Row */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-slate-400 block">Payable Balance</span>
                      <span
                        className={`text-base font-black ${
                          hasDebt ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {settings.currencySymbol}
                        {(sup.outstandingBalance || 0).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>

                    {/* Status Badge */}
                    {hasDebt ? (
                      <span className="px-2 py-1 bg-rose-50 dark:bg-rose-950/70 border border-rose-200/50 dark:border-rose-900/30 text-rose-600 dark:text-rose-400 text-[10px] font-extrabold rounded-lg flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        <span>{unpaidPOs.length} Unpaid PO{unpaidPOs.length === 1 ? '' : 's'}</span>
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/50 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-extrabold rounded-lg flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Settled</span>
                      </span>
                    )}
                  </div>

                  {/* Expand Unpaid PO Breakdown */}
                  {unpaidPOs.length > 0 && (
                    <div className="pt-1">
                      <button
                        onClick={() => setExpandedSupplierId(isExpanded ? null : sup.id)}
                        className="w-full flex items-center justify-between py-1.5 px-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-500" />
                          <span>{isExpanded ? 'Hide' : 'View'} Unpaid POs ({unpaidPOs.length})</span>
                        </span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 space-y-2 max-h-48 overflow-y-auto pr-1">
                          {unpaidPOs.map((po) => {
                            const poUnpaid = Math.max(0, (po.totalAmount || 0) - (po.paidAmount || 0));
                            return (
                              <div
                                key={po.id}
                                className="p-2.5 rounded-xl bg-slate-100/70 dark:bg-slate-800/90 border border-slate-200/60 dark:border-slate-700/60 text-xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-extrabold text-blue-600 dark:text-blue-400 text-[11px]">
                                    #{po.poNumber}
                                  </span>
                                  <span className="px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 text-[9px] font-bold rounded">
                                    {po.paymentStatus}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span>Total: {settings.currencySymbol}{po.totalAmount.toLocaleString()}</span>
                                  <span className="font-bold text-rose-600 dark:text-rose-400">
                                    Due: {settings.currencySymbol}{poUnpaid.toLocaleString()}
                                  </span>
                                </div>
                                {!isSalesStaff && (
                                  <button
                                    onClick={() => setSelectedPoForPayment(po)}
                                    className="w-full mt-1 py-1 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded-lg shadow-xs flex items-center justify-center gap-1 transition-colors"
                                  >
                                    <CreditCard className="w-3 h-3" />
                                    <span>Pay #{po.poNumber}</span>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                {!isSalesStaff && (
                  <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => handleOpenEdit(sup)}
                      className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title="Edit Supplier Profile"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setSupplierToDelete(sup)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title="Delete Supplier Profile"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add New Supplier Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Add New Supplier</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">Company / Supplier Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Metro Pack Supplies"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Contact Person</label>
                <input
                  type="text"
                  placeholder="e.g. John Okon"
                  value={formData.contactPerson}
                  onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="sales@vendor.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Phone</label>
                  <input
                    type="text"
                    placeholder="+234 800 000 0000"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold mb-1">Address</label>
                <input
                  type="text"
                  placeholder="Warehouse / physical address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold mb-1">Payment Terms</label>
                  <select
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                  >
                    <option value="Net 15">Net 15</option>
                    <option value="Net 30">Net 30</option>
                    <option value="Net 60">Net 60</option>
                    <option value="Due on Receipt">Due on Receipt</option>
                    <option value="Advance Payment">Advance Payment</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">
                    Opening Debt ({settings.currencySymbol})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={formData.openingBalance}
                    onChange={(e) => setFormData({ ...formData, openingBalance: e.target.value })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 font-semibold text-slate-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl"
                >
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Supplier Modal */}
      {editingSupplier && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Edit Supplier Details</h3>
                <p className="text-[11px] text-slate-500">Supplier ID: {editingSupplier.id}</p>
              </div>
              <button onClick={() => setEditingSupplier(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">Company / Supplier Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Contact Person</label>
                <input
                  type="text"
                  value={formData.contactPerson}
                  onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Phone</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Payment Terms</label>
                <select
                  value={formData.paymentTerms}
                  onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium"
                >
                  <option value="Net 15">Net 15</option>
                  <option value="Net 30">Net 30</option>
                  <option value="Net 60">Net 60</option>
                  <option value="Due on Receipt">Due on Receipt</option>
                  <option value="Advance Payment">Advance Payment</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingSupplier(null)}
                  className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs transition-colors"
                >
                  Update Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO Payment Modal Triggered Directly from Supplier Unpaid Orders */}
      {selectedPoForPayment && (
        <POPaymentModal
          isOpen={!!selectedPoForPayment}
          onClose={() => setSelectedPoForPayment(null)}
          po={selectedPoForPayment}
          currentUserName={currentUser?.displayName || 'Administrator'}
        />
      )}

      {/* Delete Supplier Confirmation Modal */}
      <ConfirmModal
        isOpen={!!supplierToDelete}
        title="Delete Supplier"
        message={`Are you sure you want to delete supplier "${supplierToDelete?.name}"? Linked product purchase records will remain intact.`}
        confirmText="Delete Supplier"
        variant="danger"
        onClose={() => setSupplierToDelete(null)}
        onConfirm={() => {
          if (supplierToDelete) {
            deleteSupplier(supplierToDelete.id);
            setSupplierToDelete(null);
          }
        }}
      />
    </div>
  );
};

