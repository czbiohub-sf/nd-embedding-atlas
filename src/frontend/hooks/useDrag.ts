/**
 * useDrag — unified pointer-capture drag with window-listener pattern.
 *
 * Replaces three independent drag implementations:
 *  - useFloatingWindow (drag + resize)
 *  - ContinuousLegend (range handle drag)
 *
 * useScatterInteraction is intentionally NOT migrated — it is an imperative
 * controller that requires direct canvas pointer handling.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Minimum pointer travel (px) before onMove fires. Export for sharing. */
export const DRAG_THRESHOLD_PX = 4;

/** Tags that should never initiate a drag even without data-no-drag. */
const INTERACTIVE_TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"]);

function shouldAbortDrag(target: EventTarget | null, boundary: Element, skipInteractive: boolean): boolean {
  let node = target as Element | null;
  while (node && node !== boundary) {
    if (node.hasAttribute("data-no-drag")) return true;
    if (skipInteractive && INTERACTIVE_TAGS.has(node.tagName)) return true;
    node = node.parentElement;
  }
  return false;
}

export interface UseDragOptions<O extends Record<string, number>> {
  onMove: (dx: number, dy: number, origin: O) => void;
  onEnd?: () => void;
  threshold?: number;
  /**
   * If true (default), abort drag when pointerdown target is a native
   * interactive element (button, a, input, select, textarea).
   * Eliminates per-button onPointerDown stopPropagation annotations.
   */
  skipInteractive?: boolean;
}

export interface UseDragHandle<O extends Record<string, number>> {
  start: (e: React.PointerEvent, origin: O) => void;
  isDragging: boolean;
}

interface DragSession<O extends Record<string, number>> {
  startX: number;
  startY: number;
  origin: O;
  captureTarget: Element | null;
  thresholdPassed: boolean;
}

export function useDrag<O extends Record<string, number>>(options: UseDragOptions<O>): UseDragHandle<O> {
  const { threshold = 0, skipInteractive = false } = options;

  // Keep latest callbacks in refs so callers don't need useCallback
  const onMoveRef = useRef(options.onMove);
  const onEndRef = useRef(options.onEnd);
  useLayoutEffect(() => {
    onMoveRef.current = options.onMove;
    onEndRef.current = options.onEnd;
  });

  const sessionRef = useRef<DragSession<O> | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      const dx = e.clientX - session.startX;
      const dy = e.clientY - session.startY;
      if (!session.thresholdPassed) {
        if (Math.hypot(dx, dy) < threshold) return;
        session.thresholdPassed = true;
      }
      onMoveRef.current(dx, dy, session.origin);
    },
    [threshold],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const onUp = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.captureTarget?.isConnected) {
      try {
        (
          session.captureTarget as Element & {
            releasePointerCapture?: (id: number) => void;
          }
        ).releasePointerCapture?.(0);
      } catch {}
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    sessionRef.current = null;
    setIsDragging(false);
    onEndRef.current?.();
  }, [onMove]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      sessionRef.current = null;
    };
  }, [onMove, onUp]);

  const start = useCallback(
    (e: React.PointerEvent, origin: O) => {
      const boundary = e.currentTarget as Element;
      if (shouldAbortDrag(e.target, boundary, skipInteractive)) return;

      try {
        (e.currentTarget as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(e.pointerId);
      } catch {}

      sessionRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origin,
        captureTarget: e.currentTarget as Element,
        thresholdPassed: threshold === 0,
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      setIsDragging(true);
    },
    [skipInteractive, threshold, onMove, onUp],
  );

  return { start, isDragging };
}
