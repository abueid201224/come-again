import React from 'react';
import { 
  ScanLine, 
  Volume2, 
  VolumeX, 
  Smartphone, 
  Sliders, 
  Info, 
  CheckCircle2, 
  AlertTriangle, 
  Zap,
  Play,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { SoundEffects } from '../services/audio';
import type { AppSettings, MasterInvoiceItem } from '../types';

interface ScannerSimulatorProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onSimulateScan: (barcode: string) => void;
  activeInvoiceNo: string | null;
  masterItems: MasterInvoiceItem[];
}

export const ScannerSimulator: React.FC<ScannerSimulatorProps> = ({
  settings,
  onUpdateSettings,
  onSimulateScan,
  activeInvoiceNo,
  masterItems,
}) => {
  // Extract unique invoices & sample items for simulation
  const uniqueInvoices = Array.from(new Set(masterItems.map(i => i.invoiceNo)));
  const currentInvoiceItems = masterItems.filter(i => i.invoiceNo === activeInvoiceNo);
  const otherInvoiceItems = masterItems.filter(i => i.invoiceNo !== activeInvoiceNo);

  const testAudio = (type: 'match' | 'exact' | 'mismatch' | 'surplus' | 'invoice') => {
    if (type === 'match') SoundEffects.playScanMatch(settings.soundVolume);
    if (type === 'exact') SoundEffects.playExactComplete(settings.soundVolume);
    if (type === 'mismatch') SoundEffects.playMismatchWarning(settings.soundVolume);
    if (type === 'surplus') SoundEffects.playSurplusAlert(settings.soundVolume);
    if (type === 'invoice') SoundEffects.playInvoiceLock(settings.soundVolume);
  };

  return (
    <div className="space-y-4">
      {/* 1. Barcode Simulator Panel (For quick testing without hardware) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
          <div className="p-2 bg-emerald-600/20 text-emerald-400 rounded-lg border border-emerald-500/30">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white">Handheld Barcode Simulator</h2>
            <p className="text-xs text-slate-400">
              Tap any barcode below to simulate 1D scanner laser events instantly
            </p>
          </div>
        </div>

        {/* Section A: Invoices */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span>Step A: Simulate Scanning Invoice Barcodes:</span>
            {activeInvoiceNo && (
              <span className="text-emerald-400 font-mono">Active: {activeInvoiceNo}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {uniqueInvoices.length > 0 ? (
              uniqueInvoices.map((inv) => (
                <button
                  key={inv}
                  onClick={() => onSimulateScan(inv)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono font-bold transition-all border ${
                    inv === activeInvoiceNo
                      ? 'bg-emerald-600 text-white border-emerald-400 shadow-md ring-2 ring-emerald-500/30'
                      : 'bg-slate-950 text-slate-200 border-slate-800 hover:border-emerald-500 hover:text-white'
                  }`}
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  <span>{inv}</span>
                </button>
              ))
            ) : (
              <div className="text-xs text-slate-500">No master invoices loaded.</div>
            )}
          </div>
        </div>

        {/* Section B: Matching Items */}
        <div className="space-y-2 pt-2 border-t border-slate-800/80">
          <div className="text-xs font-semibold text-slate-300">
            Step B: Simulate Scanning Items for Active Invoice ({activeInvoiceNo || 'None Locked'}):
          </div>
          {currentInvoiceItems.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {currentInvoiceItems.map((item) => (
                <button
                  key={item.itemCode}
                  onClick={() => onSimulateScan(item.itemCode)}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/80 transition-all text-left group"
                >
                  <div>
                    <div className="font-mono text-xs font-bold text-emerald-400 group-hover:text-emerald-300">
                      {item.itemCode}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                      {item.itemName}
                    </div>
                  </div>
                  <span className="text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded shrink-0">
                    Req: {item.requiredQty}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-3 bg-slate-950/60 rounded-lg text-xs text-slate-400 border border-slate-800">
              Scan or lock an invoice first to see matching items for quick testing.
            </div>
          )}
        </div>

        {/* Section C: Mismatch / Unknown Items */}
        <div className="space-y-2 pt-2 border-t border-slate-800/80">
          <div className="text-xs font-semibold text-red-300 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span>Simulate Mismatch Scans (Items that do NOT belong to active invoice):</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onSimulateScan('SKU-MISMATCH-999')}
              className="px-3 py-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-200 border border-red-800 rounded-lg text-xs font-mono font-bold transition-colors"
            >
              Scan [SKU-MISMATCH-999] (Foreign Item)
            </button>

            {otherInvoiceItems.slice(0, 2).map((item) => (
              <button
                key={item.itemCode}
                onClick={() => onSimulateScan(item.itemCode)}
                className="px-3 py-1.5 bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-900/60 rounded-lg text-xs font-mono font-bold transition-colors"
              >
                Scan [{item.itemCode}] (From {item.invoiceNo})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Hardware Scanner Configuration & Android Setup Guide */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
          <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white">Hardware Barcode Scanner Integration</h2>
            <p className="text-xs text-slate-400">
              Plug-and-play setup for USB OTG, 2.4GHz Dongle, and Bluetooth 1D Scanners
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-lg space-y-1">
            <div className="font-bold text-slate-200 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center justify-center text-[10px]">1</span>
              <span>Connect Scanner</span>
            </div>
            <p className="text-slate-400 text-[11px]">
              Plug via USB OTG cable or pair Bluetooth scanner in Android Settings as a standard HID Keyboard.
            </p>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-lg space-y-1">
            <div className="font-bold text-slate-200 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center justify-center text-[10px]">2</span>
              <span>Suffix Setting</span>
            </div>
            <p className="text-slate-400 text-[11px]">
              Ensure your physical scanner is programmed to append an <strong className="text-slate-200">[ENTER / CR]</strong> suffix at the end of each scan (factory default on 99% of scanners).
            </p>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-lg space-y-1">
            <div className="font-bold text-slate-200 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center justify-center text-[10px]">3</span>
              <span>Continuous Scanning</span>
            </div>
            <p className="text-slate-400 text-[11px]">
              Scan invoice barcode first, then scan items one by one. The count increments automatically without touching the screen.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Audio & Vibration Settings */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
          <div className="p-2 bg-purple-600/20 text-purple-400 rounded-lg border border-purple-500/30">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white">Audio & Haptic Feedback</h2>
            <p className="text-xs text-slate-400">
              Customize industrial audible beeps and device vibration
            </p>
          </div>
        </div>

        <div className="space-y-3 text-xs">
          {/* Sound Toggle & Volume */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-950/80 rounded-lg border border-slate-800">
            <div className="space-y-0.5">
              <div className="font-bold text-slate-200">Audible Beep Feedback</div>
              <div className="text-slate-400 text-[11px]">Distinct synthesized tones for Match, Exact, Mismatch & Surplus</div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.1"
                value={settings.soundVolume}
                onChange={(e) => onUpdateSettings({ ...settings, soundVolume: parseFloat(e.target.value) })}
                className="w-24 accent-emerald-500"
              />
              <button
                onClick={() => onUpdateSettings({ ...settings, soundEnabled: !settings.soundEnabled })}
                className={`px-3 py-1.5 rounded-lg font-bold border transition-colors ${
                  settings.soundEnabled
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {settings.soundEnabled ? 'Sound ON' : 'Muted'}
              </button>
            </div>
          </div>

          {/* Sound Preview Tests */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-slate-400 text-xs font-semibold">Test Tones:</span>
            <button
              onClick={() => testAudio('match')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded border border-slate-700 text-[11px] font-semibold"
            >
              Match Ping (880Hz)
            </button>
            <button
              onClick={() => testAudio('exact')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded border border-slate-700 text-[11px] font-semibold"
            >
              Exact Chime (High 2-tone)
            </button>
            <button
              onClick={() => testAudio('mismatch')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-red-400 rounded border border-slate-700 text-[11px] font-semibold"
            >
              Mismatch Buzz (Low 220Hz)
            </button>
            <button
              onClick={() => testAudio('surplus')}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded border border-slate-700 text-[11px] font-semibold"
            >
              Surplus Alert (3-tone)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
