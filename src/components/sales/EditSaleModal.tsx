import React, { useState, useMemo, useEffect } from 'react';
import { Sale, SaleItem, PaymentMethod, SaleStatus, DeliveryStatus } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import {
  Edit3,
  ShieldCheck,
  X,
  UserCheck,
  ArrowRightLeft,
  Phone,
  Mail,
  Award,
  UserX,
  User,
  Search,
  AlertCircle,
  Plus,
  Tag,
  Trash2,
  Truck,
  ChevronDown,
  MapPin,
} from 'lucide-react';

interface EditSaleModalProps {
  sale: Sale | null;
  onClose: () => void;
  onSaved?: () => void;
}

export const EditSaleModal: React.FC<EditSaleModalProps> = ({ sale, onClose, onSaved }) => {
  const { products, customers, settings, deliveryOrders, updateSale } = useApp();
  const { currentUser, isSuperAdmin } = useAuth();

  const [editingSaleItems, setEditingSaleItems] = useState<SaleItem[]>([]);
  const [editCustomerId, setEditCustomerId] = useState<string | undefined>(undefined);
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  const [isCustomGuestMode, setIsCustomGuestMode] = useState(false);
  const [editType, setEditType] = useState<'Retail' | 'Wholesale'>('Retail');
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>('Card');
  const [editStatus, setEditStatus] = useState<SaleStatus>('Completed');
  const [editCreatedBy, setEditCreatedBy] = useState<string>('Administrator');
  const [editCreatedAt, setEditCreatedAt] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editDiscount, setEditDiscount] = useState<number>(0);
  const [editTax, setEditTax] = useState<number>(0);
  const [editDeliveryFee, setEditDeliveryFee] = useState<number | string>(0);
  const [editPaidAmount, setEditPaidAmount] = useState<number>(0);
  const [autoKeepFullyPaid, setAutoKeepFullyPaid] = useState(true);
  const [editDeliveryAddress, setEditDeliveryAddress] = useState<string>('');
  const [editDeliveryPhone, setEditDeliveryPhone] = useState<string>('');
  const [editCourierNotes, setEditCourierNotes] = useState<string>('');
  const [editDeliveryStatus, setEditDeliveryStatus] = useState<DeliveryStatus>('Pending Pickup');
  const [isPickupConfirmed, setIsPickupConfirmed] = useState<boolean>(false);
  const [showDeliveryDetails, setShowDeliveryDetails] = useState<boolean>(false);
  const [selectedAddProductId, setSelectedAddProductId] = useState<string>('');
  const [showEditAddClearance, setShowEditAddClearance] = useState(false);
  const [editClearanceName, setEditClearanceName] = useState('Clearance Sale Item');
  const [editClearanceAmount, setEditClearanceAmount] = useState('');
  const [editClearanceQty, setEditClearanceQty] = useState('1');
  const [editClearanceNotes, setEditClearanceNotes] = useState('');

  useEffect(() => {
    if (!sale) return;

    setEditingSaleItems(sale.items.map((item) => ({ ...item })));
    setEditCustomerId(sale.customerId);
    setEditCustomerName(sale.customerName || 'Walk-in Customer');
    setCustomerSearchQuery('');
    setIsCustomerDropdownOpen(false);
    setIsCustomGuestMode(!sale.customerId && Boolean(sale.customerName) && sale.customerName !== 'Walk-in Customer' && sale.customerName !== 'Cash Customer');
    setEditType(sale.type || 'Retail');
    setEditPaymentMethod(sale.paymentMethod || 'Card');
    setEditStatus(sale.status || 'Completed');
    setEditCreatedBy(sale.createdBy || 'Administrator');

    const transactionDate = sale.createdAt ? new Date(sale.createdAt) : new Date();
    setEditCreatedAt(new Date(transactionDate.getTime() - transactionDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    setEditNotes(sale.notes || '');
    setEditDiscount(sale.discount || 0);
    setEditTax(sale.tax || 0);

    const matchingDelivery = deliveryOrders.find(
      (d) => d.saleId === sale.id || (sale.invoiceNo && d.invoiceNo === sale.invoiceNo)
    );
    const matchedCustomer = customers.find((c) => c.id === sale.customerId);
    const initialFee = sale.deliveryFee !== undefined && sale.deliveryFee > 0
      ? sale.deliveryFee
      : (matchingDelivery?.deliveryFee || 0);

    setEditDeliveryFee(initialFee);
    setEditDeliveryAddress(matchingDelivery?.deliveryAddress || matchedCustomer?.address || '');
    setEditDeliveryPhone(matchingDelivery?.customerPhone || matchedCustomer?.phone || '');
    setEditCourierNotes(matchingDelivery?.courierNotes || '');
    setEditDeliveryStatus(matchingDelivery?.status || 'Pending Pickup');
    setIsPickupConfirmed(matchingDelivery?.isPickupConfirmed || false);
    setShowDeliveryDetails(initialFee > 0 || Boolean(matchingDelivery));

    const wasFullyPaid = (sale.paidAmount !== undefined ? sale.paidAmount : (sale.totalAmount || 0)) >= (sale.totalAmount || 0);
    setAutoKeepFullyPaid(wasFullyPaid);
    setEditPaidAmount(sale.paidAmount !== undefined ? sale.paidAmount : (sale.totalAmount || 0));
    setSelectedAddProductId('');
    setShowEditAddClearance(false);
    setEditClearanceName('Clearance Sale Item');
    setEditClearanceAmount('');
    setEditClearanceQty('1');
    setEditClearanceNotes('');
  }, [sale, customers, deliveryOrders]);

  const editItemsSubtotal = useMemo(() => {
    return editingSaleItems.reduce((acc, it) => acc + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0);
  }, [editingSaleItems]);

  const editCalculatedTotal = useMemo(() => {
    const fee = Math.max(0, Number(editDeliveryFee) || 0);
    return Math.max(0, editItemsSubtotal - editDiscount + editTax + fee);
  }, [editItemsSubtotal, editDiscount, editTax, editDeliveryFee]);

  const editUnpaidBalance = useMemo(() => {
    return Math.max(0, editCalculatedTotal - (isNaN(editPaidAmount) ? 0 : editPaidAmount));
  }, [editCalculatedTotal, editPaidAmount]);

  const editLoyaltyPointsGain = useMemo(() => {
    return Math.floor(editCalculatedTotal * (settings.pointsPerDollar || 0.01));
  }, [editCalculatedTotal, settings.pointsPerDollar]);

  const handleDeliveryFeeChange = (val: number | string) => {
    setEditDeliveryFee(val);
    const parsedFee = Math.max(0, Number(val) || 0);
    if (autoKeepFullyPaid) {
      const newTotal = Math.max(0, editItemsSubtotal - editDiscount + editTax + parsedFee);
      setEditPaidAmount(newTotal);
    }
  };

  const filteredCustomersForEdit = useMemo(() => {
    const q = customerSearchQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 10);
    return customers.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
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
    if (!sale) return null;
    if (sale.customerId) {
      return customers.find((c) => c.id === sale.customerId) || null;
    }
    if (sale.customerName && sale.customerName.toLowerCase() !== 'walk-in customer' && sale.customerName.toLowerCase() !== 'cash customer') {
      return customers.find((c) => c.name && c.name.toLowerCase() === sale.customerName.toLowerCase()) || null;
    }
    return null;
  }, [customers, sale]);

  const isTransferringOwnership = useMemo(() => {
    if (!sale) return false;
    const origKey = sale.customerId || (sale.customerName && sale.customerName.toLowerCase() !== 'walk-in customer' ? sale.customerName.toLowerCase() : '__walkin__');
    const newKey = isCustomGuestMode
      ? `__custom_${editCustomerName.toLowerCase()}__`
      : (selectedCustomerObj?.id || (editCustomerName.toLowerCase() !== 'walk-in customer' ? editCustomerName.toLowerCase() : '__walkin__'));
    return origKey !== newKey;
  }, [sale, isCustomGuestMode, editCustomerName, selectedCustomerObj]);

  const handleSaveSaleEdit = () => {
    if (!sale) return;

    const itemsSubtotal = editingSaleItems.reduce((acc, it) => acc + (it.unitPrice * it.quantity), 0);
    const parsedDeliveryFee = Math.max(0, Number(editDeliveryFee) || 0);
    const calculatedTotal = Math.max(0, itemsSubtotal - editDiscount + editTax + parsedDeliveryFee);
    const sanitizedPaidAmount = Math.max(0, isNaN(editPaidAmount) ? 0 : editPaidAmount);

    const finalCustomerId = isCustomGuestMode ? undefined : editCustomerId;
    const finalCustomerName = isCustomGuestMode
      ? (editCustomerName.trim() || 'Walk-in Customer')
      : (editCustomerId ? (customers.find(c => c.id === editCustomerId)?.name || editCustomerName) : (editCustomerName.trim() || 'Walk-in Customer'));

    updateSale(
      sale.id,
      {
        customerId: finalCustomerId,
        customerName: finalCustomerName,
        type: editType,
        paymentMethod: editPaymentMethod,
        status: editStatus,
        createdBy: editCreatedBy,
        createdAt: (() => {
          if (!sale.createdAt) return new Date(editCreatedAt).toISOString();
          const original = new Date(sale.createdAt);
          const originalInput = new Date(original.getTime() - original.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
          return editCreatedAt === originalInput ? sale.createdAt : new Date(editCreatedAt).toISOString();
        })(),
        notes: editNotes,
        items: editingSaleItems,
        subtotal: itemsSubtotal,
        discount: editDiscount,
        tax: editTax,
        deliveryFee: parsedDeliveryFee,
        totalAmount: calculatedTotal,
        paidAmount: sanitizedPaidAmount,
        deliveryAddress: editDeliveryAddress.trim() || undefined,
        deliveryPhone: editDeliveryPhone.trim() || undefined,
        courierNotes: editCourierNotes.trim() || undefined,
        deliveryStatus: editDeliveryStatus,
        isPickupConfirmed: isPickupConfirmed,
      },
      currentUser?.displayName || (isSuperAdmin ? 'Super-Admin' : 'Administrator'),
      isSuperAdmin
    );

    onClose();
    if (onSaved) onSaved();
  };

  if (!sale) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
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
              Invoice: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{sale.invoiceNo}</span> • Original Date: {new Date(sale.createdAt).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
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
                        className="px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800 transition-colors flex items-center gap-1 cursor-pointer"
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
                        className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[11px] font-bold rounded-lg hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer"
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
                        className="text-[10px] font-bold text-slate-400 hover:text-slate-600 cursor-pointer"
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
                        className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
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
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
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
                        className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
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
                    className="text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
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
                    className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
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
                    className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
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
                          className={`w-full text-left p-2.5 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 transition-colors flex items-center justify-between gap-2 cursor-pointer ${
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
                        This sale will be removed from <span className="font-bold">{originalCustomerObj?.name || sale.customerName}</span>'s purchase history and will no longer count towards their Lifetime Value, loyalty points, or outstanding balance.
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
                        const newItem: SaleItem = {
                          productId: prodToAdd.id,
                          productName: prodToAdd.name,
                          sku: prodToAdd.sku,
                          quantity: 1,
                          unitPrice: editType === 'Wholesale' ? prodToAdd.wholesalePrice : prodToAdd.retailPrice,
                          costPrice: prodToAdd.costPrice,
                          total: editType === 'Wholesale' ? prodToAdd.wholesalePrice : prodToAdd.retailPrice,
                          isWholesale: editType === 'Wholesale',
                        };
                        setEditingSaleItems((prev) => [newItem, ...prev]);
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
                        alert('Please enter a valid clearance amount.');
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
                    key={index}
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
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
                  Delivery Fee ({settings.currencySymbol}):
                </label>
                <button
                  type="button"
                  onClick={() => setShowDeliveryDetails(!showDeliveryDetails)}
                  className="text-[9px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                  title="Toggle delivery address and courier notes"
                >
                  <Truck className="w-3 h-3 inline" />
                  <span>{showDeliveryDetails ? 'Hide' : 'Details'}</span>
                </button>
              </div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editDeliveryFee}
                onChange={(e) => handleDeliveryFeeChange(e.target.value)}
                className="w-full px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
              />
              {/* Quick Fee Presets */}
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleDeliveryFeeChange(0)}
                  className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 transition-colors cursor-pointer"
                  title="Set delivery fee to 0 (Free)"
                >
                  Free
                </button>
                {[500, 1000, 1500, 2000, 3000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleDeliveryFeeChange(preset)}
                    className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 transition-colors cursor-pointer"
                  >
                    +{preset >= 1000 ? `${preset / 1000}k` : preset}
                  </button>
                ))}
              </div>
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
                      const tot = Math.max(0, sub - editDiscount + editTax + (Number(editDeliveryFee) || 0));
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
              <div className="mt-1 flex items-center justify-between">
                <label className="flex items-center gap-1.5 cursor-pointer text-[9px] text-slate-600 dark:text-slate-400 font-semibold">
                  <input
                    type="checkbox"
                    checked={autoKeepFullyPaid}
                    onChange={(e) => setAutoKeepFullyPaid(e.target.checked)}
                    className="w-3 h-3 rounded text-indigo-600 accent-indigo-600 cursor-pointer"
                  />
                  <span>Auto-sync with total</span>
                </label>
              </div>
              {(() => {
                const sub = editingSaleItems.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);
                const tot = Math.max(0, sub - editDiscount + editTax + (Number(editDeliveryFee) || 0));
                const unpaid = Math.max(0, tot - editPaidAmount);
                if (unpaid > 0) {
                  return (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold mt-1">
                      ⚠️ Outstanding: {settings.currencySymbol}{(Number(unpaid) || 0).toFixed(2)} (on {editCustomerName || 'customer'})
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

          {/* Delivery & Logistics Dispatch Card */}
          <div className="p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-2xl border border-blue-200/80 dark:border-blue-900/60 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                  <Truck className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">Delivery & Logistics Dispatch</span>
                    {Number(editDeliveryFee) > 0 ? (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                        Fee: {settings.currencySymbol}{(Number(editDeliveryFee) || 0).toLocaleString()}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        No Delivery Fee
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Adjusting delivery fee synchronizes the customer invoice total, delivery orders, and logistics ledger
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowDeliveryDetails(!showDeliveryDetails)}
                className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
              >
                {showDeliveryDetails ? 'Collapse Details' : 'Edit Dispatch Details'}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDeliveryDetails ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {showDeliveryDetails && (
              <div className="pt-2 border-t border-blue-200/60 dark:border-blue-900/40 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
                      Destination Address:
                    </label>
                    {editCustomerId && customers.find((c) => c.id === editCustomerId)?.address && (
                      <button
                        type="button"
                        onClick={() => {
                          const c = customers.find((cust) => cust.id === editCustomerId);
                          if (c?.address) setEditDeliveryAddress(c.address);
                        }}
                        className="text-[9px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Use Customer Address
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <MapPin className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="e.g. 14 Admiralty Way, Lekki Phase 1, Lagos"
                      value={editDeliveryAddress}
                      onChange={(e) => setEditDeliveryAddress(e.target.value)}
                      className="w-full pl-8 pr-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
                      Contact Phone for Delivery:
                    </label>
                    {editCustomerId && customers.find((c) => c.id === editCustomerId)?.phone && (
                      <button
                        type="button"
                        onClick={() => {
                          const c = customers.find((cust) => cust.id === editCustomerId);
                          if (c?.phone) setEditDeliveryPhone(c.phone);
                        }}
                        className="text-[9px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Use Customer Phone
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="e.g. +234 801 234 5678"
                      value={editDeliveryPhone}
                      onChange={(e) => setEditDeliveryPhone(e.target.value)}
                      className="w-full pl-8 pr-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Delivery Status:
                  </label>
                  <select
                    value={editDeliveryStatus}
                    onChange={(e) => setEditDeliveryStatus(e.target.value as DeliveryStatus)}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-semibold text-slate-900 dark:text-white"
                  >
                    <option value="Pending Pickup">Pending Pickup</option>
                    <option value="Picked Up">Picked Up</option>
                    <option value="Out for Delivery">Out for Delivery</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Courier / Rider Notes:
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Assigned to Rider Ahmed (08099887766)"
                    value={editCourierNotes}
                    onChange={(e) => setEditCourierNotes(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs text-slate-900 dark:text-white"
                  />
                </div>

                <div className="sm:col-span-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPickupConfirmed}
                      onChange={(e) => setIsPickupConfirmed(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 accent-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Confirm Pickup (marks courier pickup confirmed and triggers logistics ledger expense)
                    </span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] text-slate-500 font-medium">Recalculated Total</p>
            <p className="text-base font-black text-slate-900 dark:text-white">
              {settings.currencySymbol}
              {(Number(editCalculatedTotal) || 0).toFixed(2)}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
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
  );
};
