import React, { useState, useEffect } from 'react';
import {
  ListFilter,
  FileSpreadsheet,
  Upload,
  Download,
  Users,
  Award,
  Sparkles,
  Layers,
  CheckCircle2,
  Clock,
  Printer,
  Boxes,
  Plus,
  Trash2,
  Edit3,
  Search,
  ScanLine,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  FileText,
  UserCheck,
  RefreshCw,
  Sliders,
  Eye,
  Info
} from 'lucide-react';
import type { 
  AppSettings, 
  BatchPickingWave, 
  PickingProductGroup, 
  WarehouseWorker, 
  PackagingGroupRule,
  WorkerExperienceLevel,
  GroupDifficultyLevel,
  AggregatedPickingItem
} from '../types';
import { 
  parseMultiInvoicePickingExcel, 
  downloadPickingExcelTemplate, 
  exportPickingWaveToExcel,
  exportAllPickingWavesToExcel,
  exportWorkerPickingSheetPdf 
} from '../services/excelService';
import { 
  getWarehouseWorkers, 
  saveWarehouseWorkers, 
  addWarehouseWorker, 
  updateWarehouseWorker, 
  deleteWarehouseWorker,
  getAllPickingWaves, 
  savePickingWave, 
  deletePickingWave,
  getPackagingGroupRules
} from '../services/db';
import { SoundEffects } from '../services/audio';
import { PackagingRulesModal } from './PackagingRulesModal';

interface PickingWaveScreenProps {
  settings: AppSettings;
  lastScannedCode?: string | null;
}

