import React, { useState, useMemo } from 'react';
import {
  ArrowRightLeft,
  Building,
  Banknote,
  Wallet,
  Scale,
  UserMinus,
  UserCheck,
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  Search,
  Filter,
  Download,
  Calendar,
  AlertCircle,
  HelpCircle,
  FileSpreadsheet,
  CheckCircle2,
  Trash2,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { LiquidAccountType, MoneyMovement, MoneyMovementType } from '../../types';
import { TransferModal } from './TransferModal';
import { OwnerWithdrawalModal } from './OwnerWithdrawalModal';
import { RecalibrateModal } from './RecalibrateModal';
import { ConfirmModal } from '../common/ConfirmModal';

export const MoneyMovementView: React.FC = () => {
  const { treasuryBalances, moneyMovements, deleteMoneyMovement, purgeHistoricalMoneyMovements, settings } = useApp();
  const { currentUser, isSuperAdmin } = useAuth();
  const { showToast } = useToast();

  // Modals state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferDirection, setTransferDirection] = useState<'CashToBank' | 'BankToCash'>('CashToBank');
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [ownerModalMode, setOwnerModalMode] = useState<'withdrawal' | 'repayment'>('withdrawal');
  const [showRecalibrateModal, setShowRecalibrateModal] = useState(false);
  const [recalibrateMode, setRecalibrateMode] = useState<'both' | 'single'>('both');
  const [recalibrateAccount, setRecalibrateAccount] = useState<LiquidAccountType>('Physical Cash');
  const [movementToDelete, setMovementToDelete] = useState<MoneyMovement | null>(null);

  // Filters state
  const [accountFilter, setAccountFilter] = useState<'All' | LiquidAccountType>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const canManageTreasury =
    currentUser?.role === 'Administrator' ||
    currentUser?.role === 'Store Manager' ||
    currentUser?.role === 'Accountant' ||
    isSuperAdmin;

  // Filter movements
  const filteredMovements = useMemo(() => {
    return moneyMovements.filter((m) => {
      // Account filter
      if (accountFilter !== 'All') {
        if (m.sourceAccount !== accountFilter && m.destinationAccount !== accountFilter) {
          return false;
        }
      }

      // Type filter
      if (typeFilter !== 'All' && m.type !== typeFilter) {
        return false;
      }

      // Date range filter
      if (startDate && m.date < startDate) {
        return false;
      }
      if (endDate && m.date > endDate + 'T23:59:59.999Z') {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const ref = (m.referenceNo || '').toLowerCase();
        const notes = (m.notes || '').toLowerCase();
        const performed = (m.performedBy || '').toLowerCase();
        const subtype = (m.subtype || '').toLowerCase();
        const type = m.type.toLowerCase();
        if (
          !ref.includes(query) &&
          !notes.includes(query) &&
          !performed.includes(query) &&
          !subtype.includes(query) &&
          !type.includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [moneyMovements, accountFilter, typeFilter, startDate, endDate, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    let totalInflow = 0;
    let totalOutflow = 0;

    filteredMovements.forEach((m) => {
      const amt = Number(m.amount) || 0;
      if (
        m.type === 'Sale Inflow' ||
        m.type === 'Customer Debt Payment' ||
        m.type === 'Owner Repayment'
      ) {
        totalInflow += amt;
      } else if (
        m.type === 'Expense Outflow' ||
        m.type === 'Supplier Payment' ||
        m.type === 'Sale Refund' ||
        m.type === 'Owner Drawing'
      ) {
        totalOutflow += amt;
      }
    });

    return { totalInflow, totalOutflow };
  }, [filteredMovements]);

  // Quick action openers
  const openEmptyCashToBank = () => {
    setTransferDirection('CashToBank');
    setShowTransferModal(true);
  };

  const openWithdrawBankToCash = () => {
    setTransferDirection('BankToCash');
    setShowTransferModal(true);
  };

  const openCalibrateBoth = () => {
    setRecalibrateMode('both');
    setShowRecalibrateModal(true);
  };

  const openCalibrateSingle = (acc: LiquidAccountType) => {
    setRecalibrateMode('single');
    setRecalibrateAccount(acc);
    setShowRecalibrateModal(true);
  };

  const openOwnerWithdrawal = () => {
    setOwnerModalMode('withdrawal');
    setShowOwnerModal(true);
  };

  const openOwnerRepayment = () => {
    setOwnerModalMode('repayment');
    setShowOwnerModal(true);
  };

  // CSV Export
  const handleExportCsv = () => {
    if (filteredMovements.length === 0) {
      alert('No records available to export.');
      return;
    }

    const headers = ['Date', 'Type', 'Subtype', 'From Account', 'To Account', 'Amount', 'Reference', 'Notes', 'Performed By'];
    const rows = filteredMovements.map((m) => [
      m.date ? new Date(m.date).toLocaleString() : '',
      m.type,
      m.subtype || '',
      typeof m.sourceAccount === 'string' ? m.sourceAccount : '',
      typeof m.destinationAccount === 'string' ? m.destinationAccount : '',
      (Number(m.amount) || 0).toFixed(2),
      m.referenceNo || '',
      `"${(m.notes || '').replace(/"/g, '""')}"`,
      m.performedBy || '',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `money_movements_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Badge styler for movement types
  const getTypeBadge = (type: MoneyMovementType) => {
    switch (type) {
      case 'Sale Inflow':
        return 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'Customer Debt Payment':
        return 'bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800';
      case 'Expense Outflow':
        return 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
      case 'Supplier Payment':
        return 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      case 'Sale Refund':
        return 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
      case 'Internal Transfer':
        return 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'Owner Drawing':
        return 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800';
      case 'Owner Repayment':
        return 'bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800';
      case 'Opening Balance':
      case 'Balance Adjustment':
        return 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
      default:
        return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    }
  };

  const handlePurgeHistorical = () => {
    const res = purgeHistoricalMoneyMovements();
    if (res.purgedCount > 0) {
      showToast({
        title: 'Historical Records Purged',
        message: `Successfully purged ${res.purgedCount} past historical sales/delivery movements from the liquid cash ledger.`,
        type: 'success',
      });
    } else {
      showToast({
        title: 'Ledger Clean',
        message: 'No contaminated historical records found in Money Movement Tracker.',
        type: 'info',
      });
    }
  };

  return (
    <div className="space-y-6 pb-14 text-slate-900 dark:text-slate-100">
      
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600 text-white rounded-2xl shadow-md shadow-blue-500/20">
              <ArrowRightLeft className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                Money Movement Tracker
              </h1>
              <p className="text-xs text-slate-500">
                Track liquid cash across Business Bank Account and Physical Cash Till, manage transfers, and owner withdrawals.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        {canManageTreasury && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openCalibrateBoth}
              className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shadow-2xs"
            >
              <Scale className="w-4 h-4 text-indigo-500" />
              <span>Calibrate Balances</span>
            </button>

            <button
              type="button"
              onClick={handlePurgeHistorical}
              title="Purge any historical sales inflows or delivery fee outflows that may distort live liquid balances"
              className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shadow-2xs"
            >
              <RefreshCw className="w-4 h-4 text-emerald-500" />
              <span>Purge Past Records</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTransferDirection('CashToBank');
                setShowTransferModal(true);
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-md shadow-blue-500/20 flex items-center gap-2"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>Transfer Funds</span>
            </button>

            <button
              type="button"
              onClick={openOwnerWithdrawal}
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs rounded-xl transition-all shadow-xs flex items-center gap-1.5"
            >
              <UserMinus className="w-4 h-4" />
              <span>Owner Withdrawal</span>
            </button>
          </div>
        )}
      </div>

      {/* Primary KPI & Liquidity Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* CARD 1: Total Liquid Cash */}
        <div className="p-5 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-3xl shadow-lg border border-slate-700/60 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
          <div>
            <div className="flex items-center justify-between text-slate-300 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Total Business Liquid Cash</span>
              <Wallet className="w-4 h-4 text-blue-400" />
            </div>
            <p className="text-3xl font-black font-mono tracking-tight text-white mt-1">
              {settings.currencySymbol}
              {(treasuryBalances?.totalLiquidCash ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Combined live liquidity from Bank & Till
            </p>
          </div>

          <div className="mt-5 pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs">
            <span className="text-slate-400 text-[11px]">Audit calibration:</span>
            <button
              type="button"
              onClick={openCalibrateBoth}
              className="text-blue-400 hover:text-blue-300 font-bold text-[11px] underline flex items-center gap-1"
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Adjust Starting Balances</span>
            </button>
          </div>
        </div>

        {/* CARD 2: Biz Bank Account */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl shadow-xs border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between hover:border-blue-300 dark:hover:border-blue-900 transition-colors">
          <div>
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 rounded-xl">
                  <Building className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider">1. Biz Bank Account</span>
              </div>
              <button
                type="button"
                onClick={() => openCalibrateSingle('Biz Account')}
                title="Audit Bank Balance"
                className="p-1 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Scale className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-2xl font-black font-mono tracking-tight text-blue-600 dark:text-blue-400 mt-1">
              {settings.currencySymbol}
              {(treasuryBalances?.bizAccountBalance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Receives Mobile Transfers, Bank Transfers, and Card/POS sales.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={openWithdrawBankToCash}
              className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-colors"
            >
              <ArrowDownRight className="w-3.5 h-3.5 text-blue-600" />
              <span>Withdraw to Till</span>
            </button>

            <button
              type="button"
              onClick={() => openCalibrateSingle('Biz Account')}
              className="text-[11px] text-slate-400 hover:text-slate-600 font-bold underline"
            >
              Audit Statement
            </button>
          </div>
        </div>

        {/* CARD 3: Physical Cash (Till) */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl shadow-xs border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between hover:border-emerald-300 dark:hover:border-emerald-900 transition-colors">
          <div>
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 rounded-xl">
                  <Banknote className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider">2. Physical Cash (Till)</span>
              </div>
              <button
                type="button"
                onClick={() => openCalibrateSingle('Physical Cash')}
                title="Audit Cash Count"
                className="p-1 text-slate-400 hover:text-emerald-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Scale className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-2xl font-black font-mono tracking-tight text-emerald-600 dark:text-emerald-400 mt-1">
              {settings.currencySymbol}
              {(treasuryBalances?.physicalCashBalance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Receives Cash Transactions and covers cash register expenses.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={openEmptyCashToBank}
              className="px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-colors"
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
              <span>Deposit to Bank</span>
            </button>

            <button
              type="button"
              onClick={() => openCalibrateSingle('Physical Cash')}
              className="text-[11px] text-slate-400 hover:text-slate-600 font-bold underline"
            >
              Count Cash Till
            </button>
          </div>
        </div>
      </div>

      {/* Secondary Ribbon: Owner Equity / Drawings Tracking Card */}
      <div className="p-4 bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200/80 dark:border-purple-900/40 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-600 text-white rounded-2xl shadow-sm">
            <UserMinus className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-extrabold text-sm text-purple-950 dark:text-purple-100">
              Business Owner Funds & Loans Ledger
            </h4>
            <p className="text-xs text-purple-700/80 dark:text-purple-300/80">
              Disbursements to the business owner for personal use, loans, and returns.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="px-3 py-1.5 bg-white dark:bg-slate-900 rounded-xl border border-purple-200 dark:border-purple-900 font-mono">
            <span className="text-slate-400 text-[10px] uppercase font-bold block">Total Owner Drawings:</span>
            <span className="font-black text-purple-700 dark:text-purple-300">
              {settings.currencySymbol}{(treasuryBalances?.totalOwnerDrawings ?? 0).toLocaleString()}
            </span>
          </div>

          <div className="px-3 py-1.5 bg-white dark:bg-slate-900 rounded-xl border border-purple-200 dark:border-purple-900 font-mono">
            <span className="text-slate-400 text-[10px] uppercase font-bold block">Active Owner Loans:</span>
            <span className="font-black text-amber-600 dark:text-amber-400">
              {settings.currencySymbol}{(treasuryBalances?.totalOwnerLoans ?? 0).toLocaleString()}
            </span>
          </div>

          {canManageTreasury && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openOwnerWithdrawal}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-xs transition-colors"
              >
                + New Withdrawal
              </button>
              <button
                type="button"
                onClick={openOwnerRepayment}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Repay Loan</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reference #, notes, performed by, or description..."
              className="w-full pl-9 pr-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Account Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            {(['All', 'Biz Account', 'Physical Cash'] as const).map((acc) => (
              <button
                key={acc}
                type="button"
                onClick={() => setAccountFilter(acc)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all ${
                  accountFilter === acc
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {acc}
              </button>
            ))}
          </div>

          {/* Type Filter Dropdown */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="All">All Transaction Types</option>
              <option value="Sale Inflow">Sales Inflows (POS/Store)</option>
              <option value="Internal Transfer">Internal Account Transfers</option>
              <option value="Supplier Payment">Supplier Payments</option>
              <option value="Expense Outflow">Expenses (Rent, Fuel, etc.)</option>
              <option value="Customer Debt Payment">Customer Debt Settlements</option>
              <option value="Owner Drawing">Owner Drawings / Withdrawals</option>
              <option value="Owner Repayment">Owner Loan Repayments</option>
              <option value="Sale Refund">Sale Refunds</option>
              <option value="Opening Balance">Opening Balances</option>
              <option value="Balance Adjustment">Audit Adjustments</option>
            </select>
          </div>

          {/* Date range & Export */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="p-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              title="From date"
            />
            <span className="text-slate-400 text-xs">-</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="p-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              title="To date"
            />

            {(startDate || endDate || searchQuery || typeFilter !== 'All' || accountFilter !== 'All') && (
              <button
                type="button"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setSearchQuery('');
                  setTypeFilter('All');
                  setAccountFilter('All');
                }}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Reset filters"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5"
              title="Download CSV report"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Ledger Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">
              Money Movement Audit Ledger
            </h3>
            <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-950 text-blue-600 text-xs font-mono font-bold rounded-lg">
              {filteredMovements.length} Records
            </span>
          </div>

          <div className="text-xs text-slate-400 font-mono">
            {accountFilter !== 'All' ? `Filtered by: ${accountFilter}` : 'All accounts'}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-extrabold">
              <tr>
                <th className="py-3.5 px-4">Date & Time</th>
                <th className="py-3.5 px-3">Transaction Type</th>
                <th className="py-3.5 px-3">From / Source</th>
                <th className="py-3.5 px-3">To / Destination</th>
                <th className="py-3.5 px-3">Reference / Subtype</th>
                <th className="py-3.5 px-3">Notes / Purpose</th>
                <th className="py-3.5 px-3 text-right">Amount</th>
                <th className="py-3.5 px-4 text-center">User</th>
                {canManageTreasury && <th className="py-3.5 px-3 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-medium">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={canManageTreasury ? 9 : 8} className="py-12 text-center text-slate-400">
                    <ArrowRightLeft className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="font-bold text-sm">No Money Movements Recorded</p>
                    <p className="text-xs max-w-sm mx-auto mt-1">
                      Transactions like POS sales, cash till deposits, expenses, and owner drawings will appear here automatically.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredMovements.map((movement) => {
                  const isInternalTransfer = movement.type === 'Internal Transfer';
                  const isInflow =
                    movement.type === 'Sale Inflow' ||
                    movement.type === 'Customer Debt Payment' ||
                    movement.type === 'Owner Repayment';
                  const isOutflow =
                    movement.type === 'Expense Outflow' ||
                    movement.type === 'Supplier Payment' ||
                    movement.type === 'Sale Refund' ||
                    movement.type === 'Owner Drawing';

                  return (
                    <tr
                      key={movement.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Date */}
                      <td className="py-3.5 px-4 font-mono text-[11px] whitespace-nowrap">
                        <p className="font-bold text-slate-900 dark:text-white">
                          {new Date(movement.date).toLocaleDateString()}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(movement.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </td>

                      {/* Type Badge */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-1 rounded-xl text-[10px] font-extrabold border ${getTypeBadge(movement.type)}`}>
                          {movement.type}
                        </span>
                      </td>

                      {/* Source Account */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {movement.sourceAccount ? (
                          <div className="flex items-center gap-1.5 font-bold text-xs">
                            {movement.sourceAccount === 'Biz Account' ? (
                              <Building className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            ) : (
                              <Banknote className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            )}
                            <span>{movement.sourceAccount}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">— External Inflow —</span>
                        )}
                      </td>

                      {/* Destination Account */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {movement.destinationAccount ? (
                          <div className="flex items-center gap-1.5 font-bold text-xs">
                            {movement.destinationAccount === 'Biz Account' ? (
                              <Building className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            ) : (
                              <Banknote className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            )}
                            <span>{movement.destinationAccount}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">— External Outflow —</span>
                        )}
                      </td>

                      {/* Reference & Subtype */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <p className="font-bold font-mono text-slate-900 dark:text-white">
                          {movement.referenceNo || '—'}
                        </p>
                        {movement.subtype && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {movement.subtype}
                          </span>
                        )}
                      </td>

                      {/* Notes */}
                      <td className="py-3.5 px-3 max-w-xs truncate text-[11px] text-slate-600 dark:text-slate-400" title={movement.notes}>
                        {movement.notes || '—'}
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap font-mono font-black text-sm">
                        {isInternalTransfer ? (
                          <span className="text-blue-600 dark:text-blue-400">
                            {settings.currencySymbol}{(Number(movement.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : isInflow ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            +{settings.currencySymbol}{(Number(movement.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : isOutflow ? (
                          <span className="text-rose-600 dark:text-rose-400">
                            -{settings.currencySymbol}{(Number(movement.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-slate-800 dark:text-slate-200">
                            {settings.currencySymbol}{(Number(movement.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>

                      {/* Performed By */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap text-[11px] text-slate-500">
                        {movement.performedBy}
                      </td>

                      {/* Action */}
                      {canManageTreasury && (
                        <td className="py-3.5 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setMovementToDelete(movement)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                            title="Delete this movement log"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODALS */}
      {/* Transfer Modal */}
      <TransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        currentUserName={currentUser?.displayName || 'Store Manager'}
        defaultDirection={transferDirection}
      />

      {/* Owner Withdrawal Modal */}
      <OwnerWithdrawalModal
        isOpen={showOwnerModal}
        onClose={() => setShowOwnerModal(false)}
        currentUserName={currentUser?.displayName || 'Owner'}
        initialMode={ownerModalMode}
      />

      {/* Recalibrate Modal */}
      <RecalibrateModal
        isOpen={showRecalibrateModal}
        onClose={() => setShowRecalibrateModal(false)}
        currentUserName={currentUser?.displayName || 'Store Manager'}
        defaultMode={recalibrateMode}
        targetAccount={recalibrateAccount}
      />

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!movementToDelete}
        title="Delete Money Movement Entry"
        message={`Are you sure you want to delete this ${movementToDelete?.type} record of ${settings.currencySymbol}${(Number(movementToDelete?.amount) || 0).toFixed(2)}? Liquid balances will update to reverse this entry.`}
        confirmText="Delete Entry"
        variant="danger"
        onClose={() => setMovementToDelete(null)}
        onConfirm={() => {
          if (movementToDelete) {
            deleteMoneyMovement(movementToDelete.id);
            setMovementToDelete(null);
          }
        }}
      />
    </div>
  );
};
