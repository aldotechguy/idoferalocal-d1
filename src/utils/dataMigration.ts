/**
 * Data Migration & Normalization Utility
 * Ensures data integrity and schema compatibility across:
 * - Production Cloudflare D1
 * - Local IndexedDB
 * - Backup JSON files (Google Drive & manual exports)
 */

export function migrateRecord(collection: string, record: any): any {
  if (!record || typeof record !== 'object') return record;

  const migrated = { ...record };

  switch (collection) {
    case 'purchases': {
      // Ensure draft flag consistency
      if (typeof migrated.isDraft !== 'boolean') {
        migrated.isDraft = migrated.deliveryStatus === 'Draft';
      }

      // Ensure deliveryStatus validity
      if (!migrated.deliveryStatus) {
        migrated.deliveryStatus = migrated.isDraft ? 'Draft' : 'Pending';
      }

      // Ensure inspectionStatus
      if (!migrated.inspectionStatus) {
        migrated.inspectionStatus = migrated.deliveryStatus === 'Received' ? 'Passed' : 'Pending';
      }

      // Ensure quotation & notes strings
      if (typeof migrated.quotationNotes !== 'string') {
        migrated.quotationNotes = migrated.quotationNotes ? String(migrated.quotationNotes) : '';
      }
      if (typeof migrated.notes !== 'string') {
        migrated.notes = migrated.notes ? String(migrated.notes) : '';
      }

      // Ensure receivingHistory array
      if (!Array.isArray(migrated.receivingHistory)) {
        migrated.receivingHistory = [];
      }

      // Numeric sanitization
      migrated.totalAmount = Number(migrated.totalAmount || 0);
      migrated.paidAmount = Number(
        migrated.paidAmount ?? (migrated.paymentStatus === 'Paid' ? migrated.totalAmount : 0)
      );
      migrated.deliveryFee = Number(migrated.deliveryFee || 0);
      migrated.localLogisticsFee = Number(migrated.localLogisticsFee || 0);

      // Payment status
      if (!migrated.paymentStatus) {
        migrated.paymentStatus =
          migrated.paidAmount >= migrated.totalAmount && migrated.totalAmount > 0
            ? 'Paid'
            : 'Unpaid';
      }

      // Items array normalization
      if (Array.isArray(migrated.items)) {
        migrated.items = migrated.items.map((it: any, idx: number) => {
          if (!it || typeof it !== 'object') return it;
          const qty = Number(it.quantity || 0);
          const unitCost = Number(it.unitCost || 0);
          const total = Number(it.total ?? qty * unitCost);
          const isReceived = migrated.deliveryStatus === 'Received';

          return {
            ...it,
            productId: it.productId || `unknown-prod-${idx}`,
            productName: it.productName || 'Unspecified Product',
            sku: it.sku || 'N/A',
            quantity: qty,
            unitCost,
            total,
            receivedQuantity: Number(it.receivedQuantity ?? (isReceived ? qty : 0)),
            acceptedQuantity: Number(it.acceptedQuantity ?? (isReceived ? qty : 0)),
            damagedQuantity: Number(it.damagedQuantity ?? 0),
            customRetailPrice:
              it.customRetailPrice !== undefined ? Number(it.customRetailPrice) : undefined,
            oldUnitCost: it.oldUnitCost !== undefined ? Number(it.oldUnitCost) : undefined,
            oldRetailPrice: it.oldRetailPrice !== undefined ? Number(it.oldRetailPrice) : undefined,
            updateCatalogCost: it.updateCatalogCost !== undefined ? Boolean(it.updateCatalogCost) : true,
            updateCatalogRetailPrice: Boolean(it.updateCatalogRetailPrice),
          };
        });
      } else {
        migrated.items = [];
      }
      break;
    }

    case 'moneyMovements': {
      migrated.amount = Math.abs(Number(migrated.amount || 0));
      migrated.date = migrated.date || migrated.createdAt || new Date().toISOString();
      migrated.type = migrated.type || 'Balance Adjustment';
      migrated.performedBy = migrated.performedBy || 'System';
      migrated.createdAt = migrated.createdAt || migrated.date || new Date().toISOString();
      if (migrated.referenceId !== undefined && migrated.referenceId !== null) {
        migrated.referenceId = String(migrated.referenceId);
      }
      if (migrated.subtype !== undefined && migrated.subtype !== null) {
        migrated.subtype = String(migrated.subtype);
      }
      break;
    }

    case 'products': {
      migrated.currentStock = Number(migrated.currentStock ?? 0);
      migrated.costPrice = Number(migrated.costPrice ?? 0);
      migrated.retailPrice = Number(migrated.retailPrice ?? 0);
      migrated.wholesalePrice = Number(migrated.wholesalePrice ?? 0);
      migrated.minimumSellingPrice = Number(
        migrated.minimumSellingPrice ?? migrated.costPrice ?? 0
      );
      migrated.minWholesaleQty = Number(migrated.minWholesaleQty ?? 10);
      migrated.minimumStockLevel = Number(migrated.minimumStockLevel ?? 5);

      if (migrated.dealerPrice !== undefined && migrated.dealerPrice !== null) {
        migrated.dealerPrice = Number(migrated.dealerPrice);
      }

      migrated.status = migrated.status === 'Archived' ? 'Archived' : 'Active';
      break;
    }

    case 'sales': {
      migrated.totalAmount = Number(migrated.totalAmount ?? 0);
      migrated.subtotal = Number(migrated.subtotal ?? migrated.totalAmount ?? 0);
      migrated.paidAmount = Number(migrated.paidAmount ?? migrated.totalAmount ?? 0);
      migrated.deliveryFee = Number(migrated.deliveryFee ?? 0);
      migrated.discount = Number(migrated.discount ?? 0);
      migrated.tax = Number(migrated.tax ?? 0);
      migrated.status = migrated.status || 'Completed';
      migrated.paymentMethod = migrated.paymentMethod || 'Cash';

      if (Array.isArray(migrated.items)) {
        migrated.items = migrated.items.map((it: any) => {
          if (!it || typeof it !== 'object') return it;
          const qty = Number(it.quantity || 0);
          const unitPrice = Number(it.unitPrice || 0);
          return {
            ...it,
            quantity: qty,
            unitPrice,
            costPrice: Number(it.costPrice || 0),
            total: Number(it.total ?? qty * unitPrice),
          };
        });
      } else {
        migrated.items = [];
      }

      const isHist = Boolean(
        migrated.isHistorical ||
        (typeof migrated.id === 'string' && migrated.id.startsWith('sale-imp-')) ||
        (typeof migrated.notes === 'string' &&
          (migrated.notes.includes('Historical') ||
            migrated.notes.includes('Past Entry') ||
            migrated.notes.includes('Import Wizard')))
      );
      if (isHist) {
        migrated.isHistorical = true;
      }
      if (migrated.expenseId !== undefined && migrated.expenseId !== null) {
        migrated.expenseId = String(migrated.expenseId);
      }
      break;
    }

    case 'expenses': {
      migrated.amount = Number(migrated.amount || 0);
      migrated.date = migrated.date || (migrated.createdAt ? String(migrated.createdAt).slice(0, 10) : new Date().toISOString().slice(0, 10));
      migrated.category = migrated.category || 'Miscellaneous';
      migrated.paymentMethod = migrated.paymentMethod || 'Cash';

      const isHistExp = Boolean(
        migrated.isHistorical ||
        (typeof migrated.id === 'string' && migrated.id.startsWith('exp-hist-')) ||
        (typeof migrated.title === 'string' && migrated.title.includes('Historical')) ||
        (typeof migrated.description === 'string' && migrated.description.includes('Historical'))
      );
      if (isHistExp) {
        migrated.isHistorical = true;
      }
      if (migrated.saleId !== undefined && migrated.saleId !== null) {
        migrated.saleId = String(migrated.saleId);
      }
      if (typeof migrated.title === 'string' && (migrated.title.includes('Logistics') || migrated.title.includes('Delivery Fee'))) {
        migrated.category = 'Logistics';
      }
      break;
    }

    default:
      break;
  }

  return migrated;
}

