import React, { useState, useEffect } from 'react';
import { X, ArrowRightLeft, Building, Banknote, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { LiquidAccountType } from '../../types';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserName: string;
  defaultDirection?: 'CashToBank' | 'BankToCash';
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  currentUserName,
  defaultDirection = 'CashToBank',
}) => {
  const { treasuryBalances, transferBetweenAccounts, settings } = useApp();

  const [fromAccount, setFromAccount] = useState<LiquidAccountType>(
    defaultDirection === 'CashToBank' ? 'Physical Cash' : 'Biz Account'
  );
  const [toAccount, setToAccount] = useState<LiquidAccountType>(
    defaultDirection === 'CashToBank' ? 'Biz Account' : 'Physical Cash'
  );
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (isOpen) {
      if (defaultDirection === 'CashToBank') {
        setFromAccount('Physical Cash');
        setToAccount('Biz Account');
      } else {
        setFromAccount('Biz Account');
        setToAccount('Physical Cash');
      }
      setAmount('');
      setNotes('');
      setReferenceNo('');
      setDate(new Date().toISOString().split('T')[0]);
    }
  }, [isOpen, defaultDirection]);

  if (!isOpen) return null;

  const sourceBalance =
    fromAccount === 'Biz Account'
      ? (treasuryBalances?.bizAccountBalance ?? 0)
      : (treasuryBalances?.physicalCashBalance ?? 0);

  const destBalance =
    toAccount === 'Biz Account'
      ? (treasuryBalances?.bizAccountBalance ?? 0)
      : (treasuryBalances?.physicalCashBalance ?? 0);

  const numAmount = parseFloat(amount) || 0;
  const projectedSourceBalance = sourceBalance - numAmount;
  const projectedDestBalance = destBalance + numAmount;
  const isOverdraft = numAmount > sourceBalance;

  const handleSwapDirection = () => {
    setFromAccount(toAccount);
    setToAccount(fromAccount);
  };

  const handleSetQuickAmount = (val: number) => {
    setAmount(val.toFixed(2));
  };

  const handleEmptyAllCash = () => {
    if (fromAccount === 'Physical Cash') {
      setAmount(Math.max(0, sourceBalance).toFixed(2));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (numAmount <= 0) {
      alert('Please enter a valid transfer amount greater than zero.');
      return;
    }

    if (isOverdraft) {
      const proceed = confirm(
        `Warning: Transfer amount (${settings.currencySymbol}${numAmount.toLocaleString()}) is greater than current balance in ${fromAccount} (${settings.currencySymbol}${sourceBalance.toLocaleString()}). Do you still want to proceed?`
      );
      if (!proceed) return;
    }

    transferBetweenAccounts({
      fromAccount,
      toAccount,
      amount: numAmount,
      notes: notes.trim() || undefined,
      referenceNo: referenceNo.trim() || undefined,
      performedBy: currentUserName || 'Store Manager',
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      allowOverdraft: true,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full p-6 space-y-5 my-auto max-h-[92vh] overflow-y-auto animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 dark:bg-blue-950/80 text-blue-600 rounded-xl">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                Inter-Account Funds Transfer
              </h3>
              <p className="text-xs text-slate-400">
                Move liquid funds between Physical Till Cash and Business Bank Account
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Direction Selector Card */}
        <div className="relative p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-3">
            
            {/* From Account */}
            <div className="flex-1 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
              <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">
                <span>From (Source)</span>
              </div>
              <div className="flex items-center gap-2">
                {fromAccount === 'Biz Account' ? (
                  <Building className="w-4 h-4 text-blue-600 shrink-0" />
                ) : (
                  <Banknote className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                <span className="font-extrabold text-sm">{fromAccount}</span>
              </div>
              <p className="text-[11px] font-mono text-slate-500 mt-1">
                Avail: <strong className="text-slate-800 dark:text-slate-200">{settings.currencySymbol}{sourceBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </p>
            </div>

            {/* Swap Button */}
            <button
              type="button"
              onClick={handleSwapDirection}
              title="Click to flip transfer direction"
              className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-xs hover:scale-105 active:scale-95 transition-all shrink-0"
            >
              <ArrowRightLeft className="w-4 h-4" />
            </button>

            {/* To Account */}
            <div className="flex-1 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
              <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">
                <span>To (Destination)</span>
              </div>
              <div className="flex items-center gap-2">
                {toAccount === 'Biz Account' ? (
                  <Building className="w-4 h-4 text-blue-600 shrink-0" />
                ) : (
                  <Banknote className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                <span className="font-extrabold text-sm">{toAccount}</span>
              </div>
              <p className="text-[11px] font-mono text-slate-500 mt-1">
                Current: <strong className="text-slate-800 dark:text-slate-200">{settings.currencySymbol}{destBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </p>
            </div>
          </div>

          {/* Quick empty till button if from Physical Cash */}
          {fromAccount === 'Physical Cash' && sourceBalance > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-xs">
              <span className="text-slate-500 text-[11px]">End of day bank deposit?</span>
              <button
                type="button"
                onClick={handleEmptyAllCash}
                className="px-2.5 py-1 bg-emerald-100 dark:bg-emerald-950/60 hover:bg-emerald-200 text-emerald-700 dark:text-emerald-300 font-bold text-[11px] rounded-lg transition-colors flex items-center gap-1"
              >
                <span>Deposit All Cash ({settings.currencySymbol}{sourceBalance.toLocaleString()})</span>
              </button>
            </div>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          
          {/* Amount input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-slate-700 dark:text-slate-300">
                Transfer Amount ({settings.currencySymbol}) *
              </label>
              {numAmount > 0 && (
                <span className={`text-[11px] font-mono font-bold ${isOverdraft ? 'text-amber-600' : 'text-slate-400'}`}>
                  {isOverdraft ? 'Exceeds available balance' : `Remaining: ${settings.currencySymbol}${projectedSourceBalance.toLocaleString()}`}
                </span>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-extrabold text-slate-400">
                {settings.currencySymbol}
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full pl-9 pr-3 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-lg font-black text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            {/* Quick amount chips */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[5000, 10000, 20000, 50000, 100000].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleSetQuickAmount(val)}
                  className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-600 dark:text-slate-300 transition-colors"
                >
                  +{settings.currencySymbol}{val.toLocaleString()}
                </button>
              ))}
              {sourceBalance > 0 && (
                <button
                  type="button"
                  onClick={() => handleSetQuickAmount(Math.round(sourceBalance / 2))}
                  className="px-2 py-1 bg-blue-50 dark:bg-blue-950/40 text-blue-600 rounded-lg text-[10px] font-bold hover:bg-blue-100 transition-colors"
                >
                  50% ({settings.currencySymbol}{Math.round(sourceBalance / 2).toLocaleString()})
                </button>
              )}
            </div>
          </div>

          {/* Projected Outcomes Card */}
          {numAmount > 0 && (
            <div className="p-3 bg-blue-50/50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/60 rounded-xl space-y-1.5 text-[11px]">
              <div className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                <ArrowRight className="w-3.5 h-3.5 text-blue-600" />
                <span>Projected Post-Transfer Balances:</span>
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-slate-700 dark:text-slate-300 pt-1">
                <div>
                  <span className="text-slate-400 block text-[10px]">{fromAccount}:</span>
                  <span className={`font-black ${projectedSourceBalance < 0 ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>
                    {settings.currencySymbol}{projectedSourceBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">{toAccount}:</span>
                  <span className="font-black text-emerald-600 dark:text-emerald-400">
                    {settings.currencySymbol}{projectedDestBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Date and Reference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                Transfer Date *
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                Deposit Slip / Reference #
              </label>
              <input
                type="text"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="e.g. GTB-DEP-4921 / Till Float #04"
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
              Purpose / Transfer Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                fromAccount === 'Physical Cash'
                  ? 'e.g. End of day cash deposit to main business bank account'
                  : 'e.g. Withdrew cash from bank to replenish cash register float'
              }
              className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Action buttons */}
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
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>Confirm & Execute Transfer</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
