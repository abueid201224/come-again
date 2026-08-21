import React, { useState, useEffect } from 'react';
import {
  Boxes,
  ClipboardList,
  Upload,
  Plus,
  Trash2,
  FileSpreadsheet,
  Download,
  Search,
  ScanLine,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Settings,
  RefreshCw,
  Edit3,
  Zap,
  Tag,
  Sparkles,
  ArrowRightLeft
} from 'lucide-react';
import type { AppSettings, InventoryCountItem, InventoryCountReport, PackagingGroupRule } from '../types';
import { 
  parseExcelOrCsvFile, 
  exportInventoryReportToExcel,
  exportAllInventoryReportsToExcel
} from '../services/excelService';
import { 
  getPackagingGroupRules, 
  matchBarcodeToPackagingRule,
  findPackagingRuleByGroupScan,
  getAllInventoryReports, 
  saveInventoryReport, 
  deleteInventoryReport 
} from '../services/db';
import { SoundEffects } from '../services/audio';
import { PackagingRulesModal } from './PackagingRulesModal';
import { FastCountPanel } from './FastCountPanel';
import { GroupBarcodeTagsModal } from './GroupBarcodeTagsModal';

interface InventoryCountScreenProps {
  settings: AppSettings;
  lastScannedCode?: string | null;
}

