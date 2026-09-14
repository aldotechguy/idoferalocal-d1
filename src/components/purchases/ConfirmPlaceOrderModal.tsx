import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  Building,
  Banknote,
  TrendingUp,
  AlertTriangle,
  FileCheck,
} from 'lucide-react';
import { PurchaseOrder, LiquidAccountType } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

interface ConfirmPlaceOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder;
  onOrderPlaced: () => void;
}

export const ConfirmPlaceOrderModal: React.FC<ConfirmPlaceOrderModalProps> = ({
  isOpen,
  onClose,
  po,
  onOrderPlaced,
}) => {
  const {
    settings,
    updatePurchaseOrder,
    treasuryBalances,
    addMoneyMovement,
    products,
    updateProduct,
    changeProductPrice,
    addNotification,
    showToast,
  } = useApp();
  const { currentUser } = useAuth();

  const [paymentStatus, setPaymentStatus] = useState<'Unpaid' | 'Paid'>('Unpaid');
  const [paymentSource, setPaymentSource] = useState<LiquidAccountType>('Biz Account');
  const [updateCatalogCosts, setUpdateCatalogCosts] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !po) return null;

  const handleConfirm = () => {
    setIsSubmitting(true);

    try {
      const grandTotal = po.totalAmount;
      const isPaid = paymentStatus === 'Paid';

      // 1. Update the Purchase Order status from 'Draft' to 'Pending'
      updatePurchaseOrder(
        po.id,
        {
          deliveryStatus: 'Pending',
          isDraft: false,
          paymentStatus: isPaid ? 'Paid' : 'Unpaid',
          paidAmount: isPaid ? grandTotal : 0,
          updatedAt: new Date().toISOString(),
          notes: po.notes
            ? `${po.notes}\n[Confirmed & Placed from Draft by ${currentUser?.displayName || 'Purchaser'}]`
            : `Confirmed & Placed from Draft by ${currentUser?.displayName || 'Purchaser'} on ${new Date().toLocaleDateString()}`,
        },
        currentUser?.displayName || 'Purchasing Officer'
      );

      // 2. If Prepaid, deduct from treasury
      if (isPaid && grandTotal > 0) {
        addMoneyMovement({
          date: new Date().toISOString(),
          type: 'Supplier Payment',
          subtype: `PO #${po.poNumber}`,
          sourceAccount: paymentSource,
          amount: grandTotal,
          referenceNo: po.poNumber,
          performedBy: currentUser?.displayName || 'Purchasing Officer',
          notes: `Official prepayment for PO #${po.poNumber} to ${po.supplierName} from ${paymentSource}`,
        });
      }

      // 3. Update catalog costs if enabled
      if (updateCatalogCosts) {
        po.items.forEach((item) => {
          const prod = products.find((p) => p.id === item.productId);
          if (!prod) return;

          if (item.unitCost !== prod.costPrice) {
            updateProduct(
              prod.id,
              { costPrice: item.unitCost },
              `PO Cost Price updated from ${settings.currencySymbol}${prod.costPrice.toFixed(2)} to ${settings.currencySymbol}${item.unitCost.toFixed(2)} (${po.poNumber})`
            );

            if (item.unitCost > prod.costPrice) {
              addNotification({
                title: 'Cost Price Increase Alert',
                message: `Cost price for "${prod.name}" increased to ${settings.currencySymbol}${item.unitCost.toFixed(2)} in PO #${po.poNumber}. Review retail prices to protect gross margin.`,
                type: 'price_increase_alert',
              });
            }
          }
        });
      }

      showToast({
        title: 'Purchase Order Placed',
        message: `PO #${po.poNumber} has been officially placed into the system.`,
        type: 'success',
      });

      onOrderPlaced();
      onClose();
    } catch (err) {
      console.error('Failed to place order', err);
      showToast({
        title: 'Placement Failed',
        message: 'Could not place purchase order. Please check data and try again.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full p-6 my-auto max-h-[90vh] overflow-y-auto space-y-5">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 rounded-2xl">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                Place Official Purchase Order
              </h3>
              <p className="text-xs text-slate-500">
                Confirm order details after supplier quotation verification.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Order Details Brief */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 space-y-2.5 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-slate-500">PO Reference:</span>
            <span className="font-mono font-bold text-slate-900 dark:text-white">{po.poNumber}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Supplier Vendor:</span>
            <span className="font-bold text-slate-900 dark:text-white">{po.supplierName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Expected Delivery:</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">{po.expectedDelivery}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Total Items ({po.items.length}):</span>
            <span className="font-mono font-medium">
              {po.items.reduce((sum, i) => sum + i.quantity, 0)} units
            </span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-slate-700">
            <span className="font-bold text-slate-700 dark:text-slate-300">Total Order Amount:</span>
            <span className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400">
              {settings.currencySymbol}{po.totalAmount.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Payment Terms */}
        <div className="space-y-3">
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
            Initial Payment Settlement
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPaymentStatus('Unpaid')}
              className={`p-3 rounded-2xl border text-left transition-all ${
                paymentStatus === 'Unpaid'
                  ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 ring-1 ring-blue-500'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
              }`}
            >
              <p className="font-bold text-xs">Unpaid (Credit)</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Pay after delivery or inspection</p>
            </button>

            <button
              type="button"
              onClick={() => setPaymentStatus('Paid')}
              className={`p-3 rounded-2xl border text-left transition-all ${
                paymentStatus === 'Paid'
                  ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-100 ring-1 ring-emerald-500'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
              }`}
            >
              <p className="font-bold text-xs">Prepaid (100% Paid)</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Deduct from cash/bank now</p>
            </button>
          </div>

          {paymentStatus === 'Paid' && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 space-y-2 animate-in fade-in duration-150">
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Deduct Prepayment From:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentSource('Biz Account')}
                  className={`p-2.5 rounded-xl border text-left flex items-center justify-between text-xs transition-all ${
                    paymentSource === 'Biz Account'
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100 ring-1 ring-blue-500 font-bold'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-blue-600" />
                    <span>Biz Account</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {settings.currencySymbol}{treasuryBalances.bizAccountBalance.toLocaleString()}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentSource('Physical Cash')}
                  className={`p-2.5 rounded-xl border text-left flex items-center justify-between text-xs transition-all ${
                    paymentSource === 'Physical Cash'
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-100 ring-1 ring-emerald-500 font-bold'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Physical Cash</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {settings.currencySymbol}{treasuryBalances.physicalCashBalance.toLocaleString()}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Catalog Cost Prices Option */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 flex items-start gap-2.5">
          <input
            type="checkbox"
            id="updateCatalogCostsCheckbox"
            checked={updateCatalogCosts}
            onChange={(e) => setUpdateCatalogCosts(e.target.checked)}
            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 mt-0.5"
          />
          <label htmlFor="updateCatalogCostsCheckbox" className="text-xs text-slate-700 dark:text-slate-300 select-none cursor-pointer">
            <span className="font-bold block">Update Inventory Catalog Cost Prices</span>
            <span className="text-[11px] text-slate-500">
              Synchronize catalog cost prices with the confirmed unit prices from this purchase order.
            </span>
          </label>
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSubmitting ? 'Placing Order...' : 'Confirm & Place Official PO'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
