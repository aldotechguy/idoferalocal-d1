import React, { useMemo } from 'react';
import { Sale } from '../../types';
import { useApp } from '../../context/AppContext';
import { Printer, X, Download, CheckCircle2, AlertTriangle, AlertCircle, Phone, MapPin, CreditCard } from 'lucide-react';

interface ReceiptModalProps {
  sale: Sale | null;
  onClose: () => void;
  omitFooterDetails?: boolean;
  omitDebtStatement?: boolean;
  modalTitle?: string;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ sale, onClose, omitFooterDetails = false, omitDebtStatement = false, modalTitle = 'Transaction Receipt & Invoice' }) => {
  const { settings, customers } = useApp();

  const getStaffDisplayName = (rawName?: string) => {
    if (!rawName || typeof rawName !== 'string') return 'Staff';
    let name = (rawName.split('(')[0] || '').trim();
    if (name.includes('@')) {
      const handle = name.split('@')[0] || '';
      name = handle.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return name || 'Staff';
  };

  // Find linked customer profile if available
  const customer = useMemo(() => {
    if (!sale) return null;
    return customers.find(
      (c) =>
        (sale.customerId && c.id === sale.customerId) ||
        (sale.customerName &&
          sale.customerName.toLowerCase() !== 'walk-in customer' &&
          c.name.trim().toLowerCase() === sale.customerName.trim().toLowerCase())
    );
  }, [sale, customers]);

  if (!sale) return null;

  const toAmount = (value: unknown, fallback = 0) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : fallback;
  };
  const formatAmount = (value: unknown) => toAmount(value).toFixed(2);
  const saleItems = Array.isArray(sale.items) ? sale.items : [];

  // Financial & Debt Calculations
  const invoiceTotal = toAmount(sale.totalAmount);
  const invoicePaid = sale.paidAmount !== undefined ? toAmount(sale.paidAmount, invoiceTotal) : invoiceTotal;
  const invoiceUnpaid = Math.max(0, invoiceTotal - invoicePaid);
  const invoiceChange = Math.max(0, invoicePaid - invoiceTotal);

  // Customer Account Balance calculations
  // customerTotalDebt is the total balance on the customer record
  // previousDebt is any pre-existing debt prior to this invoice
  const customerTotalDebt = customer ? Number(customer.outstandingBalance) || 0 : invoiceUnpaid;
  const previousDebt = Math.max(0, customerTotalDebt - invoiceUnpaid);
  // Has prior outstanding debt on customer ledger
  const hasPriorDebt = previousDebt > 0;

  const handlePrint = () => {
    const printableElement = document.getElementById('printable-receipt');
    if (!printableElement) {
      window.print();
      return;
    }

    try {
      // Create a hidden iframe specifically for printing to prevent blank pages in iframes/webviews
      const printIframe = document.createElement('iframe');
      printIframe.style.position = 'fixed';
      printIframe.style.right = '0';
      printIframe.style.bottom = '0';
      printIframe.style.width = '0';
      printIframe.style.height = '0';
      printIframe.style.border = '0';
      document.body.appendChild(printIframe);

      const iframeDoc = printIframe.contentWindow?.document || printIframe.contentDocument;
      if (iframeDoc) {
        iframeDoc.open();
        iframeDoc.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Invoice - ${sale.invoiceNo || 'Receipt'}</title>
              <style>
                @page {
                  margin: 5mm;
                  size: auto;
                }
                * {
                  box-sizing: border-box;
                  margin: 0;
                  padding: 0;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, monospace, sans-serif;
                }
                body {
                  padding: 10px;
                  color: #000;
                  background: #fff;
                  font-size: 12px;
                  max-width: 480px;
                  margin: 0 auto;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .text-left { text-align: left; }
                .font-bold { font-weight: bold; }
                .font-semibold { font-weight: 600; }
                .font-mono { font-family: monospace; }
                .font-sans { font-family: sans-serif; }
                .italic { font-style: italic; }
                .uppercase { text-transform: uppercase; }
                .truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                
                .space-y-1 > * + * { margin-top: 4px; }
                .space-y-2 > * + * { margin-top: 8px; }
                .space-y-4 > * + * { margin-top: 16px; }
                
                .flex { display: flex; }
                .justify-between { justify-content: space-between; }
                .items-center { align-items: center; }
                .items-start { align-items: flex-start; }
                
                .grid { display: grid; }
                .grid-cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)); }
                .col-span-2 { grid-column: span 2 / span 2; }
                .col-span-4 { grid-column: span 4 / span 4; }
                .col-span-6 { grid-column: span 6 / span 6; }
                
                .border-t { border-top: 1px solid #000; }
                .border-b { border-bottom: 1px solid #000; }
                .border-dashed { border-style: dashed; }
                .border { border: 1px solid #000; }
                
                .p-1\\.5 { padding: 6px; }
                .p-3 { padding: 12px; }
                .p-6 { padding: 16px; }
                .py-0\\.5 { padding-top: 2px; padding-bottom: 2px; }
                .py-3 { padding-top: 10px; padding-bottom: 10px; }
                .pb-1 { padding-bottom: 4px; }
                .pb-1\\.5 { padding-bottom: 6px; }
                .pb-3 { padding-bottom: 10px; }
                .pt-1 { padding-top: 4px; }
                .pt-1\\.5 { padding-top: 6px; }
                .pt-2 { padding-top: 8px; }
                .pt-3 { padding-top: 10px; }
                
                .text-\\[9px\\] { font-size: 9px; }
                .text-\\[10px\\] { font-size: 10px; }
                .text-\\[11px\\] { font-size: 11px; }
                .text-xs { font-size: 12px; }
                .text-sm { font-size: 13px; }
                .text-base { font-size: 15px; }
                .rounded-xl { border-radius: 8px; }
                .rounded-lg { border-radius: 6px; }
                .rounded { border-radius: 4px; }
                
                .debt-box {
                  border: 1px dashed #000;
                  padding: 8px;
                  margin-top: 10px;
                  border-radius: 6px;
                }
                .due-box {
                  border: 1px solid #000;
                  padding: 6px;
                  margin-top: 4px;
                  border-radius: 4px;
                  font-weight: bold;
                }
              </style>
            </head>
            <body>
              ${printableElement.innerHTML}
            </body>
          </html>
        `);
        iframeDoc.close();

        setTimeout(() => {
          printIframe.contentWindow?.focus();
          printIframe.contentWindow?.print();
          setTimeout(() => {
            document.body.removeChild(printIframe);
          }, 1000);
        }, 250);
      } else {
        window.print();
      }
    } catch (e) {
      console.error('Iframe print failed, falling back to direct window.print', e);
      window.print();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static print-container-root">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full my-auto overflow-hidden flex flex-col max-h-[90vh] print:max-h-none print:shadow-none print:border-none print:rounded-none print:w-full print:max-w-none">
        {/* Modal Header (Hidden on Print) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 print:hidden">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
            <CheckCircle2 className="w-5 h-5" />
            <span>{modalTitle}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Thermal Receipt Area */}
        <div id="printable-receipt" className="p-6 overflow-y-auto font-mono text-xs text-slate-800 dark:text-slate-200 space-y-4 print:p-4 print:text-black">
          {/* Store Logo & Header */}
          <div className="text-center space-y-1 pb-3 border-b border-dashed border-slate-300 dark:border-slate-700 print:border-black">
            <h2 className="text-base font-bold font-sans tracking-tight text-slate-900 dark:text-white print:text-black">
              {settings.storeName}
            </h2>
            <p className="text-[11px] text-slate-500 font-sans print:text-black">{settings.address}</p>
            <p className="text-[11px] text-slate-500 font-sans print:text-black">Tel: {settings.phone}</p>
            <p className="text-[10px] text-slate-400 font-sans italic mt-1 print:text-black">
              {settings.receiptHeader}
            </p>
          </div>

          {/* Invoice Info & Customer Details */}
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-500 print:text-black">Invoice No:</span>
              <span className="font-bold font-mono">
                {sale.invoiceNo && sale.invoiceNo !== 'N/A' ? sale.invoiceNo : 'N/A (Historical Sale)'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 print:text-black">Date & Time:</span>
              <span>{new Date(sale.createdAt).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-slate-500 print:text-black">Customer:</span>
              <div className="text-right">
                <span className="font-semibold">{sale.customerName}</span>
                {customer?.phone && (
                  <div className="text-[10px] text-slate-500 print:text-black font-mono">{customer.phone}</div>
                )}
                {customer?.address && (
                  <div className="text-[9px] text-slate-400 print:text-black font-sans truncate max-w-[200px]">{customer.address}</div>
                )}
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 print:text-black">Payment Method:</span>
              <span className="font-semibold">{sale.paymentMethod}</span>
            </div>
            {sale.notes && (
              <div className="pt-1 text-[10px] text-slate-600 dark:text-slate-400 border-t border-dashed border-slate-200 dark:border-slate-800 print:border-black print:text-black">
                <span className="font-bold text-slate-500 print:text-black">Note / Split Details:</span>
                <p className="font-sans italic">{sale.notes}</p>
              </div>
            )}
          </div>

          {/* Items Table */}
          <div className="border-t border-b border-dashed border-slate-300 dark:border-slate-700 py-3 space-y-2 print:border-black">
            <div className="grid grid-cols-12 font-bold text-[10px] uppercase text-slate-500 print:text-black pb-1">
              <span className="col-span-6">Item</span>
              <span className="col-span-2 text-center">Qty</span>
              <span className="col-span-4 text-right">Total</span>
            </div>
            {saleItems.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 text-[11px] items-start py-0.5">
                <span className="col-span-6 font-sans font-medium pr-1">
                  <div className="text-slate-900 dark:text-white font-semibold print:text-black">
                    {item.isClearance ? `[CLEARANCE] ${item.productName}` : item.productName}
                  </div>
                  <div className="text-[9px] text-slate-400 font-mono print:text-black">
                    {toAmount(item.quantity)} x {settings.currencySymbol}{formatAmount(item.unitPrice)}
                    {item.isClearance ? ' • Clearance / Non-Inventory' : item.sku && item.sku !== 'N/A' ? ` • SKU: ${item.sku}` : ''}
                  </div>
                  {item.isClearance && item.clearanceDescription && (
                    <div className="text-[9px] text-slate-500 font-sans italic print:text-black mt-0.5">
                      Note: {item.clearanceDescription}
                    </div>
                  )}
                </span>
                <span className="col-span-2 text-center font-bold text-slate-700 dark:text-slate-300 print:text-black mt-0.5">{toAmount(item.quantity)}</span>
                <span className="col-span-4 text-right font-bold text-slate-900 dark:text-white print:text-black mt-0.5">
                  {settings.currencySymbol}{formatAmount(item.total ?? (toAmount(item.unitPrice) * toAmount(item.quantity)))}
                </span>
              </div>
            ))}
          </div>

          {/* Totals & Immediate Payment Breakdown */}
          <div className="space-y-1 text-[11px] pt-1">
            <div className="flex justify-between text-slate-500 print:text-black">
              <span>Subtotal:</span>
              <span>{settings.currencySymbol}{formatAmount(sale.subtotal)}</span>
            </div>
            {sale.discount > 0 && (
              <div className="flex justify-between text-rose-600 font-semibold print:text-black">
                <span>Discount:</span>
                <span>-{settings.currencySymbol}{formatAmount(sale.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-500 print:text-black">
              <span>Tax ({settings.taxRatePct}%):</span>
              <span>{settings.currencySymbol}{formatAmount(sale.tax)}</span>
            </div>
            {!!sale.deliveryFee && sale.deliveryFee > 0 && (
              <div className="flex justify-between text-slate-800 dark:text-slate-200 font-semibold print:text-black">
                <span>Delivery Fee:</span>
                <span>+{settings.currencySymbol}{formatAmount(sale.deliveryFee)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold border-t border-slate-300 dark:border-slate-700 pt-2 text-slate-900 dark:text-white print:text-black print:border-black">
              <span>TOTAL INVOICE:</span>
              <span className="font-mono">{settings.currencySymbol}{formatAmount(invoiceTotal)}</span>
            </div>

            {/* Payment & Balance Breakdown */}
            <div className="pt-2 border-t border-dashed border-slate-200 dark:border-slate-800 space-y-1 print:border-black">
              <div className="flex justify-between text-slate-700 dark:text-slate-300 font-semibold print:text-black">
                <span>Amount Paid ({sale.paymentMethod}):</span>
                <span className="font-mono">{settings.currencySymbol}{formatAmount(invoicePaid)}</span>
              </div>

              {invoiceChange > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold print:text-black">
                  <span>Change Given:</span>
                  <span className="font-mono">+{settings.currencySymbol}{formatAmount(invoiceChange)}</span>
                </div>
              )}

              {invoiceUnpaid > 0 ? (
                <div className="flex justify-between items-center text-rose-600 dark:text-rose-400 font-extrabold text-xs bg-rose-50 dark:bg-rose-950/40 p-1.5 rounded-lg border border-rose-200 dark:border-rose-800 print:bg-transparent print:border-black print:text-black">
                  <span className="flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 print:hidden" />
                    <span>Invoice Balance Due (Debt):</span>
                  </span>
                  <span className="font-mono text-sm">{settings.currencySymbol}{formatAmount(invoiceUnpaid)}</span>
                </div>
              ) : (
                <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400 font-bold text-[10px] bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded print:bg-transparent print:text-black">
                  <span>Payment Status:</span>
                  <span className="uppercase font-mono">Paid In Full ✓</span>
                </div>
              )}
            </div>
          </div>

          {/* OUTSTANDING DEBT & CUSTOMER ACCOUNT STATEMENT SECTION: Only show when customer already has prior outstanding debt */}
          {hasPriorDebt && !omitDebtStatement && (
            <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 print:bg-transparent print:border-black print:p-2">
              <div className="flex items-center justify-between border-b border-dashed border-slate-300 dark:border-slate-700 pb-1.5 print:border-black">
                <span className="font-sans font-bold text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 print:text-black flex items-center gap-1">
                  <CreditCard className="w-3 h-3 text-slate-500 print:hidden" />
                  <span>Customer Debt Statement</span>
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 print:border-black print:text-black print:bg-transparent">
                  PRIOR DEBT ON FILE
                </span>
              </div>

              <div className="space-y-1 text-[10px] text-slate-600 dark:text-slate-400 print:text-black">
                <div className="flex justify-between">
                  <span>Previous Outstanding Debt:</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 print:text-black">
                    {settings.currencySymbol}{formatAmount(previousDebt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Current Invoice Balance Due:</span>
                  <span className={`font-mono font-semibold ${invoiceUnpaid > 0 ? 'text-rose-600 dark:text-rose-400 print:text-black' : 'text-slate-800 dark:text-slate-200 print:text-black'}`}>
                    {settings.currencySymbol}{formatAmount(invoiceUnpaid)}
                  </span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-900 dark:text-white print:text-black print:border-black">
                  <span>Total Cumulative Account Debt:</span>
                  <span className="font-mono text-rose-600 dark:text-rose-400 print:text-black font-black">
                    {settings.currencySymbol}{formatAmount(customerTotalDebt)}
                  </span>
                </div>
              </div>

              <div className="p-1.5 bg-rose-50/80 dark:bg-rose-950/30 rounded border border-rose-200/80 dark:border-rose-900 text-[9px] font-sans text-rose-700 dark:text-rose-300 leading-tight print:border-black print:text-black print:bg-transparent">
                <strong>Notice:</strong> Prior debt of <strong>{settings.currencySymbol}{formatAmount(previousDebt)}</strong> exists. Combined balance due is <strong>{settings.currencySymbol}{formatAmount(customerTotalDebt)}</strong>.
              </div>
            </div>
          )}

          {!omitFooterDetails && (
            /* Workshop prints intentionally omit the disclaimer and server/staff footer. */
            <div className="text-center pt-3 border-t border-dashed border-slate-300 dark:border-slate-700 font-sans text-[10px] text-slate-500 print:text-black print:border-black">
              <p>{settings.receiptFooter}</p>
              <p className="mt-1 font-bold text-slate-800 dark:text-slate-200 print:text-black">
                Served by: {getStaffDisplayName(sale.createdBy)}
              </p>
              {sale.orderTakenBy && sale.orderTakenBy !== sale.createdBy && (
                <p className="text-[9px] text-slate-500 font-medium print:text-black">
                  Order Taken by: {getStaffDisplayName(sale.orderTakenBy)}
                </p>
              )}
              {sale.convertedBy && sale.convertedBy !== sale.createdBy && (
                <p className="text-[9px] text-slate-500 font-medium print:text-black">
                  Converted by: {getStaffDisplayName(sale.convertedBy)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Modal Actions (Hidden during print) */}
        <div className="flex items-center justify-end gap-3 p-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 print:hidden">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Print Invoice</span>
          </button>
        </div>
      </div>
    </div>
  );
};
