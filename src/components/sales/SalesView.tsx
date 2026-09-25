import React, { useState, useMemo } from 'react';
import {
  ShoppingBag,
  Search,
  Filter,
  Calendar as CalendarIcon,
  CreditCard,
  Banknote,
  Smartphone,
  Building,
  User,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Printer,
  Download,
  Eye,
  ArrowUpRight,
  Receipt,
  RotateCcw,
  AlertCircle,
  X,
  FileSpreadsheet,
  Clock,
  Layers,
  Sliders,
  Tag,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  ListFilter,
  Activity,
  ArrowLeft,
  ArrowRight,
  Edit3,
  Plus,
  ShieldCheck,
  MoreHorizontal,
  UserCheck,
  ArrowRightLeft,
  UserX,
  ChevronDown,
  Check,
  Phone,
  Mail,
  Award,
} from 'lucide-react';
import { NairaSign } from '../common/NairaSign';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Sale, SaleItem, PaymentMethod, SaleStatus, Customer } from '../../types';
import { ReceiptModal } from '../common/ReceiptModal';
import { Pagination } from '../common/Pagination';
import { InvoiceWorkshopModal } from './InvoiceWorkshopModal';
import { useInteractions } from '../../context/InteractionContext';

interface SalesViewProps {
  onNavigate?: (page: string) => void;
}

const GUEST_CUSTOMER_NAMES = new Set(['walk-in customer', 'cash customer', 'guest customer', 'walk-in']);

/** True when a sale has no real customer identity (case-insensitive). */
const isGuestCustomerName = (name?: string): boolean => {
  const normalized = String(name || '').trim().toLowerCase();
  return normalized === '' || GUEST_CUSTOMER_NAMES.has(normalized);
};

