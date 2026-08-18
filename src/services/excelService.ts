import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { MasterInvoiceItem, AuditDiscrepancy } from '../types';

export interface ParseResult {
  items: MasterInvoiceItem[];
  errors: string[];
  totalRows: number;
}

// Normalizes column headers to standard schema keys
function normalizeHeader(raw: string): string {
  const clean = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (['invoiceno', 'invoice', 'invoicenumber', 'invno', 'invoicenum', 'billno'].includes(clean)) {
    return 'invoiceNo';
  }
  if (['itemcode', 'item', 'code', 'barcode', 'sku', 'productcode', 'itemno', 'upc'].includes(clean)) {
    return 'itemCode';
  }
  if (['itemname', 'itemdesc', 'description', 'productname', 'name', 'product', 'desc'].includes(clean)) {
    return 'itemName';
  }
  if (['unit', 'uom', 'unitofmeasure', 'package', 'pack'].includes(clean)) {
    return 'unit';
  }
  if (['requiredqty', 'reqqty', 'quantity', 'qty', 'orderqty', 'expectedqty', 'planqty', 'count'].includes(clean)) {
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
          const itemCode = String(rowObj['itemCode'] ?? rowObj['itemcode'] ?? '').trim();
          const itemName = String(rowObj['itemName'] ?? rowObj['itemname'] ?? itemCode).trim();
          const unit = String(rowObj['unit'] ?? 'PCS').trim().toUpperCase();
          const reqQtyRaw = rowObj['requiredQty'] ?? rowObj['requiredqty'] ?? rowObj['qty'] ?? 0;
          const requiredQty = Number(reqQtyRaw);

          if (!invoiceNo) {
            errors.push(`Row ${index + 2}: Missing Invoice_No`);
            return;
          }
          if (!itemCode) {
            errors.push(`Row ${index + 2} (Inv ${invoiceNo}): Missing Item_Code`);
            return;
          }
          if (isNaN(requiredQty) || requiredQty <= 0) {
            errors.push(`Row ${index + 2} (Inv ${invoiceNo}, Item ${itemCode}): Invalid Required_Qty '${reqQtyRaw}'`);
            return;
          }

          items.push({
            invoiceNo,
            itemCode,
            itemName: itemName || itemCode,
            unit: unit || 'PCS',
            requiredQty,
            importedAt,
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

// Generates sample Excel file for quick testing & immediate offline download
export function generateSampleExcelFile(): void {
  const sampleData = [
    { Invoice_No: 'INV-2024-001', Item_Code: 'SKU-APPLE-01', Item_Name: 'Fresh Gala Apples (1kg)', Unit: 'KG', Required_Qty: 5 },
    { Invoice_No: 'INV-2024-001', Item_Code: 'SKU-MILK-02', Item_Name: 'Whole Organic Milk 1L', Unit: 'BTL', Required_Qty: 3 },
    { Invoice_No: 'INV-2024-001', Item_Code: 'SKU-BREAD-03', Item_Name: 'Artisan Sourdough Loaf', Unit: 'PCS', Required_Qty: 2 },
    { Invoice_No: 'INV-2024-001', Item_Code: 'SKU-COFFEE-04', Item_Name: 'Arabica Whole Beans 500g', Unit: 'BAG', Required_Qty: 4 },
    
    { Invoice_No: 'INV-2024-002', Item_Code: 'SKU-LOGI-M185', Item_Name: 'Logitech Wireless Mouse M185', Unit: 'PCS', Required_Qty: 6 },
    { Invoice_No: 'INV-2024-002', Item_Code: 'SKU-DELL-KB216', Item_Name: 'Dell Wired Keyboard KB216', Unit: 'PCS', Required_Qty: 4 },
    { Invoice_No: 'INV-2024-002', Item_Code: 'SKU-HDMI-2M', Item_Name: 'High Speed 4K HDMI Cable 2m', Unit: 'PCS', Required_Qty: 10 },
    
    { Invoice_No: 'INV-2024-003', Item_Code: 'SKU-SAFETY-GLOVE', Item_Name: 'Heavy Duty Nitrile Gloves', Unit: 'BOX', Required_Qty: 8 },
    { Invoice_No: 'INV-2024-003', Item_Code: 'SKU-TAPE-CLEAR', Item_Name: 'Packing Tape Transparent 48mm', Unit: 'ROLL', Required_Qty: 12 },
    { Invoice_No: 'INV-2024-003', Item_Code: 'SKU-BOX-MED', Item_Name: 'Corrugated Shipping Box Med', Unit: 'PCS', Required_Qty: 20 },
    { Invoice_No: 'INV-2024-003', Item_Code: 'SKU-BUBBLE-50M', Item_Name: 'Air Bubble Wrap Roll 50m', Unit: 'ROLL', Required_Qty: 2 },
    
    { Invoice_No: 'INV-2024-004', Item_Code: '8901234567890', Item_Name: 'Industrial Barcode Label 100x50mm', Unit: 'ROLL', Required_Qty: 5 },
    { Invoice_No: 'INV-2024-004', Item_Code: '8901234567891', Item_Name: 'Thermal Transfer Ribbon Wax/Resin', Unit: 'ROLL', Required_Qty: 5 },
    { Invoice_No: 'INV-2024-004', Item_Code: '8901234567892', Item_Name: 'Handheld Barcode Scanner Stand', Unit: 'PCS', Required_Qty: 3 },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  
  // Set clean column widths
  worksheet['!cols'] = [
    { wch: 18 }, // Invoice_No
    { wch: 20 }, // Item_Code
    { wch: 38 }, // Item_Name
    { wch: 10 }, // Unit
    { wch: 14 }, // Required_Qty
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily Invoices');
  
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `Daily_Invoice_Data_${today}.xlsx`);
}

// Built-in Sample dataset generator for instant 1-click loading without local file
export function getSampleDailyItems(): MasterInvoiceItem[] {
  const importedAt = new Date().toISOString();
  return [
    { invoiceNo: 'INV-2024-001', itemCode: 'SKU-APPLE-01', itemName: 'Fresh Gala Apples (1kg)', unit: 'KG', requiredQty: 5, importedAt },
    { invoiceNo: 'INV-2024-001', itemCode: 'SKU-MILK-02', itemName: 'Whole Organic Milk 1L', unit: 'BTL', requiredQty: 3, importedAt },
    { invoiceNo: 'INV-2024-001', itemCode: 'SKU-BREAD-03', itemName: 'Artisan Sourdough Loaf', unit: 'PCS', requiredQty: 2, importedAt },
    { invoiceNo: 'INV-2024-001', itemCode: 'SKU-COFFEE-04', itemName: 'Arabica Whole Beans 500g', unit: 'BAG', requiredQty: 4, importedAt },
    
    { invoiceNo: 'INV-2024-002', itemCode: 'SKU-LOGI-M185', itemName: 'Logitech Wireless Mouse M185', unit: 'PCS', requiredQty: 6, importedAt },
    { invoiceNo: 'INV-2024-002', itemCode: 'SKU-DELL-KB216', itemName: 'Dell Wired Keyboard KB216', unit: 'PCS', requiredQty: 4, importedAt },
    { invoiceNo: 'INV-2024-002', itemCode: 'SKU-HDMI-2M', itemName: 'High Speed 4K HDMI Cable 2m', unit: 'PCS', requiredQty: 10, importedAt },
    
    { invoiceNo: 'INV-2024-003', itemCode: 'SKU-SAFETY-GLOVE', itemName: 'Heavy Duty Nitrile Gloves', unit: 'BOX', requiredQty: 8, importedAt },
    { invoiceNo: 'INV-2024-003', itemCode: 'SKU-TAPE-CLEAR', itemName: 'Packing Tape Transparent 48mm', unit: 'ROLL', requiredQty: 12, importedAt },
    { invoiceNo: 'INV-2024-003', itemCode: 'SKU-BOX-MED', itemName: 'Corrugated Shipping Box Med', unit: 'PCS', requiredQty: 20, importedAt },
    { invoiceNo: 'INV-2024-003', itemCode: 'SKU-BUBBLE-50M', itemName: 'Air Bubble Wrap Roll 50m', unit: 'ROLL', requiredQty: 2, importedAt },
    
    { invoiceNo: 'INV-2024-004', itemCode: '8901234567890', itemName: 'Industrial Barcode Label 100x50mm', unit: 'ROLL', requiredQty: 5, importedAt },
    { invoiceNo: 'INV-2024-004', itemCode: '8901234567891', itemName: 'Thermal Transfer Ribbon Wax/Resin', unit: 'ROLL', requiredQty: 5, importedAt },
    { invoiceNo: 'INV-2024-004', itemCode: '8901234567892', itemName: 'Handheld Barcode Scanner Stand', unit: 'PCS', requiredQty: 3, importedAt },
  ];
}

// Export permanent Error Audit Report to Excel (.xlsx)
export function exportErrorReportToExcel(discrepancies: AuditDiscrepancy[]): void {
  if (discrepancies.length === 0) {
    alert('No discrepancies in Error Audit Report to export.');
    return;
  }

  const exportRows = discrepancies.map((d, index) => ({
    'No': index + 1,
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
  const summaryMap: Record<string, { shortages: number; surpluses: number; mismatches: number }> = {};
  for (const d of discrepancies) {
    if (!summaryMap[d.invoiceNo]) {
      summaryMap[d.invoiceNo] = { shortages: 0, surpluses: 0, mismatches: 0 };
    }
    if (d.codeStatus === 'MISMATCH') summaryMap[d.invoiceNo].mismatches += 1;
    else if (d.qtyStatus === 'SHORTAGE') summaryMap[d.invoiceNo].shortages += 1;
    else if (d.qtyStatus === 'SURPLUS') summaryMap[d.invoiceNo].surpluses += 1;
  }

  const summaryRows = Object.entries(summaryMap).map(([inv, counts]) => ({
    'Invoice_No': inv,
    'Item_Mismatches': counts.mismatches,
    'Quantity_Shortages': counts.shortages,
    'Quantity_Surpluses': counts.surpluses,
    'Total_Discrepancies': counts.mismatches + counts.shortages + counts.surpluses,
  }));

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];

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
  
  // Header
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text('WAREHOUSE INVOICE AUDIT - ERROR & DISCREPANCY REPORT', 14, 16);

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${new Date().toLocaleString()} | Total Discrepancy Rows: ${discrepancies.length}`, 14, 23);

  // Table Data
  const tableData = discrepancies.map((d, i) => [
    i + 1,
    d.invoiceNo,
    d.itemCode,
    d.itemName.length > 25 ? `${d.itemName.slice(0, 23)}...` : d.itemName,
    d.unit,
    d.requiredQty,
    d.actualQty,
    d.difference > 0 ? `+${d.difference}` : `${d.difference}`,
    d.codeStatus,
    d.qtyStatus,
    new Date(d.auditedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  ]);

  autoTable(doc, {
    startY: 28,
    head: [['#', 'Invoice No', 'Item Code', 'Item Name', 'Unit', 'Req', 'Act', 'Diff', 'Code Status', 'Qty Status', 'Time']],
    body: tableData,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 26 },
      2: { cellWidth: 30 },
      3: { cellWidth: 50 },
      4: { cellWidth: 12 },
      5: { cellWidth: 12, halign: 'right' },
      6: { cellWidth: 12, halign: 'right' },
      7: { cellWidth: 14, halign: 'right' },
      8: { cellWidth: 24, fontStyle: 'bold' },
      9: { cellWidth: 24, fontStyle: 'bold' },
      10: { cellWidth: 20 },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const rawCodeStatus = data.row.raw[8];
        const rawQtyStatus = data.row.raw[9];

        if (data.column.index === 8) {
          if (rawCodeStatus === 'MISMATCH') {
            data.cell.styles.textColor = [220, 38, 38]; // Red
          } else {
            data.cell.styles.textColor = [22, 163, 74]; // Green
          }
        }
        if (data.column.index === 9) {
          if (rawQtyStatus === 'SHORTAGE') {
            data.cell.styles.textColor = [217, 119, 6]; // Amber
          } else if (rawQtyStatus === 'SURPLUS') {
            data.cell.styles.textColor = [220, 38, 38]; // Red
          } else {
            data.cell.styles.textColor = [22, 163, 74]; // Green
          }
        }
      }
    },
  });

  const timestamp = new Date().toISOString().slice(0, 10);
  doc.save(`Invoice_Audit_Error_Report_${timestamp}.pdf`);
}
