import { useState } from "react";
import { useDrag } from "./useDrag";

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
  };
  resizeHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
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

  const drag = useDrag<{ originX: number; originY: number }>({
    onMove: (dx, dy, origin) => setState((s) => ({ ...s, x: origin.originX + dx, y: origin.originY + dy })),
    skipInteractive: true,
  });

  const resize = useDrag<{ originW: number; originH: number }>({
    onMove: (dx, dy, origin) =>
      setState((s) => ({
        ...s,
        width: Math.max(minWidth, origin.originW + dx),
        height: Math.max(minHeight, origin.originH + dy),
      })),
  });

  return {
    state,
    open: () => setState((s) => ({ ...s, open: true, minimized: false })),
    close: () => setState((s) => ({ ...s, open: false })),
    minimize: () => setState((s) => ({ ...s, minimized: true })),
    restore: () => setState((s) => ({ ...s, minimized: false })),
    toggle: () => setState((s) => (s.open ? { ...s, open: false } : { ...s, open: true, minimized: false })),
    dragHandleProps: {
      onPointerDown: (e) => drag.start(e, { originX: state.x, originY: state.y }),
    },
    resizeHandleProps: {
      onPointerDown: (e) => resize.start(e, { originW: state.width, originH: state.height }),
    },
  };
}
