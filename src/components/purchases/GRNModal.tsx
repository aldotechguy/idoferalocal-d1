import React, { useState, useRef } from 'react';
import { X, Printer, ShieldCheck, CheckCircle2, AlertTriangle, Building2, Truck, Calendar, User, FileText, Layers, TrendingUp } from 'lucide-react';
import { PurchaseOrder } from '../../types';
import { useApp } from '../../context/AppContext';

interface GRNModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder;
  onOpenPriceReport?: () => void;
}

export const GRNModal: React.FC<GRNModalProps> = ({ isOpen, onClose, po, onOpenPriceReport }) => {
  const { settings, suppliers } = useApp();
  const printRef = useRef<HTMLDivElement>(null);
  const [grnVersion, setGrnVersion] = useState<'v1_full' | 'v2_supplier'>('v1_full');

  if (!isOpen || !po) return null;

  const supplier = suppliers.find((s) => s.id === po.supplierId);
  const grnNumber = po.grnNumber || `GRN-${new Date().getFullYear()}-001`;

  const handlePrint = () => {
    const printableElement = printRef.current;
    if (!printableElement) return;

    const printFrame = document.createElement('iframe');
    printFrame.setAttribute('aria-hidden', 'true');
    printFrame.style.position = 'fixed';
    printFrame.style.left = '-12000px';
    printFrame.style.top = '0';
    // A real desktop-width print viewport keeps the invoice's two-column A4 layout.
    printFrame.style.width = '794px';
    printFrame.style.height = '1123px';
    printFrame.style.border = '0';
    printFrame.style.opacity = '0.01';
    printFrame.style.pointerEvents = 'none';
    document.body.appendChild(printFrame);

    const frameDocument = printFrame.contentDocument || printFrame.contentWindow?.document;
    if (!frameDocument) {
      document.body.removeChild(printFrame);
      return;
    }

    const appStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((node) => node.outerHTML)
      .join('\n');

    frameDocument.open();
    frameDocument.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Goods Received Note</title>
          ${appStyles}
          <style>
            @page { size: A4 portrait; margin: 8mm; }
            html, body { margin: 0; padding: 0; background: #fff !important; color: #000 !important; }
            body { box-sizing: border-box !important; width: 100% !important; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            #grn-print-document { box-sizing: border-box !important; display: block !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; color: #111827 !important; }
            #grn-print-document > * + * { margin-top: 15px !important; }
            #grn-print-document > div:nth-child(1) { display: flex !important; flex-direction: row !important; justify-content: space-between !important; align-items: flex-start !important; gap: 24px !important; padding-bottom: 14px !important; }
            #grn-print-document > div:nth-child(1) > div:last-child { text-align: right !important; }
            #grn-print-document > div:nth-child(2) { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 16px !important; }
            #grn-print-document > div:nth-child(2) > div { min-height: 98px !important; padding: 14px !important; border-radius: 14px !important; }
            #grn-print-document > div:nth-child(4) { display: flex !important; flex-direction: row !important; justify-content: space-between !important; align-items: flex-start !important; gap: 28px !important; }
            #grn-print-document > div:nth-child(4) > div:first-child { flex: 1 1 auto !important; max-width: none !important; }
            #grn-print-document > div:nth-child(4) > div:last-child { width: 285px !important; flex: 0 0 285px !important; }
            #grn-print-document h1 { font-size: 21px !important; line-height: 1.1 !important; letter-spacing: -0.02em !important; }
            #grn-print-document table { table-layout: fixed !important; font-size: 8.25px !important; }
            #grn-print-document th { padding: 7px 4px !important; font-size: 7.25px !important; white-space: nowrap !important; }
            #grn-print-document td { padding: 8px 4px !important; vertical-align: middle !important; }
            #grn-print-document th:first-child, #grn-print-document td:first-child { width: 19% !important; }
            #grn-print-document th:nth-child(2), #grn-print-document td:nth-child(2) { width: 8% !important; }
            #grn-print-document th:nth-child(3), #grn-print-document td:nth-child(3),
            #grn-print-document th:nth-child(4), #grn-print-document td:nth-child(4),
            #grn-print-document th:nth-child(5), #grn-print-document td:nth-child(5),
            #grn-print-document th:nth-child(6), #grn-print-document td:nth-child(6),
            #grn-print-document th:nth-child(7), #grn-print-document td:nth-child(7),
            #grn-print-document th:nth-child(8), #grn-print-document td:nth-child(8) { width: 7% !important; }
            #grn-print-document th:nth-child(9), #grn-print-document td:nth-child(9) { width: 13% !important; }
            #grn-print-document th:nth-child(10), #grn-print-document td:nth-child(10) { width: 18% !important; }
            .print\\:hidden { display: none !important; }
            table { width: 100%; border-collapse: collapse; }
            thead { display: table-header-group; }
            tr, img { break-inside: avoid; page-break-inside: avoid; }
          </style>
        </head>
        <body>${printableElement.outerHTML}</body>
      </html>
    `);
    frameDocument.close();

    const printInvoice = async () => {
      try {
        await frameDocument.fonts?.ready;
        printFrame.contentWindow?.focus();
        printFrame.contentWindow?.print();
      } finally {
        window.setTimeout(() => printFrame.remove(), 1500);
      }
    };

    window.setTimeout(printInvoice, 300);
  };

  // Financial Breakdown calculations
  const itemsSubtotal = po.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const totalAcceptedGoodsCost = po.items.reduce(
    (sum, item) => sum + (item.acceptedQuantity ?? item.quantity) * item.unitCost,
    0
  );

  // Local receiving logistics (recorded during receiving/inspecting stock)
  const recordedLocalReceivingLogistics = po.receivingHistory?.reduce(
    (sum, h) => sum + (h.deliveryFee || 0),
    0
  ) || 0;
  const localReceivingLogistics = po.localLogisticsFee ?? recordedLocalReceivingLogistics;

  const supplierLogistics = po.deliveryFee || 0;

  const isV1 = grnVersion === 'v1_full';

  // Version-specific logistics and total values
  const totalLogisticsForVersion = isV1 ? (supplierLogistics + localReceivingLogistics) : supplierLogistics;
  const totalPOValueForVersion = itemsSubtotal + totalLogisticsForVersion;
  const totalAcceptedValueForVersion = totalAcceptedGoodsCost + totalLogisticsForVersion;

  // Supplier balance is based on the original supplier PO value and excludes local receiving logistics.
  const supplierTotalPOValue = itemsSubtotal + supplierLogistics;
  const remainingSupplierBalance = Math.max(0, supplierTotalPOValue - po.paidAmount);

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-3xl w-full p-6 space-y-5 my-auto max-h-[90vh] overflow-y-auto text-slate-900 dark:text-white print:p-0 print:border-none print:shadow-none print:bg-white print:text-black"
      >
        
        {/* Header Action Bar (Hidden when printing) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 print:hidden">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <div>
              <h2 className="text-base font-black">Goods Received Note (GRN)</h2>
              <p className="text-[11px] text-slate-500">Inspection & Goods Receipt Certificate</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onOpenPriceReport && (
              <button
                onClick={() => {
                  onClose();
                  onOpenPriceReport();
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
                title="View Price Adjustment Report"
              >
                <TrendingUp className="w-4 h-4" />
                <span>Price Adjustment Report</span>
              </button>
            )}
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>Print GRN ({isV1 ? 'v1 Full' : 'v2 Supplier'})</span>
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors"
              title="Close Certificate"
            >
              <X className="w-4 h-4" />
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Version Switcher Controls (Hidden when printing) */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-2 print:hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-blue-500" /> Select GRN Certificate Format:
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold">
              {isV1 ? 'Version 1 Active' : 'Version 2 Active'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setGrnVersion('v1_full')}
              className={`p-2.5 rounded-xl text-left border transition-all text-xs ${
                isV1
                  ? 'bg-white dark:bg-slate-800 border-blue-500 shadow-xs ring-1 ring-blue-500/30'
                  : 'bg-transparent border-slate-200 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-800/40'
              }`}
            >
              <div className="font-extrabold flex items-center justify-between text-slate-900 dark:text-white">
                <span>Version 1: Full Expenses GRN</span>
                {isV1 && <CheckCircle2 className="w-4 h-4 text-blue-600" />}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Includes all expenses (Supplier Shipping & Local Receiving Logistics), Store Email, and Dual Sign-off.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setGrnVersion('v2_supplier')}
              className={`p-2.5 rounded-xl text-left border transition-all text-xs ${
                !isV1
                  ? 'bg-white dark:bg-slate-800 border-blue-500 shadow-xs ring-1 ring-blue-500/30'
                  : 'bg-transparent border-slate-200 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-800/40'
              }`}
            >
              <div className="font-extrabold flex items-center justify-between text-slate-900 dark:text-white">
                <span>Version 2: Ex-Local Logistics (Supplier)</span>
                {!isV1 && <CheckCircle2 className="w-4 h-4 text-blue-600" />}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Excludes local receiving logistics, omits Store Email, and includes only Inspected & Received By sign-off.
              </p>
            </button>
          </div>
        </div>

        {/* Printable Document Sheet */}
        <div id="grn-print-document" ref={printRef} className="space-y-6 print:space-y-4">
          
          {/* Store & Document Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white print:text-black">
                {settings.storeName}
              </h1>
              <p className="text-xs text-slate-500 print:text-slate-700">{settings.address}</p>
              {/* Version 1 includes Store Email; Version 2 omits Store Email */}
              <p className="text-xs text-slate-500 print:text-slate-700">
                Phone: {settings.phone}
                {isV1 && settings.email ? ` • Email: ${settings.email}` : ''}
              </p>
            </div>
            <div className="text-right sm:text-right">
              <span className="inline-block px-3 py-1 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-mono font-bold text-xs rounded-lg uppercase tracking-wide">
                GOODS RECEIVED NOTE {isV1 ? '(FULL EXPENSES)' : '(SUPPLIER COPY)'}
              </span>
              <p className="text-base font-black font-mono mt-1 text-slate-900 dark:text-white print:text-black">
                {grnNumber}
              </p>
              <p className="text-xs text-slate-400 font-mono">PO Ref: {po.poNumber}</p>
            </div>
          </div>

          {/* Supplier & Inspection Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 print:border-slate-300 print:bg-slate-50">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-blue-500" /> Supplier Information
              </p>
              <p className="font-extrabold text-sm text-slate-900 dark:text-white print:text-black">{po.supplierName}</p>
              {supplier && (
                <div className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-300 print:text-slate-800">
                  <p>Contact: {supplier.contactPerson}</p>
                  <p>Phone: {supplier.phone} | Email: {supplier.email}</p>
                  {supplier.address && <p>Address: {supplier.address}</p>}
                </div>
              )}
              <p className="mt-2 text-[10px] text-slate-500">Expected Delivery: <strong>{po.expectedDelivery}</strong></p>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 print:border-slate-300 print:bg-slate-50">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Inspection & Quality Audit
              </p>
              <div className="space-y-1 text-slate-700 dark:text-slate-300 print:text-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-400">Inspected By:</span>
                  <strong className="text-slate-900 dark:text-white print:text-black">{po.inspectedBy || po.createdBy}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Inspection Date:</span>
                  <span className="font-mono">{po.inspectedAt ? new Date(po.inspectedAt).toLocaleString() : new Date(po.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Verdict Status:</span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                    po.inspectionStatus === 'Passed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : po.inspectionStatus === 'Passed with Exceptions'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {po.inspectionStatus || 'Verified'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Items Received & Inspected Table */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-500" /> Inspected Inventory Breakdown
            </h3>
            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden print:border-slate-400">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase text-[10px] font-extrabold">
                  <tr>
                    <th className="py-2.5 px-3">Item Description</th>
                    <th className="py-2.5 px-2 text-center">SKU</th>
                    <th className="py-2.5 px-2 text-center">Ordered</th>
                    <th className="py-2.5 px-2 text-center">Received</th>
                    <th className="py-2.5 px-2 text-center">Accepted</th>
                    <th className="py-2.5 px-2 text-center">Damaged</th>
                    <th className="py-2.5 px-2 text-center">Shortage</th>
                    <th className="py-2.5 px-2 text-center">Excess</th>
                    <th className="py-2.5 px-3 text-right">Unit Cost</th>
                    <th className="py-2.5 px-3 text-right">Accepted Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-slate-300 font-medium">
                  {po.items.map((item, idx) => {
                    const received = item.receivedQuantity ?? item.quantity;
                    const accepted = item.acceptedQuantity ?? received;
                    const damaged = item.damagedQuantity ?? 0;
                    const shortage = Math.max(0, item.quantity - received - damaged);
                    const excess = Math.max(0, received - item.quantity);
                    const acceptedTotal = accepted * item.unitCost;

                    return (
                      <tr key={idx}>
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white print:text-black">
                          {item.productName}
                          {item.lastInspectionNotes && (
                            <p className="text-[10px] text-slate-400 font-normal italic">{item.lastInspectionNotes}</p>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-slate-500">{item.sku}</td>
                        <td className="py-2.5 px-2 text-center font-bold">{item.quantity}</td>
                        <td className="py-2.5 px-2 text-center">{received}</td>
                        <td className="py-2.5 px-2 text-center font-extrabold text-emerald-600 dark:text-emerald-400">{accepted}</td>
                        <td className="py-2.5 px-2 text-center font-bold text-rose-600">{damaged > 0 ? damaged : 0}</td>
                        <td className={`py-2.5 px-2 text-center font-extrabold ${shortage > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>{shortage}</td>
                        <td className={`py-2.5 px-2 text-center font-extrabold ${excess > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`}>{excess}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{settings.currencySymbol}{(Number(item.unitCost) || 0).toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right font-bold font-mono">{settings.currencySymbol}{(Number(acceptedTotal) || 0).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals & Financial Summary */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pt-2">
            <div className="text-xs space-y-1 text-slate-500 max-w-md">
              <p className="font-bold text-slate-700 dark:text-slate-300">Inspection & Receiving Remarks:</p>
              <p className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-800 text-slate-700 dark:text-slate-300 italic">
                {po.inspectionNotes || 'Goods received and inspected in accordance with quality standard operating procedures.'}
              </p>
              {po.notes && (
                <>
                  <p className="font-bold text-slate-700 dark:text-slate-300 pt-1">Purchase Order Notes:</p>
                  <p className="p-2.5 bg-blue-50/60 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/50 text-slate-700 dark:text-slate-300">
                    {po.notes}
                  </p>
                </>
              )}
            </div>

            <div className="w-full sm:w-72 p-3 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Items Subtotal:</span>
                <span className="font-mono">{settings.currencySymbol}{(Number(itemsSubtotal) || 0).toFixed(2)}</span>
              </div>

              {/* Supplier Logistics (Included in both V1 and V2) */}
              {supplierLogistics > 0 && (
                <div className="flex justify-between text-blue-600 dark:text-blue-400 font-medium">
                  <span>Supplier Shipping / Logistics:</span>
                  <span className="font-mono">{settings.currencySymbol}{(Number(supplierLogistics) || 0).toFixed(2)}</span>
                </div>
              )}

              {/* Local Receiving Logistics (Included ONLY in Version 1; Excluded in Version 2) */}
              {isV1 && localReceivingLogistics > 0 && (
                <div className="flex justify-between text-amber-600 dark:text-amber-400 font-medium">
                  <span>Local Receiving Logistics:</span>
                  <span className="font-mono">+{settings.currencySymbol}{(Number(localReceivingLogistics) || 0).toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between font-bold text-slate-900 dark:text-white pt-1 border-t border-slate-200 dark:border-slate-700">
                <span>Total PO Value {isV1 ? '' : '(Excl. Local Logistics)'}:</span>
                <span className="font-mono">{settings.currencySymbol}{(Number(totalPOValueForVersion) || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-emerald-600 dark:text-emerald-400">
                <span>Accepted Restock Value:</span>
                <span className="font-mono">{settings.currencySymbol}{(Number(totalAcceptedValueForVersion) || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-700">
                <span>Paid Amount:</span>
                <span className="font-mono">{settings.currencySymbol}{(Number(po.paidAmount) || 0).toFixed(2)}</span>
              </div>
              {isV1 && (
                <div className="flex justify-between font-black text-sm text-slate-900 dark:text-white pt-1 border-t border-slate-200 dark:border-slate-700">
                  <span>Balance Remaining:</span>
                  <span className="font-mono">{settings.currencySymbol}{(Number(remainingSupplierBalance) || 0).toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Sign-Off Authorization Footer */}
          {isV1 ? (
            /* Version 1: Two Person Sign-off */
            <div className="pt-8 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-8 text-xs text-center">
              <div className="space-y-12">
                <div className="border-b border-dashed border-slate-300 dark:border-slate-700 w-3/4 mx-auto"></div>
                <p className="font-bold text-slate-600 dark:text-slate-400">Inspected & Received By (Signature)</p>
              </div>
              <div className="space-y-12">
                <div className="border-b border-dashed border-slate-300 dark:border-slate-700 w-3/4 mx-auto"></div>
                <p className="font-bold text-slate-600 dark:text-slate-400">Supplier / Delivery Driver Sign-off</p>
              </div>
            </div>
          ) : (
            /* Version 2: Only One Person Sign-off for Inspected & Received By */
            <div className="pt-8 border-t border-slate-200 dark:border-slate-800 flex justify-center text-xs text-center">
              <div className="space-y-12 w-1/2">
                <div className="border-b border-dashed border-slate-300 dark:border-slate-700 w-3/4 mx-auto"></div>
                <p className="font-bold text-slate-600 dark:text-slate-400">Inspected & Received By (Signature)</p>
              </div>
            </div>
          )}

        </div>

        {/* Bottom Action Footer (Hidden when printing) */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800 print:hidden">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGrnVersion('v1_full')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                isV1 ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              v1 Full
            </button>
            <button
              type="button"
              onClick={() => setGrnVersion('v2_supplier')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                !isV1 ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              v2 Ex-Local
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-colors shadow-xs"
            >
              <Printer className="w-4 h-4" />
              <span>Print {isV1 ? 'v1 Full GRN' : 'v2 Ex-Local GRN'}</span>
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors"
            >
              <X className="w-4 h-4" />
              <span>Close Certificate</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
