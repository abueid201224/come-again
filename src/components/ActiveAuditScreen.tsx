import React, { useState, useEffect, useRef } from 'react';
import { 
  ScanLine, 
  Lock, 
  Unlock, 
  CheckCircle2, 
  AlertTriangle, 
  Plus, 
  Minus, 
  RotateCcw, 
  Package, 
  FileText, 
  ArrowRight,
  Sparkles,
  Zap,
  HelpCircle
} from 'lucide-react';
import type { 
  ActiveInvoiceSession, 
  MasterInvoiceItem, 
  ScannedAuditItem, 
  AuditDiscrepancy 
} from '../types';
import { 
  getInvoiceMasterItems, 
  saveActiveSession, 
  saveAuditDiscrepancies, 
  saveAuditHistory,
  getAllUniqueInvoices
} from '../services/db';
import { SoundEffects } from '../services/audio';

interface ActiveAuditScreenProps {
  activeSession: ActiveInvoiceSession | null;
  setActiveSession: (session: ActiveInvoiceSession | null) => void;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  onInvoiceCompleted: (invoiceNo: string, discarded: number, discrepancies: AuditDiscrepancy[]) => void;
  onOpenSyncModal: () => void;
  lastScannedCode: string | null;
}

export const ActiveAuditScreen: React.FC<ActiveAuditScreenProps> = ({
  activeSession,
  setActiveSession,
  soundEnabled,
  vibrationEnabled,
  onInvoiceCompleted,
  onOpenSyncModal,
  lastScannedCode,
}) => {
  const [manualInput, setManualInput] = useState('');
  const [availableInvoices, setAvailableInvoices] = useState<{ invoiceNo: string; itemCount: number; totalQty: number }[]>([]);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(false);
  const [activeTabFilter, setActiveTabFilter] = useState<'ALL' | 'PENDING' | 'EXACT' | 'DISCREPANCIES'>('ALL');
  const [recentScanFeedback, setRecentScanFeedback] = useState<{ code: string; message: string; type: 'match' | 'exact' | 'mismatch' | 'surplus' } | null>(null);

  const scannerInputRef = useRef<HTMLInputElement>(null);

  // Load available invoices list for quick pickers
  useEffect(() => {
    loadInvoicesList();
  }, [activeSession]);

  const loadInvoicesList = async () => {
    try {
      const list = await getAllUniqueInvoices();
      setAvailableInvoices(list);
    } catch (err) {
      console.error('Failed to load invoice list', err);
    }
  };

  // Keep scanner input focused on mobile/desktop for hardware wedge readiness
  useEffect(() => {
    const timer = setTimeout(() => {
      scannerInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [activeSession]);

  // STEP A: Lock into an Invoice session
  const lockInvoiceSession = async (invoiceNoInput: string) => {
    const invoiceNo = invoiceNoInput.trim();
    if (!invoiceNo) return;

    setIsLoadingInvoice(true);
    try {
      const masterItems = await getInvoiceMasterItems(invoiceNo);

      // Create new session
      const initialItems: Record<string, ScannedAuditItem> = {};
      const now = new Date().toISOString();

      // Populate known items with Actual_Qty = 0
      masterItems.forEach((m) => {
        initialItems[m.itemCode] = {
          itemCode: m.itemCode,
          itemName: m.itemName,
          unit: m.unit,
          requiredQty: m.requiredQty,
          actualQty: 0,
          codeStatus: 'MATCH',
          qtyStatus: 'SHORTAGE', // 0 < reqQty
          lastScannedAt: now,
          scanHistory: [],
        };
      });

      const newSession: ActiveInvoiceSession = {
        invoiceNo,
        startedAt: now,
        lastActivityAt: now,
        items: initialItems,
        isLocked: true,
      };

      await saveActiveSession(newSession);
      setActiveSession(newSession);

      if (soundEnabled) SoundEffects.playInvoiceLock();
      if (vibrationEnabled) SoundEffects.vibrate(100);

      setRecentScanFeedback({
        code: invoiceNo,
        message: masterItems.length > 0 
          ? `Locked Invoice ${invoiceNo} (${masterItems.length} items to audit). Ready for item scans.`
          : `Invoice ${invoiceNo} not in master file, but session initialized for auditing.`,
        type: 'match',
      });
    } catch (err) {
      console.error('Failed to lock invoice session', err);
    } finally {
      setIsLoadingInvoice(false);
      setManualInput('');
    }
  };

  // STEP B: Handle Item Scan in active invoice session
  const handleItemScan = async (scannedItemCode: string) => {
    if (!activeSession) return;
    const cleanCode = scannedItemCode.trim();
    if (!cleanCode) return;

    const session = { ...activeSession };
    const items = { ...session.items };
    const now = new Date().toISOString();

    let targetItem = items[cleanCode];

    if (!targetItem) {
      // Check if it exists with case-insensitivity
      const matchingKey = Object.keys(items).find(k => k.toLowerCase() === cleanCode.toLowerCase());
      if (matchingKey) {
        targetItem = items[matchingKey];
      }
    }

    let feedbackType: 'match' | 'exact' | 'mismatch' | 'surplus' = 'match';
    let feedbackMsg = '';

    if (targetItem) {
      // ITEM BELONGS TO INVOICE (Code_Status: MATCH)
      const newActualQty = targetItem.actualQty + 1;
      let newQtyStatus: 'EXACT' | 'SHORTAGE' | 'SURPLUS' = 'SHORTAGE';

      if (newActualQty === targetItem.requiredQty) {
        newQtyStatus = 'EXACT';
        feedbackType = 'exact';
        feedbackMsg = `EXACT MATCH! [${cleanCode}] count reached required ${targetItem.requiredQty} ${targetItem.unit}`;
        if (soundEnabled) SoundEffects.playExactComplete();
        if (vibrationEnabled) SoundEffects.vibrate([80, 50, 80]);
      } else if (newActualQty > targetItem.requiredQty) {
        newQtyStatus = 'SURPLUS';
        feedbackType = 'surplus';
        feedbackMsg = `SURPLUS WARNING! [${cleanCode}] count ${newActualQty} exceeds required ${targetItem.requiredQty}`;
        if (soundEnabled) SoundEffects.playSurplusAlert();
        if (vibrationEnabled) SoundEffects.vibrate([150, 100, 150]);
      } else {
        newQtyStatus = 'SHORTAGE';
        feedbackType = 'match';
        feedbackMsg = `Item [${cleanCode}] +1 (Scanned ${newActualQty} of ${targetItem.requiredQty} ${targetItem.unit})`;
        if (soundEnabled) SoundEffects.playScanMatch();
        if (vibrationEnabled) SoundEffects.vibrate(40);
      }

      items[targetItem.itemCode] = {
        ...targetItem,
        actualQty: newActualQty,
        qtyStatus: newQtyStatus,
        lastScannedAt: now,
        scanHistory: [...(targetItem.scanHistory || []), now],
      };
    } else {
      // ITEM DOES NOT BELONG TO INVOICE (Code_Status: MISMATCH)
      feedbackType = 'mismatch';
      feedbackMsg = `MISMATCH ALERT! Item [${cleanCode}] is NOT listed in Invoice ${session.invoiceNo}!`;
      if (soundEnabled) SoundEffects.playMismatchWarning();
      if (vibrationEnabled) SoundEffects.vibrate([200, 100, 200, 100, 200]);

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

    setRecentScanFeedback({
      code: cleanCode,
      message: feedbackMsg,
      type: feedbackType,
    });

    await saveActiveSession(session);
    setActiveSession(session);
    setManualInput('');
  };

  // Manual Adjustments (+, -, Reset)
  const adjustItemQuantity = async (itemCode: string, delta: number) => {
    if (!activeSession) return;
    const session = { ...activeSession };
    const items = { ...session.items };
    const item = items[itemCode];
    if (!item) return;

    const newQty = Math.max(0, item.actualQty + delta);
    let newQtyStatus: 'EXACT' | 'SHORTAGE' | 'SURPLUS' = 'SHORTAGE';

    if (item.codeStatus === 'MISMATCH') {
      newQtyStatus = newQty > 0 ? 'SURPLUS' : 'EXACT';
    } else {
      if (newQty === item.requiredQty) newQtyStatus = 'EXACT';
      else if (newQty > item.requiredQty) newQtyStatus = 'SURPLUS';
      else newQtyStatus = 'SHORTAGE';
    }

    items[itemCode] = {
      ...item,
      actualQty: newQty,
      qtyStatus: newQtyStatus,
      lastScannedAt: new Date().toISOString(),
    };

    session.items = items;
    await saveActiveSession(session);
    setActiveSession(session);
  };

  // STEP 5: Invoice Switching & Automatic Cleanup (CRITICAL)
  const completeAndSwitchInvoice = async (newInvoiceNoToLock?: string) => {
    if (!activeSession) return;

    const session = activeSession;
    const allItems: ScannedAuditItem[] = Object.values(session.items);
    const auditedAt = new Date().toISOString();

    let cleanDiscardedCount = 0;
    const discrepanciesToArchive: AuditDiscrepancy[] = [];

    // Evaluate each row
    for (const item of allItems) {
      const isExactMatch = item.codeStatus === 'MATCH' && item.qtyStatus === 'EXACT';

      if (isExactMatch) {
        // 2. AUTOMATICALLY DELETE/DISCARD all fully correct items
        cleanDiscardedCount += 1;
      } else {
        // 3. AUTOMATICALLY SAVE & ARCHIVE only the discrepancies/errors into Error Audit Report
        discrepanciesToArchive.push({
          invoiceNo: session.invoiceNo,
          itemCode: item.itemCode,
          itemName: item.itemName,
          unit: item.unit,
          requiredQty: item.requiredQty,
          actualQty: item.actualQty,
          codeStatus: item.codeStatus,
          qtyStatus: item.qtyStatus,
          difference: item.actualQty - item.requiredQty,
          auditedAt,
          notes: item.codeStatus === 'MISMATCH' 
            ? 'Item not present in invoice manifest' 
            : item.qtyStatus === 'SHORTAGE' 
              ? `Shortage of ${item.requiredQty - item.actualQty} ${item.unit}` 
              : `Surplus of ${item.actualQty - item.requiredQty} ${item.unit}`,
        });
      }
    }

    // Save to permanent IndexedDB error store
    if (discrepanciesToArchive.length > 0) {
      await saveAuditDiscrepancies(discrepanciesToArchive);
    }

    // Save session history record
    const startTime = new Date(session.startedAt).getTime();
    const endTime = new Date().getTime();
    const durationSeconds = Math.max(1, Math.round((endTime - startTime) / 1000));

    await saveAuditHistory({
      invoiceNo: session.invoiceNo,
      totalRequiredItems: allItems.filter(i => i.codeStatus === 'MATCH').length,
      scannedItemsCount: allItems.reduce((acc, curr) => acc + curr.actualQty, 0),
      exactItemsCount: cleanDiscardedCount,
      discrepancyCount: discrepanciesToArchive.length,
      status: discrepanciesToArchive.length === 0 ? 'CLEAN' : 'DISCREPANCIES_FOUND',
      completedAt: auditedAt,
      durationSeconds,
    });

    // Clear active session from DB
    await saveActiveSession(null);
    setActiveSession(null);

    // Trigger completion modal notification
    onInvoiceCompleted(session.invoiceNo, cleanDiscardedCount, discrepanciesToArchive);

    // If a new invoice barcode was scanned, immediately lock onto it!
    if (newInvoiceNoToLock && newInvoiceNoToLock !== session.invoiceNo) {
      setTimeout(() => {
        lockInvoiceSession(newInvoiceNoToLock);
      }, 200);
    }
  };

  // Form submit handler for manual/wedge input
  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualInput.trim();
    if (!code) return;

    if (!activeSession) {
      // Step A: Lock invoice
      lockInvoiceSession(code);
    } else {
      // Step B: Item scan OR Invoice switch check
      // Check if user is scanning a known invoice barcode to switch
      const isKnownInvoice = availableInvoices.some(inv => inv.invoiceNo.toLowerCase() === code.toLowerCase());
      if (isKnownInvoice && code.toLowerCase() !== activeSession.invoiceNo.toLowerCase()) {
        completeAndSwitchInvoice(code);
      } else {
        handleItemScan(code);
      }
    }
  };

  // Computed metrics for active session
  const itemsList: ScannedAuditItem[] = activeSession ? Object.values(activeSession.items) : [];
  const totalItemsRequired = itemsList.filter(i => i.codeStatus === 'MATCH').length;
  const exactCount = itemsList.filter(i => i.codeStatus === 'MATCH' && i.qtyStatus === 'EXACT').length;
  const shortageCount = itemsList.filter(i => i.codeStatus === 'MATCH' && i.qtyStatus === 'SHORTAGE').length;
  const surplusCount = itemsList.filter(i => i.qtyStatus === 'SURPLUS').length;
  const mismatchCount = itemsList.filter(i => i.codeStatus === 'MISMATCH').length;
  const progressPercent = totalItemsRequired > 0 ? Math.round((exactCount / totalItemsRequired) * 100) : 0;

  // Filter items
  const filteredItems = itemsList.filter((item) => {
    if (activeTabFilter === 'PENDING') return item.qtyStatus === 'SHORTAGE';
    if (activeTabFilter === 'EXACT') return item.qtyStatus === 'EXACT';
    if (activeTabFilter === 'DISCREPANCIES') return item.codeStatus === 'MISMATCH' || item.qtyStatus === 'SURPLUS' || (item.actualQty > 0 && item.qtyStatus === 'SHORTAGE');
    return true;
  });

  return (
    <div className="space-y-4">
      {/* 1. TOP SCANNER INPUT & WEDGE STATUS BAR */}
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-3 sm:p-4 shadow-lg">
        <form onSubmit={handleInputSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-emerald-400">
              <ScanLine className="w-5 h-5 animate-pulse" />
            </div>
            <input
              ref={scannerInputRef}
              data-scanner-input="true"
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder={
                !activeSession 
                  ? "Scan or enter Invoice Barcode (e.g. INV-2024-001)..." 
                  : `Scan Item Barcode for ${activeSession.invoiceNo} (or scan new Invoice to switch)...`
              }
              className="w-full pl-11 pr-4 py-3 bg-slate-950 text-white font-mono text-sm sm:text-base rounded-lg border-2 border-emerald-500/70 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20 outline-none transition-all placeholder:text-slate-500"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
            />
          </div>

          <button
            type="submit"
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold px-6 py-3 rounded-lg text-sm sm:text-base shadow transition-all whitespace-nowrap"
          >
            <Zap className="w-4 h-4" />
            <span>{!activeSession ? 'Lock Invoice' : 'Scan Item'}</span>
          </button>
        </form>

        {/* Live Feedback Toast / Scan Notification */}
        {recentScanFeedback && (
          <div className={`mt-2.5 px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-between gap-2 border animate-in fade-in slide-in-from-top-1 duration-150 ${
            recentScanFeedback.type === 'exact'
              ? 'bg-emerald-950/80 border-emerald-600/80 text-emerald-200'
              : recentScanFeedback.type === 'mismatch'
                ? 'bg-red-950/90 border-red-600/80 text-red-200'
                : recentScanFeedback.type === 'surplus'
                  ? 'bg-amber-950/90 border-amber-600/80 text-amber-200'
                  : 'bg-blue-950/80 border-blue-600/80 text-blue-200'
          }`}>
            <div className="flex items-center gap-2 truncate">
              {recentScanFeedback.type === 'exact' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
              {recentScanFeedback.type === 'mismatch' && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 animate-bounce" />}
              {recentScanFeedback.type === 'surplus' && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
              {recentScanFeedback.type === 'match' && <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />}
              <span className="truncate">{recentScanFeedback.message}</span>
            </div>
            <span className="font-mono text-[11px] opacity-75 shrink-0">Just now</span>
          </div>
        )}
      </div>

      {/* 2. NO ACTIVE INVOICE SCREEN (Step A Waiting) */}
      {!activeSession ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 sm:p-8 text-center space-y-6 shadow-md">
          <div className="max-w-md mx-auto space-y-3">
            <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto text-emerald-400 border border-slate-700 shadow-inner">
              <Lock className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-white">
              Step A: Scan Invoice Barcode to Begin Audit
            </h2>
            <p className="text-sm text-slate-400">
              Point your handheld 1D barcode scanner at an invoice manifest barcode. The app will lock onto that invoice and prepare line items for verification.
            </p>
          </div>

          {/* Quick Invoice Picker from Daily Master Data */}
          {availableInvoices.length > 0 ? (
            <div className="max-w-2xl mx-auto space-y-3 pt-4 border-t border-slate-800 text-left">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold uppercase tracking-wider">
                  Or Select from {availableInvoices.length} Loaded Master Invoices:
                </span>
                <span className="text-emerald-400 font-mono">100% Offline Ready</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {availableInvoices.map((inv) => (
                  <button
                    key={inv.invoiceNo}
                    onClick={() => lockInvoiceSession(inv.invoiceNo)}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-950/70 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/60 transition-all text-left group"
                  >
                    <div className="flex items-center gap-2.5">
                      <FileText className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                      <div>
                        <div className="font-mono font-bold text-sm text-white group-hover:text-emerald-300">
                          {inv.invoiceNo}
                        </div>
                        <div className="text-xs text-slate-400">
                          {inv.itemCount} Line Items &bull; {inv.totalQty} Total Qty
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-5 max-w-md mx-auto text-xs text-slate-400 space-y-3">
              <p>No master invoice data loaded yet for today.</p>
              <button
                onClick={onOpenSyncModal}
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-lg text-xs transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                <span>Import Daily Excel / CSV File</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        /* 3. ACTIVE INVOICE SESSION DASHBOARD (Step B Active Scanning) */
        <div className="space-y-4">
          {/* Active Session Header Card */}
          <div className="bg-slate-900 border-2 border-emerald-500/40 rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-950/80 border border-emerald-600/50 rounded-xl text-emerald-400 shadow-inner">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
                      Active Audit Session
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      Started: {new Date(activeSession.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black font-mono text-white tracking-tight mt-0.5">
                    {activeSession.invoiceNo}
                  </h2>
                </div>
              </div>

              {/* Complete / Switch Invoice Button */}
              <button
                id="complete-switch-invoice-btn"
                onClick={() => completeAndSwitchInvoice()}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-bold px-4 py-2.5 rounded-lg text-xs sm:text-sm shadow-md transition-all border border-amber-500/50"
              >
                <Unlock className="w-4 h-4" />
                <span>Close & Evaluate Invoice</span>
              </button>
            </div>

            {/* Metrics & Progress Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-xs">
              <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
                <span className="text-slate-400 block text-[11px]">Total Line Items</span>
                <span className="text-lg font-bold font-mono text-white">{totalItemsRequired}</span>
              </div>
              <div className="bg-emerald-950/50 border border-emerald-800/50 p-2.5 rounded-lg">
                <span className="text-emerald-400 block text-[11px]">Exact Matches (Clean)</span>
                <span className="text-lg font-bold font-mono text-emerald-300">{exactCount}</span>
              </div>
              <div className="bg-amber-950/50 border border-amber-800/50 p-2.5 rounded-lg">
                <span className="text-amber-400 block text-[11px]">Pending / Shortages</span>
                <span className="text-lg font-bold font-mono text-amber-300">{shortageCount}</span>
              </div>
              <div className={`p-2.5 rounded-lg border ${
                mismatchCount > 0 || surplusCount > 0 
                  ? 'bg-red-950/60 border-red-800/60 text-red-300' 
                  : 'bg-slate-950/80 border-slate-800 text-slate-400'
              }`}>
                <span className="block text-[11px]">Mismatches / Surplus</span>
                <span className="text-lg font-bold font-mono">{mismatchCount + surplusCount}</span>
              </div>
            </div>

            {/* Audit Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-300">Invoice Audit Completion</span>
                <span className="text-emerald-400 font-mono">{progressPercent}% ({exactCount}/{totalItemsRequired} items exact)</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800">
                <div 
                  className={`h-full transition-all duration-300 ${
                    progressPercent === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-emerald-600 to-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, progressPercent)}%` }}
                />
              </div>
            </div>
          </div>

          {/* 4. SCANNED ITEMS AUDIT TABLE & REAL-TIME STATUS BADGES */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            {/* Filter Tabs */}
            <div className="px-4 py-2.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between gap-2 overflow-x-auto">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <button
                  onClick={() => setActiveTabFilter('ALL')}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    activeTabFilter === 'ALL' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All Items ({itemsList.length})
                </button>
                <button
                  onClick={() => setActiveTabFilter('PENDING')}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    activeTabFilter === 'PENDING' ? 'bg-amber-900/80 text-amber-200' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Pending ({shortageCount})
                </button>
                <button
                  onClick={() => setActiveTabFilter('EXACT')}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    activeTabFilter === 'EXACT' ? 'bg-emerald-900/80 text-emerald-200' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Exact ({exactCount})
                </button>
                {(mismatchCount > 0 || surplusCount > 0) && (
                  <button
                    onClick={() => setActiveTabFilter('DISCREPANCIES')}
                    className={`px-3 py-1 rounded-md transition-colors ${
                      activeTabFilter === 'DISCREPANCIES' ? 'bg-red-900/80 text-red-200' : 'text-red-400 hover:text-red-300'
                    }`}
                  >
                    Errors ({mismatchCount + surplusCount})
                  </button>
                )}
              </div>

              <span className="text-[11px] text-slate-400 hidden sm:inline">
                Automatic scan increments enabled
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-sans text-xs sm:text-sm">
                <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] border-b border-slate-800 uppercase tracking-wider">
                  <tr>
                    <th className="p-3 pl-4">Item Code & Name</th>
                    <th className="p-3 text-center">Unit</th>
                    <th className="p-3 text-center">Req</th>
                    <th className="p-3 text-center">Actual (Scan Count)</th>
                    <th className="p-3 text-center">Code Status</th>
                    <th className="p-3 text-center">Qty Status</th>
                    <th className="p-3 pr-4 text-right">Adjust Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-slate-200 font-mono">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-500 font-sans">
                        No items match the selected filter.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const isMatch = item.codeStatus === 'MATCH';
                      const isExact = item.qtyStatus === 'EXACT';
                      const isShortage = item.qtyStatus === 'SHORTAGE';
                      const isSurplus = item.qtyStatus === 'SURPLUS';
                      const isMismatch = item.codeStatus === 'MISMATCH';

                      return (
                        <tr 
                          key={item.itemCode}
                          className={`transition-colors ${
                            isMismatch 
                              ? 'bg-red-950/30 hover:bg-red-950/50' 
                              : isExact 
                                ? 'bg-emerald-950/20 hover:bg-emerald-950/40' 
                                : isSurplus 
                                  ? 'bg-amber-950/30 hover:bg-amber-950/50' 
                                  : 'hover:bg-slate-800/40'
                          }`}
                        >
                          {/* Item Code & Name */}
                          <td className="p-3 pl-4">
                            <div className="font-bold text-white flex items-center gap-1.5">
                              <ScanLine className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="font-mono text-emerald-300">{item.itemCode}</span>
                            </div>
                            <div className="text-xs text-slate-400 font-sans truncate max-w-xs sm:max-w-sm mt-0.5">
                              {item.itemName}
                            </div>
                          </td>

                          {/* Unit */}
                          <td className="p-3 text-center text-slate-300">
                            {item.unit}
                          </td>

                          {/* Required Qty */}
                          <td className="p-3 text-center font-bold text-slate-200">
                            {item.requiredQty}
                          </td>

                          {/* Actual Scanned Qty with Visual Indicator */}
                          <td className="p-3 text-center">
                            <span className={`inline-block px-3 py-1 rounded-md font-extrabold text-base ${
                              isExact 
                                ? 'bg-emerald-600 text-white shadow-sm' 
                                : isSurplus 
                                  ? 'bg-amber-600 text-white' 
                                  : item.actualQty > 0 
                                    ? 'bg-blue-600 text-white' 
                                    : 'bg-slate-800 text-slate-400'
                            }`}>
                              {item.actualQty}
                            </span>
                          </td>

                          {/* Code_Status Badge */}
                          <td className="p-3 text-center">
                            {isMatch ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                                <CheckCircle2 className="w-3 h-3" />
                                MATCH
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-950 text-red-400 border border-red-700 animate-pulse">
                                <AlertTriangle className="w-3 h-3" />
                                MISMATCH
                              </span>
                            )}
                          </td>

                          {/* Qty_Status Badge */}
                          <td className="p-3 text-center">
                            {isExact && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                                <CheckCircle2 className="w-3 h-3" />
                                EXACT
                              </span>
                            )}
                            {isShortage && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-950 text-amber-400 border border-amber-800">
                                SHORTAGE ({item.requiredQty - item.actualQty})
                              </span>
                            )}
                            {isSurplus && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-950 text-red-400 border border-red-800">
                                SURPLUS (+{item.actualQty - item.requiredQty})
                              </span>
                            )}
                          </td>

                          {/* Manual +/- Controls */}
                          <td className="p-3 pr-4 text-right">
                            <div className="inline-flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                              <button
                                onClick={() => adjustItemQuantity(item.itemCode, -1)}
                                disabled={item.actualQty === 0}
                                title="Decrease Qty"
                                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => adjustItemQuantity(item.itemCode, 1)}
                                title="Increase Qty"
                                className="p-1 rounded text-emerald-400 hover:text-emerald-300 hover:bg-slate-800"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              {item.actualQty > 0 && (
                                <button
                                  onClick={() => adjustItemQuantity(item.itemCode, -item.actualQty)}
                                  title="Reset Count to 0"
                                  className="p-1 rounded text-red-400 hover:text-red-300 hover:bg-slate-800"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
