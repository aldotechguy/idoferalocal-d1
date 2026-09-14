import React, { useMemo, useState } from 'react';
import { AlertTriangle, Eye, Minus, Plus, ReceiptText, X } from 'lucide-react';
import { Sale, SaleItem } from '../../types';
import { useApp } from '../../context/AppContext';
import { ReceiptModal } from '../common/ReceiptModal';

interface InvoiceWorkshopModalProps {
  sale: Sale;
  onClose: () => void;
}

export const InvoiceWorkshopModal: React.FC<InvoiceWorkshopModalProps> = ({ sale, onClose }) => {
  const { settings } = useApp();
  const [items, setItems] = useState<SaleItem[]>(() => sale.items.map((item) => ({ ...item })));
  const [matchPaidToTotal, setMatchPaidToTotal] = useState(true);
  const [manualPaidAmount, setManualPaidAmount] = useState(() => Math.max(0, sale.paidAmount || sale.totalAmount || 0));
  const [showPreview, setShowPreview] = useState(false);

  const updateItem = (index: number, field: 'quantity' | 'unitPrice', rawValue: string) => {
    const parsed = Number(rawValue);
    const nextValue = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const updated = { ...item, [field]: nextValue };
        return { ...updated, total: updated.quantity * updated.unitPrice };
      })
    );
  };

  const workshopTotals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const discount = Math.min(Math.max(0, sale.discount || 0), subtotal);
    const taxableAmount = Math.max(0, subtotal - discount);
    const tax = taxableAmount * (Math.max(0, settings.taxRatePct || 0) / 100);
    const deliveryFee = Math.max(0, sale.deliveryFee || 0);

    return { subtotal, discount, tax, deliveryFee, totalAmount: taxableAmount + tax + deliveryFee };
  }, [items, sale.deliveryFee, sale.discount, settings.taxRatePct]);

  const paidAmount = matchPaidToTotal ? workshopTotals.totalAmount : manualPaidAmount;
  const hasPaymentShortfall = paidAmount < workshopTotals.totalAmount;

  const workshopSale = useMemo<Sale>(() => {

    return {
      ...sale,
      items: items.map((item) => ({ ...item, total: item.quantity * item.unitPrice })),
      ...workshopTotals,
      paidAmount,
    };
  }, [items, paidAmount, sale, workshopTotals]);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-4xl w-full my-auto overflow-hidden max-h-[92vh] flex flex-col">
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
            <div>
              <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-black">
                <ReceiptText className="w-5 h-5" />
                <span>Invoice Workshop</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Invoice {sale.invoiceNo} · temporary print copy
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800" aria-label="Close Invoice Workshop">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto space-y-5">
            <div className="flex items-start gap-2.5 p-3 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p><strong>Print-only workspace.</strong> Quantity and price edits remain in this window and never alter sales, inventory, customer balances, local records, D1, or the sync queue.</p>
            </div>

            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-2xl">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-500 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-3">Item</th>
                    <th className="text-center px-3 py-3 w-40">Quantity</th>
                    <th className="text-right px-3 py-3 w-44">Unit Price</th>
                    <th className="text-right px-4 py-3 w-40">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((item, index) => (
                    <tr key={`${item.productId}-${index}`}>
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900 dark:text-white">{item.productName}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{item.sku || 'N/A'}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" onClick={() => updateItem(index, 'quantity', String(Math.max(0, item.quantity - 1)))} className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800" aria-label={`Decrease ${item.productName} quantity`}><Minus className="w-3.5 h-3.5" /></button>
                          <input type="number" min="0" step="1" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} className="w-20 px-2 py-1.5 text-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-bold" />
                          <button type="button" onClick={() => updateItem(index, 'quantity', String(item.quantity + 1))} className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800" aria-label={`Increase ${item.productName} quantity`}><Plus className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-slate-400 font-bold">{settings.currencySymbol}</span>
                          <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(index, 'unitPrice', event.target.value)} className="w-28 px-2 py-1.5 text-right rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-bold" />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-900 dark:text-white">{settings.currencySymbol}{(Number(item.quantity || 0) * Number(item.unitPrice || 0)).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><strong>{settings.currencySymbol}{(Number(workshopSale.subtotal) || 0).toFixed(2)}</strong></div>
                {workshopSale.discount > 0 && <div className="flex justify-between text-rose-600"><span>Original Discount</span><strong>-{settings.currencySymbol}{(Number(workshopSale.discount) || 0).toFixed(2)}</strong></div>}
                <div className="flex justify-between"><span className="text-slate-500">Tax ({settings.taxRatePct}%)</span><strong>{settings.currencySymbol}{(Number(workshopSale.tax) || 0).toFixed(2)}</strong></div>
                {!!workshopSale.deliveryFee && <div className="flex justify-between"><span className="text-slate-500">Delivery Fee</span><strong>{settings.currencySymbol}{(Number(workshopSale.deliveryFee) || 0).toFixed(2)}</strong></div>}
                <div className="flex justify-between border-t border-slate-300 dark:border-slate-700 pt-2 text-sm"><span className="font-black">Workshop Total</span><strong>{settings.currencySymbol}{(Number(workshopSale.totalAmount) || 0).toFixed(2)}</strong></div>
                <div className="pt-3 mt-2 border-t border-dashed border-slate-300 dark:border-slate-700 space-y-2">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span>
                      <span className="block font-bold text-slate-800 dark:text-slate-100">Match Amount Paid to Total</span>
                      <span className="block text-[10px] text-slate-500">Automatically keeps this invoice paid in full.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={matchPaidToTotal}
                      onChange={(event) => {
                        const shouldMatch = event.target.checked;
                        if (!shouldMatch) setManualPaidAmount(workshopSale.totalAmount);
                        setMatchPaidToTotal(shouldMatch);
                      }}
                      className="h-4 w-4 accent-indigo-600"
                    />
                  </label>
                  <label className="block">
                    <span className="block mb-1 font-bold text-slate-700 dark:text-slate-200">Amount Paid</span>
                    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 bg-white dark:bg-slate-950 ${hasPaymentShortfall ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`}>
                      <span className="font-bold text-slate-400">{settings.currencySymbol}</span>
                      <input
                        type="number"
                        min={workshopSale.totalAmount}
                        step="0.01"
                        value={paidAmount}
                        disabled={matchPaidToTotal}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setManualPaidAmount(Number.isFinite(value) ? Math.max(0, value) : 0);
                        }}
                        className="min-w-0 flex-1 bg-transparent text-right font-black outline-none disabled:text-slate-500"
                      />
                    </div>
                    {hasPaymentShortfall && <span className="block mt-1 text-[10px] font-bold text-rose-600">Amount Paid must be at least the Workshop Total. No debt is allowed on a workshop invoice.</span>}
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
            <span className="text-[10px] text-slate-400">Closing this workshop discards every edit.</span>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800">Cancel</button>
              <button onClick={() => setShowPreview(true)} disabled={items.length === 0 || hasPaymentShortfall} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-sm">
                <Eye className="w-4 h-4" /> Preview & Print
              </button>
            </div>
          </div>
        </div>
      </div>

      {showPreview && (
        <ReceiptModal
          sale={workshopSale}
          onClose={() => setShowPreview(false)}
          omitFooterDetails
          omitDebtStatement
          modalTitle="Invoice Workshop Print Preview"
        />
      )}
    </>
  );
};
