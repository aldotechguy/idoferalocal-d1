import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  Package,
  AlertTriangle,
  ShoppingBag,
  Activity,
  ArrowUpRight,
  Boxes,
  ArrowDownRight,
  Clock,
  CheckCircle,
  Plus,
  ShoppingCart,
  Receipt,
  UserPlus,
  Building,
  ChevronDown,
  Calendar,
  FileText,
  Wallet,
  ArrowRightLeft,
  Banknote,
} from 'lucide-react';
import { StatCard } from '../common/StatCard';
import { NairaSign } from '../common/NairaSign';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { AddProductModal } from '../modals/AddProductModal';
import { AddExpenseModal } from '../modals/AddExpenseModal';
import { AddCustomerModal } from '../modals/AddCustomerModal';
import { AddSupplierModal } from '../modals/AddSupplierModal';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { localIsoDate } from '../../shared/localDate';

interface DashboardViewProps {
  onNavigate: (page: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { products, sales, purchases, expenses, settings, treasuryBalances } = useApp();
  const { currentUser, hasPermission } = useAuth();
  const isSalesStaff = currentUser?.role === 'Sales Staff';
  const canAccessLiquidCash = hasPermission(['Administrator', 'Store Manager', 'Accountant']);

  // Quick Add Modal States
  const [activeModal, setActiveModal] = useState<'product' | 'expense' | 'customer' | 'supplier' | null>(null);

  // Metrics Calculations
  const validSales = sales.filter((s) => s.status !== 'Refunded' && s.status !== 'Held' && s.status !== 'Draft');

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const currentMonthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const currentMonthShort = now.toLocaleDateString('en-US', { month: 'short' });

  // Prior Month (for Month-over-Month comparison)
  const priorMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const priorMonthStr = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const priorMonthShort = priorMonthDate.toLocaleDateString('en-US', { month: 'short' });

  // Local calendar day key: createdAt is a UTC ISO timestamp, and Nigeria runs
  // UTC+1, so a 00:30 WAT sale carries the previous UTC date — toISOString()
  // would drop it from Today's Sales.
  const todayStr = localIsoDate(now);
  const todaySales = validSales
    .filter((s) => s.createdAt && s.createdAt.startsWith(todayStr))
    .reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);

