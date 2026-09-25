import React, { useState } from 'react';
import {
  Truck,
  Search,
  CheckCircle2,
  Clock,
  Package,
  User,
  Phone,
  MapPin,
  FileText,
  AlertCircle,
  Receipt,
  X,
  ChevronDown,
  Filter,
  Check,
  Send,
  ExternalLink,
  Trash2,
  Edit2,
  ShieldCheck,
  Save,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { DeliveryOrder, DeliveryStatus } from '../../types';
import { ConfirmModal } from '../common/ConfirmModal';
import { Pagination } from '../common/Pagination';

export const DeliveriesView: React.FC<{ onNavigate?: (page: string) => void }> = ({ onNavigate }) => {
  const {
    deliveryOrders,
    confirmDeliveryPickup,
    updateDeliveryOrderStatus,
    updateDeliveryPickup,
    deleteDeliveryOrder,
    settings,
    expenses,
  } = useApp();
  const { currentUser, isSuperAdmin } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [pickupModalOrder, setPickupModalOrder] = useState<DeliveryOrder | null>(null);
  const [courierNotesInput, setCourierNotesInput] = useState('');
  const [orderToDelete, setOrderToDelete] = useState<DeliveryOrder | null>(null);

  // Super-Admin Edit Pickup Modal State
  const [editPickupModalOrder, setEditPickupModalOrder] = useState<DeliveryOrder | null>(null);
  const [editStatus, setEditStatus] = useState<DeliveryStatus>('Pending Pickup');
  const [editIsPickupConfirmed, setEditIsPickupConfirmed] = useState<boolean>(false);
  const [editPickupConfirmedBy, setEditPickupConfirmedBy] = useState<string>('');
  const [editPickupConfirmedAt, setEditPickupConfirmedAt] = useState<string>('');
  const [editCourierNotes, setEditCourierNotes] = useState<string>('');
  const [editDeliveryFee, setEditDeliveryFee] = useState<number | string>(0);
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [editCustomerPhone, setEditCustomerPhone] = useState<string>('');
  const [editDeliveryAddress, setEditDeliveryAddress] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');

  const handleOpenEditPickup = (order: DeliveryOrder) => {
    if (!isSuperAdmin) return;
    setEditPickupModalOrder(order);
    setEditStatus(order.status);
    setEditIsPickupConfirmed(order.isPickupConfirmed);
    setEditPickupConfirmedBy(order.pickupConfirmedBy || currentUser?.displayName || 'Aidy Mike');
    setEditPickupConfirmedAt(
      order.pickupConfirmedAt
        ? new Date(order.pickupConfirmedAt).toISOString().slice(0, 16)
        : new Date().toISOString().slice(0, 16)
    );
    setEditCourierNotes(order.courierNotes || '');
    setEditDeliveryFee(order.deliveryFee ?? 0);
    setEditCustomerName(order.customerName || '');
    setEditCustomerPhone(order.customerPhone || '');
    setEditDeliveryAddress(order.deliveryAddress || '');
    setEditNotes(order.notes || '');
  };

  const handleSaveEditPickupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPickupModalOrder || !isSuperAdmin) return;

    const parsedFee = Math.max(0, Number(editDeliveryFee) || 0);

    const updates: Partial<DeliveryOrder> = {
      status: editStatus,
      isPickupConfirmed: editIsPickupConfirmed,
      pickupConfirmedBy: editIsPickupConfirmed
        ? editPickupConfirmedBy.trim() || currentUser?.displayName || 'Aidy Mike'
        : undefined,
      pickupConfirmedAt: editIsPickupConfirmed
        ? editPickupConfirmedAt
          ? new Date(editPickupConfirmedAt).toISOString()
          : new Date().toISOString()
        : undefined,
      courierNotes: editCourierNotes.trim(),
      deliveryFee: parsedFee,
      customerName: editCustomerName.trim() || editPickupModalOrder.customerName,
      customerPhone: editCustomerPhone.trim(),
      deliveryAddress: editDeliveryAddress.trim(),
      notes: editNotes.trim(),
    };

    updateDeliveryPickup(
      editPickupModalOrder.id,
      updates,
      currentUser?.displayName || 'Aidy Mike'
    );

    setEditPickupModalOrder(null);
  };

  // Filter Delivery Orders. Memoized: it was a new array every render, so the
  // pagination memo below never hit and every keystroke re-scanned the list.
  const filteredOrders = React.useMemo(() => deliveryOrders.filter((order) => {
    if (!order) return false;
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch =
      (order.deliveryNo || '').toLowerCase().includes(q) ||
      (order.invoiceNo || '').toLowerCase().includes(q) ||
      (order.customerName || '').toLowerCase().includes(q) ||
      (order.customerPhone && order.customerPhone.includes(searchQuery)) ||
      (order.deliveryAddress && order.deliveryAddress.toLowerCase().includes(q));

    const matchesStatus = selectedStatus === 'All' || order.status === selectedStatus;
    return matchesSearch && matchesStatus;
  }), [deliveryOrders, searchQuery, selectedStatus]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset page when search or status filter changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedStatus]);

  const totalPages = Math.ceil(filteredOrders.length / pageSize) || 1;
  const paginatedOrders = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredOrders.slice(start, start + pageSize);
  }, [filteredOrders, currentPage, pageSize]);

  // Calculate KPI summaries
  const totalOrders = deliveryOrders.length;
  const pendingPickupCount = React.useMemo(
    () => deliveryOrders.filter((o) => !o.isPickupConfirmed && o.status !== 'Cancelled').length,
    [deliveryOrders],
  );
  const inTransitCount = React.useMemo(
    () => deliveryOrders.filter((o) => o.status === 'Picked Up' || o.status === 'Out for Delivery').length,
    [deliveryOrders],
  );
  const deliveredCount = React.useMemo(
    () => deliveryOrders.filter((o) => o.status === 'Delivered').length,
    [deliveryOrders],
  );
  const totalDeliveryFees = React.useMemo(
    () => deliveryOrders.reduce((sum, o) => sum + (o.deliveryFee || 0), 0),
    [deliveryOrders],
  );

  const handleConfirmPickupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickupModalOrder) return;
    confirmDeliveryPickup(
      pickupModalOrder.id,
      currentUser?.displayName || 'Sales Staff',
      courierNotesInput.trim()
    );
    setPickupModalOrder(null);
    setCourierNotesInput('');
  };

  const getStatusBadge = (status: DeliveryStatus, isPickupConfirmed: boolean) => {
    switch (status) {
      case 'Pending Pickup':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/50">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            Pending Pickup
          </span>
        );
      case 'Picked Up':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-300/50">
            <Truck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            Picked Up
          </span>
        );
      case 'Out for Delivery':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 border border-purple-300/50">
            <Send className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            Out for Delivery
          </span>
        );
      case 'Delivered':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/50">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Delivered
          </span>
        );
      case 'Cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-300/50">
            <X className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Alert banner if pending pickups exist */}
      {pendingPickupCount > 0 && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-4 py-3 rounded-2xl text-amber-800 dark:text-amber-300 text-xs font-semibold shadow-xs">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
            <span>
              <strong>{pendingPickupCount}</strong> delivery order{pendingPickupCount > 1 ? 's' : ''} awaiting driver/rider pickup confirmation!
            </span>
          </div>
          <button
            onClick={() => setSelectedStatus('Pending Pickup')}
            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-bold transition-all shadow-xs cursor-pointer"
          >
            View Pending
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Pending Pickups
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">
            {pendingPickupCount}
          </div>
          <p className="text-[11px] text-slate-400">Awaiting driver/rider pickup</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            In Transit / Picked Up
          </span>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400">
            {inTransitCount}
          </div>
          <p className="text-[11px] text-slate-400">Logistics expense logged</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Delivered Orders
          </span>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            {deliveredCount}
          </div>
          <p className="text-[11px] text-slate-400">Completed deliveries</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Delivery Fees Collected
          </span>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {settings.currencySymbol}{(Number(totalDeliveryFees) || 0).toFixed(2)}
          </div>
          <p className="text-[11px] text-slate-400">Total collected via POS</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="relative flex-1 w-full min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search delivery no, invoice, customer name, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-9 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto scrollbar-none pb-1 md:pb-0">
          {['All', 'Pending Pickup', 'Picked Up', 'Out for Delivery', 'Delivered', 'Cancelled'].map((status) => (
            <button
              key={status}
              onClick={() => setSelectedStatus(status)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                selectedStatus === status
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Delivery Orders List */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-12 text-center border border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-3xl flex items-center justify-center mx-auto">
            <Truck className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
            No Deliver Product Orders Found
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            When a customer pays a delivery fee during POS checkout, a Delivery Order is automatically created here for tracking & pickup dispatch.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {paginatedOrders.map((order) => {
            const linkedExpense = order.expenseId ? expenses.find((e) => e.id === order.expenseId) : null;

            return (
              <div
                key={order.id}
                className={`bg-white dark:bg-slate-900 rounded-3xl border transition-all duration-200 shadow-xs p-5 flex flex-col justify-between space-y-4 ${
                  !order.isPickupConfirmed
                    ? 'border-amber-300 dark:border-amber-800/80 ring-1 ring-amber-400/20'
                    : 'border-slate-200/80 dark:border-slate-800'
                }`}
              >
                {/* Header */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-slate-900 dark:text-white text-base tracking-tight">
                          {order.deliveryNo}
                        </span>
                        <span className="text-xs text-slate-400 font-semibold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg">
                          {order.invoiceNo}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Created {new Date(order.createdAt).toLocaleString()} by {order.createdBy}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(order.status, order.isPickupConfirmed)}
                      {isSuperAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenEditPickup(order)}
                            title="Edit delivery pickup details (Super-Admin only)"
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-xl transition-colors cursor-pointer shrink-0"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setOrderToDelete(order)}
                            title="Delete delivery record (Super-Admin only)"
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition-colors cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Customer & Location */}
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-2xl space-y-2 text-xs">
                    <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 font-bold">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-blue-500" />
                        <span>{order.customerName}</span>
                      </div>
                      {order.customerPhone && (
                        <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                          <Phone className="w-3.5 h-3.5 text-emerald-500" />
                          <span>{order.customerPhone}</span>
                        </div>
                      )}
                    </div>
                    {order.deliveryAddress ? (
                      <div className="flex items-start gap-2 text-slate-600 dark:text-slate-400 font-medium pt-1 border-t border-slate-200/50 dark:border-slate-700/50">
                        <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        <span>{order.deliveryAddress}</span>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 italic">No delivery address provided on POS</p>
                    )}
                  </div>

                  {/* Items List */}
                  <div>
                    <span className="text-[11px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1.5">
                      Items to Deliver ({order.items.reduce((s, i) => s + i.quantity, 0)} items):
                    </span>
                    <div className="space-y-1">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs py-1 px-2.5 bg-slate-100/60 dark:bg-slate-800/80 rounded-xl">
                          <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[220px]">
                            {item.quantity}x {item.productName}
                          </span>
                          <span className="font-bold text-slate-500">
                            {settings.currencySymbol}{(Number(item.total) || 0).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Delivery Fee & Notes */}
                  <div className="flex justify-between items-center text-xs p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/60 rounded-2xl">
                    <span className="font-bold text-emerald-900 dark:text-emerald-300">
                      Collected Delivery Fee:
                    </span>
                    <span className="font-black text-sm text-emerald-700 dark:text-emerald-400">
                      +{settings.currencySymbol}{(Number(order.deliveryFee) || 0).toFixed(2)}
                    </span>
                  </div>

                  {/* Pickup Confirmation / Linked Expense Banner */}
                  {order.isPickupConfirmed ? (
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/50 border border-blue-200/70 dark:border-blue-800/70 rounded-2xl space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-blue-900 dark:text-blue-300 font-bold">
                          <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <span>Pickup Confirmed & Dispatched</span>
                        </div>
                        {isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => handleOpenEditPickup(order)}
                            className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Edit2 className="w-3 h-3" />
                            Edit Pickup
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-blue-700 dark:text-blue-400">
                        Confirmed by {order.pickupConfirmedBy || 'Staff'} at {order.pickupConfirmedAt ? new Date(order.pickupConfirmedAt).toLocaleTimeString() : ''}.
                      </p>
                      {order.courierNotes && (
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 italic">
                          Notes: {order.courierNotes}
                        </p>
                      )}
                      <div className="pt-2 border-t border-blue-200/50 dark:border-blue-800/50 flex items-center justify-between text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                        <span className="flex items-center gap-1">
                          <Receipt className="w-3.5 h-3.5" />
                          Logistics Expense Auto-Created:
                        </span>
                        <span>{settings.currencySymbol}{(Number(order.deliveryFee) || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-amber-900 dark:text-amber-300 text-xs font-bold">
                          <AlertCircle className="w-4 h-4 text-amber-600" />
                          <span>Pickup Pending Confirmation</span>
                        </div>
                        {isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => handleOpenEditPickup(order)}
                            className="text-[11px] font-bold text-amber-700 dark:text-amber-300 hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Edit2 className="w-3 h-3" />
                            Edit Pickup
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-amber-800 dark:text-amber-400">
                        Confirming pickup will dispatch the order and <strong>automatically log a {settings.currencySymbol}{(Number(order.deliveryFee) || 0).toFixed(2)} expense under Logistics</strong>.
                      </p>
                      <button
                        onClick={() => setPickupModalOrder(order)}
                        className="w-full py-2 px-4 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Truck className="w-4 h-4" />
                        <span>Confirm Product Pickup for Delivery</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Footer Controls */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-bold">Status:</span>
                    <select
                      value={order.status}
                      onChange={(e) => updateDeliveryOrderStatus(order.id, e.target.value as DeliveryStatus, currentUser?.displayName)}
                      className="text-xs font-bold py-1 px-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="Pending Pickup">Pending Pickup</option>
                      <option value="Picked Up">Picked Up</option>
                      <option value="Out for Delivery">Out for Delivery</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>

                  {onNavigate && (
                    <button
                      onClick={() => onNavigate('sales')}
                      className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      View Sale Receipt
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination Controls */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={filteredOrders.length}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          itemLabel="delivery orders"
        />
      </>
      )}

      {/* Modal: Confirm Pickup & Auto-Create Logistics Expense */}
      {pickupModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in fade-in duration-200 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 rounded-2xl">
                  <Truck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                    Confirm Delivery Pickup
                  </h3>
                  <p className="text-xs font-medium text-slate-500">
                    Order {pickupModalOrder.deliveryNo} ({pickupModalOrder.invoiceNo})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPickupModalOrder(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl space-y-1">
                <div className="flex justify-between font-bold">
                  <span>Customer:</span>
                  <span className="text-slate-900 dark:text-white">{pickupModalOrder.customerName}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Collected Delivery Fee:</span>
                  <span className="text-emerald-600 font-extrabold">
                    {settings.currencySymbol}{(Number(pickupModalOrder.deliveryFee) || 0).toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-emerald-900 dark:text-emerald-300 font-medium">
                <p className="flex items-center gap-1.5 font-bold mb-0.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  Automatic Expense Categorization
                </p>
                Confirming pickup will automatically create a new Expense record of{' '}
                <strong>{settings.currencySymbol}{(Number(pickupModalOrder.deliveryFee) || 0).toFixed(2)}</strong> under{' '}
                <span className="underline font-bold">Logistics</span> category.
              </div>

              <form onSubmit={handleConfirmPickupSubmit} className="space-y-4 pt-2">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Courier / Rider Name or Notes (Optional):
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Dispatched via Gokada Rider #492, Phone..."
                    value={courierNotesInput}
                    onChange={(e) => setCourierNotesInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setPickupModalOrder(null)}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    <span>Confirm & Create Expense</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Super-Admin Edit Delivery Pickup Details */}
      {editPickupModalOrder && isSuperAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-xl w-full shadow-2xl space-y-5 animate-in fade-in duration-200 my-auto max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-2xl">
                  <Truck className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                      Edit Delivery Pickup
                    </h3>
                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800">
                      <ShieldCheck className="w-3 h-3" />
                      Super-Admin
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-500">
                    Order {editPickupModalOrder.deliveryNo} · Invoice #{editPickupModalOrder.invoiceNo}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditPickupModalOrder(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditPickupSubmit} className="space-y-4 text-xs">
              {/* Pickup Status & Confirmation Switch */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl space-y-3 border border-slate-200/80 dark:border-slate-700/80">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="font-bold text-slate-800 dark:text-slate-200 block">
                      Pickup Confirmation State
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Toggle whether driver/courier has confirmed item pickup for dispatch.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editIsPickupConfirmed}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setEditIsPickupConfirmed(checked);
                        if (checked && editStatus === 'Pending Pickup') {
                          setEditStatus('Picked Up');
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Delivery Order Status
                    </label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as DeliveryStatus)}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    >
                      <option value="Pending Pickup">Pending Pickup</option>
                      <option value="Picked Up">Picked Up</option>
                      <option value="Out for Delivery">Out for Delivery</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>

                  {editIsPickupConfirmed && (
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Pickup Confirmed By
                      </label>
                      <input
                        type="text"
                        value={editPickupConfirmedBy}
                        onChange={(e) => setEditPickupConfirmedBy(e.target.value)}
                        placeholder="Staff / Admin Name"
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                  )}

                  {editIsPickupConfirmed && (
                    <div className="sm:col-span-2">
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Pickup Confirmed Date & Time
                      </label>
                      <input
                        type="datetime-local"
                        value={editPickupConfirmedAt}
                        onChange={(e) => setEditPickupConfirmedAt(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Courier & Delivery Fee */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl space-y-3 border border-slate-200/80 dark:border-slate-700/80">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Delivery Fee ({settings.currencySymbol})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editDeliveryFee}
                      onChange={(e) => setEditDeliveryFee(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Syncs with auto-created Logistics Expense.
                    </p>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Courier / Rider Details
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Gokada Rider John, +234..."
                      value={editCourierNotes}
                      onChange={(e) => setEditCourierNotes(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>

              {/* Recipient Information */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl space-y-3 border border-slate-200/80 dark:border-slate-700/80">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Customer / Recipient Name
                    </label>
                    <input
                      type="text"
                      value={editCustomerName}
                      onChange={(e) => setEditCustomerName(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Customer Phone Number
                    </label>
                    <input
                      type="text"
                      value={editCustomerPhone}
                      onChange={(e) => setEditCustomerPhone(e.target.value)}
                      placeholder="e.g. 08012345678"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Delivery Destination Address
                  </label>
                  <textarea
                    rows={2}
                    value={editDeliveryAddress}
                    onChange={(e) => setEditDeliveryAddress(e.target.value)}
                    placeholder="Enter complete delivery street address, landmark, city..."
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden resize-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Internal Dispatch Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Special packaging or gate instructions..."
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditPickupModalOrder(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>Save Pickup Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Delivery Record Confirmation Modal (Super-Admin Only) */}
      {orderToDelete && (
        <ConfirmModal
          isOpen={!!orderToDelete}
          title="Delete Delivery Record"
          message={`Are you sure you want to permanently delete delivery record "${orderToDelete.deliveryNo}" (${orderToDelete.invoiceNo}) for ${orderToDelete.customerName}? This action cannot be undone.`}
          confirmText="Delete Record"
          cancelText="Cancel"
          variant="danger"
          onConfirm={() => {
            if (orderToDelete) {
              if (!isSuperAdmin) {
                setOrderToDelete(null);
                return;
              }
              deleteDeliveryOrder(orderToDelete.id, currentUser?.displayName || 'Aidy Mike');
              setOrderToDelete(null);
            }
          }}
          onClose={() => setOrderToDelete(null)}
        />
      )}
    </div>
  );
};
