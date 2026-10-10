import React, { useState, useEffect } from 'react';
import { X, Scale, Building, Banknote, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { LiquidAccountType } from '../../types';
import { useInteractions } from '../../context/InteractionContext';

interface RecalibrateModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserName: string;
  defaultMode?: 'single' | 'both';
  targetAccount?: LiquidAccountType;
}

export const RecalibrateModal: React.FC<RecalibrateModalProps> = ({
  isOpen,
  onClose,
  currentUserName,
  defaultMode = 'both',
  targetAccount = 'Physical Cash',
}) => {
  const { treasuryBalances, recalibrateLiquidBalance, setInitialLiquidBalances, settings } = useApp();
  const { notify, confirm } = useInteractions();

  const [activeTab, setActiveTab] = useState<'both' | 'single'>(defaultMode);
  
  // Both balances state
  const [bizInitial, setBizInitial] = useState<string>('');
  const [cashInitial, setCashInitial] = useState<string>('');
  
  // Single account recalibration state
  const [selectedAccount, setSelectedAccount] = useState<LiquidAccountType>(targetAccount);
  const [newBalance, setNewBalance] = useState<string>('');
  const [reason, setReason] = useState<string>('Physical Till Count Audit');

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultMode);
      setSelectedAccount(targetAccount);
      setBizInitial((treasuryBalances?.bizAccountBalance ?? 0).toString());
      setCashInitial((treasuryBalances?.physicalCashBalance ?? 0).toString());
      setNewBalance('');
      setReason('Physical Till Count Audit');
    }
  }, [isOpen, defaultMode, targetAccount, treasuryBalances]);

  if (!isOpen) return null;

  const currentBal =
    selectedAccount === 'Biz Account'
      ? (treasuryBalances?.bizAccountBalance ?? 0)
      : (treasuryBalances?.physicalCashBalance ?? 0);

  const numNewBalance = parseFloat(newBalance) || 0;
  const variance = numNewBalance - currentBal;

  const handleSetBothSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numBiz = parseFloat(bizInitial) || 0;
    const numCash = parseFloat(cashInitial) || 0;

    if (!await confirm({ title: 'Calibrate liquid balances', message: `Set Biz Account to ${settings.currencySymbol}${numBiz.toLocaleString()} and Physical Cash to ${settings.currencySymbol}${numCash.toLocaleString()}?`, confirmText: 'Calibrate balances', variant: 'warning' })) return;

    setInitialLiquidBalances(numBiz, numCash, currentUserName || 'Store Manager');
    onClose();
  };

  const handleSingleRecalibrateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newBalance.trim() === '') {
      notify('Please enter a target balance value.', 'Balance required');
      return;
    }

    if (!await confirm({ title: `Recalibrate ${selectedAccount}`, message: `Change the balance from ${settings.currencySymbol}${currentBal.toLocaleString()} to ${settings.currencySymbol}${numNewBalance.toLocaleString()} (${variance >= 0 ? '+' : ''}${settings.currencySymbol}${variance.toLocaleString()})?`, confirmText: 'Recalibrate', variant: 'warning' })) return;

    recalibrateLiquidBalance(
      selectedAccount,
      numNewBalance,
      reason.trim() || 'Manual Balance Recalibration',
      currentUserName || 'Store Manager'
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full p-6 space-y-5 my-auto max-h-[92vh] overflow-y-auto animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 rounded-xl">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                Liquid Cash Calibration & Audit
              </h3>
              <p className="text-xs text-slate-400">
                Set opening liquid cash or adjust balances based on physical till counts & bank audits
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

        {/* Tab Selection */}
        <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('both')}
            className={`flex-1 py-2 rounded-xl transition-all ${
              activeTab === 'both'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Set Both Opening Balances
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('single')}
            className={`flex-1 py-2 rounded-xl transition-all ${
              activeTab === 'single'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Audit Single Account
          </button>
        </div>

        {/* TAB 1: Set Both Balances */}
        {activeTab === 'both' ? (
          <form onSubmit={handleSetBothSubmit} className="space-y-4 text-xs">
            <div className="p-3 bg-indigo-50/60 dark:bg-indigo-950/30 rounded-2xl border border-indigo-100 dark:border-indigo-900/60 text-slate-600 dark:text-slate-300 space-y-1">
              <p className="font-bold text-indigo-900 dark:text-indigo-200">
                Initial Opening Liquidity Setup
              </p>
              <p className="text-[11px] leading-relaxed">
                Enter the exact starting liquid amounts currently held in the Business Bank Account and Physical Till. Future transactions will update these figures automatically.
              </p>
            </div>

            {/* Biz Account Input */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-100 dark:bg-blue-900 text-blue-600 rounded-lg">
                    <Building className="w-4 h-4" />
                  </div>
                  <span className="font-extrabold text-slate-900 dark:text-white">
                    1. Biz Bank Account
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  Current: {settings.currencySymbol}{treasuryBalances.bizAccountBalance.toLocaleString()}
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 font-mono">
                  {settings.currencySymbol}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={bizInitial}
                  onChange={(e) => setBizInitial(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-base font-mono font-black text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Physical Cash Input */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900 text-emerald-600 rounded-lg">
                    <Banknote className="w-4 h-4" />
                  </div>
                  <span className="font-extrabold text-slate-900 dark:text-white">
                    2. Physical Cash (Till)
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  Current: {settings.currencySymbol}{treasuryBalances.physicalCashBalance.toLocaleString()}
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 font-mono">
                  {settings.currencySymbol}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={cashInitial}
                  onChange={(e) => setCashInitial(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-base font-mono font-black text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
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
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Save Liquid Balances</span>
              </button>
            </div>
          </form>
        ) : (
          /* TAB 2: Single Account Audit / Recalibration */
          <form onSubmit={handleSingleRecalibrateSubmit} className="space-y-4 text-xs">
            {/* Choose account */}
            <div>
              <label className="block font-bold mb-1.5 text-slate-700 dark:text-slate-300">
                Account to Audit *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedAccount('Biz Account')}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    selectedAccount === 'Biz Account'
                      ? 'border-blue-600 bg-blue-50/90 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 ring-2 ring-blue-500/20'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Building className="w-4 h-4 text-blue-600" />
                    <span className="font-extrabold text-xs">Biz Account</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">
                    {settings.currencySymbol}{treasuryBalances.bizAccountBalance.toLocaleString()}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedAccount('Physical Cash')}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    selectedAccount === 'Physical Cash'
                      ? 'border-emerald-600 bg-emerald-50/90 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-100 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Banknote className="w-4 h-4 text-emerald-600" />
                    <span className="font-extrabold text-xs">Physical Cash</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">
                    {settings.currencySymbol}{treasuryBalances.physicalCashBalance.toLocaleString()}
                  </p>
                </button>
              </div>
            </div>

            {/* Target Balance */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  New Audited / Counted Balance ({settings.currencySymbol}) *
                </label>
                {newBalance && (
                  <span
                    className={`text-[10px] font-mono font-bold ${
                      variance === 0
                        ? 'text-slate-400'
                        : variance > 0
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    }`}
                  >
                    Variance: {variance >= 0 ? '+' : ''}
                    {settings.currencySymbol}
                    {variance.toLocaleString()}
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
                  required
                  value={newBalance}
                  onChange={(e) => setNewBalance(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-9 pr-3 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-lg font-black text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                Audit Reason / Explanation *
              </label>
              <input
                type="text"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. End of month physical cash count / Bank statement reconciliation"
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
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
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2"
              >
                <Scale className="w-4 h-4" />
                <span>Commit Audit Recalibration</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
