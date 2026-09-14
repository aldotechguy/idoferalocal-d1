import React, { useRef } from 'react';
import { X, Printer, TrendingUp, AlertTriangle, CheckCircle2, ShieldCheck, Tag, ArrowUpRight, ArrowDownRight, Layers } from 'lucide-react';
import { PurchaseOrder } from '../../types';
import { useApp } from '../../context/AppContext';

interface PriceAdjustmentReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder | null;
}

export const PriceAdjustmentReportModal: React.FC<PriceAdjustmentReportModalProps> = ({ isOpen, onClose, po }) => {
  const { settings, products, pricingHistory } = useApp();
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !po) return null;

  const handlePrint = () => {
    window.print();
  };

  const grnNumber = po.grnNumber || `GRN-${new Date().getFullYear()}-001`;

  // Local receiving logistics (recorded during receiving/inspecting stock)
  const recordedLocalReceivingLogistics = po.receivingHistory?.reduce(
    (sum, h) => sum + (h.deliveryFee || 0),
    0
  ) || 0;
  const localReceivingLogistics = po.localLogisticsFee ?? recordedLocalReceivingLogistics;

  // Supplier logistics paid on order creation
  const supplierLogistics = po.deliveryFee || 0;

  const totalAcceptedGoodsCost = po.items.reduce((sum, item) => {
    const historyMatch = po.receivingHistory
      ? [...po.receivingHistory].reverse().flatMap((h) => h.itemsReceived).find((i) => i.productId === item.productId)
      : undefined;
    const unitCost = historyMatch?.unitCost !== undefined ? historyMatch.unitCost : item.unitCost;
    return sum + (item.acceptedQuantity ?? item.quantity) * unitCost;
  }, 0);

  // Detailed analysis per item
  const itemAnalyses = po.items.map((item) => {
    const prod = products.find((p) => p.id === item.productId);
    const qty = item.acceptedQuantity ?? item.quantity;

    const historyMatch = po.receivingHistory
      ? [...po.receivingHistory].reverse().flatMap((h) => h.itemsReceived).find((i) => i.productId === item.productId)
      : undefined;

    // Unit cost from receiving inspection or item
    const poUnitCost = historyMatch?.unitCost !== undefined ? historyMatch.unitCost : item.unitCost;

    // Old unit cost before inspection/receiving adjustment
    let oldCost = item.oldUnitCost ?? historyMatch?.oldUnitCost;
    if (oldCost === undefined || (oldCost === poUnitCost && item.unitCost !== poUnitCost)) {
      if (item.unitCost !== poUnitCost) {
        oldCost = item.unitCost;
      } else if (prod && prod.costPrice !== poUnitCost) {
        oldCost = prod.costPrice;
      } else {
        oldCost = poUnitCost;
      }
    }

    // Allocate local logistics to calculate landed cost
    const itemTotalCost = qty * poUnitCost;
    const allocatedFee = totalAcceptedGoodsCost > 0 ? (localReceivingLogistics * itemTotalCost) / totalAcceptedGoodsCost : 0;
    const feePerUnit = qty > 0 ? allocatedFee / qty : 0;
    const landedUnitCost = poUnitCost + feePerUnit;

    // Current/updated retail price
    const currentRetail = item.customRetailPrice ?? historyMatch?.customRetailPrice ?? (prod ? prod.retailPrice : 0);

    // Old retail price before adjustment
    let oldRetail = item.oldRetailPrice ?? historyMatch?.oldRetailPrice;

    // Check pricing history for any logged price change
    const recentPricingChange = pricingHistory?.find((ph) => ph.productId === item.productId && ph.priceType === 'Retail');

    if (oldRetail === undefined || oldRetail === currentRetail) {
      if (recentPricingChange && recentPricingChange.oldPrice !== currentRetail) {
        oldRetail = recentPricingChange.oldPrice;
      } else if (prod && prod.retailPrice !== currentRetail) {
        oldRetail = prod.retailPrice;
      } else if (oldRetail === undefined) {
        oldRetail = currentRetail;
      }
    }

    const oldWholesale = prod ? prod.wholesalePrice : 0;

    // Cost variance calculation
    const costDiff = landedUnitCost - oldCost;
    const costDiffPct = oldCost > 0 ? (costDiff / oldCost) * 100 : 0;

    // Recommendation logic to preserve margin
    const costRatio = oldCost > 0 ? landedUnitCost / oldCost : 1.1;
    const recommendedRetail = Math.ceil(oldRetail * costRatio);
    const recommendedWholesale = Math.ceil(oldWholesale * costRatio);

    // Margins
    const oldMarginPct = oldRetail > 0 ? ((oldRetail - oldCost) / oldRetail) * 100 : 0;
    const currentMarginPct = currentRetail > 0 ? ((currentRetail - landedUnitCost) / currentRetail) * 100 : 0;
    const recommendedMarginPct = recommendedRetail > 0 ? ((recommendedRetail - landedUnitCost) / recommendedRetail) * 100 : 0;

    const hasCostIncrease = costDiff > 0.01;
    const hasCostDecrease = costDiff < -0.01;
    const isRetailAdjusted = Math.abs(currentRetail - oldRetail) > 0.01;
    const isMarginDiluted = currentMarginPct < oldMarginPct - 0.5;

    return {
      item,
      productName: prod?.name || item.productName || 'Product',
      sku: prod?.sku || 'N/A',
      qty,
      oldCost,
      poUnitCost,
      landedUnitCost,
      feePerUnit,
      costDiff,
      costDiffPct,
      oldRetail,
      oldWholesale,
      currentRetail,
      recommendedRetail,
      recommendedWholesale,
      oldMarginPct,
      currentMarginPct,
      recommendedMarginPct,
      hasCostIncrease,
      hasCostDecrease,
      isRetailAdjusted,
      isMarginDiluted,
    };
  });

  const totalCostIncreasedItems = itemAnalyses.filter((i) => i.hasCostIncrease).length;
  const totalMarginDilutedItems = itemAnalyses.filter((i) => i.isMarginDiluted).length;
  const totalRetailAdjustedItems = itemAnalyses.filter((i) => i.isRetailAdjusted).length;

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-4xl w-full p-6 space-y-5 my-auto max-h-[90vh] overflow-y-auto text-slate-900 dark:text-white print:p-0 print:border-none print:shadow-none print:bg-white print:text-black"
      >
        
        {/* Header Action Bar (Hidden when printing) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 print:hidden">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 rounded-xl">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black">Price Adjustment & Cost Impact Report</h2>
              <p className="text-[11px] text-slate-500">Analysis of unit cost changes, landed logistics & retail price adjustments</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>Print Report</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Sheet */}
        <div ref={printRef} className="space-y-6 print:space-y-4">
          
          {/* Document Letterhead */}
          <div className="flex flex-col sm:flex-row justify-between items-start border-b border-slate-200 dark:border-slate-800 pb-5 gap-4">
            <div>
              <h1 className="text-xl font-black text-slate-900 dark:text-white print:text-black">
                {settings.storeName}
              </h1>
              <p className="text-xs text-slate-500 print:text-slate-700">{settings.address}</p>
              <p className="text-xs text-slate-500 print:text-slate-700">Phone: {settings.phone} • Email: {settings.email}</p>
            </div>
            <div className="text-right sm:text-right">
              <span className="inline-block px-3 py-1 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-mono font-bold text-xs rounded-lg uppercase tracking-wide">
                PRICE ADJUSTMENT REPORT
              </span>
              <p className="text-base font-black font-mono mt-1 text-slate-900 dark:text-white print:text-black">
                {po.poNumber}
              </p>
              <p className="text-xs text-slate-500">GRN Ref: <strong className="font-mono text-slate-700 dark:text-slate-300 print:text-black">{grnNumber}</strong></p>
              <p className="text-xs text-slate-500">
                Date: {po.inspectedAt ? new Date(po.inspectedAt).toLocaleDateString() : new Date(po.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Reference Info Card */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase">Supplier</span>
              <p className="font-bold text-slate-900 dark:text-white truncate">{po.supplierName}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase">Inspector / Agent</span>
              <p className="font-bold text-slate-900 dark:text-white truncate">{po.inspectedBy || 'System Admin'}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase">Local Logistics Allocated</span>
              <p className="font-bold text-amber-600 dark:text-amber-400 font-mono">{settings.currencySymbol}{(Number(localReceivingLogistics) || 0).toFixed(2)}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase">Cost Increased Items</span>
              <p className="font-bold text-rose-600 dark:text-rose-400">{totalCostIncreasedItems} of {po.items.length} Line Items</p>
            </div>
          </div>

          {/* Key Impact Summary Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:grid-cols-3">
            <div className="p-3.5 bg-rose-50/60 dark:bg-rose-950/30 rounded-2xl border border-rose-200/80 dark:border-rose-900/50">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                Cost Increases
              </span>
              <p className="text-lg font-black text-rose-700 dark:text-rose-300 mt-0.5">
                {totalCostIncreasedItems} Item(s)
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {totalCostIncreasedItems > 0 ? 'Supplier or landed unit costs increased' : 'No cost increases detected'}
              </p>
            </div>

            <div className="p-3.5 bg-amber-50/60 dark:bg-amber-950/30 rounded-2xl border border-amber-200/80 dark:border-amber-900/50">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Margin Dilution Risk
              </span>
              <p className="text-lg font-black text-amber-700 dark:text-amber-300 mt-0.5">
                {totalMarginDilutedItems} Item(s)
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {totalMarginDilutedItems > 0 ? 'Gross profit margin % diluted by higher costs' : 'Margins remain optimum'}
              </p>
            </div>

            <div className="p-3.5 bg-blue-50/60 dark:bg-blue-950/30 rounded-2xl border border-blue-200/80 dark:border-blue-900/50">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Selling Price Updated
              </span>
              <p className="text-lg font-black text-blue-700 dark:text-blue-300 mt-0.5">
                {totalRetailAdjustedItems} Item(s)
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {totalRetailAdjustedItems > 0 ? 'Catalog retail price adjusted for margin' : 'Catalog prices unchanged'}
              </p>
            </div>
          </div>

          {/* Detailed Price Adjustment Analysis Table */}
          <div className="space-y-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Itemized Cost & Retail Price Analysis
            </h3>

            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800 text-[11px]">
                    <th className="py-2.5 px-3">Product Name / SKU</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Old Cost → New Landed</th>
                    <th className="py-2.5 px-3 text-right">Old Retail → Current</th>
                    <th className="py-2.5 px-3 text-right">Recommended Retail</th>
                    <th className="py-2.5 px-3 text-right">Margin Impact</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {itemAnalyses.map((analysis, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      {/* Product Name */}
                      <td className="py-3 px-3">
                        <p className="font-bold text-slate-900 dark:text-white print:text-black">{analysis.productName}</p>
                        <p className="text-[10px] text-slate-400 font-mono">SKU: {analysis.sku}</p>
                        {analysis.feePerUnit > 0 && (
                          <p className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">
                            +{settings.currencySymbol}{(Number(analysis.feePerUnit) || 0).toFixed(2)}/unit local logistics
                          </p>
                        )}
                      </td>

                      {/* Qty */}
                      <td className="py-3 px-3 text-right font-mono font-semibold text-slate-700 dark:text-slate-300">
                        {analysis.qty}
                      </td>

                      {/* Base Cost vs Landed Cost */}
                      <td className="py-3 px-3 text-right">
                        <div className="font-mono text-slate-900 dark:text-white print:text-black">
                          <span className="text-slate-400 line-through mr-1 text-[11px]">
                            {settings.currencySymbol}{(Number(analysis.oldCost) || 0).toFixed(2)}
                          </span>
                          <strong className="font-bold text-slate-900 dark:text-white">
                            {settings.currencySymbol}{(Number(analysis.landedUnitCost) || 0).toFixed(2)}
                          </strong>
                        </div>
                        {analysis.hasCostIncrease && (
                          <p className="text-[10px] text-rose-600 dark:text-rose-400 font-bold flex items-center justify-end gap-0.5">
                            <ArrowUpRight className="w-3 h-3" />
                            +{settings.currencySymbol}{(Number(analysis.costDiff) || 0).toFixed(2)} (+{(Number(analysis.costDiffPct) || 0).toFixed(1)}%)
                          </p>
                        )}
                        {analysis.hasCostDecrease && (
                          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center justify-end gap-0.5">
                            <ArrowDownRight className="w-3 h-3" />
                            {settings.currencySymbol}{(Number(analysis.costDiff) || 0).toFixed(2)} ({(Number(analysis.costDiffPct) || 0).toFixed(1)}%)
                          </p>
                        )}
                      </td>

                      {/* Old Retail vs Current Retail */}
                      <td className="py-3 px-3 text-right font-mono">
                        <p className="text-slate-900 dark:text-white font-bold">
                          {settings.currencySymbol}{(Number(analysis.currentRetail) || 0).toFixed(2)}
                        </p>
                        {analysis.isRetailAdjusted ? (
                          <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                            Was {settings.currencySymbol}{(Number(analysis.oldRetail) || 0).toFixed(2)}
                          </p>
                        ) : (
                          <p className="text-[10px] text-slate-400">Unchanged</p>
                        )}
                      </td>

                      {/* Recommended Retail */}
                      <td className="py-3 px-3 text-right font-mono">
                        <p className={`font-bold ${analysis.hasCostIncrease && analysis.currentRetail < analysis.recommendedRetail ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
                          {settings.currencySymbol}{(Number(analysis.recommendedRetail) || 0).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-400">To maintain {(Number(analysis.oldMarginPct) || 0).toFixed(0)}% margin</p>
                      </td>

                      {/* Margin Impact */}
                      <td className="py-3 px-3 text-right font-mono">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-[11px] text-slate-400 line-through">
                            {(Number(analysis.oldMarginPct) || 0).toFixed(0)}%
                          </span>
                          <span>→</span>
                          <span className={`font-bold ${analysis.isMarginDiluted ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {(Number(analysis.currentMarginPct) || 0).toFixed(0)}%
                          </span>
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3 px-3 text-center">
                        {analysis.hasCostIncrease ? (
                          analysis.isRetailAdjusted ? (
                            <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 font-bold text-[10px] rounded-md">
                              Price Adjusted
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold text-[10px] rounded-md">
                              Cost Increased
                            </span>
                          )
                        ) : (
                          <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-medium text-[10px] rounded-md">
                            Stable Cost
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recommendation / Summary Notice */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
            <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" /> Executive Audit Summary & Price Recommendations
            </h4>
            <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
              This report documents unit cost changes and allocated local receiving logistics for Purchase Order <strong>{po.poNumber}</strong> (GRN <strong>{grnNumber}</strong>).
              {totalMarginDilutedItems > 0 ? (
                <> There are <strong>{totalMarginDilutedItems} item(s)</strong> whose profit margins have been diluted due to increased landed cost. It is recommended to update selling prices in the product catalog according to the recommended prices shown above.</>
              ) : (
                <> All items maintain healthy gross profit margins based on current selling prices and landed costs.</>
              )}
            </p>
          </div>

          {/* Manager Authorization / Sign-Off Footer */}
          <div className="pt-8 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-8 text-xs text-center">
            <div className="space-y-12">
              <div className="border-b border-dashed border-slate-300 dark:border-slate-700 w-3/4 mx-auto"></div>
              <p className="font-bold text-slate-600 dark:text-slate-400">Inventory / Purchasing Manager (Signature)</p>
            </div>
            <div className="space-y-12">
              <div className="border-b border-dashed border-slate-300 dark:border-slate-700 w-3/4 mx-auto"></div>
              <p className="font-bold text-slate-600 dark:text-slate-400">Approved By Store Administrator</p>
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 print:hidden">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition-colors shadow-xs"
          >
            <Printer className="w-4 h-4" />
            <span>Print Price Adjustment Report</span>
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors"
          >
            <X className="w-4 h-4" />
            <span>Close Report</span>
          </button>
        </div>

      </div>
    </div>
  );
};
