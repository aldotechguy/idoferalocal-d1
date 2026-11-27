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
  Tag,
  LifeBuoy,
  Flag,
} from 'lucide-react';
import { NairaSign } from '../common/NairaSign';
import Papa from 'papaparse';
import { List, type RowComponentProps } from 'react-window';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Customer, SupportTicket, SupportTicketPriority, SupportTicketStatus } from '../../types';
import { ConfirmModal } from '../common/ConfirmModal';
import { computeCustomerMetrics, settleCustomerBalance, round2 } from '../../shared/customerLedger';
import { findPotentialDuplicates } from '../../shared/customerDedup';
import { getCustomerPermissions } from '../../shared/customerPermissions';
import { CustomerDetailView } from './CustomerDetailView';

export const CustomersView: React.FC = () => {
  const { customers, sales, moneyMovements, auditLogs, addCustomer, updateCustomer, updateCustomerBalance, deleteCustomer, settings } = useApp();
  const { currentUser, isPrivacyMode } = useAuth();
  const { showToast } = useToast();
  const permissions = useMemo(() => getCustomerPermissions(currentUser?.role), [currentUser?.role]);
  const isSalesStaff = currentUser?.role === 'Sales Staff';

  const [hubTab, setHubTab] = useState<'directory' | 'support'>('directory');
  const [supportStatusFilter, setSupportStatusFilter] = useState<'ALL' | SupportTicketStatus>('ALL');
  const [newTicketCustomerId, setNewTicketCustomerId] = useState('');
  const [newTicketSubject, setNewTicketSubject] = useState('');
  const [newTicketDesc, setNewTicketDesc] = useState('');
  const [newTicketPriority, setNewTicketPriority] = useState<SupportTicketPriority>('Medium');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [allowFuzzyCreate, setAllowFuzzyCreate] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [settleCustomer, setSettleCustomer] = useState<Customer | null>(null);
  const [settleAmount, setSettleAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash');
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [paymentNote, setPaymentNote] = useState<string>('');

  const [formData, setFormData] = useState({ name: '', phone: '', email: '', address: '' });

  // Augment customer records with the shared ledger so the Hub displays exactly
  // what is stored — never a competing recomputation (audit C3).
  const augmentedCustomers = useMemo(() => {
    return customers.map((cust) => {
      if (!cust) return cust;
      const custSales = sales
        .filter((s) => {
          if (!s) return false;
          if (s.customerId) return s.customerId === cust.id;
          // Only fall back to a name match for legacy sales with no id, and
          // never let a guest/walk-in sale accrue to the directory.
          return (
            !!cust.name &&
            !!s.customerName &&
            s.customerName.trim().toLowerCase() === cust.name.trim().toLowerCase()
          );
        })
        .map((s) => ({
          id: s.id,
          invoiceNo: s.invoiceNo,
          totalAmount: Number(s.totalAmount) || 0,
          paidAmount: s.paidAmount,
          createdAt: s.createdAt,
          status: s.status,
          customerId: s.customerId,
          customerName: s.customerName,
        }));

      const metrics = computeCustomerMetrics(
        {
          id: cust.id,
          name: cust.name,
          outstandingBalance: Number(cust.outstandingBalance) || 0,
          overageBalance: Number(cust.overageBalance) || 0,
          loyaltyPoints: Number(cust.loyaltyPoints) || 0,
          lifetimeValue: Number(cust.lifetimeValue) || 0,
          purchaseHistoryCount: Number(cust.purchaseHistoryCount) || 0,
        },
        custSales,
        settings.pointsPerDollar
      );

      return {
        ...cust,
        purchaseHistoryCount: metrics.purchaseHistoryCount,
        lifetimeValue: metrics.lifetimeValue,
        loyaltyPoints: metrics.loyaltyPoints,
        outstandingBalance: metrics.outstandingBalance,
        overageBalance: metrics.overageBalance,
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

  const allTags = useMemo(() => {
    const set = new Set<string>();
    augmentedCustomers.forEach((c) => (c.tags || []).forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [augmentedCustomers]);

  const filteredCustomers = augmentedCustomers.filter((c) => {
    if (!c) return false;
    if (selectedTag !== 'ALL' && !(c.tags || []).includes(selectedTag)) return false;
    const q = (searchQuery || '').toLowerCase();
    return (
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(searchQuery)) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  });

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleBulkApplyTag = (rawTag: string) => {
    const tag = rawTag.trim();
    if (!tag || selectedIds.length === 0) return;
    selectedIds.forEach((id) => {
      const cust = customers.find((c) => c.id === id);
      if (!cust) return;
      const existing = cust.tags || [];
      if (!existing.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        updateCustomer(id, { tags: [...existing, tag] });
      }
    });
    showToast({
      title: 'Tags Applied',
      message: `Applied "${tag}" to ${selectedIds.length} customer(s).`,
      type: 'success',
    });
    setBulkTagInput('');
    setSelectedIds([]);
  };

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;
  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedCustomers = filteredCustomers.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);
  const useVirtualList = filteredCustomers.length > 100;

  const exportCsv = () => {
    const data = filteredCustomers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      tags: (c.tags || []).join('; '),
      outstandingBalance: c.outstandingBalance,
      loyaltyPoints: c.loyaltyPoints,
      lifetimeValue: c.lifetimeValue,
    }));
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    link.setAttribute('download', `customers-export-${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const selectedCustomer = useMemo(
    () => (selectedCustomerId ? augmentedCustomers.find((c) => c.id === selectedCustomerId) || null : null),
    [augmentedCustomers, selectedCustomerId]
  );

  const duplicateMatches = useMemo(() => {
    if (!showAddModal && !editingCustomer) return [];
    return findPotentialDuplicates(augmentedCustomers, formData, editingCustomer?.id);
  }, [showAddModal, editingCustomer, augmentedCustomers, formData]);

  const exactDuplicate = duplicateMatches.find((m) => m.confidence === 'exact');
  const possibleDuplicates = duplicateMatches.filter((m) => m.confidence === 'possible');

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = formData.name.trim();
    if (!name) return;

    // Duplicate detection (audit M1 + Sprint 1 P2): a second identical customer
    // splits debt and loyalty across two records. Block exact phone/email/name
    // matches; prompt for confirmation on fuzzy name matches.
    if (exactDuplicate) {
      showToast({
        title: 'Customer Already Exists',
        message: `"${exactDuplicate.customer.name}" matches (${exactDuplicate.reason}). Open their profile instead of creating a duplicate.`,
        type: 'error',
      });
      return;
    }

    if (possibleDuplicates.length > 0 && !allowFuzzyCreate) {
      showToast({
        title: 'Possible Duplicate Found',
        message: `Similar to "${possibleDuplicates[0].customer.name}". Review the match or click "Create Anyway" to confirm.`,
        type: 'info',
      });
      return;
    }

    addCustomer({ ...formData, name });
    setShowAddModal(false);
    setAllowFuzzyCreate(false);
    setFormData({ name: '', phone: '', email: '', address: '' });
  };

  const handleOpenEdit = (cust: Customer) => {
    setEditingCustomer(cust);
    setAllowFuzzyCreate(false);
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
    if (exactDuplicate) {
      showToast({
        title: 'Duplicate Contact Details',
        message: `Another customer "${exactDuplicate.customer.name}" already uses that ${exactDuplicate.matchType}.`,
        type: 'error',
      });
      return;
    }
    updateCustomer(editingCustomer.id, {
      name: formData.name.trim(),
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
    setPaymentReference('');
    setPaymentNote('');
  };

  // Live preview of a settlement: what goes to debt, and whether the typed
  // amount would exceed it. An overpayment is refused, never converted into
  // hidden store credit (audit C2).
  const settlePreview = useMemo(() => {
    if (!settleCustomer) return null;
    const bal = Math.max(0, round2(Number(settleCustomer.outstandingBalance) || 0));
    const typed = round2(parseFloat(settleAmount));
    const amount = Number.isFinite(typed) && typed > 0 ? typed : 0;
    const plan = settleCustomerBalance(
      {
        id: settleCustomer.id,
        name: settleCustomer.name,
        outstandingBalance: bal,
        overageBalance: Number(settleCustomer.overageBalance) || 0,
        loyaltyPoints: Number(settleCustomer.loyaltyPoints) || 0,
        lifetimeValue: Number(settleCustomer.lifetimeValue) || 0,
        purchaseHistoryCount: Number(settleCustomer.purchaseHistoryCount) || 0,
      },
      amount
    );
    return {
      balance: bal,
      amount,
      appliedToDebt: plan.appliedToDebt,
      remaining: plan.customer.outstandingBalance,
      blocked: amount > bal && bal > 0,
    };
  }, [settleCustomer, settleAmount]);

  const handleSettleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleCustomer) return;
    const payVal = round2(parseFloat(settleAmount));
    if (!Number.isFinite(payVal) || payVal <= 0) return;
    // Refuse anything above the debt — the operator must see that they would be
    // overpaying rather than have it silently become store credit.
    if (settlePreview?.blocked) {
      showToast({
        title: 'Amount Exceeds Balance',
        message: `The payment is more than the ${settings.currencySymbol}${settlePreview.balance.toFixed(2)} owed. Enter an amount up to the outstanding balance.`,
        type: 'error',
      });
      return;
    }

    const combinedNote = [paymentReference.trim() ? `Ref: ${paymentReference.trim()}` : '', paymentNote.trim()]
      .filter(Boolean)
      .join(' | ');

    updateCustomerBalance(settleCustomer.id, -payVal, {
      paymentMethod: paymentMethod as any,
      paymentNote: combinedNote || undefined,
      performedBy: currentUser?.displayName || currentUser?.username || 'Admin',
    });
    setSettleCustomer(null);
    setSettleAmount('');
    setPaymentReference('');
    setPaymentNote('');
  };

  const handleClearEntireDebt = () => {
    if (!settleCustomer) return;
    const bal = Number(settleCustomer.outstandingBalance) || 0;
    if (bal <= 0) return;
    const combinedNote = [paymentReference.trim() ? `Ref: ${paymentReference.trim()}` : '', paymentNote.trim()]
      .filter(Boolean)
      .join(' | ');
    updateCustomerBalance(settleCustomer.id, -bal, {
      paymentMethod: paymentMethod as any,
      paymentNote: combinedNote || undefined,
      performedBy: currentUser?.displayName || currentUser?.username || 'Admin',
    });
    setSettleCustomer(null);
    setPaymentReference('');
    setPaymentNote('');
  };

  const allSupportTickets = useMemo(() => {
    const list: Array<{ customer: Customer; ticket: SupportTicket }> = [];
    augmentedCustomers.forEach((cust) => {
      (cust.supportTickets || []).forEach((ticket) => {
        list.push({ customer: cust, ticket });
      });
    });
    return list.sort((a, b) => String(b.ticket.createdAt || '').localeCompare(String(a.ticket.createdAt || '')));
  }, [augmentedCustomers]);

  const openSupportCount = allSupportTickets.filter((x) => x.ticket.status !== 'Resolved').length;

  const filteredSupportTickets = useMemo(() => {
    return allSupportTickets.filter(({ customer, ticket }) => {
      if (supportStatusFilter !== 'ALL' && ticket.status !== supportStatusFilter) return false;
      const q = (searchQuery || '').toLowerCase();
      if (!q) return true;
      return (
        ticket.subject.toLowerCase().includes(q) ||
        (ticket.description || '').toLowerCase().includes(q) ||
        (customer.name || '').toLowerCase().includes(q)
      );
    });
  }, [allSupportTickets, supportStatusFilter, searchQuery]);

  const handleCreateHubTicket = (e: React.FormEvent) => {
    e.preventDefault();
    const cust = customers.find((c) => c.id === newTicketCustomerId);
    if (!cust || !newTicketSubject.trim()) return;
    const now = new Date().toISOString();
    const ticket: SupportTicket = {
      id: `tkt_${Date.now()}`,
      subject: newTicketSubject.trim(),
      description: newTicketDesc.trim(),
      status: 'Open',
      priority: newTicketPriority,
      flagged: false,
      createdBy: currentUser?.displayName || currentUser?.username || 'Staff',
      createdAt: now,
      updatedAt: now,
    };
    updateCustomer(cust.id, { supportTickets: [ticket, ...(cust.supportTickets || [])] });
    showToast({ title: 'Support Ticket Logged', message: `Ticket opened for ${cust.name}.`, type: 'success' });
    setNewTicketCustomerId('');
    setNewTicketSubject('');
    setNewTicketDesc('');
    setNewTicketPriority('Medium');
  };

  const handleUpdateHubTicket = (customerId: string, ticketId: string, patch: Partial<SupportTicket>) => {
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return;
    const now = new Date().toISOString();
    updateCustomer(customerId, {
      supportTickets: (cust.supportTickets || []).map((t) =>
        t.id === ticketId ? { ...t, ...patch, updatedAt: now } : t
      ),
    });
  };

  return (
    <>
      {selectedCustomer ? (
        <CustomerDetailView
          customer={selectedCustomer}
          sales={sales}
          moneyMovements={moneyMovements}
          auditLogs={auditLogs}
          settings={settings}
          isPrivacyMode={isPrivacyMode}
          isSalesStaff={isSalesStaff}
          permissions={permissions}
          currentUserName={currentUser?.displayName || currentUser?.username || 'Staff'}
          onBack={() => setSelectedCustomerId(null)}
          onEdit={handleOpenEdit}
          onDelete={(cust) => setCustomerToDelete(cust)}
          onSettleDebt={handleOpenSettle}
          onSaveNotes={(customerId, notes) => updateCustomer(customerId, { notes })}
          onSaveTags={(customerId, tags) => updateCustomer(customerId, { tags })}
          onSaveSupportTickets={(customerId, supportTickets) => updateCustomer(customerId, { supportTickets })}
        />
      ) : (
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

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setHubTab('directory')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                hubTab === 'directory'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              Customer Directory
            </button>
            <button
              type="button"
              onClick={() => setHubTab('support')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                hubTab === 'support'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <LifeBuoy className="w-3.5 h-3.5" />
              <span>Support Dashboard</span>
              {openSupportCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-500 text-white">
                  {openSupportCount}
                </span>
              )}
            </button>
          </div>
          {permissions.canCreate && (
            <button
              onClick={() => {
                setAllowFuzzyCreate(false);
                setFormData({ name: '', phone: '', email: '', address: '' });
                setShowAddModal(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Customer</span>
            </button>
          )}
          {permissions.canExport && (
            <button
              onClick={exportCsv}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      {hubTab === 'directory' ? (
      <>
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
              {isPrivacyMode
                ? '••••••'
                : `${settings.currencySymbol}${totalCustomerRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
              {isPrivacyMode
                ? '••••••'
                : `${settings.currencySymbol}${totalOutstandingDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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

      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search customer by name, phone, email, or tag..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-9 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 text-slate-900 dark:text-slate-100 text-xs rounded-xl focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Tag className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <select
              aria-label="Filter by tag"
              value={selectedTag}
              onChange={(e) => {
                setSelectedTag(e.target.value);
                setCurrentPage(1);
              }}
              className="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl focus:outline-none"
            >
              <option value="ALL">All Tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
              {selectedIds.length} customer{selectedIds.length === 1 ? '' : 's'} selected
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={bulkTagInput}
                onChange={(e) => setBulkTagInput(e.target.value)}
                placeholder="Bulk tag (e.g. VIP)..."
                className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleBulkApplyTag(bulkTagInput)}
                disabled={!bulkTagInput.trim()}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs"
              >
                Apply Tag
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        {useVirtualList ? (
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div className="grid grid-cols-12 items-center bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold py-3 px-4">
                <div className="col-span-2">Customer Name</div>
                <div className="col-span-3">Contact Details</div>
                <div className="col-span-1">Orders</div>
                <div className="col-span-1">Loyalty</div>
                <div className="col-span-1">Lifetime</div>
                <div className="col-span-2">Outstanding</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
              <List
                style={{ height: Math.min(paginatedCustomers.length * 64, 600), width: '100%' }}
                rowCount={paginatedCustomers.length}
                rowHeight={64}
                rowProps={{ items: paginatedCustomers }}
                rowComponent={({ index, style, items }: RowComponentProps<{ items: typeof paginatedCustomers }>) => {
                  const cust = items[index];
                  if (!cust) return null;
                  return (
                    <div
                      style={style}
                      className="grid grid-cols-12 items-center px-4 text-xs border-b border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="col-span-2 font-bold text-slate-900 dark:text-white truncate pr-2 flex items-start gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${cust.name}`}
                          checked={selectedIds.includes(cust.id)}
                          onChange={() => handleToggleSelect(cust.id)}
                          className="mt-1 rounded shrink-0"
                        />
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomerId(cust.id)}
                            className="text-left hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors font-bold truncate max-w-full block"
                            title="Open Customer Profile"
                          >
                            {cust.name}
                          </button>
                          {(cust.tags || []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {(cust.tags || []).slice(0, 2).map((t) => (
                                <span key={t} className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="col-span-3 pr-2 min-w-0">
                        <p className="flex items-center gap-1 text-[11px] truncate"><Phone className="w-3 h-3 text-slate-400 shrink-0" /> {isPrivacyMode ? '••••••' : (cust.phone || 'N/A')}</p>
                        <p className="flex items-center gap-1 text-[10px] text-slate-400 truncate"><Mail className="w-3 h-3 text-slate-400 shrink-0" /> {isPrivacyMode ? '••••••' : (cust.email || 'N/A')}</p>
                      </div>
                      <div className="col-span-1 font-bold">{(cust.purchaseHistoryCount || 0).toLocaleString()}</div>
                      <div className="col-span-1 font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <Award className="w-3.5 h-3.5 shrink-0" />
                        <span>{(cust.loyaltyPoints || 0).toLocaleString()}</span>
                      </div>
                      <div className="col-span-1 font-bold text-emerald-600 dark:text-emerald-400 truncate">
                        {isPrivacyMode ? '••••••' : `${settings.currencySymbol}${(cust.lifetimeValue || 0).toFixed(2)}`}
                      </div>
                      <div className="col-span-2 pr-2">
                        {isPrivacyMode ? (
                          <span className="font-mono font-bold text-slate-400">••••••</span>
                        ) : (cust.overageBalance || 0) > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 font-bold text-[11px]">
                            Store Credit: +{settings.currencySymbol}{(cust.overageBalance || 0).toFixed(2)}
                          </span>
                        ) : (
                          <span className={`font-bold ${(cust.outstandingBalance || 0) > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                            {settings.currencySymbol}{(cust.outstandingBalance || 0).toFixed(2)}
                          </span>
                        )}
                      </div>
                      <div className="col-span-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomerId(cust.id)}
                            className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-lg hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/60 dark:hover:text-blue-400 transition-colors"
                          >
                            View
                          </button>
                          {cust.outstandingBalance > 0 && permissions.canSettleDebt && (
                            <button
                              onClick={() => handleOpenSettle(cust)}
                              className="px-2.5 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 text-[10px] font-bold rounded-lg hover:bg-emerald-200 transition-colors flex items-center gap-1"
                            >
                              <NairaSign className="w-3 h-3" />
                              <span>Settle</span>
                            </button>
                          )}
                          {permissions.canEdit && (
                            <button
                              onClick={() => handleOpenEdit(cust)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              title="Edit Customer Details"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}
                          {permissions.canDelete && (
                            <button
                              onClick={() => setCustomerToDelete(cust)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              title="Delete Customer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          </div>
        ) : (
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
              {paginatedCustomers.length === 0 ? (
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
                paginatedCustomers.map((cust) => (
                  <tr key={cust.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${cust.name}`}
                          checked={selectedIds.includes(cust.id)}
                          onChange={() => handleToggleSelect(cust.id)}
                          className="mt-0.5 rounded shrink-0"
                        />
                        <div>
                          <button
                            type="button"
                            onClick={() => setSelectedCustomerId(cust.id)}
                            className="text-left hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors font-bold"
                            title="Open Customer Profile"
                          >
                            {cust.name}
                          </button>
                          {(cust.tags || []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(cust.tags || []).map((t) => (
                                <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <p className="flex items-center gap-1 text-[11px]"><Phone className="w-3 h-3 text-slate-400" /> {isPrivacyMode ? '••••••' : (cust.phone || 'N/A')}</p>
                      <p className="flex items-center gap-1 text-[10px] text-slate-400"><Mail className="w-3 h-3 text-slate-400" /> {isPrivacyMode ? '••••••' : (cust.email || 'N/A')}</p>
                    </td>
                    <td className="py-3 px-3 font-bold">{(cust.purchaseHistoryCount || 0).toLocaleString()} orders</td>
                    <td className="py-3 px-3 font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Award className="w-3.5 h-3.5" />
                      <span>{(cust.loyaltyPoints || 0).toLocaleString()} pts</span>
                    </td>
                    <td className="py-3 px-3 font-bold text-emerald-600 dark:text-emerald-400">
                      {isPrivacyMode ? '••••••' : `${settings.currencySymbol}${(cust.lifetimeValue || 0).toFixed(2)}`}
                    </td>
                    <td className="py-3 px-3">
                      {isPrivacyMode ? (
                        <span className="font-mono font-bold text-slate-400">••••••</span>
                      ) : (cust.overageBalance || 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 font-bold text-[11px]">
                          Store Credit: +{settings.currencySymbol}{(cust.overageBalance || 0).toFixed(2)}
                        </span>
                      ) : (
                        <span className={`font-bold ${(cust.outstandingBalance || 0) > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                          {settings.currencySymbol}{(cust.outstandingBalance || 0).toFixed(2)}
                        </span>
                      )}
                    </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedCustomerId(cust.id)}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-lg hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/60 dark:hover:text-blue-400 transition-colors"
                      >
                        View
                      </button>
                      {cust.outstandingBalance > 0 && permissions.canSettleDebt && (
                        <button
                          onClick={() => handleOpenSettle(cust)}
                          className="px-2.5 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 text-[10px] font-bold rounded-lg hover:bg-emerald-200 transition-colors flex items-center gap-1"
                        >
                          <NairaSign className="w-3 h-3" />
                          <span>Settle Balance</span>
                        </button>
                      )}
                      {permissions.canEdit && (
                        <button
                          onClick={() => handleOpenEdit(cust)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Edit Customer Details"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                      {permissions.canDelete && (
                        <button
                          onClick={() => setCustomerToDelete(cust)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Delete Customer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
            </tbody>
          </table>
        </div>
        )}
        {/* Pagination Controls */}
        <div className="flex justify-between items-center px-4 py-3 border-t border-slate-100 dark:border-slate-800">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Page {safePage} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              disabled={safePage === 1}
              className="px-3 py-1 text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg disabled:opacity-50"
            >
              Prev
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              disabled={safePage === totalPages}
              className="px-3 py-1 text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      </>
      ) : (
        <div className="space-y-6">
          {/* Support Dashboard KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {(['Open', 'Flagged', 'In Progress', 'Resolved'] as SupportTicketStatus[]).map((st) => {
              const count = allSupportTickets.filter((x) => x.ticket.status === st || (st === 'Flagged' && x.ticket.flagged)).length;
              return (
                <div key={st} className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
                  <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block">{st} Tickets</span>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{count}</p>
                </div>
              );
            })}
          </div>

          {/* New Support Ticket Form */}
          {permissions.canManageSupport && (
            <form
              onSubmit={handleCreateHubTicket}
              className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3"
            >
              <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <LifeBuoy className="w-4 h-4 text-blue-600" />
                <span>Log New Support Ticket</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <select
                  aria-label="Select customer for ticket"
                  required
                  value={newTicketCustomerId}
                  onChange={(e) => setNewTicketCustomerId(e.target.value)}
                  className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-bold focus:outline-none"
                >
                  <option value="">Select Customer...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  placeholder="Ticket subject..."
                  value={newTicketSubject}
                  onChange={(e) => setNewTicketSubject(e.target.value)}
                  className="sm:col-span-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                />
                <select
                  aria-label="New ticket priority"
                  value={newTicketPriority}
                  onChange={(e) => setNewTicketPriority(e.target.value as SupportTicketPriority)}
                  className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-bold focus:outline-none"
                >
                  <option value="Low">Low Priority</option>
                  <option value="Medium">Medium Priority</option>
                  <option value="High">High Priority</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  placeholder="Issue details or requested action..."
                  value={newTicketDesc}
                  onChange={(e) => setNewTicketDesc(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!newTicketCustomerId || !newTicketSubject.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs"
                >
                  Create Ticket
                </button>
              </div>
            </form>
          )}

          {/* Ticket Queue */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-black text-slate-900 dark:text-white">
                Support Queue ({filteredSupportTickets.length})
              </h3>
              <div className="flex items-center gap-2">
                {(['ALL', 'Open', 'In Progress', 'Flagged', 'Resolved'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setSupportStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                      supportStatusFilter === st
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
            {filteredSupportTickets.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                No support tickets match the selected filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredSupportTickets.map(({ customer, ticket }) => (
                  <div key={ticket.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-white">{ticket.subject}</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {ticket.priority}
                        </span>
                        {ticket.flagged && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                            <Flag className="w-2.5 h-2.5" /> Flagged
                          </span>
                        )}
                      </div>
                      {ticket.description && <p className="text-xs text-slate-600 dark:text-slate-400">{ticket.description}</p>}
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                        <button
                          type="button"
                          onClick={() => setSelectedCustomerId(customer.id)}
                          className="font-bold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {customer.name}
                        </button>
                        {!isPrivacyMode && customer.phone && (
                          <a href={`tel:${customer.phone}`} className="hover:underline flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {customer.phone}
                          </a>
                        )}
                        {!isPrivacyMode && customer.email && (
                          <a href={`mailto:${customer.email}`} className="hover:underline flex items-center gap-1">
                            <Mail className="w-3 h-3" /> {customer.email}
                          </a>
                        )}
                      </div>
                    </div>
                    {permissions.canManageSupport && (
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          aria-label={`Hub status for ${ticket.subject}`}
                          value={ticket.status}
                          onChange={(e) => handleUpdateHubTicket(customer.id, ticket.id, { status: e.target.value as SupportTicketStatus })}
                          className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-[11px] font-bold text-slate-800 dark:text-slate-200"
                        >
                          <option value="Open">Open</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Flagged">Flagged</option>
                          <option value="Resolved">Resolved</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleUpdateHubTicket(customer.id, ticket.id, { flagged: !ticket.flagged })}
                          className={`p-1.5 rounded-lg border text-xs ${
                            ticket.flagged
                              ? 'bg-amber-50 border-amber-300 text-amber-600'
                              : 'bg-slate-100 dark:bg-slate-800 border-transparent text-slate-500'
                          }`}
                          title={ticket.flagged ? 'Unflag ticket' : 'Flag ticket'}
                        >
                          <Flag className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
        </div>
      )}

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
                <input type="text" required value={formData.name} onChange={(e) => { setAllowFuzzyCreate(false); setFormData({ ...formData, name: e.target.value }); }} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
              <div>
                <label className="block font-bold mb-1">Phone Number</label>
                <input type="text" value={formData.phone} onChange={(e) => { setAllowFuzzyCreate(false); setFormData({ ...formData, phone: e.target.value }); }} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
              <div>
                <label className="block font-bold mb-1">Email Address</label>
                <input type="email" value={formData.email} onChange={(e) => { setAllowFuzzyCreate(false); setFormData({ ...formData, email: e.target.value }); }} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
              <div>
                <label className="block font-bold mb-1">Street Address</label>
                <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>

              {duplicateMatches.length > 0 && (
                <div className={`p-3 rounded-2xl border space-y-2 ${
                  exactDuplicate
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60'
                }`}>
                  <div className="flex items-center gap-1.5 font-extrabold text-[11px] text-slate-900 dark:text-white">
                    <AlertCircle className={`w-4 h-4 shrink-0 ${exactDuplicate ? 'text-rose-600' : 'text-amber-600'}`} />
                    <span>{exactDuplicate ? 'Duplicate Customer Detected' : 'Possible Duplicate Match'}</span>
                  </div>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {duplicateMatches.slice(0, 3).map((match) => (
                      <div key={match.customer.id} className="flex items-center justify-between gap-2 bg-white/80 dark:bg-slate-900/70 p-2 rounded-xl text-[11px]">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 dark:text-white truncate">{match.customer.name}</p>
                          <p className="text-[10px] text-slate-500 truncate">
                            {match.reason} • {(match.customer.purchaseHistoryCount || 0)} orders
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddModal(false);
                            setSelectedCustomerId(match.customer.id);
                          }}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-[10px] shrink-0"
                        >
                          Open Profile
                        </button>
                      </div>
                    ))}
                  </div>
                  {!exactDuplicate && possibleDuplicates.length > 0 && (
                    <label className="flex items-center gap-2 pt-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowFuzzyCreate}
                        onChange={(e) => setAllowFuzzyCreate(e.target.checked)}
                        className="rounded"
                      />
                      <span>Confirm this is a different customer (create anyway)</span>
                    </label>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 font-semibold">Cancel</button>
                <button
                  type="submit"
                  disabled={!!exactDuplicate || (possibleDuplicates.length > 0 && !allowFuzzyCreate)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl"
                >
                  Save Customer
                </button>
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
              {exactDuplicate && (
                <div className="p-3 rounded-2xl border bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 text-[11px] text-rose-700 dark:text-rose-300 font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Conflicts with existing customer "{exactDuplicate.customer.name}" ({exactDuplicate.reason}).</span>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingCustomer(null)} className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-400">Cancel</button>
                <button type="submit" disabled={!!exactDuplicate} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-xs transition-colors">Update Customer</button>
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
                    max={Number(settleCustomer.outstandingBalance) || 0}
                    required
                    value={settleAmount}
                    onChange={(e) => setSettleAmount(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 rounded-xl text-slate-900 dark:text-white font-black text-base"
                    placeholder="0.00"
                  />
                </div>
                {settlePreview?.blocked && (
                  <p className="mt-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                    Amount exceeds the {settings.currencySymbol}{settlePreview.balance.toFixed(2)} owed. Enter an amount up to the outstanding balance.
                  </p>
                )}

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
              {settlePreview && settlePreview.amount > 0 && (
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium">Applied to Debt:</span>
                    <span className="font-black text-emerald-600 dark:text-emerald-400">
                      {settings.currencySymbol}{settlePreview.appliedToDebt.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium">New Remaining Balance:</span>
                    <span className={`font-black text-sm ${
                      settlePreview.remaining <= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}>
                      {settings.currencySymbol}{settlePreview.remaining.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium">Store Credit Created:</span>
                    <span className="font-bold text-slate-500 dark:text-slate-400">
                      {settings.currencySymbol}0.00
                    </span>
                  </div>
                  {settlePreview.blocked && (
                    <p className="text-[10px] font-bold text-rose-600 dark:text-rose-400 pt-0.5">
                      Payment exceeds the balance. Only {settings.currencySymbol}{settlePreview.balance.toFixed(2)} will be applied.
                    </p>
                  )}
                </div>
              )}

              {/* Payment Method */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Method
                </label>
                <select
                  aria-label="Payment Method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:outline-none"
                >
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Mobile Transfer">Mobile Money / Transfer</option>
                  <option value="Card">Card / POS</option>
                </select>
              </div>

              {/* Optional Reference & Note */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Transaction Ref (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., TRX-849201"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="w-full p-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Payment Note (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Part payment"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    className="w-full p-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium"
                  />
                </div>
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
                  disabled={!settleAmount || isNaN(parseFloat(settleAmount)) || parseFloat(settleAmount) <= 0 || !!settlePreview?.blocked}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Record Payment ({settings.currencySymbol}{settlePreview ? settlePreview.appliedToDebt.toFixed(2) : parseFloat(settleAmount || '0').toFixed(2)})</span>
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
        message={
          customerToDelete && ((Number(customerToDelete.outstandingBalance) || 0) > 0 || (Number(customerToDelete.overageBalance) || 0) > 0)
            ? `"${customerToDelete.name}" still holds a live balance (${settings.currencySymbol}${(Number(customerToDelete.outstandingBalance) || 0).toFixed(2)} owed, ${settings.currencySymbol}${(Number(customerToDelete.overageBalance) || 0).toFixed(2)} credit). Settle the account before deleting — this cannot be undone.`
            : `Are you sure you want to delete customer "${customerToDelete?.name}"? Their purchase history records will remain in sales logs.`
        }
        confirmText="Delete Customer"
        variant="danger"
        onClose={() => setCustomerToDelete(null)}
        onConfirm={() => {
          if (customerToDelete) {
            const deletedId = customerToDelete.id;
            deleteCustomer(deletedId);
            if (selectedCustomerId === deletedId) {
              setSelectedCustomerId(null);
            }
            setCustomerToDelete(null);
          }
        }}
      />
    </>
  );
};
