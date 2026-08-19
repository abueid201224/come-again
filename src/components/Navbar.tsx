import React from 'react';
import { 
  ScanLine, 
  AlertTriangle, 
  Database, 
  RefreshCw, 
  Volume2, 
  VolumeX, 
  WifiOff, 
  CheckCircle2,
  Sliders,
  Languages,
  Smartphone
} from 'lucide-react';
import type { SyncMetadata, AppSettings } from '../types';
import { translations } from '../services/i18n';

interface NavbarProps {
  currentTab: 'audit' | 'errors' | 'master' | 'settings';
  setCurrentTab: (tab: 'audit' | 'errors' | 'master' | 'settings') => void;
  syncMeta: SyncMetadata;
  onOpenSyncModal: () => void;
  errorCount: number;
  settings: AppSettings;
  onToggleSound: () => void;
  onToggleLanguage: () => void;
  isScannerActive: boolean;
  canInstallPwa?: boolean;
  onInstallPwa?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  syncMeta,
  onOpenSyncModal,
  errorCount,
  settings,
  onToggleSound,
  onToggleLanguage,
  isScannerActive,
  canInstallPwa,
  onInstallPwa,
}) => {
  const t = translations[settings.language] || translations.en;
  const isRtl = settings.language === 'ar';

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-40 shadow-md">
      {/* Top Banner with Industrial Branding & Offline Indicators */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
        {/* Brand & Scanner Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-600 text-white font-bold shadow-inner">
            <ScanLine className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                {t.appTitle}
              </h1>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 px-2 py-0.5 rounded-full">
                <WifiOff className="w-3 h-3" />
                {t.offlineMode}
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              {isRtl ? 'دعم كامل لقارئ الباركود والإسكان العشوائي للأصناف ومزامنة إكسيل' : '1D USB/Bluetooth Barcode Scanner Wedge & Random Scan Support'}
            </p>
          </div>
        </div>

        {/* Action Controls & Sync Button */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* PWA Install Button (When prompt available) */}
          {canInstallPwa && (
            <button
              onClick={onInstallPwa}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-xs font-bold text-white shadow-md border border-emerald-400/40 animate-bounce"
              title={isRtl ? 'تثبيت التطبيق على جهاز الأندرويد' : 'Install App on Android'}
            >
              <Smartphone className="w-4 h-4" />
              <span className="hidden sm:inline">{isRtl ? 'تثبيت التطبيق' : 'Install PWA'}</span>
            </button>
          )}

          {/* Hardware Scanner Pulse indicator */}
          <div 
            title={isScannerActive ? "Hardware Scanner Ready & Connected" : "Listening for Barcode Key-Wedge"}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300"
          >
            <span className={`w-2.5 h-2.5 rounded-full ${isScannerActive ? 'bg-emerald-400 animate-ping' : 'bg-emerald-500'}`} />
            <span>{t.scannerReady}</span>
          </div>

          {/* Language Switcher Button (العربية / English) */}
          <button
            onClick={onToggleLanguage}
            title={isRtl ? "Switch to English" : "التحويل للغة العربية"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors"
          >
            <Languages className="w-4 h-4 text-emerald-400" />
            <span>{isRtl ? 'English' : 'عربي'}</span>
          </button>

          {/* Sound Toggle */}
          <button
            onClick={onToggleSound}
            title={settings.soundEnabled ? "Mute Audible Scan Feedback" : "Enable Audible Scan Feedback"}
            className={`p-2 rounded-lg border transition-colors ${
              settings.soundEnabled 
                ? 'bg-slate-800 border-slate-700 text-emerald-400 hover:bg-slate-700' 
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {settings.soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          {/* CRITICAL: Daily Excel Update Button */}
          <button
            id="daily-excel-sync-btn"
            onClick={onOpenSyncModal}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white px-3 sm:px-4 py-2 rounded-lg font-semibold text-sm shadow-sm transition-all border border-emerald-500/50"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden xs:inline">{t.updateExcel}</span>
            <span className="xs:hidden">{t.sync}</span>
            {syncMeta.totalInvoices > 0 && (
              <span className="bg-emerald-800 text-emerald-100 text-xs px-1.5 py-0.5 rounded font-mono">
                {syncMeta.totalInvoices}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <div className="bg-slate-950/90 border-t border-slate-800/80 px-2 sm:px-4">
        <nav className="max-w-7xl mx-auto flex items-center gap-1 sm:gap-2 overflow-x-auto py-1.5 scrollbar-none">
          <button
            id="nav-audit-tab"
            onClick={() => setCurrentTab('audit')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-md text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
              currentTab === 'audit'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <ScanLine className="w-4 h-4" />
            <span>{t.activeAudit}</span>
          </button>

          <button
            id="nav-errors-tab"
            onClick={() => setCurrentTab('errors')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-md text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
              currentTab === 'errors'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span>{t.errorReport}</span>
            {errorCount > 0 && (
              <span className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                currentTab === 'errors' ? 'bg-amber-950 text-amber-200' : 'bg-red-500 text-white'
              }`}>
                {errorCount}
              </span>
            )}
          </button>

          <button
            id="nav-master-tab"
            onClick={() => setCurrentTab('master')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-md text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
              currentTab === 'master'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>{t.masterInvoices} ({syncMeta.totalInvoices})</span>
          </button>

          <button
            id="nav-settings-tab"
            onClick={() => setCurrentTab('settings')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-md text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${isRtl ? 'mr-auto' : 'ml-auto'} ${
              currentTab === 'settings'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>{t.tools}</span>
          </button>
        </nav>
      </div>

      {/* Sync Status Banner */}
      {syncMeta.lastSyncDate && (
        <div className="bg-slate-800/60 border-t border-slate-700/50 px-4 py-1 text-[11px] text-slate-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {isRtl ? 'قاعدة بيانات اليوم:' : 'Daily Master Data:'} <strong className="text-slate-200">{syncMeta.fileName || 'Active Dataset'}</strong> ({syncMeta.totalInvoices} {isRtl ? 'فواتير' : 'Invoices'}, {syncMeta.totalItems} {isRtl ? 'صنف' : 'Items'})
            </span>
          </div>
          <span className="hidden sm:inline">
            {isRtl ? 'توقيت المزامنة:' : 'Synced:'} {new Date(syncMeta.lastSyncDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}
    </header>
  );
};
