import { useRef, useState } from "react";
import { useDrag } from "./useDrag";

export type ResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

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
    getResizeProps: (edge: ResizeEdge) => {
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

type ResizeOrigin = Record<string, number> & {
    originX: number;
    originY: number;
    originW: number;
    originH: number;
};

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

    // Which edge is being dragged — set before useDrag fires onMove
    const activeEdgeRef = useRef<ResizeEdge>("se");

    const drag = useDrag<{ originX: number; originY: number }>({
        onMove: (dx, dy, origin) =>
            setState((s) => ({ ...s, x: origin.originX + dx, y: origin.originY + dy })),
        skipInteractive: true,
    });

    const resize = useDrag<ResizeOrigin>({
        onMove: (dx, dy, origin) => {
            const edge = activeEdgeRef.current;
            setState((s) => {
                let { x, y, width, height } = s;

                if (edge.includes("e")) {
                    width = Math.max(minWidth, origin.originW + dx);
                }
                if (edge.includes("w")) {
                    const w = Math.max(minWidth, origin.originW - dx);
                    x = origin.originX + origin.originW - w;
                    width = w;
                }
                if (edge.includes("s")) {
                    height = Math.max(minHeight, origin.originH + dy);
                }
                if (edge.includes("n")) {
                    const h = Math.max(minHeight, origin.originH - dy);
                    y = origin.originY + origin.originH - h;
                    height = h;
                }

                return { ...s, x, y, width, height };
            });
        },
    });

    return {
        state,
        open: () => setState((s) => ({ ...s, open: true, minimized: false })),
        close: () => setState((s) => ({ ...s, open: false })),
        minimize: () => setState((s) => ({ ...s, minimized: true })),
        restore: () => setState((s) => ({ ...s, minimized: false })),
        toggle: () =>
            setState((s) =>
                s.open ? { ...s, open: false } : { ...s, open: true, minimized: false },
            ),
        dragHandleProps: {
            onPointerDown: (e) => drag.start(e, { originX: state.x, originY: state.y }),
        },
        getResizeProps: (edge) => ({
            onPointerDown: (e) => {
                activeEdgeRef.current = edge;
                resize.start(e, {
                    originX: state.x,
                    originY: state.y,
                    originW: state.width,
                    originH: state.height,
                });
            },
        }),
    };
}
