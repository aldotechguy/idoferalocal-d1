import React, { useState } from 'react';
import {
  MessageCircle,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Truck,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Trash2,
  Send,
  ShoppingBag,
  UserCheck,
  FileText,
  AlertCircle,
  X,
  ArrowRight,
  ShieldCheck,
  Building2,
  Edit3,
  Receipt,
} from 'lucide-react';
import { NairaSign } from '../common/NairaSign';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { WhatsAppPreOrder, PreOrderStatus, PaymentMethod, PreOrderItem, Sale } from '../../types';
import { ConfirmModal } from '../common/ConfirmModal';
import { ReceiptModal } from '../common/ReceiptModal';
import { Pagination } from '../common/Pagination';

export const WhatsAppOrdersView: React.FC<{ onNavigate?: (page: string) => void }> = ({ onNavigate }) => {
  const {
    whatsAppPreOrders,
    addWhatsAppPreOrder,
    updateWhatsAppPreOrder,
    updateWhatsAppPreOrderStatus,
    convertPreOrderToSale,
    deleteWhatsAppPreOrder,
    products,
    customers,
    addCustomer,
    settings,
    sales,
    generateUniqueInvoiceNo,
  } = useApp();
  const { currentUser, users } = useAuth();
  const { showToast } = useToast();

  const isAdmin = currentUser?.role === 'Administrator';
  const isSalesStaff = currentUser?.role === 'Sales Staff';
  const canEditOrders = isAdmin || isSalesStaff || true;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [orderToEdit, setOrderToEdit] = useState<WhatsAppPreOrder | null>(null);
  const [orderToConvert, setOrderToConvert] = useState<WhatsAppPreOrder | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<WhatsAppPreOrder | null>(null);
  const [selectedReceiptSale, setSelectedReceiptSale] = useState<Sale | null>(null);

  const handleViewInvoice = (order: WhatsAppPreOrder) => {
    // Check if there is a converted sale record in the database
    const matchedSale = sales.find(
      (s) =>
        (order.convertedSaleId && s.id === order.convertedSaleId) ||
        (order.convertedInvoiceNo && s.invoiceNo === order.convertedInvoiceNo)
    );

    if (matchedSale) {
      setSelectedReceiptSale(matchedSale);
    } else {
      // Ensure unique cross-board invoice number
      const uniqueInvoiceNo = order.convertedInvoiceNo || generateUniqueInvoiceNo(sales, whatsAppPreOrders);

      // Lazily persist unique invoice number if not already stored
      if (!order.convertedInvoiceNo) {
        updateWhatsAppPreOrder(order.id, { convertedInvoiceNo: uniqueInvoiceNo });
      }

      // Build real-time Sale object from WhatsAppPreOrder using ONLY the exact selected elements
      const realtimeSale: Sale = {
        id: order.convertedSaleId || order.id,
        invoiceNo: uniqueInvoiceNo,
        customerId: order.customerId,
        customerName: order.customerName || 'Walk-in Customer',
        type: 'Retail',
        items: order.items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          sku: it.sku || 'N/A',
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          costPrice: 0,
          total: it.total,
        })),
        subtotal: order.subtotal,
        discount: order.discount || 0,
        tax: 0,
        deliveryFee: order.deliveryFee || 0,
        totalAmount: order.totalAmount,
        paidAmount: order.status === 'Completed' ? order.totalAmount : (order.depositAmount || 0),
        paymentMethod: (order as any).paymentMethod || 'Mobile Transfer',
        status: order.status === 'Completed' ? 'Completed' : 'Draft',
        notes: `[WhatsApp Pre-Order #${order.preOrderNo}]${order.deliveryAddress ? ` Delivery: ${order.deliveryAddress}` : ''}${order.notes ? ` • Note: ${order.notes}` : ''}`,
        createdBy: order.createdBy || 'WhatsApp Staff',
        orderTakenBy: order.createdBy,
        convertedBy: currentUser?.displayName || 'Cashier',
        createdAt: order.createdAt,
      };
      setSelectedReceiptSale(realtimeSale);
    }
  };

  // Customer Selection / Addition State
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [autoAddCustomer, setAutoAddCustomer] = useState<boolean>(true);

  // Conversion state
  const [conversionPaymentMethod, setConversionPaymentMethod] = useState<PaymentMethod>('Mobile Transfer');
  const [conversionNotes, setConversionNotes] = useState('');
  const [attributionOption, setAttributionOption] = useState<'converter' | 'creator' | 'custom'>('converter');
  const [customAttributedStaff, setCustomAttributedStaff] = useState<string>('');

  const handleOpenConvertModal = (order: WhatsAppPreOrder) => {
    setOrderToConvert(order);
    setConversionPaymentMethod('Mobile Transfer');
    setConversionNotes('');
    const defaultRule = settings.whatsAppSalesAttributionRule || 'converter';
    setAttributionOption(defaultRule);
    setCustomAttributedStaff(order.createdBy || currentUser?.displayName || 'Sales Staff');
  };

  const handleOpenEditModal = (order: WhatsAppPreOrder) => {
    setOrderToEdit(order);
    setSelectedCustomerId(order.customerId || '');
    setRawText(order.rawWhatsAppMessage || '');
    setFormData({
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      deliveryAddress: order.deliveryAddress || '',
      notes: order.notes || '',
      discount: order.discount || 0,
      deliveryFee: order.deliveryFee || 0,
      depositAmount: order.depositAmount || 0,
      expectedDeliveryDate: order.expectedDeliveryDate || new Date(Date.now() + 86400000).toISOString().split('T')[0],
    });
    setOrderItems(order.items.map((i) => ({ ...i })));
    setImportMode('manual');
    setShowAddModal(true);
  };

  const handleCloseOrderModal = () => {
    setShowAddModal(false);
    setOrderToEdit(null);
    setSelectedCustomerId('');
    setAutoAddCustomer(true);
    setRawText('');
    setFormData({
      customerName: '',
      customerPhone: '',
      deliveryAddress: '',
      notes: '',
      discount: 0,
      deliveryFee: 0,
      depositAmount: 0,
      expectedDeliveryDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    });
    setOrderItems([]);
  };

  // New Pre-Order Form State
  const [importMode, setImportMode] = useState<'parse' | 'manual'>('parse');
  const [rawText, setRawText] = useState('');
  const [formData, setFormData] = useState({
    customerName: '',
    customerPhone: '',
    deliveryAddress: '',
    notes: '',
    discount: 0,
    deliveryFee: 0,
    depositAmount: 0,
    expectedDeliveryDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
  });
  const [orderItems, setOrderItems] = useState<PreOrderItem[]>([]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset to page 1 when filter/search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedStatus]);

  // Filter Pre-Orders
  const filteredOrders = whatsAppPreOrders.filter((order) => {
    if (!order) return false;
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch =
      (order.preOrderNo || '').toLowerCase().includes(q) ||
      (order.customerName || '').toLowerCase().includes(q) ||
      (order.customerPhone && order.customerPhone.includes(searchQuery)) ||
      (order.items || []).some((i) => (i.productName || '').toLowerCase().includes(q));

    const matchesStatus = selectedStatus === 'All' || order.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.ceil(filteredOrders.length / pageSize) || 1;
  const paginatedOrders = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredOrders.slice(start, start + pageSize);
  }, [filteredOrders, currentPage, pageSize]);

  // Calculate Summary KPIs
  const totalOrders = whatsAppPreOrders.length;
  const pendingOrders = whatsAppPreOrders.filter((o) => o.status !== 'Completed' && o.status !== 'Cancelled');
  const completedOrders = whatsAppPreOrders.filter((o) => o.status === 'Completed');
  const totalPendingValue = pendingOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalDepositsCollected = pendingOrders.reduce((sum, o) => sum + o.depositAmount, 0);

  // Customer Selection Handlers
  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    if (customerId) {
      const cust = customers.find((c) => c.id === customerId);
      if (cust) {
        setFormData((prev) => ({
          ...prev,
          customerName: cust.name,
          customerPhone: cust.phone || prev.customerPhone,
          deliveryAddress: cust.address || prev.deliveryAddress,
        }));
      }
    }
  };

  const handleClearSelectedCustomer = () => {
    setSelectedCustomerId('');
  };

  // Auto-Parse WhatsApp Message Text
  const handleParseWhatsAppText = () => {
    if (!rawText.trim()) return;

    let extractedName = '';
    let extractedPhone = '';
    let extractedAddress = '';
    const parsedItems: PreOrderItem[] = [];

    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

    let hasStockCapped = false;

    lines.forEach((line) => {
      // Check customer / contact fields
      if (/customer|name:/i.test(line)) {
        extractedName = line.replace(/customer|name:/i, '').trim();
      } else if (/phone|mobile|tel|wa:/i.test(line)) {
        extractedPhone = line.replace(/phone|mobile|tel|wa:/i, '').trim();
      } else if (/address|deliver|location:/i.test(line)) {
        extractedAddress = line.replace(/address|deliver|location:/i, '').trim();
      } else {
        // Try to match line items like: 2x Product Name ($45.00) or 1 - Product Name
        const qtyMatch = line.match(/^(\d+)[\s*x\-]+(.+)$/i);
        if (qtyMatch) {
          const rawQty = parseInt(qtyMatch[1], 10) || 1;
          let prodNameCandidate = qtyMatch[2].trim();

          // Price extraction if written like ($89.99) or @ $24.50
          let price = 0;
          const priceMatch = prodNameCandidate.match(/[\$₦@]\s*([\d\.,]+)/);
          if (priceMatch) {
            price = parseFloat(priceMatch[1].replace(/,/g, '')) || 0;
            prodNameCandidate = prodNameCandidate.replace(/[\$₦@]\s*[\d\.,]+/, '').replace(/[\(\)]/g, '').trim();
          }

          // Try matching catalog
          const matchedProd = products.find((p) =>
            (p.name && prodNameCandidate && p.name.toLowerCase().includes(prodNameCandidate.toLowerCase())) ||
            (prodNameCandidate && p.name && prodNameCandidate.toLowerCase().includes(p.name.toLowerCase()))
          );

          let qty = rawQty;
          if (matchedProd) {
            const availStock = Math.max(0, matchedProd.currentStock);
            if (rawQty > availStock) {
              qty = availStock;
              hasStockCapped = true;
            }
          }

          const isWholesale = matchedProd ? qty >= matchedProd.minWholesaleQty : false;
          const calculatedUnitPrice = price || (matchedProd ? (isWholesale ? matchedProd.wholesalePrice : matchedProd.retailPrice) : 10.0);

          parsedItems.push({
            productId: matchedProd?.id,
            productName: matchedProd ? matchedProd.name : prodNameCandidate,
            sku: matchedProd?.sku || '',
            quantity: qty,
            unitPrice: calculatedUnitPrice,
            total: qty * calculatedUnitPrice,
            isWholesale,
            useRetailPrice: false,
          });
        }
      }
    });

    // If no items matched by 2x format, match catalog product names directly inside text
    if (parsedItems.length === 0) {
      products.forEach((p) => {
        if (p.name && rawText && rawText.toLowerCase().includes(p.name.toLowerCase())) {
          const availStock = Math.max(0, p.currentStock);
          const initialQty = Math.min(1, availStock);
          if (availStock < 1) hasStockCapped = true;

          const isWholesale = initialQty >= p.minWholesaleQty;
          const unitPrice = isWholesale ? p.wholesalePrice : p.retailPrice;
          parsedItems.push({
            productId: p.id,
            productName: p.name,
            sku: p.sku,
            quantity: initialQty,
            unitPrice,
            total: initialQty * unitPrice,
            isWholesale,
            useRetailPrice: false,
          });
        }
      });
    }

    if (hasStockCapped) {
      showToast({
        title: 'Stock Quantity Capped',
        message: 'Some parsed pre-order quantities were automatically capped to available inventory stock.',
        type: 'warning',
      });
    }

    // Try auto-matching customer directory by phone or name
    const matchedCust = customers.find(
      (c) =>
        (extractedPhone && c.phone && c.phone.replace(/\D/g, '') === extractedPhone.replace(/\D/g, '')) ||
        (extractedName && c.name && c.name.toLowerCase() === extractedName.toLowerCase())
    );

    if (matchedCust) {
      setSelectedCustomerId(matchedCust.id);
      if (!extractedName) extractedName = matchedCust.name;
      if (!extractedPhone) extractedPhone = matchedCust.phone;
      if (!extractedAddress && matchedCust.address) extractedAddress = matchedCust.address;
    } else {
      setSelectedCustomerId('');
    }

    if (extractedName) setFormData((prev) => ({ ...prev, customerName: extractedName }));
    if (extractedPhone) setFormData((prev) => ({ ...prev, customerPhone: extractedPhone }));
    if (extractedAddress) setFormData((prev) => ({ ...prev, deliveryAddress: extractedAddress }));

    if (parsedItems.length > 0) {
      setOrderItems(parsedItems);
    } else {
      // Default placeholder item
      if (products.length > 0) {
        const defaultProd = products.find((p) => p.currentStock > 0) || products[0];
        const availStock = Math.max(0, defaultProd.currentStock);
        const initialQty = Math.min(1, availStock);
        const isWholesale = initialQty >= defaultProd.minWholesaleQty;
        const unitPrice = isWholesale ? defaultProd.wholesalePrice : defaultProd.retailPrice;
        setOrderItems([
          {
            productId: defaultProd.id,
            productName: defaultProd.name,
            sku: defaultProd.sku,
            quantity: initialQty,
            unitPrice,
            total: initialQty * unitPrice,
            isWholesale,
            useRetailPrice: false,
          },
        ]);
      }
    }

    setImportMode('manual');
  };

  // Item management in manual form
  const handleAddItemToOrder = () => {
    if (products.length === 0) return;
    const inStockProd = products.find((p) => p.currentStock > 0);
    const defaultProd = inStockProd || products[0];
    const availStock = Math.max(0, defaultProd.currentStock);
    const initialQty = Math.min(1, availStock);

    if (availStock <= 0) {
      showToast({
        title: 'Out of Stock Warning',
        message: `"${defaultProd.name}" is currently out of stock (0 available).`,
        type: 'warning',
      });
    }

    const isWholesale = initialQty >= defaultProd.minWholesaleQty;
    const unitPrice = isWholesale ? defaultProd.wholesalePrice : defaultProd.retailPrice;
    setOrderItems((prev) => [
      {
        productId: defaultProd.id,
        productName: defaultProd.name,
        sku: defaultProd.sku,
        quantity: initialQty,
        unitPrice,
        total: initialQty * unitPrice,
        isWholesale,
        useRetailPrice: false,
      },
      ...prev,
    ]);
  };

  // Helper to accurately find matched product from inventory catalog
  const getMatchedProduct = (productId?: string, sku?: string, productName?: string) => {
    if (productId) {
      const foundById = products.find((p) => p.id === productId);
      if (foundById) return foundById;
    }
    if (sku) {
      const foundBySku = products.find((p) => p.sku === sku);
      if (foundBySku) return foundBySku;
    }
    if (productName) {
      const foundByName = products.find((p) => p.name && p.name.toLowerCase() === productName.toLowerCase());
      if (foundByName) return foundByName;
    }
    return undefined;
  };

  const handleUpdateOrderItem = (index: number, field: keyof PreOrderItem, value: any) => {
    setOrderItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;

        if (field === 'productId') {
          const matchedProd = products.find((p) => p.id === value);
          if (!matchedProd) return { ...item, productId: value };

          const availStock = Math.max(0, matchedProd.currentStock);
          let qty = item.quantity;
          if (qty <= 0 && availStock > 0) {
            qty = Math.min(1, availStock);
          } else if (qty > availStock) {
            qty = availStock;
            showToast({
              title: 'Stock Limit Reached',
              message: `Quantity for "${matchedProd.name}" capped at available inventory stock (${availStock} ${matchedProd.unit}).`,
              type: 'warning',
            });
          }

          const meetsWholesale = qty >= matchedProd.minWholesaleQty;
          const useRP = Boolean(item.useRetailPrice && meetsWholesale);
          const isWholesale = meetsWholesale && !useRP;
          const unitPrice = useRP ? matchedProd.retailPrice : (meetsWholesale ? matchedProd.wholesalePrice : matchedProd.retailPrice);

          return {
            ...item,
            productId: matchedProd.id,
            productName: matchedProd.name,
            sku: matchedProd.sku,
            quantity: qty,
            unitPrice,
            total: qty * unitPrice,
            isWholesale,
            useRetailPrice: useRP,
          };
        }

        const updated = { ...item, [field]: value };
        const matchedProd = getMatchedProduct(updated.productId, updated.sku, updated.productName);

        if (field === 'quantity' && matchedProd) {
          const availStock = Math.max(0, matchedProd.currentStock);
          const reqQty = Math.max(0, parseInt(value, 10) || 0);

          if (reqQty > availStock) {
            updated.quantity = availStock;
            showToast({
              title: 'Inventory Stock Exceeded',
              message: `Cannot order more than available stock! Only ${availStock} ${matchedProd.unit} left for "${matchedProd.name}".`,
              type: 'warning',
            });
          } else {
            updated.quantity = reqQty;
          }

          const meetsWholesale = updated.quantity >= matchedProd.minWholesaleQty;
          const useRP = Boolean(updated.useRetailPrice && meetsWholesale);
          updated.isWholesale = meetsWholesale && !useRP;
          updated.useRetailPrice = useRP;
          updated.unitPrice = useRP ? matchedProd.retailPrice : (meetsWholesale ? matchedProd.wholesalePrice : matchedProd.retailPrice);
        }

        if (field === 'useRetailPrice' && matchedProd) {
          const meetsWholesale = updated.quantity >= matchedProd.minWholesaleQty;
          const useRP = Boolean(value && meetsWholesale);
          updated.useRetailPrice = useRP;
          updated.isWholesale = meetsWholesale && !useRP;
          updated.unitPrice = useRP ? matchedProd.retailPrice : (meetsWholesale ? matchedProd.wholesalePrice : matchedProd.retailPrice);
        }

        if (field === 'quantity' || field === 'unitPrice' || field === 'useRetailPrice') {
          updated.total = (updated.quantity || 0) * (updated.unitPrice || 0);
        }

        return updated;
      })
    );
  };

  const handleRemoveOrderItem = (index: number) => {
    setOrderItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Submit New Pre-Order
  const handleCreateOrderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (orderItems.length === 0) {
      showToast({ title: 'Validation Error', message: 'Please add at least one item to the pre-order.', type: 'error' });
      return;
    }

    // Validate inventory stock across all order items
    const prodQtySums = new Map<string, number>();
    for (const item of orderItems) {
      if (item.productId) {
        prodQtySums.set(item.productId, (prodQtySums.get(item.productId) || 0) + item.quantity);
      }
    }

    for (const item of orderItems) {
      const matchedProd = getMatchedProduct(item.productId, item.sku, item.productName);
      if (matchedProd) {
        const availStock = Math.max(0, matchedProd.currentStock);
        const totalReq = prodQtySums.get(matchedProd.id) || item.quantity;

        if (availStock <= 0) {
          showToast({
            title: 'Out of Stock Error',
            message: `Cannot submit pre-order. Product "${matchedProd.name}" is out of stock (0 available).`,
            type: 'error',
          });
          return;
        }

        if (item.quantity <= 0) {
          showToast({
            title: 'Invalid Quantity',
            message: `Item quantity for "${matchedProd.name}" must be at least 1.`,
            type: 'error',
          });
          return;
        }

        if (totalReq > availStock) {
          showToast({
            title: 'Stock Exceeded Error',
            message: `Cannot submit pre-order. Total requested quantity for "${matchedProd.name}" (${totalReq}) exceeds available inventory (${availStock} ${matchedProd.unit}).`,
            type: 'error',
          });
          return;
        }
      }
    }

    let finalCustomerId = selectedCustomerId;

    // If no existing customer selected, auto-match or auto-register new customer
    if (!finalCustomerId && formData.customerName.trim()) {
      const existingCust = customers.find(
        (c) =>
          (formData.customerPhone && c.phone && c.phone.replace(/\D/g, '') === formData.customerPhone.replace(/\D/g, '')) ||
          (c.name && formData.customerName && c.name.toLowerCase() === formData.customerName.trim().toLowerCase())
      );

      if (existingCust) {
        finalCustomerId = existingCust.id;
      } else if (autoAddCustomer) {
        const newCust = addCustomer({
          name: formData.customerName.trim(),
          phone: formData.customerPhone.trim(),
          email: '',
          address: formData.deliveryAddress.trim(),
        });
        if (newCust) {
          finalCustomerId = newCust.id;
        }
      }
    }

    const subtotal = orderItems.reduce((acc, i) => acc + i.total, 0);
    const discount = formData.discount || 0;
    const deliveryFee = formData.deliveryFee || 0;
    const totalAmount = Math.max(0, subtotal - discount + deliveryFee);

    if (orderToEdit) {
      updateWhatsAppPreOrder(
        orderToEdit.id,
        {
          customerId: finalCustomerId || undefined,
          customerName: formData.customerName || 'WhatsApp Customer',
          customerPhone: formData.customerPhone || '',
          deliveryAddress: formData.deliveryAddress,
          notes: formData.notes,
          rawWhatsAppMessage: rawText,
          items: orderItems,
          discount,
          deliveryFee,
          depositAmount: formData.depositAmount,
          status: formData.depositAmount > 0 && orderToEdit.status === 'Pending Review' ? 'Deposit Paid' : orderToEdit.status,
          expectedDeliveryDate: formData.expectedDeliveryDate,
        },
        currentUser?.displayName || 'Admin'
      );
    } else {
      addWhatsAppPreOrder({
        customerId: finalCustomerId || undefined,
        customerName: formData.customerName || 'WhatsApp Customer',
        customerPhone: formData.customerPhone || '',
        deliveryAddress: formData.deliveryAddress,
        notes: formData.notes,
        rawWhatsAppMessage: rawText,
        items: orderItems,
        subtotal,
        discount,
        deliveryFee,
        depositAmount: formData.depositAmount,
        totalAmount,
        status: formData.depositAmount > 0 ? 'Deposit Paid' : 'Pending Review',
        expectedDeliveryDate: formData.expectedDeliveryDate,
        createdBy: currentUser?.displayName || 'Sales Staff',
      });
    }

    // Reset and close
    handleCloseOrderModal();
    setOrderItems([]);
  };

  // Execute Conversion
  const handleConfirmConversion = () => {
    if (!orderToConvert) return;

    // Check stock before triggering conversion
    for (const item of orderToConvert.items) {
      const catProd = getMatchedProduct(item.productId, item.sku, item.productName);
      if (catProd) {
        const availStock = Math.max(0, catProd.currentStock);
        if (availStock <= 0) {
          showToast({
            title: 'Conversion Blocked',
            message: `Cannot convert order. Product "${catProd.name}" is out of stock (0 available).`,
            type: 'error',
          });
          return;
        }
        if (item.quantity > availStock) {
          showToast({
            title: 'Conversion Blocked',
            message: `Cannot convert order. Requested quantity for "${catProd.name}" (${item.quantity}) exceeds available stock (${availStock} ${catProd.unit}).`,
            type: 'error',
          });
          return;
        }
      }
    }

    let finalSalesCredit = currentUser?.displayName || 'Sales Staff';
    if (attributionOption === 'creator') {
      finalSalesCredit = orderToConvert.createdBy || 'WhatsApp Order Taker';
    } else if (attributionOption === 'custom' && customAttributedStaff) {
      finalSalesCredit = customAttributedStaff;
    }

    try {
      const createdSale = convertPreOrderToSale(
        orderToConvert.id,
        conversionPaymentMethod,
        currentUser?.displayName || 'Sales Staff',
        conversionNotes,
        finalSalesCredit
      );
      setOrderToConvert(null);
      setConversionNotes('');
      if (createdSale) {
        setSelectedReceiptSale(createdSale);
      }
    } catch (err) {
      // Handled in convertPreOrderToSale
    }
  };

  // Generate WhatsApp Reply URL
  const generateWhatsAppLink = (order: WhatsAppPreOrder, type: 'confirm' | 'ready' | 'receipt') => {
    const phone = order.customerPhone.replace(/\D/g, '');
    let msg = '';

    if (type === 'confirm') {
      const delFeeLine = (order.deliveryFee && order.deliveryFee > 0) ? `\nDelivery Fee: ${settings.currencySymbol}${order.deliveryFee.toFixed(2)}` : '';
      const discLine = (order.discount && order.discount > 0) ? `\nDiscount: -${settings.currencySymbol}${order.discount.toFixed(2)}` : '';
      msg = `Hi ${order.customerName}! Thank you for your WhatsApp catalogue order #${order.preOrderNo}.\n\nOrder Items:\n${order.items.map((i) => `• ${i.quantity}x ${i.productName} (${settings.currencySymbol}${i.total.toFixed(2)})`).join('\n')}\n\nSubtotal: ${settings.currencySymbol}${order.subtotal.toFixed(2)}${discLine}${delFeeLine}\nTotal: ${settings.currencySymbol}${order.totalAmount.toFixed(2)} (Tax Exempt)\nDeposit Paid: ${settings.currencySymbol}${order.depositAmount.toFixed(2)}\nRemaining: ${settings.currencySymbol}${(order.totalAmount - order.depositAmount).toFixed(2)}\nStatus: ${order.status}\n\nWe are processing your order for dispatch!`;
    } else if (type === 'ready') {
      msg = `Hi ${order.customerName}, good news! Your order #${order.preOrderNo} is packed and ready for delivery/pickup.\nDelivery Address: ${order.deliveryAddress || 'Store Pickup'}.`;
    } else {
      msg = `Hi ${order.customerName}, your WhatsApp order #${order.preOrderNo} has been completed! Invoice #${order.convertedInvoiceNo || 'N/A'}. Thank you for shopping with ${settings.storeName}!`;
    }

    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  const getStatusBadge = (status: PreOrderStatus) => {
    switch (status) {
      case 'Pending Review':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      case 'Confirmed':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'Deposit Paid':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
      case 'Processing':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 border-purple-200 dark:border-purple-800';
      case 'Completed':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'Cancelled':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border-rose-200 dark:border-rose-800';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300';
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-400">Total Pre-Orders</span>
            <MessageCircle className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">{totalOrders}</div>
          <p className="text-[10px] text-slate-500 mt-0.5">{pendingOrders.length} active pending fulfillment</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-400">Pending Value</span>
            <NairaSign className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">
            {settings.currencySymbol}{totalPendingValue.toFixed(2)}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">Across active pre-orders</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-400">Deposits Collected</span>
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
            {settings.currencySymbol}{totalDepositsCollected.toFixed(2)}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">Pre-payment downpayments</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-400">Sales Converted</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{completedOrders.length}</div>
          <p className="text-[10px] text-slate-500 mt-0.5">Converted into sales records</p>
        </div>
      </div>

      {/* Search & Filter Bar with Action Button */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pre-order #, customer name, phone, or items..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            {['All', 'Pending Review', 'Confirmed', 'Deposit Paid', 'Processing', 'Completed', 'Cancelled'].map((st) => (
              <button
                key={st}
                onClick={() => setSelectedStatus(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  selectedStatus === st
                    ? 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setImportMode('parse');
              setShowAddModal(true);
            }}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-all shadow-sm shadow-emerald-600/20 active:scale-95 whitespace-nowrap cursor-pointer ml-auto md:ml-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Pre-Order</span>
          </button>
        </div>
      </div>

      {/* Pre-Orders Cards / List */}
      <div className="space-y-4">
        {filteredOrders.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 p-12 text-center rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <MessageCircle className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
            <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base">No WhatsApp Pre-Orders Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
              Paste incoming WhatsApp Catalogue customer messages or draft manual pre-orders to manage pre-sales.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-emerald-600 text-white font-semibold text-xs rounded-xl hover:bg-emerald-700 transition-colors"
            >
              Convert First WhatsApp Order
            </button>
          </div>
        ) : (
          paginatedOrders.map((order) => {
            const isExpanded = expandedOrderId === order.id;
            const remainingBalance = order.totalAmount - order.depositAmount;

            return (
              <div
                key={order.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all"
              >
                {/* Main Card Header */}
                <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/40 dark:bg-slate-800/20">
                  <div className="flex items-start md:items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                      <MessageCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                          {order.preOrderNo}
                        </span>
                        <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border ${getStatusBadge(order.status)}`}>
                          {order.status}
                        </span>
                        {order.convertedInvoiceNo && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            Invoice: {order.convertedInvoiceNo}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5 text-blue-500" />
                          {order.customerName}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-slate-600 dark:text-slate-300">{order.customerPhone}</span>
                        <span>•</span>
                        <span>Created: {new Date(order.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-slate-200/60 dark:border-slate-800">
                    <div className="text-right">
                      <div className="text-xs font-semibold text-slate-400">Total Pre-Order</div>
                      <div className="text-lg font-black text-slate-900 dark:text-white">
                        {settings.currencySymbol}{order.totalAmount.toFixed(2)}
                      </div>
                      {order.depositAmount > 0 && order.status !== 'Completed' && (
                        <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          Deposit Paid: {settings.currencySymbol}{order.depositAmount.toFixed(2)} (Bal: {settings.currencySymbol}{remainingBalance.toFixed(2)})
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                      className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Status Progress Bar */}
                <div className="px-5 py-2.5 bg-slate-100/60 dark:bg-slate-800/50 border-t border-b border-slate-200/60 dark:border-slate-800 flex items-center justify-between gap-2 overflow-x-auto text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-2">
                    <Truck className="w-3.5 h-3.5 text-amber-500" />
                    <span>Delivery/Pickup: <strong className="text-slate-800 dark:text-slate-200">{order.deliveryAddress || 'Store Pickup'}</strong></span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-blue-500" />
                    <span>Expected: <strong className="text-slate-800 dark:text-slate-200">{order.expectedDeliveryDate || 'ASAP'}</strong></span>
                  </div>

                  {/* Quick Action Controls */}
                  <div className="flex items-center gap-2 ml-auto">
                    {/* Status Dropdown */}
                    {order.status !== 'Completed' && (
                      <select
                        value={order.status}
                        onChange={(e) => updateWhatsAppPreOrderStatus(order.id, e.target.value as PreOrderStatus)}
                        className="py-1 px-2 text-[10px] font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg dark:text-white cursor-pointer"
                      >
                        <option value="Pending Review">Pending Review</option>
                        <option value="Confirmed">Confirmed</option>
                        <option value="Deposit Paid">Deposit Paid</option>
                        <option value="Processing">Processing</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    )}

                    {/* WhatsApp Customer Reply Link */}
                    {order.customerPhone && (
                      <a
                        href={generateWhatsAppLink(order, order.status === 'Completed' ? 'receipt' : 'confirm')}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/80 dark:text-emerald-300 text-[10px] font-bold rounded-lg border border-emerald-200 dark:border-emerald-800 transition-colors"
                        title="Send WhatsApp update message to client"
                      >
                        <MessageCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span>Chat Client</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}

                    {/* Edit Order Button (Sales Users & Admin) */}
                    {canEditOrders && (
                      <button
                        onClick={() => handleOpenEditModal(order)}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg transition-all shadow-xs"
                        title="Edit customer details, items, prices, and fees for this order"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit Order</span>
                      </button>
                    )}

                    {/* Real-time Invoice / Receipt Button */}
                    <button
                      onClick={() => handleViewInvoice(order)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold rounded-lg transition-all shadow-xs"
                      title="View / Print official real-time invoice"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>View Invoice</span>
                    </button>

                    {/* Convert to Sale Button */}
                    {order.status !== 'Completed' && order.status !== 'Cancelled' && (
                      <button
                        onClick={() => handleOpenConvertModal(order)}
                        className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg transition-all shadow-xs"
                        title="Convert pre-order to completed sale record in POS"
                      >
                        <ShoppingBag className="w-3.5 h-3.5" />
                        <span>Convert to Sale</span>
                      </button>
                    )}

                    {/* Delete Pre-Order */}
                    <button
                      onClick={() => setOrderToDelete(order)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Delete WhatsApp Pre-Order"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded Details Body */}
                {isExpanded && (
                  <div className="p-5 space-y-4 bg-white dark:bg-slate-900">
                    {canEditOrders && (
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
                        <div className="flex items-center gap-2 font-medium">
                          <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          <span>
                            <strong>Order Editing:</strong> You can modify catalog items, quantities, custom pricing, or customer details for this WhatsApp order.
                          </span>
                        </div>
                        <button
                          onClick={() => handleOpenEditModal(order)}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shrink-0 flex items-center gap-1 shadow-xs self-start sm:self-auto cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit Order</span>
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Items Table */}
                      <div className="space-y-3">
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                            Ordered Catalog Items ({order.items.length})
                          </h4>
                          <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
                            <table className="w-full text-xs text-left">
                              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-semibold">
                                <tr>
                                  <th className="p-2.5">Item Name</th>
                                  <th className="p-2.5 text-center">Qty</th>
                                  <th className="p-2.5 text-right">Price</th>
                                  <th className="p-2.5 text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                                {order.items.map((item, idx) => (
                                  <tr key={idx}>
                                    <td className="p-2.5 font-medium">
                                      {item.productName}
                                      {item.sku && <span className="block text-[10px] text-slate-400 font-mono">{item.sku}</span>}
                                      {item.useRetailPrice ? (
                                        <span className="inline-block mt-0.5 text-[9px] font-bold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 px-1.5 py-0.2 rounded">
                                          RP Override Active
                                        </span>
                                      ) : item.isWholesale ? (
                                        <span className="inline-block mt-0.5 text-[9px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.2 rounded">
                                          Wholesale Price
                                        </span>
                                      ) : null}
                                    </td>
                                    <td className="p-2.5 text-center font-bold">{item.quantity}</td>
                                    <td className="p-2.5 text-right font-mono">{settings.currencySymbol}{item.unitPrice.toFixed(2)}</td>
                                    <td className="p-2.5 text-right font-bold font-mono">{settings.currencySymbol}{item.total.toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Financial Summary Card */}
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-1.5 text-xs">
                          <div className="flex justify-between text-slate-600 dark:text-slate-400">
                            <span>Subtotal:</span>
                            <span className="font-mono">{settings.currencySymbol}{order.subtotal.toFixed(2)}</span>
                          </div>
                          {order.discount > 0 && (
                            <div className="flex justify-between text-rose-600 dark:text-rose-400">
                              <span>Discount:</span>
                              <span className="font-mono">-{settings.currencySymbol}{order.discount.toFixed(2)}</span>
                            </div>
                          )}
                          {(order.deliveryFee || 0) > 0 ? (
                            <div className="flex justify-between text-blue-600 dark:text-blue-400 font-semibold">
                              <span>Delivery Fee Collected:</span>
                              <span className="font-mono">+{settings.currencySymbol}{(order.deliveryFee || 0).toFixed(2)}</span>
                            </div>
                          ) : (
                            <div className="flex justify-between text-slate-400">
                              <span>Delivery Fee:</span>
                              <span>Free / Store Pickup</span>
                            </div>
                          )}
                          <div className="flex justify-between text-slate-500">
                            <span>Tax / VAT:</span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">Exempt ({settings.currencySymbol}0.00)</span>
                          </div>
                          <div className="flex justify-between font-bold pt-1.5 border-t border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white">
                            <span>Total Amount:</span>
                            <span className="font-mono text-sm">{settings.currencySymbol}{order.totalAmount.toFixed(2)}</span>
                          </div>
                          {order.depositAmount > 0 && (
                            <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-semibold pt-1 border-t border-slate-200/60 dark:border-slate-800">
                              <span>Deposit Paid:</span>
                              <span className="font-mono">{settings.currencySymbol}{order.depositAmount.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Raw WhatsApp Message & Notes */}
                      <div className="space-y-3">
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center justify-between">
                            <span>Raw WhatsApp Message Copy</span>
                            <button
                              onClick={() => navigator.clipboard.writeText(order.rawWhatsAppMessage || '')}
                              className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
                            >
                              <Copy className="w-3 h-3" /> Copy
                            </button>
                          </h4>
                          <div className="p-3 bg-emerald-50/50 dark:bg-slate-950/60 border border-emerald-100 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {order.rawWhatsAppMessage || 'No raw message stored.'}
                          </div>
                        </div>

                        {order.notes && (
                          <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Staff Notes</h4>
                            <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                              {order.notes}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Controls */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={filteredOrders.length}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        itemLabel="WhatsApp pre-orders"
      />

      {/* NEW PRE-ORDER / WHATSAPP PARSER MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl font-bold">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {orderToEdit ? `Edit WhatsApp Pre-Order #${orderToEdit.preOrderNo}` : 'New WhatsApp Catalogue Order'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {orderToEdit
                      ? 'Modify items, quantities, custom pricing, customer details, or delivery fee'
                      : 'Auto-parse incoming WhatsApp messages or build a custom pre-order'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseOrderModal}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Selector Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
              <button
                onClick={() => setImportMode('parse')}
                className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 border-b-2 transition-all ${
                  importMode === 'parse'
                    ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                <span>1. Paste & Auto-Parse Message</span>
              </button>
              <button
                onClick={() => setImportMode('manual')}
                className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 border-b-2 transition-all ${
                  importMode === 'manual'
                    ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <FileText className="w-4 h-4 text-blue-500" />
                <span>2. Review & Confirm Items ({orderItems.length})</span>
              </button>
            </div>

            <form onSubmit={handleCreateOrderSubmit} className="p-6 space-y-5">
              {importMode === 'parse' ? (
                <div className="space-y-4">
                  <div className="bg-emerald-50 dark:bg-emerald-950/40 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2.5">
                    <MessageCircle className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
                    <div>
                      <strong>Smart Catalogue Message Parser:</strong> Paste any message received from your client on WhatsApp or WhatsApp Business Catalogue. Our AI parser will extract item names, quantities, pricing, customer phone numbers, and addresses automatically.
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Paste WhatsApp Order Text / Copy
                    </label>
                    <textarea
                      rows={6}
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      placeholder={`Example paste:
Hi! I want to order from your WhatsApp Catalogue:
2x Wireless Noise-Canceling Earbuds Pro ($89.99)
1x Water Bottle
Customer: Chidi Okafor
Phone: +234 802 111 2233
Address: Victoria Island, Lagos`}
                      className="w-full p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono focus:ring-2 focus:ring-emerald-500 dark:text-white"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleParseWhatsAppText}
                    disabled={!rawText.trim()}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition-all"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Auto-Parse Catalogue Message</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Customer Information & Directory Selection */}
                  <div className="p-4 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 dark:border-slate-700/60 pb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg">
                          <UserCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white">Customer Assignment</h4>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            Select an existing customer or auto-create a new record in directory
                          </p>
                        </div>
                      </div>

                      {selectedCustomerId ? (
                        <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-xl text-xs text-emerald-800 dark:text-emerald-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="font-bold text-[11px]">Linked to Profile</span>
                          <button
                            type="button"
                            onClick={handleClearSelectedCustomer}
                            className="text-[10px] text-emerald-700 dark:text-emerald-400 hover:underline font-semibold ml-1"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          {customers.length} registered customer(s)
                        </span>
                      )}
                    </div>

                    {/* Select Existing Customer Dropdown */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Select Existing Customer Profile
                      </label>
                      <select
                        value={selectedCustomerId}
                        onChange={(e) => handleSelectCustomer(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">-- Create / Manual Entry (Or Select Existing Customer Below) --</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} {c.phone ? `(${c.phone})` : ''} • {c.purchaseHistoryCount || 0} orders
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Customer Details Inputs */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Customer Name
                        </label>
                        <input
                          type="text"
                          required
                          value={formData.customerName}
                          onChange={(e) => {
                            setFormData({ ...formData, customerName: e.target.value });
                            if (selectedCustomerId) {
                              const cust = customers.find((c) => c.id === selectedCustomerId);
                              if (cust && cust.name !== e.target.value) {
                                setSelectedCustomerId('');
                              }
                            }
                          }}
                          placeholder="e.g. Chidi Okafor"
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          WhatsApp Phone Number
                        </label>
                        <input
                          type="text"
                          required
                          value={formData.customerPhone}
                          onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                          placeholder="e.g. +234 802 111 2233"
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Delivery Address / Pickup
                        </label>
                        <input
                          type="text"
                          value={formData.deliveryAddress}
                          onChange={(e) => setFormData({ ...formData, deliveryAddress: e.target.value })}
                          placeholder="e.g. Victoria Island, Lagos or Store Pickup"
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Expected Delivery Date
                        </label>
                        <input
                          type="date"
                          value={formData.expectedDeliveryDate}
                          onChange={(e) => setFormData({ ...formData, expectedDeliveryDate: e.target.value })}
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Auto Add New Customer Toggle Option */}
                    {!selectedCustomerId && (
                      <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={autoAddCustomer}
                            onChange={(e) => setAutoAddCustomer(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span>Automatically register as a New Customer in Directory if not found</span>
                        </label>

                        {formData.customerName.trim() && (
                          <button
                            type="button"
                            onClick={() => {
                              const newCust = addCustomer({
                                name: formData.customerName.trim(),
                                phone: formData.customerPhone.trim(),
                                email: '',
                                address: formData.deliveryAddress.trim(),
                              });
                              if (newCust) {
                                setSelectedCustomerId(newCust.id);
                              }
                            }}
                            className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" /> Register Profile Now
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Product Items Table */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Catalog Items Ordered</label>
                      <button
                        type="button"
                        onClick={handleAddItemToOrder}
                        className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Item
                      </button>
                    </div>

                    {orderItems.some((item) => {
                      const p = getMatchedProduct(item.productId, item.sku, item.productName);
                      return p ? item.quantity > p.currentStock || p.currentStock <= 0 : false;
                    }) && (
                      <div className="mb-2 p-2.5 bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-900 rounded-xl flex items-center gap-2 text-xs font-bold text-rose-700 dark:text-rose-300">
                        <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                        <span>Inventory Limit Notice: Some items exceed available inventory stock or are out of stock. Adjust quantities to proceed.</span>
                      </div>
                    )}

                    {orderItems.length === 0 ? (
                      <div className="p-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-400">
                        No items added yet. Click "Add Item" above.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {orderItems.map((item, idx) => {
                          const matchedProd = getMatchedProduct(item.productId, item.sku, item.productName);
                          const meetsWholesale = matchedProd ? item.quantity >= matchedProd.minWholesaleQty : Boolean(item.isWholesale);
                          const availStock = matchedProd ? Math.max(0, matchedProd.currentStock) : undefined;
                          const hasStockIssue = matchedProd ? (availStock! <= 0 || item.quantity > availStock!) : false;

                          return (
                            <div key={idx} className={`bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border space-y-1.5 ${hasStockIssue ? 'border-rose-300 dark:border-rose-800 bg-rose-50/30' : 'border-slate-200 dark:border-slate-700/80'}`}>
                              <div className="flex items-center gap-2">
                                <select
                                  value={item.productId || ''}
                                  onChange={(e) => handleUpdateOrderItem(idx, 'productId', e.target.value)}
                                  className="flex-1 px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-white"
                                >
                                  {products.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} ({settings.currencySymbol}{p.retailPrice.toFixed(2)}) — Stock: {p.currentStock} {p.unit}
                                    </option>
                                  ))}
                                </select>

                                <input
                                  type="number"
                                  min="1"
                                  max={availStock !== undefined ? availStock : undefined}
                                  value={item.quantity}
                                  onChange={(e) => handleUpdateOrderItem(idx, 'quantity', parseInt(e.target.value, 10) || 1)}
                                  className={`w-16 px-2 py-1.5 bg-white dark:bg-slate-900 border rounded-lg text-xs font-bold text-center dark:text-white ${
                                    hasStockIssue
                                      ? 'border-rose-500 text-rose-600 dark:text-rose-400 font-black'
                                      : 'border-slate-200 dark:border-slate-700'
                                  }`}
                                  title={`Quantity (Available stock: ${availStock ?? 'N/A'})`}
                                />

                                <input
                                  type="number"
                                  step="0.01"
                                  value={item.unitPrice}
                                  onChange={(e) => handleUpdateOrderItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                                  className="w-20 px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-right dark:text-white"
                                  title="Unit Price"
                                />

                                <div className="w-20 text-right font-mono font-bold text-xs text-slate-900 dark:text-white">
                                  {settings.currencySymbol}{item.total.toFixed(2)}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleRemoveOrderItem(idx)}
                                  className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {/* Inventory Stock Badge & Wholesale Pricing Badges */}
                              <div className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px]">
                                <div>
                                  {matchedProd && (
                                    <div className="flex items-center gap-1.5 font-bold">
                                      {matchedProd.currentStock <= 0 ? (
                                        <span className="text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-950 px-1.5 py-0.5 rounded flex items-center gap-1 border border-rose-200 dark:border-rose-800">
                                          <AlertCircle className="w-3 h-3 shrink-0" /> Out of Stock (0 {matchedProd.unit})
                                        </span>
                                      ) : item.quantity > matchedProd.currentStock ? (
                                        <span className="text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-950 px-1.5 py-0.5 rounded flex items-center gap-1 border border-rose-200 dark:border-rose-800">
                                          <AlertCircle className="w-3 h-3 shrink-0" /> Exceeds Stock! Max: {matchedProd.currentStock} {matchedProd.unit}
                                        </span>
                                      ) : matchedProd.currentStock <= matchedProd.minimumStockLevel ? (
                                        <span className="text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                          Low Stock: {matchedProd.currentStock} {matchedProd.unit} left
                                        </span>
                                      ) : (
                                        <span className="text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                                          Stock Available: {matchedProd.currentStock} {matchedProd.unit}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {(meetsWholesale || item.isWholesale || item.useRetailPrice) && (
                                  <div className="flex items-center gap-1.5 ml-auto">
                                    {item.useRetailPrice ? (
                                      <span className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[9px] font-bold px-1.5 py-0.5 rounded">
                                        Wholesale Price Triggered (RP Override Active)
                                      </span>
                                    ) : (
                                      <span className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 text-[9px] font-bold px-1.5 py-0.5 rounded">
                                        Wholesale Price Triggered ({settings.currencySymbol}{matchedProd?.wholesalePrice.toFixed(2)})
                                      </span>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() => handleUpdateOrderItem(idx, 'useRetailPrice', !item.useRetailPrice)}
                                      className={`text-[9px] font-black px-2 py-0.5 rounded transition-all cursor-pointer border ${
                                        item.useRetailPrice
                                          ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-xs'
                                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600'
                                      }`}
                                      title={item.useRetailPrice ? "Click to revert to Wholesale Price" : "Override wholesale price and use Retail Price for this item"}
                                    >
                                      {item.useRetailPrice ? 'Use RP (Active)' : 'Use RP'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Financials & Deposits */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Discount Amount</label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.discount}
                          onChange={(e) => setFormData({ ...formData, discount: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Collect Delivery Fee ({settings.currencySymbol})
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.deliveryFee}
                          onChange={(e) => setFormData({ ...formData, deliveryFee: parseFloat(e.target.value) || 0 })}
                          placeholder="e.g. 1500"
                          className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-blue-600 dark:text-blue-400 font-bold"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Deposit Paid ({settings.currencySymbol})</label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.depositAmount}
                          onChange={(e) => setFormData({ ...formData, depositAmount: parseFloat(e.target.value) || 0 })}
                          placeholder="e.g. 50% deposit"
                          className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-emerald-600 dark:text-emerald-400 font-bold"
                        />
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-1.5 text-xs">
                      <div className="flex justify-between text-slate-600 dark:text-slate-400">
                        <span>Items Subtotal:</span>
                        <span className="font-mono">{settings.currencySymbol}{orderItems.reduce((acc, i) => acc + i.total, 0).toFixed(2)}</span>
                      </div>
                      {formData.discount > 0 && (
                        <div className="flex justify-between text-rose-600 dark:text-rose-400">
                          <span>Discount:</span>
                          <span className="font-mono">-{settings.currencySymbol}{(formData.discount || 0).toFixed(2)}</span>
                        </div>
                      )}
                      {formData.deliveryFee > 0 && (
                        <div className="flex justify-between text-blue-600 dark:text-blue-400 font-semibold">
                          <span>Collect Delivery Fee:</span>
                          <span className="font-mono">+{settings.currencySymbol}{(formData.deliveryFee || 0).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-slate-500">
                        <span>Tax / VAT:</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">Exempt ({settings.currencySymbol}0.00)</span>
                      </div>
                      <div className="flex justify-between items-center text-xs font-bold pt-1.5 border-t border-slate-200/80 dark:border-slate-700">
                        <span className="text-slate-900 dark:text-white font-extrabold">Calculated Total Pre-Order:</span>
                        <span className="text-sm font-black text-slate-900 dark:text-white font-mono">
                          {settings.currencySymbol}
                          {Math.max(
                            0,
                            orderItems.reduce((acc, i) => acc + i.total, 0) - (formData.discount || 0) + (formData.deliveryFee || 0)
                          ).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleCloseOrderModal}
                      className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={orderItems.length === 0}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-600/20"
                    >
                      {orderToEdit ? 'Save Order Changes' : 'Save WhatsApp Pre-Order'}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* CONVERT PRE-ORDER TO SALE MODAL */}
      {orderToConvert && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden p-6 space-y-5 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl font-bold">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-slate-900 dark:text-white text-base">Convert to Completed Sale</h3>
                <p className="text-xs text-slate-500">
                  Pre-Order #{orderToConvert.preOrderNo} • {orderToConvert.customerName}
                </p>
              </div>
              <button
                onClick={() => setOrderToConvert(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-100 dark:border-emerald-800/80 space-y-1 text-xs">
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Total Sale Value:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {settings.currencySymbol}{orderToConvert.totalAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Deposit Already Paid:</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {settings.currencySymbol}{orderToConvert.depositAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-slate-900 dark:text-white font-bold pt-1 border-t border-emerald-200 dark:border-emerald-800">
                <span>Remaining Settlement:</span>
                <span className="font-mono">
                  {settings.currencySymbol}{(orderToConvert.totalAmount - orderToConvert.depositAmount).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Sales Attribution / "Served By" Credit Options */}
            <div className="space-y-2 p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-emerald-500" />
                  <span>Invoice 'Served By' Credit Attribution</span>
                </label>
                <span className="text-[10px] font-semibold text-slate-500 bg-slate-200/60 dark:bg-slate-700/60 px-2 py-0.5 rounded-md">
                  Sales Credit
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Choose which team member receives primary salesperson credit on the final invoice:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAttributionOption('converter')}
                  className={`p-2.5 rounded-xl border text-left transition-all text-xs font-medium space-y-1 ${
                    attributionOption === 'converter'
                      ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1">
                    <span>Converting Cashier</span>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {currentUser?.displayName || 'Active Cashier'}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setAttributionOption('creator')}
                  className={`p-2.5 rounded-xl border text-left transition-all text-xs font-medium space-y-1 ${
                    attributionOption === 'creator'
                      ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1">
                    <span>Order Creator</span>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {orderToConvert.createdBy || 'WhatsApp Staff'}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setAttributionOption('custom')}
                  className={`p-2.5 rounded-xl border text-left transition-all text-xs font-medium space-y-1 ${
                    attributionOption === 'custom'
                      ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1">
                    <span>Custom Staff</span>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    Select Member
                  </div>
                </button>
              </div>

              {attributionOption === 'custom' && (
                <div className="pt-2">
                  <select
                    value={customAttributedStaff}
                    onChange={(e) => setCustomAttributedStaff(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white"
                  >
                    <option value="">Select Staff Member for Sales Credit...</option>
                    {users && users.length > 0 ? (
                      users.map((u) => (
                        <option key={u.id} value={u.displayName}>
                          {u.displayName} ({u.role})
                        </option>
                      ))
                    ) : (
                      <>
                        <option value={orderToConvert.createdBy}>{orderToConvert.createdBy} (Order Creator)</option>
                        <option value={currentUser?.displayName || 'Sales Staff'}>
                          {currentUser?.displayName || 'Sales Staff'} (Active Cashier)
                        </option>
                      </>
                    )}
                  </select>
                </div>
              )}

              <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-slate-900/60 p-2 rounded-lg border border-slate-200/60 dark:border-slate-800">
                <strong>Tracked Roles:</strong> Order Taker: <span className="font-bold text-slate-800 dark:text-slate-200">{orderToConvert.createdBy || 'WhatsApp Staff'}</span> • Converted Cashier: <span className="font-bold text-slate-800 dark:text-slate-200">{currentUser?.displayName || 'Sales Staff'}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Settlement Payment Method
              </label>
              <select
                value={conversionPaymentMethod}
                onChange={(e) => setConversionPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs dark:text-white font-semibold"
              >
                <option value="Mobile Transfer">Mobile Transfer (WhatsApp Pay / MoMo)</option>
                <option value="Bank Transfer">Direct Bank Transfer</option>
                <option value="Cash">Cash on Delivery / Pickup</option>
                <option value="Card">POS Card Terminal</option>
                <option value="Store Credit">Store Credit / Customer Balance</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Fulfillment / Dispatch Notes
              </label>
              <textarea
                rows={2}
                value={conversionNotes}
                onChange={(e) => setConversionNotes(e.target.value)}
                placeholder="e.g. Dispatched via courier bike. Tracking #10293"
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs dark:text-white"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setOrderToConvert(null)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmConversion}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-600/20"
              >
                Confirm & Record Sale
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      <ConfirmModal
        isOpen={!!orderToDelete}
        title="Delete WhatsApp Pre-Order"
        message={`Are you sure you want to delete Pre-Order #${orderToDelete?.preOrderNo} for ${orderToDelete?.customerName}? This action cannot be undone.`}
        confirmText="Delete Pre-Order"
        variant="danger"
        onClose={() => setOrderToDelete(null)}
        onConfirm={() => {
          if (orderToDelete) {
            deleteWhatsAppPreOrder(orderToDelete.id);
            setOrderToDelete(null);
          }
        }}
      />

      {/* Real-time Printable Invoice Modal */}
      {selectedReceiptSale && (
        <ReceiptModal
          sale={selectedReceiptSale}
          onClose={() => setSelectedReceiptSale(null)}
        />
      )}
    </div>
  );
};
