import { useEffect, useRef, useState, useCallback } from 'react';

export interface BarcodeScanEvent {
  barcode: string;
  timestamp: number;
  isFastWedge: boolean; // whether it arrived via ultra-fast scanner cadence
}

interface UseScannerListenerOptions {
  onScan: (barcode: string, isFastWedge: boolean) => void;
  minLength?: number;
  maxKeystrokeIntervalMs?: number; // threshold in ms to distinguish hardware scanner from slow human typing
  enabled?: boolean;
}

export function useScannerListener({
  onScan,
  minLength = 2,
  maxKeystrokeIntervalMs = 80,
  enabled = true,
}: UseScannerListenerOptions) {
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [lastScanTimestamp, setLastScanTimestamp] = useState<number | null>(null);
  const [isScannerActive, setIsScannerActive] = useState<boolean>(false);

  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const fastKeyCountRef = useRef<number>(0);
  const totalKeyCountRef = useRef<number>(0);
  const clearTimerRef = useRef<number | null>(null);

  const handleScanTrigger = useCallback((scannedCode: string, isFast: boolean) => {
    const clean = scannedCode.trim();
    if (clean.length >= minLength) {
      setLastScannedBarcode(clean);
      setLastScanTimestamp(Date.now());
      setIsScannerActive(true);
      onScan(clean, isFast);
    }
  }, [minLength, onScan]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow Escape key to clear buffer
      if (e.key === 'Escape') {
        bufferRef.current = '';
        fastKeyCountRef.current = 0;
        totalKeyCountRef.current = 0;
        return;
      }

      // Ignore modifier keys
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        return;
      }

      // Check if user is typing into a standard search/form input (unless it's our scanner designated input)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const isScannerDedicatedInput = target.getAttribute('data-scanner-input') === 'true';

      // If user is typing in a non-scanner input, only intercept if it's super-fast barcode wedge speed (< 40ms)
      const currentTime = Date.now();
      const interval = currentTime - lastKeyTimeRef.current;
      lastKeyTimeRef.current = currentTime;

      // Detect Enter key = scanner transmission terminator
      if (e.key === 'Enter') {
        const currentBuffer = bufferRef.current;
        const total = totalKeyCountRef.current;
        const fast = fastKeyCountRef.current;
        const isFastWedge = total > 0 && (fast / total) > 0.6;

        bufferRef.current = '';
        fastKeyCountRef.current = 0;
        totalKeyCountRef.current = 0;

        if (clearTimerRef.current) {
          window.clearTimeout(clearTimerRef.current);
          clearTimerRef.current = null;
        }

        // If focused in dedicated scanner input in ActiveAuditScreen, let the form onSubmit handle it directly
        if (isScannerDedicatedInput) {
          return;
        }

        if (currentBuffer.trim().length >= minLength) {
          // If scanner scanned into an unrelated input, prevent newline
          if (isInput) {
            e.preventDefault();
          }
          handleScanTrigger(currentBuffer, isFastWedge);
        }
        return;
      }

      // If regular printable character
      if (e.key.length === 1) {
        totalKeyCountRef.current += 1;
        if (interval <= maxKeystrokeIntervalMs && interval > 0) {
          fastKeyCountRef.current += 1;
        }

        bufferRef.current += e.key;

        // Auto-clear buffer if user pauses for more than 500ms (to prevent stale accidental typing)
        if (clearTimerRef.current) {
          window.clearTimeout(clearTimerRef.current);
        }
        clearTimerRef.current = window.setTimeout(() => {
          bufferRef.current = '';
          fastKeyCountRef.current = 0;
          totalKeyCountRef.current = 0;
        }, 600);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, [enabled, handleScanTrigger, maxKeystrokeIntervalMs, minLength]);

  return {
    lastScannedBarcode,
    lastScanTimestamp,
    isScannerActive,
    manualScan: (code: string) => handleScanTrigger(code, false),
  };
}
