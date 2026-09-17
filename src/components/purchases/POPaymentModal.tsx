import React, { useState, useEffect } from 'react';
import { X, CreditCard, Receipt, Building, Wallet, Banknote } from 'lucide-react';
import { NairaSign } from '../common/NairaSign';
import { PurchaseOrder, PaymentMethod, LiquidAccountType } from '../../types';
import { useApp } from '../../context/AppContext';
import { useInteractions } from '../../context/InteractionContext';

interface POPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder;
  currentUserName: string;
}

export const POPaymentModal: React.FC<POPaymentModalProps> = ({
  isOpen,
  onClose,
  po,
  currentUserName,
}) => {
  const { updatePOPayment, settings, treasuryBalances } = useApp();
  const { notify, confirm } = useInteractions();

  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentSource, setPaymentSource] = useState<LiquidAccountType>('Biz Account');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Bank Transfer');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (po) {
      const remaining = Math.max(0, po.totalAmount - po.paidAmount);
      setPaymentAmount(remaining);
      setNotes('');
      setPaymentSource('Biz Account');
      setPaymentMethod('Bank Transfer');
    }
  }, [po]);

  if (!isOpen || !po) return null;

  const remainingBalance = Math.max(0, po.totalAmount - po.paidAmount);

  const handleSourceSelect = (source: LiquidAccountType) => {
    setPaymentSource(source);
    if (source === 'Physical Cash') {
      setPaymentMethod('Cash');
    } else {
      setPaymentMethod('Bank Transfer');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentAmount <= 0) {
      notify('Please enter a valid payment amount greater than zero.', 'Invalid payment amount');
      return;
    }

    const available =
      paymentSource === 'Biz Account'
        ? treasuryBalances.bizAccountBalance
        : treasuryBalances.physicalCashBalance;

    if (paymentAmount > available) {
      const proceed = await confirm({ title: 'Available balance exceeded', message: `Payment of ${settings.currencySymbol}${paymentAmount.toLocaleString()} exceeds the ${settings.currencySymbol}${available.toLocaleString()} available in ${paymentSource}.`, confirmText: 'Record payment', variant: 'warning' });
      if (!proceed) return;
    }

    updatePOPayment(po.id, {
      additionalPaidAmount: paymentAmount,
      paymentMethod,
      notes: notes ? `${notes} [Paid via ${paymentSource}]` : `Paid via ${paymentSource}`,
      performedBy: currentUserName || 'Admin',
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-5 my-auto max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 rounded-xl">
              <NairaSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Record Supplier Payment</h3>
              <p className="text-xs text-slate-400 font-mono">{po.poNumber} • {po.supplierName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Financial Breakdown Card */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-center text-xs">
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400">Total PO Value</p>
            <p className="font-black text-slate-900 dark:text-white font-mono">{settings.currencySymbol}{(Number(po.totalAmount) || 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400">Already Paid</p>
            <p className="font-black text-emerald-600 dark:text-emerald-400 font-mono">{settings.currencySymbol}{(Number(po.paidAmount) || 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400">Balance Due</p>
            <p className="font-black text-rose-600 dark:text-rose-400 font-mono">{settings.currencySymbol}{(Number(remainingBalance) || 0).toFixed(2)}</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
              Payment Amount ({settings.currencySymbol}) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={remainingBalance > 0 ? remainingBalance : undefined}
              required
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
              className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-base font-black text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          {/* Payment Source Selection */}
          <div>
            <label className="block font-bold mb-1.5 text-slate-700 dark:text-slate-300">
              Payment Source Account *
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleSourceSelect('Biz Account')}
                className={`p-3 rounded-2xl border text-left flex flex-col justify-between transition-all ${
                  paymentSource === 'Biz Account'
                    ? 'border-blue-600 bg-blue-50/90 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 ring-2 ring-blue-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`p-1.5 rounded-lg ${paymentSource === 'Biz Account' ? 'bg-blue-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                    <Building className="w-3.5 h-3.5" />
                  </div>
                  <span className="font-extrabold text-xs">Biz Account</span>
                </div>
                <p className="text-[10px] text-slate-400">
                  Avail: <strong className="font-mono text-slate-700 dark:text-slate-300">{settings.currencySymbol}{treasuryBalances.bizAccountBalance.toLocaleString()}</strong>
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleSourceSelect('Physical Cash')}
                className={`p-3 rounded-2xl border text-left flex flex-col justify-between transition-all ${
                  paymentSource === 'Physical Cash'
                    ? 'border-emerald-600 bg-emerald-50/90 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-100 ring-2 ring-emerald-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`p-1.5 rounded-lg ${paymentSource === 'Physical Cash' ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                    <Banknote className="w-3.5 h-3.5" />
                  </div>
                  <span className="font-extrabold text-xs">Physical Cash</span>
                </div>
                <p className="text-[10px] text-slate-400">
                  Avail: <strong className="font-mono text-slate-700 dark:text-slate-300">{settings.currencySymbol}{treasuryBalances.physicalCashBalance.toLocaleString()}</strong>
                </p>
              </button>
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
              Payment Method *
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => {
                const method = e.target.value as PaymentMethod;
                setPaymentMethod(method);
                if (method === 'Cash') {
                  setPaymentSource('Physical Cash');
                } else {
                  setPaymentSource('Biz Account');
                }
              }}
              className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            >
              {paymentSource === 'Biz Account' ? (
                <>
                  <option value="Bank Transfer">Bank Transfer (Biz Account)</option>
                  <option value="Mobile Transfer">Mobile Transfer (Biz Account)</option>
                  <option value="Card">Corporate Debit/POS Card</option>
                  <option value="Store Credit">Store Credit / Cheque</option>
                </>
              ) : (
                <>
                  <option value="Cash">Physical Cash (Till)</option>
                </>
              )}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
              Payment Reference / Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Bank ref #TXN-98421 / Cash voucher receipt"
              className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold rounded-xl text-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs transition-colors"
            >
              Submit Supplier Payment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
