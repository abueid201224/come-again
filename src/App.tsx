import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { ActiveAuditScreen } from './components/ActiveAuditScreen';
import { ErrorReportScreen } from './components/ErrorReportScreen';
import { MasterDatabaseView } from './components/MasterDatabaseView';
import { ScannerSimulator } from './components/ScannerSimulator';
import { ExcelSyncModal } from './components/ExcelSyncModal';
import { InvoiceSummaryModal } from './components/InvoiceSummaryModal';
import { 
  getSyncMetadata, 
  getActiveSession, 
  getAllAuditDiscrepancies, 
  getAppSettings, 
  saveAppSettings,
  saveActiveSession,
  getInvoiceMasterItems,
  saveMasterInvoiceItems,
  doesInvoiceExist,
  getAllUniqueInvoices
} from './services/db';
import { getSampleDailyItems } from './services/excelService';
import { useScannerListener } from './services/scannerListener';
import { SoundEffects } from './services/audio';
import type { 
  ActiveInvoiceSession, 
  AuditDiscrepancy, 
  SyncMetadata, 
  AppSettings, 
  MasterInvoiceItem,
  ScannedAuditItem 
} from './types';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'audit' | 'errors' | 'master' | 'settings'>('audit');
  const [syncMeta, setSyncMeta] = useState<SyncMetadata>({
    lastSyncDate: null,
    totalInvoices: 0,
    totalItems: 0,
    fileName: null,
  });
  const [activeSession, setActiveSession] = useState<ActiveInvoiceSession | null>(null);
  const [discrepancies, setDiscrepancies] = useState<AuditDiscrepancy[]>([]);
  const [masterItemsList, setMasterItemsList] = useState<MasterInvoiceItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    soundEnabled: true,
    soundVolume: 0.8,
    vibrationEnabled: true,
    scannerPrefixInvoice: 'INV-',
    scannerMinLength: 3,
    autoSwitchOnNewInvoice: true,
  });

  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [summaryModalState, setSummaryModalState] = useState<{
    isOpen: boolean;
    invoiceNo: string;
    discardedCount: number;
    archivedDiscrepancies: AuditDiscrepancy[];
  }>({
    isOpen: false,
    invoiceNo: '',
    discardedCount: 0,
    archivedDiscrepancies: [],
  });

  // Initial load from IndexedDB
  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      const [meta, session, errors, appSettings] = await Promise.all([
        getSyncMetadata(),
        getActiveSession(),
        getAllAuditDiscrepancies(),
        getAppSettings(),
      ]);

      setSettings(appSettings);
      setDiscrepancies(errors);
      setActiveSession(session);

      // If database is completely empty on first launch, preload sample daily dataset
      if (!meta.lastSyncDate || meta.totalItems === 0) {
        const sampleItems = getSampleDailyItems();
        const newMeta = await saveMasterInvoiceItems(sampleItems, 'Daily_Warehouse_Manifest_Demo.xlsx');
        setSyncMeta(newMeta);
        setMasterItemsList(sampleItems);
      } else {
        setSyncMeta(meta);
        const unique = await getAllUniqueInvoices();
        // Load all items for simulator
        const allItems: MasterInvoiceItem[] = [];
        for (const u of unique) {
          const items = await getInvoiceMasterItems(u.invoiceNo);
          allItems.push(...items);
        }
        setMasterItemsList(allItems);
      }
    } catch (err) {
      console.error('Failed to initialize IndexedDB storage', err);
    }
  };

  const refreshDiscrepancies = async () => {
    const all = await getAllAuditDiscrepancies();
    setDiscrepancies(all);
  };

  const refreshMasterData = async () => {
    const meta = await getSyncMetadata();
    setSyncMeta(meta);
    const unique = await getAllUniqueInvoices();
    const allItems: MasterInvoiceItem[] = [];
    for (const u of unique) {
      const items = await getInvoiceMasterItems(u.invoiceNo);
      allItems.push(...items);
    }
    setMasterItemsList(allItems);
  };

  // Switch / complete current invoice session
  const handleInvoiceCompleted = (
    invoiceNo: string, 
    discarded: number, 
    archivedErrors: AuditDiscrepancy[]
  ) => {
    setSummaryModalState({
      isOpen: true,
      invoiceNo,
      discardedCount: discarded,
      archivedDiscrepancies: archivedErrors,
    });
    refreshDiscrepancies();
  };

  // STEP A: Lock Invoice from barcode or UI
  const lockInvoiceByBarcode = useCallback(async (invoiceNo: string) => {
    const cleanInvoice = invoiceNo.trim();
    if (!cleanInvoice) return;

    const masterItems = await getInvoiceMasterItems(cleanInvoice);
    const initialItems: Record<string, ScannedAuditItem> = {};
    const now = new Date().toISOString();

    masterItems.forEach((m) => {
      initialItems[m.itemCode] = {
        itemCode: m.itemCode,
        itemName: m.itemName,
        unit: m.unit,
        requiredQty: m.requiredQty,
        actualQty: 0,
        codeStatus: 'MATCH',
        qtyStatus: 'SHORTAGE',
        lastScannedAt: now,
        scanHistory: [],
      };
    });

    const newSession: ActiveInvoiceSession = {
      invoiceNo: cleanInvoice,
      startedAt: now,
      lastActivityAt: now,
      items: initialItems,
      isLocked: true,
    };

    await saveActiveSession(newSession);
    setActiveSession(newSession);
    setCurrentTab('audit');

    if (settings.soundEnabled) SoundEffects.playInvoiceLock(settings.soundVolume);
    if (settings.vibrationEnabled) SoundEffects.vibrate(100);
  }, [settings.soundEnabled, settings.soundVolume, settings.vibrationEnabled]);

  // STEP B: Scan Item within active invoice
  const scanItemByBarcode = useCallback(async (code: string, currentSession: ActiveInvoiceSession) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;

    const session = { ...currentSession };
    const items = { ...session.items };
    const now = new Date().toISOString();

    let targetItem = items[cleanCode];
    if (!targetItem) {
      const matchKey = Object.keys(items).find(k => k.toLowerCase() === cleanCode.toLowerCase());
      if (matchKey) targetItem = items[matchKey];
    }

    if (targetItem) {
      // MATCH
      const newActualQty = targetItem.actualQty + 1;
      let newQtyStatus: 'EXACT' | 'SHORTAGE' | 'SURPLUS' = 'SHORTAGE';

      if (newActualQty === targetItem.requiredQty) {
        newQtyStatus = 'EXACT';
        if (settings.soundEnabled) SoundEffects.playExactComplete(settings.soundVolume);
        if (settings.vibrationEnabled) SoundEffects.vibrate([80, 50, 80]);
      } else if (newActualQty > targetItem.requiredQty) {
        newQtyStatus = 'SURPLUS';
        if (settings.soundEnabled) SoundEffects.playSurplusAlert(settings.soundVolume);
        if (settings.vibrationEnabled) SoundEffects.vibrate([150, 100, 150]);
      } else {
        newQtyStatus = 'SHORTAGE';
        if (settings.soundEnabled) SoundEffects.playScanMatch(settings.soundVolume);
        if (settings.vibrationEnabled) SoundEffects.vibrate(40);
      }

      items[targetItem.itemCode] = {
        ...targetItem,
        actualQty: newActualQty,
        qtyStatus: newQtyStatus,
        lastScannedAt: now,
        scanHistory: [...(targetItem.scanHistory || []), now],
      };
    } else {
      // MISMATCH
      if (settings.soundEnabled) SoundEffects.playMismatchWarning(settings.soundVolume);
      if (settings.vibrationEnabled) SoundEffects.vibrate([200, 100, 200, 100, 200]);

      items[cleanCode] = {
        itemCode: cleanCode,
        itemName: `Unknown Item (${cleanCode})`,
        unit: 'PCS',
        requiredQty: 0,
        actualQty: 1,
        codeStatus: 'MISMATCH',
        qtyStatus: 'SURPLUS',
        lastScannedAt: now,
        scanHistory: [now],
      };
    }

    session.items = items;
    session.lastActivityAt = now;

    await saveActiveSession(session);
    setActiveSession(session);
  }, [settings.soundEnabled, settings.soundVolume, settings.vibrationEnabled]);

  // Global Hardware 1D Barcode Scanner Keyboard-Wedge Listener
  const handleHardwareScan = useCallback(async (barcode: string) => {
    const clean = barcode.trim();
    if (!clean) return;

    // Check if barcode is an Invoice identifier
    const existsAsInvoice = await doesInvoiceExist(clean);
    const looksLikeInvoice = clean.toUpperCase().startsWith(settings.scannerPrefixInvoice.toUpperCase());

    if (!activeSession) {
      // Step A: Lock onto Invoice
      await lockInvoiceByBarcode(clean);
    } else {
      // If user scans a different invoice barcode while an invoice is active -> Automatic Switch & Clean!
      if ((existsAsInvoice || looksLikeInvoice) && clean.toLowerCase() !== activeSession.invoiceNo.toLowerCase()) {
        // Automatically evaluate previous invoice
        const prevSession = activeSession;
        const allItems: ScannedAuditItem[] = Object.values(prevSession.items);
        const auditedAt = new Date().toISOString();

        let cleanDiscarded = 0;
        const discrepanciesToArchive: AuditDiscrepancy[] = [];

        for (const item of allItems) {
          if (item.codeStatus === 'MATCH' && item.qtyStatus === 'EXACT') {
            cleanDiscarded += 1;
          } else {
            discrepanciesToArchive.push({
              invoiceNo: prevSession.invoiceNo,
              itemCode: item.itemCode,
              itemName: item.itemName,
              unit: item.unit,
              requiredQty: item.requiredQty,
              actualQty: item.actualQty,
              codeStatus: item.codeStatus,
              qtyStatus: item.qtyStatus,
              difference: item.actualQty - item.requiredQty,
              auditedAt,
              notes: item.codeStatus === 'MISMATCH' ? 'Mismatch' : item.qtyStatus,
            });
          }
        }

        handleInvoiceCompleted(prevSession.invoiceNo, cleanDiscarded, discrepanciesToArchive);

        // Immediately lock onto new invoice
        await lockInvoiceByBarcode(clean);
      } else {
        // Step B: Item scan in current session
        await scanItemByBarcode(clean, activeSession);
      }
    }
  }, [activeSession, lockInvoiceByBarcode, scanItemByBarcode, settings.scannerPrefixInvoice]);

  const { lastScannedBarcode, isScannerActive } = useScannerListener({
    onScan: handleHardwareScan,
    minLength: settings.scannerMinLength,
  });

  const handleUpdateSettings = async (newSettings: AppSettings) => {
    setSettings(newSettings);
    await saveAppSettings(newSettings);
  };

  const handleToggleSound = () => {
    handleUpdateSettings({ ...settings, soundEnabled: !settings.soundEnabled });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      {/* Top Navigation Bar */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        syncMeta={syncMeta}
        onOpenSyncModal={() => setIsSyncModalOpen(true)}
        errorCount={discrepancies.length}
        soundEnabled={settings.soundEnabled}
        onToggleSound={handleToggleSound}
        isScannerActive={isScannerActive}
      />

      {/* Main Screen Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5">
        {currentTab === 'audit' && (
          <ActiveAuditScreen
            activeSession={activeSession}
            setActiveSession={setActiveSession}
            soundEnabled={settings.soundEnabled}
            vibrationEnabled={settings.vibrationEnabled}
            onInvoiceCompleted={handleInvoiceCompleted}
            onOpenSyncModal={() => setIsSyncModalOpen(true)}
            lastScannedCode={lastScannedBarcode}
          />
        )}

        {currentTab === 'errors' && (
          <ErrorReportScreen
            discrepancies={discrepancies}
            onRefreshDiscrepancies={refreshDiscrepancies}
          />
        )}

        {currentTab === 'master' && (
          <MasterDatabaseView
            syncMeta={syncMeta}
            onOpenSyncModal={() => setIsSyncModalOpen(true)}
            onSelectInvoice={(invNo) => {
              lockInvoiceByBarcode(invNo);
              setCurrentTab('audit');
            }}
          />
        )}

        {currentTab === 'settings' && (
          <ScannerSimulator
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onSimulateScan={handleHardwareScan}
            activeInvoiceNo={activeSession?.invoiceNo || null}
            masterItems={masterItemsList}
          />
        )}
      </main>

      {/* Daily Excel Sync Modal */}
      <ExcelSyncModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        currentMeta={syncMeta}
        onSyncComplete={(meta) => {
          setSyncMeta(meta);
          refreshMasterData();
        }}
      />

      {/* Invoice Evaluation & Switch Summary Modal */}
      <InvoiceSummaryModal
        isOpen={summaryModalState.isOpen}
        onClose={() => setSummaryModalState(prev => ({ ...prev, isOpen: false }))}
        invoiceNo={summaryModalState.invoiceNo}
        discardedCount={summaryModalState.discardedCount}
        archivedDiscrepancies={summaryModalState.archivedDiscrepancies}
        onViewErrorReport={() => {
          setSummaryModalState(prev => ({ ...prev, isOpen: false }));
          setCurrentTab('errors');
        }}
        onContinueScanning={() => {
          setSummaryModalState(prev => ({ ...prev, isOpen: false }));
          setCurrentTab('audit');
        }}
      />
    </div>
  );
}