  // Scoped strictly to current calendar month (resets when month flips)
  const currentMonthSales = validSales.filter((s) => {
    return Boolean(s.createdAt && s.createdAt.startsWith(currentMonthStr));
  });
  const monthlyRevenue = currentMonthSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);

  // Prior month sales for comparison
  const priorMonthSales = validSales.filter((s) => {
    return Boolean(s.createdAt && s.createdAt.startsWith(priorMonthStr));
  });
  const priorMonthRevenue = priorMonthSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);

  let monthlyChangeStr = `${currentMonthShort} active`;
  let monthlyChangeType: 'positive' | 'negative' | 'neutral' = 'neutral';
  if (priorMonthRevenue > 0) {
    const pct = ((monthlyRevenue - priorMonthRevenue) / priorMonthRevenue) * 100;
    monthlyChangeStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs ${priorMonthShort}`;
    monthlyChangeType = pct >= 0 ? 'positive' : 'negative';
  } else if (monthlyRevenue > 0) {
    monthlyChangeStr = 'Active this month';
    monthlyChangeType = 'positive';
  }

  // Monthly Cost of Goods Sold (Current Month only)
  const monthlyCostOfGoodsSold = currentMonthSales.reduce((acc, s) => {
    const saleCost = (s.items || []).reduce((sum, item) => {
      const c = Number(item.costPrice) || 0;
      const q = Number(item.quantity) || 1;
      return sum + c * q;
    }, 0);
    return acc + saleCost;
  }, 0);

  // Monthly Expenses (only expenses logged in the current month)
  const monthlyExpenses = expenses
    .filter((e) => {
      const d = e.date || e.createdAt;
      return Boolean(d && d.startsWith(currentMonthStr));
    })
    .reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

  const monthlyGrossProfit = Math.max(0, monthlyRevenue - monthlyCostOfGoodsSold);
  const monthlyNetProfit = monthlyGrossProfit - monthlyExpenses;

  const totalInventoryValue = products.reduce(
    (acc, p) => acc + (Number(p.costPrice) || 0) * (Number(p.currentStock) || 0),
    0
  );

  const activeProds = products.filter((p) => p.status !== 'Archived');

  const lowStockCount = activeProds.filter(
    (p) => (Number(p.currentStock) || 0) > 0 && (Number(p.currentStock) || 0) <= (Number(p.minimumStockLevel) || 5)
  ).length;

  const outOfStockCount = activeProds.filter((p) => (Number(p.currentStock) || 0) <= 0).length;

  // Realtime Day-over-Day Sales Comparison for StatCard
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = localIsoDate(yesterday);
  const yesterdaySales = validSales
    .filter((s) => s.createdAt && s.createdAt.startsWith(yesterdayStr))
    .reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);

  let todayChangeStr = 'No sales yesterday';
  let todayChangeType: 'positive' | 'negative' | 'neutral' = 'neutral';
  if (yesterdaySales > 0) {
    const pct = ((todaySales - yesterdaySales) / yesterdaySales) * 100;
    todayChangeStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs yesterday`;
    todayChangeType = pct >= 0 ? 'positive' : 'negative';
  } else if (todaySales > 0) {
    todayChangeStr = 'Active today';
    todayChangeType = 'positive';
  }

  const profitMarginPct = monthlyRevenue > 0 ? ((monthlyNetProfit / monthlyRevenue) * 100).toFixed(1) : '0.0';

  // Dynamic 7-day Real-Time Sales Trend Data
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const isoDate = localIsoDate(d);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    return { isoDate, name: dayName };
  });

  const salesTrendData = last7Days.map(({ isoDate, name }) => {
    const daySales = validSales.filter((s) => s.createdAt && s.createdAt.startsWith(isoDate));
    const revenue = daySales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
    const unitsSold = daySales.reduce(
      (acc, s) => acc + (s.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0),
      0
    );
    return {
      name,
      sales: unitsSold || daySales.length,
      revenue,
    };
  });

  // Dynamic Category Distribution Data from Real-time Products & Inventory
  const categoryTotals: Record<string, number> = {};
  products.forEach((p) => {
    const cat = p.category || 'General';
    const val = p.currentStock * p.costPrice;
    categoryTotals[cat] = (categoryTotals[cat] || 0) + (val > 0 ? val : p.retailPrice);
  });

  const totalCatVal = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  const palette = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1'];

  const categoryData =
    Object.keys(categoryTotals).length > 0
      ? Object.entries(categoryTotals).map(([name, val], index) => ({
          name,
          value: totalCatVal > 0 ? Math.round((val / totalCatVal) * 100) : 0,
          color: palette[index % palette.length],
        }))
      : [{ name: 'No Categories', value: 100, color: '#94a3b8' }];

  const maxRecentSaleTotal = useMemo(() => {
    const topSlice = sales.slice(0, 4);
    if (topSlice.length === 0) return 1;
    return Math.max(...topSlice.map((s) => s.totalAmount), 1);
  }, [sales]);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Greeting & Action Pill Bar (Mercury Style) */}
      <div className="space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-bold text-xs uppercase tracking-wider mb-1">
              <Activity className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>IdoferaLabs Command Center</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
              Welcome back{currentUser?.displayName ? `, ${currentUser.displayName}` : ''}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Real-time packaging inventory, sales performance, and treasury overview.
            </p>
          </div>
        </div>

        {/* Mercury Action Pill Bar */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
          {/* Primary Action Pill */}
          <button
            onClick={() => onNavigate('pos')}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full text-xs transition-all shadow-xs shrink-0 active:scale-95"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>+ New Sale</span>
          </button>

          {/* New Product Pill */}
          <button
            onClick={() => setActiveModal('product')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 font-semibold rounded-full text-xs transition-all shadow-2xs shrink-0 active:scale-95"
          >
            <Package className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>+ Product</span>
          </button>

          {/* New Expense Pill */}
          {!isSalesStaff && (
            <button
              onClick={() => setActiveModal('expense')}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 font-semibold rounded-full text-xs transition-all shadow-2xs shrink-0 active:scale-95"
            >
              <Receipt className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span>+ Expense</span>
            </button>
          )}

          {/* New Customer Pill */}
          <button
            onClick={() => setActiveModal('customer')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 font-semibold rounded-full text-xs transition-all shadow-2xs shrink-0 active:scale-95"
          >
            <UserPlus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>+ Customer</span>
          </button>

          {/* New Supplier Pill */}
          {!isSalesStaff && (
            <button
              onClick={() => setActiveModal('supplier')}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 font-semibold rounded-full text-xs transition-all shadow-2xs shrink-0 active:scale-95"
            >
              <Building className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>+ Supplier</span>
            </button>
          )}
        </div>
      </div>

      {/* Monthly Performance & Audit Hub Banner */}
      {!isSalesStaff && (
        <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-slate-50 dark:from-slate-900 dark:via-indigo-950/30 dark:to-slate-900 p-4 rounded-2xl border border-blue-100/80 dark:border-blue-900/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs shrink-0">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black text-slate-900 dark:text-white">
                  Monthly Performance & Reports Hub
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                  {currentMonthName} Active
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Want closed figures for last month ({priorMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })})? Access past monthly biz statements anytime.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
            <button
              onClick={() => {
                localStorage.setItem('idofera_reports_period', 'last_month');
                onNavigate('reports');
              }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-bold rounded-xl text-xs border border-slate-200 dark:border-slate-700 transition-all shadow-2xs"
            >
              <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Past Month ({priorMonthShort})</span>
            </button>
            <button
              onClick={() => {
                localStorage.setItem('idofera_reports_period', 'this_month');
                onNavigate('reports');
              }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-all shadow-xs"
            >
              <span>Biz Reports &rarr;</span>
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isSalesStaff ? (
          <>
            <StatCard
              title="Today's Orders"
              value={`${sales.filter((s) => s.createdAt.startsWith(todayStr)).length} Completed`}
              subtitle="Register transactions today"
              icon={ShoppingCart}
              change="Active"
              changeType="positive"
              colorScheme="emerald"
              onClick={() => onNavigate('sales')}
              actionLabel="View Today's Orders"
            />
            <StatCard
              title="Active Catalog Items"
              value={`${products.filter((p) => p.status === 'Active').length}`}
              subtitle="In store catalog"
              icon={Boxes}
              change="Available"
              changeType="neutral"
              colorScheme="blue"
              onClick={() => onNavigate('products')}
              actionLabel="View Product Catalog"
            />
            <StatCard
              title="Low Stock Warning"
              value={`${lowStockCount} Items`}
              subtitle="Requires reordering soon"
              icon={AlertTriangle}
              change="Alert"
              changeType="negative"
              colorScheme="amber"
              onClick={() => onNavigate('products')}
              actionLabel="Manage Low Stock"
            />
            <StatCard
              title="Out of Stock"
              value={`${outOfStockCount} Items`}
              subtitle="Zero inventory remaining"
              icon={Package}
              change="Depleted"
              changeType="negative"
              colorScheme="rose"
              onClick={() => onNavigate('products')}
              actionLabel="Restock Products"
            />
          </>
        ) : (
          <>
            <StatCard
              title="Today's Sales"
              value={`${settings.currencySymbol}${todaySales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              subtitle="Real-time register totals"
              icon={NairaSign}
              change={todayChangeStr}
              changeType={todayChangeType}
              colorScheme="emerald"
              onClick={() => onNavigate('sales')}
              actionLabel="View Today's Sales"
            />
            <StatCard
              title={`Monthly Revenue (${currentMonthShort})`}
              value={`${settings.currencySymbol}${monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              subtitle={`${currentMonthSales.length} order${currentMonthSales.length === 1 ? '' : 's'} in ${currentMonthShort}`}
              icon={TrendingUp}
              change={monthlyChangeStr}
              changeType={monthlyChangeType}
              colorScheme="blue"
              onClick={() => {
                localStorage.setItem('idofera_reports_period', 'this_month');
                localStorage.setItem('idofera_reports_type', 'MonthlyBiz');
                onNavigate('reports');
              }}
              actionLabel="Monthly Biz Report"
            />
            <StatCard
              title="Gross / Net Profit"
              value={`${settings.currencySymbol}${monthlyNetProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              subtitle={`Gross: ${settings.currencySymbol}${monthlyGrossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${currentMonthShort})`}
              icon={ShoppingBag}
              change={`${profitMarginPct}% Net Margin`}
              changeType={monthlyNetProfit >= 0 ? 'positive' : 'negative'}
              colorScheme="indigo"
              onClick={() => {
                localStorage.setItem('idofera_reports_period', 'this_month');
                localStorage.setItem('idofera_reports_type', 'ProfitLoss');
                onNavigate('reports');
              }}
              actionLabel="View Profit & Loss"
            />
            <StatCard
              title="Inventory Valuation"
              value={`${settings.currencySymbol}${totalInventoryValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              subtitle={`${products.length} active catalog items`}
              icon={Boxes}
              change="Optimal"
              changeType="neutral"
              colorScheme="violet"
              onClick={() => {
                localStorage.setItem('idofera_reports_type', 'InventoryValuation');
                onNavigate('reports');
              }}
              actionLabel="View Valuation Report"
            />
          </>
        )}
      </div>

      {/* Alerts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          onClick={() => onNavigate('products')}
          className="cursor-pointer bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/60 p-4 rounded-2xl flex items-center justify-between hover:border-amber-400 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-400 rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-amber-200">
                Low Stock Warning ({lowStockCount} Products)
              </p>
              <p className="text-[11px] text-slate-600 dark:text-amber-400/80">
                Items below threshold require immediate reordering.
              </p>
            </div>
          </div>
          <ArrowUpRight className="w-4 h-4 text-amber-600" />
        </div>

        <div
          onClick={() => onNavigate('products')}
          className="cursor-pointer bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/60 p-4 rounded-2xl flex items-center justify-between hover:border-rose-400 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-400 rounded-xl">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-rose-200">
                Out of Stock ({outOfStockCount} Products)
              </p>
              <p className="text-[11px] text-slate-600 dark:text-rose-400/80">
                Zero inventory count. Click to view replenishment orders.
              </p>
            </div>
          </div>
          <ArrowUpRight className="w-4 h-4 text-rose-600" />
        </div>
      </div>

      {/* Main Analytics & Accounts Companion (Mercury Style) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales & Revenue Trend Area Chart */}
        <div className="lg:col-span-2 bento-card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {isSalesStaff ? 'Weekly Order Volume' : 'Sales & Revenue Performance'}
                </h3>
                <span className="text-[11px] font-semibold px-2 py-0.5 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-full border border-blue-200/50 dark:border-blue-800/40">
                  {isSalesStaff ? 'Daily Orders' : 'This Week'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {isSalesStaff ? 'Weekly transaction counts' : 'Day-by-day revenue & order volume trend'}
              </p>
            </div>

            {!isSalesStaff && (
              <div className="text-left sm:text-right">
                <p className="text-xs text-slate-400 font-medium">Monthly Scoped Total</p>
                <div className="flex items-center gap-2">
                  <span className="text-base font-black text-slate-900 dark:text-white">
                    {settings.currencySymbol}{monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    monthlyChangeType === 'positive'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                      : monthlyChangeType === 'negative'
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    {monthlyChangeStr}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="h-68 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  {!isSalesStaff && (
                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  )}
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#1e293b',
                    borderRadius: '12px',
                    color: '#fff',
                  }}
                />
                <Area type="monotone" dataKey="sales" name="Orders / Sales Units" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                {!isSalesStaff && (
                  <Area type="monotone" dataKey="revenue" name={`Revenue (${settings.currencySymbol})`} stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Side-by-Side Companion Accounts Widget (Mercury Style) */}
        {canAccessLiquidCash && treasuryBalances ? (
          <div className="bento-card flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-200/60 dark:border-blue-800/40">
                    <Wallet className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Accounts</h3>
                    <p className="text-[10px] text-slate-400">Live Liquid Positions</p>
                  </div>
                </div>
                <button
                  onClick={() => onNavigate('money-movement')}
                  title="Move Money or Transfer"
                  className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 hover:text-blue-600 dark:text-slate-300 text-slate-600 transition-colors"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                </button>
              </div>

              {/* Accounts List */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {/* Total Liquid Cash */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/60 dark:border-emerald-800/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                      <NairaSign className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">Total Liquid Cash</p>
                      <p className="text-[10px] text-slate-400">Combined Liquidity</p>
                    </div>
                  </div>
                  <p className="text-xs font-black text-slate-900 dark:text-white">
                    {settings.currencySymbol}{treasuryBalances.totalLiquidCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>

                {/* Biz Bank Account */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/50 border border-blue-200/60 dark:border-blue-800/50 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                      <Building className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Biz Bank Account</p>
                      <p className="text-[10px] text-slate-400">Operating Vault</p>
                    </div>
                  </div>
                  <p className="text-xs font-bold text-slate-900 dark:text-white">
                    {settings.currencySymbol}{treasuryBalances.bizAccountBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>

                {/* Physical Cash (Till) */}
                <div className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-200/60 dark:border-amber-800/50 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                      <Banknote className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Physical Cash (Till)</p>
                      <p className="text-[10px] text-slate-400">Counter Register</p>
                    </div>
                  </div>
                  <p className="text-xs font-bold text-slate-900 dark:text-white">
                    {settings.currencySymbol}{treasuryBalances.physicalCashBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>

                {/* Owner Drawings (if active) */}
                {treasuryBalances.totalOwnerDrawings > 0 && (
                  <div className="py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-purple-50 dark:bg-purple-950/50 border border-purple-200/60 dark:border-purple-800/50 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
                        <Wallet className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Owner Drawings</p>
                        <p className="text-[10px] text-slate-400">Cumulative Outflow</p>
                      </div>
                    </div>
                    <p className="text-xs font-bold text-purple-600 dark:text-purple-400">
                      {settings.currencySymbol}{treasuryBalances.totalOwnerDrawings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <button
                onClick={() => onNavigate('money-movement')}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 transition-colors"
              >
                <span>Move Money</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200/50 dark:border-emerald-800/50">
                Live
              </span>
            </div>
          </div>
        ) : (
          /* For Sales Staff, render Category Distribution here */
          <div className="bento-card flex flex-col justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Category Distribution
              </h3>
              <p className="text-xs text-slate-500">Product breakdown by segment</p>
            </div>

            <div className="h-48 my-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={5} dataKey="value">
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              {categoryData.map((cat) => (
                <div key={cat.name} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="text-slate-600 dark:text-slate-400 font-medium truncate">{cat.name}</span>
                  <span className="font-bold text-slate-900 dark:text-white ml-auto">{cat.value}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Operational Activity & Category Distribution */}
      <div className={`grid grid-cols-1 ${canAccessLiquidCash ? 'md:grid-cols-2 lg:grid-cols-3' : 'lg:grid-cols-2'} gap-6`}>
        {/* Recent Sales Table */}
        <div className="bento-card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Recent Sales
            </h3>
            <button
              onClick={() => onNavigate('sales')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                <tr>
                  <th className="py-2">Invoice</th>
                  <th className="py-2">Customer</th>
                  <th className="py-2">{isSalesStaff ? 'Items' : 'Amount'}</th>
                  <th className="py-2">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {sales.slice(0, 4).map((sale, idx) => {
                  const percent = Math.min(100, Math.max(10, Math.round((sale.totalAmount / maxRecentSaleTotal) * 100)));
                  return (
                    <tr key={`${sale.id}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 font-bold text-slate-900 dark:text-white">{sale.invoiceNo}</td>
                      <td className="py-2.5 font-medium truncate max-w-[110px]">{sale.customerName}</td>
                      <td className="py-2.5 font-bold text-emerald-600 dark:text-emerald-400">
                        <div>
                          {isSalesStaff
                            ? `${sale.items.reduce((a, b) => a + b.quantity, 0)} items`
                            : `${settings.currencySymbol}${sale.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </div>
                        {!isSalesStaff && (
                          <div className="w-16 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-1">
                            <div
                              className="h-full bg-emerald-500/70 dark:bg-emerald-400/70 rounded-full transition-all duration-300"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-medium text-[11px]">
                          {sale.paymentMethod}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stock Level Leaders */}
        <div className="bento-card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Key Inventory Levels
            </h3>
            <button
              onClick={() => onNavigate('inventory')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              Manage Stock
            </button>
          </div>

          <div className="space-y-3">
            {products.slice(0, 4).map((p) => {
              const maxStockBenchmark = Math.max(p.minimumStockLevel * 2.5, 20);
              const stockRatio = Math.min(100, Math.max(8, Math.round((p.currentStock / maxStockBenchmark) * 100)));
              const isCritical = p.currentStock <= 0;
              const isLow = p.currentStock <= p.minimumStockLevel;

              return (
                <div key={p.id} className="flex items-center justify-between p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                  <div className="flex items-center gap-3">
                    <img
                      src={p.images?.[0] || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&auto=format&fit=crop&q=60'}
                      alt={p.name}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-xl object-cover bg-slate-200 dark:bg-slate-700 shrink-0"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[140px]">
                        {p.name}
                      </p>
                      <p className="text-[10px] text-slate-500">{p.category} • SKU: {p.sku}</p>
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end">
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      {p.currentStock} {p.unit}
                    </p>
                    <div className="w-16 h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden my-1">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isCritical ? 'bg-rose-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${stockRatio}%` }}
                      />
                    </div>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                        isCritical
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                          : isLow
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Category Breakdown Pie Chart (when Liquid Accounts is in companion slot) */}
        {canAccessLiquidCash && (
          <div className="bento-card flex flex-col justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Category Distribution
              </h3>
              <p className="text-xs text-slate-500">Revenue contribution by segment</p>
            </div>

            <div className="h-44 my-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" innerRadius={46} outerRadius={68} paddingAngle={4} dataKey="value">
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              {categoryData.slice(0, 4).map((cat) => (
                <div key={cat.name} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                  <span className="text-slate-600 dark:text-slate-400 font-medium truncate text-[11px]">{cat.name}</span>
                  <span className="font-bold text-slate-900 dark:text-white ml-auto text-[11px]">{cat.value}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick Action Modals */}
      <AddProductModal
        isOpen={activeModal === 'product'}
        onClose={() => setActiveModal(null)}
      />

      <AddExpenseModal
        isOpen={activeModal === 'expense'}
        onClose={() => setActiveModal(null)}
      />

      <AddCustomerModal
        isOpen={activeModal === 'customer'}
        onClose={() => setActiveModal(null)}
      />

      <AddSupplierModal
        isOpen={activeModal === 'supplier'}
        onClose={() => setActiveModal(null)}
      />
    </div>
  );
};
