import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Award,
  ShoppingBag,
  CreditCard,
  TrendingUp,
  Edit,
  Trash2,
  FileText,
  Save,
  CheckCircle2,
  Receipt,
  Wallet,
} from 'lucide-react';
import { Customer, MoneyMovement, Sale, StoreSettings } from '../../types';
import { NairaSign } from '../common/NairaSign';
import { loyaltyPointsForAmount, round2, unpaidOf } from '../../shared/customerLedger';

export type CustomerDetailTab = 'overview' | 'purchases' | 'payments' | 'loyalty';

interface CustomerDetailViewProps {
  customer: Customer;
  sales: Sale[];
  moneyMovements: MoneyMovement[];
  settings: StoreSettings;
  isPrivacyMode: boolean;
  isSalesStaff: boolean;
  onBack: () => void;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
  onSettleDebt: (customer: Customer) => void;
  onSaveNotes: (customerId: string, notes: string) => void;
}

export const CustomerDetailView: React.FC<CustomerDetailViewProps> = ({
  customer,
  sales,
  moneyMovements,
  settings,
  isPrivacyMode,
  isSalesStaff,
  onBack,
  onEdit,
  onDelete,
  onSettleDebt,
  onSaveNotes,
}) => {
  const [activeTab, setActiveTab] = useState<CustomerDetailTab>('overview');
  const [notesDraft, setNotesDraft] = useState<string>(customer.notes || '');
  const [notesSaved, setNotesSaved] = useState(false);

  useEffect(() => {
    setNotesDraft(customer.notes || '');
    setNotesSaved(false);
  }, [customer.id, customer.notes]);

  const customerSales = useMemo(() => {
    const custNameLower = (customer.name || '').trim().toLowerCase();
    return [...sales]
      .filter((s) => {
        if (!s) return false;
        if (s.customerId) return s.customerId === customer.id;
        return !!custNameLower && !!s.customerName && s.customerName.trim().toLowerCase() === custNameLower;
      })
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [sales, customer.id, customer.name]);

  const customerPayments = useMemo(() => {
    return [...moneyMovements]
      .filter((m) => m && m.type === 'Customer Debt Payment' && m.referenceId === customer.id)
      .sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')));
  }, [moneyMovements, customer.id]);

  const unpaidSales = useMemo(() => {
    return customerSales.filter((s) => s.status !== 'Refunded' && unpaidOf(s) > 0);
  }, [customerSales]);

  const activeSales = useMemo(
    () => customerSales.filter((s) => s.status !== 'Refunded'),
    [customerSales]
  );

  const avgOrderValue = useMemo(() => {
    if (activeSales.length === 0) return 0;
    const total = activeSales.reduce((sum, s) => sum + (Number(s.totalAmount) || 0), 0);
    return round2(total / activeSales.length);
  }, [activeSales]);

  const lastPurchaseDate = customerSales[0]?.createdAt;
  const initials = (customer.name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const handleSaveNotes = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveNotes(customer.id, notesDraft.trim());
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2500);
  };

  const formatMoney = (val: number) =>
    isPrivacyMode
      ? '••••••'
      : `${settings.currencySymbol}${(Number(val) || 0).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

  const formatDate = (iso?: string) => {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const notesDirty = notesDraft.trim() !== (customer.notes || '').trim();

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      {/* Hub Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <button
              type="button"
              onClick={onBack}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors shrink-0"
              title="Back to Customer Directory"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
              {initials || <User className="w-5 h-5" />}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight truncate">
                  {customer.name}
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  Customer Profile
                </span>
                {(customer.outstandingBalance || 0) > 0 && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300">
                    Unpaid Balance
                  </span>
                )}
                {(customer.overageBalance || 0) > 0 && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                    Store Credit
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {isPrivacyMode ? '••••••' : customer.phone || 'No phone'}
                </span>
                <span className="flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {isPrivacyMode ? '••••••' : customer.email || 'No email'}
                </span>
                {customer.address && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {isPrivacyMode ? '••••••' : customer.address}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(customer.outstandingBalance || 0) > 0 && (
              <button
                type="button"
                onClick={() => onSettleDebt(customer)}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors flex items-center gap-1.5"
              >
                <NairaSign className="w-3.5 h-3.5" />
                <span>Settle Balance</span>
              </button>
            )}
            {!isSalesStaff && (
              <>
                <button
                  type="button"
                  onClick={() => onEdit(customer)}
                  className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5"
                >
                  <Edit className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(customer)}
                  className="px-3 py-2 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5"
                  title="Delete Customer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Profile & Notes</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('purchases')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'purchases'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Purchase History</span>
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
              {customerSales.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('payments')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'payments'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>Payments & Debt</span>
            {unpaidSales.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-rose-500 text-white">
                {unpaidSales.length} Due
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('loyalty')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'loyalty'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Loyalty & Store Credit</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
            Lifetime Value
          </span>
          <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {formatMoney(customer.lifetimeValue || 0)}
          </p>
          <span className="text-[11px] text-slate-500">
            {(customer.purchaseHistoryCount || 0).toLocaleString()} orders
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
            Outstanding Balance
          </span>
          <p
            className={`text-xl font-black mt-1 ${
              (customer.outstandingBalance || 0) > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            {formatMoney(customer.outstandingBalance || 0)}
          </p>
          <span className="text-[11px] text-slate-500">
            {unpaidSales.length} unpaid invoice{unpaidSales.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
            Loyalty Points
          </span>
          <p className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {(customer.loyaltyPoints || 0).toLocaleString()} pts
          </p>
          <span className="text-[11px] text-slate-500">
            Value: {formatMoney((customer.loyaltyPoints || 0) * (settings.loyaltyPointValue || 0))}
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">
            Store Credit
          </span>
          <p className="text-xl font-black text-blue-600 dark:text-blue-400 mt-1">
            {formatMoney(customer.overageBalance || 0)}
          </p>
          <span className="text-[11px] text-slate-500">
            Avg order: {formatMoney(avgOrderValue)}
          </span>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contact & Account Details */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 space-y-4 shadow-xs">
            <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              <User className="w-4 h-4 text-blue-600" />
              <span>Account Details</span>
            </h2>
            <dl className="space-y-3 text-xs">
              <div className="flex justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                <dt className="text-slate-500 font-medium">Customer ID</dt>
                <dd className="font-mono font-bold text-slate-700 dark:text-slate-300">{customer.id}</dd>
              </div>
              <div className="flex justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                <dt className="text-slate-500 font-medium">Phone</dt>
                <dd className="font-bold text-slate-900 dark:text-white">
                  {isPrivacyMode ? '••••••' : customer.phone || 'N/A'}
                </dd>
              </div>
              <div className="flex justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                <dt className="text-slate-500 font-medium">Email</dt>
                <dd className="font-bold text-slate-900 dark:text-white">
                  {isPrivacyMode ? '••••••' : customer.email || 'N/A'}
                </dd>
              </div>
              <div className="flex justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                <dt className="text-slate-500 font-medium">Address</dt>
                <dd className="font-bold text-slate-900 dark:text-white text-right">
                  {isPrivacyMode ? '••••••' : customer.address || 'N/A'}
                </dd>
              </div>
              <div className="flex justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                <dt className="text-slate-500 font-medium flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Registered
                </dt>
                <dd className="font-bold text-slate-700 dark:text-slate-300">{formatDate(customer.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-2 py-1.5">
                <dt className="text-slate-500 font-medium flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Last Purchase
                </dt>
                <dd className="font-bold text-slate-700 dark:text-slate-300">{formatDate(lastPurchaseDate)}</dd>
              </div>
            </dl>
          </div>

          {/* Editable Customer Notes (synced to D1) */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                <span>Customer Notes</span>
              </h2>
              {notesSaved && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved & synced
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Record preferences, delivery instructions, or follow-up context for this customer. Notes sync to D1.
            </p>
            <form onSubmit={handleSaveNotes} className="space-y-3">
              <textarea
                rows={6}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Add notes about this customer (e.g., preferred delivery window, wholesale terms, contact preferences)..."
                className="w-full p-3 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none resize-y"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {customer.updatedAt ? `Last updated: ${formatDate(customer.updatedAt)}` : 'Not updated yet'}
                </span>
                <button
                  type="submit"
                  disabled={!notesDirty}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Notes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'purchases' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Receipt className="w-4 h-4 text-blue-600" />
              <span>Purchase History ({customerSales.length})</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                <tr>
                  <th className="py-3 px-4">Invoice</th>
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Items</th>
                  <th className="py-3 px-3">Total</th>
                  <th className="py-3 px-3">Paid</th>
                  <th className="py-3 px-3">Balance Due</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {customerSales.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-400">
                      No purchases recorded for this customer yet.
                    </td>
                  </tr>
                ) : (
                  customerSales.map((s) => {
                    const due = s.status === 'Refunded' ? 0 : unpaidOf(s);
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                          {s.invoiceNo || s.id}
                        </td>
                        <td className="py-3 px-3 text-slate-500">{formatDate(s.createdAt)}</td>
                        <td className="py-3 px-3">{s.type}</td>
                        <td className="py-3 px-3">{(s.items || []).length}</td>
                        <td className="py-3 px-3 font-bold">{formatMoney(s.totalAmount)}</td>
                        <td className="py-3 px-3 font-bold text-emerald-600 dark:text-emerald-400">
                          {formatMoney(s.paidAmount)}
                        </td>
                        <td className={`py-3 px-3 font-bold ${due > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                          {formatMoney(due)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              s.status === 'Completed'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'
                                : s.status === 'Refunded'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="space-y-6">
          {/* Unpaid Invoices */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-rose-500" />
                <span>Unpaid Invoices ({unpaidSales.length})</span>
              </h2>
              {(customer.outstandingBalance || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => onSettleDebt(customer)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center gap-1"
                >
                  <NairaSign className="w-3.5 h-3.5" />
                  <span>Record Debt Payment</span>
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Invoice</th>
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Invoice Total</th>
                    <th className="py-3 px-3">Paid</th>
                    <th className="py-3 px-4 text-right">Remaining Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {unpaidSales.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        No unpaid invoices. Account is in good standing.
                      </td>
                    </tr>
                  ) : (
                    unpaidSales.map((s) => (
                      <tr key={s.id}>
                        <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                          {s.invoiceNo || s.id}
                        </td>
                        <td className="py-3 px-3 text-slate-500">{formatDate(s.createdAt)}</td>
                        <td className="py-3 px-3 font-bold">{formatMoney(s.totalAmount)}</td>
                        <td className="py-3 px-3 text-emerald-600 font-bold">{formatMoney(s.paidAmount)}</td>
                        <td className="py-3 px-4 text-right font-black text-rose-600">
                          {formatMoney(unpaidOf(s))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Debt Settlement History */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-600" />
                <span>Recorded Debt Payments ({customerPayments.length})</span>
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-3">Method</th>
                    <th className="py-3 px-3">Amount</th>
                    <th className="py-3 px-3">Recorded By</th>
                    <th className="py-3 px-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {customerPayments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        No debt settlement payments recorded yet.
                      </td>
                    </tr>
                  ) : (
                    customerPayments.map((m) => (
                      <tr key={m.id}>
                        <td className="py-3 px-4 text-slate-500">{formatDate(m.date || m.createdAt)}</td>
                        <td className="py-3 px-3 font-bold">{m.subtype || 'Cash'}</td>
                        <td className="py-3 px-3 font-black text-emerald-600 dark:text-emerald-400">
                          {formatMoney(m.amount)}
                        </td>
                        <td className="py-3 px-3">{m.performedBy || 'Staff'}</td>
                        <td className="py-3 px-4 text-slate-500">{m.notes || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'loyalty' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-500" />
                <span>Loyalty Points & Store Credit Breakdown</span>
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Earning rate: {settings.pointsPerDollar || 0.01} pts per {settings.currencySymbol}1 spent (floored per sale)
              </p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-extrabold uppercase text-slate-400 block">Current Balance</span>
              <span className="text-base font-black text-amber-600 dark:text-amber-400">
                {(customer.loyaltyPoints || 0).toLocaleString()} pts
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                <tr>
                  <th className="py-3 px-4">Invoice</th>
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Order Total</th>
                  <th className="py-3 px-4 text-right">Points Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {activeSales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400">
                      No completed orders to earn loyalty points yet.
                    </td>
                  </tr>
                ) : (
                  activeSales.map((s) => (
                    <tr key={s.id}>
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                        {s.invoiceNo || s.id}
                      </td>
                      <td className="py-3 px-3 text-slate-500">{formatDate(s.createdAt)}</td>
                      <td className="py-3 px-3 font-bold">{formatMoney(s.totalAmount)}</td>
                      <td className="py-3 px-4 text-right font-bold text-amber-600 dark:text-amber-400">
                        +{loyaltyPointsForAmount(s.totalAmount, settings.pointsPerDollar).toLocaleString()} pts
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
