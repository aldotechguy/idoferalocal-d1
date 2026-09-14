import React, { useState, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Table,
  Download,
  FileText,
  Boxes,
  Users,
  Building,
  ShoppingBag,
  MessageCircle,
  RefreshCw,
  X,
  Trash2,
  Check,
  HelpCircle,
  Database,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

type ImportCategory = 'products' | 'customers' | 'suppliers' | 'sales' | 'whatsapp';

export const ImportView: React.FC = () => {
  const {
    bulkImportProducts,
    bulkImportCustomers,
    bulkImportSuppliers,
    bulkImportSales,
    bulkImportWhatsAppPreOrders,
    settings,
  } = useApp();

  const [category, setCategory] = useState<ImportCategory>('products');
  const [fileSelected, setFileSelected] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedItems, setParsedItems] = useState<any[]>([]);
  const [selectedRows, setSelectedRows] = useState<boolean[]>([]);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sample CSV Templates for Users
  const sampleTemplates: Record<ImportCategory, string> = {
    products: `Name,SKU,Category,Cost Price,Retail Price,Wholesale Price,Current Stock,Brand\nUltra HD 4K Monitor,SKU-MON-4K,Electronics,180.00,349.99,280.00,15,Samsung\nErgonomic Keyboard,SKU-KB-MECH,Electronics,35.00,89.99,65.00,40,Logitech\nOrganic Olive Oil 500ml,SKU-OIL-01,Groceries,6.20,14.50,10.00,60,Bertolli`,
    customers: `Name,Email,Phone,Company,Type,Address,Credit Limit\nSarah Jenkins,sarah.j@example.com,+2348012345678,Apex Retailers,Wholesale,12 Marina Street Lagos,500000\nMichael Chen,m.chen@techstore.ng,+2348098765432,TechStore Ltd,Retail,45 Ikeja Plaza,100000\nAmara Okafor,amara@fashionline.com,+2348112233445,Fashion Line,Wholesale,8 Victoria Island,250000`,
    suppliers: `Name,Contact Person,Email,Phone,Category,Address,Payment Terms\nGlobal Tech Distributors,David Vance,d.vance@globaltech.com,+2348033445566,Electronics,Aba Road Port Harcourt,Net 30\nPremier Foods Ltd,Grace Nnamdi,info@premierfoods.ng,+2348055667788,Groceries,Industrial Layout Kano,Net 15\nMetro Paper Solutions,Kalu Kingsley,sales@metropaper.ng,+2348077889900,Packaging,Onitsha Market Road,Cash on Delivery`,
    sales: `Invoice No,Customer Name,Customer Phone,Total Amount,Payment Method,Status,Sale Type\nINV-2026-901,Sarah Jenkins,+2348012345678,125000.00,Bank Transfer,Completed,Wholesale\nINV-2026-902,Michael Chen,+2348098765432,34900.00,POS Card,Completed,Retail\nINV-2026-903,Walk-in Customer,,14500.00,Cash,Completed,Retail`,
    whatsapp: `Customer Name,Customer Phone,Product Name,Quantity,Unit Price,Total Amount,Status\nBlessing Eze,+2348022114433,Custom Packaging Box 100pcs,2,15000.00,30000.00,Pending Review\nTunde Bakare,+2348099887766,Luxury Velvet Ribbon 50m,5,3500.00,17500.00,Confirmed\nFatima Bello,+2348133445566,Branded Shopping Bag Large,10,2500.00,25000.00,Pending Deposit`,
  };

  const handleDownloadTemplate = () => {
    const csvContent = sampleTemplates[category];
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${category}_import_template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const parseCsvText = (text: string): any[] => {
    const lines = text.split(/\r\n|\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) return [];

    // Extract Headers
    const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

    const records: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      if (values.length === 0) continue;

      const rowObj: Record<string, any> = {};
      headers.forEach((header, idx) => {
        const val = values[idx] ? values[idx].trim() : '';
        rowObj[header] = val;
      });

      // Normalize row depending on category
      const normalized = normalizeRow(rowObj, category);
      records.push(normalized);
    }

    return records;
  };

  const parseCsvLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const normalizeRow = (row: Record<string, any>, cat: ImportCategory): any => {
    const getVal = (possibleKeys: string[], defaultVal: any = '') => {
      for (const k of possibleKeys) {
        const foundKey = Object.keys(row).find((header) => header.trim().toLowerCase().includes(k.toLowerCase()));
        if (foundKey && row[foundKey] !== undefined && row[foundKey] !== '') {
          return typeof row[foundKey] === 'string' ? row[foundKey].trim() : row[foundKey];
        }
      }
      return defaultVal;
    };

    if (cat === 'products') {
      const cost = parseFloat(getVal(['cost', 'costprice', 'cost_price', 'buy'], '10')) || 10;
      const retail = parseFloat(getVal(['retail', 'retailprice', 'price', 'selling'], '20')) || 20;
      const wholesale = parseFloat(getVal(['wholesale', 'wholesaleprice', 'bulk'], '15')) || 15;
      const stock = parseInt(getVal(['stock', 'currentstock', 'qty', 'quantity'], '10')) || 10;
      const gen4Char = () => Array.from({ length: 4 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');

      return {
        name: getVal(['name', 'product', 'title', 'item'], 'Imported Product'),
        sku: getVal(['sku', 'code', 'itemcode'], gen4Char()),
        category: getVal(['category', 'group', 'type'], 'General'),
        brand: getVal(['brand', 'manufacturer'], 'Unbranded'),
        costPrice: cost,
        retailPrice: retail,
        wholesalePrice: wholesale,
        currentStock: stock,
      };
    } else if (cat === 'customers') {
      return {
        name: getVal(['name', 'customer', 'client'], 'Imported Client'),
        email: getVal(['email', 'mail'], ''),
        phone: getVal(['phone', 'mobile', 'whatsapp', 'contact'], ''),
        company: getVal(['company', 'business', 'organization'], ''),
        type: getVal(['type', 'group'], 'Retail'),
        address: getVal(['address', 'location', 'city'], ''),
        creditLimit: parseFloat(getVal(['credit', 'limit', 'creditlimit'], '100000')) || 100000,
      };
    } else if (cat === 'suppliers') {
      return {
        name: getVal(['name', 'supplier', 'vendor'], 'Imported Vendor'),
        contactPerson: getVal(['contact', 'person', 'manager'], 'Account Rep'),
        email: getVal(['email', 'mail'], ''),
        phone: getVal(['phone', 'mobile', 'contact'], ''),
        category: getVal(['category', 'type', 'industry'], 'General Supplies'),
        address: getVal(['address', 'city'], ''),
        paymentTerms: getVal(['terms', 'paymentterms'], 'Net 30'),
      };
    } else if (cat === 'sales') {
      const total = parseFloat(getVal(['total', 'amount', 'totalamount', 'price'], '5000')) || 5000;
      return {
        invoiceNo: getVal(['invoice', 'invoiceno', 'receipt', 'ref'], `INV-IMP-${Math.floor(Math.random() * 89999 + 10000)}`),
        customerName: getVal(['customer', 'client', 'name'], 'Walk-in Customer'),
        customerPhone: getVal(['phone', 'mobile'], ''),
        totalAmount: total,
        paymentMethod: getVal(['payment', 'method', 'paymethod'], 'Cash'),
        status: getVal(['status'], 'Completed'),
        saleType: getVal(['type', 'saletype'], 'Retail'),
      };
    } else if (cat === 'whatsapp') {
      const unit = parseFloat(getVal(['unit', 'unitprice', 'price'], '2500')) || 2500;
      const qty = parseInt(getVal(['qty', 'quantity', 'count'], '1')) || 1;
      const total = parseFloat(getVal(['total', 'totalamount', 'amount'], (unit * qty).toString())) || unit * qty;

      return {
        customerName: getVal(['customer', 'client', 'name'], 'WhatsApp Client'),
        customerPhone: getVal(['phone', 'mobile', 'whatsapp'], '+234800000000'),
        items: [
          {
            productName: getVal(['product', 'item', 'productname'], 'Catalogue Item'),
            quantity: qty,
            unitPrice: unit,
            total: total,
          },
        ],
        totalAmount: total,
        status: getVal(['status'], 'Pending Review'),
      };
    }

    return row;
  };

  const processFileContent = (content: string, filename: string) => {
    setIsProcessing(true);
    setErrorMessage(null);
    setImportSuccess(null);

    try {
      let records: any[] = [];
      if (filename.endsWith('.json')) {
        const jsonParsed = JSON.parse(content);
        records = Array.isArray(jsonParsed) ? jsonParsed.map((r) => normalizeRow(r, category)) : [normalizeRow(jsonParsed, category)];
      } else {
        records = parseCsvText(content);
      }

      if (records.length === 0) {
        setErrorMessage('No valid data records could be extracted from the uploaded file. Please ensure columns match standard headers.');
        setParsedItems([]);
        setSelectedRows([]);
      } else {
        setParsedItems(records);
        setSelectedRows(records.map(() => true));
        setFileSelected(`${filename} (${records.length} records parsed)`);
      }
    } catch (err: any) {
      setErrorMessage(`File parsing error: ${err.message || 'Invalid format'}`);
      setParsedItems([]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processFileContent(text, file.name);
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processFileContent(text, file.name);
    };
    reader.readAsText(file);
  };

  const handleLoadDemoDataset = () => {
    const demoContent = sampleTemplates[category];
    processFileContent(demoContent, `demo_${category}_dataset.csv`);
  };

  const handleToggleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setSelectedRows(selectedRows.map(() => checked));
  };

  const handleToggleRow = (index: number) => {
    const updated = [...selectedRows];
    updated[index] = !updated[index];
    setSelectedRows(updated);
  };

  const handleConfirmImport = () => {
    const recordsToImport = parsedItems.filter((_, idx) => selectedRows[idx]);

    if (recordsToImport.length === 0) {
      setErrorMessage('Please select at least one record to commit import.');
      return;
    }

    if (category === 'products') {
      bulkImportProducts(recordsToImport);
    } else if (category === 'customers') {
      bulkImportCustomers(recordsToImport);
    } else if (category === 'suppliers') {
      bulkImportSuppliers(recordsToImport);
    } else if (category === 'sales') {
      bulkImportSales(recordsToImport);
    } else if (category === 'whatsapp') {
      bulkImportWhatsAppPreOrders(recordsToImport);
    }

    setImportSuccess(`Successfully imported ${recordsToImport.length} ${category} records into live workspace.`);
    setParsedItems([]);
    setSelectedRows([]);
    setFileSelected(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-6 pb-12 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Database className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <span>Historical Data Import Wizard</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Bulk import products, customers, suppliers, historical sales records (no invoices generated), and WhatsApp orders via CSV/Excel or JSON files.
          </p>
        </div>

        <button
          onClick={handleDownloadTemplate}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors self-start sm:self-auto border border-slate-200 dark:border-slate-700"
        >
          <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span>Download {category.toUpperCase()} Template (.CSV)</span>
        </button>
      </div>

      {/* Category Navigation Tabs */}
      <div className="bg-white dark:bg-slate-900 p-2 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-wrap gap-1">
        <button
          onClick={() => {
            setCategory('products');
            setParsedItems([]);
            setFileSelected(null);
          }}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs transition-all ${
            category === 'products'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>Products</span>
        </button>

        <button
          onClick={() => {
            setCategory('customers');
            setParsedItems([]);
            setFileSelected(null);
          }}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs transition-all ${
            category === 'customers'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Customers</span>
        </button>

        <button
          onClick={() => {
            setCategory('suppliers');
            setParsedItems([]);
            setFileSelected(null);
          }}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs transition-all ${
            category === 'suppliers'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Building className="w-4 h-4" />
          <span>Suppliers</span>
        </button>

        <button
          onClick={() => {
            setCategory('sales');
            setParsedItems([]);
            setFileSelected(null);
          }}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs transition-all ${
            category === 'sales'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          <span>Historical Sales</span>
        </button>

        <button
          onClick={() => {
            setCategory('whatsapp');
            setParsedItems([]);
            setFileSelected(null);
          }}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs transition-all ${
            category === 'whatsapp'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          <span>WhatsApp Orders</span>
        </button>
      </div>

      {/* Main Drag & Drop / Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`bg-white dark:bg-slate-900 border-2 border-dashed rounded-3xl p-8 text-center space-y-4 transition-all ${
          isDragging
            ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 scale-[1.01]'
            : 'border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600'
        }`}
      >
        <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto shadow-xs">
          <Upload className="w-8 h-8 animate-bounce" />
        </div>

        <div>
          <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
            Upload or Drag & Drop {category.toUpperCase()} File (.CSV, .TSV, .JSON)
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
            Automatic field auto-mapping, duplicate detection, schema validation, and real-time commit.
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.json"
          onChange={handleFileChange}
          className="hidden"
          id="csv-file-input"
        />

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <label
            htmlFor="csv-file-input"
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs transition-all cursor-pointer inline-flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Select File From Device</span>
          </label>

          <button
            type="button"
            onClick={handleLoadDemoDataset}
            className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors inline-flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
            <span>Load Demo {category.toUpperCase()} Dataset</span>
          </button>
        </div>

        {fileSelected && (
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 border border-blue-200/60 dark:border-blue-800 rounded-xl text-xs font-mono font-bold text-blue-700 dark:text-blue-300 inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>{fileSelected}</span>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-2xl text-xs font-bold inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {importSuccess && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-2xl text-xs font-bold inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{importSuccess}</span>
          </div>
        )}
      </div>

      {/* Pre-Import Data Preview & Commit Table */}
      {parsedItems.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Table className="w-5 h-5 text-blue-600" />
              <div>
                <h3 className="font-extrabold text-slate-900 dark:text-white text-sm">
                  Pre-Commit Data Preview ({selectedRows.filter(Boolean).length} / {parsedItems.length} Selected)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Review normalized records before adding them to your workspace database.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setParsedItems([]);
                  setSelectedRows([]);
                  setFileSelected(null);
                }}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors"
              >
                Clear
              </button>

              <button
                onClick={handleConfirmImport}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs shadow-md shadow-emerald-600/20 transition-all"
              >
                <span>Commit {selectedRows.filter(Boolean).length} Records</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedRows.length > 0 && selectedRows.every(Boolean)}
                      onChange={handleToggleSelectAll}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  {category === 'products' && (
                    <>
                      <th className="py-2.5 px-3">Product Name</th>
                      <th className="py-2.5 px-3">SKU</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Cost Price</th>
                      <th className="py-2.5 px-3">Retail Price</th>
                      <th className="py-2.5 px-3">Wholesale Price</th>
                      <th className="py-2.5 px-3">Initial Stock</th>
                    </>
                  )}
                  {category === 'customers' && (
                    <>
                      <th className="py-2.5 px-3">Customer Name</th>
                      <th className="py-2.5 px-3">Email</th>
                      <th className="py-2.5 px-3">Phone</th>
                      <th className="py-2.5 px-3">Company</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Credit Limit</th>
                    </>
                  )}
                  {category === 'suppliers' && (
                    <>
                      <th className="py-2.5 px-3">Supplier Name</th>
                      <th className="py-2.5 px-3">Contact Person</th>
                      <th className="py-2.5 px-3">Email</th>
                      <th className="py-2.5 px-3">Phone</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Payment Terms</th>
                    </>
                  )}
                  {category === 'sales' && (
                    <>
                      <th className="py-2.5 px-3">Invoice No</th>
                      <th className="py-2.5 px-3">Customer Name</th>
                      <th className="py-2.5 px-3">Total Amount</th>
                      <th className="py-2.5 px-3">Payment Method</th>
                      <th className="py-2.5 px-3">Status</th>
                    </>
                  )}
                  {category === 'whatsapp' && (
                    <>
                      <th className="py-2.5 px-3">Customer Name</th>
                      <th className="py-2.5 px-3">Phone</th>
                      <th className="py-2.5 px-3">Order Details</th>
                      <th className="py-2.5 px-3">Total Amount</th>
                      <th className="py-2.5 px-3">Status</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {parsedItems.map((item, idx) => (
                  <tr
                    key={idx}
                    className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                      !selectedRows[idx] ? 'opacity-40 bg-slate-50/40 dark:bg-slate-900/40' : ''
                    }`}
                  >
                    <td className="py-2.5 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={!!selectedRows[idx]}
                        onChange={() => handleToggleRow(idx)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>

                    {category === 'products' && (
                      <>
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{item.name}</td>
                        <td className="py-2.5 px-3 font-mono">{item.sku}</td>
                        <td className="py-2.5 px-3">{item.category}</td>
                        <td className="py-2.5 px-3 font-mono">{settings.currencySymbol}{(item.costPrice || 0).toFixed(2)}</td>
                        <td className="py-2.5 px-3 font-bold text-emerald-600">{settings.currencySymbol}{(item.retailPrice || 0).toFixed(2)}</td>
                        <td className="py-2.5 px-3 font-bold text-blue-600">{settings.currencySymbol}{(item.wholesalePrice || 0).toFixed(2)}</td>
                        <td className="py-2.5 px-3 font-bold">{item.currentStock} pcs</td>
                      </>
                    )}

                    {category === 'customers' && (
                      <>
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{item.name}</td>
                        <td className="py-2.5 px-3">{item.email || 'N/A'}</td>
                        <td className="py-2.5 px-3 font-mono">{item.phone || 'N/A'}</td>
                        <td className="py-2.5 px-3">{item.company || 'Private'}</td>
                        <td className="py-2.5 px-3 font-bold">{item.type}</td>
                        <td className="py-2.5 px-3 font-mono">{settings.currencySymbol}{(item.creditLimit || 0).toLocaleString()}</td>
                      </>
                    )}

                    {category === 'suppliers' && (
                      <>
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{item.name}</td>
                        <td className="py-2.5 px-3">{item.contactPerson}</td>
                        <td className="py-2.5 px-3">{item.email || 'N/A'}</td>
                        <td className="py-2.5 px-3 font-mono">{item.phone || 'N/A'}</td>
                        <td className="py-2.5 px-3">{item.category}</td>
                        <td className="py-2.5 px-3 font-bold">{item.paymentTerms}</td>
                      </>
                    )}

                    {category === 'sales' && (
                      <>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-white">{item.invoiceNo}</td>
                        <td className="py-2.5 px-3 font-medium">{item.customerName}</td>
                        <td className="py-2.5 px-3 font-bold text-emerald-600 font-mono">{settings.currencySymbol}{(item.totalAmount || 0).toFixed(2)}</td>
                        <td className="py-2.5 px-3 font-bold">{item.paymentMethod}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
                            {item.status}
                          </span>
                        </td>
                      </>
                    )}

                    {category === 'whatsapp' && (
                      <>
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{item.customerName}</td>
                        <td className="py-2.5 px-3 font-mono">{item.customerPhone}</td>
                        <td className="py-2.5 px-3">
                          {Array.isArray(item.items) && item.items[0] ? `${item.items[0].quantity}x ${item.items[0].productName}` : 'Order item'}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-emerald-600 font-mono">{settings.currencySymbol}{(item.totalAmount || 0).toFixed(2)}</td>
                        <td className="py-2.5 px-3 font-bold text-emerald-600">{item.status}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
