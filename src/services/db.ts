import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { 
  MasterInvoiceItem, 
  AuditDiscrepancy, 
  InvoiceAuditHistory, 
  ActiveInvoiceSession, 
  SyncMetadata,
  AppSettings,
  IncompleteInvoiceRecord,
  CompletedInvoiceRecord
} from '../types';

interface InvoiceAuditorDB extends DBSchema {
  master_items: {
    key: number;
    value: MasterInvoiceItem;
    indexes: {
      'by-invoice': string;
      'by-order': string;
      'by-item-code': string;
      'by-invoice-item': [string, string];
    };
  };
  audit_errors: {
    key: number;
    value: AuditDiscrepancy;
    indexes: {
      'by-invoice': string;
      'by-order': string;
      'by-date': string;
      'by-code-status': string;
      'by-qty-status': string;
    };
  };
  audit_history: {
    key: number;
    value: InvoiceAuditHistory;
    indexes: {
      'by-invoice': string;
      'by-order': string;
      'by-date': string;
    };
  };
  key_value: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'OfflineInvoiceAuditorDB';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<InvoiceAuditorDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<InvoiceAuditorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<InvoiceAuditorDB>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        // 1. Master Items store
        let masterStore: any;
        if (!db.objectStoreNames.contains('master_items')) {
          masterStore = db.createObjectStore('master_items', {
            keyPath: 'id',
            autoIncrement: true,
          });
          masterStore.createIndex('by-invoice', 'invoiceNo');
          masterStore.createIndex('by-order', 'orderNo');
          masterStore.createIndex('by-item-code', 'itemCode');
          masterStore.createIndex('by-invoice-item', ['invoiceNo', 'itemCode']);
        } else {
          masterStore = transaction.objectStore('master_items');
          if (masterStore && !masterStore.indexNames.contains('by-order')) {
            masterStore.createIndex('by-order', 'orderNo');
          }
        }

        // 2. Audit Errors Store
        let errorStore: any;
        if (!db.objectStoreNames.contains('audit_errors')) {
          errorStore = db.createObjectStore('audit_errors', {
            keyPath: 'id',
            autoIncrement: true,
          });
          errorStore.createIndex('by-invoice', 'invoiceNo');
          errorStore.createIndex('by-order', 'orderNo');
          errorStore.createIndex('by-date', 'auditedAt');
          errorStore.createIndex('by-code-status', 'codeStatus');
          errorStore.createIndex('by-qty-status', 'qtyStatus');
        } else {
          errorStore = transaction.objectStore('audit_errors');
          if (errorStore && !errorStore.indexNames.contains('by-order')) {
            errorStore.createIndex('by-order', 'orderNo');
          }
        }

        // 3. Audit History Store
        let historyStore: any;
        if (!db.objectStoreNames.contains('audit_history')) {
          historyStore = db.createObjectStore('audit_history', {
            keyPath: 'id',
            autoIncrement: true,
          });
          historyStore.createIndex('by-invoice', 'invoiceNo');
          historyStore.createIndex('by-order', 'orderNo');
          historyStore.createIndex('by-date', 'completedAt');
        } else {
          historyStore = transaction.objectStore('audit_history');
          if (historyStore && !historyStore.indexNames.contains('by-order')) {
            historyStore.createIndex('by-order', 'orderNo');
          }
        }