export const SalesView: React.FC<SalesViewProps> = ({ onNavigate }) => {
  const { sales, products, customers, settings, refundSale, updateSale, deleteSale } = useApp();
  const { currentUser, isSuperAdmin, hasPermission } = useAuth();
  const { notify } = useInteractions();

  // Active view tab: 'calendar' (Daily Calendar History) or 'list' (Table list)
  const [activeTab, setActiveTab] = useState<'calendar' | 'list'>('calendar');

  // Calendar State
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDateString, setSelectedDateString] = useState<string>(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('All');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [datePreset, setDatePreset] = useState<string>('All Time');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Selected sale for receipt view modal
  const [selectedReceiptSale, setSelectedReceiptSale] = useState<Sale | null>(null);
  const [workshopSale, setWorkshopSale] = useState<Sale | null>(null);

  // Refund modal state
  const [refundSaleTarget, setRefundSaleTarget] = useState<Sale | null>(null);
  const [refundReason, setRefundReason] = useState('Customer returned item');

  // Delete confirm modal state
  const [deleteSaleTarget, setDeleteSaleTarget] = useState<Sale | null>(null);

  // Edit Sale modal state (Super-Admin full edit & Admin historical edit)
  const [editSaleTarget, setEditSaleTarget] = useState<Sale | null>(null);
  const [editingSaleItems, setEditingSaleItems] = useState<SaleItem[]>([]);
  const [editCustomerId, setEditCustomerId] = useState<string | undefined>(undefined);
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState<boolean>(false);
  const [isCustomGuestMode, setIsCustomGuestMode] = useState<boolean>(false);
  const [editType, setEditType] = useState<'Retail' | 'Wholesale'>('Retail');
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>('Card');
  const [editStatus, setEditStatus] = useState<SaleStatus>('Completed');
  const [editCreatedBy, setEditCreatedBy] = useState<string>('');
  const [editCreatedAt, setEditCreatedAt] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editDiscount, setEditDiscount] = useState<number>(0);
  const [editTax, setEditTax] = useState<number>(0);
  const [editDeliveryFee, setEditDeliveryFee] = useState<number>(0);
  const [editPaidAmount, setEditPaidAmount] = useState<number>(0);
  const [selectedAddProductId, setSelectedAddProductId] = useState<string>('');
  const [showEditAddClearance, setShowEditAddClearance] = useState<boolean>(false);
  const [editClearanceName, setEditClearanceName] = useState<string>('Clearance Sale Item');
  const [editClearanceAmount, setEditClearanceAmount] = useState<string>('');
  const [editClearanceQty, setEditClearanceQty] = useState<string>('1');
  const [editClearanceNotes, setEditClearanceNotes] = useState<string>('');

  // Customer Transfer helpers for Edit Sale Modal
  const editItemsSubtotal = useMemo(() => {
    return editingSaleItems.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);
  }, [editingSaleItems]);

  const editCalculatedTotal = useMemo(() => {
    return Math.max(0, editItemsSubtotal - editDiscount + editTax + editDeliveryFee);
  }, [editItemsSubtotal, editDiscount, editTax, editDeliveryFee]);

  const editSanitizedPaid = useMemo(() => {
    return Math.max(0, isNaN(editPaidAmount) ? 0 : editPaidAmount);
  }, [editPaidAmount]);

  const editUnpaidBalance = useMemo(() => {
    return Math.max(0, editCalculatedTotal - editSanitizedPaid);
  }, [editCalculatedTotal, editSanitizedPaid]);

  const editLoyaltyPointsGain = useMemo(() => {
    return Math.floor(editCalculatedTotal * (settings.pointsPerDollar || 0.01));
  }, [editCalculatedTotal, settings.pointsPerDollar]);

  const filteredCustomersForEdit = useMemo(() => {
    const q = customerSearchQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 10);
    return customers.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [customers, customerSearchQuery]);

  const selectedCustomerObj = useMemo(() => {
    if (editCustomerId) {
      return customers.find((c) => c.id === editCustomerId) || null;
    }
    if (!isCustomGuestMode && editCustomerName && editCustomerName.toLowerCase() !== 'walk-in customer' && editCustomerName.toLowerCase() !== 'cash customer') {
      return customers.find((c) => c.name && c.name.toLowerCase() === editCustomerName.toLowerCase()) || null;
    }
    return null;
  }, [customers, editCustomerId, editCustomerName, isCustomGuestMode]);

  const originalCustomerObj = useMemo(() => {
    if (!editSaleTarget) return null;
    if (editSaleTarget.customerId) {
      return customers.find((c) => c.id === editSaleTarget.customerId) || null;
    }
    if (editSaleTarget.customerName && editSaleTarget.customerName.toLowerCase() !== 'walk-in customer' && editSaleTarget.customerName.toLowerCase() !== 'cash customer') {
      return customers.find((c) => c.name && c.name.toLowerCase() === editSaleTarget.customerName.toLowerCase()) || null;
    }
    return null;
  }, [customers, editSaleTarget]);

  const isTransferringOwnership = useMemo(() => {
    if (!editSaleTarget) return false;
    const origKey = editSaleTarget.customerId || (editSaleTarget.customerName && !isGuestCustomerName(editSaleTarget.customerName) ? editSaleTarget.customerName.toLowerCase() : '__walkin__');
    const newKey = isCustomGuestMode
      ? `__custom_${editCustomerName.toLowerCase()}__`
      : (selectedCustomerObj?.id || (!isGuestCustomerName(editCustomerName) ? editCustomerName.toLowerCase() : '__walkin__'));
    return origKey !== newKey;
  }, [editSaleTarget, isCustomGuestMode, editCustomerName, selectedCustomerObj]);

  // Helper to determine if sale was a historical past entry vs real-time sale
  const isHistoricalSale = (sale: Sale): boolean => {
    if (sale.isHistorical) return true;
    if (sale.id.startsWith('sale-imp-')) return true;
    if (sale.notes && (sale.notes.includes('Historical') || sale.notes.includes('Past Entry') || sale.notes.includes('Import Wizard'))) {
      return true;
    }
    return false;
  };

  // Super-Admin can edit ALL sales records. Regular Admins can edit historical sales records.
  const canEditSale = (sale: Sale): boolean => {
    if (isSuperAdmin) return true;
    if (currentUser?.role === 'Administrator' || currentUser?.role === 'Admin') {
      return isHistoricalSale(sale);
    }
    return false;
  };

  const handleOpenEditSale = (sale: Sale) => {
    if (!canEditSale(sale)) {
      return;
    }
    setEditSaleTarget(sale);
    setEditingSaleItems(sale.items.map((item) => ({ ...item })));
    setEditCustomerId(sale.customerId);
    setEditCustomerName(sale.customerName || 'Walk-in Customer');
    setCustomerSearchQuery('');
    setIsCustomerDropdownOpen(false);
    setIsCustomGuestMode(!sale.customerId && isGuestCustomerName(sale.customerName));
    setEditType(sale.type || 'Retail');
    setEditPaymentMethod(sale.paymentMethod || 'Card');
    setEditStatus(sale.status || 'Completed');
    setEditCreatedBy(sale.createdBy || 'Administrator');
    const transactionDate = sale.createdAt ? new Date(sale.createdAt) : new Date();
    setEditCreatedAt(new Date(transactionDate.getTime() - transactionDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    setEditNotes(sale.notes || '');
    setEditDiscount(sale.discount || 0);
    setEditTax(sale.tax || 0);
    setEditDeliveryFee(sale.deliveryFee || 0);
    setEditPaidAmount(sale.paidAmount !== undefined ? sale.paidAmount : (sale.totalAmount || 0));
    setSelectedAddProductId('');
    setShowEditAddClearance(false);
    setEditClearanceName('Clearance Sale Item');
    setEditClearanceAmount('');
    setEditClearanceQty('1');
    setEditClearanceNotes('');
  };

  const handleSaveSaleEdit = () => {
    if (!editSaleTarget) return;

    const itemsSubtotal = editingSaleItems.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);
    const calculatedTotal = Math.max(0, itemsSubtotal - editDiscount + editTax + editDeliveryFee);
    const sanitizedPaidAmount = Math.max(0, isNaN(editPaidAmount) ? 0 : editPaidAmount);

    const finalCustomerId = isCustomGuestMode ? undefined : editCustomerId;
    const finalCustomerName = isCustomGuestMode
      ? (editCustomerName.trim() || 'Walk-in Customer')
      : (editCustomerId ? (customers.find(c => c.id === editCustomerId)?.name || editCustomerName) : (editCustomerName.trim() || 'Walk-in Customer'));

    updateSale(
      editSaleTarget.id,
      {
        customerId: finalCustomerId,
        customerName: finalCustomerName,
        type: editType,
        paymentMethod: editPaymentMethod,
        status: editStatus,
        createdBy: editCreatedBy,
        createdAt: (() => {
          if (!editSaleTarget.createdAt) return new Date(editCreatedAt).toISOString();
          const original = new Date(editSaleTarget.createdAt);
          const originalInput = new Date(original.getTime() - original.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
          return editCreatedAt === originalInput ? editSaleTarget.createdAt : new Date(editCreatedAt).toISOString();
        })(),
        notes: editNotes,
        items: editingSaleItems,
        subtotal: itemsSubtotal,
        discount: editDiscount,
        tax: editTax,
        deliveryFee: editDeliveryFee,
        totalAmount: calculatedTotal,
        paidAmount: sanitizedPaidAmount,
      },
      currentUser?.displayName || (isSuperAdmin ? 'Super-Admin' : 'Administrator'),
      isSuperAdmin
    );

    setEditSaleTarget(null);
  };

  // Helper to extract YYYY-MM-DD from timestamp string
  const getLocalDateString = (isoString: string) => {
    try {
      const d = new Date(isoString);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    } catch (e) {
      return '';
    }
  };

  // Group sales by date string
  const salesByDate = useMemo(() => {
    const map = new Map<string, Sale[]>();
    sales.forEach((s) => {
      const dateKey = getLocalDateString(s.createdAt);
      if (dateKey) {
        if (!map.has(dateKey)) {
          map.set(dateKey, []);
        }
        map.get(dateKey)!.push(s);
      }
    });
    return map;
  }, [sales]);

  // Generate calendar grid for currentMonth
  const calendarGrid = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const startDayOfWeek = firstDay.getDay(); // 0 (Sun) - 6 (Sat)
    const daysInMonth = lastDay.getDate();

    const grid: Array<{
      dateString: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      salesCount: number;
      totalRevenue: number;
    }> = [];

    // Prev month padding
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const pDay = prevMonthLastDay - i;
      const prevDate = new Date(year, month - 1, pDay);
      const dateStr = getLocalDateString(prevDate.toISOString());
      const daySales = salesByDate.get(dateStr) || [];
      const totalRevenue = daySales.filter(s => s.status !== 'Refunded').reduce((acc, s) => acc + s.totalAmount, 0);
      grid.push({
        dateString: dateStr,
        dayNumber: pDay,
        isCurrentMonth: false,
        salesCount: daySales.length,
        totalRevenue,
      });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const dateStr = getLocalDateString(dateObj.toISOString());
      const daySales = salesByDate.get(dateStr) || [];
      const totalRevenue = daySales.filter(s => s.status !== 'Refunded').reduce((acc, s) => acc + s.totalAmount, 0);
      grid.push({
        dateString: dateStr,
        dayNumber: d,
        isCurrentMonth: true,
        salesCount: daySales.length,
        totalRevenue,
      });
    }

    return grid;
  }, [currentMonth, salesByDate]);

  // Sales for the selected date
  const selectedDaySales = useMemo(() => {
    const daySales = salesByDate.get(selectedDateString) || [];
    return [...daySales].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [salesByDate, selectedDateString]);

  // Selected Day Aggregated KPI Metrics
  const selectedDayStats = useMemo(() => {
    const activeSales = selectedDaySales.filter((s) => s.status !== 'Refunded');
    const totalRevenue = activeSales.reduce((acc, s) => acc + s.totalAmount, 0);
    const totalPaid = activeSales.reduce((acc, s) => acc + (s.paidAmount || 0), 0);
    const totalItems = activeSales.reduce((acc, s) => acc + s.items.reduce((sum, item) => sum + item.quantity, 0), 0);
    const refundedCount = selectedDaySales.filter((s) => s.status === 'Refunded').length;

    // Helper to calculate payment method contributions for the day (including split breakdown)
    let cashTotal = 0;
    let mobileTransferTotal = 0;
    let cashTxCount = 0;
    let mobileTransferTxCount = 0;

    activeSales.forEach((s) => {
      const paid = s.paidAmount !== undefined ? s.paidAmount : s.totalAmount;
      if (s.paymentMethod === 'Cash') {
        cashTotal += paid;
        cashTxCount += 1;
      } else if (s.paymentMethod === 'Mobile Transfer') {
        mobileTransferTotal += paid;
        mobileTransferTxCount += 1;
      } else if (s.paymentMethod === 'Split') {
        // Trust the structured breakdown the till wrote at checkout; it is the
        // authoritative record and round-trips through relational storage. Only
        // legacy sales without it fall back to parsing the free-text note.
        const breakdown = s.paymentBreakdown;
        if (breakdown && Object.keys(breakdown).length > 0) {
          const cash = Number(breakdown.Cash) || 0;
          if (cash > 0) {
            cashTotal += cash;
            cashTxCount += 1;
          }
          const transfer = Number(breakdown['Mobile Transfer']) || 0;
          if (transfer > 0) {
            mobileTransferTotal += transfer;
            mobileTransferTxCount += 1;
          }
        } else if (s.notes) {
          const cashMatch = s.notes.match(/Cash:\s*[^0-9]*([\d,]+(\.\d+)?)/i);
          if (cashMatch && cashMatch[1]) {
            const val = parseFloat(cashMatch[1].replace(/,/g, ''));
            if (!isNaN(val)) {
              cashTotal += val;
              cashTxCount += 1;
            }
          }
          const transferMatch = s.notes.match(/Mobile Transfer:\s*[^0-9]*([\d,]+(\.\d+)?)/i);
          if (transferMatch && transferMatch[1]) {
            const val = parseFloat(transferMatch[1].replace(/,/g, ''));
            if (!isNaN(val)) {
              mobileTransferTotal += val;
              mobileTransferTxCount += 1;
            }
          }
        }
      }
    });

    return {
      totalRevenue,
      totalPaid,
      totalCount: selectedDaySales.length,
      activeCount: activeSales.length,
      totalItems,
      refundedCount,
      cashTotal,
      mobileTransferTotal,
      cashTxCount,
      mobileTransferTxCount,
    };
  }, [selectedDaySales]);

  // Filter Sales
  const filteredSales = useMemo(() => {
    const matchingSales = sales.filter((s) => {
      if (!s) return false;
      // Text Search
      const searchLower = (searchQuery || '').toLowerCase();
      const matchesSearch =
        (s.invoiceNo || '').toLowerCase().includes(searchLower) ||
        (s.customerName || '').toLowerCase().includes(searchLower) ||
        (s.createdBy || '').toLowerCase().includes(searchLower) ||
        (s.notes && s.notes.toLowerCase().includes(searchLower)) ||
        (s.items || []).some((i) => (i.productName || '').toLowerCase().includes(searchLower));

      if (!matchesSearch) return false;

      // Payment method
      if (selectedPaymentMethod !== 'All' && s.paymentMethod !== selectedPaymentMethod) {
        return false;
      }

      // Type (Retail vs Wholesale)
      if (selectedType !== 'All' && s.type !== selectedType) {
        return false;
      }

      // Status (Completed vs Refunded)
      if (selectedStatus !== 'All' && s.status !== selectedStatus) {
        return false;
      }

      // Date Range Filter
      const saleDate = new Date(s.createdAt);
      const now = new Date();

      if (datePreset === 'Today') {
        const today = new Date();
        if (
          saleDate.getDate() !== today.getDate() ||
          saleDate.getMonth() !== today.getMonth() ||
          saleDate.getFullYear() !== today.getFullYear()
        ) {
          return false;
        }
      } else if (datePreset === 'Yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (
          saleDate.getDate() !== yesterday.getDate() ||
          saleDate.getMonth() !== yesterday.getMonth() ||
          saleDate.getFullYear() !== yesterday.getFullYear()
        ) {
          return false;
        }
      } else if (datePreset === 'Last 7 Days') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        if (saleDate < sevenDaysAgo) return false;
      } else if (datePreset === 'This Month') {
        if (
          saleDate.getMonth() !== now.getMonth() ||
          saleDate.getFullYear() !== now.getFullYear()
        ) {
          return false;
        }
      } else if (datePreset === 'Custom') {
        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          if (saleDate < start) return false;
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          if (saleDate > end) return false;
        }
      }

      return true;
    });

    return matchingSales.sort((a, b) => {
      const aTime = Date.parse(a.createdAt);
      const bTime = Date.parse(b.createdAt);
      const timestampOrder = (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      if (timestampOrder !== 0) return timestampOrder;
      return String(b.id).localeCompare(String(a.id), undefined, {numeric: true});
    });
  }, [sales, searchQuery, selectedPaymentMethod, selectedType, selectedStatus, datePreset, startDate, endDate]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset page when filter/search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedPaymentMethod, selectedType, selectedStatus, datePreset, startDate, endDate]);

  const totalPages = Math.ceil(filteredSales.length / pageSize) || 1;
  const paginatedSales = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSales.slice(start, start + pageSize);
  }, [filteredSales, currentPage, pageSize]);

  // Aggregate KPI metrics
  const stats = useMemo(() => {
    const totalVolume = filteredSales
      .filter((s) => s.status !== 'Refunded')
      .reduce((acc, s) => acc + s.totalAmount, 0);

    const totalPaid = filteredSales
      .filter((s) => s.status !== 'Refunded')
      .reduce((acc, s) => acc + (s.paidAmount || 0), 0);

    const totalUnpaidDebt = Math.max(0, totalVolume - totalPaid);

    const totalItems = filteredSales
      .filter((s) => s.status !== 'Refunded')
      .reduce((acc, s) => acc + s.items.reduce((sum, item) => sum + item.quantity, 0), 0);

    const avgOrderValue = filteredSales.length > 0 ? totalVolume / filteredSales.length : 0;

    return {
      totalVolume,
      totalCount: filteredSales.length,
      avgOrderValue,
      totalItems,
      totalUnpaidDebt,
    };
  }, [filteredSales]);

  // Export CSV function
  const handleExportCSV = () => {
    if (filteredSales.length === 0) return;

    const headers = [
      'Invoice No',
      'Date & Time',
      'Customer',
      'Sale Type',
      'Items Count',
      'Subtotal',
      'Discount',
      'Tax',
      'Total Amount',
      'Paid Amount',
      'Payment Method',
      'Status',
      'Created By',
      'Notes',
    ];

    // Every text field is quoted and internal quotes doubled — only notes were
    // escaped before, so a customer name containing a quote corrupted the row.
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = filteredSales.map((s) => [
      cell(s.invoiceNo),
      cell(new Date(s.createdAt).toLocaleString()),
      cell(s.customerName),
      cell(s.type),
      (s.items || []).length,
      (Number(s.subtotal) || 0).toFixed(2),
      (Number(s.discount) || 0).toFixed(2),
      (Number(s.tax) || 0).toFixed(2),
      (Number(s.totalAmount) || 0).toFixed(2),
      (Number(s.paidAmount) || 0).toFixed(2),
      cell(s.paymentMethod),
      cell(s.status),
      cell(s.createdBy),
      cell(s.notes),
    ]);

    // Blob URL instead of an encodeURI'd data: URI: '#' or '%' in any field
    // truncated or mangled the download.
    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const encodedUri = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Sales_Records_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(encodedUri);
  };

  const getPaymentIcon = (method: PaymentMethod) => {
    switch (method) {
      case 'Card':
        return <CreditCard className="w-3.5 h-3.5 text-blue-500" />;
      case 'Cash':
        return <Banknote className="w-3.5 h-3.5 text-emerald-500" />;
      case 'Mobile Transfer':
        return <Smartphone className="w-3.5 h-3.5 text-amber-500" />;
      case 'Bank Transfer':
        return <Building className="w-3.5 h-3.5 text-purple-500" />;
      case 'Store Credit':
        return <Tag className="w-3.5 h-3.5 text-indigo-500" />;
      case 'Split':
        return <Layers className="w-3.5 h-3.5 text-rose-500" />;
      default:
        return <NairaSign className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* View Mode Switcher, Date Quick Picker & Quick Actions */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('calendar')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'calendar'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <CalendarDays className="w-4 h-4" />
            <span>Daily Calendar History</span>
          </button>

          <button
            onClick={() => setActiveTab('list')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'list'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ListFilter className="w-4 h-4" />
            <span>All Sales Records Table</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5">
          {activeTab === 'calendar' && (
            <div className="flex items-center gap-2 px-1">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 hidden sm:inline">
                Date:
              </span>
              <input
                type="date"
                value={selectedDateString}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedDateString(e.target.value);
                    const parsed = new Date(e.target.value + 'T00:00:00');
                    if (!isNaN(parsed.getTime())) {
                      setCurrentMonth(parsed);
                    }
                  }
                }}
                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white cursor-pointer focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {currentUser?.role !== 'Sales Staff' && (
            <button
              onClick={handleExportCSV}
              disabled={filteredSales.length === 0}
              className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1.5 border border-slate-200/80 dark:border-slate-700/80 cursor-pointer"
              title="Export filtered sales to CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Export CSV</span>
            </button>
          )}

          {onNavigate && (
            <button
              onClick={() => onNavigate('pos')}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm shadow-blue-500/20 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Open POS</span>
            </button>
          )}
        </div>
      </div>

      {/* DAILY CALENDAR HISTORY VIEW */}
      {activeTab === 'calendar' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Daily Payment Breakdown Info Tab (Cash & Mobile Transfer for the selected day) */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-2xl">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                      Daily Payment Methods Info
                    </span>
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      • {new Date(selectedDateString + 'T00:00:00').toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight mt-0.5">
                    Cash & Mobile Transfer Summary for {selectedDateString}
                  </h3>
                </div>
              </div>

              {/* Total Day Revenue Summary Chip */}
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 px-3.5 py-2 rounded-2xl border border-slate-200/80 dark:border-slate-700">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  Total Day Volume:
                </span>
                <span className="text-sm font-black text-slate-900 dark:text-white font-mono">
                  {settings.currencySymbol}
                  {selectedDayStats.totalRevenue.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>

            {/* Cash vs Mobile Transfer Grid Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              {/* 1. Cash Transactions Total */}
              <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between transition-all hover:shadow-xs">
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-emerald-500 text-white rounded-2xl shadow-xs shadow-emerald-500/30">
                    <Banknote className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold uppercase text-emerald-800 dark:text-emerald-300 tracking-wider">
                        Cash Transactions
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200/80 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200">
                        {selectedDayStats.cashTxCount} {selectedDayStats.cashTxCount === 1 ? 'sale' : 'sales'}
                      </span>
                    </div>
                    <p className="text-2xl font-black text-emerald-950 dark:text-emerald-100 font-mono mt-1">
                      {settings.currencySymbol}
                      {selectedDayStats.cashTotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    <p className="text-[11px] text-emerald-700/90 dark:text-emerald-400/90 font-medium mt-0.5">
                      Physical cash tendered and collected at register
                    </p>
                  </div>
                </div>
              </div>

              {/* 2. Mobile Transfers Total */}
              <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-center justify-between transition-all hover:shadow-xs">
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-amber-500 text-white rounded-2xl shadow-xs shadow-amber-500/30">
                    <Smartphone className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold uppercase text-amber-800 dark:text-amber-300 tracking-wider">
                        Mobile Transfers
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-200">
                        {selectedDayStats.mobileTransferTxCount} {selectedDayStats.mobileTransferTxCount === 1 ? 'transfer' : 'transfers'}
                      </span>
                    </div>
                    <p className="text-2xl font-black text-amber-950 dark:text-amber-100 font-mono mt-1">
                      {settings.currencySymbol}
                      {selectedDayStats.mobileTransferTotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 font-medium mt-0.5">
                      Direct digital mobile / bank app transfers received
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Monthly Calendar View (7 Cols) */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              {/* Calendar Month Navigation Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2.5 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-2xl">
                    <CalendarDays className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                      {currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                      Select any date tile below to inspect detailed daily transactions & sales breakdown
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      const prev = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
                      setCurrentMonth(prev);
                    }}
                    className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                    title="Previous Month"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => {
                      const today = new Date();
                      setCurrentMonth(today);
                      setSelectedDateString(getLocalDateString(today.toISOString()));
                    }}
                    className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 text-blue-600 dark:text-blue-400 font-extrabold text-xs rounded-xl transition-colors cursor-pointer"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => {
                      const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
                      setCurrentMonth(next);
                    }}
                    className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                    title="Next Month"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Day of Week Header */}
              <div className="grid grid-cols-7 gap-1 text-center font-bold text-[11px] text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100 dark:border-slate-800">
                <div>Sun</div>
                <div>Mon</div>
                <div>Tue</div>
                <div>Wed</div>
                <div>Thu</div>
                <div>Fri</div>
                <div>Sat</div>
              </div>

              {/* Calendar Days Grid */}
              <div className="grid grid-cols-7 gap-1.5">
                {calendarGrid.map((dayItem, idx) => {
                  const isSelected = dayItem.dateString === selectedDateString;
                  const isToday = dayItem.dateString === getLocalDateString(new Date().toISOString());
                  const hasSales = dayItem.salesCount > 0;

                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDateString(dayItem.dateString)}
                      className={`min-h-[72px] p-2 rounded-2xl border text-left flex flex-col justify-between transition-all cursor-pointer relative ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-400 z-10'
                          : isToday
                          ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-slate-900 dark:text-white'
                          : dayItem.isCurrentMonth
                          ? 'bg-slate-50/50 dark:bg-slate-800/40 border-slate-200/60 dark:border-slate-800 text-slate-900 dark:text-white hover:border-slate-300 dark:hover:border-slate-700'
                          : 'bg-slate-100/30 dark:bg-slate-900/40 border-transparent text-slate-400 dark:text-slate-600 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span
                          className={`text-xs font-black ${
                            isSelected
                              ? 'text-white'
                              : isToday
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {dayItem.dayNumber}
                        </span>
                        {isToday && (
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              isSelected
                                ? 'bg-white/20 text-white'
                                : 'bg-blue-200 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                            }`}
                          >
                            Today
                          </span>
                        )}
                      </div>

                      {hasSales ? (
                        <div className="space-y-0.5 mt-1">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded-md text-[9px] font-extrabold ${
                              isSelected
                                ? 'bg-emerald-400 text-slate-950'
                                : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-900/60'
                            }`}
                          >
                            {dayItem.salesCount} {dayItem.salesCount === 1 ? 'sale' : 'sales'}
                          </span>
                          <p
                            className={`text-[10px] font-black truncate ${
                              isSelected ? 'text-blue-100' : 'text-slate-900 dark:text-slate-200'
                            }`}
                          >
                            {settings.currencySymbol}
                            {dayItem.totalRevenue >= 1000
                              ? `${(dayItem.totalRevenue / 1000).toFixed(1)}k`
                              : dayItem.totalRevenue.toLocaleString()}
                          </p>
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-400 dark:text-slate-600 italic">No sales</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected Date Activity & Daily History Panel (5 Cols) */}
            <div className="lg:col-span-5 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
              {/* Header with Prev/Next Day Quick Arrows */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-2xl">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight">
                      Daily Sales Activity Log
                    </h3>
                    <p className="text-xs font-black text-blue-600 dark:text-blue-400 mt-0.5">
                      {new Date(selectedDateString + 'T00:00:00').toLocaleDateString(undefined, {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const curr = new Date(selectedDateString + 'T00:00:00');
                      curr.setDate(curr.getDate() - 1);
                      const str = getLocalDateString(curr.toISOString());
                      setSelectedDateString(str);
                      if (curr.getMonth() !== currentMonth.getMonth()) setCurrentMonth(curr);
                    }}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                    title="Previous Day"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      const curr = new Date(selectedDateString + 'T00:00:00');
                      curr.setDate(curr.getDate() + 1);
                      const str = getLocalDateString(curr.toISOString());
                      setSelectedDateString(str);
                      if (curr.getMonth() !== currentMonth.getMonth()) setCurrentMonth(curr);
                    }}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                    title="Next Day"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Selected Day KPI Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 rounded-2xl space-y-1">
                  <span className="text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 uppercase">
                    Daily Revenue
                  </span>
                  <p className="text-lg font-black text-slate-900 dark:text-white">
                    {settings.currencySymbol}
                    {selectedDayStats.totalRevenue.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>

                <div className="p-3 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 rounded-2xl space-y-1">
                  <span className="text-[10px] font-extrabold text-blue-700 dark:text-blue-300 uppercase">
                    Checkouts
                  </span>
                  <p className="text-lg font-black text-slate-900 dark:text-white">
                    {selectedDayStats.totalCount} <span className="text-xs font-semibold text-slate-400">invoices</span>
                  </p>
                </div>

                <div className="p-3 bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-900/40 rounded-2xl space-y-1">
                  <span className="text-[10px] font-extrabold text-indigo-700 dark:text-indigo-300 uppercase">
                    Items Sold
                  </span>
                  <p className="text-lg font-black text-slate-900 dark:text-white">
                    {selectedDayStats.totalItems} <span className="text-xs font-semibold text-slate-400">units</span>
                  </p>
                </div>

                <div className="p-3 bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/40 rounded-2xl space-y-1">
                  <span className="text-[10px] font-extrabold text-purple-700 dark:text-purple-300 uppercase">
                    Total Collected
                  </span>
                  <p className="text-lg font-black text-slate-900 dark:text-white">
                    {settings.currencySymbol}
                    {selectedDayStats.totalPaid.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>
              </div>

              {/* Day Sales Timeline Feed */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Transactions on {selectedDateString} ({selectedDaySales.length})
                </h4>

                {selectedDaySales.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 rounded-3xl space-y-2">
                    <CalendarDays className="w-8 h-8 mx-auto text-slate-400" />
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      No sales activity recorded for this day
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Select another calendar day above or switch to POS register to complete sales.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                    {selectedDaySales.map((s) => {
                      const isRefunded = s.status === 'Refunded';
                      const timeString = new Date(s.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      });

                      return (
                        <div
                          key={s.id}
                          className={`p-4 rounded-2xl border transition-all space-y-2.5 ${
                            isRefunded
                              ? 'bg-rose-50/50 dark:bg-rose-950/10 border-rose-200 dark:border-rose-900/30'
                              : 'bg-slate-50/60 dark:bg-slate-800/60 border-slate-200/70 dark:border-slate-700/70 hover:border-blue-300 dark:hover:border-blue-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-extrabold font-mono text-blue-600 dark:text-blue-400">
                                {s.invoiceNo}
                              </span>
                              <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {timeString}
                              </span>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                isRefunded
                                  ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300'
                                  : 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {s.status}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-xs">
                            <div>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {s.customerName}
                              </span>
                              <span className="text-[11px] text-slate-500 block">
                                Served By: {s.createdBy} ({s.type})
                                {s.orderTakenBy && s.orderTakenBy !== s.createdBy && ` • Order Taker: ${s.orderTakenBy}`}
                              </span>
                            </div>

                            <div className="text-right">
                              <p className="font-black text-slate-900 dark:text-white text-sm">
                                {settings.currencySymbol}
                                {s.totalAmount.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </p>
                              <div className="flex items-center justify-end gap-1 text-[10px] font-semibold text-slate-500">
                                {getPaymentIcon(s.paymentMethod)}
                                <span>{s.paymentMethod}</span>
                              </div>
                            </div>
                          </div>

                          {/* Items summary */}
                          <div className="p-2 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-1 text-[11px]">
                            {s.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between text-slate-600 dark:text-slate-300">
                                <span className="flex items-center gap-1.5 flex-wrap">
                                  <span>{item.quantity}x {item.productName}</span>
                                  {item.isClearance && (
                                    <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                                      Clearance
                                    </span>
                                  )}
                                </span>
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {settings.currencySymbol}
                                  {(item.total || item.unitPrice * item.quantity).toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2 pt-2 border-t border-slate-200/40 dark:border-slate-800">
                            <button
                              onClick={() => setSelectedReceiptSale(s)}
                              className="flex-1 min-w-0 px-3 py-2 bg-slate-200/70 dark:bg-slate-700 hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-200 font-bold text-[10px] rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                              <span>View Receipt</span>
                            </button>

                            <details className="relative flex-1 min-w-0 group">
                              <summary className="list-none px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[10px] rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap [&::-webkit-details-marker]:hidden">
                                <MoreHorizontal className="w-3.5 h-3.5" />
                                <span>More Actions</span>
                              </summary>
                              <div className="absolute right-0 top-full mt-2 z-20 w-52 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl space-y-1">
                                {isSuperAdmin && (
                                  <button
                                    onClick={() => setWorkshopSale(s)}
                                    className="w-full px-3 py-2 text-left bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-950 text-indigo-800 dark:text-indigo-200 font-bold text-[10px] rounded-lg flex items-center gap-2"
                                  >
                                    <Sliders className="w-3.5 h-3.5" /> Invoice Workshop
                                  </button>
                                )}
                                {!isRefunded && (hasPermission('sales.refund') || currentUser?.role === 'Manager') && (
                                  <button
                                    onClick={() => setRefundSaleTarget(s)}
                                    className="w-full px-3 py-2 text-left hover:bg-amber-50 dark:hover:bg-amber-950/50 text-amber-800 dark:text-amber-200 font-bold text-[10px] rounded-lg flex items-center gap-2"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" /> Refund
                                  </button>
                                )}
                                {canEditSale(s) ? (
                                  <button
                                    onClick={() => handleOpenEditSale(s)}
                                    className="w-full px-3 py-2 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 font-bold text-[10px] rounded-lg flex items-center gap-2"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" /> {isSuperAdmin ? 'Edit Record' : 'Edit Prices'}
                                  </button>
                                ) : (
                                  (currentUser?.role === 'Administrator' || currentUser?.role === 'Admin') && (
                                    <button disabled className="w-full px-3 py-2 text-left text-slate-400 dark:text-slate-600 font-bold text-[10px] rounded-lg flex items-center gap-2 cursor-not-allowed">
                                      <Edit3 className="w-3.5 h-3.5" /> Edit Disabled
                                    </button>
                                  )
                                )}
                                {(currentUser?.role === 'Administrator' || currentUser?.role === 'Admin') && (
                                  <button
                                    onClick={() => setDeleteSaleTarget(s)}
                                    className="w-full px-3 py-2 text-left hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-bold text-[10px] rounded-lg flex items-center gap-2"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" /> Delete
                                  </button>
                                )}
                              </div>
                            </details>
                          </div>

                          <div className="hidden items-center justify-end gap-2 pt-1 border-t border-slate-200/40 dark:border-slate-800">
                            <button
                              onClick={() => setSelectedReceiptSale(s)}
                              className="px-2.5 py-1 bg-slate-200/70 dark:bg-slate-700 hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-200 font-bold text-[10px] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Receipt className="w-3 h-3" />
                              <span>View Receipt</span>
                            </button>

                            {isSuperAdmin && (
                              <button
                                onClick={() => setWorkshopSale(s)}
                                className="px-2.5 py-1 bg-indigo-100 dark:bg-indigo-950 hover:bg-indigo-600 hover:text-white text-indigo-800 dark:text-indigo-200 font-bold text-[10px] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                title="Open a temporary print-only copy of this invoice"
                              >
                                <Sliders className="w-3 h-3" />
                                <span>Invoice Workshop</span>
                              </button>
                            )}

                            {!isRefunded && (hasPermission('sales.refund') || currentUser?.role === 'Manager') && (
                              <button
                                onClick={() => setRefundSaleTarget(s)}
                                className="px-2.5 py-1 bg-amber-100 dark:bg-amber-950 hover:bg-amber-600 hover:text-white text-amber-800 dark:text-amber-200 font-bold text-[10px] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Refund</span>
                              </button>
                            )}

                            {canEditSale(s) ? (
                              <button
                                onClick={() => handleOpenEditSale(s)}
                                className="px-2.5 py-1 bg-indigo-100 dark:bg-indigo-950 hover:bg-indigo-600 hover:text-white text-indigo-800 dark:text-indigo-200 font-bold text-[10px] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                title={
                                  isSuperAdmin
                                    ? 'Super-Admin Edit Mode: Edit full sale record details, items & prices'
                                    : 'Edit Cost & Retail Prices (Past Entry)'
                                }
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>{isSuperAdmin ? 'Edit Record' : 'Edit Prices'}</span>
                              </button>
                            ) : (
                              (currentUser?.role === 'Administrator' || currentUser?.role === 'Admin') && (
                                <button
                                  disabled
                                  className="px-2.5 py-1 font-bold text-[10px] rounded-lg transition-colors flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50"
                                  title="Editing real-time sales records is restricted to Super-Admins"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>Edit Disabled</span>
                                </button>
                              )
                            )}

                            {(currentUser?.role === 'Administrator' || currentUser?.role === 'Admin') && (
                              <button
                                onClick={() => setDeleteSaleTarget(s)}
                                className="px-2.5 py-1 bg-rose-100 dark:bg-rose-950 hover:bg-rose-600 hover:text-white text-rose-800 dark:text-rose-200 font-bold text-[10px] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ALL SALES RECORDS TABLE VIEW */}
      {activeTab === 'list' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* KPI Stats Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-wider">Total Sales Revenue</span>
                <div className="p-2 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl">
                  <NairaSign className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {settings.currencySymbol}{stats.totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <span className="text-[11px] font-semibold text-slate-500">
                From {stats.totalCount} transaction records
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-wider">Total Items Sold</span>
                <div className="p-2 bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-xl">
                  <ShoppingBag className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {stats.totalItems.toLocaleString()} <span className="text-sm font-normal text-slate-400">units</span>
              </p>
              <span className="text-[11px] font-semibold text-slate-500">
                Across all active completed sales
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-wider">Avg Order Value</span>
                <div className="p-2 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
                  <Receipt className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {settings.currencySymbol}{stats.avgOrderValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <span className="text-[11px] font-semibold text-slate-500">
                Average ticket per checkout
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-wider">Outstanding Debt</span>
                <div className="p-2 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-xl">
                  <AlertCircle className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-amber-600 dark:text-amber-400">
                {settings.currencySymbol}{stats.totalUnpaidDebt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <span className="text-[11px] font-semibold text-slate-500">
                Uncollected balance on sales
              </span>
            </div>
          </div>

      {/* Filters & Search Toolbar */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by invoice number, customer, cashier, product or note..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Date Filter Presets */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            {['All Time', 'Today', 'Yesterday', 'Last 7 Days', 'This Month', 'Custom'].map((preset) => (
              <button
                key={preset}
                onClick={() => setDatePreset(preset)}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  datePreset === preset
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Pickers & Dropdown Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          {datePreset === 'Custom' && (
            <div className="col-span-1 sm:col-span-2 flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-1/2 p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-slate-900 dark:text-white"
              />
              <span className="text-slate-400 font-bold">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-1/2 p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-slate-900 dark:text-white"
              />
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Payment Method
            </label>
            <select
              value={selectedPaymentMethod}
              onChange={(e) => setSelectedPaymentMethod(e.target.value)}
              className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-slate-900 dark:text-white"
            >
              <option value="All">All Payment Methods</option>
              <option value="Cash">Cash</option>
              <option value="Card">Card</option>
              <option value="Mobile Transfer">Mobile Transfer</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Store Credit">Store Credit</option>
              <option value="Split">Split Payment</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Sale Type
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-slate-900 dark:text-white"
            >
              <option value="All">All Sale Types</option>
              <option value="Retail">Retail Sale</option>
              <option value="Wholesale">Wholesale Bulk</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Status
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-slate-900 dark:text-white"
            >
              <option value="All">All Statuses</option>
              <option value="Completed">Completed</option>
              <option value="Refunded">Refunded</option>
            </select>
          </div>
        </div>
      </div>

      {/* Sales Records Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-sm text-slate-900 dark:text-white">Sales Records</span>
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-extrabold text-[11px] rounded-lg">
              {filteredSales.length} Transactions
            </span>
          </div>

          {(searchQuery || selectedPaymentMethod !== 'All' || selectedType !== 'All' || selectedStatus !== 'All' || datePreset !== 'All Time') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedPaymentMethod('All');
                setSelectedType('All');
                setSelectedStatus('All');
                setDatePreset('All Time');
                setStartDate('');
                setEndDate('');
              }}
              className="text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 text-[10px]">
              <tr>
                <th className="px-4 py-3">Invoice & Timestamp</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Items Summary</th>
                <th className="px-4 py-3">Total Amount</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <ShoppingBag className="w-10 h-10 stroke-1 text-slate-300 dark:text-slate-600" />
                      <p className="font-bold text-sm text-slate-600 dark:text-slate-400">No Sales Records Found</p>
                      <p className="text-xs text-slate-400 max-w-xs">
                        Try adjusting your search query, date filter, or payment parameters above.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedSales.map((sale) => {
                  const itemsCount = sale.items.reduce((sum, i) => sum + i.quantity, 0);
                  const isRefunded = sale.status === 'Refunded';

                  return (
                    <tr
                      key={sale.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group"
                    >
                      {/* Invoice No & Timestamp */}
                      <td className="px-4 py-3.5">
                        <div className="font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>{sale.invoiceNo && sale.invoiceNo !== 'N/A' ? sale.invoiceNo : 'N/A'}</span>
                          {isHistoricalSale(sale) ? (
                            <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 text-[9px] font-black rounded" title={sale.notes || 'Historical Past Entry (No Invoice)'}>
                              Past Entry (No Invoice)
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 text-[9px] font-bold rounded border border-emerald-200/50 dark:border-emerald-800/50" title="Live Real-time POS Checkout">
                              Real-time
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(sale.createdAt).toLocaleString()}</span>
                        </div>
                      </td>

                      {/* Customer */}
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {sale.customerName}
                        </div>
                        <span className="text-[10px] text-slate-400">By: {sale.createdBy}</span>
                      </td>

                      {/* Sale Type */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                            sale.type === 'Wholesale'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {sale.type}
                        </span>
                      </td>

                      {/* Items Summary */}
                      <td className="px-4 py-3.5 max-w-xs">
                        <div className="font-bold text-slate-800 dark:text-slate-200 line-clamp-1">
                          {sale.items.map((i) => `${i.productName} (${i.quantity})`).join(', ')}
                        </div>
                        <span className="text-[10px] text-slate-400 font-semibold">
                          {itemsCount} {itemsCount === 1 ? 'unit' : 'units'} across {sale.items.length} line items
                        </span>
                      </td>

                      {/* Total Amount */}
                      <td className="px-4 py-3.5">
                        <div className={`font-black text-sm ${isRefunded ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}>
                          {settings.currencySymbol}{(Number(sale.totalAmount) || 0).toFixed(2)}
                        </div>
                        {sale.discount > 0 && (
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                            Disc: -{settings.currencySymbol}{(Number(sale.discount) || 0).toFixed(2)}
                          </div>
                        )}
                      </td>

                      {/* Payment Method */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          {getPaymentIcon(sale.paymentMethod)}
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {sale.paymentMethod}
                          </span>
                        </div>
                        {Number(sale.paidAmount || 0) < Number(sale.totalAmount || 0) && !isRefunded && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 font-bold mt-0.5">
                            Unpaid: {settings.currencySymbol}{(Number(sale.totalAmount || 0) - Number(sale.paidAmount || 0)).toFixed(2)}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-black inline-flex items-center gap-1 ${
                            isRefunded
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {isRefunded ? (
                            <>
                              <RotateCcw className="w-3 h-3" />
                              <span>Refunded</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Completed</span>
                            </>
                          )}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedReceiptSale(sale)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-xl transition-colors"
                            title="View / Print Receipt"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          {isSuperAdmin && (
                            <button
                              onClick={() => setWorkshopSale(sale)}
                              className="p-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 rounded-xl transition-colors"
                              title="Invoice Workshop (temporary print-only edits)"
                            >
                              <Sliders className="w-4 h-4" />
                            </button>
                          )}

                          {hasPermission(['Administrator', 'Accountant']) && !isRefunded && (
                            <button
                              onClick={() => setRefundSaleTarget(sale)}
                              className="p-1.5 text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/60 rounded-xl transition-colors"
                              title="Process Refund & Restock Items"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}

                          {canEditSale(sale) ? (
                            <button
                              onClick={() => handleOpenEditSale(sale)}
                              className="p-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 rounded-xl transition-colors cursor-pointer"
                              title={
                                isSuperAdmin
                                  ? 'Super-Admin Edit Mode: Edit full sale record details, items & prices'
                                  : 'Edit Cost & Retail Prices (Past Entry)'
                              }
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          ) : (
                            (currentUser?.role === 'Administrator' || currentUser?.role === 'Admin') && (
                              <button
                                disabled
                                className="p-1.5 text-slate-300 dark:text-slate-700 cursor-not-allowed opacity-40 rounded-xl"
                                title="Editing real-time sales records is restricted to Super-Admins"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                            )
                          )}

                          {(currentUser?.role === 'Administrator' || currentUser?.role === 'Admin') && (
                            <button
                              onClick={() => setDeleteSaleTarget(sale)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded-xl transition-colors"
                              title="Delete Record (Admin)"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={filteredSales.length}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          itemLabel="sales records"
        />
      </div>
      </div>
      )}

      {/* Printable Receipt Modal */}
      {selectedReceiptSale && (
        <ReceiptModal
          sale={selectedReceiptSale}
          onClose={() => setSelectedReceiptSale(null)}
        />
      )}

      {isSuperAdmin && workshopSale && (
        <InvoiceWorkshopModal
          sale={workshopSale}
          onClose={() => setWorkshopSale(null)}
        />
      )}

      {/* Refund Confirmation Modal */}
      {refundSaleTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-extrabold text-base">
                <RotateCcw className="w-5 h-5" />
                <span>Process Sale Refund</span>
              </div>
              <button
                onClick={() => setRefundSaleTarget(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-2xl text-xs space-y-1">
              <p className="font-extrabold text-amber-900 dark:text-amber-200">
                Invoice: {refundSaleTarget.invoiceNo}
              </p>
              <p className="text-amber-800 dark:text-amber-300">
                Total Amount: {settings.currencySymbol}{(Number(refundSaleTarget.totalAmount) || 0).toFixed(2)} ({(refundSaleTarget.items || []).length} items)
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 pt-1">
                ⚠️ Processing a refund will change status to "Refunded" and automatically return inventory quantities back to stock!
              </p>
            </div>

            <div>
              <label className="block font-bold text-xs text-slate-700 dark:text-slate-300 mb-1">
                Reason for Refund:
              </label>
              <input
                type="text"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g. Returned by customer, Incorrect pricing, Defective item"
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setRefundSaleTarget(null)}
                className="px-4 py-2 font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (refundSaleTarget) {
                    refundSale(
                      refundSaleTarget.id,
                      refundReason || 'Customer return',
                      currentUser?.displayName || 'Admin'
                    );
                    setRefundSaleTarget(null);
                  }
                }}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Confirm & Restock</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteSaleTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-extrabold text-base">
                <Trash2 className="w-5 h-5" />
                <span>Delete Sale Record</span>
              </div>
              <button
                onClick={() => setDeleteSaleTarget(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
              Are you sure you want to permanently delete sale record <strong className="text-slate-900 dark:text-white">{deleteSaleTarget.invoiceNo}</strong> ({settings.currencySymbol}{(Number(deleteSaleTarget.totalAmount) || 0).toFixed(2)})?
            </p>

            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-2xl space-y-1.5 text-[11px] text-amber-900 dark:text-amber-200">
              <p className="font-extrabold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Automatic Cascading Actions:</span>
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-300/90 pl-1">
                <li>Restores sold item quantities ({deleteSaleTarget.items.reduce((acc, it) => acc + it.quantity, 0)} units) back to inventory stock</li>
                <li>Deducts customer outstanding balance, order count & loyalty points</li>
                <li>Removes linked delivery orders & logistics expenses</li>
                <li>Unlinks and resets converted WhatsApp pre-orders</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setDeleteSaleTarget(null)}
                className="px-4 py-2 font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 text-xs rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (deleteSaleTarget) {
                    deleteSale(
                      deleteSaleTarget.id,
                      currentUser?.displayName || currentUser?.username || 'Administrator'
                    );
                    setDeleteSaleTarget(null);
                  }
                }}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Permanently Delete & Cascade</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Sale Record Modal (Super-Admin Full Edit & Admin Historical Edit) */}
      {editSaleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200 my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                    <Edit3 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    <span>Edit Sale Record</span>
                  </h3>
                  {isSuperAdmin && (
                    <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-black rounded-full flex items-center gap-1 uppercase tracking-wider">
                      <ShieldCheck className="w-3 h-3" /> Super-Admin
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Invoice: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{editSaleTarget.invoiceNo}</span> • Original Date: {new Date(editSaleTarget.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setEditSaleTarget(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
              {/* Customer Ownership & Transfer System */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-indigo-100 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 rounded-lg">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                        Customer Ownership & Transfer
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Assign or reassign who owns this sales record in the system
                      </p>
                    </div>
                  </div>
                  {isTransferringOwnership && (
                    <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[10px] font-extrabold rounded-full flex items-center gap-1 border border-amber-200 dark:border-amber-800 animate-pulse">
                      <ArrowRightLeft className="w-3 h-3" /> Transfer Active
                    </span>
                  )}
                </div>

                {/* Current Selected State Card */}
                {!isCustomerDropdownOpen ? (
                  <div className="space-y-2.5">
                    {selectedCustomerObj ? (
                      <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-indigo-200/80 dark:border-indigo-800/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                            {selectedCustomerObj.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-slate-900 dark:text-white">
                                {selectedCustomerObj.name}
                              </span>
                              <span className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[9px] font-bold rounded-md border border-indigo-200 dark:border-indigo-800">
                                Registered Customer
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                              {selectedCustomerObj.phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="w-3 h-3 text-slate-400" />
                                  {selectedCustomerObj.phone}
                                </span>
                              )}
                              {selectedCustomerObj.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="w-3 h-3 text-slate-400" />
                                  {selectedCustomerObj.email}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[10px]">
                              <span className="text-slate-600 dark:text-slate-400 font-semibold">
                                History: <b>{(selectedCustomerObj.purchaseHistoryCount || 0).toLocaleString()} orders</b>
                              </span>
                              <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-0.5">
                                <Award className="w-3 h-3" />
                                {(selectedCustomerObj.loyaltyPoints || 0).toLocaleString()} pts
                              </span>
                              <span className={`font-bold ${(selectedCustomerObj.outstandingBalance || 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                Ledger Debt: {settings.currencySymbol}{(selectedCustomerObj.outstandingBalance || 0).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setCustomerSearchQuery('');
                              setIsCustomerDropdownOpen(true);
                            }}
                            className="px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800 transition-colors flex items-center gap-1"
                          >
                            <ArrowRightLeft className="w-3 h-3" />
                            <span>Change</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditCustomerId(undefined);
                              setEditCustomerName('Walk-in Customer');
                              setIsCustomGuestMode(false);
                            }}
                            className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[11px] font-bold rounded-lg hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-colors flex items-center gap-1"
                            title="Detach and return to Walk-in Customer"
                          >
                            <UserX className="w-3 h-3" />
                            <span>Make Walk-in</span>
                          </button>
                        </div>
                      </div>
                    ) : isCustomGuestMode ? (
                      <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-700 shadow-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            Custom Guest / Walk-In Name:
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomGuestMode(false);
                              setEditCustomerName('Walk-in Customer');
                              setEditCustomerId(undefined);
                            }}
                            className="text-[10px] font-bold text-slate-400 hover:text-slate-600"
                          >
                            Reset to Default Walk-in
                          </button>
                        </div>
                        <input
                          type="text"
                          value={editCustomerName}
                          onChange={(e) => setEditCustomerName(e.target.value)}
                          placeholder="e.g. John Doe (Counter Walk-in)"
                          className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                        />
                        <div className="flex items-center justify-between pt-1">
                          <p className="text-[10px] text-slate-400">
                            Unregistered custom name. This sale will not be linked to registered customer accounts.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomerSearchQuery('');
                              setIsCustomerDropdownOpen(true);
                            }}
                            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                          >
                            <UserCheck className="w-3 h-3" /> Select Registered Customer Instead
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center font-bold shrink-0">
                            <User className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300">
                                Walk-in Customer
                              </span>
                              <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[9px] font-bold rounded-md">
                                Unregistered Guest
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400">
                              Anonymous counter sale. Not currently credited to any registered profile.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setCustomerSearchQuery('');
                              setIsCustomerDropdownOpen(true);
                            }}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Assign Customer</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomGuestMode(true);
                              setEditCustomerName('');
                            }}
                            className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 text-[11px] font-bold rounded-lg transition-colors"
                          >
                            Custom Name
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Customer Search & Select Dropdown Mode */
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border-2 border-indigo-500 shadow-md space-y-3">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Search className="w-3.5 h-3.5 text-indigo-500" />
                        Select Registered Customer to Transfer Sale
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsCustomerDropdownOpen(false)}
                        className="text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        autoFocus
                        value={customerSearchQuery}
                        onChange={(e) => setCustomerSearchQuery(e.target.value)}
                        placeholder="Search by name, phone number, or email..."
                        className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    {/* Quick options: Walk-in or custom */}
                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditCustomerId(undefined);
                          setEditCustomerName('Walk-in Customer');
                          setIsCustomGuestMode(false);
                          setIsCustomerDropdownOpen(false);
                        }}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1"
                      >
                        <User className="w-3 h-3" />
                        <span>Set as Walk-in Customer</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditCustomerId(undefined);
                          setIsCustomGuestMode(true);
                          setEditCustomerName('');
                          setIsCustomerDropdownOpen(false);
                        }}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-lg transition-colors"
                      >
                        Type Custom Name
                      </button>
                    </div>

                    {/* Customer Results List */}
                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-100 dark:border-slate-800">
                      {filteredCustomersForEdit.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400">
                          No registered customers found matching "{customerSearchQuery}".
                        </div>
                      ) : (
                        filteredCustomersForEdit.map((cust) => {
                          const isCurrent = editCustomerId === cust.id;
                          return (
                            <button
                              key={cust.id}
                              type="button"
                              onClick={() => {
                                setEditCustomerId(cust.id);
                                setEditCustomerName(cust.name);
                                setIsCustomGuestMode(false);
                                setIsCustomerDropdownOpen(false);
                              }}
                              className={`w-full text-left p-2.5 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 transition-colors flex items-center justify-between gap-2 ${
                                isCurrent ? 'bg-indigo-50 dark:bg-indigo-950/60 font-bold' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-[10px]">
                                  {cust.name.slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-xs font-bold text-slate-900 dark:text-white">
                                    {cust.name}
                                  </p>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                    {cust.phone && <span>{cust.phone}</span>}
                                    {cust.phone && cust.email && <span>•</span>}
                                    {cust.email && <span>{cust.email}</span>}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 block">
                                  {(cust.loyaltyPoints || 0).toLocaleString()} pts
                                </span>
                                {(cust.outstandingBalance || 0) > 0 && (
                                  <span className="text-[10px] font-bold text-rose-600 block">
                                    Debt: {settings.currencySymbol}{(cust.outstandingBalance || 0).toFixed(2)}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* Transfer Impact & Ledger Warning Notices */}
                {isTransferringOwnership && (
                  <div className="space-y-2 pt-1">
                    {selectedCustomerObj ? (
                      <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-xl border border-indigo-200 dark:border-indigo-800/60 text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-indigo-900 dark:text-indigo-200">
                          <UserCheck className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                          <span>Customer Transfer Preview:</span>
                        </div>
                        <p className="text-[11px] text-indigo-800 dark:text-indigo-300">
                          This entire transaction (<span className="font-bold">{settings.currencySymbol}{editCalculatedTotal.toFixed(2)}</span>) will now be attributed to <span className="font-bold">{selectedCustomerObj.name}</span>. It will appear in their customer account history, increase their purchase count (+1 order), add <span className="font-bold">+{editLoyaltyPointsGain} loyalty points</span>, and update their Lifetime Value.
                        </p>
                        {editUnpaidBalance > 0 && (
                          <div className="mt-2 p-2 bg-rose-50 dark:bg-rose-950/60 rounded-lg border border-rose-200 dark:border-rose-800 text-[11px] text-rose-800 dark:text-rose-200 flex items-start gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                            <div>
                              <span className="font-bold">Outstanding Balance Warning:</span> This sale has an unpaid balance of <span className="font-bold">{settings.currencySymbol}{editUnpaidBalance.toFixed(2)}</span>. This debt will be automatically added to <span className="font-bold">{selectedCustomerObj.name}</span>'s ledger account upon saving.
                            </div>
                          </div>
                        )}
                        {originalCustomerObj && (
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-0.5">
                            Note: This sale was previously credited to <span className="font-bold">{originalCustomerObj.name}</span>. Its metrics and points will be deducted from {originalCustomerObj.name}'s account.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/50 rounded-xl border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-[11px]">Detaching from Customer Record:</p>
                          <p className="text-[10px] mt-0.5">
                            This sale will be removed from <span className="font-bold">{originalCustomerObj?.name || editSaleTarget?.customerName}</span>'s purchase history and will no longer count towards their Lifetime Value, loyalty points, or outstanding balance.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* General Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Sale Type:
                  </label>
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as 'Retail' | 'Wholesale')}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Retail">Retail Sale</option>
                    <option value="Wholesale">Wholesale Sale</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Payment Method:
                  </label>
                  <select
                    value={editPaymentMethod}
                    onChange={(e) => setEditPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Card">Card</option>
                    <option value="Cash">Cash</option>
                    <option value="Mobile Transfer">Mobile Transfer</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Store Credit">Store Credit</option>
                    <option value="Split">Split</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Sale Status:
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as SaleStatus)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Completed">Completed</option>
                    <option value="Draft">Draft</option>
                    <option value="Held">Held</option>
                    <option value="Refunded">Refunded</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Recorded By / Staff:
                  </label>
                  <input
                    type="text"
                    value={editCreatedBy}
                    onChange={(e) => setEditCreatedBy(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Sale Date & Time:
                  </label>
                  <input
                    type="datetime-local"
                    value={editCreatedAt}
                    onChange={(e) => setEditCreatedAt(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Notes / Audit Remarks:
                  </label>
                  <textarea
                    rows={2}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Sale notes or reason for modification..."
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Line Items Section */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Sale Line Items ({editingSaleItems.length})
                  </h4>

                  <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                    <button
                      type="button"
                      onClick={() => setShowEditAddClearance((prev) => !prev)}
                      className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-300 hover:bg-amber-100 font-bold text-xs rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Tag className="w-3.5 h-3.5 text-amber-500" />
                      <span>{showEditAddClearance ? 'Hide Clearance Form' : '+ Add Clearance Item'}</span>
                    </button>

                    <div className="flex items-center gap-1.5 flex-1 sm:flex-none">
                      <select
                        value={selectedAddProductId}
                        onChange={(e) => setSelectedAddProductId(e.target.value)}
                        className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs text-slate-900 dark:text-white flex-1 sm:flex-none max-w-[200px]"
                      >
                        <option value="">-- Add Catalog Product --</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!selectedAddProductId}
                        onClick={() => {
                          const prodToAdd = products.find((p) => p.id === selectedAddProductId);
                          if (prodToAdd) {
                            const unitPrice = editType === 'Wholesale' ? prodToAdd.wholesalePrice : prodToAdd.retailPrice;
                            const newItem: SaleItem = {
                              productId: prodToAdd.id,
                              productName: prodToAdd.name,
                              sku: prodToAdd.sku,
                              quantity: 1,
                              unitPrice,
                              costPrice: prodToAdd.costPrice,
                              total: unitPrice,
                              isWholesale: editType === 'Wholesale',
                            };
                            // A product already on the sale is incremented, not
                            // duplicated: two rows with the same productId gave
                            // the list duplicate keys and ambiguous totals.
                            setEditingSaleItems((prev) => {
                              const existing = prev.find((line) => line.productId === newItem.productId);
                              if (existing) {
                                return prev.map((line) => line.productId === newItem.productId
                                  ? { ...line, quantity: line.quantity + 1, total: (line.quantity + 1) * (Number(line.unitPrice) || 0) }
                                  : line);
                              }
                              return [newItem, ...prev];
                            });
                            setSelectedAddProductId('');
                          }
                        }}
                        className="px-2.5 py-1 bg-indigo-600 disabled:opacity-40 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Inline Clearance Adder Form */}
                {showEditAddClearance && (
                  <div className="p-3.5 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-2xl space-y-2.5 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-black text-amber-950 dark:text-amber-200">
                        <Tag className="w-4 h-4 text-amber-500" />
                        <span>Add Clearance / Non-Inventory Item to Sale</span>
                      </div>
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200">
                        No Stock Impact
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="sm:col-span-1">
                        <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                          Item Label:
                        </label>
                        <input
                          type="text"
                          value={editClearanceName}
                          onChange={(e) => setEditClearanceName(e.target.value)}
                          placeholder="e.g. Clearance Item"
                          className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                          Price ({settings.currencySymbol}) *:
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={editClearanceAmount}
                          onChange={(e) => setEditClearanceAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                          Qty:
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={editClearanceQty}
                          onChange={(e) => setEditClearanceQty(e.target.value)}
                          className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                        Description / Notes:
                      </label>
                      <input
                        type="text"
                        value={editClearanceNotes}
                        onChange={(e) => setEditClearanceNotes(e.target.value)}
                        placeholder="Condition notes (e.g. Damaged box, sold as-is)..."
                        className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const price = parseFloat(editClearanceAmount);
                          if (isNaN(price) || price <= 0) {
                            notify('Please enter a valid clearance amount.', 'Invalid amount');
                            return;
                          }
                          const qty = parseInt(editClearanceQty) || 1;
                          const name = editClearanceName.trim() || 'Clearance Sale Item';
                          const uniqueId = `clearance-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

                          const clearanceItem: SaleItem = {
                            productId: uniqueId,
                            productName: name,
                            sku: 'CLEARANCE',
                            quantity: qty,
                            unitPrice: price,
                            costPrice: 0,
                            total: qty * price,
                            isWholesale: false,
                            isClearance: true,
                            clearanceDescription: editClearanceNotes.trim(),
                          };

                          setEditingSaleItems((prev) => [clearanceItem, ...prev]);
                          setEditClearanceAmount('');
                          setEditClearanceNotes('');
                          setEditClearanceQty('1');
                          setEditClearanceName('Clearance Sale Item');
                          setShowEditAddClearance(false);
                        }}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Insert Clearance Item</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {editingSaleItems.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                      No line items. Use dropdown or clearance button above to add items.
                    </p>
                  ) : (
                    editingSaleItems.map((item, index) => (
                      <div
                        key={item.productId || `edit-line-${index}`}
                        className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl space-y-2.5"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-xs text-slate-900 dark:text-white">
                                {item.productName}
                              </p>
                              {item.isClearance && (
                                <span className="bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[9px] font-extrabold px-1.5 py-0.2 rounded border border-amber-300 dark:border-amber-800">
                                  Clearance
                                </span>
                              )}
                            </div>
                            {item.isClearance && item.clearanceDescription ? (
                              <p className="text-[10px] text-slate-500 italic mt-0.5">
                                Note: {item.clearanceDescription}
                              </p>
                            ) : (
                              <p className="text-[11px] text-slate-500 font-medium">
                                {item.sku ? `SKU: ${item.sku}` : 'Item'}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-black text-slate-900 dark:text-white">
                              Total: {settings.currencySymbol}{(Number(item.unitPrice || 0) * Number(item.quantity || 0)).toFixed(2)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setEditingSaleItems((prev) => prev.filter((_, idx) => idx !== index))}
                              className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                              title="Remove Item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                              Qty:
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => {
                                const q = parseInt(e.target.value) || 1;
                                setEditingSaleItems((prev) =>
                                  prev.map((it, idx) =>
                                    idx === index ? { ...it, quantity: q, total: q * it.unitPrice } : it
                                  )
                                );
                              }}
                              className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                              Selling Price ({settings.currencySymbol}):
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) => {
                                const p = parseFloat(e.target.value);
                                const validP = isNaN(p) ? 0 : p;
                                setEditingSaleItems((prev) =>
                                  prev.map((it, idx) =>
                                    idx === index ? { ...it, unitPrice: validP, total: it.quantity * validP } : it
                                  )
                                );
                              }}
                              className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                              Cost Price ({settings.currencySymbol}):
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.costPrice}
                              onChange={(e) => {
                                const c = parseFloat(e.target.value);
                                const validC = isNaN(c) ? 0 : c;
                                setEditingSaleItems((prev) =>
                                  prev.map((it, idx) =>
                                    idx === index ? { ...it, costPrice: validC } : it
                                  )
                                );
                              }}
                              className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Financial Adjustments Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Discount ({settings.currencySymbol}):
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Tax ({settings.currencySymbol}):
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editTax}
                    onChange={(e) => setEditTax(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Delivery Fee ({settings.currencySymbol}):
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editDeliveryFee}
                    onChange={(e) => setEditDeliveryFee(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
                      Paid Amount ({settings.currencySymbol}):
                    </label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const sub = editingSaleItems.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);
                          const tot = Math.max(0, sub - editDiscount + editTax + editDeliveryFee);
                          setEditPaidAmount(tot);
                        }}
                        className="text-[9px] font-extrabold px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer"
                        title="Set paid amount to full recalculated invoice total"
                      >
                        100% Full
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPaidAmount(0)}
                        className="text-[9px] font-extrabold px-1.5 py-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded border border-rose-200 dark:border-rose-800 hover:bg-rose-100 transition-colors cursor-pointer"
                        title="Remove customer payment (marks as credit / outstanding balance)"
                      >
                        0% Unpaid
                      </button>
                    </div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editPaidAmount}
                    onChange={(e) => {
                      const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                      setEditPaidAmount(isNaN(val) ? 0 : val);
                    }}
                    className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                  />
                  {(() => {
                    const sub = editingSaleItems.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);
                    const tot = Math.max(0, sub - editDiscount + editTax + editDeliveryFee);
                    const unpaid = Math.max(0, tot - editPaidAmount);
                    if (unpaid > 0) {
                      return (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold mt-1">
                          ⚠️ Outstanding Due: {settings.currencySymbol}{(Number(unpaid) || 0).toFixed(2)} (will be attached to {editCustomerName || 'customer'})
                        </p>
                      );
                    }
                    return (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mt-1">
                        ✓ Fully Paid
                      </p>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-slate-500 font-medium">Recalculated Total</p>
                <p className="text-base font-black text-slate-900 dark:text-white">
                  {settings.currencySymbol}
                  {(Number(Math.max(
                    0,
                    editingSaleItems.reduce((acc, it) => acc + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0) -
                      (Number(editDiscount) || 0) +
                      (Number(editTax) || 0) +
                      (Number(editDeliveryFee) || 0)
                  )) || 0).toFixed(2)}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditSaleTarget(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveSaleEdit}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Save Sale Record</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
