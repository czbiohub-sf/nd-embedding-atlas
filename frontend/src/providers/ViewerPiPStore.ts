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
