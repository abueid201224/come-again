export interface MasterInvoiceItem {
  id?: number;
  orderNo?: string;
  invoiceNo: string;
  itemCode: string;
  itemName: string;
  unit: string;
  requiredQty: number;
  importedAt: string;
  originalIndex?: number;
}

export type CodeStatus = 'MATCH' | 'MISMATCH';
export type QtyStatus = 'EXACT' | 'SHORTAGE' | 'SURPLUS';

export interface ScannedAuditItem {
  orderNo?: string;
  itemCode: string;
  itemName: string;
  unit: string;
  requiredQty: number;
  actualQty: number;
  codeStatus: CodeStatus;
  qtyStatus: QtyStatus;
  lastScannedAt: string;
  scanHistory: string[]; // timestamps of each scan
  originalIndex: number; // to preserve original Excel order
}

export interface ActiveInvoiceSession {
  orderNo?: string;
  invoiceNo: string;
  startedAt: string;
  lastActivityAt: string;
  items: Record<string, ScannedAuditItem>; // Keyed by itemCode
  isLocked: boolean;
  lastScannedItemCode?: string | null;
}

export interface IncompleteInvoiceRecord {
  invoiceNo: string;
  orderNo?: string;
  savedAt: string;
  session: ActiveInvoiceSession;
  completedItemsCount: number;
  totalItemsCount: number;
  missingQty: number;
  scannedQty: number;
  totalRequiredQty: number;
}

export interface CompletedInvoiceRecord {
  invoiceNo: string;
  orderNo?: string;
  completedAt: string;
  totalItems: number;
  totalQty: number;
}

export interface AuditDiscrepancy {
  id?: number;
  orderNo?: string;
  invoiceNo: string;
  itemCode: string;
  itemName: string;
  unit: string;
  requiredQty: number;
  actualQty: number;
  codeStatus: CodeStatus;
  qtyStatus: QtyStatus;
  difference: number; // actualQty - requiredQty
  auditedAt: string;
  notes?: string;
}

export interface InvoiceAuditHistory {
  id?: number;
  orderNo?: string;
  invoiceNo: string;
  totalRequiredItems: number;
  totalRequiredQty?: number;
  totalScannedQty?: number;
  scannedItemsCount: number;
  exactItemsCount: number;
  discrepancyCount: number;
  status: 'CLEAN' | 'DISCREPANCIES_FOUND' | 'COMPLETED' | 'INCOMPLETE';
  completedAt: string;
  durationSeconds: number;
}

export interface SyncMetadata {
  lastSyncDate: string | null;
  totalInvoices: number;
  totalItems: number;
  fileName: string | null;
  fileSize?: string;
}

export interface AppSettings {
  language: 'ar' | 'en';
  soundEnabled: boolean;
  soundVolume: number;
  vibrationEnabled: boolean;
  scannerPrefixInvoice: string; // optional prefix for invoice barcode e.g. "INV-"
  scannerMinLength: number;
  autoSwitchOnNewInvoice: boolean;
  itemSortMode: 'LAST_SCANNED' | 'ORIGINAL_ORDER' | 'PENDING_FIRST' | 'ERRORS_FIRST';
  enableCameraQr: boolean;
}
