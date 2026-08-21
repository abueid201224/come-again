import React, { useState, useEffect, useCallback } from 'react';
import type { 
  ActiveInvoiceSession, 
  AuditDiscrepancy, 
  WrongPickingItem,
  SyncMetadata, 
  AppSettings,
  MasterInvoiceItem,
  ScannedAuditItem
} from './types';
import { 
  getActiveSession, 
  saveActiveSession, 
  getAllAuditDiscrepancies, 
  getAllWrongPickings,
  saveWrongPicking,
  findItemBelonging,
  getSyncMetadata, 
  getAppSettings, 
  saveAppSettings,
  getInvoiceMasterItems,
  doesInvoiceExist,
  getAllMasterItems,
  isInvoiceCompleted,
  getIncompleteInvoice,
  saveAuditDiscrepancies,
  getAllReturnReports,
  DEFAULT_SETTINGS
} from './services/db';
import { useScannerListener } from './services/scannerListener';
import { SoundEffects } from './services/audio';

import { Navbar, type ActiveNavTab } from './components/Navbar';
import { ActiveAuditScreen } from './components/ActiveAuditScreen';
import { ErrorReportScreen } from './components/ErrorReportScreen';
import { MasterDatabaseView } from './components/MasterDatabaseView';
import { ScannerSimulator } from './components/ScannerSimulator';
import { ExcelSyncModal } from './components/ExcelSyncModal';
import { InvoiceSummaryModal } from './components/InvoiceSummaryModal';
import { AuditorSignatureModal } from './components/AuditorSignatureModal';
import { ReceivingScreen } from './components/ReceivingScreen';
import { ReturnsScreen } from './components/ReturnsScreen';
import { InventoryCountScreen } from './components/InventoryCountScreen';
import { PickingWaveScreen } from './components/PickingWaveScreen';

// Helper for finding matching key ignoring case, whitespace, and leading zeros
function findMatchingItemKey(items: Record<string, ScannedAuditItem>, code: string): string | null {
  const clean = code.trim();
  if (items[clean]) return clean;

  const cleanLower = clean.toLowerCase();
  const strippedClean = clean.replace(/^0+/, '');

  for (const key of Object.keys(items)) {
    if (key.toLowerCase() === cleanLower) return key;
    if (strippedClean && key.replace(/^0+/, '').toLowerCase() === strippedClean.toLowerCase()) return key;
  }
  return null;
}

