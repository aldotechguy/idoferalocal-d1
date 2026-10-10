import React, { useState, useEffect, useMemo } from 'react';
import { Package, X, Plus, Sparkles, RefreshCw, AlertCircle, Tag, Layers, DollarSign } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Product } from '../../types';

interface QuickAddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialName?: string;
  selectedSupplierId?: string;
  onProductCreated: (product: Product, initialQty: number, unitCost: number) => void;
}

export const QuickAddProductModal: React.FC<QuickAddProductModalProps> = ({
  isOpen,
  onClose,
  initialName = '',
  selectedSupplierId = '',
  onProductCreated,
}) => {
  const { products, suppliers, addProduct, settings } = useApp();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('General');
  const [brand, setBrand] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [costPrice, setCostPrice] = useState<string>('');
  const [retailPrice, setRetailPrice] = useState<string>('');
  const [wholesalePrice, setWholesalePrice] = useState<string>('');
  const [minWholesaleQty, setMinWholesaleQty] = useState<number>(settings.defaultMinWholesaleQty || 3);
  const [minStockLevel, setMinStockLevel] = useState<number>(5);
  const [initialQty, setInitialQty] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);

  // Existing categories for quick suggestions
  const existingCategories = useMemo(() => {
    const cats = Array.from(new Set(products.map((p) => p.category).filter(Boolean)));
    return cats.length > 0 ? cats : ['General', 'Electronics', 'Groceries', 'Beverages', 'Clothing'];
  }, [products]);

  // Generate unique SKU helper
  const generateSku = (prodName: string) => {
    const prefix = prodName
      ? prodName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase()
      : 'SKU';
    const rand = Math.floor(Math.random() * 8999 + 1000);
    return `${prefix || 'PRD'}-${rand}`;
  };

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setSku(generateSku(initialName));
      setCategory('General');
      setBrand('');
      setCostPrice('');
      setRetailPrice('');
      setWholesalePrice('');
      setInitialQty(1);
      setError(null);
    }
  }, [isOpen, initialName]);

  if (!isOpen) return null;

  const handleNameChange = (val: string) => {
    setName(val);
    if (!sku || sku.startsWith('SKU-') || sku.startsWith('PRD-')) {
      setSku(generateSku(val));
    }
    if (error) setError(null);
  };

  const handleCostChange = (val: string) => {
    setCostPrice(val);
    const cost = parseFloat(val);
    if (!isNaN(cost) && cost > 0 && (!retailPrice || parseFloat(retailPrice) <= cost)) {
      // Suggest a 25% markup if retail price is empty
      const suggestedRetail = Math.ceil(cost * 1.25);
      setRetailPrice(suggestedRetail.toString());
      setWholesalePrice(Math.ceil(cost * 1.15).toString());
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Product name is required.');
      return;
    }

    const trimmedSku = sku.trim();
    if (!trimmedSku) {
      setError('SKU is required.');
      return;
    }

    // Check duplicate SKU
    const skuExists = products.some(
      (p) => p.sku.toLowerCase() === trimmedSku.toLowerCase()
    );
    if (skuExists) {
      setError(`SKU "${trimmedSku}" is already used by another product.`);
      return;
    }

    const cost = parseFloat(costPrice);
    if (isNaN(cost) || cost <= 0) {
      setError('Please enter a valid cost price greater than 0.');
      return;
    }

    const retail = parseFloat(retailPrice);
    if (isNaN(retail) || retail <= 0) {
      setError('Please enter a valid retail price greater than 0.');
      return;
    }

    const wholesale = parseFloat(wholesalePrice) || Math.round(cost * 1.15 * 100) / 100;
    const orderQty = Math.max(1, initialQty || 1);

    const supplierObj = suppliers.find((s) => s.id === selectedSupplierId);

    const newProd = addProduct({
      name: trimmedName,
      sku: trimmedSku,
      barcode: `${Math.floor(Math.random() * 899999999999 + 100000000000)}`,
      category: category.trim() || 'General',
      brand: brand.trim() || 'General',
      supplierId: supplierObj ? supplierObj.id : '',
      supplierName: supplierObj ? supplierObj.name : 'Unassigned',
      description: '',
      images: ['https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&auto=format&fit=crop'],
      costPrice: cost,
      retailPrice: retail,
      wholesalePrice: wholesale,
      minWholesaleQty: minWholesaleQty || 3,
      minimumSellingPrice: cost,
      currentStock: 0, // Starts at 0, this PO will order and receive it
      minimumStockLevel: minStockLevel || 5,
      unit: unit || 'pcs',
      status: 'Out of Stock',
    });

    // addProduct returns null when the SKU collides (duplicate rejected) — keep
    // this modal open so the user can correct it rather than injecting a null.
    if (!newProd) return;
    onProductCreated(newProd, orderQty, cost);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 my-auto max-h-[95vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 rounded-xl">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                Quick Add Product to Catalog
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Add catalog product and automatically inject into this Purchase Order
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs text-rose-600 dark:text-rose-400 font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs flex-1 overflow-y-auto pr-1">
          {/* Product Name */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Product Title / Name *
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Samsung 25W Fast Charger (Type-C)"
              className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Category & Brand */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                <Tag className="w-3 h-3 text-slate-400" />
                <span>Category *</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  list="quick-po-category-list"
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Accessories"
                  className="w-full p-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <datalist id="quick-po-category-list">
                  {existingCategories.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Brand / Manufacturer
              </label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Samsung, Apple, Generic"
                className="w-full p-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* SKU & Unit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700 dark:text-slate-300">SKU / Code *</label>
                <button
                  type="button"
                  onClick={() => setSku(generateSku(name))}
                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>Regenerate</span>
                </button>
              </div>
              <input
                type="text"
                required
                value={sku}
                onChange={(e) => {
                  setSku(e.target.value.toUpperCase());
                  if (error) setError(null);
                }}
                className="w-full p-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                <Layers className="w-3 h-3 text-slate-400" />
                <span>Unit of Measure</span>
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full p-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="pcs">Pieces (pcs)</option>
                <option value="box">Boxes (box)</option>
                <option value="carton">Cartons (carton)</option>
                <option value="pack">Packs (pack)</option>
                <option value="kg">Kilograms (kg)</option>
                <option value="set">Sets (set)</option>
              </select>
            </div>
          </div>

          {/* Pricing Grid */}
          <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 rounded-2xl space-y-2">
            <span className="text-[10px] font-extrabold uppercase text-blue-800 dark:text-blue-300 tracking-wider block">
              Pricing Configuration
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  PO Unit Cost ({settings.currencySymbol}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={costPrice}
                  onChange={(e) => handleCostChange(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  Target Retail Price ({settings.currencySymbol}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={retailPrice}
                  onChange={(e) => setRetailPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  Wholesale Price ({settings.currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={wholesalePrice}
                  onChange={(e) => setWholesalePrice(e.target.value)}
                  placeholder="Optional"
                  className="w-full p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Initial Order Quantity for this PO */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Order Quantity for this PO *
              </label>
              <input
                type="number"
                min="1"
                required
                value={initialQty}
                onChange={(e) => setInitialQty(parseInt(e.target.value) || 1)}
                className="w-full p-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-center text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Min Stock Alert Level
              </label>
              <input
                type="number"
                min="0"
                value={minStockLevel}
                onChange={(e) => setMinStockLevel(parseInt(e.target.value) || 0)}
                className="w-full p-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-center text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product to PO</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
