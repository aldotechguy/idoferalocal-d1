import React, { useRef } from 'react';
import {
  X,
  Printer,
  FileText,
  Building2,
  Calendar,
  User,
  Share2,
  Check,
  Phone,
  Mail,
  MapPin,
  Clock,
  ArrowRight,
  Edit3,
  CheckCircle2,
} from 'lucide-react';
import { PurchaseOrder } from '../../types';
import { useApp } from '../../context/AppContext';

interface OrderNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder;
  onEditDraft?: (po: PurchaseOrder) => void;
  onPlaceOrder?: (po: PurchaseOrder) => void;
}

export const OrderNoteModal: React.FC<OrderNoteModalProps> = ({
  isOpen,
  onClose,
  po,
  onEditDraft,
  onPlaceOrder,
}) => {
  const { settings, suppliers, showToast } = useApp();
  const printRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = React.useState(false);

  if (!isOpen || !po) return null;

  const supplier = suppliers.find((s) => s.id === po.supplierId);
  const isDraft = po.deliveryStatus === 'Draft' || po.isDraft;

  const handlePrint = () => {
    const printableElement = printRef.current;
    if (!printableElement) return;

    const printFrame = document.createElement('iframe');
    printFrame.setAttribute('aria-hidden', 'true');
    printFrame.style.position = 'fixed';
    printFrame.style.left = '-12000px';
    printFrame.style.top = '0';
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
          <title>Order Note - ${po.poNumber}</title>
          ${appStyles}
          <style>
            @page { size: A4 portrait; margin: 10mm; }
            html, body { margin: 0; padding: 0; background: #fff !important; color: #111827 !important; }
            body { box-sizing: border-box !important; width: 100% !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            #order-note-print-document { box-sizing: border-box !important; display: block !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
            .print\\:hidden { display: none !important; }
            table { width: 100%; border-collapse: collapse; }
            thead { display: table-header-group; }
            tr, img { break-inside: avoid; page-break-inside: avoid; }
            th { border-bottom: 2px solid #334155 !important; padding: 6px 8px !important; font-size: 9px !important; text-transform: uppercase !important; }
            td { border-bottom: 1px solid #e2e8f0 !important; padding: 7px 8px !important; }
          </style>
        </head>
        <body>${printableElement.outerHTML}</body>
      </html>
    `);
    frameDocument.close();

    const printDocument = async () => {
      try {
        await frameDocument.fonts?.ready;
        printFrame.contentWindow?.focus();
        printFrame.contentWindow?.print();
      } catch (err) {
        console.error('Iframe print failed', err);
        window.print();
      } finally {
        setTimeout(() => {
          if (document.body.contains(printFrame)) {
            document.body.removeChild(printFrame);
          }
        }, 1500);
      }
    };

    setTimeout(printDocument, 250);
  };

  const handleCopySummary = () => {
    const lines = [
      `*PURCHASE ORDER NOTE / INQUIRY*`,
      `Reference: ${po.poNumber}`,
      `Status: ${isDraft ? 'Draft (Price & Availability Check)' : 'Official Purchase Order'}`,
      `Date: ${new Date(po.createdAt).toLocaleDateString()}`,
      `Expected Delivery: ${po.expectedDelivery}`,
      ``,
      `*Buyer:* ${settings.businessName || 'Procurement'}`,
      `*Supplier:* ${po.supplierName}`,
      ``,
      `*Requested Items:*`,
      ...po.items.map(
        (item, idx) =>
          `${idx + 1}. ${item.productName} (SKU: ${item.sku}) - Qty: ${item.quantity} units @ Est. ${settings.currencySymbol}${item.unitCost.toFixed(2)}`
      ),
      ``,
      `*Estimated Items Total:* ${settings.currencySymbol}${po.items.reduce((acc, i) => acc + i.quantity * i.unitCost, 0).toFixed(2)}`,
      po.deliveryFee ? `*Target Logistics Fee:* ${settings.currencySymbol}${po.deliveryFee.toFixed(2)}` : '',
      `*Estimated Grand Total:* ${settings.currencySymbol}${po.totalAmount.toFixed(2)}`,
      ``,
      `_Please confirm availability, lead time, and your current net unit prices. Thank you._`,
    ].filter(Boolean);

    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    showToast({
      title: 'Order Note Copied',
      message: 'Order note summary copied to clipboard. Ready to paste on WhatsApp or Email.',
      type: 'success',
    });
    setTimeout(() => setCopied(false), 2500);
  };

  const totalItemsSubtotal = po.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-4xl w-full my-auto max-h-[95vh] flex flex-col overflow-hidden">
        
        {/* Modal Top Control Bar (Non-printed) */}
        <div className="p-4 sm:px-6 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl ${
              isDraft
                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400'
            }`}>
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-slate-900 dark:text-white">
                  Supplier Order Note
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${
                  isDraft
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                }`}>
                  {isDraft ? 'Draft Inquiry' : 'Official Order'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isDraft
                  ? 'Send or print this note for your supplier to verify current unit prices and stock availability.'
                  : `Purchase Order document for ${po.poNumber}.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isDraft && onEditDraft && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditDraft(po);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all"
                title="Edit quantities or update confirmed supplier prices"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Adjust Draft</span>
              </button>
            )}

            {isDraft && onPlaceOrder && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onPlaceOrder(po);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs"
                title="Convert this confirmed draft into an active official purchase order"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Place Order Now</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleCopySummary}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all"
              title="Copy formatted summary to paste in WhatsApp or email"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Summary'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Note</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Document Container */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-100 dark:bg-slate-950/40">
          <div
            ref={printRef}
            id="order-note-print-document"
            className="bg-white text-slate-900 p-8 sm:p-10 rounded-2xl shadow-sm border border-slate-200 max-w-3xl mx-auto space-y-6"
          >
            {/* Header / Letterhead */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 pb-6 border-b-2 border-slate-800">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black text-sm">
                    {settings.businessName ? settings.businessName.charAt(0) : 'P'}
                  </div>
                  <h1 className="text-xl font-black tracking-tight text-slate-900">
                    {settings.businessName || 'Business Enterprise'}
                  </h1>
                </div>
                {settings.businessAddress && (
                  <p className="text-xs text-slate-600 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{settings.businessAddress}</span>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-0.5">
                  {settings.businessPhone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-400" />
                      {settings.businessPhone}
                    </span>
                  )}
                  {settings.businessEmail && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3 text-slate-400" />
                      {settings.businessEmail}
                    </span>
                  )}
                </div>
              </div>

              <div className="sm:text-right space-y-1">
                <div className="inline-block">
                  <span className={`px-2.5 py-1 rounded text-xs font-black tracking-wider uppercase ${
                    isDraft
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-blue-100 text-blue-900 border border-blue-300'
                  }`}>
                    {isDraft ? 'PURCHASE ORDER NOTE (DRAFT INQUIRY)' : 'OFFICIAL PURCHASE ORDER'}
                  </span>
                </div>
                <p className="text-sm font-mono font-black text-slate-900">
                  Ref: {po.poNumber}
                </p>
                <p className="text-xs text-slate-500">
                  Date: {new Date(po.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                <p className="text-xs font-medium text-slate-600">
                  Expected Delivery: <strong className="text-slate-900">{po.expectedDelivery}</strong>
                </p>
              </div>
            </div>

            {/* Parties Info Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Supplier Info Box */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Supplier Vendor (To)</span>
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">{po.supplierName}</h3>
                  {supplier?.contactPerson && (
                    <p className="text-xs text-slate-600">Attn: {supplier.contactPerson}</p>
                  )}
                  {supplier?.phone && (
                    <p className="text-xs text-slate-600">Tel: {supplier.phone}</p>
                  )}
                  {supplier?.email && (
                    <p className="text-xs text-slate-600">Email: {supplier.email}</p>
                  )}
                  {supplier?.address && (
                    <p className="text-xs text-slate-500">{supplier.address}</p>
                  )}
                </div>
              </div>

              {/* Order Inquiries & Terms */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>Order Note Purpose</span>
                </div>
                <div className="text-xs text-slate-600 space-y-1">
                  <p>
                    <strong className="text-slate-800">Purpose:</strong> Price & Stock Availability Confirmation
                  </p>
                  <p>
                    <strong className="text-slate-800">Prepared By:</strong> {po.createdBy}
                  </p>
                  <p className="text-[11px] text-slate-500 italic pt-1">
                    *Supplier: Please confirm current prices and stock availability for the items listed below before final dispatch.
                  </p>
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div>
              <div className="flex items-center justify-between pb-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                  Requested Line Items ({po.items.length})
                </h3>
                <span className="text-[11px] text-slate-500 font-medium">
                  Currency: {settings.currencySymbol}
                </span>
              </div>

              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-extrabold text-[10px]">
                    <th className="py-2.5 px-3 rounded-l-lg w-10 text-center">#</th>
                    <th className="py-2.5 px-3">Item Description & SKU</th>
                    <th className="py-2.5 px-3 text-center w-24">Requested Qty</th>
                    <th className="py-2.5 px-3 text-right w-28">Indicative Cost</th>
                    <th className="py-2.5 px-3 text-right w-28">Est. Line Total</th>
                    <th className="py-2.5 px-3 rounded-r-lg w-40 text-center border-l border-slate-200 bg-slate-200/60">
                      Supplier Price & Availability
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                  {po.items.map((item, idx) => (
                    <tr key={item.productId || idx} className="hover:bg-slate-50/50">
                      <td className="py-3 px-3 text-center text-slate-400 font-mono text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-bold text-slate-900">{item.productName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          SKU: {item.sku}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-center font-bold font-mono">
                        {item.quantity} units
                      </td>
                      <td className="py-3 px-3 text-right font-mono">
                        {settings.currencySymbol}{item.unitCost.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold font-mono text-slate-900">
                        {settings.currencySymbol}{(item.quantity * item.unitCost).toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-center border-l border-slate-200 bg-slate-50/50">
                        <div className="text-[10px] text-slate-500 space-y-0.5">
                          <div className="flex items-center justify-center gap-2">
                            <span>[ &nbsp; ] Avail.</span>
                            <span>[ &nbsp; ] Out of stock</span>
                          </div>
                          <div className="text-slate-400 font-mono">
                            Price: ________________
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Totals Calculation Box */}
            <div className="flex flex-col sm:flex-row justify-between gap-6 pt-2">
              <div className="sm:max-w-xs space-y-2 text-xs text-slate-600">
                <p className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                  Important Notes & Instructions:
                </p>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  1. This order note serves to establish product availability and verified net costs.
                  <br />
                  2. If any price adjustments or substitutions are needed, please annotate them or contact us immediately.
                  <br />
                  3. Please reply with availability lead time prior to shipping.
                </p>
              </div>

              <div className="w-full sm:w-72 bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Items Subtotal (Est.):</span>
                  <span className="font-mono font-bold">
                    {settings.currencySymbol}{totalItemsSubtotal.toFixed(2)}
                  </span>
                </div>

                {po.deliveryFee !== undefined && po.deliveryFee > 0 && (
                  <div className="flex justify-between text-blue-700">
                    <span>Target Logistics Allowance:</span>
                    <span className="font-mono font-bold">
                      +{settings.currencySymbol}{po.deliveryFee.toFixed(2)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t-2 border-slate-300 font-bold text-sm text-slate-900">
                  <span>Estimated Total:</span>
                  <span className="font-mono font-black text-base text-blue-700">
                    {settings.currencySymbol}{po.totalAmount.toFixed(2)}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 text-right italic">
                  *Final amount confirmed upon order placement.
                </p>
              </div>
            </div>

            {/* Signatures & Confirmations */}
            <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200">
              <div className="space-y-4">
                <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  Issued By (Buyer):
                </p>
                <div className="h-14 border-b border-dashed border-slate-400 flex items-end pb-1">
                  <span className="text-xs font-medium text-slate-700">{po.createdBy}</span>
                </div>
                <p className="text-[10px] text-slate-400">Authorized Signature & Date</p>
              </div>

              <div className="space-y-4">
                <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  Confirmed By Supplier:
                </p>
                <div className="h-14 border-b border-dashed border-slate-400 flex items-end pb-1">
                  <span className="text-[10px] text-slate-400 italic">Signature / Stamp & Date</span>
                </div>
                <p className="text-[10px] text-slate-400">Authorized Vendor Acceptance</p>
              </div>
            </div>

          </div>
        </div>

        {/* Modal Bottom Bar */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-500">
            <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{po.poNumber}</span>
            <span>•</span>
            <span>{po.items.length} item{po.items.length === 1 ? '' : 's'}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Order Note</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
