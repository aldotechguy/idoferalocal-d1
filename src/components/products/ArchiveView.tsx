import React, { useState } from 'react';
import {
  Archive,
  Search,
  Filter,
  Edit2,
  Trash2,
  RefreshCw,
  Eye,
  ArrowLeft,
  Package,
  Boxes,
  X,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Product } from '../../types';
import { AddProductModal } from '../modals/AddProductModal';
import { ConfirmModal } from '../common/ConfirmModal';

interface ArchiveViewProps {
  onNavigate: (page: string) => void;
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({ onNavigate }) => {
  const { products, deleteProduct, unarchiveProduct, settings } = useApp();
  const { currentUser } = useAuth();
  const isSalesStaff = currentUser?.role === 'Sales Staff';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Modal States
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [productToUnarchive, setProductToUnarchive] = useState<Product | null>(null);

  // Archived products filter
  const archivedProducts = products.filter((p) => p.status === 'Archived');

  const categories = ['All', ...Array.from(new Set(archivedProducts.map((p) => p.category)))];

  const filteredProducts = archivedProducts.filter((p) => {
    if (!p) return false;
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch =
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q);

    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const totalArchivedStockValue = archivedProducts.reduce((sum, p) => sum + p.costPrice * p.currentStock, 0);

  return (
    <div className="space-y-6 pb-12 font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            onClick={() => onNavigate('products')}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Active Product Management</span>
          </button>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Archive className="w-6 h-6 text-amber-500" />
            <span>Archived Products Repository</span>
          </h1>
          <p className="text-xs text-slate-500">
            View, edit, or unarchive products that have been hidden from the active sales inventory.
          </p>
        </div>

        <button
          onClick={() => onNavigate('products')}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors self-start sm:self-auto"
        >
          <Package className="w-4 h-4 text-blue-600" />
          <span>Active Product Catalog ({products.filter((p) => p.status !== 'Archived').length})</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center shrink-0">
            <Archive className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Archived Products</p>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white">{archivedProducts.length} items</h3>
          </div>
        </div>

        {!isSalesStaff ? (
          <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center shrink-0">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Archived Stock Value</p>
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">
                {settings.currencySymbol}{totalArchivedStockValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </h3>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center shrink-0">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Archived Stock Units</p>
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">
                {archivedProducts.reduce((sum, p) => sum + p.currentStock, 0)} units
              </h3>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center shrink-0">
            <RefreshCw className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Restore Status</p>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-1">
              Unarchived products return directly to active POS & Inventory.
            </p>
          </div>
        </div>
      </div>

      {/* Toolbar Filters */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full min-w-0">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search archived by name, SKU, barcode..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800/80 border border-transparent focus:border-amber-500 text-slate-900 dark:text-slate-100 text-xs rounded-xl focus:outline-none"
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

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
          <div className="flex items-center gap-1 text-xs text-slate-500 font-semibold">
            <Filter className="w-3.5 h-3.5" />
            <span>Category:</span>
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-xl border border-transparent focus:border-amber-500"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold">
            LIFO · Newest First
          </div>
        </div>
      </div>

      {/* Archived Products Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4">Archived Product</th>
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
                  <td colSpan={9} className="py-12 text-center space-y-3">
                    <Archive className="w-10 h-10 text-slate-300 mx-auto" />
                    <p className="text-slate-400 font-medium text-xs">
                      {archivedProducts.length === 0
                        ? 'No products are currently archived in your repository.'
                        : 'No archived products found matching your search filter.'}
                    </p>
                    {archivedProducts.length === 0 && (
                      <button
                        onClick={() => onNavigate('products')}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs inline-flex items-center gap-2"
                      >
                        <Package className="w-4 h-4" />
                        <span>Go to Active Product Management</span>
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
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
                    </td>

                    {/* Stock */}
                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900 dark:text-white">
                        {product.currentStock} {product.unit}
                      </p>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800">
                        <Archive className="w-3 h-3" />
                        <span>Archived</span>
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
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
                              onClick={() => setEditingProduct(product)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                              title="Edit Product Fields"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => setProductToUnarchive(product)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900 font-extrabold text-[11px] rounded-xl transition-colors border border-emerald-200/50 dark:border-emerald-800"
                              title="Unarchive Product"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Unarchive</span>
                            </button>

                            <button
                              onClick={() => setProductToDelete(product)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                              title="Delete Permanently"
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
      </div>

      {/* Edit Product Modal */}
      <AddProductModal
        isOpen={!!editingProduct}
        onClose={() => setEditingProduct(null)}
        editingProduct={editingProduct}
      />

      {/* Viewing Details Modal */}
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
                <p className="font-bold text-blue-600 dark:text-blue-400">{settings.currencySymbol}{(Number(viewingProduct.wholesalePrice) || 0).toFixed(2)}</p>
              </div>
              <div>
                <span className="text-slate-400">Archived Stock:</span>
                <p className="font-bold text-amber-600 dark:text-amber-400">{viewingProduct.currentStock} {viewingProduct.unit}</p>
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

      {/* Unarchive Confirmation Modal */}
      <ConfirmModal
        isOpen={!!productToUnarchive}
        title="Unarchive Product"
        message={`Are you sure you want to restore "${productToUnarchive?.name}" (SKU: ${productToUnarchive?.sku}) back to the active product management inventory?`}
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

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!productToDelete}
        title="Delete Archived Product"
        message={`Are you sure you want to permanently delete "${productToDelete?.name}"? This action cannot be undone.`}
        confirmText="Permanently Delete"
        variant="danger"
        onClose={() => setProductToDelete(null)}
        onConfirm={() => {
          if (productToDelete) {
            deleteProduct(productToDelete.id);
            setProductToDelete(null);
          }
        }}
      />
    </div>
  );
};
