import React, { useState } from 'react';
import {
  Truck,
  Plus,
  CheckCircle,
  Clock,
  Search,
  X,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Trash2,
  Filter,
  PackageCheck,
  Building2,
  Boxes,
  Receipt,
  PlusCircle,
  MinusCircle,
  TrendingUp,
  AlertCircle,
  Edit2,
  Edit3,
  Building,
  Banknote,
  Printer,
  CheckCircle2,
  Send,
  FileCheck,
} from 'lucide-react';
import { LiquidAccountType } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { NairaSign } from '../common/NairaSign';
import { Pagination } from '../common/Pagination';
import { ConfirmModal } from '../common/ConfirmModal';
import { PurchaseOrder, PaymentMethod, PriceAdjustmentItem } from '../../types';
import { InspectStockModal } from './InspectStockModal';
import { GRNModal } from './GRNModal';
import { POPaymentModal } from './POPaymentModal';
import { PriceAdjustmentReportModal } from './PriceAdjustmentReportModal';
import { OrderNoteModal } from './OrderNoteModal';
import { ConfirmPlaceOrderModal } from './ConfirmPlaceOrderModal';
import { ProductSearchPicker, POItemFormState } from './ProductSearchPicker';
import { useInteractions } from '../../context/InteractionContext';
import { localIsoDate } from '../../shared/localDate';

type DeliveryTab = 'All' | 'Draft' | 'Pending' | 'Partial' | 'Received' | 'Cancelled';

