import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, AlertTriangle, CheckCircle, PackageCheck, ClipboardCheck, Truck, TrendingUp, AlertCircle } from 'lucide-react';
import { NairaSign } from '../common/NairaSign';
import { PurchaseOrder, PaymentMethod, PriceAdjustmentItem } from '../../types';
import { useApp } from '../../context/AppContext';

interface InspectStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder;
  currentUserName: string;
  onTriggerPriceAdjustment?: (items: PriceAdjustmentItem[]) => void;
}

interface ItemInspectionState {
  productId: string;
  productName: string;
  sku: string;
  orderedQty: number;
  prevReceivedQty: number;
  receivingQty: number;
  acceptedQty: number;
  damagedQty: number;
  unitCost: number;
  oldUnitCost: number;
  customRetailPrice: number;
  oldRetailPrice: number;
  updateCatalogCost: boolean;
  updateCatalogRetail: boolean;
  conditionNotes: string;
}

export const InspectStockModal: React.FC<InspectStockModalProps> = ({
  isOpen,
  onClose,
  po,
  currentUserName,
  onTriggerPriceAdjustment,
}) => {
  const { receiveAndInspectPO, settings, products } = useApp();

  const [itemsState, setItemsState] = useState<ItemInspectionState[]>([]);
  const [inspectionStatus, setInspectionStatus] = useState<'Passed' | 'Passed with Exceptions' | 'Failed'>('Passed');
  const [inspectorName, setInspectorName] = useState(currentUserName || 'Admin Inspector');
  const [generalNotes, setGeneralNotes] = useState('');
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [deliveryFeePaymentMethod, setDeliveryFeePaymentMethod] = useState<PaymentMethod>('Cash');
  const [promptPriceAdjustment, setPromptPriceAdjustment] = useState<boolean>(true);

  useEffect(() => {
    if (po && po.items) {
      const initialItems: ItemInspectionState[] = po.items.map((item) => {
        const prevReceived = item.receivedQuantity || 0;
        const unreceived = Math.max(0, item.quantity - prevReceived);
        const initialReceiving = unreceived > 0 ? unreceived : 0;
        const prod = products.find((p) => p.id === item.productId);

        const oldCost = item.oldUnitCost !== undefined ? item.oldUnitCost : (prod ? prod.costPrice : item.unitCost);
        const currentCost = item.unitCost;
        const oldRetail = item.oldRetailPrice !== undefined ? item.oldRetailPrice : (prod ? prod.retailPrice : 0);
        const currentRetail = item.customRetailPrice !== undefined ? item.customRetailPrice : (prod ? prod.retailPrice : 0);

        return {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          orderedQty: item.quantity,
          prevReceivedQty: prevReceived,
          receivingQty: initialReceiving,
          acceptedQty: initialReceiving,
          damagedQty: 0,
          unitCost: currentCost,
          oldUnitCost: oldCost,
          customRetailPrice: currentRetail,
          oldRetailPrice: oldRetail,
          updateCatalogCost: true,
          updateCatalogRetail: false,
          conditionNotes: 'Inspected & verified good condition',
        };
      });

      setItemsState(initialItems);
      setInspectorName(currentUserName || 'Admin Inspector');
      setGeneralNotes('');
      setInspectionStatus('Passed');
      setDeliveryFee(po.deliveryFee || 0);
      setDeliveryFeePaymentMethod('Cash');
    }
  }, [po, currentUserName, products]);

  if (!isOpen || !po) return null;

  const handleReceivingQtyChange = (productId: string, qty: number) => {
    const validQty = Math.max(0, qty);
    setItemsState((prev) =>
      prev.map((item) => {
        if (item.productId === productId) {
          const newDamaged = Math.min(item.damagedQty, validQty);
          const newAccepted = Math.max(0, validQty - newDamaged);
          return {
            ...item,
            receivingQty: validQty,
            damagedQty: newDamaged,
            acceptedQty: newAccepted,
          };
        }
        return item;
      })
    );
  };

  const handleDamagedQtyChange = (productId: string, damaged: number) => {
    setItemsState((prev) =>
      prev.map((item) => {
        if (item.productId === productId) {
          const validDamaged = Math.min(item.receivingQty, Math.max(0, damaged));
          const newAccepted = Math.max(0, item.receivingQty - validDamaged);
          return {
            ...item,
            damagedQty: validDamaged,
            acceptedQty: newAccepted,
          };
        }
        return item;
      })
    );
  };

  const handleUnitCostChange = (productId: string, cost: number) => {
    const validCost = Math.max(0, cost);
    setItemsState((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, unitCost: validCost, updateCatalogCost: true } : item
      )
    );
  };

  const handleRetailPriceChange = (productId: string, price: number) => {
    const validPrice = Math.max(0, price);
    setItemsState((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, customRetailPrice: validPrice, updateCatalogRetail: true } : item
      )
    );
  };

  const handleNotesChange = (productId: string, notes: string) => {
    setItemsState((prev) =>
      prev.map((item) => (item.productId === productId ? { ...item, conditionNotes: notes } : item))
    );
  };

  const totalReceiving = itemsState.reduce((sum, i) => sum + i.receivingQty, 0);
  const totalAccepted = itemsState.reduce((sum, i) => sum + i.acceptedQty, 0);
  const totalDamaged = itemsState.reduce((sum, i) => sum + i.damagedQty, 0);

  // Gross Profit Impact Calculations for Delivery Fee and Unit Cost Changes
  const totalAcceptedGoodsCost = itemsState.reduce((sum, item) => {
    return sum + item.acceptedQty * item.unitCost;
  }, 0);

  const totalAcceptedRetailSales = itemsState.reduce((sum, item) => {
    return sum + item.acceptedQty * item.customRetailPrice;
  }, 0);

  const totalAcceptedUnits = itemsState.reduce((sum, item) => sum + item.acceptedQty, 0);

  const origGrossProfit = totalAcceptedRetailSales - totalAcceptedGoodsCost;
  const origMarginPct = totalAcceptedRetailSales > 0 ? (origGrossProfit / totalAcceptedRetailSales) * 100 : 0;

  const effectiveLandedCost = totalAcceptedGoodsCost + deliveryFee;
  const newGrossProfit = totalAcceptedRetailSales - effectiveLandedCost;
  const newMarginPct = totalAcceptedRetailSales > 0 ? (newGrossProfit / totalAcceptedRetailSales) * 100 : 0;
  const marginDropPct = origMarginPct - newMarginPct;
  const landedCostIncreasePct = totalAcceptedGoodsCost > 0 ? (deliveryFee / totalAcceptedGoodsCost) * 100 : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (totalReceiving === 0) {
      alert('Please specify at least 1 receiving quantity to process stock entry.');
      return;
    }

    receiveAndInspectPO(po.id, {
      items: itemsState.map((i) => ({
        productId: i.productId,
        receivingQty: i.receivingQty,
        acceptedQty: i.acceptedQty,
        damagedQty: i.damagedQty,
        unitCost: i.unitCost,
        oldUnitCost: i.oldUnitCost,
        customRetailPrice: i.customRetailPrice,
        oldRetailPrice: i.oldRetailPrice,
        updateCatalogCost: i.updateCatalogCost,
        updateCatalogRetail: i.updateCatalogRetail,
        conditionNotes: i.conditionNotes,
      })),
      inspectionStatus,
      inspectorName,
      generalNotes,
      deliveryFee,
      deliveryFeePaymentMethod,
    });

    // Trigger Price Adjustment Recommendation Modal if cost increased or delivery fee impacts profit
    const hasAnyCostOrFeeIncrease = (deliveryFee > 0 && promptPriceAdjustment) || itemsState.some((i) => i.unitCost > i.oldUnitCost);
    if (hasAnyCostOrFeeIncrease && onTriggerPriceAdjustment && totalAcceptedGoodsCost > 0) {
      const adjustmentItems: PriceAdjustmentItem[] = [];

      itemsState.forEach((item) => {
        if (item.acceptedQty <= 0) return;
        const prod = products.find((p) => p.id === item.productId);
        if (!prod) return;

        const effectiveUnitCost = item.unitCost;
        const itemTotalCost = item.acceptedQty * effectiveUnitCost;
        const allocatedFee = totalAcceptedGoodsCost > 0 ? (deliveryFee * itemTotalCost) / totalAcceptedGoodsCost : deliveryFee / itemsState.length;
        const feePerUnit = item.acceptedQty > 0 ? allocatedFee / item.acceptedQty : 0;
        const newLandedUnitCost = effectiveUnitCost + feePerUnit;

        const oldCost = item.oldUnitCost > 0 ? item.oldUnitCost : effectiveUnitCost;
        const costRatio = oldCost > 0 ? newLandedUnitCost / oldCost : 1.05;
        const suggestedRetail = Math.ceil(item.oldRetailPrice * costRatio);
        const suggestedWholesale = Math.ceil(prod.wholesalePrice * costRatio);

        adjustmentItems.push({
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          oldCost: oldCost,
          newCost: newLandedUnitCost,
          oldRetail: item.oldRetailPrice,
          newRetail: Math.max(suggestedRetail, item.customRetailPrice, item.oldRetailPrice),
          oldWholesale: prod.wholesalePrice,
          newWholesale: Math.max(suggestedWholesale, prod.wholesalePrice),
        });
      });

      if (adjustmentItems.length > 0) {
        onTriggerPriceAdjustment(adjustmentItems);
      }
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-4xl w-full p-6 space-y-6 my-auto max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 rounded-2xl">
              <PackageCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight">Stock Receiving & Quality Inspection</h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 font-mono">
                  {po.poNumber}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Supplier: <strong className="text-slate-800 dark:text-slate-200">{po.supplierName}</strong> • Ordered On: {new Date(po.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* Itemized Inspection Table */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-xs uppercase tracking-wider font-extrabold text-slate-400 flex items-center gap-1.5">
                <ClipboardCheck className="w-4 h-4 text-blue-500" />
                Line Items Verification & Inspection
              </h3>
              <span className="text-xs text-slate-500 font-medium">
                Total Units Being Received: <strong className="text-blue-600 dark:text-blue-400 font-bold">{totalReceiving}</strong>
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-400 uppercase text-[10px] font-extrabold tracking-wider">
                    <tr>
                      <th className="py-3 px-3">Product Name & SKU</th>
                      <th className="py-3 px-2 text-center">Ordered</th>
                      <th className="py-3 px-2 text-center">Prev Recv</th>
                      <th className="py-3 px-2 text-center w-28">Unit Cost ({settings.currencySymbol})</th>
                      <th className="py-3 px-2 text-center w-28">Selling Price ({settings.currencySymbol})</th>
                      <th className="py-3 px-2 text-center w-24">Receiving Now</th>
                      <th className="py-3 px-2 text-center w-24">Accepted Qty</th>
                      <th className="py-3 px-2 text-center w-24">Damaged Qty</th>
                      <th className="py-3 px-3">Condition / Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {itemsState.map((item) => (
                      <tr key={item.productId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-3 px-3">
                          <p className="font-bold text-slate-900 dark:text-white">{item.productName}</p>
                          <p className="text-[10px] font-mono text-slate-400">{item.sku}</p>
                        </td>
                        <td className="py-3 px-2 text-center font-bold text-slate-700 dark:text-slate-300">
                          {item.orderedQty}
                        </td>
                        <td className="py-3 px-2 text-center font-mono text-slate-500">
                          {item.prevReceivedQty}
                        </td>

                        {/* Unit Cost */}
                        <td className="py-3 px-2 text-center">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitCost}
                            onChange={(e) => handleUnitCostChange(item.productId, parseFloat(e.target.value) || 0)}
                            className="w-24 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-center font-bold text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          />
                          {item.unitCost !== item.oldUnitCost && (
                            <span className="block text-[9px] font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                              Was {settings.currencySymbol}{(Number(item.oldUnitCost) || 0).toFixed(2)}
                            </span>
                          )}
                        </td>

                        {/* Custom Retail Price */}
                        <td className="py-3 px-2 text-center">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.customRetailPrice}
                            onChange={(e) => handleRetailPriceChange(item.productId, parseFloat(e.target.value) || 0)}
                            className="w-24 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-center font-bold text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none text-emerald-700 dark:text-emerald-400"
                          />
                          {item.customRetailPrice !== item.oldRetailPrice && (
                            <span className="block text-[9px] font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                              Was {settings.currencySymbol}{(Number(item.oldRetailPrice) || 0).toFixed(2)}
                            </span>
                          )}
                        </td>
                        
                        {/* Receiving Now */}
                        <td className="py-3 px-2 text-center">
                          <input
                            type="number"
                            min="0"
                            value={item.receivingQty}
                            onChange={(e) => handleReceivingQtyChange(item.productId, parseInt(e.target.value) || 0)}
                            className="w-18 px-2 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-center font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          />
                        </td>

                        {/* Accepted Qty */}
                        <td className="py-3 px-2 text-center">
                          <span className="inline-block w-18 py-1 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-black rounded-lg text-center border border-emerald-200/50 dark:border-emerald-800">
                            {item.acceptedQty}
                          </span>
                        </td>

                        {/* Damaged Qty */}
                        <td className="py-3 px-2 text-center">
                          <input
                            type="number"
                            min="0"
                            max={item.receivingQty}
                            value={item.damagedQty}
                            onChange={(e) => handleDamagedQtyChange(item.productId, parseInt(e.target.value) || 0)}
                            className={`w-18 px-2 py-1 rounded-lg text-center font-bold focus:ring-2 focus:outline-none border ${
                              item.damagedQty > 0
                                ? 'bg-rose-50 dark:bg-rose-950/80 border-rose-300 text-rose-600 focus:ring-rose-500'
                                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                            }`}
                          />
                        </td>

                        {/* Condition Notes */}
                        <td className="py-3 px-3">
                          <input
                            type="text"
                            value={item.conditionNotes}
                            onChange={(e) => handleNotesChange(item.productId, e.target.value)}
                            placeholder="e.g. Good condition / Outer box dented..."
                            className="w-full px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Receiving & Damage Summary Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/50 text-blue-600 rounded-xl">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400">Total Shipment Units</p>
                <p className="text-sm font-black text-slate-900 dark:text-white">{totalReceiving} units</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 rounded-xl">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400">Accepted Restock</p>
                <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">{totalAccepted} units</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-100 dark:bg-rose-900/50 text-rose-600 rounded-xl">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400">Damaged / Rejected</p>
                <p className="text-sm font-black text-rose-600 dark:text-rose-400">{totalDamaged} units</p>
              </div>
            </div>
          </div>

          {/* Quality Assessment & Sign-Off Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Quality Inspection Verdict *
              </label>
              <select
                value={inspectionStatus}
                onChange={(e) => setInspectionStatus(e.target.value as any)}
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="Passed">Passed Inspection (100% Sound & Complete)</option>
                <option value="Passed with Exceptions">Passed with Exceptions (Damages/Shortages Found)</option>
                <option value="Failed">Failed / Total Delivery Rejection</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Inspector Name / Officer *
              </label>
              <input
                type="text"
                required
                value={inspectorName}
                onChange={(e) => setInspectorName(e.target.value)}
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Local Delivery Fee Charges & Auto Expense Section */}
          <div className="p-4 bg-blue-50/70 dark:bg-blue-950/30 rounded-2xl border border-blue-200/80 dark:border-blue-900/60 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h4 className="font-extrabold text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  Local Delivery Fee Charges
                </h4>
              </div>
              <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/60 px-2.5 py-0.5 rounded-full w-fit">
                Auto-Expense Categorization: Logistics
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Delivery Fee Amount ({settings.currencySymbol})
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    {settings.currencySymbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={deliveryFee || ''}
                    onChange={(e) => setDeliveryFee(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0.00"
                    className="w-full pl-8 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Fee Payment Method
                </label>
                <select
                  value={deliveryFeePaymentMethod}
                  onChange={(e) => setDeliveryFeePaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="Cash">Cash</option>
                  <option value="Mobile Transfer">Mobile Transfer</option>
                  <option value="Card">Card</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Store Credit">Store Credit</option>
                </select>
              </div>
            </div>

            {deliveryFee > 0 ? (
              <div className="space-y-3 pt-2 border-t border-blue-200/50 dark:border-blue-900/40">
                <p className="text-[11px] text-blue-800 dark:text-blue-300 font-semibold flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                  <span>
                    An expense of <strong>{settings.currencySymbol}{(Number(deliveryFee) || 0).toFixed(2)}</strong> will be automatically recorded under <strong>'Logistics'</strong> when stock receiving is saved.
                  </span>
                </p>

                {/* Gross Profit Impact Analysis Banner */}
                {totalAcceptedGoodsCost > 0 && (
                  <div className="p-3.5 bg-amber-50/90 dark:bg-amber-950/50 border border-amber-200/90 dark:border-amber-800/80 rounded-2xl space-y-2.5 text-xs text-amber-900 dark:text-amber-200">
                    <div className="flex items-center justify-between font-extrabold text-xs">
                      <div className="flex items-center gap-1.5">
                        <TrendingUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <span>Delivery Charge Gross Profit Impact</span>
                      </div>
                      <span className="text-[10px] font-bold bg-amber-100 dark:bg-amber-900/80 text-amber-800 dark:text-amber-200 px-2.5 py-0.5 rounded-full">
                        Landed Cost +{(Number(landedCostIncreasePct) || 0).toFixed(1)}%
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-amber-200/60 dark:border-amber-900/50">
                        <span className="text-[10px] text-slate-400 font-sans block">Original Margin</span>
                        <span className="font-bold text-slate-700 dark:text-slate-200">{(Number(origMarginPct) || 0).toFixed(1)}%</span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-amber-200/60 dark:border-amber-900/50">
                        <span className="text-[10px] text-slate-400 font-sans block">Effective Margin</span>
                        <span className="font-bold text-amber-600 dark:text-amber-400">{(Number(newMarginPct) || 0).toFixed(1)}%</span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-amber-200/60 dark:border-amber-900/50">
                        <span className="text-[10px] text-slate-400 font-sans block">Margin Impact</span>
                        <span className="font-bold text-red-600 dark:text-red-400">-{(Number(marginDropPct) || 0).toFixed(1)}%</span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-amber-200/60 dark:border-amber-900/50">
                        <span className="text-[10px] text-slate-400 font-sans block">Profit Impact</span>
                        <span className="font-bold text-red-600 dark:text-red-400">-{settings.currencySymbol}{(Number(deliveryFee) || 0).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-amber-200/60 dark:border-amber-900/40">
                      <p className="text-[11px] text-amber-800 dark:text-amber-300">
                        💡 <strong>Recommendation:</strong> An average price adjustment of <strong>+{settings.currencySymbol}{(Number(deliveryFee / Math.max(1, totalAcceptedUnits)) || 0).toFixed(2)}</strong>/unit is recommended to maintain gross profit margin.
                      </p>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] font-bold text-amber-900 dark:text-amber-100 shrink-0 bg-amber-100 dark:bg-amber-900/60 px-2.5 py-1.5 rounded-xl border border-amber-200 dark:border-amber-800">
                        <input
                          type="checkbox"
                          checked={promptPriceAdjustment}
                          onChange={(e) => setPromptPriceAdjustment(e.target.checked)}
                          className="w-3.5 h-3.5 rounded text-amber-600 focus:ring-amber-500"
                        />
                        <span>Prompt Sales Price Adjustment</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                Input any local shipping, courier, or freight charges incurred upon receiving this batch.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              General Inspection & Receiving Notes
            </label>
            <textarea
              rows={2}
              value={generalNotes}
              onChange={(e) => setGeneralNotes(e.target.value)}
              placeholder="Record shipment seal number, driver details, or overall quality findings..."
              className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Confirm Inspection & Restock Inventory</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
