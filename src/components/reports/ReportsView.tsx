import React, { useState, useMemo } from 'react';
import {
  Download,
  Calendar,
  TrendingUp,
  TrendingDown,
  ShoppingBag,
  Receipt,
  FileText,
  Boxes,
  PieChart,
  ArrowRight,
  Filter,
  Layers,
  ChevronDown,
  CheckCircle2,
  DollarSign,
  AlertCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { InvestmentPlannerView } from '../finance/InvestmentPlannerView';

export const ReportsView: React.FC = () => {
  const { sales, products, expenses, settings } = useApp();

  // Read any pre-selected period intent from navigation (e.g. from Dashboard "Past Month" button)
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => {
    const saved = localStorage.getItem('idofera_reports_period');
    if (saved) {
      localStorage.removeItem('idofera_reports_period');
      return saved;
    }
    return 'this_month';
  });

  const [reportType, setReportType] = useState<
    | 'MonthlyBiz'
    | 'Sales'
    | 'ProfitLoss'
    | 'InventoryValuation'
    | 'RetailVsWholesale'
    | 'TopSellers'
    | 'DeadStock'
    | 'InvestmentPlanner'
  >(() => {
    const savedType = localStorage.getItem('idofera_reports_type');
    if (savedType) {
      localStorage.removeItem('idofera_reports_type');
      return savedType as any;
    }
    return 'MonthlyBiz';
  });

  const cs = settings.currencySymbol || '₦';

  // Date Calculations for Current & Past Months
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const currentMonthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const priorMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const priorMonthStr = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const priorMonthLabel = priorMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Dynamically generate all selectable historical months
  const availableMonths = useMemo(() => {
    const monthKeys = new Set<string>();

    // Add last 12 calendar months by default
    for (let i = 0; i < 12; i++) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthKeys.add(key);
    }

    // Also include any months present in historical sales or expenses
    sales.forEach((s) => {
      if (s.createdAt && /^\d{4}-\d{2}/.test(s.createdAt)) {
        monthKeys.add(s.createdAt.substring(0, 7));
      }
    });

    expenses.forEach((e) => {
      const d = e.date || e.createdAt;
      if (d && /^\d{4}-\d{2}/.test(d)) {
        monthKeys.add(d.substring(0, 7));
      }
    });

    return Array.from(monthKeys)
      .sort((a, b) => b.localeCompare(a))
      .map((key) => {
        const [y, m] = key.split('-').map(Number);
        const dateObj = new Date(y, m - 1, 1);
        const label = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        return {
          key,
          label,
          isCurrent: key === currentMonthStr,
          isPrior: key === priorMonthStr,
        };
      });
  }, [sales, expenses, currentYear, currentMonth, currentMonthStr, priorMonthStr]);

  // Resolve the active filtering month key (null means all time)
  const resolvedMonthKey = useMemo(() => {
    if (selectedPeriod === 'all_time') return null;
    if (selectedPeriod === 'this_month') return currentMonthStr;
    if (selectedPeriod === 'last_month') return priorMonthStr;
    return selectedPeriod;
  }, [selectedPeriod, currentMonthStr, priorMonthStr]);

  // Determine active month human-readable display label
  const activePeriodLabel = useMemo(() => {
    if (!resolvedMonthKey) return 'All-Time Records';
    const found = availableMonths.find((m) => m.key === resolvedMonthKey);
    return found ? found.label : resolvedMonthKey;
  }, [resolvedMonthKey, availableMonths]);

  // Calculate preceding month key for Month-over-Month comparisons
  const precedingMonthKey = useMemo(() => {
    if (!resolvedMonthKey) return null;
    const [y, m] = resolvedMonthKey.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  }, [resolvedMonthKey]);

  const precedingMonthLabel = useMemo(() => {
    if (!precedingMonthKey) return null;
    const [y, m] = precedingMonthKey.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }, [precedingMonthKey]);

  // Valid, non-refunded/non-draft sales base
  const validSales = useMemo(
    () => sales.filter((s) => s.status !== 'Refunded' && s.status !== 'Held' && s.status !== 'Draft'),
    [sales]
  );

  // Period-Scoped Sales & Expenses
  const periodSales = useMemo(() => {
    if (!resolvedMonthKey) return validSales;
    return validSales.filter((s) => s.createdAt && s.createdAt.startsWith(resolvedMonthKey));
  }, [validSales, resolvedMonthKey]);

  const periodExpenses = useMemo(() => {
    if (!resolvedMonthKey) return expenses;
    return expenses.filter((e) => {
      const d = e.date || e.createdAt;
      return Boolean(d && d.startsWith(resolvedMonthKey));
    });
  }, [expenses, resolvedMonthKey]);

  // Preceding Period Sales (for MoM calculations)
  const precedingPeriodSales = useMemo(() => {
    if (!precedingMonthKey) return [];
    return validSales.filter((s) => s.createdAt && s.createdAt.startsWith(precedingMonthKey));
  }, [validSales, precedingMonthKey]);

  // Core Financial Aggregations for Active Period
  const periodRevenue = useMemo(
    () => periodSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0),
    [periodSales]
  );

  const precedingPeriodRevenue = useMemo(
    () => precedingPeriodSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0),
    [precedingPeriodSales]
  );

  let momRevenuePct: number | null = null;
  if (precedingPeriodRevenue > 0) {
    momRevenuePct = ((periodRevenue - precedingPeriodRevenue) / precedingPeriodRevenue) * 100;
  }

  const periodRetailSales = useMemo(
    () => periodSales.filter((s) => s.type === 'Retail').reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0),
    [periodSales]
  );

  const periodWholesaleSales = useMemo(
    () => periodSales.filter((s) => s.type === 'Wholesale').reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0),
    [periodSales]
  );

  const periodDiscounts = useMemo(
    () => periodSales.reduce((acc, s) => acc + (Number(s.discount) || 0), 0),
    [periodSales]
  );

  const periodCOGS = useMemo(
    () =>
      periodSales.reduce((acc, s) => {
        const saleCost = (s.items || []).reduce((sum, item) => {
          const c = Number(item.costPrice) || 0;
          const q = Number(item.quantity) || 1;
          return sum + c * q;
        }, 0);
        return acc + saleCost;
      }, 0),
    [periodSales]
  );

  const periodGrossProfit = Math.max(0, periodRevenue - periodCOGS);
  const periodGrossMarginPct = periodRevenue > 0 ? (periodGrossProfit / periodRevenue) * 100 : 0;

  const periodExpenseTotal = useMemo(
    () => periodExpenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0),
    [periodExpenses]
  );

  const periodNetProfit = periodGrossProfit - periodExpenseTotal;
  const periodNetMarginPct = periodRevenue > 0 ? (periodNetProfit / periodRevenue) * 100 : 0;

  const periodOrdersCount = periodSales.length;
  const periodAOV = periodOrdersCount > 0 ? periodRevenue / periodOrdersCount : 0;

  // Operating Expenses by Category in Period
  const expensesByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    periodExpenses.forEach((e) => {
      const cat = e.category || 'Miscellaneous';
      map[cat] = (map[cat] || 0) + (Number(e.amount) || 0);
    });
    return Object.entries(map)
      .map(([category, amount]) => ({
        category,
        amount,
        pctOfTotal: periodExpenseTotal > 0 ? (amount / periodExpenseTotal) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [periodExpenses, periodExpenseTotal]);

  // Payment Methods Breakdown in Period
  const paymentMethodsBreakdown = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    periodSales.forEach((s) => {
      const method = s.paymentMethod || 'Cash';
      if (!map[method]) {
        map[method] = { count: 0, total: 0 };
      }
      map[method].count += 1;
      map[method].total += Number(s.totalAmount) || 0;
    });
    return Object.entries(map)
      .map(([method, data]) => ({
        method,
        count: data.count,
        total: data.total,
        pct: periodRevenue > 0 ? (data.total / periodRevenue) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [periodSales, periodRevenue]);

  // Top Selling Products in Active Period
  const productSalesMap: Record<
    string,
    { name: string; sku: string; unitsSold: number; totalRevenue: number; totalCost: number }
  > = {};

  periodSales.forEach((s) => {
    (s.items || []).forEach((item) => {
      if (!item.productId) return;
      if (!productSalesMap[item.productId]) {
        productSalesMap[item.productId] = {
          name: item.productName || 'Product',
          sku: item.sku || 'N/A',
          unitsSold: 0,
          totalRevenue: 0,
          totalCost: 0,
        };
      }
      const itemQty = Number(item.quantity) || 1;
      const itemRev =
        item.total !== undefined ? Number(item.total) : (Number(item.unitPrice) || 0) * itemQty;
      const itemCost = (Number(item.costPrice) || 0) * itemQty;

      productSalesMap[item.productId].unitsSold += itemQty;
      productSalesMap[item.productId].totalRevenue += isNaN(itemRev) ? 0 : itemRev;
      productSalesMap[item.productId].totalCost += itemCost;
    });
  });

  const topSellersList = Object.values(productSalesMap).sort(
    (a, b) => b.totalRevenue - a.totalRevenue
  );

  // Dead / Slow Moving Stock Aggregation (Catalog-wide)
  const soldProductIds = new Set(Object.keys(productSalesMap));
  const deadStockList = products.filter(
    (p) => !soldProductIds.has(p.id) || (productSalesMap[p.id]?.unitsSold || 0) === 0
  );

  // Export CSV Handler
  const handleExportCSV = () => {
    const fileDateStr = resolvedMonthKey || 'All_Time';
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    let customFileName = `IdoferaLabs_${reportType}_Report_${fileDateStr}.csv`;

    if (reportType === 'MonthlyBiz') {
      customFileName = `IdoferaLabs_Monthly_Biz_Report_${activePeriodLabel.replace(/\s+/g, '_')}.csv`;
      headers = ['Section', 'Metric / Item', 'Details', 'Amount (NGN)'];
      rows = [
        ['Header', 'Store Name', settings.storeName || 'Idofera Packaging', ''],
        ['Header', 'Report Period', activePeriodLabel, ''],
        ['Header', 'Generated Date', new Date().toLocaleString(), ''],
        ['Executive Summary', 'Total Gross Revenue', `${periodOrdersCount} Orders`, periodRevenue.toFixed(2)],
        ['Executive Summary', 'Retail Sales Volume', '', periodRetailSales.toFixed(2)],
        ['Executive Summary', 'Wholesale Sales Volume', '', periodWholesaleSales.toFixed(2)],
        ['Executive Summary', 'Cost of Goods Sold (COGS)', 'Product Purchase Cost', (-periodCOGS).toFixed(2)],
        ['Executive Summary', 'Gross Profit', `${periodGrossMarginPct.toFixed(1)}% Gross Margin`, periodGrossProfit.toFixed(2)],
        ['Executive Summary', 'Total Operating Expenses', `${periodExpenses.length} Expense entries`, (-periodExpenseTotal).toFixed(2)],
        ['Executive Summary', 'Net Profit / (Loss)', `${periodNetMarginPct.toFixed(1)}% Net Margin`, periodNetProfit.toFixed(2)],
        ['Executive Summary', 'Average Order Value (AOV)', '', periodAOV.toFixed(2)],
        ['---', '---', '---', '---'],
        ['Operating Expenses', 'Category Breakdown', '', ''],
        ...expensesByCategory.map((e) => [
          'Expense Item',
          e.category,
          `${e.pctOfTotal.toFixed(1)}% of total overhead`,
          e.amount.toFixed(2),
        ]),
        ['---', '---', '---', '---'],
        ['Top Products in Month', 'Product SKU', 'Units Sold in Month', 'Revenue in Month'],
        ...topSellersList.slice(0, 10).map((p) => [
          p.name,
          p.sku,
          p.unitsSold,
          p.totalRevenue.toFixed(2),
        ]),
        ['---', '---', '---', '---'],
        ['Transactions Ledger', 'Date & Time', 'Customer', 'Invoice Total'],
        ...periodSales.map((s) => [
          s.invoiceNo || 'N/A',
          new Date(s.createdAt).toLocaleDateString(),
          s.customerName || 'Walk-in',
          (Number(s.totalAmount) || 0).toFixed(2),
        ]),
      ];
    } else if (reportType === 'Sales') {
      headers = ['Invoice No', 'Date', 'Customer', 'Type', 'Status', 'Amount', 'Payment Method'];
      rows = periodSales.map((s) => [
        s.invoiceNo && s.invoiceNo !== 'N/A' ? s.invoiceNo : 'N/A',
        new Date(s.createdAt).toLocaleDateString(),
        s.customerName || 'Customer',
        s.type || 'Retail',
        s.status || 'Completed',
        (Number(s.totalAmount) || 0).toFixed(2),
        s.paymentMethod || 'Cash',
      ]);
    } else if (reportType === 'ProfitLoss') {
      headers = ['Financial Line Item', 'Type', 'Amount (NGN)'];
      rows = [
        ['Gross Sales Revenue', 'Income', periodRevenue.toFixed(2)],
        ['Retail Sales Portion', 'Income Breakdown', periodRetailSales.toFixed(2)],
        ['Wholesale Sales Portion', 'Income Breakdown', periodWholesaleSales.toFixed(2)],
        ['Discounts Given', 'Deduction', (-periodDiscounts).toFixed(2)],
        ['Cost of Goods Sold (COGS)', 'Cost', (-periodCOGS).toFixed(2)],
        ['GROSS PROFIT', 'Calculated', periodGrossProfit.toFixed(2)],
        ['Total Operational Overhead', 'Expense', (-periodExpenseTotal).toFixed(2)],
        ...expensesByCategory.map((e) => [`  - ${e.category}`, 'Expense Detail', (-e.amount).toFixed(2)]),
        ['NET OPERATING PROFIT / (LOSS)', 'Final Net', periodNetProfit.toFixed(2)],
      ];
    } else if (reportType === 'InventoryValuation') {
      headers = ['Product Name', 'SKU', 'Category', 'Stock', 'Unit Cost', 'Total Valuation'];
      rows = products.map((p) => [
        p.name,
        p.sku,
        p.category,
        p.currentStock,
        (Number(p.costPrice) || 0).toFixed(2),
        ((Number(p.currentStock) || 0) * (Number(p.costPrice) || 0)).toFixed(2),
      ]);
    } else if (reportType === 'RetailVsWholesale') {
      headers = ['Product Name', 'SKU', 'Cost Price', 'Retail Price', 'Wholesale Price', 'Margin Diff (%)'];
      rows = products.map((p) => {
        const cost = Number(p.costPrice) || 0;
        const retail = Number(p.retailPrice) || 0;
        const wholesale = Number(p.wholesalePrice) || 0;
        const diff = retail - wholesale;
        const diffPct = wholesale > 0 ? (diff / wholesale) * 100 : 0;
        return [p.name, p.sku, cost.toFixed(2), retail.toFixed(2), wholesale.toFixed(2), `${diffPct.toFixed(1)}%`];
      });
    } else if (reportType === 'TopSellers') {
      headers = ['Rank', 'Product Name', 'SKU', 'Units Sold', 'Total Revenue'];
      rows = topSellersList.map((item, idx) => [
        idx + 1,
        item.name,
        item.sku,
        item.unitsSold,
        item.totalRevenue.toFixed(2),
      ]);
    } else if (reportType === 'DeadStock') {
      headers = ['Product Name', 'SKU', 'Category', 'Stock Level', 'Unit Cost', 'Tied Capital Value'];
      rows = deadStockList.map((p) => {
        const stock = Number(p.currentStock) || 0;
        const cost = Number(p.costPrice) || 0;
        return [p.name, p.sku, p.category, stock, cost.toFixed(2), (stock * cost).toFixed(2)];
      });
    }

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))].join(
        '\n'
      );
    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = customFileName;
    link.click();
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-xs font-extrabold uppercase tracking-wider">
            <Calendar className="w-4 h-4" />
            <span>Financial Statements & Auditing</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Monthly Biz Reports & Intelligence
          </h1>
          <p className="text-xs text-slate-500 max-w-2xl">
            Review audited monthly turnover, past month profit & loss, operating expense breakdowns, and export official executive statements.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs transition-all hover:scale-105"
          >
            <Download className="w-4 h-4" />
            <span>Export Statement (CSV / Excel)</span>
          </button>
        </div>
      </div>

      {/* Month & Period Selector Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Quick Presets */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 mr-1 shrink-0 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" />
              <span>Report Period:</span>
            </span>

            <button
              onClick={() => setSelectedPeriod('this_month')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-all shrink-0 ${
                selectedPeriod === 'this_month' || selectedPeriod === currentMonthStr
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              This Month ({now.toLocaleDateString('en-US', { month: 'short' })})
            </button>

            <button
              onClick={() => setSelectedPeriod('last_month')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-all shrink-0 ${
                selectedPeriod === 'last_month' || selectedPeriod === priorMonthStr
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Last Month ({priorMonthDate.toLocaleDateString('en-US', { month: 'short' })})
            </button>

            <button
              onClick={() => setSelectedPeriod('all_time')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-all shrink-0 ${
                selectedPeriod === 'all_time'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              All Time
            </button>
          </div>

          {/* Past Months Dropdown */}
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="past-month-select" className="text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
              Select Past Month:
            </label>
            <div className="relative">
              <select
                id="past-month-select"
                value={
                  selectedPeriod === 'this_month'
                    ? currentMonthStr
                    : selectedPeriod === 'last_month'
                    ? priorMonthStr
                    : selectedPeriod
                }
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="appearance-none bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 pr-8 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                {availableMonths.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} {m.isCurrent ? '(Current)' : m.isPrior ? '(Last Month)' : ''}
                  </option>
                ))}
                <option value="all_time">All Time Cumulative</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Active Period Status Pill */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span>
              Active Audit Target: <strong className="text-slate-900 dark:text-white">{activePeriodLabel}</strong>
            </span>
            {resolvedMonthKey && (
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold">
                {resolvedMonthKey === currentMonthStr ? 'Month in progress' : 'Closed past month'}
              </span>
            )}
          </div>
          <span className="text-[11px]">
            Showing <strong>{periodSales.length}</strong> sales & <strong>{periodExpenses.length}</strong> expense logs
          </span>
        </div>
      </div>

      {/* Report Category Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {[
          { id: 'MonthlyBiz', label: '📊 Monthly Biz Report' },
          { id: 'ProfitLoss', label: 'Income & Expense (P&L)' },
          { id: 'Sales', label: 'Sales Transactions' },
          { id: 'TopSellers', label: 'Top Selling Products' },
          { id: 'InventoryValuation', label: 'Inventory Valuation' },
          { id: 'RetailVsWholesale', label: 'Retail vs Wholesale' },
          { id: 'DeadStock', label: 'Dead / Slow Stock' },
          { id: 'InvestmentPlanner', label: '🚀 Capital & Investment Planner' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setReportType(item.id as any)}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all whitespace-nowrap ${
              reportType === item.id
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* ========================================================= */}
      {/* TAB 1: MONTHLY BIZ REPORT (EXECUTIVE VIEW) */}
      {/* ========================================================= */}
      {reportType === 'MonthlyBiz' && (
        <div className="space-y-6">
          {/* Executive KPI Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Monthly Gross Turnover */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                <span>Gross Turnover / Revenue</span>
                <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                  <TrendingUp className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                {cs}{periodRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">{periodOrdersCount} total sales</span>
                {momRevenuePct !== null && (
                  <span
                    className={`font-bold flex items-center gap-0.5 ${
                      momRevenuePct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {momRevenuePct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {momRevenuePct >= 0 ? '+' : ''}{momRevenuePct.toFixed(1)}% vs {precedingMonthLabel}
                  </span>
                )}
              </div>
            </div>

            {/* Cost of Goods Sold & Gross Profit */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                <span>Gross Profit (After COGS)</span>
                <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                  <ShoppingBag className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
                {cs}{periodGrossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">COGS: -{cs}{periodCOGS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span className="font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-full">
                  {periodGrossMarginPct.toFixed(1)}% Margin
                </span>
              </div>
            </div>

            {/* Net Profit After Expenses */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                <span>Net Business Profit / (Loss)</span>
                <span
                  className={`p-2 rounded-xl ${
                    periodNetProfit >= 0
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                      : 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                  }`}
                >
                  <DollarSign className="w-4 h-4" />
                </span>
              </div>
              <div
                className={`text-2xl font-black tracking-tight ${
                  periodNetProfit >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {cs}{periodNetProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Store Overhead: -{cs}{periodExpenseTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span
                  className={`font-extrabold px-2 py-0.5 rounded-full ${
                    periodNetProfit >= 0
                      ? 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'text-rose-700 bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300'
                  }`}
                >
                  {periodNetMarginPct.toFixed(1)}% Net Margin
                </span>
              </div>
            </div>
          </div>

          {/* Performance Deep-Dive 2-Column Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Audited Statement of Profit or Loss */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">
                    Monthly Profit & Loss Statement
                  </h3>
                  <p className="text-[11px] text-slate-500">Period: {activePeriodLabel}</p>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                  Audited Line Items
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60 font-semibold">
                  <span className="text-slate-600 dark:text-slate-300">Retail Sales:</span>
                  <span className="text-slate-900 dark:text-white">{cs}{periodRetailSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60 font-semibold">
                  <span className="text-slate-600 dark:text-slate-300">Wholesale Sales:</span>
                  <span className="text-slate-900 dark:text-white">{cs}{periodWholesaleSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {periodDiscounts > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60 font-semibold text-rose-600">
                    <span>Discounts Granted:</span>
                    <span>-{cs}{periodDiscounts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 rounded-xl font-bold">
                  <span className="text-slate-900 dark:text-white">GROSS REVENUE:</span>
                  <span className="text-blue-600 dark:text-blue-400">{cs}{periodRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>

                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60 font-semibold text-rose-600 dark:text-rose-400">
                  <span>Less: Cost of Goods Sold (COGS):</span>
                  <span>-{cs}{periodCOGS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>

                <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-700 bg-blue-50/50 dark:bg-blue-950/30 px-3 rounded-xl font-extrabold text-blue-900 dark:text-blue-200">
                  <span>GROSS OPERATING PROFIT:</span>
                  <span>{cs}{periodGrossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>

                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60 font-semibold text-rose-600 dark:text-rose-400">
                  <span>Less: Operating Overhead / Expenses:</span>
                  <span>-{cs}{periodExpenseTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>

                <div className="flex justify-between py-3 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 px-4 rounded-2xl font-black text-sm shadow-2xs">
                  <span>NET BUSINESS PROFIT:</span>
                  <span>{cs}{periodNetProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {/* Operating Overhead & Expense Breakdown */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">
                    Monthly Operating Overhead
                  </h3>
                  <p className="text-[11px] text-slate-500">Expenses logged in {activePeriodLabel}</p>
                </div>
                <span className="font-extrabold text-xs text-rose-600 dark:text-rose-400">
                  Total: {cs}{periodExpenseTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {expensesByCategory.length === 0 ? (
                <div className="py-12 text-center text-slate-400 italic text-xs">
                  No operational expenses logged for {activePeriodLabel}.
                </div>
              ) : (
                <div className="space-y-3">
                  {expensesByCategory.map((item) => (
                    <div key={item.category} className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <span>{item.category}</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {cs}{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                          <span className="text-[10px] text-slate-400 font-normal">({item.pctOfTotal.toFixed(1)}%)</span>
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-rose-500 h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, Math.max(2, item.pctOfTotal))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Payment Methods Breakdown */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <h4 className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider text-[10px]">
                  Payment Channels Utilized
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {paymentMethodsBreakdown.map((pm) => (
                    <div key={pm.method} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                      <p className="text-[10px] text-slate-400 font-bold truncate">{pm.method}</p>
                      <p className="text-xs font-extrabold text-slate-900 dark:text-white">{cs}{pm.total.toFixed(0)}</p>
                      <p className="text-[9px] text-slate-500">{pm.count} orders</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Top Products in that Month */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">
                  Top Performing Products in {activePeriodLabel}
                </h3>
                <p className="text-[11px] text-slate-500">Packaging items driving revenue and volume during this period</p>
              </div>
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2.5 py-1 rounded-full">
                {topSellersList.length} Products Sold
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-3">Product Name</th>
                    <th className="py-3 px-3">SKU</th>
                    <th className="py-3 px-3 text-right">Units Sold</th>
                    <th className="py-3 px-3 text-right">Revenue</th>
                    <th className="py-3 px-4 text-right">Est. Gross Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {topSellersList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                        No product sales recorded for {activePeriodLabel}.
                      </td>
                    </tr>
                  ) : (
                    topSellersList.slice(0, 10).map((item, idx) => {
                      const itemProfit = Math.max(0, item.totalRevenue - item.totalCost);
                      return (
                        <tr key={item.sku + idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-black text-blue-600 dark:text-blue-400">#{idx + 1}</td>
                          <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">{item.name}</td>
                          <td className="py-3 px-3 font-mono text-[11px] text-slate-500">{item.sku}</td>
                          <td className="py-3 px-3 font-bold text-emerald-600 text-right">{item.unitsSold} units</td>
                          <td className="py-3 px-3 font-bold text-slate-900 dark:text-white text-right">{cs}{item.totalRevenue.toFixed(2)}</td>
                          <td className="py-3 px-4 font-bold text-emerald-600 dark:text-emerald-400 text-right">
                            +{cs}{itemProfit.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* OTHER REPORT TABS (HONORING ACTIVE PERIOD FILTER) */}
      {/* ========================================================= */}
      {reportType !== 'MonthlyBiz' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 font-extrabold text-sm text-slate-900 dark:text-white flex items-center justify-between flex-wrap gap-2">
            <span>Active Report: {reportType}</span>
            <span className="text-xs font-semibold text-slate-400">
              {['Sales', 'ProfitLoss', 'TopSellers'].includes(reportType)
                ? `Filtered by: ${activePeriodLabel}`
                : 'Full Catalog Snapshot'}
            </span>
          </div>

          <div className="overflow-x-auto">
            {/* Sales Table */}
            {reportType === 'Sales' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Invoice No</th>
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Customer</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">Payment Method</th>
                    <th className="py-3 px-4 text-right">Total Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {periodSales.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                        No sales transactions found for {activePeriodLabel}.
                      </td>
                    </tr>
                  ) : (
                    periodSales.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                          {s.invoiceNo && s.invoiceNo !== 'N/A' ? s.invoiceNo : 'N/A'}
                        </td>
                        <td className="py-3 px-3">{new Date(s.createdAt).toLocaleDateString()}</td>
                        <td className="py-3 px-3 font-medium">{s.customerName}</td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-semibold">
                            {s.type}
                          </span>
                        </td>
                        <td className="py-3 px-3">{s.paymentMethod}</td>
                        <td className="py-3 px-4 font-bold text-emerald-600 dark:text-emerald-400 text-right">
                          {cs}{Number(s.totalAmount || 0).toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {/* Profit & Loss Table */}
            {reportType === 'ProfitLoss' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Financial Metric</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">Gross Sales Revenue</td>
                    <td className="py-3 px-3 text-emerald-600 font-semibold">Income</td>
                    <td className="py-3 px-4 font-bold text-emerald-600 text-right">{cs}{periodRevenue.toFixed(2)}</td>
                  </tr>
                  <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">Cost of Goods Sold (COGS)</td>
                    <td className="py-3 px-3 text-rose-600 font-semibold">Expense</td>
                    <td className="py-3 px-4 font-bold text-rose-600 text-right">-{cs}{periodCOGS.toFixed(2)}</td>
                  </tr>
                  <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 font-bold bg-slate-50/50 dark:bg-slate-800/30">
                    <td className="py-3 px-4 text-slate-900 dark:text-white">Gross Profit</td>
                    <td className="py-3 px-3 text-blue-600">Calculated</td>
                    <td className="py-3 px-4 text-blue-600 text-right">{cs}{periodGrossProfit.toFixed(2)}</td>
                  </tr>
                  <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">Total Operating Expenses</td>
                    <td className="py-3 px-3 text-rose-600 font-semibold">Expense</td>
                    <td className="py-3 px-4 font-bold text-rose-600 text-right">-{cs}{periodExpenseTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 font-black bg-emerald-50/40 dark:bg-emerald-950/20">
                    <td className="py-3.5 px-4 text-emerald-900 dark:text-emerald-200">Net Profit / (Loss)</td>
                    <td className="py-3.5 px-3 text-emerald-700">Final Net</td>
                    <td className="py-3.5 px-4 text-emerald-600 text-right">{cs}{periodNetProfit.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Inventory Valuation Table */}
            {reportType === 'InventoryValuation' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Product Name</th>
                    <th className="py-3 px-3">SKU</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">In Stock</th>
                    <th className="py-3 px-3">Unit Cost</th>
                    <th className="py-3 px-4 text-right">Total Valuation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 italic">No products in inventory.</td>
                    </tr>
                  ) : (
                    products.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{p.name}</td>
                        <td className="py-3 px-3 font-mono text-[11px]">{p.sku}</td>
                        <td className="py-3 px-3">{p.category}</td>
                        <td className="py-3 px-3 font-bold">{p.currentStock} {p.unit}</td>
                        <td className="py-3 px-3">{cs}{p.costPrice.toFixed(2)}</td>
                        <td className="py-3 px-4 font-bold text-blue-600 dark:text-blue-400 text-right">
                          {cs}{(p.currentStock * p.costPrice).toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {/* Retail vs Wholesale Table */}
            {reportType === 'RetailVsWholesale' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Product Name</th>
                    <th className="py-3 px-3">SKU</th>
                    <th className="py-3 px-3">Cost Price</th>
                    <th className="py-3 px-3">Retail Price</th>
                    <th className="py-3 px-3">Wholesale Price</th>
                    <th className="py-3 px-4 text-right">Retail Premium %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {products.map((p) => {
                    const premPct =
                      p.wholesalePrice > 0 ? (((p.retailPrice - p.wholesalePrice) / p.wholesalePrice) * 100).toFixed(1) : '0.0';
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{p.name}</td>
                        <td className="py-3 px-3 font-mono text-[11px]">{p.sku}</td>
                        <td className="py-3 px-3 text-slate-500">{cs}{p.costPrice.toFixed(2)}</td>
                        <td className="py-3 px-3 font-bold text-emerald-600 dark:text-emerald-400">{cs}{p.retailPrice.toFixed(2)}</td>
                        <td className="py-3 px-3 font-bold text-indigo-600 dark:text-indigo-400">{cs}{p.wholesalePrice.toFixed(2)}</td>
                        <td className="py-3 px-4 font-bold text-right text-blue-600 dark:text-blue-400">+{premPct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* Top Sellers Table */}
            {reportType === 'TopSellers' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-3">Product Name</th>
                    <th className="py-3 px-3">SKU</th>
                    <th className="py-3 px-3">Units Sold</th>
                    <th className="py-3 px-4 text-right">Total Sales Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {topSellersList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400 italic">
                        No product sales logged for {activePeriodLabel}.
                      </td>
                    </tr>
                  ) : (
                    topSellersList.map((item, idx) => (
                      <tr key={item.sku + idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-black text-blue-600 dark:text-blue-400">#{idx + 1}</td>
                        <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">{item.name}</td>
                        <td className="py-3 px-3 font-mono text-[11px]">{item.sku}</td>
                        <td className="py-3 px-3 font-bold text-emerald-600">{item.unitsSold} units</td>
                        <td className="py-3 px-4 font-black text-slate-900 dark:text-white text-right">{cs}{item.totalRevenue.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {/* Dead Stock Table */}
            {reportType === 'DeadStock' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Product Name</th>
                    <th className="py-3 px-3">SKU</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Unsold Stock</th>
                    <th className="py-3 px-3">Unit Cost</th>
                    <th className="py-3 px-4 text-right">Tied Capital</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {deadStockList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-emerald-600 font-semibold">
                        Great job! No dead or stagnant stock identified.
                      </td>
                    </tr>
                  ) : (
                    deadStockList.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{p.name}</td>
                        <td className="py-3 px-3 font-mono text-[11px]">{p.sku}</td>
                        <td className="py-3 px-3">{p.category}</td>
                        <td className="py-3 px-3 font-bold text-amber-600">{p.currentStock} {p.unit}</td>
                        <td className="py-3 px-3">{cs}{p.costPrice.toFixed(2)}</td>
                        <td className="py-3 px-4 font-bold text-rose-600 text-right">{cs}{(p.currentStock * p.costPrice).toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 8: CAPITAL INVESTMENT & INVENTORY PLANNER */}
      {/* ========================================================= */}
      {reportType === 'InvestmentPlanner' && (
        <InvestmentPlannerView />
      )}
    </div>
  );
};
