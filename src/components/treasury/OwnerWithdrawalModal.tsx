import React, { useState, useEffect } from 'react';
import { X, UserMinus, UserCheck, Building, Banknote, HelpCircle, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { LiquidAccountType, OwnerWithdrawalSubtype } from '../../types';

interface OwnerWithdrawalModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserName: string;
  initialMode?: 'withdrawal' | 'repayment';
}

export const OwnerWithdrawalModal: React.FC<OwnerWithdrawalModalProps> = ({
  isOpen,
  onClose,
  currentUserName,
  initialMode = 'withdrawal',
}) => {
  const { treasuryBalances, recordOwnerWithdrawal, recordOwnerRepayment, settings } = useApp();

  const [mode, setMode] = useState<'withdrawal' | 'repayment'>(initialMode);
  const [account, setAccount] = useState<LiquidAccountType>('Biz Account');
  const [subtype, setSubtype] = useState<OwnerWithdrawalSubtype>('Personal Use');
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setAccount('Biz Account');
      setSubtype('Personal Use');
      setAmount('');
      setNotes('');
      setReferenceNo('');
      setDate(new Date().toISOString().split('T')[0]);
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const currentAccountBalance =
    account === 'Biz Account'
      ? treasuryBalances.bizAccountBalance
      : treasuryBalances.physicalCashBalance;

  const numAmount = parseFloat(amount) || 0;
  const isOverdraft = mode === 'withdrawal' && numAmount > currentAccountBalance;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (numAmount <= 0) {
      alert('Please enter a valid amount greater than zero.');
      return;
    }

    if (isOverdraft) {
      const proceed = confirm(
        `Warning: Withdrawal amount (${settings.currencySymbol}${numAmount.toLocaleString()}) is greater than the available balance in ${account} (${settings.currencySymbol}${currentAccountBalance.toLocaleString()}). Do you still wish to proceed?`
      );
      if (!proceed) return;
    }

    if (mode === 'withdrawal') {
      recordOwnerWithdrawal({
        sourceAccount: account,
        amount: numAmount,
        subtype,
        notes: notes.trim() || undefined,
        referenceNo: referenceNo.trim() || undefined,
        performedBy: currentUserName || 'Owner',
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        allowOverdraft: true,
      });
    } else {
      recordOwnerRepayment({
        destinationAccount: account,
        amount: numAmount,
        notes: notes.trim() || undefined,
        referenceNo: referenceNo.trim() || undefined,
        performedBy: currentUserName || 'Owner',
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
      });
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full p-6 space-y-5 my-auto max-h-[92vh] overflow-y-auto animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${mode === 'withdrawal' ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-600' : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600'}`}>
              {mode === 'withdrawal' ? <UserMinus className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                {mode === 'withdrawal' ? 'Business Owner Fund Withdrawal' : 'Owner Loan Repayment'}
              </h3>
              <p className="text-xs text-slate-400">
                {mode === 'withdrawal'
                  ? 'Record owner drawings, personal loans, or profit/interest disbursements'
                  : 'Record reimbursement or payback of owner loans into the business'}
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

        {/* Mode Toggle Tabs */}
        <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
          <button
            type="button"
            onClick={() => setMode('withdrawal')}
            className={`flex-1 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
              mode === 'withdrawal'
                ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <ArrowDownRight className="w-4 h-4" />
            <span>Owner Withdrawal (Outflow)</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('repayment')}
            className={`flex-1 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
              mode === 'repayment'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Loan Repayment (Inflow)</span>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          
          {/* Subtype for withdrawal */}
          {mode === 'withdrawal' && (
            <div>
              <label className="block font-bold mb-1.5 text-slate-700 dark:text-slate-300">
                Withdrawal Classification *
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'Personal Use', title: 'Personal Use', desc: 'Standard owner drawing' },
                  { id: 'Owner Loan', title: 'Owner Loan', desc: 'Borrowing to repay later' },
                  { id: 'Profit / Dividend', title: 'Profit / Dividend', desc: 'Net dividend payout' },
                  { id: 'Interest Withdrawal', title: 'Interest Withdrawal', desc: 'Interest or yield' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSubtype(item.id as OwnerWithdrawalSubtype)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      subtype === item.id
                        ? 'border-amber-500 bg-amber-50/80 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 ring-1 ring-amber-500'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <p className="font-extrabold text-xs">{item.title}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{item.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Account selector */}
          <div>
            <label className="block font-bold mb-1.5 text-slate-700 dark:text-slate-300">
              {mode === 'withdrawal' ? 'Deduct Funds From Account *' : 'Deposit Repayment Into Account *'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAccount('Biz Account')}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  account === 'Biz Account'
                    ? 'border-blue-600 bg-blue-50/90 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 ring-2 ring-blue-500/20'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Building className="w-4 h-4 text-blue-600" />
                  <span className="font-extrabold text-xs">Biz Account</span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono">
                  Avail: <strong className="text-slate-700 dark:text-slate-300">{settings.currencySymbol}{treasuryBalances.bizAccountBalance.toLocaleString()}</strong>
                </p>
              </button>

              <button
                type="button"
                onClick={() => setAccount('Physical Cash')}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  account === 'Physical Cash'
                    ? 'border-emerald-600 bg-emerald-50/90 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-100 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Banknote className="w-4 h-4 text-emerald-600" />
                  <span className="font-extrabold text-xs">Physical Cash</span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono">
                  Avail: <strong className="text-slate-700 dark:text-slate-300">{settings.currencySymbol}{treasuryBalances.physicalCashBalance.toLocaleString()}</strong>
                </p>
              </button>
            </div>
          </div>

          {/* Amount input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-slate-700 dark:text-slate-300">
                {mode === 'withdrawal' ? 'Withdrawal Amount' : 'Repayment Amount'} ({settings.currencySymbol}) *
              </label>
              {isOverdraft && (
                <span className="text-[10px] text-amber-600 font-bold">
                  Warning: Amount exceeds account balance
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
                className="w-full pl-9 pr-3 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-lg font-black text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Date and Reference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                Date *
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                Voucher / Reference #
              </label>
              <input
                type="text"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="e.g. OWN-WD-001 / Bank Ref"
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
              Purpose / Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                mode === 'withdrawal'
                  ? 'e.g. Personal family expense / Short-term loan'
                  : 'e.g. Repaying personal loan borrowed on 15th'
              }
              className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
            />
          </div>

          {/* Actions */}
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
              className={`px-5 py-2.5 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2 ${
                mode === 'withdrawal'
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {mode === 'withdrawal' ? (
                <>
                  <UserMinus className="w-4 h-4" />
                  <span>Record Owner Withdrawal</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  <span>Record Loan Repayment</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
