import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { MasterInvoiceItem, AuditDiscrepancy } from '../types';

export interface ParseResult {
  items: MasterInvoiceItem[];
  errors: string[];
  totalRows: number;
}

// Normalizes column headers to standard schema keys including Arabic & English variants
function normalizeHeader(raw: string): string {
  const clean = String(raw || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
  
  // Order Number matches
  if ([
    'orderno', 'order', 'orderid', 'ordernum', 'po', 'ponumber', 'purchasenumber', 'ordernumber',
    'رقم_الاوردر', 'الاوردر', 'رقم_الطلب', 'الطلب', 'رقم_أمر_الشراء', 'رقم_أمر_البيع', 'اوردر', 'طلب'
  ].includes(clean) || clean.includes('order') || clean.includes('اوردر') || clean.includes('طلب')) {
    return 'orderNo';
  }

  // Invoice Number matches
  if ([
    'invoiceno', 'invoice', 'invoicenumber', 'invno', 'invoicenum', 'billno', 'bill',
    'رقم_الفاتورة', 'الفاتورة', 'فاتورة', 'رقم_الفاتوره'
  ].includes(clean) || clean.includes('invoice') || clean.includes('فاتور')) {
    return 'invoiceNo';
  }

  // Item Code / Barcode matches
  if ([
    'itemcode', 'item', 'code', 'barcode', 'sku', 'productcode', 'itemno', 'upc', 'ean',
    'كود_الصنف', 'باركود', 'كود', 'الباركود', 'الصنف', 'رمز_الصنف'
  ].includes(clean) || clean.includes('barcode') || clean.includes('باركود')) {
    return 'itemCode';
  }

  // Item Name matches
  if ([
    'itemname', 'itemdesc', 'description', 'productname', 'name', 'product', 'desc',
    'اسم_الصنف', 'اسم_المنتج', 'الوصف', 'بيان_الصنف'
  ].includes(clean) || clean.includes('name') || clean.includes('اسم')) {
    return 'itemName';
  }

  // Unit matches
  if ([
    'unit', 'uom', 'unitofmeasure', 'package', 'pack',
    'الوحدة', 'وحدة_القياس', 'العبوة'
  ].includes(clean) || clean.includes('unit') || clean.includes('وحد')) {
    return 'unit';
  }

  // Required Quantity matches
  if ([
    'requiredqty', 'reqqty', 'quantity', 'qty', 'orderqty', 'expectedqty', 'planqty', 'count',
    'الكمية_المطلوبة', 'الكمية', 'العدد_المطلوب', 'العدد', 'مطلوب'
  ].includes(clean) || clean.includes('qty') || clean.includes('كمي') || clean.includes('عدد')) {
    return 'requiredQty';
  }

  return clean;
}

export async function parseExcelOrCsvFile(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          return resolve({ items: [], errors: ['No sheet found in workbook.'], totalRows: 0 });
        }

        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

        if (!rawJson || rawJson.length === 0) {
          return resolve({ items: [], errors: ['Sheet is empty.'], totalRows: 0 });
        }

        const items: MasterInvoiceItem[] = [];
        const errors: string[] = [];
        const importedAt = new Date().toISOString();

        rawJson.forEach((row, index) => {
          const rowObj: Record<string, unknown> = {};
          
          for (const key of Object.keys(row)) {
            const normalizedKey = normalizeHeader(key);
            rowObj[normalizedKey] = row[key];
          }

          const invoiceNo = String(rowObj['invoiceNo'] ?? rowObj['invoiceno'] ?? '').trim();
          const orderNo = String(rowObj['orderNo'] ?? rowObj['orderno'] ?? '').trim();
          const itemCode = String(rowObj['itemCode'] ?? rowObj['itemcode'] ?? '').trim();
          const itemName = String(rowObj['itemName'] ?? rowObj['itemname'] ?? itemCode).trim();
          const unit = String(rowObj['unit'] ?? 'PCS').trim().toUpperCase();
          const reqQtyRaw = rowObj['requiredQty'] ?? rowObj['requiredqty'] ?? rowObj['qty'] ?? 0;
          const requiredQty = Number(reqQtyRaw);

          if (!invoiceNo && !orderNo) {
            errors.push(`Row ${index + 2}: Missing Invoice_No or Order_No`);
            return;
          }

          const effectiveInvoiceNo = invoiceNo || orderNo;

          if (!itemCode) {
            errors.push(`Row ${index + 2} (Inv ${effectiveInvoiceNo}): Missing Item_Code`);
            return;
          }
          if (isNaN(requiredQty) || requiredQty <= 0) {
            errors.push(`Row ${index + 2} (Inv ${effectiveInvoiceNo}, Item ${itemCode}): Invalid Required_Qty '${reqQtyRaw}'`);
            return;
          }

          items.push({
            orderNo: orderNo || undefined,
            invoiceNo: effectiveInvoiceNo,
            itemCode,
            itemName: itemName || itemCode,
            unit: unit || 'PCS',
            requiredQty,
            importedAt,
            originalIndex: index,
          });
        });

        resolve({ items, errors, totalRows: rawJson.length });
      } catch (err) {
        reject(new Error(`Failed to parse file: ${(err as Error).message}`));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

// Generates sample Excel file with Order_No and Invoice_No for quick testing & immediate offline download
export function generateSampleExcelFile(): void {
  const sampleData = [
    { Order_No: 'ORD-8801', Invoice_No: 'INV-2024-001', Item_Code: 'SKU-APPLE-01', Item_Name: 'Fresh Gala Apples (1kg)', Unit: 'KG', Required_Qty: 5 },
    { Order_No: 'ORD-8801', Invoice_No: 'INV-2024-001', Item_Code: 'SKU-MILK-02', Item_Name: 'Whole Organic Milk 1L', Unit: 'BTL', Required_Qty: 3 },
    { Order_No: 'ORD-8801', Invoice_No: 'INV-2024-001', Item_Code: 'SKU-BREAD-03', Item_Name: 'Artisan Sourdough Loaf', Unit: 'PCS', Required_Qty: 2 },
    { Order_No: 'ORD-8801', Invoice_No: 'INV-2024-001', Item_Code: 'SKU-COFFEE-04', Item_Name: 'Arabica Whole Beans 500g', Unit: 'BAG', Required_Qty: 4 },
    
    { Order_No: 'ORD-8802', Invoice_No: 'INV-2024-002', Item_Code: 'SKU-LOGI-M185', Item_Name: 'Logitech Wireless Mouse M185', Unit: 'PCS', Required_Qty: 6 },
    { Order_No: 'ORD-8802', Invoice_No: 'INV-2024-002', Item_Code: 'SKU-DELL-KB216', Item_Name: 'Dell Wired Keyboard KB216', Unit: 'PCS', Required_Qty: 4 },
    { Order_No: 'ORD-8802', Invoice_No: 'INV-2024-002', Item_Code: 'SKU-HDMI-2M', Item_Name: 'High Speed 4K HDMI Cable 2m', Unit: 'PCS', Required_Qty: 10 },
    
    { Order_No: 'ORD-8803', Invoice_No: 'INV-2024-003', Item_Code: 'SKU-SAFETY-GLOVE', Item_Name: 'Heavy Duty Nitrile Gloves', Unit: 'BOX', Required_Qty: 8 },
    { Order_No: 'ORD-8803', Invoice_No: 'INV-2024-003', Item_Code: 'SKU-TAPE-CLEAR', Item_Name: 'Packing Tape Transparent 48mm', Unit: 'ROLL', Required_Qty: 12 },
    { Order_No: 'ORD-8803', Invoice_No: 'INV-2024-003', Item_Code: 'SKU-BOX-MED', Item_Name: 'Corrugated Shipping Box Med', Unit: 'PCS', Required_Qty: 20 },
    { Order_No: 'ORD-8803', Invoice_No: 'INV-2024-003', Item_Code: 'SKU-BUBBLE-50M', Item_Name: 'Air Bubble Wrap Roll 50m', Unit: 'ROLL', Required_Qty: 2 },
    
    { Order_No: 'ORD-8804', Invoice_No: 'INV-2024-004', Item_Code: '8901234567890', Item_Name: 'Industrial Barcode Label 100x50mm', Unit: 'ROLL', Required_Qty: 5 },
    { Order_No: 'ORD-8804', Invoice_No: 'INV-2024-004', Item_Code: '8901234567891', Item_Name: 'Thermal Transfer Ribbon Wax/Resin', Unit: 'ROLL', Required_Qty: 5 },
    { Order_No: 'ORD-8804', Invoice_No: 'INV-2024-004', Item_Code: '8901234567892', Item_Name: 'Handheld Barcode Scanner Stand', Unit: 'PCS', Required_Qty: 3 },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  
  worksheet['!cols'] = [
    { wch: 14 }, // Order_No
    { wch: 18 }, // Invoice_No
    { wch: 20 }, // Item_Code
    { wch: 38 }, // Item_Name
    { wch: 10 }, // Unit
    { wch: 14 }, // Required_Qty
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily Invoices & Orders');
  
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `Daily_Invoice_Data_${today}.xlsx`);
}

// Built-in Sample dataset generator with Order numbers for instant 1-click loading without local file
export function getSampleDailyItems(): MasterInvoiceItem[] {
  const importedAt = new Date().toISOString();
  return [
    { orderNo: 'ORD-8801', invoiceNo: 'INV-2024-001', itemCode: 'SKU-APPLE-01', itemName: 'Fresh Gala Apples (1kg)', unit: 'KG', requiredQty: 5, importedAt, originalIndex: 0 },
    { orderNo: 'ORD-8801', invoiceNo: 'INV-2024-001', itemCode: 'SKU-MILK-02', itemName: 'Whole Organic Milk 1L', unit: 'BTL', requiredQty: 3, importedAt, originalIndex: 1 },
    { orderNo: 'ORD-8801', invoiceNo: 'INV-2024-001', itemCode: 'SKU-BREAD-03', itemName: 'Artisan Sourdough Loaf', unit: 'PCS', requiredQty: 2, importedAt, originalIndex: 2 },
    { orderNo: 'ORD-8801', invoiceNo: 'INV-2024-001', itemCode: 'SKU-COFFEE-04', itemName: 'Arabica Whole Beans 500g', unit: 'BAG', requiredQty: 4, importedAt, originalIndex: 3 },
    
    { orderNo: 'ORD-8802', invoiceNo: 'INV-2024-002', itemCode: 'SKU-LOGI-M185', itemName: 'Logitech Wireless Mouse M185', unit: 'PCS', requiredQty: 6, importedAt, originalIndex: 4 },
    { orderNo: 'ORD-8802', invoiceNo: 'INV-2024-002', itemCode: 'SKU-DELL-KB216', itemName: 'Dell Wired Keyboard KB216', unit: 'PCS', requiredQty: 4, importedAt, originalIndex: 5 },
    { orderNo: 'ORD-8802', invoiceNo: 'INV-2024-002', itemCode: 'SKU-HDMI-2M', itemName: 'High Speed 4K HDMI Cable 2m', unit: 'PCS', requiredQty: 10, importedAt, originalIndex: 6 },
    
    { orderNo: 'ORD-8803', invoiceNo: 'INV-2024-003', itemCode: 'SKU-SAFETY-GLOVE', itemName: 'Heavy Duty Nitrile Gloves', unit: 'BOX', requiredQty: 8, importedAt, originalIndex: 7 },
    { orderNo: 'ORD-8803', invoiceNo: 'INV-2024-003', itemCode: 'SKU-TAPE-CLEAR', itemName: 'Packing Tape Transparent 48mm', unit: 'ROLL', requiredQty: 12, importedAt, originalIndex: 8 },
    { orderNo: 'ORD-8803', invoiceNo: 'INV-2024-003', itemCode: 'SKU-BOX-MED', itemName: 'Corrugated Shipping Box Med', unit: 'PCS', requiredQty: 20, importedAt, originalIndex: 9 },
    { orderNo: 'ORD-8803', invoiceNo: 'INV-2024-003', itemCode: 'SKU-BUBBLE-50M', itemName: 'Air Bubble Wrap Roll 50m', unit: 'ROLL', requiredQty: 2, importedAt, originalIndex: 10 },
    
    { orderNo: 'ORD-8804', invoiceNo: 'INV-2024-004', itemCode: '8901234567890', itemName: 'Industrial Barcode Label 100x50mm', unit: 'ROLL', requiredQty: 5, importedAt, originalIndex: 11 },
    { orderNo: 'ORD-8804', invoiceNo: 'INV-2024-004', itemCode: '8901234567891', itemName: 'Thermal Transfer Ribbon Wax/Resin', unit: 'ROLL', requiredQty: 5, importedAt, originalIndex: 12 },
    { orderNo: 'ORD-8804', invoiceNo: 'INV-2024-004', itemCode: '8901234567892', itemName: 'Handheld Barcode Scanner Stand', unit: 'PCS', requiredQty: 3, importedAt, originalIndex: 13 },
  ];
}

// Export permanent Error Audit Report to Excel (.xlsx) with Order_No
export function exportErrorReportToExcel(discrepancies: AuditDiscrepancy[]): void {
  if (discrepancies.length === 0) {
    alert('No discrepancies in Error Audit Report to export.');
    return;
  }

  const exportRows = discrepancies.map((d, index) => ({
    'No': index + 1,
    'Order_No': d.orderNo || '-',
    'Invoice_No': d.invoiceNo,
    'Item_Code': d.itemCode,
    'Item_Name': d.itemName,
    'Unit': d.unit,
    'Required_Qty': d.requiredQty,
    'Actual_Qty': d.actualQty,
    'Variance_Diff': d.difference > 0 ? `+${d.difference}` : d.difference,
    'Code_Status': d.codeStatus,
    'Qty_Status': d.qtyStatus,
    'Discrepancy_Type': d.codeStatus === 'MISMATCH' ? 'ITEM MISMATCH (Not in Invoice)' : d.qtyStatus,
    'Audited_Timestamp': new Date(d.auditedAt).toLocaleString(),
    'Notes': d.notes || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportRows);

  worksheet['!cols'] = [
    { wch: 6 },  // No
    { wch: 14 }, // Order_No
    { wch: 18 }, // Invoice_No
    { wch: 20 }, // Item_Code
    { wch: 34 }, // Item_Name
    { wch: 10 }, // Unit
    { wch: 14 }, // Required_Qty
    { wch: 14 }, // Actual_Qty
    { wch: 14 }, // Variance_Diff
    { wch: 14 }, // Code_Status
    { wch: 14 }, // Qty_Status
    { wch: 32 }, // Discrepancy_Type
    { wch: 22 }, // Audited_Timestamp
    { wch: 20 }, // Notes
  ];

  // Summary sheet
  const summaryMap: Record<string, { orderNo?: string; shortages: number; surpluses: number; mismatches: number }> = {};
  for (const d of discrepancies) {
    if (!summaryMap[d.invoiceNo]) {
      summaryMap[d.invoiceNo] = { orderNo: d.orderNo, shortages: 0, surpluses: 0, mismatches: 0 };
    }
    if (d.codeStatus === 'MISMATCH') summaryMap[d.invoiceNo].mismatches += 1;
    else if (d.qtyStatus === 'SHORTAGE') summaryMap[d.invoiceNo].shortages += 1;
    else if (d.qtyStatus === 'SURPLUS') summaryMap[d.invoiceNo].surpluses += 1;
  }

  const summaryRows = Object.entries(summaryMap).map(([inv, counts]) => ({
    'Order_No': counts.orderNo || '-',
    'Invoice_No': inv,
    'Item_Mismatches': counts.mismatches,
    'Quantity_Shortages': counts.shortages,
    'Quantity_Surpluses': counts.surpluses,
    'Total_Discrepancies': counts.mismatches + counts.shortages + counts.surpluses,
  }));

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Discrepancy Details');
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Invoice Summary');

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  XLSX.writeFile(workbook, `Audit_Error_Report_${timestamp}.xlsx`);
}

// Export permanent Error Audit Report to PDF
export function exportErrorReportToPdf(discrepancies: AuditDiscrepancy[]): void {
  if (discrepancies.length === 0) {
    alert('No discrepancies in Error Audit Report to export.');
    return;
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const timestamp = new Date().toLocaleString();

  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text('WAREHOUSE INVOICE AUDIT - ERROR & DISCREPANCY REPORT', 14, 15);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${timestamp} | Mode: 100% Offline | Total Discrepancies: ${discrepancies.length}`, 14, 21);

  const tableData = discrepancies.map((d, index) => [
    index + 1,
    d.orderNo || '-',
    d.invoiceNo,
    d.itemCode,
    d.itemName,
    `${d.requiredQty} ${d.unit}`,
    `${d.actualQty} ${d.unit}`,
    d.difference > 0 ? `+${d.difference}` : `${d.difference}`,
    d.codeStatus === 'MISMATCH' ? 'MISMATCH' : d.qtyStatus,
    d.notes || '',
  ]);

  autoTable(doc, {
    startY: 25,
    head: [['#', 'Order #', 'Invoice #', 'Item Code', 'Item Name', 'Req Qty', 'Actual', 'Diff', 'Status', 'Notes']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
    },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 20 },
      2: { cellWidth: 24 },
      3: { cellWidth: 28 },
      4: { cellWidth: 55 },
      5: { cellWidth: 18 },
      6: { cellWidth: 18 },
      7: { cellWidth: 14 },
      8: { cellWidth: 24 },
      9: { cellWidth: 'auto' },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const row = discrepancies[data.row.index];
        if (row) {
          if (row.codeStatus === 'MISMATCH') {
            data.cell.styles.textColor = [185, 28, 28]; // Red
            data.cell.styles.fontStyle = 'bold';
          } else if (row.qtyStatus === 'SHORTAGE') {
            data.cell.styles.textColor = [180, 83, 9]; // Amber
          } else if (row.qtyStatus === 'SURPLUS') {
            data.cell.styles.textColor = [124, 58, 237]; // Purple
          }
        }
      }
    },
  });

  const pdfTimestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  doc.save(`Audit_Error_Report_${pdfTimestamp}.pdf`);
}
