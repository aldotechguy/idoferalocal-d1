import React, { useState, useMemo, useEffect } from 'react';
import {
  Sale,
  RestockCondition,
  RefundSettlementMethod,
  ProcessRefundOptions,
} from '../../types';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useInteractions } from '../../context/InteractionContext';
import {
  X,
  RotateCcw,
  AlertCircle,
  Package,
  CheckCircle2,
  DollarSign,
  CreditCard,
  Building2,
  UserCheck,
  Layers,
  Sparkles,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  History,
  Truck,
  Percent,
} from 'lucide-react';

interface ProcessSaleRefundModalProps {
  sale: Sale | null;
  onClose: () => void;
  onRefundCompleted?: (saleId: string) => void;
}

interface ItemReturnState {
  productId: string;
  productName: string;
  sku: string;
  purchasedQty: number;
  alreadyReturnedQty: number;
  remainingQty: number;
  returnQty: number;
  condition: RestockCondition;
  unitPrice: number;
  costPrice: number;
  isClearance?: boolean;
}

export const ProcessSaleRefundModal: React.FC<ProcessSaleRefundModalProps> = ({
  sale,
  onClose,
  onRefundCompleted,
}) => {
  const { customers, settings, refundSale } = useApp();
  const { currentUser } = useAuth();
  // Unified-mall convention: no native dialogs. `notify` renders in the app's own
  // toast layer, so a blocked or failed refund stays visible without the browser
  // chrome stalling the flow. Enforced by scripts/audit-frontend.mjs, which
  // rejects native dialog calls in components.
  const { notify } = useInteractions();

  const [returnMode, setReturnMode] = useState<'partial' | 'full'>('partial');
  const [refundReason, setRefundReason] = useState('Customer returned item');
  const [customNotes, setCustomNotes] = useState('');
  const [refundDeliveryFee, setRefundDeliveryFee] = useState(false);
  const [settlementMethod, setSettlementMethod] = useState<RefundSettlementMethod>('Cash');
  const [showPriorRefunds, setShowPriorRefunds] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize line items with return tracking
  const [itemStates, setItemStates] = useState<ItemReturnState[]>([]);

  // Find linked customer
  const linkedCustomer = useMemo(() => {
    if (!sale) return null;
    return customers.find(
      (c) =>
        (sale.customerId && c.id === sale.customerId) ||
        (sale.customerName &&
          sale.customerName.toLowerCase() !== 'walk-in customer' &&
          c.name.trim().toLowerCase() === sale.customerName.trim().toLowerCase())
    );
  }, [sale, customers]);

  // Set initial items state whenever sale opens
  useEffect(() => {
    if (!sale) {
      setItemStates([]);
      return;
    }

    // Defensive parity guard: a refund written by the Mall admin API — or by any
    // build predating the returned_qty columns — can set status='Refunded' without
    // per-line return records. Reading that as "nothing returned yet" would let POS
    // refund and restock the same goods a second time, so a fully-Refunded sale
    // with no refund records is treated as having returned every line.
    const legacyFullRefund = sale.status === 'Refunded' && !(sale.refunds && sale.refunds.length > 0);

    const initial = sale.items.map((it) => {
      const alreadyReturned = legacyFullRefund
        ? Number(it.quantity) || 0
        : Number(it.returnedQuantity) || 0;
      const remaining = Math.max(0, it.quantity - alreadyReturned);
      return {
        productId: it.productId,
        productName: it.productName,
        sku: it.sku || '',
        purchasedQty: it.quantity,
        alreadyReturnedQty: alreadyReturned,
        remainingQty: remaining,
        // In partial mode, default to 0 so the user explicitly chooses what is being returned,
        // or if there's only 1 line item with 1 qty, default to 1 for speed.
        returnQty: sale.items.length === 1 && remaining === 1 ? 1 : 0,
        condition: 'Restock' as RestockCondition,
        unitPrice: Number(it.unitPrice) || 0,
        costPrice: Number(it.costPrice) || 0,
        isClearance: it.isClearance || it.productId.startsWith('clearance-'),
      };
    });

    setItemStates(initial);
    setRefundDeliveryFee(false);
    setReturnMode('partial');
    setRefundReason('Customer returned item');
    setCustomNotes('');

    // Smart default settlement
    if (linkedCustomer && (Number(linkedCustomer.outstandingBalance) || 0) > 0) {
      setSettlementMethod('Debt Reduction');
    } else if (linkedCustomer) {
      setSettlementMethod('Store Credit');
    } else if (sale.paymentMethod === 'Bank Transfer' || sale.paymentMethod === 'Card') {
      setSettlementMethod('Biz Account');
    } else {
      setSettlementMethod('Cash');
    }
  }, [sale, linkedCustomer]);

  // Handle Full vs Partial toggle
  const handleToggleMode = (newMode: 'partial' | 'full') => {
    setReturnMode(newMode);
    if (newMode === 'full') {
      setItemStates((prev) =>
        prev.map((it) => ({
          ...it,
          returnQty: it.remainingQty,
        }))
      );
      if (Number(sale?.deliveryFee) > 0) {
        setRefundDeliveryFee(true);
      }
    } else {
      // Keep existing choices or reset to 0
      setItemStates((prev) =>
        prev.map((it) => ({
          ...it,
          returnQty: 0,
        }))
      );
      setRefundDeliveryFee(false);
    }
  };

  const handleUpdateItemQty = (productId: string, qty: number) => {
    setItemStates((prev) =>
      prev.map((it) => {
        if (it.productId !== productId) return it;
        const clamped = Math.max(0, Math.min(it.remainingQty, qty));
        return { ...it, returnQty: clamped };
      })
    );
  };

  const handleUpdateItemCondition = (productId: string, condition: RestockCondition) => {
    setItemStates((prev) =>
      prev.map((it) => (it.productId === productId ? { ...it, condition } : it))
    );
  };

  const handleSelectAllForItem = (productId: string) => {
    setItemStates((prev) =>
      prev.map((it) =>
        it.productId === productId ? { ...it, returnQty: it.remainingQty } : it
      )
    );
  };

  const handleClearItem = (productId: string) => {
    setItemStates((prev) =>
      prev.map((it) =>
        it.productId === productId ? { ...it, returnQty: 0 } : it
      )
    );
  };

  // Financial Calculations
  const {
    totalUnitsBeingReturned,
    totalRemainingUnitsAfterThis,
    grossItemsSubtotal,
    proratedDiscount,
    proratedTax,
    deliveryFeeAmount,
    netRefundAmount,
    isWillResultInFullRefund,
  } = useMemo(() => {
    if (!sale) {
      return {
        totalUnitsBeingReturned: 0,
        totalRemainingUnitsAfterThis: 0,
        grossItemsSubtotal: 0,
        proratedDiscount: 0,
        proratedTax: 0,
        deliveryFeeAmount: 0,
        netRefundAmount: 0,
        isWillResultInFullRefund: false,
      };
    }

    const unitsReturning = itemStates.reduce((acc, it) => acc + (it.returnQty || 0), 0);
    const unitsRemainingAfter = itemStates.reduce(
      (acc, it) => acc + (it.remainingQty - (it.returnQty || 0)),
      0
    );
    const grossSub = itemStates.reduce(
      (acc, it) => acc + (it.returnQty || 0) * it.unitPrice,
      0
    );

    const saleBaseSubtotal =
      sale.subtotal ||
      sale.items.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);

    const discountProrated =
      saleBaseSubtotal > 0 && Number(sale.discount) > 0
        ? Math.round(((grossSub / saleBaseSubtotal) * Number(sale.discount)) * 100) / 100
        : 0;

    const taxProrated =
      saleBaseSubtotal > 0 && Number(sale.tax) > 0
        ? Math.round(((grossSub / saleBaseSubtotal) * Number(sale.tax)) * 100) / 100
        : 0;

    const delivFee = refundDeliveryFee ? Number(sale.deliveryFee) || 0 : 0;

    const net = Math.max(
      0,
      Math.round((grossSub - discountProrated + taxProrated + delivFee) * 100) / 100
    );

    const willBeFull = unitsRemainingAfter === 0 && unitsReturning > 0;

    return {
      totalUnitsBeingReturned: unitsReturning,
      totalRemainingUnitsAfterThis: unitsRemainingAfter,
      grossItemsSubtotal: grossSub,
      proratedDiscount: discountProrated,
      proratedTax: taxProrated,
      deliveryFeeAmount: delivFee,
      netRefundAmount: net,
      isWillResultInFullRefund: willBeFull,
    };
  }, [sale, itemStates, refundDeliveryFee]);

  if (!sale) return null;

  const quickReasonPresets = [
    'Customer returned item',
    'Wrong size / item mismatch',
    'Defective / damaged item',
    'Customer changed mind',
    'Overcharged / billing adjustment',
  ];

  const handleConfirmRefund = () => {
    if (totalUnitsBeingReturned === 0) {
      notify('Please specify at least 1 item quantity to return.', 'Nothing to return', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const returnPayload: ProcessRefundOptions = {
        itemsToReturn: itemStates
          .filter((it) => it.returnQty > 0)
          .map((it) => ({
            productId: it.productId,
            productName: it.productName,
            sku: it.sku,
            quantity: it.returnQty,
            unitPrice: it.unitPrice,
            costPrice: it.costPrice,
            condition: it.condition,
          })),
        refundDeliveryFee,
        settlementMethod,
        customNotes: customNotes.trim() || undefined,
      };

      refundSale(
        sale.id,
        refundReason.trim() || 'Customer return',
        currentUser?.displayName || currentUser?.username || 'Staff',
        returnPayload
      );

      if (onRefundCompleted) {
        onRefundCompleted(sale.id);
      }
      onClose();
    } catch (err) {
      console.error('Refund processing error:', err);
      notify('An error occurred while processing this return.', 'Refund failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const priorRefundRecords = sale.refunds || [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-3xl w-full p-4 sm:p-6 space-y-4 my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-slate-100 dark:border-slate-800 pb-3 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 rounded-xl">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Process Sale Return & Refund</span>
                  {sale.status === 'Partially Refunded' && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                      Partially Refunded
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Invoice <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{sale.invoiceNo}</span> • Customer: <span className="font-bold text-slate-800 dark:text-slate-200">{sale.customerName}</span>
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="space-y-4 overflow-y-auto pr-1 flex-1">
          {/* Mode Selector Tabs */}
          <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800/70 p-1.5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
            <div className="flex gap-1 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => handleToggleMode('partial')}
                className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  returnMode === 'partial'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Partial Item Return</span>
              </button>
              <button
                type="button"
                onClick={() => handleToggleMode('full')}
                className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  returnMode === 'full'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Return All Remaining Items</span>
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 pr-2">
              <span>Original Total:</span>
              <span className="font-extrabold text-slate-900 dark:text-white">
                {settings.currencySymbol}
                {(Number(sale.totalAmount) || 0).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Prior Refunds Alert Accordion */}
          {priorRefundRecords.length > 0 && (
            <div className="border border-blue-200/70 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 rounded-2xl p-3 text-xs space-y-2">
              <button
                type="button"
                onClick={() => setShowPriorRefunds(!showPriorRefunds)}
                className="w-full flex items-center justify-between text-blue-900 dark:text-blue-200 font-bold cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>
                    This sale has {priorRefundRecords.length} prior return record(s) (Total refunded so far:{' '}
                    {settings.currencySymbol}
                    {(Number(sale.totalRefunded) || 0).toFixed(2)})
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 font-semibold">
                  <span>{showPriorRefunds ? 'Hide Details' : 'View History'}</span>
                  {showPriorRefunds ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
              </button>

              {showPriorRefunds && (
                <div className="space-y-2 pt-2 border-t border-blue-200/60 dark:border-blue-900/40">
                  {priorRefundRecords.map((ref) => (
                    <div
                      key={ref.id}
                      className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-blue-100 dark:border-blue-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-blue-700 dark:text-blue-300">
                            {ref.refundNo}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(ref.refundDate).toLocaleString()}
                          </span>
                          <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[9px] font-bold">
                            via {ref.settlementMethod}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Reason: {ref.reason} • Items: {ref.items?.map((i) => `${i.quantityReturned}x ${i.productName}`).join(', ')}
                        </p>
                      </div>
                      <span className="font-black text-xs text-rose-600 dark:text-rose-400 self-end sm:self-center">
                        -{settings.currencySymbol}
                        {Number(ref.netRefundAmount || 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Line Items Return Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Package className="w-4 h-4 text-indigo-500" />
                <span>Line Items to Return</span>
              </label>
              <div className="text-[11px] text-slate-500 flex items-center gap-2">
                <span>Selected to return: <b className="text-slate-900 dark:text-white">{totalUnitsBeingReturned} units</b></span>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
              {itemStates.map((it) => {
                const isItemFullyReturned = it.remainingQty === 0;

                return (
                  <div
                    key={it.productId}
                    className={`p-3.5 transition-colors ${
                      isItemFullyReturned
                        ? 'bg-slate-50/60 dark:bg-slate-800/30 opacity-70'
                        : it.returnQty > 0
                        ? 'bg-amber-50/40 dark:bg-amber-950/20'
                        : 'bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      {/* Product Info */}
                      <div className="space-y-1 min-w-[200px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            {it.productName}
                          </span>
                          {it.isClearance && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              Clearance
                            </span>
                          )}
                          {isItemFullyReturned && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
                              Fully Returned
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-slate-500">
                          {it.sku && <span>SKU: {it.sku}</span>}
                          <span>Price: {settings.currencySymbol}{(Number(it.unitPrice) || 0).toFixed(2)}</span>
                          <span>Purchased: {it.purchasedQty}</span>
                          {it.alreadyReturnedQty > 0 && (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              (Prev returned: {it.alreadyReturnedQty})
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Stepper & Controls */}
                      {!isItemFullyReturned ? (
                        <div className="flex items-center gap-3 self-end sm:self-center flex-wrap">
                          {/* Stepper */}
                          <div className="flex items-center border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 p-0.5 shadow-2xs">
                            <button
                              type="button"
                              onClick={() => handleUpdateItemQty(it.productId, it.returnQty - 1)}
                              disabled={it.returnQty <= 0}
                              className="w-7 h-7 flex items-center justify-center font-bold text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="0"
                              max={it.remainingQty}
                              value={it.returnQty}
                              onChange={(e) =>
                                handleUpdateItemQty(it.productId, parseInt(e.target.value) || 0)
                              }
                              className="w-12 text-center text-xs font-black text-slate-900 dark:text-white bg-transparent border-none focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdateItemQty(it.productId, it.returnQty + 1)}
                              disabled={it.returnQty >= it.remainingQty}
                              className="w-7 h-7 flex items-center justify-center font-bold text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                              +
                            </button>
                          </div>

                          {/* Quick Return All */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleSelectAllForItem(it.productId)}
                              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors cursor-pointer"
                              title={`Return maximum available (${it.remainingQty})`}
                            >
                              Max ({it.remainingQty})
                            </button>
                            {it.returnQty > 0 && (
                              <button
                                type="button"
                                onClick={() => handleClearItem(it.productId)}
                                className="px-1.5 py-1 text-[10px] font-semibold text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                              >
                                Clear
                              </button>
                            )}
                          </div>

                          {/* Restock Condition Dropdown */}
                          {it.returnQty > 0 && (
                            <select
                              value={it.condition}
                              onChange={(e) =>
                                handleUpdateItemCondition(
                                  it.productId,
                                  e.target.value as RestockCondition
                                )
                              }
                              className="px-2.5 py-1 text-[11px] font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                            >
                              <option value="Restock">🟢 Restock (Sellable)</option>
                              <option value="Damaged">🟠 Damaged / Defective</option>
                              <option value="Discard">⚪ Discard / No Restock</option>
                            </select>
                          )}

                          {/* Line total */}
                          <div className="min-w-[70px] text-right font-black text-xs text-slate-900 dark:text-white">
                            {settings.currencySymbol}
                            {(it.returnQty * it.unitPrice).toFixed(2)}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 font-semibold italic">
                          No remaining units to return
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Delivery Fee Refund Toggle (if delivery fee existed on sale) */}
          {Number(sale.deliveryFee) > 0 && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-500" />
                <div>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Delivery Fee ({settings.currencySymbol}{(Number(sale.deliveryFee) || 0).toFixed(2)})
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Logistics fee was collected on original checkout. Should this fee also be returned?
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={refundDeliveryFee}
                  onChange={(e) => setRefundDeliveryFee(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 accent-indigo-600 cursor-pointer"
                />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Refund Fee
                </span>
              </label>
            </div>
          )}

          {/* Reason & Settlement Options Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Reason */}
            <div className="space-y-1.5 p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
              <label className="block text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Reason for Return
              </label>
              <input
                type="text"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Reason for return..."
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
              />

              {/* Quick reason presets */}
              <div className="flex flex-wrap gap-1 pt-1">
                {quickReasonPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRefundReason(preset)}
                    className="px-2 py-0.5 text-[10px] font-semibold rounded-lg bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 transition-colors cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Refund Settlement Payout Method */}
            <div className="space-y-1.5 p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
              <label className="block text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Settlement & Payout Method
              </label>
              <div className="space-y-1.5">
                {/* Cash */}
                <label
                  className={`flex items-center justify-between p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                    settlementMethod === 'Cash'
                      ? 'bg-white dark:bg-slate-900 border-indigo-500 shadow-xs text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="settlement"
                      checked={settlementMethod === 'Cash'}
                      onChange={() => setSettlementMethod('Cash')}
                      className="accent-indigo-600"
                    />
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Cash Payout (Physical Cash Register)</span>
                  </div>
                </label>

                {/* Biz Account */}
                <label
                  className={`flex items-center justify-between p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                    settlementMethod === 'Biz Account'
                      ? 'bg-white dark:bg-slate-900 border-indigo-500 shadow-xs text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="settlement"
                      checked={settlementMethod === 'Biz Account'}
                      onChange={() => setSettlementMethod('Biz Account')}
                      className="accent-indigo-600"
                    />
                    <Building2 className="w-3.5 h-3.5 text-blue-600" />
                    <span>Bank / POS Transfer (Biz Account)</span>
                  </div>
                </label>

                {/* Store Credit */}
                <label
                  className={`flex items-center justify-between p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                    settlementMethod === 'Store Credit'
                      ? 'bg-white dark:bg-slate-900 border-indigo-500 shadow-xs text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="settlement"
                      checked={settlementMethod === 'Store Credit'}
                      onChange={() => setSettlementMethod('Store Credit')}
                      className="accent-indigo-600"
                    />
                    <CreditCard className="w-3.5 h-3.5 text-purple-600" />
                    <span>Store Credit (Customer Overage Balance)</span>
                  </div>
                  {linkedCustomer && (
                    <span className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold">
                      Balance: {settings.currencySymbol}{(Number(linkedCustomer.overageBalance) || 0).toFixed(2)}
                    </span>
                  )}
                </label>

                {/* Debt Reduction */}
                <label
                  className={`flex items-center justify-between p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                    settlementMethod === 'Debt Reduction'
                      ? 'bg-white dark:bg-slate-900 border-indigo-500 shadow-xs text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="settlement"
                      checked={settlementMethod === 'Debt Reduction'}
                      onChange={() => setSettlementMethod('Debt Reduction')}
                      className="accent-indigo-600"
                    />
                    <Percent className="w-3.5 h-3.5 text-amber-600" />
                    <span>Deduct from Outstanding Debt (Customer Ledger)</span>
                  </div>
                  {linkedCustomer && (Number(linkedCustomer.outstandingBalance) || 0) > 0 && (
                    <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold">
                      Debt: {settings.currencySymbol}{(Number(linkedCustomer.outstandingBalance) || 0).toFixed(2)}
                    </span>
                  )}
                </label>
              </div>
            </div>
          </div>

          {/* Internal notes */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
              Internal Return Notes / Staff Memo:
            </label>
            <input
              type="text"
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              placeholder="e.g. Inspected by supervisor, approved partial credit..."
              className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
            />
          </div>

          {/* Financial Recalculation Card */}
          <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50/40 dark:from-slate-800/80 dark:to-slate-800/40 rounded-2xl border border-amber-200/80 dark:border-slate-700/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">Gross Return Subtotal:</span>
              <span className="font-bold text-slate-900 dark:text-white">
                {settings.currencySymbol}{grossItemsSubtotal.toFixed(2)}
              </span>
            </div>

            {proratedDiscount > 0 && (
              <div className="flex items-center justify-between text-xs text-rose-600 dark:text-rose-400">
                <span>Less Prorated Order Discount:</span>
                <span className="font-bold">
                  -{settings.currencySymbol}{proratedDiscount.toFixed(2)}
                </span>
              </div>
            )}

            {proratedTax > 0 && (
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span>Plus Prorated Tax:</span>
                <span className="font-bold">
                  +{settings.currencySymbol}{proratedTax.toFixed(2)}
                </span>
              </div>
            )}

            {deliveryFeeAmount > 0 && (
              <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-400">
                <span>Delivery Fee Refunded:</span>
                <span className="font-bold">
                  +{settings.currencySymbol}{deliveryFeeAmount.toFixed(2)}
                </span>
              </div>
            )}

            <div className="pt-2 border-t border-amber-200/80 dark:border-slate-700 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Net Refund Amount to Customer:
                </span>
                <p className="text-[10px] text-slate-500">
                  {isWillResultInFullRefund
                    ? '100% of order will be marked as Refunded'
                    : `Partial return (${totalRemainingUnitsAfterThis} units remaining held by customer)`}
                </p>
              </div>
              <span className="text-lg font-black text-amber-700 dark:text-amber-400">
                {settings.currencySymbol}{netRefundAmount.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500">
            <span>Staff: <b>{currentUser?.displayName || currentUser?.username || 'Staff'}</b></span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 rounded-xl cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={totalUnitsBeingReturned === 0 || isSubmitting}
              onClick={handleConfirmRefund}
              className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>
                {isSubmitting
                  ? 'Processing Return...'
                  : isWillResultInFullRefund
                  ? `Confirm Full Refund (${settings.currencySymbol}${netRefundAmount.toFixed(2)})`
                  : `Confirm Partial Return (${settings.currencySymbol}${netRefundAmount.toFixed(2)})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
