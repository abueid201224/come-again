import * as pdfjsLib from 'pdfjs-dist';
import type { MasterInvoiceItem } from '../types';

// Set worker source for pdfjs
if (typeof window !== 'undefined' && 'Worker' in window) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
  } catch {
    // fallback if cdn fails or worker already loaded
  }
}

export interface ExtractedPdfDocument {
  documentNo: string;
  orderNo?: string;
  returnReceiptNo?: string;
  documentType: 'INVOICE' | 'RETURN' | 'RECEIVING' | 'INVENTORY' | 'UNKNOWN';
  customerName?: string;
  paymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CREDIT_BALANCE' | 'COD';
  date?: string;
  items: ExtractedPdfItem[];
  rawText: string;
  totalPages: number;
}

export interface ExtractedPdfItem {
  id: string;
  itemCode: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  isHighlighted?: boolean;
  pageNumber: number;
  returnReason?: string;
  condition?: 'INTACT' | 'DAMAGED' | 'EXPIRED' | 'OPEN_BOX' | 'WRONG_ITEM';
}

/**
 * Extracts raw structured text and tables from PDF files using pdfjs-dist
 */
export async function parsePdfInvoice(
  file: File,
  highlightedOnly: boolean = false
): Promise<ExtractedPdfDocument> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  let fullText = '';
  const detectedLines: { text: string; page: number; y: number; x: number; isBoldOrMarked?: boolean }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Group text items by roughly same Y coordinates to form lines
    const lineMap = new Map<number, { text: string; x: number; isBold?: boolean }[]>();
    
    for (const item of textContent.items as any[]) {
      if (!item.str || item.str.trim() === '') continue;
      const y = Math.round(item.transform[5] / 4) * 4; // Round Y to tolerance
      const x = Math.round(item.transform[4]);
      
      const currentList = lineMap.get(y) || [];
      currentList.push({
        text: item.str,
        x,
        isBold: item.fontName?.toLowerCase().includes('bold') || item.fontName?.toLowerCase().includes('black')
      });
      lineMap.set(y, currentList);
      fullText += item.str + ' ';
    }

    // Sort lines from top of page to bottom (descending Y in PDF coordinates)
    const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
    for (const y of sortedY) {
      const parts = lineMap.get(y) || [];
      parts.sort((a, b) => a.x - b.x);
      const combinedLineText = parts.map(p => p.text).join(' ').trim();
      if (combinedLineText) {
        detectedLines.push({
          text: combinedLineText,
          page: i,
          y,
          x: parts[0]?.x || 0,
          isBoldOrMarked: parts.some(p => p.isBold)
        });
      }
    }
  }

  // 1. Detect Document Number (Invoice #): Starts from the left with '204' (e.g. 204123456)
  let documentNo = '';
  const invoice204Match = fullText.match(/\b(204\d{3,20})\b/);
  if (invoice204Match && invoice204Match[1]) {
    documentNo = invoice204Match[1].trim();
  } else {
    const docNoRegex = /(?:فاتورة|فاتوره|invoice|inv|bill|doc)[\s#№:.\-_]*([A-Za-z0-9\-_/]{3,25})/i;
    const matchDoc = fullText.match(docNoRegex);
    if (matchDoc && matchDoc[1]) {
      documentNo = matchDoc[1].trim();
    } else {
      // General fallback regex
      const genMatch = fullText.match(/(?:أوردر|طلب|order|rma|po)[\s#№:.\-_]*([A-Za-z0-9\-_/]{3,25})/i);
      if (genMatch && genMatch[1]) {
        documentNo = genMatch[1].trim();
      } else {
        const fallbackMatch = file.name.replace(/\.[^/.]+$/, '').replace(/[^A-Za-z0-9-_]/g, '-');
        documentNo = fallbackMatch || `DOC-${Date.now().toString().slice(-6)}`;
      }
    }
  }

  // 2. Detect Order Number: Starts from the left with '200' or 'return200' / 'new200'
  let orderNo = '';
  const order200Match = fullText.match(/\b((?:return|new)?200\d{3,20})\b/i);
  if (order200Match && order200Match[1]) {
    orderNo = order200Match[1].trim();
  } else {
    const orderRegex = /(?:رقم الطلب|أوردر|الطلب|order no|order #|po #|order id)[\s#№:.\-_]*([A-Za-z0-9\-_/]{3,25})/i;
    const matchOrder = fullText.match(orderRegex);
    if (matchOrder && matchOrder[1]) {
      orderNo = matchOrder[1].trim();
    }
  }

  // 3. Return Receipt Number: Always 'return' + Order Number from the far left without delimiters
  let returnReceiptNo = '';
  if (orderNo) {
    const cleanOrder = orderNo.replace(/^(?:return|new)/i, '').trim();
    returnReceiptNo = `return${cleanOrder}`;
  }

  // Detect Customer / Vendor Name
  let customerName = '';
  const customerRegex = /(?:العميل|السيد|المورد|شركة|مؤسسة|customer|client|vendor|to|buyer)[\s:.\-_]*([\u0600-\u06FF\w\s]{3,35})/i;
  const matchCust = fullText.match(customerRegex);
  if (matchCust && matchCust[1]) {
    customerName = matchCust[1].trim().replace(/\n/g, ' ');
  }

  // Detect Payment Method
  let paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CREDIT_BALANCE' | 'COD' = 'CASH';
  if (/تحويل|بنك|bank|wire|transfer/i.test(fullText)) {
    paymentMethod = 'BANK_TRANSFER';
  } else if (/بطاقة|فيزا|مدى|ماستركارد|card|visa|mastercard|mada|pos/i.test(fullText)) {
    paymentMethod = 'CARD';
  } else if (/آجل|اجل|محفظة|رصيد|credit|wallet|on account/i.test(fullText)) {
    paymentMethod = 'CREDIT_BALANCE';
  } else if (/عند الاستلام|دفع عند|cod|cash on delivery/i.test(fullText)) {
    paymentMethod = 'COD';
  } else if (/نقدي|كاش|cash/i.test(fullText)) {
    paymentMethod = 'CASH';
  }

  // Detect items from table rows - Extract all items completely from the invoice PDF
  const extractedItems: ExtractedPdfItem[] = [];
  let itemCounter = 1;

  // Regex patterns for row detection: Barcode (digits or SKUs) + Name + Qty + Price
  const barcodePattern = /\b(\d{7,14}|SKU-[A-Za-z0-9-_]+|[A-Za-z]{2,5}-\d{3,8})\b/;
  const numberPattern = /\b(\d+(?:\.\d{1,2})?)\b/g;

  for (const lineObj of detectedLines) {
    const line = lineObj.text;
    const barcodeMatch = line.match(barcodePattern);

    if (barcodeMatch) {
      const barcode = barcodeMatch[1];
      
      // Extract numbers in the line (quantities & prices)
      const allNumbers: number[] = [];
      let matchNum: RegExpExecArray | null;
      while ((matchNum = numberPattern.exec(line)) !== null) {
        const val = parseFloat(matchNum[1]);
        if (matchNum[1] !== barcode && !isNaN(val)) {
          allNumbers.push(val);
        }
      }

      // Quantity is typically a whole number or the first/second number
      let qty = 1;
      let unitPrice = 0;
      let totalPrice = 0;

      if (allNumbers.length >= 3) {
        qty = allNumbers[0];
        unitPrice = allNumbers[1];
        totalPrice = allNumbers[2];
      } else if (allNumbers.length === 2) {
        qty = allNumbers[0];
        unitPrice = allNumbers[1];
        totalPrice = qty * unitPrice;
      } else if (allNumbers.length === 1) {
        qty = allNumbers[0];
      }

      // Item description: Remove barcode and numbers
      let desc = line
        .replace(barcode, '')
        .replace(/\b\d+(?:\.\d{1,2})?\b/g, '')
        .replace(/[:|,\-_/#]/g, ' ')
        .trim();

      if (!desc || desc.length < 2) {
        desc = `صنف باركود ${barcode}`;
      }

      // Check unit
      let unit = 'PCS';
      if (/كرتون|كرتونة|ctn|box|كرتون/i.test(line)) unit = 'BOX';
      else if (/باكت|pack|باكتة/i.test(line)) unit = 'PACK';
      else if (/كجم|kg|كيلو/i.test(line)) unit = 'KG';
      else if (/حبة|قطعة|حبه|قطعه|pcs|ea/i.test(line)) unit = 'PCS';

      const isItemHighlighted = lineObj.isBoldOrMarked || line.includes('*') || line.includes('★');

      extractedItems.push({
        id: `pdf-item-${itemCounter++}`,
        itemCode: barcode,
        itemName: desc,
        unit,
        quantity: Math.max(1, qty),
        unitPrice: unitPrice || undefined,
        totalPrice: totalPrice || (unitPrice ? qty * unitPrice : undefined),
        isHighlighted: isItemHighlighted,
        pageNumber: lineObj.page,
        condition: 'INTACT',
        returnReason: 'طلب استرجاع من العميل',
      });
    }
  }

  // Always extract full invoice items completely
  const finalItems = (highlightedOnly && extractedItems.some(i => i.isHighlighted))
    ? extractedItems.filter(i => i.isHighlighted)
    : extractedItems;

  return {
    documentNo,
    orderNo: orderNo || undefined,
    returnReceiptNo: returnReceiptNo || undefined,
    documentType: /مرتجع|rma|return/i.test(fullText) ? 'RETURN' : /استلام|receiving|po/i.test(fullText) ? 'RECEIVING' : 'INVOICE',
    customerName: customerName || undefined,
    paymentMethod,
    date: new Date().toISOString().slice(0, 10),
    items: finalItems,
    rawText: fullText.slice(0, 3000),
    totalPages: pdf.numPages,
  };
}

/**
 * Converts Extracted PDF Items to MasterInvoiceItems format for instant auditing or session loading
 */
export function convertPdfItemsToMaster(
  extracted: ExtractedPdfDocument
): MasterInvoiceItem[] {
  const importedAt = new Date().toISOString();
  return extracted.items.map((item, idx) => ({
    invoiceNo: extracted.documentNo,
    itemCode: item.itemCode,
    itemName: item.itemName,
    unit: item.unit,
    requiredQty: item.quantity,
    importedAt,
    originalIndex: idx,
  }));
}
