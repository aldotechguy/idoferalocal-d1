import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Image as ImageIcon, Check, Trash2, Link as LinkIcon, RefreshCw, Package, Tag } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Product, ProductStatus } from '../../types';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingProduct?: Product | null;
}

export const generate4CharSKU = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const DEFAULT_CATEGORIES = [
  'Packaging Materials',
  'Corrugated Boxes',
  'Shipping Pouches',
  'Plastic Containers',
  'Paper Bags',
  'Tape & Adhesives',
  'Labels & Stickers',
  'Cushioning & Bubble Wrap',
  'Industrial Wraps',
  'Eco Packaging',
  'Glass Bottles',
  'Cartons',
  'Poly Mailers',
  'Rigid Boxes',
  'Electronics',
  'Office Supplies',
  'Beverages',
  'Furniture',
];

const PRESET_PRODUCT_IMAGES = [
  { label: 'Cardboard Box', url: 'https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&auto=format&fit=crop' },
  { label: 'Packaging Pouches', url: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&auto=format&fit=crop' },
  { label: 'Bottle Container', url: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600&auto=format&fit=crop' },
  { label: 'Electronics Box', url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop' },
  { label: 'Eco Paper Bags', url: 'https://images.unsplash.com/photo-1597484661643-2f5fef640dd1?w=600&auto=format&fit=crop' },
];

export const AddProductModal: React.FC<AddProductModalProps> = ({
  isOpen,
  onClose,
  editingProduct,
}) => {
  const { products, addProduct, updateProduct, suppliers, settings } = useApp();
  const { currentUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getInitialState = () => {
    if (editingProduct) {
      return {
        name: editingProduct.name,
        sku: editingProduct.sku,
        barcode: editingProduct.barcode,
        qrCode: editingProduct.qrCode || '',
        category: editingProduct.category,
        brand: editingProduct.brand || 'General Brand',
        supplierId: editingProduct.supplierId || (suppliers[0]?.id || 'sup-1'),
        supplierName: editingProduct.supplierName || (suppliers[0]?.name || 'AeroTech Electronics Global'),
        description: editingProduct.description || '',
        images: editingProduct.images && editingProduct.images.length > 0
          ? editingProduct.images
          : ['https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&auto=format&fit=crop'],
        costPrice: editingProduct.costPrice,
        retailPrice: editingProduct.retailPrice,
        wholesalePrice: editingProduct.wholesalePrice,
        minWholesaleQty: editingProduct.minWholesaleQty || 10,
        dealerPrice: editingProduct.dealerPrice ?? editingProduct.wholesalePrice,
        promotionalPrice: editingProduct.promotionalPrice ?? editingProduct.retailPrice,
        minimumSellingPrice: editingProduct.minimumSellingPrice ?? editingProduct.costPrice,
        currentStock: editingProduct.currentStock,
        minimumStockLevel: editingProduct.minimumStockLevel,
        unit: editingProduct.unit || 'pcs',
        expiryDate: editingProduct.expiryDate || '',
        status: editingProduct.status || 'Active',
      };
    }
    return {
      name: '',
      sku: generate4CharSKU(),
      barcode: `${Math.floor(Math.random() * 899999999999 + 100000000000)}`,
      qrCode: `QR-${Math.floor(Math.random() * 89999 + 10000)}`,
      category: 'Packaging Materials',
      brand: 'Idofera Standard',
      supplierId: suppliers[0]?.id || 'sup-1',
      supplierName: suppliers[0]?.name || 'AeroTech Electronics Global',
      description: '',
      images: ['https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&auto=format&fit=crop'],
      costPrice: 500,
      retailPrice: 1200,
      wholesalePrice: 950,
      minWholesaleQty: 10,
      dealerPrice: 850,
      promotionalPrice: 1100,
      minimumSellingPrice: 750,
      currentStock: 50,
      minimumStockLevel: 10,
      unit: 'pcs',
      expiryDate: '',
      status: 'Active' as ProductStatus,
    };
  };

  const [formData, setFormData] = useState(getInitialState);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [imageUploadError, setImageUploadError] = useState('');
  const [activeTab, setActiveTab] = useState<'upload' | 'url' | 'presets'>('upload');

  // Category Auto Prediction state
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  const availableCategories = Array.from(
    new Set([
      ...products.map((p) => p.category).filter(Boolean),
      ...DEFAULT_CATEGORIES,
    ])
  );

  const filteredCategoryPredictions = availableCategories.filter((cat) =>
    cat.toLowerCase().includes(formData.category.toLowerCase().trim())
  );

  const topPrediction =
    formData.category.trim().length > 0
      ? filteredCategoryPredictions.find(
          (cat) => cat.toLowerCase() !== formData.category.toLowerCase()
        ) || filteredCategoryPredictions[0]
      : null;

  const handleApplyCategory = (cat: string) => {
    setFormData((prev) => ({ ...prev, category: cat }));
    setShowCategoryDropdown(false);
  };

  const handleCategoryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Tab' || e.key === 'Enter') && topPrediction && showCategoryDropdown) {
      if (topPrediction.toLowerCase() !== formData.category.toLowerCase()) {
        e.preventDefault();
        handleApplyCategory(topPrediction);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      setFormData(getInitialState());
      setImageUploadError('');
      setImageUrlInput('');
    }
  }, [isOpen, editingProduct]);

  if (!isOpen) return null;

  // Handle local file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setImageUploadError('');
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setImageUploadError('Please select a valid image file (PNG, JPG, WEBP, etc.)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setImageUploadError('Image size exceeds 5MB limit. Please choose a smaller file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setFormData((prev) => ({
        ...prev,
        images: [result, ...prev.images.filter((img) => !img.startsWith('data:'))],
      }));
    };
    reader.onerror = () => {
      setImageUploadError('Error reading file. Please try another image.');
    };
    reader.readAsDataURL(file);
  };

  const handleAddUrlImage = () => {
    if (!imageUrlInput.trim()) return;
    setFormData((prev) => ({
      ...prev,
      images: [imageUrlInput.trim(), ...prev.images],
    }));
    setImageUrlInput('');
  };

  const handleSelectPreset = (url: string) => {
    setFormData((prev) => ({
      ...prev,
      images: [url, ...prev.images.filter((i) => i !== url)],
    }));
  };

  const handleRemoveImage = (index: number) => {
    setFormData((prev) => {
      const updated = prev.images.filter((_, i) => i !== index);
      return {
        ...prev,
        images: updated.length > 0 ? updated : ['https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&auto=format&fit=crop'],
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    const selectedSupplier = suppliers.find((s) => s.id === formData.supplierId);
    const supplierName = selectedSupplier ? selectedSupplier.name : formData.supplierName;

    if (editingProduct) {
      if (currentUser?.role === 'Sales Staff') {
        alert('Sales Staff accounts are not authorized to edit existing products.');
        return;
      }
      updateProduct(editingProduct.id, {
        ...formData,
        supplierName,
      });
    } else {
      addProduct({
        ...formData,
        supplierName,
        status: formData.status || (formData.currentStock <= 0 ? 'Out of Stock' : formData.currentStock <= formData.minimumStockLevel ? 'Low Stock' : 'Active'),
      });
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span>{editingProduct ? `Edit Product (${editingProduct.sku})` : 'Add New Product'}</span>
            </h2>
            <p className="text-xs text-slate-500">
              Update all fields: info, codes, multi-tier pricing, stock thresholds, supplier, and media.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 text-xs">
          {/* Image Upload Section */}
          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Product Image & Gallery</span>
              </label>
              <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px]">
                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    activeTab === 'upload'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Upload File
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('url')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    activeTab === 'url'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Image URL
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('presets')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    activeTab === 'presets'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Presets
                </button>
              </div>
            </div>

            {/* Current Primary Image Preview */}
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="relative group w-28 h-28 shrink-0 rounded-2xl overflow-hidden border-2 border-dashed border-blue-400 dark:border-blue-600 bg-white dark:bg-slate-900 flex items-center justify-center shadow-xs">
                {formData.images?.[0] ? (
                  <>
                    <img
                      src={formData.images?.[0] || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&auto=format&fit=crop&q=60'}
                      alt="Product preview"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="p-1.5 bg-white/90 text-slate-900 rounded-lg hover:bg-white"
                        title="Change image"
                      >
                        <Upload className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-center p-2">
                    <ImageIcon className="w-6 h-6 text-slate-400 mx-auto mb-1" />
                    <span className="text-[10px] text-slate-400 font-medium">No Image</span>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2 w-full">
                {activeTab === 'upload' && (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="cursor-pointer border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 bg-white dark:bg-slate-900 rounded-2xl p-4 text-center transition-all hover:bg-blue-50/30 dark:hover:bg-blue-950/20"
                  >
                    <Upload className="w-5 h-5 text-blue-600 dark:text-blue-400 mx-auto mb-1.5" />
                    <p className="font-bold text-slate-900 dark:text-white text-xs">
                      Click to upload image from your device
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Supports PNG, JPG, WEBP up to 5MB
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                )}

                {activeTab === 'url' && (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <LinkIcon className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="url"
                        placeholder="https://example.com/product-image.jpg"
                        value={imageUrlInput}
                        onChange={(e) => setImageUrlInput(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddUrlImage}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shrink-0"
                    >
                      Use URL
                    </button>
                  </div>
                )}

                {activeTab === 'presets' && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {PRESET_PRODUCT_IMAGES.map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectPreset(preset.url)}
                        className={`flex items-center gap-2 p-1.5 rounded-xl border text-left transition-all ${
                          formData.images?.[0] === preset.url
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-bold'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-blue-400'
                        }`}
                      >
                        <img src={preset.url} alt={preset.label} referrerPolicy="no-referrer" className="w-7 h-7 rounded-lg object-cover shrink-0" />
                        <span className="text-[10px] truncate">{preset.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {imageUploadError && (
                  <p className="text-[11px] font-bold text-rose-600">{imageUploadError}</p>
                )}

                {/* Additional Gallery Thumbnails */}
                {formData.images.length > 1 && (
                  <div className="flex items-center gap-2 pt-1 overflow-x-auto">
                    <span className="text-[10px] font-bold text-slate-400 shrink-0">Gallery:</span>
                    {formData.images.map((img, i) => (
                      <div key={i} className="relative group shrink-0 w-8 h-8 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                        <img src={img} alt={`thumb-${i}`} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(i)}
                          className="absolute inset-0 bg-rose-600/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 1: Basic Information */}
          <div className="space-y-3">
            <h3 className="font-extrabold text-slate-900 dark:text-white uppercase text-[10px] tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-1">
              1. Basic Product Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Corrugated Packaging Carton Box"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-medium"
                />
              </div>

              {/* Category with Auto Prediction */}
              <div className="relative">
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-bold text-slate-700 dark:text-slate-300">
                    Category
                  </label>
                  {formData.category.trim() && topPrediction && topPrediction.toLowerCase() !== formData.category.toLowerCase() && (
                    <button
                      type="button"
                      onClick={() => handleApplyCategory(topPrediction)}
                      className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                      title="Click or press Tab/Enter to apply predicted category"
                    >
                      <Tag className="w-3 h-3 text-blue-500" />
                      <span>Predict: "{topPrediction}"</span>
                    </button>
                  )}
                </div>

                <div className="relative">
                  <input
                    type="text"
                    placeholder="Start typing category..."
                    list="category-auto-predictions"
                    value={formData.category}
                    onFocus={() => setShowCategoryDropdown(true)}
                    onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 200)}
                    onChange={(e) => {
                      setFormData({ ...formData, category: e.target.value });
                      setShowCategoryDropdown(true);
                    }}
                    onKeyDown={handleCategoryKeyDown}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-medium pr-8"
                  />
                  <Tag className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                </div>

                <datalist id="category-auto-predictions">
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>

                {/* Auto-Predict Dropdown Menu */}
                {showCategoryDropdown && formData.category.trim().length > 0 && filteredCategoryPredictions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl max-h-48 overflow-y-auto p-1.5 space-y-0.5">
                    <div className="px-2.5 py-1 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1 border-b border-slate-100 dark:border-slate-800 mb-1">
                      <Tag className="w-3 h-3 text-blue-500" />
                      <span>Predicted Categories</span>
                    </div>
                    {filteredCategoryPredictions.map((cat) => {
                      const isExactMatch = cat.toLowerCase() === formData.category.toLowerCase();
                      return (
                        <button
                          key={cat}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleApplyCategory(cat);
                          }}
                          className={`w-full text-left px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                            isExactMatch
                              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold'
                              : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                            <span>{cat}</span>
                          </div>
                          {isExactMatch && <Check className="w-3.5 h-3.5 text-blue-600" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Brand / Manufacturer
                </label>
                <input
                  type="text"
                  placeholder="e.g. Idofera, AeroTech, Generic"
                  value={formData.brand}
                  onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-bold text-slate-700 dark:text-slate-300">
                    SKU Code (4 Chars) *
                  </label>
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, sku: generate4CharSKU() }))}
                    className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    title="Generate fresh 4-character SKU"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>New 4-Char SKU</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  maxLength={10}
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-mono font-bold tracking-wider"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Barcode Number
                </label>
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  QR Code Reference
                </label>
                <input
                  type="text"
                  value={formData.qrCode}
                  onChange={(e) => setFormData({ ...formData, qrCode: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Multi-Tier Pricing Architecture */}
          <div className="space-y-3">
            <h3 className="font-extrabold text-slate-900 dark:text-white uppercase text-[10px] tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-1">
              2. Multi-Tier Pricing Architecture ({settings.currencySymbol})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {currentUser?.role !== 'Sales Staff' && (
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Cost Price ({settings.currencySymbol}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.costPrice}
                    onChange={(e) => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-bold"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Retail Selling Price ({settings.currencySymbol}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formData.retailPrice}
                  onChange={(e) => setFormData({ ...formData, retailPrice: parseFloat(e.target.value) || 0 })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-extrabold text-emerald-600 dark:text-emerald-400"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Minimum Floor Price ({settings.currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.minimumSellingPrice}
                  onChange={(e) => setFormData({ ...formData, minimumSellingPrice: parseFloat(e.target.value) || 0 })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-bold text-rose-600"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Wholesale Price ({settings.currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.wholesalePrice}
                  onChange={(e) => setFormData({ ...formData, wholesalePrice: parseFloat(e.target.value) || 0 })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-bold text-blue-600 dark:text-blue-400"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Min Wholesale Qty
                </label>
                <input
                  type="number"
                  value={formData.minWholesaleQty}
                  onChange={(e) => setFormData({ ...formData, minWholesaleQty: parseInt(e.target.value) || 1 })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Dealer / B2B Price ({settings.currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.dealerPrice}
                  onChange={(e) => setFormData({ ...formData, dealerPrice: parseFloat(e.target.value) || 0 })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-bold text-indigo-600"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Promotional Price ({settings.currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.promotionalPrice}
                  onChange={(e) => setFormData({ ...formData, promotionalPrice: parseFloat(e.target.value) || 0 })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-bold text-amber-600"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Stock Levels & Status */}
          <div className="space-y-3">
            <h3 className="font-extrabold text-slate-900 dark:text-white uppercase text-[10px] tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-1">
              3. Inventory Stock & Operational Status
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Current Stock Count *
                </label>
                <input
                  type="number"
                  required
                  value={formData.currentStock}
                  onChange={(e) => setFormData({ ...formData, currentStock: parseInt(e.target.value) || 0 })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-bold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Low Stock Threshold
                </label>
                <input
                  type="number"
                  value={formData.minimumStockLevel}
                  onChange={(e) => setFormData({ ...formData, minimumStockLevel: parseInt(e.target.value) || 0 })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Unit of Measure
                </label>
                <select
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-medium"
                >
                  <option value="pcs">Pieces (pcs)</option>
                  <option value="pack">Packs (pack)</option>
                  <option value="box">Carton Boxes (box)</option>
                  <option value="roll">Rolls (roll)</option>
                  <option value="kg">Kilograms (kg)</option>
                  <option value="set">Sets (set)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Product Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as ProductStatus })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-bold"
                >
                  <option value="Active">Active Catalog</option>
                  <option value="Low Stock">Low Stock Alert</option>
                  <option value="Out of Stock">Out of Stock</option>
                  <option value="Archived">Archived (Moved to Archive Page)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 4: Supplier & Expiry */}
          <div className="space-y-3">
            <h3 className="font-extrabold text-slate-900 dark:text-white uppercase text-[10px] tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-1">
              4. Supplier & Expiry Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Primary Supplier
                </label>
                <select
                  value={formData.supplierId}
                  onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500"
                >
                  {suppliers.map((sup) => (
                    <option key={sup.id} value={sup.id}>
                      {sup.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Expiry Date (If applicable)
                </label>
                <input
                  type="date"
                  value={formData.expiryDate}
                  onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Section 5: Description & Notes */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Description / Specifications
            </label>
            <textarea
              rows={2}
              placeholder="Provide item specifications, material density, dimension notes, or storage instructions..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white border border-transparent focus:border-blue-500"
            />
          </div>

          {/* Modal Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] text-slate-400">
              * Required fields. All changes save directly to Firestore repository.
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 font-extrabold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition-all hover:scale-102"
              >
                {editingProduct ? 'Save Product Changes' : 'Create Product'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
