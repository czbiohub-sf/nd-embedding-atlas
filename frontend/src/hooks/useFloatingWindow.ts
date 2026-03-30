import { useState, useRef, useCallback } from "react";

export interface FloatingWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  open: boolean;
  minimized: boolean;
}

export interface FloatingWindowHandle {
  state: FloatingWindowState;
  open: () => void;
  close: () => void;
  minimize: () => void;
  restore: () => void;
  toggle: () => void;
  dragHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
  };
  resizeHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
  };
}

interface Options {
  initialWidth?: number;
  initialHeight?: number;
  initialX?: number;
  initialY?: number;
  minWidth?: number;
  minHeight?: number;
}

export function useFloatingWindow(opts: Options = {}): FloatingWindowHandle {
  const {
    initialWidth = 480,
    initialHeight = 480,
    initialX = window.innerWidth - 500,
    initialY = window.innerHeight - 560,
    minWidth = 260,
    minHeight = 200,
  } = opts;

  const [state, setState] = useState<FloatingWindowState>({
    x: initialX,
    y: initialY,
    width: initialWidth,
    height: initialHeight,
    open: false,
    minimized: false,
  });

  // Drag
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const onDragDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, originX: state.x, originY: state.y };
    },
    [state.x, state.y],
  );

  const onDragMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setState((s) => ({ ...s, x: d.originX + dx, y: d.originY + dy }));
  }, []);

  const onDragUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Resize
  const resizeRef = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);

  const onResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      e.stopPropagation();
      resizeRef.current = { startX: e.clientX, startY: e.clientY, originW: state.width, originH: state.height };
    },
    [state.width, state.height],
  );

  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dw = e.clientX - r.startX;
      const dh = e.clientY - r.startY;
      setState((s) => ({
        ...s,
        width: Math.max(minWidth, r.originW + dw),
        height: Math.max(minHeight, r.originH + dh),
      }));
    },
    [minWidth, minHeight],
  );

  const onResizeUp = useCallback(() => {
    resizeRef.current = null;
  }, []);

  return {
    state,
    open: () => setState((s) => ({ ...s, open: true, minimized: false })),
    close: () => setState((s) => ({ ...s, open: false })),
    minimize: () => setState((s) => ({ ...s, minimized: true })),
    restore: () => setState((s) => ({ ...s, minimized: false })),
    toggle: () => setState((s) => (s.open ? { ...s, open: false } : { ...s, open: true, minimized: false })),
    dragHandleProps: { onPointerDown: onDragDown, onPointerMove: onDragMove, onPointerUp: onDragUp },
    resizeHandleProps: { onPointerDown: onResizeDown, onPointerMove: onResizeMove, onPointerUp: onResizeUp },
  };
}