export const PickingWaveScreen: React.FC<PickingWaveScreenProps> = ({
  settings,
  lastScannedCode,
}) => {
  const isRtl = settings.language === 'ar';

  // Navigation sub-tabs
  const [activeSubTab, setActiveSubTab] = useState<'wave' | 'workers' | 'history'>('wave');

  // Active Wave State
  const [activeWave, setActiveWave] = useState<BatchPickingWave | null>(null);
  const [workers, setWorkers] = useState<WarehouseWorker[]>([]);
  const [packagingRules, setPackagingRules] = useState<PackagingGroupRule[]>([]);
  const [savedWaves, setSavedWaves] = useState<BatchPickingWave[]>([]);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('ALL');
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [selectedItemForDetails, setSelectedItemForDetails] = useState<AggregatedPickingItem | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ message: string; type: 'SUCCESS' | 'INFO' | 'WARNING' } | null>(null);

  // New Worker Form State
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerCode, setNewWorkerCode] = useState('');
  const [newWorkerLevel, setNewWorkerLevel] = useState<WorkerExperienceLevel>('INTERMEDIATE');
  const [newWorkerSpecialty, setNewWorkerSpecialty] = useState('');
  const [newWorkerPhone, setNewWorkerPhone] = useState('');
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    const [workersList, rulesList, wavesList] = await Promise.all([
      getWarehouseWorkers(),
      getPackagingGroupRules(),
      getAllPickingWaves(),
    ]);
    setWorkers(workersList);
    setPackagingRules(rulesList);
    setSavedWaves(wavesList);

    // If there is a saved wave, set the most recent one as active
    if (wavesList.length > 0 && !activeWave) {
      setActiveWave(wavesList[0]);
    }
  };

  // Hardware Scanner Integration for Active Picking Wave
  useEffect(() => {
    if (!lastScannedCode || !activeWave || activeSubTab !== 'wave') return;
    const clean = lastScannedCode.trim().toLowerCase();
    if (!clean) return;

    let itemFound = false;
    const updatedGroups = activeWave.groups.map(group => {
      const updatedItems = group.items.map(item => {
        if (item.itemCode.toLowerCase() === clean) {
          itemFound = true;
          const nextPicked = Math.min(item.totalRequiredQty, item.pickedQty + 1);
          return {
            ...item,
            pickedQty: nextPicked,
            status: (nextPicked >= item.totalRequiredQty ? 'COMPLETED' : 'IN_PROGRESS') as 'COMPLETED' | 'IN_PROGRESS'
          };
        }
        return item;
      });

      const allCompleted = updatedItems.every(i => i.status === 'COMPLETED');
      const anyInProgress = updatedItems.some(i => i.pickedQty > 0);

      return {
        ...group,
        items: updatedItems,
        status: (allCompleted ? 'COMPLETED' : anyInProgress ? 'IN_PROGRESS' : 'PENDING') as 'COMPLETED' | 'IN_PROGRESS' | 'PENDING'
      };
    });

    if (itemFound) {
      const updatedWave: BatchPickingWave = {
        ...activeWave,
        groups: updatedGroups,
        status: updatedGroups.every(g => g.status === 'COMPLETED') ? 'COMPLETED' : 'IN_PROGRESS'
      };
      setActiveWave(updatedWave);
      savePickingWave(updatedWave);
      if (settings.soundEnabled) SoundEffects.playScanMatch(settings.soundVolume);
      showNotice(
        isRtl ? `✅ تم تسجيل التقاط قطعة للصنف (${clean})` : `✅ Picked 1 piece of item (${clean})`,
        'SUCCESS'
      );
    } else {
      if (settings.soundEnabled) SoundEffects.playMismatchWarning(settings.soundVolume);
      showNotice(
        isRtl ? `⚠️ الباركود الممسوح (${clean}) غير مدرج في موجة الانتقاء الحالية` : `⚠️ Barcode (${clean}) not in current wave`,
        'WARNING'
      );
    }
  }, [lastScannedCode]);

  const showNotice = (message: string, type: 'SUCCESS' | 'INFO' | 'WARNING' = 'INFO') => {
    setActionNotice({ message, type });
    setTimeout(() => setActionNotice(null), 4000);
  };

  // Handle Multi-Invoice Excel Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const result = await parseMultiInvoicePickingExcel(file, packagingRules);
      
      const newWave: BatchPickingWave = {
        id: `wave-${Date.now()}`,
        waveNo: `WAVE-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        title: result.waveTitle,
        createdAt: new Date().toISOString(),
        createdBy: settings.auditorName || 'مشرف التجهيز',
        totalInvoicesCount: result.totalInvoicesCount,
        invoiceNumbers: result.invoiceNumbers,
        totalItemsCount: result.totalItemsCount,
        totalQuantity: result.totalQuantity,
        totalCartons: result.totalCartons,
        totalPacks: result.totalPacks,
        totalPieces: result.totalPieces,
        groups: result.groups,
        status: 'DRAFT',
      };

      // Perform initial smart auto-assignment to available workers
      const assignedWave = performSmartWorkerAssignment(newWave, workers);
      setActiveWave(assignedWave);
      await savePickingWave(assignedWave);
      const updatedList = await getAllPickingWaves();
      setSavedWaves(updatedList);

      if (settings.soundEnabled) SoundEffects.playInvoiceLock(settings.soundVolume);
      showNotice(
        isRtl 
          ? `🎉 تم تكوين قائمة الانتقاء وتجميع ${result.totalQuantity} قطعة من ${result.totalInvoicesCount} فواتير وتفصيلها إلى ${result.groups.length} مجموعات!`
          : `🎉 Successfully created wave with ${result.totalQuantity} items across ${result.totalInvoicesCount} invoices!`,
        'SUCCESS'
      );
    } catch (err: any) {
      console.error('Error parsing picking Excel:', err);
      showNotice(err.message || 'حدث خطأ أثناء قراءة ملف الإكسيل', 'WARNING');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Smart Auto-Assign Algorithm matching Group Difficulty to Worker Experience Level
  const performSmartWorkerAssignment = (wave: BatchPickingWave, currentWorkers: WarehouseWorker[]): BatchPickingWave => {
    const activeWorkers = currentWorkers.filter(w => w.isActive);
    if (activeWorkers.length === 0) return wave;

    const experts = activeWorkers.filter(w => w.experienceLevel === 'EXPERT');
    const intermediates = activeWorkers.filter(w => w.experienceLevel === 'INTERMEDIATE');
    const novices = activeWorkers.filter(w => w.experienceLevel === 'NOVICE');

    let expIdx = 0;
    let intIdx = 0;
    let novIdx = 0;

    const assignedGroups = wave.groups.map(group => {
      let chosenWorker: WarehouseWorker | null = null;

      if (group.difficulty === 'HIGH_EXPERT') {
        // Prefer Expert, fallback to Intermediate, then Novice
        if (experts.length > 0) {
          chosenWorker = experts[expIdx % experts.length];
          expIdx++;
        } else if (intermediates.length > 0) {
          chosenWorker = intermediates[intIdx % intermediates.length];
          intIdx++;
        } else {
          chosenWorker = activeWorkers[0];
        }
      } else if (group.difficulty === 'MEDIUM_INTERMEDIATE') {
        // Prefer Intermediate, fallback to Expert, then Novice
        if (intermediates.length > 0) {
          chosenWorker = intermediates[intIdx % intermediates.length];
          intIdx++;
        } else if (experts.length > 0) {
          chosenWorker = experts[expIdx % experts.length];
          expIdx++;
        } else if (novices.length > 0) {
          chosenWorker = novices[novIdx % novices.length];
          novIdx++;
        } else {
          chosenWorker = activeWorkers[0];
        }
      } else {
        // LOW_NOVICE: Prefer Novice, fallback to Intermediate
        if (novices.length > 0) {
          chosenWorker = novices[novIdx % novices.length];
          novIdx++;
        } else if (intermediates.length > 0) {
          chosenWorker = intermediates[intIdx % intermediates.length];
          intIdx++;
        } else {
          chosenWorker = activeWorkers[0];
        }
      }

      return {
        ...group,
        assignedWorkerId: chosenWorker?.id,
        assignedWorkerName: chosenWorker?.name,
        assignedWorkerLevel: chosenWorker?.experienceLevel,
      };
    });

    return {
      ...wave,
      groups: assignedGroups,
      status: 'ASSIGNED',
    };
  };

  const handleApplyAutoAssign = async () => {
    if (!activeWave) return;
    const updated = performSmartWorkerAssignment(activeWave, workers);
    setActiveWave(updated);
    await savePickingWave(updated);
    showNotice(isRtl ? '✅ تم إعادة الإسناد الذكي للعمال بنجاح وفق مستويات الخبرة والصعوبة' : '✅ Smart Worker Assignment Applied', 'SUCCESS');
  };

  // Manual worker change for a specific group
  const handleAssignWorkerToGroup = async (groupId: string, workerId: string) => {
    if (!activeWave) return;
    const worker = workers.find(w => w.id === workerId);
    const updatedGroups = activeWave.groups.map(g => {
      if (g.groupId === groupId) {
        return {
          ...g,
          assignedWorkerId: worker?.id,
          assignedWorkerName: worker?.name,
          assignedWorkerLevel: worker?.experienceLevel,
        };
      }
      return g;
    });

    const updatedWave: BatchPickingWave = {
      ...activeWave,
      groups: updatedGroups,
      status: 'ASSIGNED',
    };
    setActiveWave(updatedWave);
    await savePickingWave(updatedWave);
  };

  // Manual difficulty change for a specific group
  const handleDifficultyChange = async (groupId: string, difficulty: GroupDifficultyLevel) => {
    if (!activeWave) return;
    const updatedGroups = activeWave.groups.map(g => {
      if (g.groupId === groupId) {
        return { ...g, difficulty };
      }
      return g;
    });

    const updatedWave: BatchPickingWave = {
      ...activeWave,
      groups: updatedGroups,
    };
    setActiveWave(updatedWave);
    await savePickingWave(updatedWave);
  };

  // Mark an item as picked or toggle status
  const handleToggleItemPicked = async (groupId: string, itemId: string) => {
    if (!activeWave) return;
    const updatedGroups = activeWave.groups.map(g => {
      if (g.groupId === groupId) {
        const updatedItems = g.items.map(it => {
          if (it.id === itemId) {
            const isCompleted = it.status === 'COMPLETED';
            return {
              ...it,
              pickedQty: isCompleted ? 0 : it.totalRequiredQty,
              status: (isCompleted ? 'PENDING' : 'COMPLETED') as 'PENDING' | 'COMPLETED'
            };
          }
          return it;
        });
        const allDone = updatedItems.every(i => i.status === 'COMPLETED');
        return {
          ...g,
          items: updatedItems,
          status: (allDone ? 'COMPLETED' : 'IN_PROGRESS') as 'COMPLETED' | 'IN_PROGRESS'
        };
      }
      return g;
    });

    const updatedWave: BatchPickingWave = {
      ...activeWave,
      groups: updatedGroups,
    };
    setActiveWave(updatedWave);
    await savePickingWave(updatedWave);
    if (settings.soundEnabled) SoundEffects.playScanMatch(settings.soundVolume);
  };

  // Add or Edit Worker
  const handleSaveWorker = async () => {
    if (!newWorkerName.trim()) {
      showNotice(isRtl ? 'يرجى إدخال اسم العامل' : 'Please enter worker name', 'WARNING');
      return;
    }

    const code = newWorkerCode.trim() || `EMP-${Date.now().toString().slice(-4)}`;

    if (editingWorkerId) {
      const existing = workers.find(w => w.id === editingWorkerId);
      if (existing) {
        const updated: WarehouseWorker = {
          ...existing,
          name: newWorkerName.trim(),
          code,
          experienceLevel: newWorkerLevel,
          specialty: newWorkerSpecialty.trim(),
          phone: newWorkerPhone.trim(),
        };
        await updateWarehouseWorker(updated);
        showNotice(isRtl ? '✅ تم تحديث بيانات العامل' : 'Worker Updated', 'SUCCESS');
      }
    } else {
      const newWorker: WarehouseWorker = {
        id: `worker-${Date.now()}`,
        name: newWorkerName.trim(),
        code,
        experienceLevel: newWorkerLevel,
        isActive: true,
        specialty: newWorkerSpecialty.trim(),
        phone: newWorkerPhone.trim(),
        createdAt: new Date().toISOString(),
      };
      await addWarehouseWorker(newWorker);
      showNotice(isRtl ? '✅ تم إضافة عامل تجهيز جديد' : 'Worker Added', 'SUCCESS');
    }

    // Reset Form
    setNewWorkerName('');
    setNewWorkerCode('');
    setNewWorkerLevel('INTERMEDIATE');
    setNewWorkerSpecialty('');
    setNewWorkerPhone('');
    setEditingWorkerId(null);
    const updated = await getWarehouseWorkers();
    setWorkers(updated);
  };

  const handleEditWorker = (worker: WarehouseWorker) => {
    setEditingWorkerId(worker.id);
    setNewWorkerName(worker.name);
    setNewWorkerCode(worker.code);
    setNewWorkerLevel(worker.experienceLevel);
    setNewWorkerSpecialty(worker.specialty || '');
    setNewWorkerPhone(worker.phone || '');
  };

  const handleDeleteWorker = async (id: string) => {
    if (window.confirm(isRtl ? 'هل أنت متأكد من حذف هذا العامل؟' : 'Delete this worker?')) {
      await deleteWarehouseWorker(id);
      const updated = await getWarehouseWorkers();
      setWorkers(updated);
      showNotice(isRtl ? 'تم حذف العامل' : 'Worker Deleted', 'INFO');
    }
  };

  const handleToggleWorkerStatus = async (worker: WarehouseWorker) => {
    const updated: WarehouseWorker = { ...worker, isActive: !worker.isActive };
    await updateWarehouseWorker(updated);
    const list = await getWarehouseWorkers();
    setWorkers(list);
  };

  // Helper for Experience Badge Styles
  const getExperienceBadge = (level: WorkerExperienceLevel) => {
    switch (level) {
      case 'EXPERT':
        return (
          <span className="bg-red-950/80 text-red-300 border border-red-800/80 px-2 py-0.5 rounded-md text-[11px] font-black inline-flex items-center gap-1">
            <Award className="w-3 h-3 text-red-400" />
            {isRtl ? 'خبير تجهيز' : 'Expert'}
          </span>
        );
      case 'INTERMEDIATE':
        return (
          <span className="bg-amber-950/80 text-amber-300 border border-amber-800/80 px-2 py-0.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1">
            <UserCheck className="w-3 h-3 text-amber-400" />
            {isRtl ? 'متوسط الخبرة' : 'Intermediate'}
          </span>
        );
      case 'NOVICE':
        return (
          <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1">
            <Users className="w-3 h-3 text-emerald-400" />
            {isRtl ? 'مبتدئ / سريع' : 'Novice'}
          </span>
        );
    }
  };

  // Helper for Difficulty Badge Styles
  const getDifficultyBadge = (level: GroupDifficultyLevel) => {
    switch (level) {
      case 'HIGH_EXPERT':
        return (
          <span className="bg-red-900/60 text-red-200 border border-red-700/80 px-2.5 py-1 rounded-lg text-xs font-black inline-flex items-center gap-1.5 shadow-sm">
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            {isRtl ? 'صعبة التجهيز (تحتاج لعامل خبير)' : 'High Difficulty (Expert)'}
          </span>
        );
      case 'MEDIUM_INTERMEDIATE':
        return (
          <span className="bg-amber-900/60 text-amber-200 border border-amber-700/80 px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shadow-sm">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            {isRtl ? 'متوسطة الصعوبة' : 'Medium Difficulty'}
          </span>
        );
      case 'LOW_NOVICE':
        return (
          <span className="bg-emerald-900/60 text-emerald-200 border border-emerald-700/80 px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shadow-sm">
            <Boxes className="w-3.5 h-3.5 text-emerald-400" />
            {isRtl ? 'سهلة التجهيز (كراتين / سريع)' : 'Low Difficulty (Novice)'}
          </span>
        );
    }
  };

  // Filter groups
  const filteredGroups = activeWave?.groups.filter(group => {
    if (selectedGroupFilter !== 'ALL' && group.groupId !== selectedGroupFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchGroupName = group.groupName.toLowerCase().includes(q);
      const matchWorker = group.assignedWorkerName?.toLowerCase().includes(q);
      const matchItems = group.items.some(
        it => it.itemCode.toLowerCase().includes(q) || it.itemName.toLowerCase().includes(q)
      );
      return matchGroupName || matchWorker || matchItems;
    }
    return true;
  }) || [];

  return (
    <div className="space-y-5">
      {/* Top Banner & Title */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-900/50 rounded-2xl p-4 sm:p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-inner">
              <ListFilter className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-white tracking-wide">
                  {isRtl ? 'تكوين قائمة التقاط وانتقاء الفواتير المجمعة' : 'Batch Wave Picking Generator'}
                </h1>
                <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full text-[11px] font-bold">
                  {isRtl ? 'إكسيل ⬅ تجميع كود ⬅ عبوات ⬅ إسناد عمال' : 'Excel Aggregation & Packaging'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {isRtl 
                  ? 'رفع فواتير متعددة مفصلة، دمج وتجميع الكميات ذات الكود الواحد، تفصيلها لمجموعات وعبوات، وإسنادها للعمال حسب الخبرة'
                  : 'Import multi-invoice orders, aggregate by item code, breakdown packaging (cartons/packs/pcs), and assign to workers by skill level.'}
              </p>
            </div>
          </div>

          {/* Action buttons on top */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => exportAllPickingWavesToExcel(savedWaves)}
              className="bg-emerald-700/80 hover:bg-emerald-600 text-white border border-emerald-500/50 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
              title={isRtl ? 'تصدير كافة موجات وقوائم الانتقاء المجمعة إلى إكسيل' : 'Export All Waves to Excel'}
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
              <span>{isRtl ? 'تصدير كافة قوائم الانتقاء (Excel)' : 'Export All Picking Waves'}</span>
            </button>

            {activeWave && (
              <button
                onClick={() => exportPickingWaveToExcel(activeWave)}
                className="bg-slate-800/90 hover:bg-slate-700 text-emerald-400 border border-slate-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                title={isRtl ? 'تصدير الموجة الحالية إلى إكسيل' : 'Export Current Wave'}
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>{isRtl ? `تصدير ${activeWave.waveNo}` : 'Export Wave'}</span>
              </button>
            )}

            <button
              id="download-picking-template-btn"
              onClick={downloadPickingExcelTemplate}
              className="bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
              title={isRtl ? 'تحميل نموذج إكسيل فواتير جاهز' : 'Download Template'}
            >
              <Download className="w-4 h-4 text-slate-400" />
              <span>{isRtl ? 'نموذج الفواتير' : 'Template'}</span>
            </button>

            <button
              id="open-packaging-rules-btn"
              onClick={() => setIsRulesModalOpen(true)}
              className="bg-slate-800/90 hover:bg-slate-700 text-indigo-300 border border-indigo-800/60 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
              title={isRtl ? 'إدارة شروط ضم وتجميع العبوات' : 'Packaging Rules'}
            >
              <Sliders className="w-4 h-4 text-indigo-400" />
              <span>{isRtl ? 'شروط ضم العبوات' : 'Packaging Rules'}</span>
            </button>

            <label className="bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all shadow-md active:scale-95 ring-1 ring-indigo-400">
              <Upload className="w-4 h-4" />
              <span>{isUploading ? (isRtl ? 'جاري التجميع...' : 'Processing...') : (isRtl ? 'رفع إكسيل الفواتير' : 'Import Invoices Excel')}</span>
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileUpload}
                className="hidden"
                disabled={isUploading}
              />
            </label>
          </div>
        </div>

        {/* Action Notice Alert */}
        {actionNotice && (
          <div className={`mt-3 p-3 rounded-xl border flex items-center justify-between text-xs font-bold transition-all shadow-md ${
            actionNotice.type === 'SUCCESS' 
              ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200' 
              : actionNotice.type === 'WARNING'
              ? 'bg-amber-950/80 border-amber-700 text-amber-200'
              : 'bg-blue-950/80 border-blue-700 text-blue-200'
          }`}>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>{actionNotice.message}</span>
            </div>
            <button onClick={() => setActionNotice(null)} className="text-slate-400 hover:text-white px-2">✕</button>
          </div>
        )}
      </div>

      {/* Sub Navigation Bar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => setActiveSubTab('wave')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all ${
              activeSubTab === 'wave'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span>{isRtl ? 'قوائم التجهيز والمجموعات' : 'Wave Groups & Items'}</span>
            {activeWave && (
              <span className="bg-indigo-950 text-indigo-200 px-2 py-0.5 rounded-full text-[11px] font-bold">
                {activeWave.groups.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab('workers')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all ${
              activeSubTab === 'workers'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>{isRtl ? 'إدارة عمال التجهيز والخبرات' : 'Workers & Skills'}</span>
            <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full text-[11px] font-bold">
              {workers.length}
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('history')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all ${
              activeSubTab === 'history'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>{isRtl ? 'سجل موجات الانتقاء' : 'Saved Waves'}</span>
            <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full text-[11px] font-bold">
              {savedWaves.length}
            </span>
          </button>
        </div>

        {activeWave && activeSubTab === 'wave' && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleApplyAutoAssign}
              className="bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/70 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
              title={isRtl ? 'إعادة الإسناد الذكي للعمال حسب الصعوبة والخبرة' : 'Auto Assign Workers'}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">{isRtl ? 'إسناد ذكي للعمال' : 'Smart Auto-Assign'}</span>
            </button>

            <button
              onClick={() => exportPickingWaveToExcel(activeWave)}
              className="bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/70 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
              title={isRtl ? 'تصدير كامل قائمة الانتقاء لإكسيل مع تفصيل المجموعات' : 'Export Wave Excel'}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">{isRtl ? 'تصدير إكسيل' : 'Export Excel'}</span>
            </button>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: WAVE PICKING GROUPS & PACKAGING BREAKDOWN VIEW                     */}
      {/* ========================================================================= */}
      {activeSubTab === 'wave' && (
        <div className="space-y-4">
          {activeWave ? (
            <>
              {/* Wave Summary Dashboard Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-md">
                  <div className="text-[11px] text-slate-400 font-bold mb-1 flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 text-blue-400" />
                    <span>{isRtl ? 'الفواتير المخدومة' : 'Total Invoices'}</span>
                  </div>
                  <div className="text-lg font-black text-blue-300 font-mono">
                    {activeWave.totalInvoicesCount} <span className="text-xs font-normal text-slate-400">{isRtl ? 'فاتورة' : 'Invoices'}</span>
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-md">
                  <div className="text-[11px] text-slate-400 font-bold mb-1 flex items-center gap-1">
                    <ListFilter className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isRtl ? 'الأصناف المجمعة' : 'Unique Items'}</span>
                  </div>
                  <div className="text-lg font-black text-emerald-300 font-mono">
                    {activeWave.totalItemsCount} <span className="text-xs font-normal text-slate-400">{isRtl ? 'كود صنف' : 'Codes'}</span>
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-md">
                  <div className="text-[11px] text-slate-400 font-bold mb-1 flex items-center gap-1">
                    <Boxes className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{isRtl ? 'إجمالي الكمية' : 'Total Pieces'}</span>
                  </div>
                  <div className="text-lg font-black text-indigo-300 font-mono">
                    {activeWave.totalQuantity} <span className="text-xs font-normal text-slate-400">{isRtl ? 'حبة' : 'Pcs'}</span>
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-md">
                  <div className="text-[11px] text-slate-400 font-bold mb-1 flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isRtl ? 'إجمالي الكراتين' : 'Master Cartons'}</span>
                  </div>
                  <div className="text-lg font-black text-amber-300 font-mono">
                    {activeWave.totalCartons} <span className="text-xs font-normal text-slate-400">{isRtl ? 'كرتونة' : 'Ctn'}</span>
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-md">
                  <div className="text-[11px] text-slate-400 font-bold mb-1 flex items-center gap-1">
                    <Boxes className="w-3.5 h-3.5 text-purple-400" />
                    <span>{isRtl ? 'إجمالي الباكتات' : 'Shrink Packs'}</span>
                  </div>
                  <div className="text-lg font-black text-purple-300 font-mono">
                    {activeWave.totalPacks} <span className="text-xs font-normal text-slate-400">{isRtl ? 'باكت' : 'Pk'}</span>
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-md">
                  <div className="text-[11px] text-slate-400 font-bold mb-1 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{isRtl ? 'المجموعات المسندة' : 'Assigned Groups'}</span>
                  </div>
                  <div className="text-lg font-black text-cyan-300 font-mono">
                    {activeWave.groups.filter(g => g.assignedWorkerId).length} / {activeWave.groups.length}
                  </div>
                </div>
              </div>

              {/* Filtering and Search Controls */}
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Search className="w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isRtl ? 'بحث بكود الصنف، الاسم، المجموعة، أو اسم العامل...' : 'Search item, group, or worker...'}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-full sm:w-80"
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <label className="text-xs text-slate-400">{isRtl ? 'تصفية بالمجموعة:' : 'Filter Group:'}</label>
                  <select
                    value={selectedGroupFilter}
                    onChange={(e) => setSelectedGroupFilter(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-bold"
                  >
                    <option value="ALL">{isRtl ? 'جميع المجموعات' : 'All Product Groups'}</option>
                    {activeWave.groups.map(g => (
                      <option key={g.groupId} value={g.groupId}>
                        {g.groupName} ({g.items.length} صنف - {g.totalQty} حبة)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* SEPARATED PRODUCT GROUP TABLES (فصل كل مجموعة في جدول منفصل) */}
              <div className="space-y-6">
                {filteredGroups.length === 0 ? (
                  <div className="text-center py-12 bg-slate-900/40 border border-slate-800 rounded-2xl">
                    <Boxes className="w-12 h-12 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">{isRtl ? 'لا توجد مجموعات تطابق البحث المحدد' : 'No matching product groups found'}</p>
                  </div>
                ) : (
                  filteredGroups.map((group, groupIdx) => {
                    const assignedWorker = workers.find(w => w.id === group.assignedWorkerId);
                    const isGroupCompleted = group.items.every(i => i.status === 'COMPLETED');
                    const pickedItemsCount = group.items.filter(i => i.status === 'COMPLETED').length;
                    const completionPercent = Math.round((pickedItemsCount / group.items.length) * 100);

                    return (
                      <div
                        key={group.groupId}
                        className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all"
                      >
                        {/* Group Header Card */}
                        <div className={`p-4 border-b flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                          group.difficulty === 'HIGH_EXPERT'
                            ? 'bg-gradient-to-r from-red-950/40 via-slate-900 to-slate-900 border-red-900/40'
                            : group.difficulty === 'MEDIUM_INTERMEDIATE'
                            ? 'bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 border-amber-900/40'
                            : 'bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border-emerald-900/40'
                        }`}>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="bg-slate-800 text-indigo-300 font-mono text-xs px-2 py-0.5 rounded-md font-bold">
                                #{groupIdx + 1}
                              </span>
                              <h2 className="text-base font-black text-white">{group.groupName}</h2>
                              {getDifficultyBadge(group.difficulty)}
                            </div>
                            <p className="text-xs text-slate-400 flex items-center gap-3">
                              <span>{isRtl ? 'عدد الأصناف:' : 'Items:'} <strong className="text-white">{group.items.length}</strong></span>
                              <span>•</span>
                              <span>{isRtl ? 'الفواتير المخدومة:' : 'Invoices:'} <strong className="text-white">{group.invoicesCount}</strong></span>
                              <span>•</span>
                              <span>{isRtl ? 'نسبة الإنجاز:' : 'Progress:'} <strong className={completionPercent === 100 ? 'text-emerald-400' : 'text-amber-400'}>{completionPercent}%</strong></span>
                            </p>
                          </div>

                          {/* Worker Assignment & Actions */}
                          <div className="flex flex-wrap items-center gap-2.5">
                            {/* Worker Selector Dropdown */}
                            <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 rounded-xl px-2.5 py-1.5">
                              <UserCheck className="w-4 h-4 text-indigo-400" />
                              <div className="flex flex-col">
                                <span className="text-[10px] text-slate-400 font-bold">{isRtl ? 'العامل المسند:' : 'Assigned Worker:'}</span>
                                <select
                                  value={group.assignedWorkerId || ''}
                                  onChange={(e) => handleAssignWorkerToGroup(group.groupId, e.target.value)}
                                  className="bg-transparent text-xs font-bold text-slate-100 focus:outline-none cursor-pointer"
                                >
                                  <option value="" className="bg-slate-900 text-slate-400">
                                    {isRtl ? '-- حدد عامل للتجهيز --' : '-- Assign Worker --'}
                                  </option>
                                  {workers.map(w => (
                                    <option key={w.id} value={w.id} className="bg-slate-900 text-slate-100">
                                      {w.name} ({w.code} - {w.experienceLevel === 'EXPERT' ? 'خبير' : w.experienceLevel === 'INTERMEDIATE' ? 'متوسط' : 'مبتدئ'})
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {assignedWorker && getExperienceBadge(assignedWorker.experienceLevel)}
                            </div>

                            {/* Difficulty Selector */}
                            <div className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 rounded-xl px-2.5 py-1.5">
                              <span className="text-[10px] text-slate-400 font-bold">{isRtl ? 'الصعوبة:' : 'Difficulty:'}</span>
                              <select
                                value={group.difficulty}
                                onChange={(e) => handleDifficultyChange(group.groupId, e.target.value as GroupDifficultyLevel)}
                                className="bg-transparent text-xs font-bold text-slate-100 focus:outline-none cursor-pointer"
                              >
                                <option value="HIGH_EXPERT" className="bg-slate-900 text-red-300">{isRtl ? 'صعبة (خبير)' : 'High (Expert)'}</option>
                                <option value="MEDIUM_INTERMEDIATE" className="bg-slate-900 text-amber-300">{isRtl ? 'متوسطة' : 'Medium'}</option>
                                <option value="LOW_NOVICE" className="bg-slate-900 text-emerald-300">{isRtl ? 'سهلة (مبتدئ)' : 'Low (Novice)'}</option>
                              </select>
                            </div>

                            {/* PDF Worker Slip Export Button */}
                            <button
                              onClick={() => exportWorkerPickingSheetPdf(activeWave, group, assignedWorker)}
                              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                              title={isRtl ? 'طباعة كشف وتذكرة التجهيز الخاصة بالعامل' : 'Print Worker Picking Slip'}
                            >
                              <Printer className="w-3.5 h-3.5 text-indigo-400" />
                              <span className="hidden sm:inline">{isRtl ? 'كشف العامل (PDF)' : 'Worker Slip'}</span>
                            </button>
                          </div>
                        </div>

                        {/* Packaging Breakdown Summary Banner for Group */}
                        <div className="bg-slate-950/80 border-b border-slate-800/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-slate-400 font-bold">{isRtl ? 'آلية تجميع العبوات للمجموعة:' : 'Packaging Breakdown:'}</span>
                            <span className="bg-amber-950/60 text-amber-300 border border-amber-800/60 px-2.5 py-1 rounded-lg font-mono font-bold">
                              📦 {group.totalCartons} {isRtl ? 'كرتونة' : 'Cartons'}
                            </span>
                            <span className="bg-purple-950/60 text-purple-300 border border-purple-800/60 px-2.5 py-1 rounded-lg font-mono font-bold">
                              🧃 {group.totalPacks} {isRtl ? 'باكت' : 'Packs'}
                            </span>
                            <span className="bg-blue-950/60 text-blue-300 border border-blue-800/60 px-2.5 py-1 rounded-lg font-mono font-bold">
                              🔹 {group.totalPieces} {isRtl ? 'حبات فردية' : 'Loose Pieces'}
                            </span>
                            <span className="text-slate-400 font-mono">
                              = <strong>{group.totalQty}</strong> {isRtl ? 'إجمالي الحبات' : 'Total Pcs'}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-400">
                            {group.items.length} {isRtl ? 'أصناف مدمجة الكود' : 'Aggregated SKUs'}
                          </div>
                        </div>

                        {/* Group Items Table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-right text-xs">
                            <thead className="bg-slate-950/90 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                              <tr>
                                <th className="p-3 text-center w-12">#</th>
                                <th className="p-3">{isRtl ? 'كود الصنف / الباركود' : 'Item Barcode'}</th>
                                <th className="p-3">{isRtl ? 'اسم وبيان الصنف' : 'Item Description'}</th>
                                <th className="p-3 text-center">{isRtl ? 'الموقع' : 'Location'}</th>
                                <th className="p-3 text-center">{isRtl ? 'إجمالي المطلوب' : 'Total Qty'}</th>
                                <th className="p-3 text-center">{isRtl ? 'تفصيل الكراتين' : 'Cartons'}</th>
                                <th className="p-3 text-center">{isRtl ? 'تفصيل الباكتات' : 'Packs'}</th>
                                <th className="p-3 text-center">{isRtl ? 'حبات متبقية' : 'Loose'}</th>
                                <th className="p-3 text-center">{isRtl ? 'الفواتير المخدومة' : 'Invoices'}</th>
                                <th className="p-3 text-center">{isRtl ? 'حالة الالتقاط' : 'Status / Pick'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {group.items.map((item, itemIdx) => {
                                const isItemDone = item.status === 'COMPLETED';
                                return (
                                  <tr
                                    key={item.id}
                                    className={`transition-colors ${
                                      isItemDone ? 'bg-emerald-950/20 hover:bg-emerald-950/30' : 'hover:bg-slate-800/40'
                                    }`}
                                  >
                                    <td className="p-3 text-center text-slate-500 font-mono text-[11px]">
                                      {itemIdx + 1}
                                    </td>
                                    <td className="p-3">
                                      <span className="font-mono font-bold text-amber-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                                        {item.itemCode}
                                      </span>
                                    </td>
                                    <td className="p-3">
                                      <div className="font-semibold text-slate-100">{item.itemName}</div>
                                      <div className="text-[10px] text-slate-400">{item.unit}</div>
                                    </td>
                                    <td className="p-3 text-center font-mono text-slate-300 text-[11px]">
                                      {item.location || 'Aisle-01'}
                                    </td>
                                    <td className="p-3 text-center font-black text-indigo-300 font-mono text-sm">
                                      {item.totalRequiredQty}
                                    </td>
                                    <td className="p-3 text-center">
                                      <span className="bg-amber-950/50 text-amber-300 border border-amber-800/40 px-2 py-0.5 rounded font-mono font-bold text-[11px]">
                                        {item.cartonsCount} <span className="text-[9px] text-slate-400">(x{item.cartonFactor})</span>
                                      </span>
                                    </td>
                                    <td className="p-3 text-center">
                                      <span className="bg-purple-950/50 text-purple-300 border border-purple-800/40 px-2 py-0.5 rounded font-mono font-bold text-[11px]">
                                        {item.packsCount} <span className="text-[9px] text-slate-400">(x{item.packFactor})</span>
                                      </span>
                                    </td>
                                    <td className="p-3 text-center font-mono text-slate-300">
                                      {item.piecesCount}
                                    </td>
                                    <td className="p-3 text-center">
                                      <button
                                        onClick={() => setSelectedItemForDetails(item)}
                                        className="bg-slate-800 hover:bg-slate-700 text-blue-300 border border-blue-900/50 px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1"
                                      >
                                        <Eye className="w-3 h-3" />
                                        <span>{item.invoiceSources.length} {isRtl ? 'فواتير' : 'Invs'}</span>
                                      </button>
                                    </td>
                                    <td className="p-3 text-center">
                                      <button
                                        onClick={() => handleToggleItemPicked(group.groupId, item.id)}
                                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 mx-auto ${
                                          isItemDone
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                                        }`}
                                      >
                                        <CheckCircle2 className={`w-3.5 h-3.5 ${isItemDone ? 'text-white' : 'text-slate-500'}`} />
                                        <span>{isItemDone ? (isRtl ? 'تم الالتقاط' : 'Picked') : (isRtl ? 'تأكيد الالتقاط' : 'Mark Picked')}</span>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            /* Empty State */
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-10 text-center space-y-4 max-w-xl mx-auto my-8 shadow-2xl">
              <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 mx-auto shadow-inner">
                <FileSpreadsheet className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-black text-white">
                  {isRtl ? 'ابدأ بتكوين قائمة انتقاء جديدة من الإكسيل' : 'Start a New Batch Picking Wave'}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {isRtl 
                    ? 'قم برفع ملف إكسيل يحتوي على بيانات كميات الفواتير مفصلة، وسيقوم النظام فوراً بتجميع الكميات ذات الكود الواحد، واحتساب الكراتين والعبوات، وإسنادها للعمال حسب مستويات الخبرة والصعوبة.'
                    : 'Upload a multi-invoice Excel file to aggregate item quantities, compute packaging breakdown, and assign wave tasks to workers based on experience.'}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <label className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all shadow-lg ring-1 ring-indigo-400">
                  <Upload className="w-4 h-4" />
                  <span>{isRtl ? 'رفع ملف إكسيل الفواتير' : 'Upload Invoices Excel'}</span>
                  <input
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                <button
                  onClick={downloadPickingExcelTemplate}
                  className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                >
                  <Download className="w-4 h-4 text-slate-400" />
                  <span>{isRtl ? 'تحميل نموذج إكسيل تجريبي' : 'Download Sample'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: WAREHOUSE WORKERS & EXPERIENCE MANAGEMENT                          */}
      {/* ========================================================================= */}
      {activeSubTab === 'workers' && (
        <div className="space-y-5">
          {/* Worker Addition & Edit Form */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-black text-white">
                  {editingWorkerId ? (isRtl ? 'تعديل بيانات عامل التجهيز' : 'Edit Warehouse Worker') : (isRtl ? 'إضافة عامل تجهيز جديد لقاعدة البيانات' : 'Add New Warehouse Worker')}
                </h3>
              </div>
              {editingWorkerId && (
                <button
                  onClick={() => {
                    setEditingWorkerId(null);
                    setNewWorkerName('');
                    setNewWorkerCode('');
                    setNewWorkerLevel('INTERMEDIATE');
                    setNewWorkerSpecialty('');
                    setNewWorkerPhone('');
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  {isRtl ? 'إلغاء التعديل' : 'Cancel Edit'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 font-bold block mb-1">
                  {isRtl ? 'اسم العامل *' : 'Worker Name *'}
                </label>
                <input
                  type="text"
                  value={newWorkerName}
                  onChange={(e) => setNewWorkerName(e.target.value)}
                  placeholder={isRtl ? 'مثال: أحمد عبد الله' : 'e.g. Ahmed Ali'}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-bold block mb-1">
                  {isRtl ? 'كود / رقم العامل (Barcode/ID)' : 'Worker Code / ID'}
                </label>
                <input
                  type="text"
                  value={newWorkerCode}
                  onChange={(e) => setNewWorkerCode(e.target.value)}
                  placeholder="EMP-101"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-bold block mb-1">
                  {isRtl ? 'مستوى الخبرة في التجهيز *' : 'Experience Level *'}
                </label>
                <select
                  value={newWorkerLevel}
                  onChange={(e) => setNewWorkerLevel(e.target.value as WorkerExperienceLevel)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold cursor-pointer"
                >
                  <option value="EXPERT">{isRtl ? '⭐️⭐️⭐️ عامل خبير (للمنتجات الحساسة والصعبة)' : 'Expert (Fragile & Complex)'}</option>
                  <option value="INTERMEDIATE">{isRtl ? '⭐️⭐️ عامل متوسط (للتجهيز العادي والغذائيات)' : 'Intermediate (Standard)'}</option>
                  <option value="NOVICE">{isRtl ? '⭐️ عامل مبتدئ (للكراتين المقفلة والسريعة)' : 'Novice (Fast / Bulk)'}</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-bold block mb-1">
                  {isRtl ? 'التخصص أو القسم المفضل' : 'Specialty / Notes'}
                </label>
                <input
                  type="text"
                  value={newWorkerSpecialty}
                  onChange={(e) => setNewWorkerSpecialty(e.target.value)}
                  placeholder={isRtl ? 'مثال: زجاجيات، أدوية، معلبات...' : 'e.g. Fragile, Cold chain...'}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSaveWorker}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{editingWorkerId ? (isRtl ? 'تحديث بيانات العامل' : 'Update Worker') : (isRtl ? 'حفظ العامل في قاعدة البيانات' : 'Save Worker')}</span>
              </button>
            </div>
          </div>

          {/* Workers Database Table */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-black text-white">{isRtl ? 'جدول عمال المستودع ومستويات خبراتهم المسجلة' : 'Warehouse Workers Directory'}</h3>
              </div>
              <span className="text-xs text-slate-400">
                {workers.length} {isRtl ? 'عمال مسجلين' : 'Registered Workers'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-950/90 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3 text-center w-12">#</th>
                    <th className="p-3">{isRtl ? 'اسم العامل' : 'Worker Name'}</th>
                    <th className="p-3">{isRtl ? 'كود العامل' : 'Code / ID'}</th>
                    <th className="p-3">{isRtl ? 'مستوى الخبرة' : 'Experience Level'}</th>
                    <th className="p-3">{isRtl ? 'التخصص والملاحظات' : 'Specialty'}</th>
                    <th className="p-3 text-center">{isRtl ? 'الحالة' : 'Status'}</th>
                    <th className="p-3 text-center">{isRtl ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {workers.map((w, idx) => (
                    <tr key={w.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="p-3 text-center text-slate-500 font-mono text-[11px]">{idx + 1}</td>
                      <td className="p-3 font-bold text-white">{w.name}</td>
                      <td className="p-3 font-mono text-indigo-300 font-bold">{w.code}</td>
                      <td className="p-3">{getExperienceBadge(w.experienceLevel)}</td>
                      <td className="p-3 text-slate-300 text-xs">{w.specialty || '-'}</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleToggleWorkerStatus(w)}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${
                            w.isActive
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {w.isActive ? (isRtl ? 'متاح للتجهيز' : 'Active') : (isRtl ? 'غير متاح' : 'Inactive')}
                        </button>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleEditWorker(w)}
                            className="text-slate-400 hover:text-indigo-300 p-1 rounded hover:bg-slate-800"
                            title={isRtl ? 'تعديل' : 'Edit'}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteWorker(w.id)}
                            className="text-slate-400 hover:text-red-400 p-1 rounded hover:bg-slate-800"
                            title={isRtl ? 'حذف' : 'Delete'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: SAVED PICKING WAVES HISTORY                                       */}
      {/* ========================================================================= */}
      {activeSubTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="text-sm font-black text-white">{isRtl ? 'سجل قوائم وموجات الانتقاء السابقة' : 'Saved Waves History'}</h3>
                  <p className="text-xs text-slate-400">{savedWaves.length} {isRtl ? 'موجة مسجلة في النظام' : 'Waves recorded'}</p>
                </div>
              </div>
              {savedWaves.length > 0 && (
                <button
                  onClick={() => exportAllPickingWavesToExcel(savedWaves)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-sm transition-all"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>{isRtl ? 'تصدير كافة الموجات (Excel)' : 'Export All Waves to Excel'}</span>
                </button>
              )}
            </div>

            {savedWaves.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                {isRtl ? 'لا توجد موجات انتقاء محفوظة حتى الآن' : 'No saved picking waves yet'}
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {savedWaves.map((wave) => (
                  <div key={wave.id} className="p-4 hover:bg-slate-800/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-amber-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-xs">
                          {wave.waveNo}
                        </span>
                        <h4 className="text-sm font-bold text-white">{wave.title}</h4>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          wave.status === 'COMPLETED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                        }`}>
                          {wave.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 flex flex-wrap items-center gap-3">
                        <span>{wave.totalInvoicesCount} {isRtl ? 'فواتير' : 'Invoices'}</span>
                        <span>•</span>
                        <span>{wave.totalItemsCount} {isRtl ? 'أصناف مجمعة' : 'SKUs'}</span>
                        <span>•</span>
                        <span>{wave.totalQuantity} {isRtl ? 'حبة' : 'Pcs'}</span>
                        <span>•</span>
                        <span>{wave.totalCartons} {isRtl ? 'كرتونة' : 'Cartons'}</span>
                        <span>•</span>
                        <span>{new Date(wave.createdAt).toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setActiveWave(wave);
                          setActiveSubTab('wave');
                          showNotice(isRtl ? `تم فتح موجة التجهيز ${wave.waveNo}` : `Opened wave ${wave.waveNo}`, 'SUCCESS');
                        }}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                      >
                        {isRtl ? 'فتح في شاشة التجهيز' : 'Open in Wave View'}
                      </button>

                      <button
                        onClick={() => exportPickingWaveToExcel(wave)}
                        className="bg-slate-800 hover:bg-slate-700 text-emerald-400 p-2 rounded-xl"
                        title={isRtl ? 'تصدير إكسيل' : 'Export Excel'}
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                      </button>

                      <button
                        onClick={async () => {
                          if (window.confirm(isRtl ? 'حذف هذه الموجة؟' : 'Delete wave?')) {
                            await deletePickingWave(wave.id);
                            const updated = await getAllPickingWaves();
                            setSavedWaves(updated);
                            if (activeWave?.id === wave.id) setActiveWave(null);
                          }
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-red-400 p-2 rounded-xl"
                        title={isRtl ? 'حذف' : 'Delete'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: INVOICE SOURCES BREAKDOWN (تفاصيل الفواتير التابعة للصنف المجمع)     */}
      {/* ========================================================================= */}
      {selectedItemForDetails && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-black text-white">
                  {isRtl ? 'تفصيل الفواتير والطلبات للصنف المجمع' : 'Invoices Breakdown for Aggregated Item'}
                </h3>
              </div>
              <button
                onClick={() => setSelectedItemForDetails(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 space-y-1">
              <div className="text-xs font-mono text-amber-300 font-bold">{selectedItemForDetails.itemCode}</div>
              <div className="text-sm font-bold text-white">{selectedItemForDetails.itemName}</div>
              <div className="text-xs text-slate-400 flex items-center gap-3 pt-1">
                <span>{isRtl ? 'إجمالي الكمية المطلوبة:' : 'Total Qty:'} <strong className="text-indigo-300">{selectedItemForDetails.totalRequiredQty} {selectedItemForDetails.unit}</strong></span>
                <span>•</span>
                <span>{isRtl ? 'الكراتين:' : 'Cartons:'} <strong className="text-amber-300">{selectedItemForDetails.cartonsCount}</strong></span>
              </div>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              <div className="text-xs font-bold text-slate-300">
                {isRtl ? 'الفواتير التي تطلب هذا الصنف:' : 'Requested by Invoices:'}
              </div>
              <div className="divide-y divide-slate-800/60 border border-slate-800 rounded-xl overflow-hidden">
                {selectedItemForDetails.invoiceSources.map((source, idx) => (
                  <div key={idx} className="p-2.5 bg-slate-950/40 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-blue-300 font-mono">
                        {isRtl ? 'فاتورة #' : 'Invoice #'}{source.invoiceNo}
                      </div>
                      {source.customerName && (
                        <div className="text-[11px] text-slate-400">{source.customerName}</div>
                      )}
                    </div>
                    <div className="font-black text-white font-mono bg-slate-800 px-2 py-0.5 rounded">
                      {source.qty} {selectedItemForDetails.unit}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedItemForDetails(null)}
                className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-xs font-bold"
              >
                {isRtl ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Packaging Rules Modal */}
      <PackagingRulesModal
        isOpen={isRulesModalOpen}
        onClose={() => setIsRulesModalOpen(false)}
        rules={packagingRules}
        onRulesUpdated={(updated) => setPackagingRules(updated)}
        isRtl={isRtl}
      />
    </div>
  );
};
