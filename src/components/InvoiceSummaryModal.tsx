import React from 'react';
import { 
  CheckCircle2, 
  AlertTriangle, 
  Trash2, 
  Archive, 
  ArrowRight, 
  X,
  FileCheck2
} from 'lucide-react';
import type { AuditDiscrepancy } from '../types';

interface InvoiceSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceNo: string;
  discardedCount: number;
  archivedDiscrepancies: AuditDiscrepancy[];
  onViewErrorReport: () => void;
  onContinueScanning: () => void;
}

export const InvoiceSummaryModal: React.FC<InvoiceSummaryModalProps> = ({
  isOpen,
  onClose,
  invoiceNo,
  discardedCount,
  archivedDiscrepancies,
  onViewErrorReport,
  onContinueScanning,
}) => {
  if (!isOpen) return null;

  const totalEvaluated = discardedCount + archivedDiscrepancies.length;
  const isAllClean = archivedDiscrepancies.length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-xl text-slate-100 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${
          isAllClean ? 'bg-emerald-950/70 border-emerald-800/60' : 'bg-amber-950/70 border-amber-800/60'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${
              isAllClean ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
            }`}>
              {isAllClean ? <FileCheck2 className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Invoice {invoiceNo} Audited & Closed
              </h2>
              <p className="text-xs text-slate-300">
                Automatic Evaluation & Discrepancy Cleanup Triggered
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Summary Badges */}
          <div className="grid grid-cols-2 gap-3">
            {/* Clean Items Box */}
            <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 mb-1">
                <Trash2 className="w-4 h-4" />
                <span>CLEAN (Auto-Discarded)</span>
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-300">
                {discardedCount} <span className="text-xs font-normal text-emerald-400/80">items</span>
              </div>
              <p className="text-[11px] text-emerald-400/70 mt-1">
                Exact matches cleared from memory (no errors).
              </p>
            </div>

            {/* Discrepancy Box */}
            <div className={`rounded-lg p-3 border ${
              archivedDiscrepancies.length > 0 
                ? 'bg-amber-950/40 border-amber-800/60 text-amber-300' 
                : 'bg-slate-800/40 border-slate-700 text-slate-400'
            }`}>
              <div className="flex items-center gap-2 text-xs font-semibold mb-1 text-amber-400">
                <Archive className="w-4 h-4" />
                <span>DISCREPANCIES (Archived)</span>
              </div>
              <div className="text-2xl font-bold font-mono text-amber-300">
                {archivedDiscrepancies.length} <span className="text-xs font-normal text-amber-400/80">records</span>
              </div>
              <p className="text-[11px] text-amber-400/70 mt-1">
                Saved permanently into Error Audit Report.
              </p>
            </div>
          </div>

          {/* Breakdown List if errors exist */}
          {archivedDiscrepancies.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Archived Error Details:</span>
              </h3>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {archivedDiscrepancies.map((disc, idx) => (
                  <div 
                    key={idx} 
                    className="bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between text-xs font-mono"
                  >
                    <div>
                      <div className="font-semibold text-slate-200">{disc.itemCode} - {disc.itemName}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2">
                        <span>Req: <strong>{disc.requiredQty}</strong></span>
                        <span>&bull;</span>
                        <span>Act: <strong>{disc.actualQty}</strong></span>
                        <span>&bull;</span>
                        <span>Diff: <strong className={disc.difference < 0 ? 'text-amber-400' : 'text-red-400'}>{disc.difference > 0 ? `+${disc.difference}` : disc.difference}</strong></span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {disc.codeStatus === 'MISMATCH' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-400 border border-red-800">
                          MISMATCH
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          disc.qtyStatus === 'SHORTAGE' 
                            ? 'bg-amber-950 text-amber-400 border border-amber-800' 
                            : 'bg-red-950 text-red-400 border border-red-800'
                        }`}>
                          {disc.qtyStatus}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAllClean && (
            <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-3 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>Perfect audit! All {totalEvaluated} items matched exact required quantities with zero errors.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-2">
          {archivedDiscrepancies.length > 0 ? (
            <button
              onClick={() => {
                onClose();
                onViewErrorReport();
              }}
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-800/50 hover:bg-amber-900/40 transition-colors"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>View Error Audit Report</span>
            </button>
          ) : <div />}

          <button
            onClick={() => {
              onClose();
              onContinueScanning();
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors shadow"
          >
            <span>Scan Next Invoice</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