        // 4. Key Value Store
        if (!db.objectStoreNames.contains('key_value')) {
          db.createObjectStore('key_value');
        }
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// Master Items Operations
export async function saveMasterInvoiceItems(
  items: MasterInvoiceItem[], 
  fileName: string | null = null
): Promise<SyncMetadata> {
  const db = await getDB();
  const tx = db.transaction(['master_items', 'key_value'], 'readwrite');
  
  // Clear previous master items
  await tx.objectStore('master_items').clear();

  // Batch insert new items
  const store = tx.objectStore('master_items');
  const invoiceSet = new Set<string>();
  
  let indexCounter = 0;
  for (const item of items) {
    const sanitized: MasterInvoiceItem = {
      orderNo: item.orderNo?.trim() || undefined,
      invoiceNo: item.invoiceNo.trim(),
      itemCode: item.itemCode.trim(),
      itemName: item.itemName.trim(),
      unit: (item.unit || 'PCS').trim().toUpperCase(),
      requiredQty: Number(item.requiredQty) || 0,
      importedAt: new Date().toISOString(),
      originalIndex: item.originalIndex !== undefined ? item.originalIndex : indexCounter++,
    };
    invoiceSet.add(sanitized.invoiceNo);
    await store.add(sanitized);
  }

  const syncMeta: SyncMetadata = {
    lastSyncDate: new Date().toISOString(),
    totalInvoices: invoiceSet.size,
    totalItems: items.length,
    fileName,
  };

  await tx.objectStore('key_value').put(syncMeta, 'sync_metadata');
  await tx.done;

  return syncMeta;
}

export async function getSyncMetadata(): Promise<SyncMetadata> {
  const db = await getDB();
  const meta = await db.get('key_value', 'sync_metadata');
  return (meta as SyncMetadata) || {
    lastSyncDate: null,
    totalInvoices: 0,
    totalItems: 0,
    fileName: null,
  };
}

export async function getInvoiceMasterItems(invoiceNo: string): Promise<MasterInvoiceItem[]> {
  const db = await getDB();
  const clean = invoiceNo.trim();
  const all = await db.getAll('master_items');
  
  // Search by exact or case-insensitive invoiceNo OR orderNo
  const matched = all.filter(item => 
    item.invoiceNo.toLowerCase() === clean.toLowerCase() ||
    (item.orderNo && item.orderNo.toLowerCase() === clean.toLowerCase())
  );

  return matched;
}

export async function getAllMasterItems(): Promise<MasterInvoiceItem[]> {
  const db = await getDB();
  return db.getAll('master_items');
}

export async function getAllUniqueInvoices(): Promise<{ invoiceNo: string; orderNo?: string; itemCount: number; totalQty: number }[]> {
  const db = await getDB();
  const allItems = await db.getAll('master_items');
  
  const invoiceMap = new Map<string, { orderNo?: string; itemCount: number; totalQty: number }>();
  for (const item of allItems) {
    const existing = invoiceMap.get(item.invoiceNo) || { orderNo: item.orderNo, itemCount: 0, totalQty: 0 };
    existing.itemCount += 1;
    existing.totalQty += item.requiredQty;
    if (item.orderNo && !existing.orderNo) existing.orderNo = item.orderNo;
    invoiceMap.set(item.invoiceNo, existing);
  }

  return Array.from(invoiceMap.entries()).map(([invoiceNo, stats]) => ({
    invoiceNo,
    orderNo: stats.orderNo,
    itemCount: stats.itemCount,
    totalQty: stats.totalQty,
  }));
}

export async function doesInvoiceExist(query: string): Promise<boolean> {
  const db = await getDB();
  const clean = query.trim().toLowerCase();
  const all = await db.getAll('master_items');
  return all.some(item => 
    item.invoiceNo.toLowerCase() === clean || 
    (item.orderNo && item.orderNo.toLowerCase() === clean)
  );
}

// Active Session Persistence
export async function saveActiveSession(session: ActiveInvoiceSession | null): Promise<void> {
  const db = await getDB();
  if (session) {
    await db.put('key_value', session, 'active_session');
  } else {
    await db.delete('key_value', 'active_session');
  }
}

export async function getActiveSession(): Promise<ActiveInvoiceSession | null> {
  const db = await getDB();
  const session = await db.get('key_value', 'active_session');
  return (session as ActiveInvoiceSession) || null;
}

// Incomplete (Deferred) Invoices Queue Operations
export async function saveIncompleteInvoice(record: IncompleteInvoiceRecord): Promise<void> {
  const db = await getDB();
  const currentMap = ((await db.get('key_value', 'incomplete_invoices_map')) as Record<string, IncompleteInvoiceRecord>) || {};
  currentMap[record.invoiceNo.toLowerCase()] = record;
  if (record.orderNo) {
    currentMap[record.orderNo.toLowerCase()] = record;
  }
  await db.put('key_value', currentMap, 'incomplete_invoices_map');
}

export async function getAllIncompleteInvoices(): Promise<IncompleteInvoiceRecord[]> {
  const db = await getDB();
  const currentMap = ((await db.get('key_value', 'incomplete_invoices_map')) as Record<string, IncompleteInvoiceRecord>) || {};
  const uniqueRecords = new Map<string, IncompleteInvoiceRecord>();
  for (const record of Object.values(currentMap)) {
    uniqueRecords.set(record.invoiceNo, record);
  }
  return Array.from(uniqueRecords.values()).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
}

export async function getIncompleteInvoice(query: string): Promise<IncompleteInvoiceRecord | null> {
  const db = await getDB();
  const clean = query.trim().toLowerCase();
  const currentMap = ((await db.get('key_value', 'incomplete_invoices_map')) as Record<string, IncompleteInvoiceRecord>) || {};
  return currentMap[clean] || null;
}

export async function deleteIncompleteInvoice(invoiceNo: string): Promise<void> {
  const db = await getDB();
  const currentMap = ((await db.get('key_value', 'incomplete_invoices_map')) as Record<string, IncompleteInvoiceRecord>) || {};
  const target = currentMap[invoiceNo.toLowerCase()];
  delete currentMap[invoiceNo.toLowerCase()];
  if (target?.orderNo) {
    delete currentMap[target.orderNo.toLowerCase()];
  }
  await db.put('key_value', currentMap, 'incomplete_invoices_map');
}

// Completed Invoices Operations (Blocks re-scanning)
export async function markInvoiceAsCompleted(record: CompletedInvoiceRecord): Promise<void> {
  const db = await getDB();
  const currentMap = ((await db.get('key_value', 'completed_invoices_map')) as Record<string, CompletedInvoiceRecord>) || {};
  currentMap[record.invoiceNo.toLowerCase()] = record;
  if (record.orderNo) {
    currentMap[record.orderNo.toLowerCase()] = record;
  }
  await db.put('key_value', currentMap, 'completed_invoices_map');
  
  // Also remove from incomplete if it was previously deferred
  await deleteIncompleteInvoice(record.invoiceNo);
}

export async function getAllCompletedInvoices(): Promise<CompletedInvoiceRecord[]> {
  const db = await getDB();
  const currentMap = ((await db.get('key_value', 'completed_invoices_map')) as Record<string, CompletedInvoiceRecord>) || {};
  const uniqueRecords = new Map<string, CompletedInvoiceRecord>();
  for (const record of Object.values(currentMap)) {
    uniqueRecords.set(record.invoiceNo, record);
  }
  return Array.from(uniqueRecords.values()).sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
}

export async function isInvoiceCompleted(query: string): Promise<CompletedInvoiceRecord | null> {
  const db = await getDB();
  const clean = query.trim().toLowerCase();
  const currentMap = ((await db.get('key_value', 'completed_invoices_map')) as Record<string, CompletedInvoiceRecord>) || {};
  return currentMap[clean] || null;
}

export async function reopenCompletedInvoice(invoiceNo: string): Promise<void> {
  const db = await getDB();
  const currentMap = ((await db.get('key_value', 'completed_invoices_map')) as Record<string, CompletedInvoiceRecord>) || {};
  const target = currentMap[invoiceNo.toLowerCase()];
  delete currentMap[invoiceNo.toLowerCase()];
  if (target?.orderNo) {
    delete currentMap[target.orderNo.toLowerCase()];
  }
  await db.put('key_value', currentMap, 'completed_invoices_map');
}

// Global Audit Counters
export async function getInvoicesAuditSummaryStats(): Promise<{
  totalInvoices: number;
  completedCount: number;
  incompleteCount: number;
  remainingCount: number;
}> {
  const [allInvoices, completedList, incompleteList] = await Promise.all([
    getAllUniqueInvoices(),
    getAllCompletedInvoices(),
    getAllIncompleteInvoices(),
  ]);

  const totalInvoices = allInvoices.length;
  const completedCount = completedList.length;
  const incompleteCount = incompleteList.length;
  const remainingCount = Math.max(0, totalInvoices - completedCount);

  return {
    totalInvoices,
    completedCount,
    incompleteCount,
    remainingCount,
  };
}

// Audit Errors Operations
export async function saveAuditDiscrepancies(discrepancies: AuditDiscrepancy[]): Promise<void> {
  if (discrepancies.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('audit_errors', 'readwrite');
  for (const disc of discrepancies) {
    await tx.store.add(disc);
  }
  await tx.done;
}

export async function getAllAuditDiscrepancies(): Promise<AuditDiscrepancy[]> {
  const db = await getDB();
  const all = await db.getAll('audit_errors');
  return all.sort((a, b) => new Date(b.auditedAt).getTime() - new Date(a.auditedAt).getTime());
}

export async function clearAllAuditDiscrepancies(): Promise<void> {
  const db = await getDB();
  await db.clear('audit_errors');
  await db.clear('audit_history');
}

export async function deleteAuditDiscrepancy(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('audit_errors', id);
}

// Audit History Operations
export async function saveAuditHistory(history: InvoiceAuditHistory): Promise<void> {
  const db = await getDB();
  await db.add('audit_history', history);
}

export async function getAllAuditHistory(): Promise<InvoiceAuditHistory[]> {
  const db = await getDB();
  const all = await db.getAll('audit_history');
  return all.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
}

// Settings
export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ar',
  soundEnabled: true,
  soundVolume: 0.8,
  vibrationEnabled: true,
  scannerPrefixInvoice: 'INV-',
  scannerMinLength: 3,
  autoSwitchOnNewInvoice: true,
  itemSortMode: 'LAST_SCANNED',
  enableCameraQr: true,
};

export async function getAppSettings(): Promise<AppSettings> {
  const db = await getDB();
  const settings = await db.get('key_value', 'app_settings');
  return { ...DEFAULT_SETTINGS, ...((settings as AppSettings) || {}) };
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const db = await getDB();
  await db.put('key_value', settings, 'app_settings');
}