export const PurchasesView: React.FC = () => {
  const {
    purchases,
    suppliers,
    products,
    sales,
    addPurchaseOrder,
    updateProduct,
    changeProductPrice,
    addNotification,
    updatePurchaseOrder,
    deletePurchaseOrder,
    settings,
    treasuryBalances,
    addMoneyMovement,
  } = useApp();
  const { currentUser, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const { notify, confirm } = useInteractions();

  // Filters & Tabs State
  const [activeTab, setActiveTab] = useState<DeliveryTab>('All');
  const [paymentFilter, setPaymentFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals State
  const [showAddModal, setShowAddModal] = useState(false);
  const [inspectingPo, setInspectingPo] = useState<PurchaseOrder | null>(null);
  const [grnPo, setGrnPo] = useState<PurchaseOrder | null>(null);
  const [priceReportPo, setPriceReportPo] = useState<PurchaseOrder | null>(null);
  const [payingPo, setPayingPo] = useState<PurchaseOrder | null>(null);
  const [editingPo, setEditingPo] = useState<PurchaseOrder | null>(null);

  // Draft Mode & Order Note Modals
  const [orderNotePo, setOrderNotePo] = useState<PurchaseOrder | null>(null);
  const [confirmPlacePo, setConfirmPlacePo] = useState<PurchaseOrder | null>(null);
  const [editingDraftPo, setEditingDraftPo] = useState<PurchaseOrder | null>(null);
  const [discardDraftPo, setDiscardDraftPo] = useState<PurchaseOrder | null>(null);
  const [draftNotes, setDraftNotes] = useState<string>('');

  const [editPoForm, setEditPoForm] = useState({
    poNumber: '',
    supplierId: '',
    expectedDelivery: '',
    supplierLogisticsFee: 0,
    localLogisticsFee: 0,
    notes: '',
  });

  // New PO Form State
  const [selectedSupplierId, setSelectedSupplierId] = useState(suppliers[0]?.id || '');
  const [poItems, setPoItems] = useState<POItemFormState[]>([]);
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  // Default delivery date is a LOCAL calendar date: the date input and every
  // consumer treat it as local, while toISOString() gave the UTC date (one day
  // earlier for anyone working before 01:00 WAT).
  const [expectedDelivery, setExpectedDelivery] = useState(
    () => localIsoDate(new Date(Date.now() + 86400000 * 5))
  );
  const [initialPaymentStatus, setInitialPaymentStatus] = useState<'Unpaid' | 'Paid'>('Unpaid');
  const [initialPaymentSource, setInitialPaymentSource] = useState<LiquidAccountType>('Biz Account');

  // Sales Price Adjustment Recommendation Modal
  const [showPriceAdjustmentModal, setShowPriceAdjustmentModal] = useState(false);
  const [priceAdjustmentItems, setPriceAdjustmentItems] = useState<PriceAdjustmentItem[]>([]);

  const isAdmin = currentUser?.role === 'Administrator';

  // Calculations for KPIs & Drafts
  const draftPOs = purchases.filter((po) => po.deliveryStatus === 'Draft');
  const draftPOsCount = draftPOs.length;
  const draftPOsValue = draftPOs.reduce((sum, po) => sum + po.totalAmount, 0);

  const officialPOs = React.useMemo(() => purchases.filter((po) => po.deliveryStatus !== 'Draft'), [purchases]);
  const totalPOsCount = purchases.length;
  const totalPOValue = React.useMemo(() => purchases.reduce((sum, po) => sum + po.totalAmount, 0), [purchases]);

  const pendingPOs = purchases.filter((po) => po.deliveryStatus === 'Pending' || po.deliveryStatus === 'Partial');
  const pendingUnitsCount = pendingPOs.reduce(
    (sum, po) =>
      sum +
      po.items.reduce((iSum, item) => iSum + Math.max(0, item.quantity - (item.receivedQuantity || 0)), 0),
    0
  );

  const unpaidTotal = React.useMemo(
    () => officialPOs.reduce((sum, po) => sum + Math.max(0, po.totalAmount - po.paidAmount), 0),
    [officialPOs],
  );
  const passedInspectionsCount = React.useMemo(
    () => purchases.filter((po) => po.inspectionStatus === 'Passed' || po.inspectionStatus === 'Passed with Exceptions').length,
    [purchases],
  );

  // Filtered Purchases list. Memoized: it was rebuilt on every render, so the
  // pagination memo below never hit and every keystroke re-filtered the list.
  const filteredPurchases = React.useMemo(() => purchases.filter((po) => {
    // Delivery status tab
    if (activeTab === 'Draft' && po.deliveryStatus !== 'Draft') return false;
    if (activeTab === 'Pending' && po.deliveryStatus !== 'Pending') return false;
    if (activeTab === 'Partial' && po.deliveryStatus !== 'Partial') return false;
    if (activeTab === 'Received' && po.deliveryStatus !== 'Received') return false;
    if (activeTab === 'Cancelled' && po.deliveryStatus !== 'Cancelled') return false;

    // Payment status filter
    if (paymentFilter !== 'All' && po.paymentStatus !== paymentFilter) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNumber = (po.poNumber || '').toLowerCase().includes(q);
      const matchSupplier = (po.supplierName || '').toLowerCase().includes(q);
      const matchItem = (po.items || []).some(
        (i) => (i.productName || '').toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q)
      );
      if (!matchNumber && !matchSupplier && !matchItem) return false;
    }

    return true;
  }), [purchases, activeTab, paymentFilter, searchQuery]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset page on filter changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, paymentFilter, searchQuery]);

  const totalPages = Math.ceil(filteredPurchases.length / pageSize) || 1;
  const paginatedPurchases = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredPurchases.slice(start, start + pageSize);
  }, [filteredPurchases, currentPage, pageSize]);

  // PO Creation & Draft handlers
  const handleOpenNewPO = () => {
    setEditingDraftPo(null);
    setSelectedSupplierId(suppliers[0]?.id || '');
    setPoItems([]);
    setDeliveryFee(0);
    setExpectedDelivery(new Date(Date.now() + 86400000 * 5).toISOString().split('T')[0]);
    setInitialPaymentStatus('Unpaid');
    setDraftNotes('');
    setShowAddModal(true);
  };

  const handleOpenEditDraft = (draft: PurchaseOrder) => {
    setEditingDraftPo(draft);
    setSelectedSupplierId(draft.supplierId || suppliers[0]?.id || '');
    setDeliveryFee(draft.deliveryFee || 0);
    setExpectedDelivery(draft.expectedDelivery || localIsoDate(new Date(Date.now() + 86400000 * 5)));
    setDraftNotes(draft.notes || '');
    setPoItems(
      draft.items.map((i) => {
        const p = products.find((pr) => pr.id === i.productId);
        return {
          productId: i.productId,
          quantity: i.quantity,
          unitCost: i.unitCost,
          updateCatalogCost: true,
          customRetailPrice: i.customRetailPrice ?? p?.retailPrice,
          updateCatalogRetailPrice: false,
        };
      })
    );
    setShowAddModal(true);
  };

  const handleDiscardDraft = (po: PurchaseOrder) => {
    deletePurchaseOrder(po.id, currentUser?.displayName || 'Purchaser');
    showToast({
      title: 'Draft Discarded',
      message: `Draft #${po.poNumber} has been deleted.`,
      type: 'info',
    });
    setDiscardDraftPo(null);
    if (editingDraftPo?.id === po.id) {
      setShowAddModal(false);
      setEditingDraftPo(null);
    }
  };

  const handleAddItem = (prodId: string, initialQty?: number) => {
    const prod = products.find((p) => p.id === prodId);
    if (!prod) return;
    const addQty = initialQty && initialQty > 0 ? initialQty : 10;

    setPoItems((prev) => {
      const existing = prev.find((i) => i.productId === prodId);
      if (existing) {
        return prev.map((i) =>
          i.productId === prodId ? { ...i, quantity: i.quantity + addQty } : i
        );
      }
      return [
        {
          productId: prodId,
          quantity: addQty,
          unitCost: prod.costPrice,
          updateCatalogCost: true,
          customRetailPrice: prod.retailPrice,
          updateCatalogRetailPrice: false,
        },
        ...prev,
      ];
    });
  };

  const handleUpdateItemQty = (prodId: string, qty: number) => {
    if (qty <= 0) {
      setPoItems((prev) => prev.filter((i) => i.productId !== prodId));
    } else {
      setPoItems((prev) => prev.map((i) => (i.productId === prodId ? { ...i, quantity: qty } : i)));
    }
  };

  const handleUpdateItemCost = (prodId: string, cost: number) => {
    setPoItems((prev) =>
      prev.map((i) => {
        if (i.productId !== prodId) return i;
        const prod = products.find((p) => p.id === prodId);
        const newCost = Math.max(0, cost);
        return {
          ...i,
          unitCost: newCost,
          updateCatalogCost: prod ? newCost !== prod.costPrice : true,
        };
      })
    );
  };

  const handleUpdateItemRetail = (prodId: string, retail: number) => {
    setPoItems((prev) =>
      prev.map((i) => {
        if (i.productId !== prodId) return i;
        const prod = products.find((p) => p.id === prodId);
        const newRetail = Math.max(0, retail);
        return {
          ...i,
          customRetailPrice: newRetail,
          updateCatalogRetailPrice: prod ? newRetail !== prod.retailPrice : false,
        };
      })
    );
  };

  const handleToggleUpdateCatalogCost = (prodId: string, val: boolean) => {
    setPoItems((prev) =>
      prev.map((i) => (i.productId === prodId ? { ...i, updateCatalogCost: val } : i))
    );
  };

  const handleToggleUpdateCatalogRetail = (prodId: string, val: boolean) => {
    setPoItems((prev) =>
      prev.map((i) => (i.productId === prodId ? { ...i, updateCatalogRetailPrice: val } : i))
    );
  };

  // Save changes to existing draft PO
  const handleSaveDraftChanges = (openNoteAfter: boolean = false) => {
    if (!editingDraftPo) return;
    if (poItems.length === 0) {
      notify('Please add at least one product item.', 'Purchase order is empty');
      return;
    }

    const sup = suppliers.find((s) => s.id === selectedSupplierId);
    const itemsFormatted = poItems.map((item) => {
      const prod = products.find((p) => p.id === item.productId);
      return {
        productId: item.productId,
        productName: prod?.name || 'Item',
        sku: prod?.sku || 'SKU',
        quantity: item.quantity,
        unitCost: item.unitCost,
        oldUnitCost: prod?.costPrice ?? item.unitCost,
        customRetailPrice: item.customRetailPrice ?? prod?.retailPrice,
        oldRetailPrice: prod?.retailPrice ?? 0,
        total: item.quantity * item.unitCost,
        receivedQuantity: 0,
        acceptedQuantity: 0,
        damagedQuantity: 0,
      };
    });

    const itemsSubtotal = itemsFormatted.reduce((acc, i) => acc + i.total, 0);
    const validDeliveryFee = Math.max(0, deliveryFee || 0);
    const grandTotal = itemsSubtotal + validDeliveryFee;

    const updatedDraft: Partial<PurchaseOrder> = {
      supplierId: selectedSupplierId || editingDraftPo.supplierId,
      supplierName: sup?.name || editingDraftPo.supplierName,
      items: itemsFormatted,
      deliveryFee: validDeliveryFee,
      totalAmount: grandTotal,
      expectedDelivery,
      notes: draftNotes.trim(),
      updatedAt: new Date().toISOString(),
    };

    updatePurchaseOrder(editingDraftPo.id, updatedDraft, currentUser?.displayName || 'Purchasing Officer');

    const fullUpdatedPo: PurchaseOrder = {
      ...editingDraftPo,
      ...updatedDraft,
    } as PurchaseOrder;

    setShowAddModal(false);
    const currentDraftPo = editingDraftPo;
    setEditingDraftPo(null);
    setPoItems([]);
    setDeliveryFee(0);
    setDraftNotes('');

    showToast({
      title: 'Draft Adjustments Saved',
      message: `Draft #${currentDraftPo.poNumber} has been updated.`,
      type: 'success',
    });

    if (openNoteAfter) {
      setOrderNotePo(fullUpdatedPo);
    }
  };

  const handleSaveAndPlaceOfficialOrder = () => {
    if (!editingDraftPo) return;
    if (poItems.length === 0) {
      notify('Please add at least one product item.', 'Purchase order is empty');
      return;
    }

    const sup = suppliers.find((s) => s.id === selectedSupplierId);
    const itemsFormatted = poItems.map((item) => {
      const prod = products.find((p) => p.id === item.productId);
      return {
        productId: item.productId,
        productName: prod?.name || 'Item',
        sku: prod?.sku || 'SKU',
        quantity: item.quantity,
        unitCost: item.unitCost,
        oldUnitCost: prod?.costPrice ?? item.unitCost,
        customRetailPrice: item.customRetailPrice ?? prod?.retailPrice,
        oldRetailPrice: prod?.retailPrice ?? 0,
        total: item.quantity * item.unitCost,
        receivedQuantity: 0,
        acceptedQuantity: 0,
        damagedQuantity: 0,
      };
    });

    const itemsSubtotal = itemsFormatted.reduce((acc, i) => acc + i.total, 0);
    const validDeliveryFee = Math.max(0, deliveryFee || 0);
    const grandTotal = itemsSubtotal + validDeliveryFee;

    const updatedDraft: Partial<PurchaseOrder> = {
      supplierId: selectedSupplierId || editingDraftPo.supplierId,
      supplierName: sup?.name || editingDraftPo.supplierName,
      items: itemsFormatted,
      deliveryFee: validDeliveryFee,
      totalAmount: grandTotal,
      expectedDelivery,
      notes: draftNotes.trim(),
      updatedAt: new Date().toISOString(),
    };

    updatePurchaseOrder(editingDraftPo.id, updatedDraft, currentUser?.displayName || 'Purchasing Officer');

    const fullUpdatedPo: PurchaseOrder = {
      ...editingDraftPo,
      ...updatedDraft,
    } as PurchaseOrder;

    setShowAddModal(false);
    setEditingDraftPo(null);
    setPoItems([]);
    setDeliveryFee(0);
    setDraftNotes('');

    // Open confirmation modal to finalize placement
    setConfirmPlacePo(fullUpdatedPo);
  };

  const handleCreatePO = (isDraftMode: boolean = false) => {
    if (poItems.length === 0) {
      notify('Please add at least one product item to the purchase order.', 'Purchase order is empty');
      return;
    }

    // If editing existing draft:
    if (editingDraftPo) {
      handleSaveDraftChanges(isDraftMode);
      return;
    }

    const poNum = `PO-${new Date().getFullYear()}-${Math.floor(Math.random() * 899 + 100)}`;
    const sup = suppliers.find((s) => s.id === selectedSupplierId);
    const itemsFormatted = poItems.map((item) => {
      const prod = products.find((p) => p.id === item.productId);
      return {
        productId: item.productId,
        productName: prod?.name || 'Item',
        sku: prod?.sku || 'SKU',
        quantity: item.quantity,
        unitCost: item.unitCost,
        oldUnitCost: prod?.costPrice ?? item.unitCost,
        customRetailPrice: item.customRetailPrice ?? prod?.retailPrice,
        oldRetailPrice: prod?.retailPrice ?? 0,
        total: item.quantity * item.unitCost,
        receivedQuantity: 0,
        acceptedQuantity: 0,
        damagedQuantity: 0,
      };
    });

    const itemsSubtotal = itemsFormatted.reduce((acc, i) => acc + i.total, 0);
    const validDeliveryFee = Math.max(0, deliveryFee || 0);
    const grandTotal = itemsSubtotal + validDeliveryFee;

    const newPOData: Omit<PurchaseOrder, 'id' | 'createdAt'> = {
      poNumber: poNum,
      supplierId: selectedSupplierId || suppliers[0]?.id || 'sup-gen',
      supplierName: sup?.name || 'Supplier Vendor',
      items: itemsFormatted,
      deliveryFee: validDeliveryFee,
      totalAmount: grandTotal,
      paidAmount: (!isDraftMode && initialPaymentStatus === 'Paid') ? grandTotal : 0,
      paymentStatus: (!isDraftMode && initialPaymentStatus === 'Paid') ? 'Paid' : 'Unpaid',
      deliveryStatus: isDraftMode ? 'Draft' : 'Pending',
      isDraft: isDraftMode,
      expectedDelivery,
      createdBy: currentUser?.displayName || 'Purchasing Officer',
      inspectionStatus: isDraftMode ? undefined : 'Pending',
      notes: draftNotes.trim() || (isDraftMode ? 'Draft mock purchase order for supplier inquiry & price check' : undefined),
    };

    addPurchaseOrder(newPOData);

    if (isDraftMode) {
      setShowAddModal(false);
      setPoItems([]);
      setDeliveryFee(0);
      setDraftNotes('');

      const draftObj: PurchaseOrder = {
        ...newPOData,
        id: 'draft-' + Date.now(),
        createdAt: new Date().toISOString(),
      };

      setOrderNotePo(draftObj);
      showToast({
        title: 'Draft PO Saved',
        message: `Draft #${poNum} created. You can print or share the Order Note now.`,
        type: 'success',
      });
      return;
    }

    // Official order prepayment logic
    if (initialPaymentStatus === 'Paid' && grandTotal > 0) {
      addMoneyMovement({
        date: new Date().toISOString(),
        type: 'Supplier Payment',
        subtype: `PO #${poNum}`,
        sourceAccount: initialPaymentSource,
        amount: grandTotal,
        referenceNo: poNum,
        performedBy: currentUser?.displayName || 'Purchasing Officer',
        notes: `Initial prepayment for PO #${poNum} to ${sup?.name || 'Supplier'} from ${initialPaymentSource}`,
      });
    }

    // Check cost price & retail price updates
    const priceIncreasedList: PriceAdjustmentItem[] = [];

    poItems.forEach((item) => {
      const prod = products.find((p) => p.id === item.productId);
      if (!prod) return;

      // Update catalog retail price if user modified it and requested catalog update
      if (
        item.customRetailPrice !== undefined &&
        item.customRetailPrice !== prod.retailPrice &&
        item.updateCatalogRetailPrice
      ) {
        changeProductPrice(
          prod.id,
          item.customRetailPrice,
          'Retail',
          `Retail price updated during PO creation (${poNum})`,
          currentUser?.displayName || 'Admin'
        );
      }

      if (item.updateCatalogCost && item.unitCost !== prod.costPrice) {
        // Update product cost price in catalog
        updateProduct(
          prod.id,
          { costPrice: item.unitCost },
          `PO Cost Price updated from ${settings.currencySymbol}${prod.costPrice.toFixed(2)} to ${settings.currencySymbol}${item.unitCost.toFixed(2)}`
        );

        // Check if cost price increased and user hasn't already adjusted retail price to compensate
        const newRetail = item.customRetailPrice ?? prod.retailPrice;
        if (item.unitCost > prod.costPrice && !item.updateCatalogRetailPrice) {
          addNotification({
            title: 'Cost Price Increase Alert',
            message: `Cost price for "${prod.name}" increased from ${settings.currencySymbol}${prod.costPrice.toFixed(2)} to ${settings.currencySymbol}${item.unitCost.toFixed(2)}. Adjust selling prices for optimum profit margin.`,
            type: 'price_increase_alert',
          });

          // Estimate suggested selling price maintaining previous margin %
          const costRatio = prod.costPrice > 0 ? item.unitCost / prod.costPrice : 1.2;
          const suggestedRetail = Math.ceil(prod.retailPrice * costRatio);
          const suggestedWholesale = Math.ceil(prod.wholesalePrice * costRatio);

          priceIncreasedList.push({
            productId: prod.id,
            productName: prod.name,
            sku: prod.sku,
            oldCost: prod.costPrice,
            newCost: item.unitCost,
            oldRetail: newRetail,
            newRetail: Math.max(suggestedRetail, newRetail),
            oldWholesale: prod.wholesalePrice,
            newWholesale: suggestedWholesale,
          });
        }
      }
    });

    setShowAddModal(false);
    setPoItems([]);
    setDeliveryFee(0);
    setDraftNotes('');

    showToast({
      title: 'Purchase Order Issued',
      message: `PO #${poNum} has been officially issued.`,
      type: 'success',
    });

    // If any items had cost increases, open the Sales Price Adjustment Recommendation Modal
    if (priceIncreasedList.length > 0) {
      setPriceAdjustmentItems(priceIncreasedList);
      setShowPriceAdjustmentModal(true);
    }
  };

  const handleApplySalesPriceChanges = () => {
    priceAdjustmentItems.forEach((item) => {
      if (item.newRetail !== item.oldRetail) {
        changeProductPrice(
          item.productId,
          item.newRetail,
          'Retail',
          `Adjusted for optimum profit margin after cost price increase (${settings.currencySymbol}${item.oldCost} → ${settings.currencySymbol}${item.newCost})`,
          currentUser?.displayName || 'Admin'
        );
      }
      if (item.newWholesale !== item.oldWholesale) {
        changeProductPrice(
          item.productId,
          item.newWholesale,
          'Wholesale',
          `Adjusted for optimum profit margin after cost price increase (${settings.currencySymbol}${item.oldCost} → ${settings.currencySymbol}${item.newCost})`,
          currentUser?.displayName || 'Admin'
        );
      }
    });

    setShowPriceAdjustmentModal(false);
    setPriceAdjustmentItems([]);
  };

  const handleDeletePO = async (po: PurchaseOrder) => {
    if (await confirm({ title: 'Remove purchase order', message: `Cancel and remove purchase order ${po.poNumber}?`, confirmText: 'Remove order', variant: 'danger' })) {
      deletePurchaseOrder(po.id, currentUser?.displayName || 'Admin');
    }
  };

  const openPurchaseOrderEditor = (po: PurchaseOrder) => {
    if (!isSuperAdmin) return;
    setEditingPo(po);
    setEditPoForm({
      poNumber: po.poNumber,
      supplierId: po.supplierId,
      expectedDelivery: po.expectedDelivery,
      supplierLogisticsFee: po.deliveryFee || 0,
      localLogisticsFee: po.localLogisticsFee || 0,
      notes: po.notes || '',
    });
  };

  const handleSavePurchaseOrderEdits = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isSuperAdmin || !editingPo) return;

    const supplier = suppliers.find((item) => item.id === editPoForm.supplierId);
    const supplierLogisticsFee = Math.max(0, editPoForm.supplierLogisticsFee || 0);
    const localLogisticsFee = Math.max(0, editPoForm.localLogisticsFee || 0);
    const itemsSubtotal = editingPo.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    const totalAmount = itemsSubtotal + supplierLogisticsFee;
    const paidAmount = Math.min(editingPo.paidAmount, totalAmount);
    const paymentStatus: PurchaseOrder['paymentStatus'] = paidAmount >= totalAmount
      ? 'Paid'
      : paidAmount > 0
      ? 'Partial'
      : 'Unpaid';

    updatePurchaseOrder(
      editingPo.id,
      {
        poNumber: editPoForm.poNumber.trim() || editingPo.poNumber,
        supplierId: editPoForm.supplierId,
        supplierName: supplier?.name || editingPo.supplierName,
        expectedDelivery: editPoForm.expectedDelivery,
        deliveryFee: supplierLogisticsFee,
        localLogisticsFee,
        totalAmount,
        paidAmount,
        paymentStatus,
        notes: editPoForm.notes.trim(),
        updatedAt: new Date().toISOString(),
      },
      currentUser?.displayName || 'Aidy Mike'
    );
    setEditingPo(null);
  };

  const handleConfirmPlaceOrder = async (
    po: PurchaseOrder,
    paymentStatus: 'Paid' | 'Unpaid',
    paymentSource?: LiquidAccountType,
    notes?: string
  ) => {
    const isPaid = paymentStatus === 'Paid';
    const paidAmount = isPaid ? po.totalAmount : 0;

    // Prepayment deduction if marked paid
    if (isPaid && po.totalAmount > 0 && paymentSource) {
      addMoneyMovement({
        date: new Date().toISOString(),
        type: 'Supplier Payment',
        subtype: `PO #${po.poNumber}`,
        sourceAccount: paymentSource,
        amount: po.totalAmount,
        referenceNo: po.poNumber,
        performedBy: currentUser?.displayName || 'Purchasing Officer',
        notes: `Initial prepayment for placed PO #${po.poNumber} to ${po.supplierName} from ${paymentSource}`,
      });
    }

    updatePurchaseOrder(
      po.id,
      {
        deliveryStatus: 'Pending',
        isDraft: false,
        paymentStatus,
        paidAmount,
        notes: notes !== undefined ? notes : po.notes,
        inspectionStatus: 'Pending',
        supplierConfirmedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      currentUser?.displayName || 'Purchasing Officer'
    );

    setConfirmPlacePo(null);

    showToast({
      title: 'Order Placed Officially',
      message: `PO #${po.poNumber} has been placed with ${po.supplierName}. Status is now Pending delivery.`,
      type: 'success',
    });
  };

  return (
    <div className="space-y-6 pb-16 text-slate-900 dark:text-white">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2.5">
            <Truck className="w-7 h-7 text-blue-600 dark:text-blue-400" />
            <span>Purchase Orders & Stock Receiving</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Issue Purchase Orders (POs), perform physical stock receiving inspections, verify quality, and manage supplier accounts payable.
          </p>
        </div>

        <button
          onClick={handleOpenNewPO}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-2xl text-xs shadow-md transition-all hover:scale-[1.02] shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Purchase Order</span>
        </button>
      </div>

      {/* Quick Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        
        {/* KPI 1: Total PO Volume */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center shrink-0">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Purchase Orders</p>
            <h3 className="text-xl font-black">
              {totalPOsCount} <span className="text-xs font-normal text-slate-400">({settings.currencySymbol}{totalPOValue.toLocaleString('en-US', { minimumFractionDigits: 2 })})</span>
            </h3>
          </div>
        </div>

        {/* KPI 2: Draft Mock Orders */}
        <div
          onClick={() => setActiveTab('Draft')}
          className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-4 cursor-pointer hover:border-amber-400/80 transition-all group"
          title="Click to view Draft Inquiries"
        >
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>Draft Inquiries</span>
              {draftPOsCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              )}
            </p>
            <h3 className="text-xl font-black text-amber-600 dark:text-amber-400">
              {draftPOsCount} <span className="text-xs font-normal text-slate-400">({settings.currencySymbol}{draftPOsValue.toLocaleString('en-US', { minimumFractionDigits: 2 })})</span>
            </h3>
          </div>
        </div>

        {/* KPI 3: Pending Deliveries */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Pending Receiving</p>
            <h3 className="text-xl font-black text-indigo-600 dark:text-indigo-400">
              {pendingPOs.length} POs <span className="text-xs font-semibold text-slate-400">({pendingUnitsCount} units)</span>
            </h3>
          </div>
        </div>

        {/* KPI 4: Quality Inspected Stock */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">QA Passed POs</p>
            <h3 className="text-xl font-black text-emerald-600 dark:text-emerald-400">
              {passedInspectionsCount} <span className="text-xs font-normal text-slate-400">orders</span>
            </h3>
          </div>
        </div>

        {/* KPI 5: Unpaid Payables */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center shrink-0">
            <NairaSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Unpaid Payables</p>
            <h3 className="text-xl font-black text-rose-600 dark:text-rose-400">
              {settings.currencySymbol}{unpaidTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </h3>
          </div>
        </div>

      </div>

      {/* Tabs & Search Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
        
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          
          {/* Delivery Status Tab Pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            {(['All', 'Draft', 'Pending', 'Partial', 'Received', 'Cancelled'] as DeliveryTab[]).map((tab) => {
              const count = tab === 'Draft' ? draftPOsCount : undefined;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                    activeTab === tab
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <span>{tab === 'All' ? 'All Orders' : tab === 'Draft' ? 'Drafts' : tab}</span>
                  {count !== undefined && count > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                        activeTab === tab
                          ? 'bg-white/20 text-white'
                          : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search & Payment Filter Controls */}
          <div className="flex flex-1 flex-wrap sm:flex-nowrap items-center gap-3 w-full md:w-auto">
            
            <div className="relative min-w-48 flex-1 w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search PO #, supplier, item, SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-500 rounded-xl text-xs font-medium focus:outline-none"
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

            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-transparent">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="bg-transparent text-xs font-bold focus:outline-none"
              >
                <option value="All">All Payment Status</option>
                <option value="Paid">Paid</option>
                <option value="Partial">Partial</option>
                <option value="Unpaid">Unpaid</option>
                <option value="Overdue">Overdue</option>
              </select>
            </div>

          </div>

        </div>

      </div>

      {/* Main Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-extrabold">
              <tr>
                <th className="py-3.5 px-4">PO Number & Date</th>
                <th className="py-3.5 px-3">Supplier Vendor</th>
                <th className="py-3.5 px-3">Line Items Summary</th>
                <th className="py-3.5 px-3">Order Amount</th>
                <th className="py-3.5 px-3">Delivery Status</th>
                <th className="py-3.5 px-3">QA Inspection</th>
                <th className="py-3.5 px-3">Payment Status</th>
                <th className="py-3.5 px-4 text-right">Stock Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-medium">
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Truck className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="font-bold text-sm">No Purchase Orders Found</p>
                    <p className="text-xs">Try adjusting your search criteria or create a new PO.</p>
                  </td>
                </tr>
              ) : (
                paginatedPurchases.map((po) => {
                  const remainingPayment = Math.max(0, po.totalAmount - po.paidAmount);
                  const totalOrderedQty = po.items.reduce((sum, i) => sum + i.quantity, 0);
                  const totalReceivedQty = po.items.reduce((sum, i) => sum + (i.receivedQuantity || 0), 0);

                  return (
                    <tr key={po.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      
                      {/* PO Number */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold font-mono text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                          <span>{po.poNumber}</span>
                          {po.deliveryStatus === 'Draft' ? (
                            <span className="text-[9px] px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80 font-bold rounded-md flex items-center gap-0.5">
                              <FileText className="w-2.5 h-2.5" />
                              <span>Draft</span>
                            </span>
                          ) : po.grnNumber ? (
                            <span className="text-[9px] px-1.5 py-0.5 bg-blue-50 dark:bg-blue-950 text-blue-600 font-normal rounded-md">
                              {po.grnNumber}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {new Date(po.createdAt).toLocaleDateString()} • {po.createdBy}
                        </p>
                      </td>

                      {/* Supplier */}
                      <td className="py-3.5 px-3">
                        <p className="font-bold text-slate-900 dark:text-white">{po.supplierName}</p>
                        <p className="text-[10px] text-slate-400">Exp: {po.expectedDelivery}</p>
                      </td>

                      {/* Line Items Summary */}
                      <td className="py-3.5 px-3">
                        <p className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-xs">
                          {po.items[0]?.productName || 'Line Items'}
                          {po.items.length > 1 && ` +${po.items.length - 1} more`}
                        </p>
                        <p className="text-[10px] font-mono text-slate-400">
                          {po.deliveryStatus === 'Draft' ? (
                            <span>{po.items.length} product lines • {totalOrderedQty} mock units</span>
                          ) : (
                            <span>Units: <strong className="text-slate-700 dark:text-slate-300">{totalReceivedQty}/{totalOrderedQty}</strong> received</span>
                          )}
                        </p>
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-3">
                        <p className="font-black text-slate-900 dark:text-white font-mono">
                          {settings.currencySymbol}{po.totalAmount.toFixed(2)}
                        </p>
                        {po.deliveryFee && po.deliveryFee > 0 ? (
                          <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                            Supplier logistics: {settings.currencySymbol}{po.deliveryFee.toFixed(2)}
                          </p>
                        ) : null}
                        {po.localLogisticsFee && po.localLogisticsFee > 0 ? (
                          <p className="text-[10px] text-violet-600 dark:text-violet-400 font-medium">
                            Local logistics: {settings.currencySymbol}{po.localLogisticsFee.toFixed(2)}
                          </p>
                        ) : null}
                        {po.deliveryStatus !== 'Draft' && remainingPayment > 0 && (
                          <p className="text-[10px] text-rose-500 font-semibold">
                            Due: {settings.currencySymbol}{remainingPayment.toFixed(2)}
                          </p>
                        )}
                      </td>

                      {/* Delivery Status */}
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold ${
                            po.deliveryStatus === 'Draft'
                              ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80'
                              : po.deliveryStatus === 'Received'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              : po.deliveryStatus === 'Partial'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : po.deliveryStatus === 'Cancelled'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {po.deliveryStatus === 'Draft' && <FileText className="w-3 h-3 text-amber-600 dark:text-amber-400" />}
                          {po.deliveryStatus === 'Received' && <CheckCircle className="w-3 h-3" />}
                          {po.deliveryStatus === 'Partial' && <Clock className="w-3 h-3" />}
                          {po.deliveryStatus === 'Pending' && <Clock className="w-3 h-3" />}
                          <span>{po.deliveryStatus === 'Draft' ? 'Draft Inquiry' : po.deliveryStatus}</span>
                        </span>
                      </td>

                      {/* QA Inspection Status */}
                      <td className="py-3.5 px-3">
                        {po.deliveryStatus === 'Draft' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            <span>Draft Stage</span>
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold ${
                              po.inspectionStatus === 'Passed'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : po.inspectionStatus === 'Passed with Exceptions'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : po.inspectionStatus === 'Failed'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {po.inspectionStatus === 'Passed' && <ShieldCheck className="w-3 h-3" />}
                            {po.inspectionStatus === 'Passed with Exceptions' && <AlertTriangle className="w-3 h-3" />}
                            <span>{po.inspectionStatus || 'Pending QA'}</span>
                          </span>
                        )}
                      </td>

                      {/* Payment Status */}
                      <td className="py-3.5 px-3">
                        {po.deliveryStatus === 'Draft' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            <span>Draft (Unissued)</span>
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold ${
                              po.paymentStatus === 'Paid'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : po.paymentStatus === 'Partial'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            <span>{po.paymentStatus}</span>
                          </span>
                        )}
                      </td>

                      {/* Stock Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          
                          {/* DRAFT SPECIFIC ACTIONS */}
                          {po.deliveryStatus === 'Draft' ? (
                            <>
                              {/* Order Note (Print & Export) */}
                              <button
                                onClick={() => setOrderNotePo(po)}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11px] rounded-xl shadow-xs transition-colors"
                                title="Print / Export Supplier Order Note to confirm price and availability"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>Order Note</span>
                              </button>

                              {/* Adjust Draft */}
                              <button
                                onClick={() => handleOpenEditDraft(po)}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[11px] rounded-xl transition-colors"
                                title="Adjust line items, quantities, or prices in this draft"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Adjust</span>
                              </button>

                              {/* Place Order */}
                              <button
                                onClick={() => setConfirmPlacePo(po)}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] rounded-xl shadow-xs transition-colors"
                                title="Finalize and place official Purchase Order"
                              >
                                <Truck className="w-3.5 h-3.5" />
                                <span>Place Order</span>
                              </button>

                              {/* Discard Draft */}
                              <button
                                onClick={() => setDiscardDraftPo(po)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition-colors"
                                title="Discard this draft order"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              {/* Print Order Note for Official PO */}
                              <button
                                onClick={() => setOrderNotePo(po)}
                                className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl transition-colors"
                                title="Print / Export Order Note"
                              >
                                <Printer className="w-4 h-4" />
                              </button>

                              {/* Inspect & Receive Button */}
                              {po.deliveryStatus !== 'Received' && (
                                <button
                                  onClick={() => setInspectingPo(po)}
                                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded-xl shadow-2xs transition-colors"
                                  title="Inspect & Receive Delivery Stock"
                                >
                                  <PackageCheck className="w-3.5 h-3.5" />
                                  <span>Inspect & Receive</span>
                                </button>
                              )}

                              {/* View GRN Button */}
                              {(po.deliveryStatus === 'Received' || po.inspectionStatus) && (
                                <button
                                  onClick={() => setGrnPo(po)}
                                  className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl transition-colors"
                                  title="View Goods Received Note (GRN) Certificate"
                                >
                                  <FileText className="w-4 h-4" />
                                </button>
                              )}

                              {/* Price Adjustment Report Button */}
                              {(po.deliveryStatus === 'Received' || po.inspectionStatus) && (
                                <button
                                  onClick={() => setPriceReportPo(po)}
                                  className="p-1.5 bg-amber-50 dark:bg-amber-950/80 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 rounded-xl transition-colors border border-amber-200/60 dark:border-amber-800/60"
                                  title="View Price Adjustment Report"
                                >
                                  <TrendingUp className="w-4 h-4" />
                                </button>
                              )}

                              {/* Record Payment Button */}
                              {remainingPayment > 0 && (
                                <button
                                  onClick={() => setPayingPo(po)}
                                  className="p-1.5 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 rounded-xl transition-colors"
                                  title="Record Supplier Payment"
                                >
                                  <NairaSign className="w-4 h-4" />
                                </button>
                              )}

                              {/* Edit PO Button */}
                              {isSuperAdmin && (
                                <button
                                  onClick={() => openPurchaseOrderEditor(po)}
                                  className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-xl transition-colors"
                                  title="Edit Purchase Order (Super Admin Only)"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                              )}

                              {/* Delete PO Button */}
                              {isAdmin && (
                                <button
                                  onClick={() => handleDeletePO(po)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition-colors"
                                  title="Cancel / Delete Purchase Order"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}

                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={filteredPurchases.length}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          itemLabel="purchase orders"
        />
      </div>

      {editingPo && isSuperAdmin && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-2xl w-full p-6 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-600" />
                  <h3 className="font-extrabold text-base">Edit Purchase Order</h3>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">Super Admin only · changes are included in the next D1 sync.</p>
              </div>
              <button type="button" onClick={() => setEditingPo(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePurchaseOrderEdits} className="space-y-5 pt-5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1">PO Number</label>
                  <input required value={editPoForm.poNumber} onChange={(event) => setEditPoForm((form) => ({ ...form, poNumber: event.target.value }))} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-mono font-bold" />
                </div>
                <div>
                  <label className="block font-bold mb-1">Expected Delivery</label>
                  <input type="date" required value={editPoForm.expectedDelivery} onChange={(event) => setEditPoForm((form) => ({ ...form, expectedDelivery: event.target.value }))} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold" />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">Supplier</label>
                <select value={editPoForm.supplierId} onChange={(event) => setEditPoForm((form) => ({ ...form, supplierId: event.target.value }))} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold">
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50/70 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/50 rounded-2xl">
                  <label className="block font-bold mb-1 text-blue-900 dark:text-blue-200">Supplier Logistics ({settings.currencySymbol})</label>
                  <input type="number" min="0" step="0.01" value={editPoForm.supplierLogisticsFee || ''} onChange={(event) => setEditPoForm((form) => ({ ...form, supplierLogisticsFee: Number(event.target.value) || 0 }))} className="w-full p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-blue-200 dark:border-blue-800 font-mono font-bold" placeholder="0.00" />
                  <p className="text-[10px] text-slate-500 mt-1">Paid to the supplier and included in the PO payable total.</p>
                </div>
                <div className="p-4 bg-violet-50/70 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/50 rounded-2xl">
                  <label className="block font-bold mb-1 text-violet-900 dark:text-violet-200">Local Logistics ({settings.currencySymbol})</label>
                  <input type="number" min="0" step="0.01" value={editPoForm.localLogisticsFee || ''} onChange={(event) => setEditPoForm((form) => ({ ...form, localLogisticsFee: Number(event.target.value) || 0 }))} className="w-full p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-violet-200 dark:border-violet-800 font-mono font-bold" placeholder="0.00" />
                  <p className="text-[10px] text-slate-500 mt-1">Tracked separately from the amount owed to the supplier.</p>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="font-bold text-slate-500">Recalculated supplier payable</span>
                <span className="font-black font-mono text-base">{settings.currencySymbol}{(editingPo.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0) + Math.max(0, editPoForm.supplierLogisticsFee || 0)).toFixed(2)}</span>
              </div>

              <div>
                <label className="block font-bold mb-1">Order Notes</label>
                <textarea rows={4} value={editPoForm.notes} onChange={(event) => setEditPoForm((form) => ({ ...form, notes: event.target.value }))} className="w-full p-3 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 resize-none" placeholder="Supplier terms, shipment reference, delivery instructions, or adjustment reason..." />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingPo(null)} className="px-4 py-2.5 font-bold text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl shadow-xs">Save PO Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1: Create Purchase Order Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-2xl w-full p-6 my-auto max-h-[92vh] flex flex-col space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start border-b border-slate-100 dark:border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${
                  editingDraftPo
                    ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400'
                    : 'bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400'
                }`}>
                  {editingDraftPo ? <FileText className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-black text-slate-900 dark:text-white text-base leading-tight">
                    {editingDraftPo ? `Adjust Draft Order (${editingDraftPo.poNumber})` : 'Create Purchase Order (PO)'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {editingDraftPo
                      ? 'Adjust mock quantities or prices before confirming with your supplier or placing into the system.'
                      : 'Set up a mock purchase order draft for supplier quotation or directly issue an official PO.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingDraftPo(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleCreatePO(false); }} className="flex-1 flex flex-col min-h-0 space-y-4 text-xs">
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">Select Vendor Supplier *</label>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">Expected Delivery Date *</label>
                  <input
                    type="date"
                    required
                    value={expectedDelivery}
                    onChange={(e) => setExpectedDelivery(e.target.value)}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Delivery Fee Input */}
              <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/50 rounded-2xl space-y-1">
                <label className="block font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-blue-600" />
                  <span>Supplier Delivery / Logistics Charges ({settings.currencySymbol})</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={deliveryFee || ''}
                  onChange={(e) => setDeliveryFee(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-full p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 font-mono font-bold"
                />
                <p className="text-[10px] text-slate-500">
                  Optional delivery fee paid directly to the supplier for freight or logistics services.
                </p>
              </div>

              {/* Supplier Inquiry / Quotation Notes */}
              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                  Supplier Inquiry & Confirmation Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  placeholder="e.g. Please confirm unit price and stock availability before Thursday..."
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 resize-none font-medium text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Interactive Searchable Product Picker */}
              <div>
                <label className="block font-bold mb-1.5 text-slate-800 dark:text-slate-200">
                  Search & Add Product Line Items
                </label>
                <ProductSearchPicker
                  products={products}
                  sales={sales}
                  poItems={poItems}
                  onAddItem={handleAddItem}
                  currencySymbol={settings.currencySymbol}
                />
              </div>

              {/* Items Queue */}
              <div className="space-y-3 border-t border-b border-slate-100 dark:border-slate-800 py-3 max-h-72 overflow-y-auto">
                <p className="font-bold text-slate-400 uppercase text-[10px]">Order Items List ({poItems.length}):</p>
                {poItems.length === 0 ? (
                  <p className="text-slate-400 italic text-center py-4">No items added yet. Select products above.</p>
                ) : (
                  poItems.map((item) => {
                    const p = products.find((pr) => pr.id === item.productId);
                    const isPriceMismatch = p && item.unitCost !== p.costPrice;
                    const isCostHigher = p && item.unitCost > p.costPrice;

                    const currentRetail = item.customRetailPrice ?? (p?.retailPrice || 0);
                    const unitProfit = currentRetail - item.unitCost;
                    const lineGrossProfit = unitProfit * item.quantity;
                    const marginPct = currentRetail > 0 ? (unitProfit / currentRetail) * 100 : 0;

                    return (
                      <div
                        key={item.productId}
                        className="bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl space-y-2 border border-slate-200/60 dark:border-slate-700/60"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex-1">
                            <p className="font-bold text-slate-900 dark:text-white">{p?.name}</p>
                            <p className="text-[10px] font-mono text-slate-400">
                              SKU: {p?.sku} • Catalog Cost: <strong className="text-slate-700 dark:text-slate-300">{settings.currencySymbol}{p?.costPrice.toFixed(2)}</strong> • Catalog Retail: <strong className="text-slate-700 dark:text-slate-300">{settings.currencySymbol}{p?.retailPrice.toFixed(2)}</strong>
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleUpdateItemQty(item.productId, 0)}
                            className="p-1 text-slate-400 hover:text-rose-600 self-start sm:self-center"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2 bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-200/80 dark:border-slate-700/80 text-xs">
                          <div>
                            <label className="block text-[10px] text-slate-400 font-semibold mb-0.5">Order Qty</label>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleUpdateItemQty(item.productId, parseInt(e.target.value) || 1)}
                              className="w-full p-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-center"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] text-slate-400 font-semibold mb-0.5">PO Unit Cost ({settings.currencySymbol})</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.unitCost}
                              onChange={(e) => handleUpdateItemCost(item.productId, parseFloat(e.target.value) || 0)}
                              className={`w-full p-1 bg-slate-50 dark:bg-slate-800 border rounded-lg font-mono font-bold text-center ${
                                isPriceMismatch
                                  ? 'border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/30'
                                  : 'border-slate-200 dark:border-slate-700'
                              }`}
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] text-slate-400 font-semibold mb-0.5">Target Retail ({settings.currencySymbol})</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={currentRetail}
                              onChange={(e) => handleUpdateItemRetail(item.productId, parseFloat(e.target.value) || 0)}
                              className={`w-full p-1 bg-slate-50 dark:bg-slate-800 border rounded-lg font-mono font-bold text-center ${
                                item.customRetailPrice !== undefined && item.customRetailPrice !== p?.retailPrice
                                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/30'
                                  : 'border-slate-200 dark:border-slate-700'
                              }`}
                            />
                          </div>
                        </div>

                        {/* Item Gross Profit & Margin Pill */}
                        <div className="flex items-center justify-between text-[11px] px-2.5 py-1 bg-slate-100/80 dark:bg-slate-900/60 rounded-lg">
                          <span className="text-slate-500 font-medium">Line Gross Profit:</span>
                          <div className="flex items-center gap-1.5 font-mono font-bold">
                            <span className={unitProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                              {unitProfit >= 0 ? '+' : ''}{settings.currencySymbol}{lineGrossProfit.toFixed(2)}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                              marginPct >= 30 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                              marginPct >= 15 ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' :
                              marginPct > 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' :
                              'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}>
                              {marginPct.toFixed(1)}% margin
                            </span>
                          </div>
                        </div>

                        {/* Checkbox for updating catalog retail if custom retail set */}
                        {item.customRetailPrice !== undefined && p && item.customRetailPrice !== p.retailPrice && (
                          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-[11px] text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>Retail changed: {settings.currencySymbol}{p.retailPrice.toFixed(2)} → {settings.currencySymbol}{currentRetail.toFixed(2)}</span>
                            </div>
                            <label className="flex items-center gap-1.5 cursor-pointer font-bold shrink-0 text-[10px]">
                              <input
                                type="checkbox"
                                checked={!!item.updateCatalogRetailPrice}
                                onChange={(e) => handleToggleUpdateCatalogRetail(item.productId, e.target.checked)}
                                className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500"
                              />
                              <span>Save to catalog</span>
                            </label>
                          </div>
                        )}

                        {/* Cost Price Mismatch Notice & Update Option */}
                        {isPriceMismatch && p && (
                          <div
                            className={`p-2.5 rounded-xl text-[11px] border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                              isCostHigher
                                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                                : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <AlertTriangle className={`w-4 h-4 shrink-0 ${isCostHigher ? 'text-amber-600' : 'text-blue-600'}`} />
                              <div>
                                <span className="font-bold">Cost Price Mismatch:</span> Catalog is{' '}
                                <span className="font-mono font-bold">{settings.currencySymbol}{p.costPrice.toFixed(2)}</span> vs PO cost{' '}
                                <span className="font-mono font-bold">{settings.currencySymbol}{item.unitCost.toFixed(2)}</span>.
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <label className="flex items-center gap-1.5 cursor-pointer font-semibold select-none text-[10px]">
                                <input
                                  type="checkbox"
                                  checked={item.updateCatalogCost}
                                  onChange={(e) => handleToggleUpdateCatalogCost(item.productId, e.target.checked)}
                                  className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
                                />
                                <span>
                                  {item.updateCatalogCost
                                    ? `Update catalog cost to ${settings.currencySymbol}${item.unitCost.toFixed(2)}`
                                    : `Maintain previous cost (${settings.currencySymbol}${p.costPrice.toFixed(2)})`}
                                </span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Order Financial & Gross Profit Projections */}
              {(() => {
                const itemsSubtotal = poItems.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
                const totalOrderCost = itemsSubtotal + Math.max(0, deliveryFee || 0);

                const projectedRetailSales = poItems.reduce((sum, i) => {
                  const prod = products.find((p) => p.id === i.productId);
                  const retail = i.customRetailPrice ?? (prod?.retailPrice || 0);
                  return sum + i.quantity * retail;
                }, 0);

                const projectedGrossProfit = projectedRetailSales - totalOrderCost;
                const grossProfitMarginPct = projectedRetailSales > 0 ? (projectedGrossProfit / projectedRetailSales) * 100 : 0;

                return (
                  <div className="space-y-3">
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-1 text-xs">
                      <div className="flex justify-between text-slate-500">
                        <span>Items Subtotal:</span>
                        <span className="font-mono font-bold">{settings.currencySymbol}{itemsSubtotal.toFixed(2)}</span>
                      </div>
                      {deliveryFee > 0 && (
                        <div className="flex justify-between text-blue-600 dark:text-blue-400 font-medium">
                          <span>Supplier Delivery Fee:</span>
                          <span className="font-mono font-bold">+{settings.currencySymbol}{deliveryFee.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-1.5 border-t border-slate-200 dark:border-slate-700">
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">Grand Total PO Cost</p>
                          <p className="text-base font-black font-mono text-slate-900 dark:text-white">
                            {settings.currencySymbol}{totalOrderCost.toFixed(2)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">Initial Payment:</span>
                          <select
                            value={initialPaymentStatus}
                            onChange={(e) => setInitialPaymentStatus(e.target.value as any)}
                            className="p-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                          >
                            <option value="Unpaid">Unpaid (Credit)</option>
                            <option value="Paid">Prepaid (100% Paid)</option>
                          </select>
                        </div>
                      </div>

                      {/* Payment Source Prompt when Paid */}
                      {initialPaymentStatus === 'Paid' && (
                        <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 space-y-1.5 animate-in fade-in duration-150">
                          <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                            Deduct Payment From *
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setInitialPaymentSource('Biz Account')}
                              className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all ${
                                initialPaymentSource === 'Biz Account'
                                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 ring-1 ring-blue-500'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <Building className="w-3.5 h-3.5 text-blue-600" />
                                <span className="font-bold text-[11px]">Biz Account</span>
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {settings.currencySymbol}{treasuryBalances.bizAccountBalance.toLocaleString()}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setInitialPaymentSource('Physical Cash')}
                              className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all ${
                                initialPaymentSource === 'Physical Cash'
                                  ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-100 ring-1 ring-emerald-500'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="font-bold text-[11px]">Physical Cash</span>
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {settings.currencySymbol}{treasuryBalances.physicalCashBalance.toLocaleString()}
                              </span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Gross Profit Projection Card */}
                    {poItems.length > 0 && (
                      <div className="p-3.5 bg-gradient-to-br from-emerald-50/90 to-teal-50/60 dark:from-emerald-950/40 dark:to-teal-950/30 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span className="font-black text-slate-900 dark:text-white text-xs uppercase tracking-wider">
                              Order Gross Profit Projection
                            </span>
                          </div>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-black ${
                              grossProfitMarginPct >= 30
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/80 dark:text-emerald-200'
                                : grossProfitMarginPct >= 15
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/80 dark:text-blue-200'
                                : grossProfitMarginPct > 0
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/80 dark:text-amber-200'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-900/80 dark:text-rose-200'
                            }`}
                          >
                            {grossProfitMarginPct.toFixed(1)}% Gross Margin
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                          <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-emerald-100 dark:border-emerald-900/40">
                            <p className="text-[10px] text-slate-500 font-medium">Total Order Cost</p>
                            <p className="font-mono font-black text-slate-900 dark:text-white">
                              {settings.currencySymbol}{totalOrderCost.toFixed(2)}
                            </p>
                          </div>

                          <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-emerald-100 dark:border-emerald-900/40">
                            <p className="text-[10px] text-slate-500 font-medium">Est. Retail Sales</p>
                            <p className="font-mono font-black text-slate-900 dark:text-white">
                              {settings.currencySymbol}{projectedRetailSales.toFixed(2)}
                            </p>
                          </div>

                          <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-emerald-100 dark:border-emerald-900/40">
                            <p className="text-[10px] text-slate-500 font-medium">Est. Gross Profit</p>
                            <p className={`font-mono font-black ${projectedGrossProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {projectedGrossProfit >= 0 ? '+' : ''}{settings.currencySymbol}{projectedGrossProfit.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
                {editingDraftPo ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setDiscardDraftPo(editingDraftPo)}
                      className="flex items-center gap-1.5 px-3 py-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl font-bold transition-colors"
                      title="Discard this mock draft"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Discard Draft</span>
                    </button>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddModal(false);
                          setEditingDraftPo(null);
                        }}
                        className="px-3 py-2 font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                      >
                        Cancel
                      </button>

                      <button
                        type="button"
                        disabled={poItems.length === 0}
                        onClick={() => handleSaveDraftChanges(false)}
                        className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition-colors disabled:opacity-50"
                      >
                        Save Draft
                      </button>

                      <button
                        type="button"
                        disabled={poItems.length === 0}
                        onClick={() => handleSaveDraftChanges(true)}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                        title="Save changes and open printable supplier order note"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Save & Print Note</span>
                      </button>

                      <button
                        type="button"
                        disabled={poItems.length === 0}
                        onClick={handleSaveAndPlaceOfficialOrder}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl shadow-xs transition-colors disabled:opacity-50"
                      >
                        <Truck className="w-4 h-4" />
                        <span>Place Official Order</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowAddModal(false)}
                      className="px-4 py-2 font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                    >
                      Cancel
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={poItems.length === 0}
                        onClick={() => handleCreatePO(true)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                        title="Save mock draft to print or send to supplier for price and stock availability check"
                      >
                        <FileText className="w-4 h-4" />
                        <span>Save as Draft (Mock Order)</span>
                      </button>

                      <button
                        type="submit"
                        disabled={poItems.length === 0}
                        className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl shadow-xs transition-colors disabled:opacity-50"
                      >
                        <Truck className="w-4 h-4" />
                        <span>Issue Official PO</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Inspect & Stock Receiving Modal */}
      {inspectingPo && (
        <InspectStockModal
          isOpen={!!inspectingPo}
          onClose={() => setInspectingPo(null)}
          po={inspectingPo}
          currentUserName={currentUser?.displayName || 'Admin'}
          onTriggerPriceAdjustment={(items) => {
            setPriceAdjustmentItems(items);
            setShowPriceAdjustmentModal(true);
          }}
        />
      )}

      {/* MODAL 3: Goods Received Note (GRN) Certificate Modal */}
      {grnPo && (
        <GRNModal
          isOpen={!!grnPo}
          onClose={() => setGrnPo(null)}
          po={grnPo}
          onOpenPriceReport={() => setPriceReportPo(grnPo)}
        />
      )}

      {/* Price Adjustment Report Modal */}
      {priceReportPo && (
        <PriceAdjustmentReportModal
          isOpen={!!priceReportPo}
          onClose={() => setPriceReportPo(null)}
          po={priceReportPo}
        />
      )}

      {/* MODAL 4: Record Supplier Payment Modal */}
      {payingPo && (
        <POPaymentModal
          isOpen={!!payingPo}
          onClose={() => setPayingPo(null)}
          po={payingPo}
          currentUserName={currentUser?.displayName || 'Admin'}
        />
      )}

      {/* MODAL 5: Sales Price Adjustment Recommendation */}
      {showPriceAdjustmentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-2xl w-full p-6 space-y-5 my-auto max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 rounded-2xl">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 dark:text-white text-lg">
                    Sales Price Adjustment Recommendation
                  </h3>
                  <p className="text-xs text-slate-500">
                    Cost prices increased for {priceAdjustmentItems.length} item(s). Adjust selling prices to maintain optimum profit margin.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPriceAdjustmentModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Notice Alert */}
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-2xl text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>
                When unit cost increases, maintaining your previous retail and wholesale prices narrows your profit margin. We have auto-suggested new selling prices below based on your target margin.
              </span>
            </div>

            {/* Items Adjustment List */}
            <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
              {priceAdjustmentItems.map((item, idx) => {
                const costDiff = item.newCost - item.oldCost;
                const pctIncrease = item.oldCost > 0 ? ((costDiff / item.oldCost) * 100).toFixed(1) : '0';

                return (
                  <div
                    key={item.productId}
                    className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3 text-xs"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                      <div>
                        <h4 className="font-extrabold text-slate-900 dark:text-white text-sm">{item.productName}</h4>
                        <p className="text-[10px] font-mono text-slate-400">SKU: {item.sku}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 rounded-full font-bold text-[10px]">
                          Cost Increase: +{settings.currencySymbol}{costDiff.toFixed(2)} (+{pctIncrease}%)
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Cost Summary */}
                      <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Cost Price Change</p>
                        <div className="flex items-center justify-between font-mono font-bold">
                          <span className="text-slate-400 line-through">{settings.currencySymbol}{item.oldCost.toFixed(2)}</span>
                          <span className="text-slate-400">→</span>
                          <span className="text-amber-600 dark:text-amber-400">{settings.currencySymbol}{item.newCost.toFixed(2)}</span>
                        </div>
                      </div>

                      {/* Retail Price Input */}
                      <div>
                        <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                          New Retail Price ({settings.currencySymbol})
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.newRetail}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setPriceAdjustmentItems((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, newRetail: val } : p))
                              );
                            }}
                            className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono font-bold"
                          />
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            Current: {settings.currencySymbol}{item.oldRetail.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      {/* Wholesale Price Input */}
                      <div className="sm:col-start-2">
                        <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                          New Wholesale Price ({settings.currencySymbol})
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.newWholesale}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setPriceAdjustmentItems((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, newWholesale: val } : p))
                              );
                            }}
                            className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono font-bold"
                          />
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            Current: {settings.currencySymbol}{item.oldWholesale.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowPriceAdjustmentModal(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors"
              >
                Keep Current Sales Prices
              </button>
              <button
                type="button"
                onClick={handleApplySalesPriceChanges}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors shadow-xs"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Apply Sales Price Updates</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODAL: Supplier Order Note (Printable / Shareable) */}
      <OrderNoteModal
        isOpen={!!orderNotePo}
        onClose={() => setOrderNotePo(null)}
        po={orderNotePo}
        supplier={suppliers.find((s) => s.id === orderNotePo?.supplierId)}
        products={products}
        businessName={settings.businessName || 'Business Organization'}
        businessAddress={settings.businessAddress}
        businessPhone={settings.businessPhone}
        businessEmail={settings.businessEmail}
        currencySymbol={settings.currencySymbol}
        onPlaceOrder={(po) => {
          setOrderNotePo(null);
          setConfirmPlacePo(po);
        }}
        onEditDraft={(po) => {
          setOrderNotePo(null);
          handleOpenEditDraft(po);
        }}
      />

      {/* MODAL: Finalize & Place Official Purchase Order */}
      <ConfirmPlaceOrderModal
        isOpen={!!confirmPlacePo}
        onClose={() => setConfirmPlacePo(null)}
        onConfirm={handleConfirmPlaceOrder}
        po={confirmPlacePo}
        supplier={suppliers.find((s) => s.id === confirmPlacePo?.supplierId)}
        products={products}
        currencySymbol={settings.currencySymbol}
        treasuryBalances={treasuryBalances}
      />

      {/* MODAL: Discard Draft Confirmation */}
      {discardDraftPo && (
        <ConfirmModal
          isOpen={!!discardDraftPo}
          title="Discard Mock Purchase Order?"
          message={`Are you sure you want to discard draft mock purchase order #${discardDraftPo.poNumber}? Any inquiry details and mock line items will be removed permanently.`}
          confirmText="Discard Draft"
          variant="danger"
          onConfirm={() => {
            if (discardDraftPo) {
              handleDiscardDraft(discardDraftPo);
            }
          }}
          onClose={() => setDiscardDraftPo(null)}
        />
      )}

    </div>
  );
};
