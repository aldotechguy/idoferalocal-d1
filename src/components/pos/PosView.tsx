import React, { useMemo, useState } from 'react';
import {
  ShoppingCart,
  Search,
  Barcode,
  Trash2,
  Plus,
  Minus,
  Pause,
  Play,
  CreditCard,
  Banknote,
  Smartphone,
  Building,
  User,
  Tag,
  Printer,
  CheckCircle,
  Check,
  X,
  MessageCircle,
  Edit3,
  History,
  Calendar,
  Truck,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Product, SaleItem, PaymentMethod, Customer, WhatsAppPreOrder } from '../../types';
import { ReceiptModal } from '../common/ReceiptModal';
import { useAuth } from '../../context/AuthContext';

export const PosView: React.FC = () => {
  const {
    products,
    sales,
    customers,
    processSale,
    holdOrder,
    heldOrders,
    restoreHeldOrder,
    deleteHeldOrder,
    deleteHeldOrderItem,
    clearAllHeldOrders,
    whatsAppPreOrders,
    convertPreOrderToSale,
    settings,
  } = useApp();
  const { currentUser } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Mobile Transfer');
  const [paidAmountInput, setPaidAmountInput] = useState<string>('');
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitAmounts, setSplitAmounts] = useState<{
    Cash: number;
    Card: number;
    'Mobile Transfer': number;
  }>({
    Cash: 0,
    Card: 0,
    'Mobile Transfer': 0,
  });
  const [activeReceiptSale, setActiveReceiptSale] = useState<any | null>(null);
  const [showHeldModal, setShowHeldModal] = useState(false);
  const [expandedHeldOrderId, setExpandedHeldOrderId] = useState<string | null>(null);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [activePreOrderToFulfill, setActivePreOrderToFulfill] = useState<WhatsAppPreOrder | null>(null);
  const [holdOrderName, setHoldOrderName] = useState('');
  const [qtyModalProduct, setQtyModalProduct] = useState<{ product: Product; currentQty: number } | null>(null);
  const [qtyInputVal, setQtyInputVal] = useState<string>('1');
  const [isBackdateMode, setIsBackdateMode] = useState(false);
  const [backdateDate, setBackdateDate] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 16);
  });
  const [hasDeliveryFee, setHasDeliveryFee] = useState<boolean>(false);
  const [deliveryFeeInput, setDeliveryFeeInput] = useState<string>('');
  const [noTax, setNoTax] = useState<boolean>(true);
  const [showMoreSettings, setShowMoreSettings] = useState<boolean>(false);
  const [isCreditSaleMode, setIsCreditSaleMode] = useState<boolean>(false);

  // Clearance Sale (Non-Inventory Item) State in More Settings
  const [isClearanceSaleOpen, setIsClearanceSaleOpen] = useState<boolean>(false);
  const [clearanceItemName, setClearanceItemName] = useState<string>('Clearance Sale Item');
  const [clearanceAmount, setClearanceAmount] = useState<string>('');
  const [clearanceQty, setClearanceQty] = useState<string>('1');
  const [clearanceCostPrice, setClearanceCostPrice] = useState<string>('0');
  const [clearanceDescription, setClearanceDescription] = useState<string>('');

  const handleAddClearanceItemToCart = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const price = parseFloat(clearanceAmount);
    if (isNaN(price) || price <= 0) {
      alert('Please enter a valid clearance sale amount greater than 0.');
      return;
    }
    const qty = parseInt(clearanceQty, 10) || 1;
    if (qty <= 0) {
      alert('Please enter a valid quantity of at least 1.');
      return;
    }
    const cost = parseFloat(clearanceCostPrice) || 0;
    const name = clearanceItemName.trim() || 'Clearance Sale Item';
    const uniqueClearanceId = `clearance-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const newClearanceItem: SaleItem = {
      productId: uniqueClearanceId,
      productName: name,
      sku: 'CLEARANCE',
      quantity: qty,
      unitPrice: price,
      costPrice: cost,
      total: qty * price,
      isWholesale: false,
      useRetailPrice: false,
      isClearance: true,
      clearanceDescription: clearanceDescription.trim(),
    };

    setCart((prev) => [...prev, newClearanceItem]);
    setClearanceAmount('');
    setClearanceDescription('');
    setClearanceCostPrice('0');
    setClearanceQty('1');
    setClearanceItemName('Clearance Sale Item');
    setIsClearanceSaleOpen(false);
  };

  const categories = ['All', ...Array.from(new Set(products.map((p) => p.category)))];

  const productSalesFrequency = useMemo(() => {
    const frequency = new Map<string, number>();
    sales.forEach((sale) => {
      if (sale.status === 'Cancelled') return;
      sale.items.forEach((item) => frequency.set(item.productId, (frequency.get(item.productId) || 0) + item.quantity));
    });
    return frequency;
  }, [sales]);

  const filteredProducts = products.filter((p) => {
    if (!p) return false;
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch =
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q);
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory && p.status !== 'Archived';
  }).sort((a, b) => (productSalesFrequency.get(b.id) || 0) - (productSalesFrequency.get(a.id) || 0));

  const toggleUseRetailPrice = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.productId !== productId) return item;
        const newUseRP = !item.useRetailPrice;
        const prod = product || products.find((p) => p.sku === item.sku);
        const retailPrice = prod ? prod.retailPrice : item.unitPrice;
        const wholesalePrice = prod ? prod.wholesalePrice : item.unitPrice;

        const unitPrice = newUseRP ? retailPrice : wholesalePrice;
        return {
          ...item,
          unitPrice,
          total: item.quantity * unitPrice,
          isWholesale: !newUseRP,
          useRetailPrice: newUseRP,
        };
      })
    );
  };

  const addToCart = (product: Product) => {
    if (!isBackdateMode && product.currentStock <= 0) {
      alert(`${product.name} is out of stock!`);
      return;
    }

    setCart((prevCart) => {
      const existing = prevCart.find((item) => item.productId === product.id);
      if (existing) {
        const newQty = existing.quantity + 1;
        if (!isBackdateMode && newQty > product.currentStock) {
          alert(`Cannot add more. Current stock limit is ${product.currentStock}.`);
          return prevCart;
        }
        // Auto wholesale check
        const meetsWholesale = newQty >= product.minWholesaleQty;
        const useRP = Boolean(existing.useRetailPrice && meetsWholesale);
        const isWholesale = meetsWholesale && !useRP;
        const unitPrice = useRP
          ? product.retailPrice
          : isWholesale
          ? product.wholesalePrice
          : product.retailPrice;

        return prevCart.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                quantity: newQty,
                unitPrice,
                total: newQty * unitPrice,
                isWholesale,
                useRetailPrice: useRP,
              }
            : item
        );
      } else {
        const meetsWholesale = 1 >= product.minWholesaleQty;
        const isWholesale = meetsWholesale;
        const unitPrice = isWholesale ? product.wholesalePrice : product.retailPrice;
        return [
          ...prevCart,
          {
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            quantity: 1,
            unitPrice,
            costPrice: product.costPrice,
            total: unitPrice,
            isWholesale,
            useRetailPrice: false,
          },
        ];
      }
    });
  };

  const toggleCatalogueProduct = (product: Product) => {
    if (cart.some((item) => item.productId === product.id)) {
      removeFromCart(product.id);
      return;
    }
    addToCart(product);
  };

  const updateCartItemUnitPrice = (productId: string, newUnitPrice: number) => {
    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.productId !== productId) return item;
        const unitPrice = Math.max(0, isNaN(newUnitPrice) ? 0 : newUnitPrice);
        return {
          ...item,
          unitPrice,
          total: item.quantity * unitPrice,
        };
      })
    );
  };

  const updateCartItemCostPrice = (productId: string, newCostPrice: number) => {
    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.productId !== productId) return item;
        const costPrice = Math.max(0, isNaN(newCostPrice) ? 0 : newCostPrice);
        return {
          ...item,
          costPrice,
        };
      })
    );
  };

  const updateCartQty = (productId: string, delta: number) => {
    const isClearanceItem = productId.startsWith('clearance-');
    const product = isClearanceItem ? null : products.find((p) => p.id === productId);
    if (!product && !isClearanceItem) return;

    setCart((prevCart) =>
      prevCart
        .map((item) => {
          if (item.productId !== productId) return item;
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          if (!isClearanceItem && product && !isBackdateMode && newQty > product.currentStock) {
            alert(`Stock limit reached (${product.currentStock} ${product.unit}).`);
            return item;
          }
          if (isClearanceItem) {
            return {
              ...item,
              quantity: newQty,
              total: newQty * item.unitPrice,
            };
          }
          const meetsWholesale = newQty >= (product?.minWholesaleQty || 9999);
          const useRP = Boolean(item.useRetailPrice && meetsWholesale);
          const isWholesale = meetsWholesale && !useRP;
          const unitPrice =
            isBackdateMode && currentUser?.role === 'Administrator'
              ? item.unitPrice
              : useRP
              ? (product?.retailPrice || 0)
              : isWholesale
              ? (product?.wholesalePrice || 0)
              : (product?.retailPrice || 0);
          const costPrice =
            isBackdateMode && currentUser?.role === 'Administrator'
              ? item.costPrice
              : (product?.costPrice || 0);

          return {
            ...item,
            quantity: newQty,
            unitPrice,
            costPrice,
            total: newQty * unitPrice,
            isWholesale,
            useRetailPrice: useRP,
          };
        })
        .filter(Boolean) as SaleItem[]
    );
  };

  const setCartQtyDirect = (productId: string, targetQty: number) => {
    const isClearanceItem = productId.startsWith('clearance-');
    const product = isClearanceItem ? null : products.find((p) => p.id === productId);
    if (!product && !isClearanceItem) return;

    if (targetQty <= 0) {
      removeFromCart(productId);
      return;
    }

    let finalQty = targetQty;
    if (!isClearanceItem && product && !isBackdateMode && finalQty > product.currentStock) {
      alert(`Stock limit reached. Maximum available stock is ${product.currentStock} ${product.unit}.`);
      finalQty = product.currentStock;
    }

    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.productId !== productId) return item;
        if (isClearanceItem) {
          return {
            ...item,
            quantity: finalQty,
            total: finalQty * item.unitPrice,
          };
        }
        const meetsWholesale = finalQty >= (product?.minWholesaleQty || 9999);
        const useRP = Boolean(item.useRetailPrice && meetsWholesale);
        const isWholesale = meetsWholesale && !useRP;
        const unitPrice =
          isBackdateMode && currentUser?.role === 'Administrator'
            ? item.unitPrice
            : useRP
            ? (product?.retailPrice || 0)
            : isWholesale
            ? (product?.wholesalePrice || 0)
            : (product?.retailPrice || 0);
        const costPrice =
          isBackdateMode && currentUser?.role === 'Administrator'
            ? item.costPrice
            : (product?.costPrice || 0);

        return {
          ...item,
          quantity: finalQty,
          unitPrice,
          costPrice,
          total: finalQty * unitPrice,
          isWholesale,
          useRetailPrice: useRP,
        };
      })
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  };

  const subtotal = cart.reduce((acc, item) => acc + item.total, 0);
  const tax = noTax ? 0 : Math.round(((subtotal - discountAmount) * (settings.taxRatePct / 100)) * 100) / 100;
  const deliveryFee = hasDeliveryFee ? (parseFloat(deliveryFeeInput) || 0) : 0;
  const grandTotal = Math.max(0, Math.round((subtotal - discountAmount + tax + deliveryFee) * 100) / 100);

  const totalSplitPaid: number = (Object.values(splitAmounts) as number[]).reduce((a: number, b: number) => a + b, 0);
  const remainingToSplit: number = Math.max(0, Math.round((grandTotal - totalSplitPaid) * 100) / 100);
  const splitChange: number = Math.max(0, Math.round((totalSplitPaid - grandTotal) * 100) / 100);

  const handleSelectPaymentMethod = (method: PaymentMethod) => {
    setPaymentMethod(method);
    if (method === 'Split') {
      if (totalSplitPaid === 0 && grandTotal > 0) {
        const half = Math.round((grandTotal / 2) * 100) / 100;
        setSplitAmounts({
          Cash: half,
          Card: Math.max(0, Math.round((grandTotal - half) * 100) / 100),
          'Mobile Transfer': 0,
        });
      }
      setShowSplitModal(true);
    }
  };

  const handleImportWhatsAppOrderToCart = (preOrder: WhatsAppPreOrder) => {
    const mappedItems: SaleItem[] = preOrder.items.map((item) => {
      const match = products.find(
        (p) =>
          (item.productId && p.id === item.productId) ||
          (item.sku && p.sku === item.sku) ||
          (item.productName && p.name && p.name.toLowerCase() === item.productName.toLowerCase())
      );

      const meetsWholesale = match ? item.quantity >= match.minWholesaleQty : Boolean(item.isWholesale);
      const useRP = Boolean(item.useRetailPrice);
      const unitPrice = useRP ? (match ? match.retailPrice : item.unitPrice) : item.unitPrice;

      return {
        productId: match ? match.id : 'prod-gen-' + Date.now(),
        productName: match ? match.name : item.productName,
        sku: match ? match.sku : item.sku || 'N/A',
        quantity: item.quantity,
        unitPrice,
        costPrice: match ? match.costPrice : item.unitPrice * 0.6,
        total: item.quantity * unitPrice,
        isWholesale: meetsWholesale && !useRP,
        useRetailPrice: useRP,
      };
    });

    setCart(mappedItems);
    setDiscountAmount(preOrder.discount || 0);
    setNoTax(true); // WhatsApp Pre-Orders are tax exempt
    if (preOrder.deliveryFee && preOrder.deliveryFee > 0) {
      setHasDeliveryFee(true);
      setDeliveryFeeInput(preOrder.deliveryFee.toString());
    } else {
      setHasDeliveryFee(false);
      setDeliveryFeeInput('0');
    }

    const matchCust = customers.find(
      (c) =>
        (preOrder.customerPhone && c.phone && c.phone.replace(/\D/g, '') === preOrder.customerPhone.replace(/\D/g, '')) ||
        (preOrder.customerName && c.name && c.name.toLowerCase() === preOrder.customerName.toLowerCase())
    );
    if (matchCust) {
      setSelectedCustomer(matchCust);
    }

    setActivePreOrderToFulfill(preOrder);
    setShowWhatsAppModal(false);
  };

  const handleCheckout = (customPaid?: number, customNotes?: string) => {
    if (cart.length === 0) return;

    let paid = customPaid !== undefined ? customPaid : (paidAmountInput !== '' ? parseFloat(paidAmountInput) : grandTotal);
    if (isNaN(paid)) paid = grandTotal;

    let notesToSave = customNotes;

    if (paymentMethod === 'Split' && !notesToSave) {
      const activeSplits = (Object.entries(splitAmounts) as [string, number][])
        .filter(([_, amt]) => amt > 0)
        .map(([method, amt]) => `${method}: ${settings.currencySymbol}${amt.toFixed(2)}`);
      notesToSave = `Split Payment: ${activeSplits.length > 0 ? activeSplits.join(', ') : 'Custom Split'}`;
      paid = totalSplitPaid;
    }

    const isWholesaleOrder = cart.some((i) => i.isWholesale);

    let customCreatedAt: string | undefined = undefined;
    if (isBackdateMode && currentUser?.role === 'Administrator' && backdateDate) {
      customCreatedAt = new Date(backdateDate).toISOString();
      const formattedDT = new Date(backdateDate).toLocaleString();
      notesToSave = notesToSave
        ? `${notesToSave} | Historical Sale Entry for ${formattedDT}`
        : `Historical Past Sale Entry (Admin) - ${formattedDT}`;
    }

    let completedSale;
    if (activePreOrderToFulfill) {
      try {
        completedSale = convertPreOrderToSale(
          activePreOrderToFulfill.id,
          paymentMethod,
          currentUser?.displayName || 'Sales Clerk',
          notesToSave || 'Fulfill via POS Checkout'
        );
      } catch (err) {
        return;
      }
    } else {
      completedSale = processSale(
        cart,
        selectedCustomer,
        discountAmount,
        tax,
        paymentMethod,
        paid,
        isWholesaleOrder ? 'Wholesale' : 'Retail',
        currentUser?.displayName || 'Sales Clerk',
        notesToSave,
        customCreatedAt,
        deliveryFee
      );
    }

    if (!completedSale?.isHistorical && !isBackdateMode) {
      setActiveReceiptSale(completedSale);
    }
    setCart([]);
    setSelectedCustomer(null);
    setIsCreditSaleMode(false);
    setDiscountAmount(0);
    setNoTax(true);
    setHasDeliveryFee(false);
    setDeliveryFeeInput('');
    setPaidAmountInput('');
    setSplitAmounts({
      Cash: 0,
      Card: 0,
      'Mobile Transfer': 0,
    });
    setShowSplitModal(false);
    setActivePreOrderToFulfill(null);
  };

  const handleHoldCurrentCart = () => {
    if (cart.length === 0) return;
    const name = prompt('Enter a label to identify this held order:', `Hold #${heldOrders.length + 1}`) || `Hold #${heldOrders.length + 1}`;
    holdOrder(name, cart, selectedCustomer?.id);
    setCart([]);
    setSelectedCustomer(null);
  };

  const handleResumeOrder = (held: any) => {
    setCart(held.items);
    if (held.customerId) {
      const cust = customers.find((c) => c.id === held.customerId);
      if (cust) setSelectedCustomer(cust);
    }
    restoreHeldOrder(held.id);
    setShowHeldModal(false);
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Point of Sale (POS Register)
          </h1>
          <p className="text-xs text-slate-500">
            Fast checkout, wholesale tier auto-switching, order holds, and receipt printing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {whatsAppPreOrders.filter((o) => o.status !== 'Completed' && o.status !== 'Cancelled').length > 0 && (
            <button
              onClick={() => setShowWhatsAppModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              <span>WhatsApp Orders ({whatsAppPreOrders.filter((o) => o.status !== 'Completed' && o.status !== 'Cancelled').length})</span>
            </button>
          )}

          {heldOrders.length > 0 && (
            <button
              onClick={() => setShowHeldModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
            >
              <Pause className="w-4 h-4" />
              <span>Held Orders ({heldOrders.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Historical Backdate Mode Banner */}
      {isBackdateMode && (
        <div className="p-3.5 bg-indigo-600 text-white rounded-2xl flex items-center justify-between gap-3 shadow-md animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 text-xs font-bold">
            <History className="w-5 h-5 shrink-0 text-indigo-200" />
            <div>
              <p className="font-extrabold text-sm">Historical Past Sale Mode Active (Admin)</p>
              <p className="text-indigo-100 text-[11px] font-medium">
                Recording historical sale record for {new Date(backdateDate).toLocaleString()}. Note: Historical sales do NOT create invoices and will NOT affect live inventory stock levels.
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsBackdateMode(false)}
            className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-xl text-xs font-extrabold whitespace-nowrap transition-colors"
          >
            Disable Past Sale Mode
          </button>
        </div>
      )}

      {/* Main Terminal Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Product Grid & Search (7 Cols) */}
        <div className="order-2 lg:order-1 lg:col-span-7 space-y-4">
          {/* Search & Category Tabs */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Scan barcode or search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim()) {
                    const q = searchQuery.trim().toLowerCase();
                    const match = products.find(
                      (p) => p.status !== 'Archived' && (((p.barcode || '').toLowerCase() === q) || ((p.sku || '').toLowerCase() === q))
                    ) || (filteredProducts.length === 1 ? filteredProducts[0] : undefined);

                    if (match) {
                      addToCart(match);
                      setSearchQuery('');
                    }
                  }
                }}
                className="w-full pl-10 pr-10 py-2.5 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 text-slate-900 dark:text-slate-100 text-xs rounded-xl focus:outline-none"
              />
              <Barcode className="w-5 h-5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                    selectedCategory === cat
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[580px] overflow-y-auto pr-1">
            {filteredProducts.map((p) => {
              const inStock = p.currentStock > 0;
              const canSelect = inStock || isBackdateMode;
              const isInRegister = cart.some((item) => item.productId === p.id);
              return (
                <div
                  key={p.id}
                  onClick={() => (canSelect || isInRegister) && toggleCatalogueProduct(p)}
                  className={`relative bg-white dark:bg-slate-900 border rounded-2xl p-3 flex flex-col justify-between transition-all cursor-pointer group ${
                    isInRegister
                      ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 ring-2 ring-emerald-500/30 shadow-md'
                      : canSelect
                      ? 'border-slate-200/80 dark:border-slate-800 hover:border-blue-500 hover:shadow-md'
                      : 'border-slate-100 dark:border-slate-800 opacity-50 cursor-not-allowed'
                  }`}
                >
                  {isInRegister && (
                    <span className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-1 text-[9px] font-black text-white shadow-sm">
                      <Check className="h-3 w-3" /> In Register
                    </span>
                  )}
                  <div className="space-y-2">
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800">
                      <img
                        src={p.images?.[0] || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&auto=format&fit=crop&q=60'}
                        alt={p.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      {!inStock && isBackdateMode && (
                        <span className="absolute top-1 left-1 bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                          Past Entry
                        </span>
                      )}
                      {!inStock && !isBackdateMode && (
                        <span className="absolute top-1 left-1 bg-rose-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md shadow-xs">
                          Out of Stock
                        </span>
                      )}
                      {p.currentStock <= p.minimumStockLevel && inStock && (
                        <span className="absolute top-1 left-1 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                          Low Stock
                        </span>
                      )}
                      {canSelect && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const existingInCart = cart.find((i) => i.productId === p.id);
                            const currentQty = existingInCart ? existingInCart.quantity : 1;
                            setQtyModalProduct({ product: p, currentQty });
                            setQtyInputVal(currentQty.toString());
                          }}
                          className="absolute top-1 right-1 bg-slate-900/80 hover:bg-slate-900 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-lg backdrop-blur-xs shadow-xs transition-transform hover:scale-105 flex items-center gap-1"
                          title="Set Quantity"
                        >
                          <Edit3 className="w-3 h-3 text-blue-400" />
                          <span>Qty</span>
                        </button>
                      )}
                    </div>
                    <p className="font-bold text-xs text-slate-900 dark:text-white line-clamp-2">
                      {p.name}
                    </p>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                    <div>
                      <p className="font-extrabold text-sm text-blue-600 dark:text-blue-400">
                        {settings.currencySymbol}{(Number(p.retailPrice) || 0).toFixed(2)}
                      </p>
                      <p className="text-[10px] text-slate-400 font-medium">
                        Wholesale: {settings.currencySymbol}{(Number(p.wholesalePrice) || 0).toFixed(2)} (Min {p.minWholesaleQty || 1})
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md">
                      {p.currentStock || 0} {p.unit || 'pcs'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Checkout Cart Terminal (5 Cols) */}
        <div className="order-1 lg:order-2 lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-5 shadow-lg space-y-4 flex flex-col h-full min-h-[580px]">
          {/* Customer Selection */}
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <User className="w-4 h-4 text-blue-600" />
              <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search name or phone" className="w-full bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 text-slate-900 dark:text-white text-xs font-semibold rounded-xl pl-8 pr-2.5 py-1.5" />
                </div>
                <select
                  value={selectedCustomer?.id || ''}
                  onChange={(e) => {
                    const cust = customers.find((c) => c.id === e.target.value);
                    setSelectedCustomer(cust || null);
                    if (!cust) setIsCreditSaleMode(false);
                  }}
                  className="min-w-0 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 text-slate-900 dark:text-white text-xs font-bold rounded-xl px-2.5 py-1.5"
                >
                  <option value="">Walk-in Customer</option>
                  {customers.filter((c) => {
                    if (!c) return false;
                    const query = (customerSearch || '').trim().toLowerCase();
                    if (!query || c.id === selectedCustomer?.id) return true;
                    const digits = query.replace(/\D/g, '');
                    return (
                      (c.name || '').toLowerCase().includes(query) ||
                      (c.phone && c.phone.toLowerCase().includes(query)) ||
                      Boolean(digits && c.phone && c.phone.replace(/\D/g, '').includes(digits))
                    );
                  }).map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                  ))}
                </select>
              </div>
            </div>

            {cart.length > 0 && (
              <button
                onClick={handleHoldCurrentCart}
                className="flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Hold</span>
              </button>
            )}
          </div>

          {/* Cart Header with Credit Pricing Indicator */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <span>Current Register</span>
                <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs px-2 py-0.5 rounded-full">
                  {cart.length} items
                </span>
              </h3>
              {isCreditSaleMode && (
                <span className="flex items-center gap-1 bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-blue-300 dark:border-blue-800 animate-pulse">
                  <CreditCard className="w-3 h-3" />
                  <span>Credit Pricing Mode</span>
                </span>
              )}
            </div>

            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs font-bold text-rose-600 hover:text-rose-700"
              >
                Clear
              </button>
            )}
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto max-h-[260px] divide-y divide-slate-100 dark:divide-slate-800 pr-1">
            {cart.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs space-y-2">
                <ShoppingCart className="w-8 h-8 mx-auto opacity-30" />
                <p>Register is empty. Tap products on the left to add.</p>
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.productId} className="py-2.5 border-b border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-bold text-xs text-slate-900 dark:text-white line-clamp-1">
                          {item.productName}
                        </p>
                        {item.isClearance && (
                          <span className="bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[9px] font-extrabold px-1.5 py-0.2 rounded border border-amber-300 dark:border-amber-800">
                            Clearance
                          </span>
                        )}
                      </div>

                      {item.isClearance && item.clearanceDescription && (
                        <p className="text-[10px] text-slate-500 italic mt-0.5 line-clamp-1">
                          Note: {item.clearanceDescription}
                        </p>
                      )}

                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] font-semibold text-slate-500">
                          {settings.currencySymbol}{item.unitPrice.toFixed(2)}
                        </span>
                        {isBackdateMode && (
                          <span className="text-[10px] text-slate-400 font-medium">
                            (Cost: {settings.currencySymbol}{item.costPrice.toFixed(2)})
                          </span>
                        )}
                        {!item.isClearance && (() => {
                          const prod = products.find((p) => p.id === item.productId || p.sku === item.sku);
                          const meetsWholesale = prod ? item.quantity >= prod.minWholesaleQty : (item.isWholesale || false);

                          if (!meetsWholesale && !item.isWholesale && !item.useRetailPrice) return null;

                          return (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {item.useRetailPrice ? (
                                <span className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[9px] font-bold px-1.5 py-0.5 rounded">
                                  RP Override Active
                                </span>
                              ) : (
                                <span className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 text-[9px] font-bold px-1.5 py-0.5 rounded">
                                  Wholesale Price Triggered
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleUseRetailPrice(item.productId)}
                                className={`text-[9px] font-black px-1.5 py-0.5 rounded transition-all cursor-pointer border ${
                                  item.useRetailPrice
                                    ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-xs'
                                    : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600'
                                }`}
                                title={item.useRetailPrice ? "Click to switch back to Wholesale Price" : "Override wholesale price and use Retail Price instead"}
                              >
                                {item.useRetailPrice ? 'Use RP (Active)' : 'Use RP'}
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 border border-slate-200/50 dark:border-slate-700/50">
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.productId, -1)}
                          className="p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
                          title="Decrease by 1"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) {
                              setCartQtyDirect(item.productId, val);
                            }
                          }}
                          className="w-11 text-center font-black text-xs bg-transparent focus:bg-white dark:focus:bg-slate-900 border border-transparent focus:border-blue-500 rounded text-slate-900 dark:text-white px-0 py-0.5"
                          title="Directly enter large quantity"
                        />
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.productId, 1)}
                          className="p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
                          title="Increase by 1"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const product = products.find((p) => p.id === item.productId);
                          if (product) {
                            setQtyModalProduct({ product, currentQty: item.quantity });
                            setQtyInputVal(item.quantity.toString());
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Set Bulk / Large Custom Quantity"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <span className="font-bold text-xs text-slate-900 dark:text-white w-14 text-right">
                        {settings.currencySymbol}{item.total.toFixed(2)}
                      </span>

                      <button
                        onClick={() => removeFromCart(item.productId)}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Credit Sales Mode Custom Unit Price Controls (Admin / Manager) */}
                  {isCreditSaleMode && (currentUser?.role === 'Administrator' || currentUser?.role === 'Manager') && (
                    <div className="p-2.5 bg-blue-50/90 dark:bg-blue-950/50 border border-blue-200/90 dark:border-blue-800/80 rounded-2xl space-y-1.5 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-[10px] font-bold text-blue-950 dark:text-blue-200">
                        <span className="flex items-center gap-1 font-extrabold">
                          <CreditCard className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                          <span>Credit Sale Price ({item.productName})</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          {!item.isClearance && (() => {
                            const prod = products.find((p) => p.id === item.productId || p.sku === item.sku);
                            if (!prod) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  const defaultPrice = item.isWholesale ? prod.wholesalePrice : prod.retailPrice;
                                  updateCartItemUnitPrice(item.productId, defaultPrice);
                                }}
                                className="text-[9px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                              >
                                Reset to Catalog ({settings.currencySymbol}{item.isWholesale ? prod.wholesalePrice : prod.retailPrice})
                              </button>
                            );
                          })()}
                          <span className="bg-blue-200/80 dark:bg-blue-900/80 text-blue-950 dark:text-blue-200 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">
                            Credit Custom Rate
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                            Agreed Credit Unit Price ({settings.currencySymbol}):
                          </label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs">
                              {settings.currencySymbol}
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                updateCartItemUnitPrice(item.productId, isNaN(val) ? 0 : val);
                              }}
                              className="w-full pl-6 pr-2 py-1 bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 rounded-xl text-slate-900 dark:text-white font-black text-xs shadow-xs focus:ring-2 focus:ring-blue-500"
                              placeholder="0.00"
                            />
                          </div>
                        </div>

                        {!item.isClearance && (
                          <div className="text-[10px] text-slate-500 self-end pb-1.5 font-medium">
                            {(() => {
                              const prod = products.find((p) => p.id === item.productId || p.sku === item.sku);
                              if (!prod) return null;
                              const diff = item.unitPrice - (item.isWholesale ? prod.wholesalePrice : prod.retailPrice);
                              if (diff > 0) {
                                return (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                    +{settings.currencySymbol}{diff.toFixed(2)} Credit Markup
                                  </span>
                                );
                              } else if (diff < 0) {
                                return (
                                  <span className="text-amber-600 dark:text-amber-400 font-bold">
                                    {settings.currencySymbol}{diff.toFixed(2)} Below Catalog
                                  </span>
                                );
                              }
                              return <span>Standard Rate</span>;
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Admin Past Sale Mode Custom Price & Cost Controls */}
                  {isBackdateMode && currentUser?.role === 'Administrator' && (
                    <div className="p-2.5 bg-indigo-50/90 dark:bg-indigo-950/50 border border-indigo-200/90 dark:border-indigo-800/80 rounded-2xl space-y-1.5 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-[10px] font-bold text-indigo-950 dark:text-indigo-200">
                        <span className="flex items-center gap-1 font-extrabold">
                          <Edit3 className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                          Old Sale Prices (Admin Past Sale Mode)
                        </span>
                        <span className="bg-indigo-200/80 dark:bg-indigo-900/80 text-indigo-950 dark:text-indigo-200 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">
                          Historical Price Override
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                            Retail Price ({settings.currencySymbol}):
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              updateCartItemUnitPrice(item.productId, isNaN(val) ? 0 : val);
                            }}
                            className="w-full px-2 py-1 bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-700 rounded-xl text-slate-900 dark:text-white font-black text-xs shadow-xs focus:ring-2 focus:ring-indigo-500"
                            placeholder="Unit Retail Price"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                            Cost Price ({settings.currencySymbol}):
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.costPrice}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              updateCartItemCostPrice(item.productId, isNaN(val) ? 0 : val);
                            }}
                            className="w-full px-2 py-1 bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-700 rounded-xl text-slate-900 dark:text-white font-black text-xs shadow-xs focus:ring-2 focus:ring-indigo-500"
                            placeholder="Unit Cost Price"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Payment Method Selector & Discount */}
          <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="pos-payment-method-select" className="block font-bold text-xs text-slate-700 dark:text-slate-300">
                  Payment Method
                </label>
                {paymentMethod === 'Split' && (
                  <button
                    type="button"
                    onClick={() => setShowSplitModal(true)}
                    className="text-[11px] font-extrabold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Configure Split
                  </button>
                )}
              </div>
              <select
                id="pos-payment-method-select"
                value={paymentMethod}
                onChange={(e) => handleSelectPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-xs"
              >
                <option value="Card">Card</option>
                <option value="Cash">Cash</option>
                <option value="Mobile Transfer">Mobile Transfer</option>
                <option value="Split">Split Payment</option>
              </select>
            </div>

            {/* Split Banner (if Split payment method is selected) */}
            {paymentMethod === 'Split' && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 rounded-2xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-900 dark:text-blue-100">Split Allocated:</span>
                  <span className="font-black text-blue-700 dark:text-blue-300 text-sm">
                    {settings.currencySymbol}{totalSplitPaid.toFixed(2)}
                  </span>
                </div>
                {totalSplitPaid < grandTotal ? (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                    ⚠️ Short by {settings.currencySymbol}{(grandTotal - totalSplitPaid).toFixed(2)}
                  </p>
                ) : (
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                    ✓ Total split payment covers order
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setShowSplitModal(true)}
                  className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] rounded-xl shadow-xs transition-colors mt-1"
                >
                  Adjust Split Amounts
                </button>
              </div>
            )}

            {/* More Settings Collapsible (Discount, No Tax, Amount Tendered) */}
            <div className="border border-slate-200 dark:border-slate-700/80 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
              <button
                type="button"
                onClick={() => setShowMoreSettings(!showMoreSettings)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                  <span>More Settings</span>
                  
                  {/* Active badges when collapsed */}
                  {discountAmount > 0 && (
                    <span className="text-[10px] font-extrabold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 px-2 py-0.5 rounded-full">
                      Disc: -{settings.currencySymbol}{discountAmount}
                    </span>
                  )}
                  {!noTax && (
                    <span className="text-[10px] font-extrabold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 px-2 py-0.5 rounded-full">
                      Tax ({settings.taxRatePct}%)
                    </span>
                  )}
                  {isBackdateMode && (
                    <span className="text-[10px] font-extrabold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 px-2 py-0.5 rounded-full">Historical</span>
                  )}
                  {hasDeliveryFee && (
                    <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded-full">Delivery</span>
                  )}
                  {paymentMethod !== 'Split' && paidAmountInput !== '' && !isNaN(parseFloat(paidAmountInput)) && (
                    <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                      Paid: {settings.currencySymbol}{parseFloat(paidAmountInput).toFixed(2)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 text-slate-400">
                  <span className="text-[10px] font-semibold">
                    {showMoreSettings ? 'Hide' : 'Show'}
                  </span>
                  {showMoreSettings ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </div>
              </button>

              {showMoreSettings && (
                <div className="p-3 space-y-3 border-t border-slate-200 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/30 animate-in fade-in duration-200">
                  {currentUser?.role === 'Administrator' && (
                    <div className="p-3 bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-900/60 rounded-2xl space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-extrabold text-indigo-950 dark:text-indigo-200">
                          <History className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          <span>Historical / Previous Sale (Admin)</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={isBackdateMode} onChange={(e) => setIsBackdateMode(e.target.checked)} className="sr-only peer" />
                          <div className="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all dark:after:border-slate-600 peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>
                      {isBackdateMode && (
                        <div className="space-y-1.5 pt-2 border-t border-indigo-200/60 dark:border-indigo-900/60">
                          <label className="block text-[10px] font-bold text-indigo-900 dark:text-indigo-300">Past Transaction Date & Time:</label>
                          <input type="datetime-local" value={backdateDate} onChange={(e) => setBackdateDate(e.target.value)} className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-800 rounded-xl text-slate-900 dark:text-white font-bold text-xs" />
                          <p className="text-[10px] text-indigo-700 dark:text-indigo-400 font-medium">Historical sales do not create invoices or alter live inventory.</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="p-3 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={hasDeliveryFee}
                          onChange={(e) => { setHasDeliveryFee(e.target.checked); if (!e.target.checked) setDeliveryFeeInput(''); }}
                          className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                        />
                        <Truck className="w-4 h-4 text-emerald-600" />
                        <span>Collect Delivery Fee</span>
                      </label>
                      {hasDeliveryFee && <span className="text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300">Active</span>}
                    </div>
                    {hasDeliveryFee && (
                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-emerald-200/60 dark:border-emerald-900/60">
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-400">Fee ({settings.currencySymbol}):</span>
                        <input type="number" min="0" step="0.5" placeholder="0.00" value={deliveryFeeInput} onChange={(e) => setDeliveryFeeInput(e.target.value)} className="w-28 text-right px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-black text-xs" />
                      </div>
                    )}
                  </div>

                  {/* 1. Discount */}
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700 dark:text-slate-300">Discount ({settings.currencySymbol}):</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                      className="w-24 text-right p-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs"
                    />
                  </div>

                  {/* 2. No Tax Option */}
                  <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-xl flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={noTax}
                        onChange={(e) => setNoTax(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                      />
                      <Tag className="w-4 h-4 text-indigo-500" />
                      <span>No Tax</span>
                    </label>
                    {noTax ? (
                      <span className="text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 rounded-full">
                        Exempt (0%)
                      </span>
                    ) : (
                      <span className="text-[10px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950 px-2.5 py-0.5 rounded-full">
                        Standard ({settings.taxRatePct}%)
                      </span>
                    )}
                  </div>

                  {/* 3. Credit Sales Custom Pricing Toggle */}
                  <div className="p-3 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900/60 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs font-extrabold text-blue-950 dark:text-blue-200 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isCreditSaleMode}
                          disabled={currentUser?.role !== 'Administrator' && currentUser?.role !== 'Manager'}
                          onChange={(e) => {
                            if (e.target.checked) {
                              if (currentUser?.role !== 'Administrator' && currentUser?.role !== 'Manager') {
                                alert('Credit Sales custom pricing is restricted to Administrators and Managers only.');
                                return;
                              }
                              if (!selectedCustomer) {
                                alert('Please select a Customer first before enabling Credit Sales mode.');
                                return;
                              }
                              setIsCreditSaleMode(true);
                            } else {
                              setIsCreditSaleMode(false);
                            }
                          }}
                          className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span>Credit Sales</span>
                      </label>
                      {currentUser?.role !== 'Administrator' && currentUser?.role !== 'Manager' ? (
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                          Admin/Manager Only
                        </span>
                      ) : isCreditSaleMode ? (
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
                          Active
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold text-slate-400">
                          Off
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Enable custom unit pricing per cart item for credit transactions with customers.
                    </p>
                    {isCreditSaleMode && (
                      <div className="pt-1 text-[11px] font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>Unit price editing unlocked for {selectedCustomer?.name || 'selected customer'}.</span>
                      </div>
                    )}
                  </div>

                  {/* 4. Clearance Sale / Custom Non-Inventory Item */}
                  <div className="p-3 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs font-extrabold text-amber-900 dark:text-amber-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isClearanceSaleOpen}
                          onChange={(e) => setIsClearanceSaleOpen(e.target.checked)}
                          className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                        />
                        <Tag className="w-4 h-4 text-amber-500" />
                        <span>Clearance / Custom Sale Item</span>
                      </label>
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                        Non-Inventory
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Sell uncataloged goods or clearance items with custom prices without affecting inventory stock.
                    </p>

                    {isClearanceSaleOpen && (
                      <div className="space-y-2.5 pt-2 border-t border-dashed border-amber-200 dark:border-amber-900/50 animate-in fade-in duration-200">
                        {/* Item Name / Label */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                            Item Label / Title:
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Clearance Sale Item, Dented Kettle..."
                            value={clearanceItemName}
                            onChange={(e) => setClearanceItemName(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:ring-2 focus:ring-amber-500"
                          />
                        </div>

                        {/* Amount & Quantity Grid */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                              Clearance Amount ({settings.currencySymbol}) *:
                            </label>
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs">
                                {settings.currencySymbol}
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                placeholder="0.00"
                                value={clearanceAmount}
                                onChange={(e) => setClearanceAmount(e.target.value)}
                                className="w-full pl-6 pr-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-black text-xs focus:ring-2 focus:ring-amber-500"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                              Quantity:
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={clearanceQty}
                              onChange={(e) => setClearanceQty(e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-xs focus:ring-2 focus:ring-amber-500"
                            />
                          </div>
                        </div>

                        {/* Description Box */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                            Description / Condition Notes:
                          </label>
                          <textarea
                            rows={2}
                            placeholder="Write details about the item (e.g. Scratched casing, no box, sold as-is)..."
                            value={clearanceDescription}
                            onChange={(e) => setClearanceDescription(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-xs resize-none focus:ring-2 focus:ring-amber-500"
                          />
                        </div>

                        {/* Add to Cart Button */}
                        <button
                          type="button"
                          onClick={handleAddClearanceItemToCart}
                          className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Clearance Item to Cart</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 4. Amount Tendered / Paid */}
                  {paymentMethod !== 'Split' && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-200/80 dark:border-slate-700/80">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-700 dark:text-slate-300 text-xs">
                          Amount Tendered / Paid ({settings.currencySymbol}):
                        </span>
                        {paidAmountInput && !isNaN(parseFloat(paidAmountInput)) && (
                          <button
                            type="button"
                            onClick={() => setPaidAmountInput('')}
                            className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs">
                          {settings.currencySymbol}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={grandTotal.toFixed(2)}
                          value={paidAmountInput}
                          onChange={(e) => setPaidAmountInput(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-black text-xs"
                        />
                      </div>

                      {/* Quick tender chips */}
                      <div className="flex items-center gap-1 flex-wrap pt-0.5">
                        <button
                          type="button"
                          onClick={() => setPaidAmountInput(grandTotal.toFixed(2))}
                          className="px-2 py-0.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold text-slate-600 dark:text-slate-400"
                        >
                          Exact ({settings.currencySymbol}{grandTotal.toFixed(2)})
                        </button>
                        {[20, 50, 100].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setPaidAmountInput(amt.toFixed(2))}
                            className="px-2 py-0.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold text-slate-600 dark:text-slate-400"
                          >
                            {settings.currencySymbol}{amt}
                          </button>
                        ))}
                      </div>

                      {/* Live Change / Debt calculation */}
                      {paidAmountInput !== '' && !isNaN(parseFloat(paidAmountInput)) && (
                        <div className="text-[11px] pt-1">
                          {parseFloat(paidAmountInput) > grandTotal ? (
                            <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                              Change Due: {settings.currencySymbol}{(parseFloat(paidAmountInput) - grandTotal).toFixed(2)}
                            </span>
                          ) : parseFloat(paidAmountInput) < grandTotal ? (
                            <span className="font-extrabold text-amber-600 dark:text-amber-400">
                              Remaining Debt: {settings.currencySymbol}{(grandTotal - parseFloat(paidAmountInput)).toFixed(2)}
                              {selectedCustomer ? ` (Charged to ${selectedCustomer.name})` : ' (Walk-in Customer)'}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Calculations Breakdown */}
            <div className="space-y-1 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal:</span>
                <span>{settings.currencySymbol}{subtotal.toFixed(2)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-rose-600 font-semibold">
                  <span>Discount:</span>
                  <span>-{settings.currencySymbol}{discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-500">
                <span>Tax ({noTax ? '0% - No Tax' : `${settings.taxRatePct}%`}):</span>
                <span>{settings.currencySymbol}{tax.toFixed(2)}</span>
              </div>
              {hasDeliveryFee && deliveryFee > 0 && (
                <div className="flex justify-between text-blue-600 dark:text-blue-400 font-bold">
                  <span>Delivery Fee:</span>
                  <span>+{settings.currencySymbol}{deliveryFee.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-extrabold text-base text-slate-900 dark:text-white border-t border-slate-200 dark:border-slate-700 pt-1">
                <span>Grand Total:</span>
                <span className="text-emerald-600 dark:text-emerald-400">{settings.currencySymbol}{grandTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Checkout CTA */}
            <button
              onClick={() => handleCheckout()}
              disabled={cart.length === 0}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-black text-sm rounded-2xl shadow-md transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-5 h-5" />
              <span>
                Complete Sale ({settings.currencySymbol}{
                  paymentMethod === 'Split' ? totalSplitPaid.toFixed(2) : grandTotal.toFixed(2)
                })
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Held Orders Modal */}
      {showHeldModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full p-6 space-y-4 my-auto max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Pause className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Held Orders Queue ({heldOrders.length})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {heldOrders.length > 0 && (
                  <button
                    onClick={() => {
                      if (window.confirm('Are you sure you want to clear all held orders?')) {
                        clearAllHeldOrders();
                      }
                    }}
                    className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 px-2 py-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All</span>
                  </button>
                )}
                <button
                  onClick={() => setShowHeldModal(false)}
                  className="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="space-y-3 overflow-y-auto pr-1 flex-1 max-h-[60vh]">
              {heldOrders.length === 0 ? (
                <div className="py-12 text-center text-slate-400 dark:text-slate-500 space-y-2">
                  <Pause className="w-10 h-10 mx-auto opacity-40 text-amber-500" />
                  <p className="text-xs font-semibold">No held orders in queue</p>
                  <p className="text-[10px]">When you put active cart orders on hold, they will appear here.</p>
                </div>
              ) : (
                heldOrders.map((h) => {
                  const isExpanded = expandedHeldOrderId === h.id;
                  const orderTotal = h.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
                  const cust = h.customerId ? customers.find((c) => c.id === h.customerId) : null;

                  return (
                    <div
                      key={h.id}
                      className="border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 rounded-2xl p-3.5 space-y-3 transition-all"
                    >
                      {/* Order Header Summary */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-slate-900 dark:text-white">{h.name}</span>
                            <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 text-[10px] font-bold rounded-md">
                              {h.items.length} {h.items.length === 1 ? 'item' : 'items'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                            <span>{new Date(h.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {cust && (
                              <>
                                <span>•</span>
                                <span className="font-medium text-blue-600 dark:text-blue-400">{cust.name}</span>
                              </>
                            )}
                            <span>•</span>
                            <span className="font-black text-slate-900 dark:text-slate-200">
                              {settings.currencySymbol}{orderTotal.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleResumeOrder(h)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Resume</span>
                          </button>

                          <button
                            onClick={() => setExpandedHeldOrderId(isExpanded ? null : h.id)}
                            className="p-1.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                            title={isExpanded ? 'Hide items' : 'View items'}
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>

                          <button
                            onClick={() => {
                              if (window.confirm(`Delete held order "${h.name}"?`)) {
                                deleteHeldOrder(h.id);
                              }
                            }}
                            className="p-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors"
                            title="Delete held order"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Items List Breakdown when expanded */}
                      {isExpanded && (
                        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80 space-y-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
                            Held Order Items:
                          </p>
                          {h.items.map((item) => (
                            <div
                              key={item.productId}
                              className="flex items-center justify-between p-2 bg-white dark:bg-slate-900/80 rounded-xl border border-slate-100 dark:border-slate-800 text-xs"
                            >
                              <div className="min-w-0 flex-1 pr-2">
                                <p className="font-bold text-slate-900 dark:text-white truncate">{item.productName}</p>
                                <p className="text-[10px] text-slate-400 font-mono">
                                  {item.quantity} × {settings.currencySymbol}{item.unitPrice.toFixed(2)} = {settings.currencySymbol}{(item.quantity * item.unitPrice).toFixed(2)}
                                </p>
                              </div>
                              <button
                                onClick={() => deleteHeldOrderItem(h.id, item.productId)}
                                className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors shrink-0"
                                title="Remove this item from held order"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Pre-Orders Import Modal for POS */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Active WhatsApp Pre-Orders
                </h3>
              </div>
              <button
                onClick={() => setShowWhatsAppModal(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {whatsAppPreOrders.filter((o) => o.status !== 'Completed' && o.status !== 'Cancelled').length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No active WhatsApp pre-orders ready for checkout.
                </div>
              ) : (
                whatsAppPreOrders
                  .filter((o) => o.status !== 'Completed' && o.status !== 'Cancelled')
                  .map((order) => (
                    <div
                      key={order.id}
                      className="p-3.5 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200/80 dark:border-slate-700 flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                            {order.preOrderNo}
                          </span>
                          <span className="ml-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {order.customerName} ({order.customerPhone})
                          </span>
                        </div>
                        <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono">
                          {settings.currencySymbol}{order.totalAmount.toFixed(2)}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-500">
                        {order.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] font-bold text-slate-400">
                          Status: {order.status}
                        </span>
                        <button
                          onClick={() => handleImportWhatsAppOrderToCart(order)}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all"
                        >
                          Load into POS Cart
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Split Payment Calculator Modal */}
      {showSplitModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 rounded-2xl">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Split Payment Calculator</h3>
                  <p className="text-[11px] text-slate-500 font-medium">Allocate grand total across multiple payment methods</p>
                </div>
              </div>
              <button
                onClick={() => setShowSplitModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Split Progress Overview */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-semibold">Grand Total Required:</span>
                <span className="font-black text-slate-900 dark:text-white text-sm">
                  {settings.currencySymbol}{grandTotal.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-semibold">Total Split Allocated:</span>
                <span className={`font-black text-sm ${
                  totalSplitPaid >= grandTotal ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'
                }`}>
                  {settings.currencySymbol}{totalSplitPaid.toFixed(2)}
                </span>
              </div>

              {remainingToSplit > 0 ? (
                <div className="flex justify-between items-center pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 text-amber-600 dark:text-amber-400 font-bold">
                  <span>Remaining Unallocated:</span>
                  <span>{settings.currencySymbol}{remainingToSplit.toFixed(2)}</span>
                </div>
              ) : splitChange > 0 ? (
                <div className="flex justify-between items-center pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 text-emerald-600 dark:text-emerald-400 font-bold">
                  <span>Change Due to Customer:</span>
                  <span>{settings.currencySymbol}{splitChange.toFixed(2)}</span>
                </div>
              ) : (
                <div className="flex justify-between items-center pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 text-emerald-600 dark:text-emerald-400 font-bold">
                  <span>Split Balanced Exactly!</span>
                  <CheckCircle className="w-4 h-4" />
                </div>
              )}
            </div>

            {/* Quick Action Presets */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => {
                  const half = Math.round((grandTotal / 2) * 100) / 100;
                  setSplitAmounts({
                    Cash: half,
                    Card: Math.max(0, Math.round((grandTotal - half) * 100) / 100),
                    'Mobile Transfer': 0,
                    'Bank Transfer': 0,
                    'Store Credit': 0,
                  });
                }}
                className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap"
              >
                50/50 Cash & Card
              </button>

              <button
                type="button"
                onClick={() => {
                  setSplitAmounts({
                    Cash: grandTotal,
                    Card: 0,
                    'Mobile Transfer': 0,
                    'Bank Transfer': 0,
                    'Store Credit': 0,
                  });
                }}
                className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap"
              >
                100% Cash
              </button>

              <button
                type="button"
                onClick={() => {
                  setSplitAmounts({
                    Cash: 0,
                    Card: grandTotal,
                    'Mobile Transfer': 0,
                    'Bank Transfer': 0,
                    'Store Credit': 0,
                  });
                }}
                className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap"
              >
                100% Card
              </button>

              <button
                type="button"
                onClick={() => {
                  setSplitAmounts({
                    Cash: 0,
                    Card: 0,
                    'Mobile Transfer': 0,
                    'Bank Transfer': 0,
                    'Store Credit': 0,
                  });
                }}
                className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 rounded-lg text-[10px] font-bold whitespace-nowrap"
              >
                Reset All
              </button>
            </div>

            {/* Split Amount Inputs per Method */}
            <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
              {(['Cash', 'Card', 'Mobile Transfer'] as const).map((method) => {
                const currentVal = splitAmounts[method];
                return (
                  <div key={method} className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-200/60 dark:border-slate-800">
                    <span className="font-bold text-xs text-slate-700 dark:text-slate-300 w-28">
                      {method}
                    </span>
                    <div className="flex items-center gap-1.5 flex-1 justify-end">
                      <div className="relative w-32">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs">
                          {settings.currencySymbol}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={currentVal || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setSplitAmounts((prev) => ({ ...prev, [method]: val }));
                          }}
                          className="w-full pl-7 pr-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-right font-black text-xs text-slate-900 dark:text-white"
                          placeholder="0.00"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const otherTotal = (Object.entries(splitAmounts) as [string, number][])
                            .filter(([m]) => m !== method)
                            .reduce((sum, [_, amt]) => sum + amt, 0);
                          const needed = Math.max(0, grandTotal - otherTotal);
                          setSplitAmounts((prev) => ({ ...prev, [method]: Math.round(needed * 100) / 100 }));
                        }}
                        className="px-2 py-1 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded-lg text-[10px] font-extrabold whitespace-nowrap"
                        title="Fill remaining balance into this method"
                      >
                        Fill Rem.
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowSplitModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const activeSplits = (Object.entries(splitAmounts) as [string, number][])
                    .filter(([_, amt]) => amt > 0)
                    .map(([method, amt]) => `${method}: ${settings.currencySymbol}${amt.toFixed(2)}`);
                  const splitNotes = `Split Payment breakdown: ${activeSplits.join(', ')}`;
                  handleCheckout(totalSplitPaid, splitNotes);
                }}
                disabled={totalSplitPaid <= 0 || cart.length === 0}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Confirm & Complete Sale ({settings.currencySymbol}{totalSplitPaid.toFixed(2)})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk / Large Quantity Modal */}
      {qtyModalProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 rounded-2xl">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Set Item Quantity</h3>
                  <p className="text-[11px] text-slate-500 font-medium line-clamp-1">{qtyModalProduct.product.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQtyModalProduct(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Product stock & pricing summary */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400 block font-medium">Available Stock</span>
                <span className="font-extrabold text-slate-900 dark:text-white text-sm">
                  {qtyModalProduct.product.currentStock} {qtyModalProduct.product.unit}
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block font-medium">Wholesale Pricing</span>
                <span className="font-extrabold text-emerald-600 dark:text-emerald-400 text-xs">
                  Min {qtyModalProduct.product.minWholesaleQty || 1} @ {settings.currencySymbol}{(Number(qtyModalProduct.product.wholesalePrice) || 0).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Quantity Input Field with +/- 10 buttons */}
            <div>
              <label className="block font-bold text-xs text-slate-700 dark:text-slate-300 mb-1.5">
                Enter Exact Quantity:
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const current = parseInt(qtyInputVal, 10) || 1;
                    setQtyInputVal(Math.max(1, current - 10).toString());
                  }}
                  className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl font-extrabold text-xs text-slate-700 dark:text-slate-300 transition-colors"
                >
                  -10
                </button>

                <input
                  type="number"
                  min="1"
                  max={isBackdateMode ? undefined : qtyModalProduct.product.currentStock}
                  value={qtyInputVal}
                  onChange={(e) => setQtyInputVal(e.target.value)}
                  className="flex-1 py-2 px-3 text-center bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-blue-500 rounded-xl text-slate-900 dark:text-white font-black text-xl shadow-inner"
                  autoFocus
                />

                <button
                  type="button"
                  onClick={() => {
                    const current = parseInt(qtyInputVal, 10) || 0;
                    const nextVal = isBackdateMode
                      ? current + 10
                      : Math.min(qtyModalProduct.product.currentStock, current + 10);
                    setQtyInputVal(nextVal.toString());
                  }}
                  className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl font-extrabold text-xs text-slate-700 dark:text-slate-300 transition-colors"
                >
                  +10
                </button>
              </div>
            </div>

            {/* Quick Bulk Presets */}
            <div>
              <span className="block text-[10px] uppercase font-extrabold text-slate-400 mb-1.5 tracking-wider">
                Quick Quantity Presets
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {[5, 10, 25, 50, 100, 250, qtyModalProduct.product.minWholesaleQty, qtyModalProduct.product.currentStock]
                  .filter((val, idx, self) => val > 0 && self.indexOf(val) === idx)
                  .map((presetVal) => {
                    const isWholesaleVal = presetVal === qtyModalProduct.product.minWholesaleQty;
                    const isMaxVal = presetVal === qtyModalProduct.product.currentStock;
                    let label = `${presetVal}`;
                    if (isWholesaleVal && isMaxVal) label = `Stock/Ws (${presetVal})`;
                    else if (isWholesaleVal) label = `Ws Min (${presetVal})`;
                    else if (isMaxVal) label = `Stock (${presetVal})`;

                    return (
                      <button
                        key={presetVal}
                        type="button"
                        onClick={() => {
                          const target = isBackdateMode
                            ? presetVal
                            : Math.min(presetVal, qtyModalProduct.product.currentStock);
                          setQtyInputVal(target.toString());
                        }}
                        className={`py-1.5 px-1 rounded-xl text-[10px] font-bold transition-all truncate border ${
                          parseInt(qtyInputVal, 10) === presetVal
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950 border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Line item live total preview */}
            {(() => {
              const parsedQty = parseInt(qtyInputVal, 10) || 0;
              const isWholesale = parsedQty >= qtyModalProduct.product.minWholesaleQty;
              const unitPrice = isWholesale ? qtyModalProduct.product.wholesalePrice : qtyModalProduct.product.retailPrice;
              const total = parsedQty * unitPrice;

              return (
                <div className="p-3 bg-blue-50/80 dark:bg-blue-950/50 border border-blue-200/80 dark:border-blue-900/60 rounded-2xl space-y-1 text-xs">
                  <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
                    <span>Applied Rate:</span>
                    <span className="font-extrabold">
                      {settings.currencySymbol}{unitPrice.toFixed(2)} / {qtyModalProduct.product.unit}
                      {isWholesale && (
                        <span className="ml-1.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[9px] font-black px-1.5 py-0.5 rounded-md">
                          Wholesale Discount
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-blue-200/60 dark:border-blue-800/60 text-slate-900 dark:text-white font-black text-sm">
                    <span>Subtotal Price:</span>
                    <span className="text-blue-600 dark:text-blue-400 text-base">
                      {settings.currencySymbol}{total.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setQtyModalProduct(null)}
                className="px-4 py-2 font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetQty = parseInt(qtyInputVal, 10);
                  if (!isNaN(targetQty) && targetQty > 0) {
                    setCartQtyDirect(qtyModalProduct.product.id, targetQty);
                    setQtyModalProduct(null);
                  }
                }}
                disabled={isNaN(parseInt(qtyInputVal, 10)) || parseInt(qtyInputVal, 10) <= 0}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Confirm Quantity</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Receipt Modal */}
      {activeReceiptSale && (
        <ReceiptModal
          sale={activeReceiptSale}
          onClose={() => setActiveReceiptSale(null)}
        />
      )}
    </div>
  );
};
