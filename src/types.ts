export interface MasterInvoiceItem {
  id?: number;
  invoiceNo: string;
  itemCode: string;
  itemName: string;
  unit: string;
  requiredQty: number;
  importedAt: string;
}

export type CodeStatus = 'MATCH' | 'MISMATCH';
export type QtyStatus = 'EXACT' | 'SHORTAGE' | 'SURPLUS';

export interface ScannedAuditItem {
  itemCode: string;
  itemName: string;
  unit: string;
  requiredQty: number;
  actualQty: number;
  codeStatus: CodeStatus;
  qtyStatus: QtyStatus;
  lastScannedAt: string;
  scanHistory: string[]; // timestamps of each scan
}

export interface ActiveInvoiceSession {
  invoiceNo: string;
  startedAt: string;
  lastActivityAt: string;
  items: Record<string, ScannedAuditItem>; // Keyed by itemCode
  isLocked: boolean;
}

export interface AuditDiscrepancy {
  id?: number;
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
  invoiceNo: string;
  totalRequiredItems: number;
  scannedItemsCount: number;
  exactItemsCount: number;
  discrepancyCount: number;
  status: 'CLEAN' | 'DISCREPANCIES_FOUND';
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
  soundEnabled: boolean;
  soundVolume: number;
  vibrationEnabled: boolean;
  scannerPrefixInvoice: string; // optional prefix for invoice barcode e.g. "INV-"
  scannerMinLength: number;
  autoSwitchOnNewInvoice: boolean;
}
