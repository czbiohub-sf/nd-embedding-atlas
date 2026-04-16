import { Store } from "@tanstack/store";

interface ViewerPiPHandle {
  openFn: (() => void) | null;
}

export const viewerPiPStore = new Store<ViewerPiPHandle>({ openFn: null });

export function registerViewerPiPHandle(openFn: () => void): void {
  viewerPiPStore.setState(() => ({ openFn }));
}

export function unregisterViewerPiPHandle(): void {
  viewerPiPStore.setState(() => ({ openFn: null }));
}

/** Call from anywhere — safe no-op if PiP is not mounted. */
export function openViewerPiP(): void {
  viewerPiPStore.state.openFn?.();
}

// ── Per-dataset floating viewer handles ──────────────────────────────────────

const _datasetHandles = new Map<string, () => void>();

export function registerDatasetViewerHandle(key: string, openFn: () => void): void {
  _datasetHandles.set(key, openFn);
}

export function unregisterDatasetViewerHandle(key: string): void {
  _datasetHandles.delete(key);
}

/** Open the floating viewer for a specific dataset key. Safe no-op if not mounted. */
export function openDatasetViewerPiP(key: string): void {
  _datasetHandles.get(key)?.();
}