/**
 * Normalizes all collections in a snapshot or backup object and reconciles historical delivery expenses
 */
export function migrateSnapshot(stores: Record<string, any[]>): Record<string, any[]> {
  if (!stores || typeof stores !== 'object') return {};

  const result: Record<string, any[]> = {};

  for (const [collection, records] of Object.entries(stores)) {
    if (!Array.isArray(records)) {
      if (records && typeof records === 'object') {
        result[collection] = [migrateRecord(collection, records)];
      }
      continue;
    }

    result[collection] = records
      .filter((r) => r && typeof r === 'object')
      .map((r) => migrateRecord(collection, r));
  }

  // Ensure essential collections exist as arrays
  if (!result.sales) result.sales = [];
  if (!result.expenses) result.expenses = [];
  if (!result.moneyMovements) result.moneyMovements = [];
  if (!result.purchases) result.purchases = [];

  // Older POS builds saved the real split in sale notes but generated a false
  // 50/50 Till/Bank ledger split. Recover those exact amounts deterministically.
  const splitBreakdowns = new Map<string, {cash: number; bank: number}>();
  result.sales.forEach((sale: any) => {
    if (sale.paymentMethod !== 'Split' || !sale.id) return;
    const stored = sale.paymentBreakdown || {};
    let cash = Number(stored.Cash) || 0;
    let bank =
      (Number(stored.Card) || 0) +
      (Number(stored['Mobile Transfer']) || 0) +
      (Number(stored['Bank Transfer']) || 0);

    if (cash <= 0 && bank <= 0 && typeof sale.notes === 'string') {
      const readAmount = (label: string) => {
        const match = sale.notes.match(new RegExp(`${label}:\\s*[^0-9-]*([0-9,]+(?:\\.[0-9]+)?)`, 'i'));
        return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
      };
      cash = readAmount('Cash');
      bank = readAmount('Card') + readAmount('Mobile Transfer') + readAmount('Bank Transfer');
      if (cash > 0 || bank > 0) {
        sale.paymentBreakdown = { Cash: cash, Card: readAmount('Card'), 'Mobile Transfer': readAmount('Mobile Transfer'), 'Bank Transfer': readAmount('Bank Transfer') };
      }
    }

    if (cash > 0 || bank > 0) splitBreakdowns.set(String(sale.id), {cash, bank});
  });

  // Cross-collection Historical Delivery Fee reconciliation
  const historicalSalesWithDelivery = result.sales.filter((s: any) => {
    const isHist = Boolean(
      s.isHistorical ||
      (typeof s.id === 'string' && s.id.startsWith('sale-imp-')) ||
      (typeof s.notes === 'string' &&
        (s.notes.includes('Historical') || s.notes.includes('Past Entry') || s.notes.includes('Import Wizard')))
    );
    return isHist && (Number(s.deliveryFee) || 0) > 0;
  });

  historicalSalesWithDelivery.forEach((sale: any) => {
    const fee = Number(sale.deliveryFee) || 0;
    if (fee <= 0) return;

    let linkedExpense = result.expenses.find((e: any) => {
      if (sale.expenseId && e.id === sale.expenseId) return true;
      if (e.saleId && e.saleId === sale.id) return true;
      if (e.category === 'Logistics') {
        if (e.description && typeof e.description === 'string' && e.description.includes(sale.id)) return true;
        if (sale.invoiceNo && sale.invoiceNo !== 'N/A' && (
          (typeof e.title === 'string' && e.title.includes(sale.invoiceNo)) ||
          (typeof e.description === 'string' && e.description.includes(sale.invoiceNo))
        )) return true;
        const shortId = typeof sale.id === 'string' ? sale.id.slice(-6).toUpperCase() : '';
        if (shortId && (
          (typeof e.title === 'string' && e.title.includes(shortId)) ||
          (typeof e.description === 'string' && e.description.includes(shortId))
        )) return true;
      }
      return false;
    });

    if (linkedExpense) {
      linkedExpense.isHistorical = true;
      linkedExpense.saleId = sale.id;
      linkedExpense.amount = fee;
      sale.expenseId = linkedExpense.id;
    } else {
      // Auto-generate missing Historical Logistics Expense
      const invoiceRef = sale.invoiceNo && sale.invoiceNo !== 'N/A'
        ? sale.invoiceNo
        : (typeof sale.id === 'string' ? sale.id.slice(-6).toUpperCase() : 'HIST');
      const expId = sale.expenseId || `exp-hist-${sale.id}`;
      const saleDate = sale.createdAt ? String(sale.createdAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
      const saleIso = sale.createdAt || new Date().toISOString();

      const newExpense = {
        id: expId,
        title: `Logistics Delivery Fee - Historical (${invoiceRef})`,
        category: 'Logistics',
        amount: fee,
        description: `Historical delivery fee expense for ${sale.customerName || 'Walk-in Customer'}. Sale ${invoiceRef}.${sale.notes ? ' ' + sale.notes : ''}`.trim(),
        paidBy: sale.createdBy || 'Administrator',
        paymentMethod: sale.paymentMethod === 'Split' ? 'Cash' : (sale.paymentMethod || 'Cash'),
        date: saleDate,
        createdAt: saleIso,
        isHistorical: true,
        saleId: sale.id,
      };

      result.expenses.push(newExpense);
      sale.expenseId = expId;

    }
  });

  // Ensure Money Movements never contain historical sale inflows or historical delivery expense outflows
  if (result.moneyMovements && Array.isArray(result.moneyMovements)) {
    const historicalSaleIds = new Set(
      (result.sales || [])
        .filter((s: any) => Boolean(
          s.isHistorical ||
          (typeof s.id === 'string' && s.id.startsWith('sale-imp-')) ||
          (typeof s.notes === 'string' &&
            (s.notes.includes('Historical') || s.notes.includes('Past Entry') || s.notes.includes('Import Wizard')))
        ))
        .map((s: any) => s.id)
    );

    result.moneyMovements = result.moneyMovements.filter((m: any) => {
      if (typeof m.id === 'string' && m.id.startsWith('mm-hist-')) return false;
      if (typeof m.referenceNo === 'string' && m.referenceNo.includes('Historical')) return false;
      if (typeof m.notes === 'string' && m.notes.includes('Historical')) return false;
      if (m.type === 'Sale Inflow' && m.referenceId && historicalSaleIds.has(m.referenceId)) return false;
      return true;
    });

    splitBreakdowns.forEach(({cash, bank}, saleId) => {
      const inflows = result.moneyMovements.filter(
        (m: any) => m.type === 'Sale Inflow' && String(m.referenceId || '') === saleId,
      );
      const cashMovement = inflows.find((m: any) => m.destinationAccount === 'Physical Cash');
      const bankMovement = inflows.find((m: any) => m.destinationAccount === 'Biz Account');
      if (cashMovement) cashMovement.amount = cash;
      if (bankMovement) bankMovement.amount = bank;
    });
    result.moneyMovements = result.moneyMovements.filter((m: any) => Number(m.amount) > 0);
  }

  return result;
}