export function App() {
  const [currentTab, setCurrentTab] = useState<ActiveNavTab>('audit');
  const [activeSession, setActiveSession] = useState<ActiveInvoiceSession | null>(null);
  const [discrepancies, setDiscrepancies] = useState<AuditDiscrepancy[]>([]);
  const [wrongPickings, setWrongPickings] = useState<WrongPickingItem[]>([]);
  const [syncMeta, setSyncMeta] = useState<SyncMetadata>({
    lastSyncDate: null,
    totalInvoices: 0,
    totalItems: 0,
    fileName: null,
  });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [masterItemsList, setMasterItemsList] = useState<MasterInvoiceItem[]>([]);
  const [pendingLabCount, setPendingLabCount] = useState<number>(0);
  const [overdueLabCount, setOverdueLabCount] = useState<number>(0);
  
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isAuditorModalOpen, setIsAuditorModalOpen] = useState(false);
  const [summaryModalState, setSummaryModalState] = useState<{
    isOpen: boolean;
    invoiceNo: string;
    discardedCount: number;
    archivedDiscrepancies: AuditDiscrepancy[];
    totalRequiredQty?: number;
    totalScannedQty?: number;
    totalLineItems?: number;
  }>({
    isOpen: false,
    invoiceNo: '',
    discardedCount: 0,
    archivedDiscrepancies: [],
    totalRequiredQty: 0,
    totalScannedQty: 0,
    totalLineItems: 0,
  });
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);

  // Listen for PWA Install Prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    if (choiceResult.outcome === 'accepted') {
      setDeferredInstallPrompt(null);
    }
  };

  // Initial Load from local IndexedDB (100% Offline)
  useEffect(() => {
    async function initOfflineStorage() {
      try {
        const [savedSession, savedDiscrepancies, savedWrongPickings, savedMeta, savedSettings, allMaster, allReturns] = await Promise.all([
          getActiveSession(),
          getAllAuditDiscrepancies(),
          getAllWrongPickings(),
          getSyncMetadata(),
          getAppSettings(),
          getAllMasterItems(),
          getAllReturnReports(),
        ]);

        if (savedSession) setActiveSession(savedSession);
        if (savedDiscrepancies) setDiscrepancies(savedDiscrepancies);
        if (savedWrongPickings) setWrongPickings(savedWrongPickings);
        if (savedMeta) setSyncMeta(savedMeta);
        if (savedSettings) setSettings(savedSettings);
        if (allMaster) setMasterItemsList(allMaster);

        if (allReturns) {
          const pending = allReturns.filter(r => r.status === 'PENDING_LAB');
          setPendingLabCount(pending.length);
          setOverdueLabCount(pending.filter(r => r.isOverdueForLab).length);
        }
      } catch (err) {
        console.error('Error initializing offline database', err);
      }
    }

    initOfflineStorage();
  }, []);

  const refreshDiscrepancies = async () => {
    const list = await getAllAuditDiscrepancies();
    setDiscrepancies(list);
  };

  const refreshWrongPickings = async () => {
    const list = await getAllWrongPickings();
    setWrongPickings(list);
  };

  const refreshMasterData = async () => {
    const [meta, items] = await Promise.all([
      getSyncMetadata(),
      getAllMasterItems(),
    ]);
    setSyncMeta(meta);
    setMasterItemsList(items);
  };

  // Called when an invoice completes or switches
  const handleInvoiceCompleted = (
    invoiceNo: string, 
    discarded: number, 
    discList: AuditDiscrepancy[], 
    totalRequiredQty = 0, 
    totalScannedQty = 0, 
    totalLineItems = 0
  ) => {
    setSummaryModalState({
      isOpen: true,
      invoiceNo,
      discardedCount: discarded,
      archivedDiscrepancies: discList,
      totalRequiredQty,
      totalScannedQty,
      totalLineItems,
    });
    refreshDiscrepancies();
  };

  // STEP A: Lock onto Invoice
  const lockInvoiceByBarcode = useCallback(async (invoiceNo: string) => {
    const cleanInvoice = invoiceNo.trim();
    if (!cleanInvoice) return;

    // Check if completed
    const completed = await isInvoiceCompleted(cleanInvoice);
    if (completed) {
      if (settings.soundEnabled) SoundEffects.playAlreadyCompletedBlocked(settings.soundVolume);
      if (settings.vibrationEnabled) SoundEffects.vibrate([200, 100, 200]);
      setCurrentTab('audit');
      return;
    }

    const masterItems = await getInvoiceMasterItems(cleanInvoice);
    const incomplete = await getIncompleteInvoice(cleanInvoice);

    const initialItems: Record<string, ScannedAuditItem> = {};
    const now = new Date().toISOString();

    if (incomplete && incomplete.session && incomplete.session.items) {
      Object.assign(initialItems, incomplete.session.items);
    } else {
      masterItems.forEach((m, idx) => {
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
          orderNo: m.orderNo,
          originalIndex: m.originalIndex !== undefined ? m.originalIndex : idx,
        };
      });
    }

    const firstItemWithOrder = masterItems.find(m => Boolean(m.orderNo));

    const newSession: ActiveInvoiceSession = {
      invoiceNo: cleanInvoice,
      orderNo: firstItemWithOrder?.orderNo || incomplete?.orderNo,
      startedAt: incomplete?.session?.startedAt || now,
      lastActivityAt: now,
      items: initialItems,
      isLocked: true,
      lastScannedItemCode: null,
      longBarcodePolicy: 'ASK',
    };

    await saveActiveSession(newSession);
    setActiveSession(newSession);
    setCurrentTab('audit');

    if (settings.soundEnabled) SoundEffects.playInvoiceLock(settings.soundVolume);
    if (settings.vibrationEnabled) SoundEffects.vibrate(100);
  }, [settings.soundEnabled, settings.soundVolume, settings.vibrationEnabled]);

  // STEP B: Random Item Scan within active invoice (Supports ANY item in ANY order)
  const scanItemByBarcode = useCallback(async (code: string, currentSession: ActiveInvoiceSession) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;

    const threshold = settings.longBarcodeThreshold || 10;
    const isLongBarcode = cleanCode.length > threshold;
    const policy = currentSession.longBarcodePolicy || 'ASK';

    if (isLongBarcode && policy === 'BLOCK') {
      if (settings.soundEnabled) SoundEffects.playMismatchWarning(settings.soundVolume * 0.5);
      return;
    }

    const session = { ...currentSession };
    const items = { ...session.items };
    const now = new Date().toISOString();

    const matchingKey = findMatchingItemKey(items, cleanCode);
    let targetItem = matchingKey ? items[matchingKey] : null;
    let resolvedItemCode = cleanCode;

    if (targetItem) {
      // MATCH - ITEM BELONGS TO INVOICE
      resolvedItemCode = targetItem.itemCode;
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

      session.items = items;
      session.lastActivityAt = now;
      session.lastScannedItemCode = resolvedItemCode;

      await saveActiveSession(session);
      setActiveSession(session);
    } else {
      // WRONG PICKING (تجهيز خاطئ) - Item does NOT belong to this invoice!
      // Do NOT add to session.items! Divert directly to wrong_pickings table.
      if (settings.soundEnabled) SoundEffects.playMismatchWarning(settings.soundVolume);
      if (settings.vibrationEnabled) SoundEffects.vibrate([200, 100, 200, 100, 200]);

      const belonging = await findItemBelonging(cleanCode);

      await saveWrongPicking({
        activeInvoiceNo: session.invoiceNo,
        orderNo: session.orderNo,
        itemCode: cleanCode,
        itemName: belonging?.itemName || 'Unknown Foreign Item',
        unit: belonging?.unit || 'PCS',
        actualBelongingInvoiceNo: belonging?.invoiceNo,
        actualBelongingOrderNo: belonging?.orderNo,
        scannedAt: now,
        auditorName: settings.auditorName || 'Ahmed Hamada',
        auditorId: settings.auditorId || 'AUD-101',
        quantity: 1,
        notes: belonging?.invoiceNo 
          ? `Belongs to Invoice ${belonging.invoiceNo}${belonging.orderNo ? ` (Order: ${belonging.orderNo})` : ''}`
          : 'Foreign Item not in master database',
      });

      session.lastActivityAt = now;
      await saveActiveSession(session);
      setActiveSession(session);
      await refreshWrongPickings();
    }
  }, [settings.longBarcodeThreshold, settings.soundEnabled, settings.soundVolume, settings.vibrationEnabled]);

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
        // Step B: Item scan in current session (Random sequence)
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

  const handleToggleLanguage = () => {
    const newLang = settings.language === 'ar' ? 'en' : 'ar';
    handleUpdateSettings({ ...settings, language: newLang });
  };

  const isRtl = settings.language === 'ar';

  return (
    <div 
      className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white ${isRtl ? 'rtl' : 'ltr'}`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Top Navigation Bar */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        syncMeta={syncMeta}
        onOpenSyncModal={() => setIsSyncModalOpen(true)}
        errorCount={discrepancies.length + wrongPickings.length}
        wrongPickingCount={wrongPickings.length}
        overdueLabCount={overdueLabCount}
        pendingLabCount={pendingLabCount}
        settings={settings}
        onToggleSound={handleToggleSound}
        onToggleLanguage={handleToggleLanguage}
        isScannerActive={isScannerActive}
        canInstallPwa={Boolean(deferredInstallPrompt)}
        onInstallPwa={handleInstallPwa}
        onOpenAuditorModal={() => setIsAuditorModalOpen(true)}
      />

      {/* Main Screen Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5">
        {/* 1. Inbound Receiving Screen */}
        {currentTab === 'receiving' && (
          <ReceivingScreen
            settings={settings}
            lastScannedCode={lastScannedBarcode}
          />
        )}

        {/* 2. Invoice Dispatch Auditor Screen */}
        {currentTab === 'audit' && (
          <ActiveAuditScreen
            activeSession={activeSession}
            setActiveSession={setActiveSession}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onInvoiceCompleted={handleInvoiceCompleted}
            onOpenSyncModal={() => setIsSyncModalOpen(true)}
            lastScannedCode={lastScannedBarcode}
          />
        )}

        {/* 3. Returns & Refunds (RMA) Screen with Smart PDF extraction */}
        {currentTab === 'returns' && (
          <ReturnsScreen
            settings={settings}
            lastScannedCode={lastScannedBarcode}
            onOpenAuditorModal={() => setIsAuditorModalOpen(true)}
          />
        )}

        {/* 4. Cycle Count & Packaging Breakdown Screen */}
        {currentTab === 'inventory' && (
          <InventoryCountScreen
            settings={settings}
            lastScannedCode={lastScannedBarcode}
          />
        )}

        {/* 5. Batch Wave Picking List Generator Screen */}
        {currentTab === 'picking' && (
          <PickingWaveScreen
            settings={settings}
            lastScannedCode={lastScannedBarcode}
          />
        )}

        {/* Discrepancies & Discarded Wrong Pickings */}
        {currentTab === 'errors' && (
          <ErrorReportScreen
            discrepancies={discrepancies}
            wrongPickings={wrongPickings}
            onRefreshDiscrepancies={refreshDiscrepancies}
            onRefreshWrongPickings={refreshWrongPickings}
            settings={settings}
            onOpenAuditorModal={() => setIsAuditorModalOpen(true)}
          />
        )}

        {/* Master Database Screen */}
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

        {/* Scanner Simulator & Tools Screen */}
        {currentTab === 'settings' && (
          <ScannerSimulator
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onSimulateScan={handleHardwareScan}
            activeInvoiceNo={activeSession?.invoiceNo || null}
            masterItems={masterItemsList}
            onOpenAuditorModal={() => setIsAuditorModalOpen(true)}
            canInstallPwa={Boolean(deferredInstallPrompt)}
            onInstallPwa={handleInstallPwa}
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

      {/* Auditor Profile & Digital Signature Modal (ISA 500 Evidence Compliance) */}
      <AuditorSignatureModal
        isOpen={isAuditorModalOpen}
        onClose={() => setIsAuditorModalOpen(false)}
        settings={settings}
        onSaveSettings={handleUpdateSettings}
      />

      {/* Invoice Evaluation & Switch Summary Modal */}
      <InvoiceSummaryModal
        isOpen={summaryModalState.isOpen}
        onClose={() => setSummaryModalState(prev => ({ ...prev, isOpen: false }))}
        invoiceNo={summaryModalState.invoiceNo}
        discardedCount={summaryModalState.discardedCount}
        archivedDiscrepancies={summaryModalState.archivedDiscrepancies}
        totalRequiredQty={summaryModalState.totalRequiredQty}
        totalScannedQty={summaryModalState.totalScannedQty}
        totalLineItems={summaryModalState.totalLineItems}
        auditorName={settings.auditorName}
        auditorId={settings.auditorId}
        auditorSignature={settings.auditorSignature}
        language={settings.language}
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

export default App;