export const InventoryCountScreen: React.FC<InventoryCountScreenProps> = ({
  settings,
  lastScannedCode,
}) => {
  const isRtl = settings.language === 'ar';

  const [countTitle, setCountTitle] = useState(`جرد دوري - مستودع رئيسي (${new Date().toLocaleDateString()})`);
  const [sectionOrAisle, setSectionOrAisle] = useState('الممر A / قطاع المشروبات');
  const [items, setItems] = useState<InventoryCountItem[]>([]);
  const [packagingRules, setPackagingRules] = useState<PackagingGroupRule[]>([]);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isBarcodeTagsModalOpen, setIsBarcodeTagsModalOpen] = useState(false);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');
  const [savedReports, setSavedReports] = useState<InventoryCountReport[]>([]);
  const [activeTab, setActiveTab] = useState<'count' | 'history'>('count');
  
  // FAST COUNT MODE STATE (وضع الجرد السريع)
  const [isFastCountMode, setIsFastCountMode] = useState<boolean>(true);
  const [activeFastGroup, setActiveFastGroup] = useState<PackagingGroupRule | null>(null);

  // Load rules & history
  useEffect(() => {
    async function loadData() {
      const [rules, reports] = await Promise.all([
        getPackagingGroupRules(),
        getAllInventoryReports(),
      ]);
      setPackagingRules(rules);
      setSavedReports(reports);
      if (rules.length > 0 && !activeFastGroup) {
        setActiveFastGroup(rules[0]);
      }
    }
    loadData();
  }, []);

  // Hardware Scanner Integration for Inventory Count & Fast Group Switching
  useEffect(() => {
    if (!lastScannedCode) return;
    const clean = lastScannedCode.trim();
    if (!clean) return;

    // 1. Check if the scanned code is a GROUP BARCODE (e.g. GRP-rule-id, rule ID, start/end barcode)
    const matchedGroup = findPackagingRuleByGroupScan(clean, packagingRules);
    if (matchedGroup && (clean.toLowerCase().startsWith('grp-') || clean.toLowerCase().startsWith('group-') || clean === matchedGroup.id || clean === matchedGroup.startBarcode || clean === matchedGroup.endBarcode)) {
      setActiveFastGroup(matchedGroup);
      setIsFastCountMode(true);
      if (settings.soundEnabled) SoundEffects.playInvoiceLock(settings.soundVolume);
      return;
    }

    // 2. Otherwise process item scan
    setItems(prev => {
      const idx = prev.findIndex(i => i.itemCode.toLowerCase() === clean.toLowerCase());
      if (idx !== -1) {
        const updated = [...prev];
        const cur = updated[idx];
        const nextPieces = cur.piecesCount + 1;
        const calcTotal = (cur.cartonsCount * cur.cartonFactor) + (cur.packsCount * cur.packFactor) + nextPieces;
        updated[idx] = {
          ...cur,
          piecesCount: nextPieces,
          calculatedActualQty: calcTotal,
          varianceQty: calcTotal - cur.bookQty,
          status: calcTotal === cur.bookQty ? 'EXACT' : calcTotal < cur.bookQty ? 'SHORTAGE' : 'SURPLUS',
          lastScannedAt: new Date().toISOString()
        };
        if (settings.soundEnabled) SoundEffects.playScanMatch(settings.soundVolume);
        return updated;
      } else {
        // Auto match barcode with packaging rules or active fast group
        const matchedRule = matchBarcodeToPackagingRule(clean, packagingRules) || activeFastGroup;
        const cartonFactor = matchedRule ? matchedRule.cartonFactor : 24;
        const packFactor = matchedRule ? matchedRule.packFactor : 6;
        const groupName = matchedRule ? matchedRule.name : 'مجموعة عامة';

        const newItem: InventoryCountItem = {
          id: `inv-${Date.now()}`,
          itemCode: clean,
          itemName: `صنف ممسوح ${clean}`,
          unit: matchedRule ? matchedRule.unitName : 'حبة',
          groupId: matchedRule?.id,
          groupName,
          bookQty: 0,
          cartonsCount: 0,
          cartonFactor,
          packsCount: 0,
          packFactor,
          piecesCount: 1,
          calculatedActualQty: 1,
          varianceQty: 1,
          status: 'SURPLUS',
          lastScannedAt: new Date().toISOString(),
        };

        // If matched rule is different from activeFastGroup, switch activeFastGroup
        if (matchedRule && (!activeFastGroup || activeFastGroup.id !== matchedRule.id)) {
          setActiveFastGroup(matchedRule);
        }

        if (settings.soundEnabled) SoundEffects.playInvoiceLock(settings.soundVolume);
        return [newItem, ...prev];
      }
    });
  }, [lastScannedCode, packagingRules, activeFastGroup, settings.soundEnabled, settings.soundVolume]);

  // Handle Excel Book Balance Import
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const parsed = await parseExcelOrCsvFile(file);
      if (parsed.items.length > 0) {
        const mappedItems: InventoryCountItem[] = parsed.items.map((item, idx) => {
          // Auto-match packaging group rule by barcode range
          const matchedRule = matchBarcodeToPackagingRule(item.itemCode, packagingRules);
          const cartonFactor = matchedRule ? matchedRule.cartonFactor : 24;
          const packFactor = matchedRule ? matchedRule.packFactor : 6;
          const groupName = matchedRule ? matchedRule.name : 'عبوات قياسية';

          const bookQty = item.requiredQty;
          return {
            id: `inv-item-${idx}-${Date.now()}`,
            itemCode: item.itemCode,
            itemName: item.itemName,
            unit: matchedRule ? matchedRule.unitName : item.unit || 'حبة',
            groupId: matchedRule?.id,
            groupName,
            bookQty,
            cartonsCount: 0,
            cartonFactor,
            packsCount: 0,
            packFactor,
            piecesCount: 0,
            calculatedActualQty: 0,
            varianceQty: -bookQty,
            status: 'SHORTAGE',
          };
        });

        setItems(mappedItems);
        if (settings.soundEnabled) SoundEffects.playInvoiceLock(settings.soundVolume);
      }
    } catch (err) {
      alert(`خطأ في قراءة ملف الإكسيل: ${(err as Error).message}`);
    } finally {
      e.target.value = '';
    }
  };

  // Update item counts directly and auto-calculate actual total
  const handleUpdateCount = (id: string, updates: Partial<InventoryCountItem>) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        const merged = { ...item, ...updates };
        const total = (merged.cartonsCount * merged.cartonFactor) + 
                      (merged.packsCount * merged.packFactor) + 
                      merged.piecesCount;
        merged.calculatedActualQty = total;
        merged.varianceQty = total - merged.bookQty;
        merged.status = total === merged.bookQty ? 'EXACT' : total < merged.bookQty ? 'SHORTAGE' : 'SURPLUS';
        return merged;
      }
      return item;
    }));
  };

  // Add Item to Active Group
  const handleAddItemToGroup = (cleanBarcode: string, itemName?: string) => {
    const matchedRule = matchBarcodeToPackagingRule(cleanBarcode, packagingRules) || activeFastGroup;
    const cartonFactor = matchedRule ? matchedRule.cartonFactor : 24;
    const packFactor = matchedRule ? matchedRule.packFactor : 6;
    const groupName = matchedRule ? matchedRule.name : 'عبوات عامة';

    const newItem: InventoryCountItem = {
      id: `manual-inv-${Date.now()}`,
      itemCode: cleanBarcode,
      itemName: itemName || `صنف ${cleanBarcode}`,
      unit: matchedRule ? matchedRule.unitName : 'حبة',
      groupId: matchedRule?.id,
      groupName,
      bookQty: 0,
      cartonsCount: 0,
      cartonFactor,
      packsCount: 0,
      packFactor,
      piecesCount: 1,
      calculatedActualQty: 1,
      varianceQty: 1,
      status: 'SURPLUS',
    };

    setItems(prev => [newItem, ...prev]);
  };

  // Add Manual Item from standard input
  const handleAddManualItem = () => {
    if (!manualBarcode.trim()) return;
    const clean = manualBarcode.trim();
    handleAddItemToGroup(clean);
    setManualBarcode('');
  };

  // Save current Inventory Count Report
  const handleSaveReport = async () => {
    if (items.length === 0) {
      alert('لا توجد أصناف في بيان الجرد لحفظها.');
      return;
    }

    const totalBook = items.reduce((acc, i) => acc + i.bookQty, 0);
    const totalActual = items.reduce((acc, i) => acc + i.calculatedActualQty, 0);
    const totalVar = totalActual - totalBook;

    const report: InventoryCountReport = {
      id: `rep-inv-${Date.now()}`,
      title: countTitle,
      sectionOrAisle,
      createdAt: new Date().toISOString(),
      auditorName: settings.auditorName || 'أحمد حمادة',
      auditorId: settings.auditorId || 'AUD-101',
      auditorSignature: settings.auditorSignature,
      items,
      totalBookQty: totalBook,
      totalActualQty: totalActual,
      totalVarianceQty: totalVar,
    };

    await saveInventoryReport(report);
    const updatedReports = await getAllInventoryReports();
    setSavedReports(updatedReports);
    alert('تم اعتماد وحفظ تقرير الجرد الدوري وتجميع العبوات بنجاح.');
  };

  // Totals calculations
  const totalBookQty = items.reduce((acc, i) => acc + i.bookQty, 0);
  const totalActualQty = items.reduce((acc, i) => acc + i.calculatedActualQty, 0);
  const totalVarianceQty = totalActualQty - totalBookQty;
  const exactItemsCount = items.filter(i => i.status === 'EXACT').length;
  const shortageItemsCount = items.filter(i => i.status === 'SHORTAGE').length;
  const surplusItemsCount = items.filter(i => i.status === 'SURPLUS').length;

  // Filtered items list for standard mode
  const filteredItems = items.filter(item => {
    const matchSearch = !searchQuery || 
      item.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) || 
      item.itemName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchGroup = selectedGroupFilter === 'ALL' || item.groupName === selectedGroupFilter;
    return matchSearch && matchGroup;
  });

  const uniqueGroups = Array.from(new Set(items.map(i => i.groupName).filter(Boolean)));

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white">
                  {isRtl ? 'الجرد الدوري وتجميع العبوات (Cycle Count & Packaging Breakdown)' : 'Cycle Count & Packaging Breakdown'}
                </h1>
                <span className="text-[11px] bg-indigo-950 text-indigo-300 px-2.5 py-0.5 rounded-full border border-indigo-700 font-mono font-bold">
                  {items.length} صنف
                </span>
                {isFastCountMode && (
                  <span className="text-[10px] bg-amber-500 text-black px-2 py-0.5 rounded-full font-black flex items-center gap-1 shadow-sm">
                    <Zap className="w-3 h-3 fill-black" />
                    <span>الجرد السريع مفعل</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {isRtl 
                  ? 'تطبيق شروط ضم المنتجات في مجموعات متشابهة من حيث العبوة واحتساب الإجمالي الفعلي (كراتين + باكتات + حبات) تلقائياً' 
                  : 'Automated package multiplier (Cartons + Packs + Loose Pieces) & Barcode range groupings'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* FAST COUNT MODE TOGGLE BUTTON */}
            <button
              onClick={() => setIsFastCountMode(!isFastCountMode)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-black shadow-md transition-all border ${
                isFastCountMode
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-black border-amber-400 ring-2 ring-amber-500/40'
                  : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/40'
              }`}
              title="تفعيل أو إيقاف وضع الجرد السريع بالمجموعات العبوية"
            >
              <Zap className={`w-4 h-4 ${isFastCountMode ? 'fill-black' : 'text-amber-400'}`} />
              <span>{isFastCountMode ? 'وضع الجرد السريع (مفعل)' : 'تفعيل وضع الجرد السريع'}</span>
            </button>

            <button
              onClick={() => setIsBarcodeTagsModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-xs font-bold text-indigo-300 border border-indigo-500/40"
              title="عرض وطباعة بطاقات باركود المجموعات لتثبيتها على أرفف المستودع"
            >
              <Tag className="w-4 h-4 text-indigo-400" />
              <span>بطاقات الرفوف</span>
            </button>

            <button
              onClick={() => exportAllInventoryReportsToExcel(savedReports)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 text-xs font-bold text-white border border-emerald-500/50 shadow-sm"
              title="تصدير كافة تقارير الجرد الدوري وتجميع العبوات المحفوظة إلى إكسيل"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
              <span>{isRtl ? 'تصدير كافة تقارير الجرد (Excel)' : 'Export All Inventory Reports'}</span>
            </button>

            <button
              onClick={() => setActiveTab(activeTab === 'count' ? 'history' : 'count')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700"
            >
              <ClipboardList className="w-4 h-4 text-indigo-400" />
              <span>{activeTab === 'count' ? `السجلات السابقة (${savedReports.length})` : 'العودة لجلسة الجرد'}</span>
            </button>

            {activeTab === 'count' && (
              <>
                <button
                  onClick={() => setIsRulesModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 border border-slate-700"
                >
                  <Settings className="w-4 h-4" />
                  <span>{isRtl ? 'قائمة شروط ضم المجموعات' : 'Packaging Rules'}</span>
                </button>

                <button
                  onClick={handleSaveReport}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-sm transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isRtl ? 'اعتماد وحفظ الجرد' : 'Approve & Save'}</span>
                </button>

                <button
                  onClick={() => exportInventoryReportToExcel({
                    title: countTitle, sectionOrAisle, items,
                    totalBookQty, totalActualQty, totalVarianceQty,
                    auditorName: settings.auditorName, auditorId: settings.auditorId, createdAt: new Date().toISOString()
                  })}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-emerald-400 border border-slate-700"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>تصدير الجلسة الحالية</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {activeTab === 'history' ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-white">سجل جلسات الجرد الدوري السابقة ({savedReports.length})</h2>
              <p className="text-xs text-slate-400">كافة تقارير الجرد الدوري وتجميع العبوات المحسوبة بالباركود</p>
            </div>
            {savedReports.length > 0 && (
              <button
                onClick={() => exportAllInventoryReportsToExcel(savedReports)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-sm transition-all"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>تصدير كافة تقارير الجرد (Excel)</span>
              </button>
            )}
          </div>

          {savedReports.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm">
              لا توجد تقارير جرد دوري محفوظة بعد.
            </div>
          ) : (
            <div className="space-y-3">
              {savedReports.map(rep => (
                <div key={rep.id} className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm">{rep.title}</span>
                      <span className="text-xs text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800">{rep.sectionOrAisle}</span>
                    </div>
                    <div className="text-xs text-slate-400 flex items-center gap-3">
                      <span>الأصناف: {rep.items?.length || 0}</span>
                      <span>الدفترى: {rep.totalBookQty}</span>
                      <span className="text-indigo-300 font-bold">الفعلي: {rep.totalActualQty}</span>
                      <span className={rep.totalVarianceQty === 0 ? 'text-emerald-400' : rep.totalVarianceQty > 0 ? 'text-purple-400' : 'text-amber-400'}>
                        الفارق: {rep.totalVarianceQty > 0 ? `+${rep.totalVarianceQty}` : rep.totalVarianceQty}
                      </span>
                      <span>{new Date(rep.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => exportInventoryReportToExcel(rep)}
                      className="p-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg text-xs"
                      title="تصدير تقرير الجرد هذا إلى إكسيل"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm(`حذف تقرير الجرد "${rep.title}"؟`)) {
                          await deleteInventoryReport(rep.id);
                          const updated = await getAllInventoryReports();
                          setSavedReports(updated);
                        }
                      }}
                      className="p-2 bg-slate-800 hover:bg-red-950 text-red-400 rounded-lg text-xs"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Session Controls & Excel Import */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  {isRtl ? 'عنوان جلسة الجرد' : 'Count Session Title'}
                </label>
                <input
                  type="text"
                  value={countTitle}
                  onChange={(e) => setCountTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  {isRtl ? 'الممر / القطاع / المستودع' : 'Aisle / Sector / Warehouse'}
                </label>
                <input
                  type="text"
                  value={sectionOrAisle}
                  onChange={(e) => setSectionOrAisle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-end">
                <label className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold cursor-pointer transition-all shadow-sm">
                  <Upload className="w-4 h-4" />
                  <span>{isRtl ? 'استيراد أرصدة إكسيل الدفترية' : 'Import Book Stock Excel'}</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleImportExcel}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
              <div className="text-[11px] text-slate-400 font-semibold">{isRtl ? 'إجمالي الرصيد الدفتري' : 'Total Book Qty'}</div>
              <div className="text-lg font-black text-white mt-1">{totalBookQty} <span className="text-xs font-normal text-slate-400">حبة</span></div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
              <div className="text-[11px] text-indigo-400 font-semibold">{isRtl ? 'الإجمالي الفعلي المحتسب' : 'Calculated Actual Qty'}</div>
              <div className="text-lg font-black text-indigo-300 mt-1">{totalActualQty} <span className="text-xs font-normal text-slate-400">حبة</span></div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
              <div className="text-[11px] text-amber-400 font-semibold">{isRtl ? 'الفارق الإجمالي' : 'Total Variance'}</div>
              <div className={`text-lg font-black mt-1 ${totalVarianceQty === 0 ? 'text-emerald-400' : totalVarianceQty > 0 ? 'text-purple-400' : 'text-amber-400'}`}>
                {totalVarianceQty > 0 ? `+${totalVarianceQty}` : totalVarianceQty} <span className="text-xs font-normal text-slate-400">حبة</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
              <div className="text-[11px] text-emerald-400 font-semibold">{isRtl ? 'حالة المطابقة' : 'Audit Match'}</div>
              <div className="text-xs text-slate-300 mt-1.5 flex items-center gap-2">
                <span className="text-emerald-400 font-bold">{exactItemsCount} مطابق</span>
                <span className="text-amber-400 font-bold">{shortageItemsCount} عجز</span>
                <span className="text-purple-400 font-bold">{surplusItemsCount} زيادة</span>
              </div>
            </div>
          </div>

          {/* RENDER FAST COUNT PANEL IF ACTIVE */}
          {isFastCountMode ? (
            <FastCountPanel
              activeGroup={activeFastGroup}
              groups={packagingRules}
              onSelectGroup={(grp) => setActiveFastGroup(grp)}
              items={items}
              onUpdateCount={handleUpdateCount}
              onDeleteItem={(id) => setItems(prev => prev.filter(i => i.id !== id))}
              onAddItemToGroup={handleAddItemToGroup}
              onOpenBarcodeTags={() => setIsBarcodeTagsModalOpen(true)}
              onOpenRulesModal={() => setIsRulesModalOpen(true)}
              isRtl={isRtl}
              settings={settings}
            />
          ) : (
            <>
              {/* Barcode Quick Scan Bar for Standard Mode */}
              <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl flex items-center gap-2">
                <div className="relative flex-1">
                  <ScanLine className="w-4 h-4 text-indigo-400 absolute left-3 top-2.5 rtl:left-auto rtl:right-3" />
                  <input
                    type="text"
                    value={manualBarcode}
                    onChange={(e) => setManualBarcode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddManualItem()}
                    placeholder={isRtl ? 'امسح باركود أي صنف في الرف لزيادة الحبات وتطبيق معامل العبوة تلقائياً...' : 'Scan item barcode to count...'}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 rtl:pl-3 rtl:pr-9 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  onClick={handleAddManualItem}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isRtl ? 'إضافة صنف' : 'Add Item'}</span>
                </button>
              </div>

              {/* Standard Table with Packaging Breakdown Columns */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
                <div className="p-3 bg-slate-950/80 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={isRtl ? 'بحث بكود أو اسم الصنف...' : 'Search items...'}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />

                    {uniqueGroups.length > 0 && (
                      <select
                        value={selectedGroupFilter}
                        onChange={(e) => setSelectedGroupFilter(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none"
                      >
                        <option value="ALL">كافة المجموعات العبوية</option>
                        {uniqueGroups.map(g => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="text-xs text-slate-400">
                    عرض {filteredItems.length} من أصل {items.length} صنف جرد
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-slate-300 text-right">
                    <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                      <tr>
                        <th className="p-2.5">الباركود والصنف</th>
                        <th className="p-2.5">المجموعة العبوية</th>
                        <th className="p-2.5 text-center">الرصيد الدفتري</th>
                        <th className="p-2.5 text-center bg-indigo-950/30 text-indigo-300">الكراتين × المعامل</th>
                        <th className="p-2.5 text-center bg-indigo-950/30 text-indigo-300">الباكتات × المعامل</th>
                        <th className="p-2.5 text-center bg-indigo-950/30 text-indigo-300">حبات فردية</th>
                        <th className="p-2.5 text-center font-bold text-white bg-slate-900">الفعلي المحتسب</th>
                        <th className="p-2.5 text-center">الفارق</th>
                        <th className="p-2.5 text-center">الحالة</th>
                        <th className="p-2.5 text-center w-10">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredItems.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="p-8 text-center text-slate-500">
                            لا توجد أصناف في جدول الجرد. ارفع ملف إكسيل الأرصدة أو امسح الباركود للبدء.
                          </td>
                        </tr>
                      ) : (
                        filteredItems.map(item => (
                          <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="p-2.5">
                              <div className="font-bold text-white font-mono">{item.itemCode}</div>
                              <div className="text-[11px] text-slate-400">{item.itemName}</div>
                            </td>
                            <td className="p-2.5">
                              <span className="bg-slate-950 text-indigo-300 px-2 py-0.5 rounded text-[11px] border border-slate-800 font-semibold">
                                {item.groupName || 'عبوات قياسية'}
                              </span>
                            </td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-200">
                              {item.bookQty} {item.unit}
                            </td>
                            {/* Cartons column */}
                            <td className="p-2.5 text-center bg-indigo-950/20">
                              <div className="flex items-center justify-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  value={item.cartonsCount}
                                  onChange={(e) => handleUpdateCount(item.id, { cartonsCount: Number(e.target.value) || 0 })}
                                  className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-center font-mono font-bold text-amber-300"
                                />
                                <span className="text-[10px] text-slate-400">×{item.cartonFactor}</span>
                              </div>
                            </td>
                            {/* Packs column */}
                            <td className="p-2.5 text-center bg-indigo-950/20">
                              <div className="flex items-center justify-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  value={item.packsCount}
                                  onChange={(e) => handleUpdateCount(item.id, { packsCount: Number(e.target.value) || 0 })}
                                  className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-center font-mono font-bold text-indigo-300"
                                />
                                <span className="text-[10px] text-slate-400">×{item.packFactor}</span>
                              </div>
                            </td>
                            {/* Loose Pieces column */}
                            <td className="p-2.5 text-center bg-indigo-950/20">
                              <input
                                type="number"
                                min="0"
                                value={item.piecesCount}
                                onChange={(e) => handleUpdateCount(item.id, { piecesCount: Number(e.target.value) || 0 })}
                                className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-center font-mono font-bold text-emerald-300"
                              />
                            </td>
                            {/* Calculated Actual Total */}
                            <td className="p-2.5 text-center font-mono font-black text-sm text-white bg-slate-900">
                              {item.calculatedActualQty} {item.unit}
                            </td>
                            {/* Variance */}
                            <td className="p-2.5 text-center font-mono font-bold">
                              <span className={item.varianceQty === 0 ? 'text-emerald-400' : item.varianceQty > 0 ? 'text-purple-400' : 'text-amber-400'}>
                                {item.varianceQty > 0 ? `+${item.varianceQty}` : item.varianceQty}
                              </span>
                            </td>
                            {/* Status */}
                            <td className="p-2.5 text-center">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                item.status === 'EXACT'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : item.status === 'SHORTAGE'
                                  ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                  : 'bg-purple-950 text-purple-300 border border-purple-800'
                              }`}>
                                {item.status === 'EXACT' ? 'مطابق' : item.status === 'SHORTAGE' ? 'عجز' : 'زيادة'}
                              </span>
                            </td>
                            <td className="p-2.5 text-center">
                              <button
                                onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                                className="p-1 text-slate-500 hover:text-red-400"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Packaging Rules Modal */}
      <PackagingRulesModal
        isOpen={isRulesModalOpen}
        onClose={() => setIsRulesModalOpen(false)}
        rules={packagingRules}
        onUpdateRules={(newRules) => {
          setPackagingRules(newRules);
          if (newRules.length > 0 && !activeFastGroup) {
            setActiveFastGroup(newRules[0]);
          }
        }}
        language={settings.language}
      />

      {/* Shelf Barcode Tags Modal */}
      <GroupBarcodeTagsModal
        isOpen={isBarcodeTagsModalOpen}
        onClose={() => setIsBarcodeTagsModalOpen(false)}
        rules={packagingRules}
        onSelectGroup={(grp) => {
          setActiveFastGroup(grp);
          setIsFastCountMode(true);
        }}
        language={settings.language}
      />
    </div>
  );
};
