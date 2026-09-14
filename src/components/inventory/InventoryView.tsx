import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Plus,
  Minus,
  RefreshCw,
  Search,
  Filter,
  History,
  FileText,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  Building,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MovementType, StockMovement } from '../../types';
import { useAuth } from '../../context/AuthContext';

export const InventoryView: React.FC = () => {
  const { products, stockMovements, adjustStock } = useApp();
  const { currentUser } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);
  const [showAdjustModal, setShowAdjustModal] = useState(false);

  // Form State
  const [targetProductId, setTargetProductId] = useState<string>(products[0]?.id || '');
  const [movementType, setMovementType] = useState<MovementType>('Adjustment');
  const [quantity, setQuantity] = useState<number>(1);
  const [notes, setNotes] = useState<string>('');

  // Reset pagination when filters, search query, or sorting change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedType, itemsPerPage]);

  const filteredMovements = stockMovements
    .filter((mv) => {
      if (!mv) return false;
      const q = (searchQuery || '').toLowerCase();
      const matchesSearch =
        (mv.productName || '').toLowerCase().includes(q) ||
        (mv.referenceNo && mv.referenceNo.toLowerCase().includes(q));
      const matchesType = selectedType === 'All' || mv.type === selectedType;
      return matchesSearch && matchesType;
    })
    .sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return timeB - timeA;
    });

  const totalPages = Math.ceil(filteredMovements.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, filteredMovements.length);
  const paginatedMovements = filteredMovements.slice(startIndex, endIndex);

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetProductId || quantity <= 0) return;

    // Determine sign: Incoming, Opening, Returned, Transfer in are +, Outgoing, Damaged, Lost are -
    const isNegative = ['Outgoing', 'Damaged', 'Lost'].includes(movementType);
    const qtyChange = isNegative ? -quantity : quantity;

    adjustStock(
      targetProductId,
      qtyChange,
      movementType,
      notes || `Manual stock update (${movementType})`,
      currentUser?.displayName || 'Inventory Manager'
    );

    setShowAdjustModal(false);
    setNotes('');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Inventory & Stock Audit
          </h1>
          <p className="text-xs text-slate-500">
            Real-time stock tracking, warehouse movements, damaged/loss logs, and permanent stock movement history.
          </p>
        </div>

        {currentUser?.role !== 'Sales Staff' && (
          <button
            onClick={() => setShowAdjustModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Record Stock Movement</span>
          </button>
        )}
      </div>

      {/* Quick Summary Widgets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-slate-400">Total Items in Stock</span>
          <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">
            {products.reduce((sum, p) => sum + p.currentStock, 0)}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-slate-400">Low Stock SKUs</span>
          <p className="text-xl font-extrabold text-amber-600 dark:text-amber-400 mt-1">
            {products.filter((p) => p.currentStock > 0 && p.currentStock <= p.minimumStockLevel).length}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-slate-400">Out of Stock SKUs</span>
          <p className="text-xl font-extrabold text-rose-600 dark:text-rose-400 mt-1">
            {products.filter((p) => p.currentStock <= 0).length}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-slate-400">Total Movements Recorded</span>
          <p className="text-xl font-extrabold text-blue-600 dark:text-blue-400 mt-1">
            {stockMovements.length}
          </p>
        </div>
      </div>

      {/* Toolbar & Filter */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full min-w-0">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search product name or reference..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800/80 border border-transparent focus:border-blue-500 text-slate-900 dark:text-slate-100 text-xs rounded-xl focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl">
            LIFO · Newest First
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold">Movement Type:</span>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-xl border border-transparent focus:border-blue-500 cursor-pointer"
            >
              <option value="All">All Types</option>
              <option value="Opening Stock">Opening Stock</option>
              <option value="Incoming">Incoming</option>
              <option value="Outgoing">Outgoing</option>
              <option value="Adjustment">Adjustment</option>
              <option value="Damaged">Damaged</option>
              <option value="Returned">Returned</option>
              <option value="Lost">Lost</option>
              <option value="Transfer">Transfer</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stock History Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-extrabold text-slate-900 dark:text-white text-sm flex items-center gap-2">
            <History className="w-4 h-4 text-blue-600" />
            <span>Permanent Movement History</span>
          </h3>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50">
            Sorting: LIFO (Newest First)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-3">Product Name</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3">Quantity</th>
                <th className="py-3 px-3">Stock Audit (Prev → New)</th>
                <th className="py-3 px-3">Reference / Notes</th>
                <th className="py-3 px-4">Performed By</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No stock movements recorded yet.
                  </td>
                </tr>
              ) : (
                paginatedMovements.map((mv, idx) => {
                  const isPositive = ['Opening Stock', 'Incoming', 'Returned'].includes(mv.type);
                  return (
                    <tr key={`${mv.id}-${idx}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                        {new Date(mv.createdAt).toLocaleString()}
                      </td>

                      <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                        {mv.productName}
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isPositive
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                          }`}
                        >
                          {mv.type}
                        </span>
                      </td>

                      <td className="py-3 px-3 font-bold font-mono">
                        {isPositive ? `+${mv.quantity}` : `-${mv.quantity}`}
                      </td>

                      <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-400">
                        {mv.previousStock} → <span className="font-bold text-slate-900 dark:text-white">{mv.newStock}</span>
                      </td>

                      <td className="py-3 px-3">
                        <p className="font-mono text-[10px] font-bold text-slate-800 dark:text-slate-200">
                          {mv.referenceNo || '-'}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate max-w-[200px]">
                          {mv.notes}
                        </p>
                      </td>

                      <td className="py-3 px-4 font-semibold text-slate-600 dark:text-slate-400">
                        {mv.performedBy}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {filteredMovements.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-medium bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Showing <strong className="text-slate-900 dark:text-white font-bold">{startIndex + 1}</strong> to{' '}
                <strong className="text-slate-900 dark:text-white font-bold">{endIndex}</strong> of{' '}
                <strong className="text-slate-900 dark:text-white font-bold">{filteredMovements.length}</strong> records
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-400">Rows per page:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => setItemsPerPage(Number(e.target.value))}
                  className="px-2 py-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold focus:outline-none cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="First Page"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-3 py-1 font-semibold text-slate-700 dark:text-slate-300">
                Page <strong className="text-slate-900 dark:text-white">{currentPage}</strong> of{' '}
                <strong className="text-slate-900 dark:text-white">{totalPages}</strong>
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Last Page"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Adjust Stock Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                Record Stock Movement
              </h3>
              <button
                onClick={() => setShowAdjustModal(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Product
                </label>
                <select
                  value={targetProductId}
                  onChange={(e) => setTargetProductId(e.target.value)}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-medium"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Current Stock: {p.currentStock} {p.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Movement Classification
                </label>
                <select
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value as MovementType)}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-medium"
                >
                  <option value="Incoming">Incoming (Supplier Delivery / Restock)</option>
                  <option value="Outgoing">Outgoing (Manual Reduction)</option>
                  <option value="Adjustment">Adjustment (Stocktaking discrepancy)</option>
                  <option value="Damaged">Damaged Items</option>
                  <option value="Returned">Returned Customer Items</option>
                  <option value="Lost">Lost / Stolen Items</option>
                  <option value="Transfer">Warehouse Transfer</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Quantity Units
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Notes / Audit Details
                </label>
                <input
                  type="text"
                  placeholder="e.g. Broken packaging on transit"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs"
                >
                  Save Movement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
