import React, { useState } from 'react';
import {
  Package,
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Archive,
  Download,
  Upload,
  Eye,
  RefreshCw,
  X,
  Copy,
  Boxes,
  AlertTriangle,
  TrendingDown,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Product } from '../../types';
import { AddProductModal } from '../modals/AddProductModal';
import { ConfirmModal } from '../common/ConfirmModal';
import { Pagination } from '../common/Pagination';

interface ProductsViewProps {
  onNavigate: (page: string) => void;
}

export const ProductsView: React.FC<ProductsViewProps> = ({ onNavigate }) => {
  const { products, deleteProduct, archiveProduct, unarchiveProduct, deduplicateProductsBySku, settings } = useApp();
  const { currentUser } = useAuth();
  const isSalesStaff = currentUser?.role === 'Sales Staff';

  const duplicateSkuCount = React.useMemo(() => {
    const skuMap = new Map<string, number>();
    let dupes = 0;
    products.forEach((p) => {
      if (p.sku && p.sku.trim()) {
        const k = p.sku.trim().toUpperCase();
        const count = (skuMap.get(k) || 0) + 1;
        skuMap.set(k, count);
        if (count === 2) dupes++;
      }
    });
    return dupes;
  }, [products]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [productToArchive, setProductToArchive] = useState<Product | null>(null);
  const [productToUnarchive, setProductToUnarchive] = useState<Product | null>(null);

  const categories = ['All', ...Array.from(new Set(products.map((p) => p.category)))];
  const totalProductsCount = products.length;
  const archivedCount = products.filter((p) => p.status === 'Archived').length;
  const activeProductsCount = products.filter((p) => p.status !== 'Archived').length;
  const lowStockCount = products.filter((p) => p.status !== 'Archived' && (p.status === 'Low Stock' || (p.currentStock > 0 && p.currentStock <= p.minimumStockLevel))).length;
  const outOfStockCount = products.filter((p) => p.status !== 'Archived' && (p.status === 'Out of Stock' || p.currentStock <= 0)).length;
  const totalStockUnits = products.filter((p) => p.status !== 'Archived').reduce((acc, p) => acc + (p.currentStock || 0), 0);

  // Filtering & Sorting Logic
  const filteredProducts = products.filter((p) => {
    if (!p) return false;
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch =
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q);

    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;

    let matchesStatus = false;
    if (selectedStatus === 'All') {
      matchesStatus = p.status !== 'Archived';
    } else if (selectedStatus === 'Out of Stock') {
      matchesStatus = p.status !== 'Archived' && (p.status === 'Out of Stock' || p.currentStock <= 0);
    } else if (selectedStatus === 'Low Stock') {
      matchesStatus = p.status !== 'Archived' && (p.status === 'Low Stock' || (p.currentStock > 0 && p.currentStock <= p.minimumStockLevel));
    } else {
      matchesStatus = p.status === selectedStatus;
    }

    return matchesSearch && matchesCategory && matchesStatus;
  });

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset page on filter changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory, selectedStatus]);

  const totalPages = Math.ceil(filteredProducts.length / pageSize) || 1;
  const paginatedProducts = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, currentPage, pageSize]);

  const handleOpenAddModal = () => {
    setEditingProduct(null);
    setShowAddModal(true);
  };

  const handleOpenEditModal = (product: Product) => {
    setEditingProduct(product);
  };

  const handleExportCSV = () => {
    const headers = ['Name', 'SKU', 'Barcode', 'Category', 'Cost Price', 'Retail Price', 'Wholesale Price', 'Stock', 'Unit', 'Status'];
    const rows = products.map((p) => [
      `"${p.name}"`,
      p.sku,
      p.barcode,
      `"${p.category}"`,
      p.costPrice,
      p.retailPrice,
      p.wholesalePrice,
      p.currentStock,
      p.unit,
      p.status,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Idofera_Packaging_Products_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 pb-12 font-sans">
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-600" />
            <span>Product Management</span>
          </h1>
          <p className="text-xs text-slate-500">
            Total {totalProductsCount} Products in Inventory ({activeProductsCount} active SKUs, {archivedCount} archived).
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onNavigate('archive')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/80 text-amber-800 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/80 rounded-xl text-xs font-bold transition-all shadow-2xs"
            title="View Archived Products Page"
          >
            <Archive className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>Archive Page ({archivedCount})</span>
          </button>

          {!isSalesStaff && (
            <>
              <button
                onClick={() => onNavigate('import')}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors"
              >
                <Upload className="w-4 h-4" />
                <span>Bulk Import</span>
              </button>

              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Export CSV</span>
              </button>

              <button
                onClick={() => deduplicateProductsBySku()}
                className="flex items-center gap-1.5 px-3 py-2 bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 dark:hover:bg-purple-900/80 text-purple-700 dark:text-purple-300 border border-purple-200/80 dark:border-purple-800/80 rounded-xl text-xs font-bold transition-all"
                title="Remove duplicate products matching by SKU key"
              >
                <Copy className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span>Deduplicate SKUs</span>
              </button>
            </>
          )}

          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all hover:scale-102"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Product</span>
          </button>
        </div>
      </div>

      {/* Inventory Overview Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Products</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">{totalProductsCount}</p>
            <p className="text-[10px] font-medium text-slate-500 mt-0.5">
              {activeProductsCount} Active • {archivedCount} Archived
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Inventory Stock</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{totalStockUnits.toLocaleString()} pcs</p>
            <p className="text-[10px] font-medium text-slate-500 mt-0.5">Across {activeProductsCount} active SKUs</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Boxes className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Low Stock SKUs</p>
            <p className={`text-2xl font-black mt-0.5 ${lowStockCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
              {lowStockCount}
            </p>
            <p className="text-[10px] font-medium text-slate-500 mt-0.5">Below reorder threshold</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Out of Stock</p>
            <p className={`text-2xl font-black mt-0.5 ${outOfStockCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
              {outOfStockCount}
            </p>
            <p className="text-[10px] font-medium text-slate-500 mt-0.5">Stock level is 0</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
            <TrendingDown className="w-5 h-5" />
          </div>
        </div>
      </div>

      {duplicateSkuCount > 0 && !isSalesStaff && (
        <div className="bg-amber-50 dark:bg-amber-950/70 border border-amber-200/90 dark:border-amber-800/90 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                Duplicate Items Detected in Inventory
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                Found duplicate SKU records (likely from repeated batch import). You can clean up duplicate records instantly using SKU as the key.
              </p>
            </div>
          </div>
          <button
            onClick={() => deduplicateProductsBySku()}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs shrink-0 transition-colors"
          >
            Clean Duplicates Now
          </button>
        </div>
      )}

      {/* Filters & Search Toolbar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full min-w-0">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, SKU, or barcode..."
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

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <div className="flex items-center gap-1 text-xs text-slate-500 font-semibold">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter:</span>
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-xl border border-transparent focus:border-blue-500"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-xl border border-transparent focus:border-blue-500"
          >
            <option value="All">Active Catalog (Excl. Archived)</option>
            <option value="Active">Active Only</option>
            <option value="Low Stock">Low Stock</option>
            <option value="Out of Stock">Out of Stock</option>
            <option value="Archived">Archived Items ({archivedCount})</option>
          </select>

          <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold">
            LIFO · Newest First
          </div>
        </div>
      </div>

      {/* Product Grid Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-medium">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
            <span>Showing <strong className="font-bold text-slate-900 dark:text-white">{filteredProducts.length}</strong> of <strong className="font-bold text-slate-900 dark:text-white">{totalProductsCount}</strong> total products in inventory</span>
          </div>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              <span>Clear Search</span>
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4">Product</th>
                <th className="py-3 px-3">SKU & Barcode</th>
                <th className="py-3 px-3">Category</th>
                {!isSalesStaff && <th className="py-3 px-3">Cost Price</th>}
                <th className="py-3 px-3">Retail Price</th>
                <th className="py-3 px-3">Wholesale Price</th>
                <th className="py-3 px-3">Stock Level</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No products found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((product) => (
                  <tr
                    key={product.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    {/* Product Name & Image */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={product.images?.[0] || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&auto=format&fit=crop&q=60'}
                          alt={product.name}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-xl object-cover bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 shrink-0"
                        />
                        <div>
                          <p className="font-bold text-slate-900 dark:text-white line-clamp-1">
                            {product.name}
                          </p>
                          <p className="text-[10px] text-slate-400">{product.brand}</p>
                        </div>
                      </div>
                    </td>

                    {/* SKU & Barcode */}
                    <td className="py-3 px-3">
                      <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                        {product.sku}
                      </p>
                      <p className="font-mono text-[10px] text-slate-400">
                        {product.barcode}
                      </p>
                    </td>

                    {/* Category */}
                    <td className="py-3 px-3 font-medium text-slate-600 dark:text-slate-400">
                      {product.category}
                    </td>

                    {/* Cost */}
                    {!isSalesStaff && (
                      <td className="py-3 px-3 font-semibold text-slate-500">
                        {settings.currencySymbol}{(Number(product.costPrice) || 0).toFixed(2)}
                      </td>
                    )}

                    {/* Retail */}
                    <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                      {settings.currencySymbol}{(Number(product.retailPrice) || 0).toFixed(2)}
                    </td>

                    {/* Wholesale */}
                    <td className="py-3 px-3 font-bold text-blue-600 dark:text-blue-400">
                      {settings.currencySymbol}{(Number(product.wholesalePrice) || 0).toFixed(2)}
                      <span className="text-[9px] text-slate-400 block font-normal">
                        Min: {product.minWholesaleQty || 1} {product.unit || 'pcs'}
                      </span>
                    </td>

                    {/* Stock */}
                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900 dark:text-white">
                        {product.currentStock} {product.unit}
                      </p>
                      <p className="text-[10px] text-slate-400">Min: {product.minimumStockLevel}</p>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          product.status === 'Out of Stock'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                            : product.status === 'Low Stock'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                            : product.status === 'Archived'
                            ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                        }`}
                      >
                        {product.status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewingProduct(product)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {!isSalesStaff && (
                          <>
                            <button
                              onClick={() => handleOpenEditModal(product)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                              title="Edit All Product Fields"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>

                            {product.status === 'Archived' ? (
                              <button
                                onClick={() => setProductToUnarchive(product)}
                                className="p-1.5 text-slate-400 hover:text-emerald-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                                title="Unarchive Product"
                              >
                                <RefreshCw className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => setProductToArchive(product)}
                                className="p-1.5 text-slate-400 hover:text-amber-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                                title="Archive Product"
                              >
                                <Archive className="w-4 h-4" />
                              </button>
                            )}

                            <button
                              onClick={() => setProductToDelete(product)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                              title="Delete Product"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={filteredProducts.length}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          itemLabel="products"
        />
      </div>

      {/* Add / Edit Product Modal */}
      <AddProductModal
        isOpen={showAddModal || !!editingProduct}
        onClose={() => {
          setShowAddModal(false);
          setEditingProduct(null);
        }}
        editingProduct={editingProduct}
      />

      {/* Product Detail Modal */}
      {viewingProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <img
                  src={viewingProduct.images?.[0] || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&auto=format&fit=crop&q=60'}
                  alt={viewingProduct.name}
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 rounded-2xl object-cover bg-slate-100 border border-slate-200 dark:border-slate-800 shrink-0"
                />
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    {viewingProduct.name}
                  </h3>
                  <p className="text-xs text-slate-500">{viewingProduct.category} • {viewingProduct.brand}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingProduct(null)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
              <div>
                <span className="text-slate-400">SKU:</span>
                <p className="font-bold font-mono">{viewingProduct.sku}</p>
              </div>
              <div>
                <span className="text-slate-400">Barcode:</span>
                <p className="font-bold font-mono">{viewingProduct.barcode}</p>
              </div>
              {!isSalesStaff && (
                <div>
                  <span className="text-slate-400">Cost Price:</span>
                  <p className="font-bold text-slate-700 dark:text-slate-300">{settings.currencySymbol}{(Number(viewingProduct.costPrice) || 0).toFixed(2)}</p>
                </div>
              )}
              <div>
                <span className="text-slate-400">Retail Price:</span>
                <p className="font-bold text-slate-900 dark:text-white">{settings.currencySymbol}{(Number(viewingProduct.retailPrice) || 0).toFixed(2)}</p>
              </div>
              <div>
                <span className="text-slate-400">Wholesale Price:</span>
                <p className="font-bold text-blue-600 dark:text-blue-400">{settings.currencySymbol}{(Number(viewingProduct.wholesalePrice) || 0).toFixed(2)} (Min {viewingProduct.minWholesaleQty || 1})</p>
              </div>
              <div>
                <span className="text-slate-400">Current Stock:</span>
                <p className="font-bold text-emerald-600 dark:text-emerald-400">{viewingProduct.currentStock} {viewingProduct.unit}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              {viewingProduct.description || 'No additional description provided.'}
            </p>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setViewingProduct(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 font-bold text-xs text-slate-700 dark:text-slate-300 rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Product Confirmation Modal */}
      <ConfirmModal
        isOpen={!!productToDelete}
        title="Delete Product"
        message={`Are you sure you want to permanently delete "${productToDelete?.name}" (SKU: ${productToDelete?.sku})? This action cannot be undone.`}
        confirmText="Delete Product"
        variant="danger"
        onClose={() => setProductToDelete(null)}
        onConfirm={() => {
          if (productToDelete) {
            deleteProduct(productToDelete.id);
            setProductToDelete(null);
          }
        }}
      />

      {/* Archive Product Confirmation Modal */}
      <ConfirmModal
        isOpen={!!productToArchive}
        title="Archive Product"
        message={`Are you sure you want to move "${productToArchive?.name}" to archived status? It will be moved to the Archive Page.`}
        confirmText="Archive Product"
        variant="warning"
        onClose={() => setProductToArchive(null)}
        onConfirm={() => {
          if (productToArchive) {
            archiveProduct(productToArchive.id);
            setProductToArchive(null);
          }
        }}
      />

      {/* Unarchive Product Confirmation Modal */}
      <ConfirmModal
        isOpen={!!productToUnarchive}
        title="Unarchive Product"
        message={`Are you sure you want to restore "${productToUnarchive?.name}" back to active inventory?`}
        confirmText="Unarchive & Restore"
        variant="info"
        onClose={() => setProductToUnarchive(null)}
        onConfirm={() => {
          if (productToUnarchive) {
            unarchiveProduct(productToUnarchive.id);
            setProductToUnarchive(null);
          }
        }}
      />
    </div>
  );
};
