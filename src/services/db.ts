import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { 
  MasterInvoiceItem, 
  AuditDiscrepancy, 
  InvoiceAuditHistory, 
  ActiveInvoiceSession, 
  SyncMetadata,
  AppSettings 
} from '../types';

interface InvoiceAuditorDB extends DBSchema {
  master_items: {
    key: number;
    value: MasterInvoiceItem;
    indexes: {
      'by-invoice': string;
      'by-item-code': string;
      'by-invoice-item': [string, string];
    };
  };
  audit_errors: {
    key: number;
    value: AuditDiscrepancy;
    indexes: {
      'by-invoice': string;
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
      'by-date': string;
    };
  };
  key_value: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'OfflineInvoiceAuditorDB';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<InvoiceAuditorDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<InvoiceAuditorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<InvoiceAuditorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // 1. Master Items store
        if (!db.objectStoreNames.contains('master_items')) {
          const masterStore = db.createObjectStore('master_items', {
            keyPath: 'id',
            autoIncrement: true,
          });
          masterStore.createIndex('by-invoice', 'invoiceNo');
          masterStore.createIndex('by-item-code', 'itemCode');
          masterStore.createIndex('by-invoice-item', ['invoiceNo', 'itemCode']);
        }

        // 2. Audit Errors Store
        if (!db.objectStoreNames.contains('audit_errors')) {
          const errorStore = db.createObjectStore('audit_errors', {
            keyPath: 'id',
            autoIncrement: true,
          });
          errorStore.createIndex('by-invoice', 'invoiceNo');
          errorStore.createIndex('by-date', 'auditedAt');
          errorStore.createIndex('by-code-status', 'codeStatus');
          errorStore.createIndex('by-qty-status', 'qtyStatus');
        }

        // 3. Audit History Store
        if (!db.objectStoreNames.contains('audit_history')) {
          const historyStore = db.createObjectStore('audit_history', {
            keyPath: 'id',
            autoIncrement: true,
          });
          historyStore.createIndex('by-invoice', 'invoiceNo');
          historyStore.createIndex('by-date', 'completedAt');
        }

        // 4. Key-Value Store for app state & settings
        if (!db.objectStoreNames.contains('key_value')) {
          db.createObjectStore('key_value');
        }
      },
    });
  }
  return dbPromise;
}

// Master Items Operations
export async function saveMasterInvoiceItems(items: MasterInvoiceItem[], fileName: string): Promise<SyncMetadata> {
  const db = await getDB();
  const tx = db.transaction(['master_items', 'key_value'], 'readwrite');
  
  // Clear previous master items
  await tx.objectStore('master_items').clear();

  // Batch insert new items
  const store = tx.objectStore('master_items');
  const invoiceSet = new Set<string>();
  
  for (const item of items) {
    // Standardize trimmed upper values for reliable barcode matching
    const sanitized: MasterInvoiceItem = {
      invoiceNo: item.invoiceNo.trim(),
      itemCode: item.itemCode.trim(),
      itemName: item.itemName.trim(),
      unit: (item.unit || 'PCS').trim().toUpperCase(),
      requiredQty: Number(item.requiredQty) || 0,
      importedAt: new Date().toISOString(),
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
  const tx = db.transaction('master_items', 'readonly');
  const index = tx.store.index('by-invoice');
  return index.getAll(invoiceNo.trim());
}

export async function getAllUniqueInvoices(): Promise<{ invoiceNo: string; itemCount: number; totalQty: number }[]> {
  const db = await getDB();
  const allItems = await db.getAll('master_items');
  
  const invoiceMap = new Map<string, { itemCount: number; totalQty: number }>();
  for (const item of allItems) {
    const existing = invoiceMap.get(item.invoiceNo) || { itemCount: 0, totalQty: 0 };
    existing.itemCount += 1;
    existing.totalQty += item.requiredQty;
    invoiceMap.set(item.invoiceNo, existing);
  }

  return Array.from(invoiceMap.entries()).map(([invoiceNo, stats]) => ({
    invoiceNo,
    itemCount: stats.itemCount,
    totalQty: stats.totalQty,
  }));
}

export async function doesInvoiceExist(invoiceNo: string): Promise<boolean> {
  const db = await getDB();
  const index = db.transaction('master_items', 'readonly').store.index('by-invoice');
  const count = await index.count(invoiceNo.trim());
  return count > 0;
}

// Active Session Persistence (Offline Crash & Refresh Protection)
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
  // Return sorted newest first
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
  soundEnabled: true,
  soundVolume: 0.8,
  vibrationEnabled: true,
  scannerPrefixInvoice: 'INV-',
  scannerMinLength: 3,
  autoSwitchOnNewInvoice: true,
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
