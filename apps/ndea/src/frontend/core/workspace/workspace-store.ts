/**
 * WorkspaceStore: this tab's copy of the server-owned document (`data`, `spec`,
 * `state`) plus its editor session. Every document write goes through
 * `commit`; `WorkspaceSync` diffs `snapshot()` against the server's
 * acknowledged revision and PATCHes the difference. Views ask questions
 * (`element`, `elementPredicate`, `coordination`) instead of reading the document.
 */

import { Store } from "@tanstack/store";
import type { JsonValue } from "@ndea/sdk";

import {
  createCoordination,
  withoutRemovedContributions,
  type CoordinationScopeCellPort,
} from "@/core/coordination/coordination";
import {
  COMPONENTS,
  fillSlot,
  removeElement,
  setElementProps,
  splitElement,
  swapElements,
  type Dashboard,
  type DashboardElement,
  type SplitSide,
} from "./dashboard";
import { elementPredicate } from "./data-sources";
import { emptyWorkspaceDocument } from "./document";
import type { WorkspaceDocument, WorkspaceSession } from "./types";

export class WorkspaceStore {
  private readonly documentStore = new Store<WorkspaceDocument>(emptyWorkspaceDocument());
  readonly coordination: CoordinationScopeCellPort = createCoordination({
    snapshot: () => this.documentStore.state,
    update: (mutator) => this.commit((state) => mutator(state) as WorkspaceDocument),
    subscribe: (listener) => this.subscribe(listener),
  });
  /** This tab's editor state. Never persisted, never synced. */
  readonly session = new Store<WorkspaceSession>({ selectedElementId: null, fullscreen: null });

  /** The whole document: for sync, history, and json-render's spec only. */
  snapshot(): WorkspaceDocument {
    return this.documentStore.state;
  }

  /** Fires after every document change. */
  subscribe = (listener: () => void): (() => void) => {
    const subscription = this.documentStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  element(id: string): DashboardElement | undefined {
    return this.documentStore.state.spec.elements[id];
  }

  /** What the element shows (see `elementPredicate`). */
  elementPredicate(id: string): string | null {
    return elementPredicate(this.documentStore.state, id);
  }

  /**
   * The one document write path. Removed elements take their filter
   * contributions with them; the session drops references to them.
   */
  private commit(update: (state: WorkspaceDocument) => WorkspaceDocument): void {
    const prev = this.documentStore.state;
    const next = update(prev);
    if (next === prev) return;
    const settled = withoutRemovedContributions(prev, next);
    this.documentStore.setState(() => settled);
    const { selectedElementId, fullscreen } = this.session.state;
    const gone = (id: string | null) => id !== null && !settled.spec.elements[id];
    if (gone(selectedElementId) || gone(fullscreen)) {
      this.patchSession({
        selectedElementId: gone(selectedElementId) ? null : selectedElementId,
        fullscreen: gone(fullscreen) ? null : fullscreen,
      });
    }
  }

  /** Adopt a validated server document (initial load, remote or rebased revision). */
  applyDocument(next: WorkspaceDocument): void {
    this.commit(() => next);
  }

  private setSpec(update: (spec: Dashboard) => Dashboard): void {
    this.commit((state) => ({ ...state, spec: update(state.spec) }));
  }

  /* ── dashboard edits ───────────────────────────────────────────────── */

  setElementProps(id: string, patch: Record<string, JsonValue | undefined>): void {
    this.setSpec((spec) => setElementProps(spec, id, patch));
  }

  splitElement(id: string, side: SplitSide): void {
    this.setSpec((spec) => splitElement(spec, id, side)[0]);
  }

  /** Fill a slot with a fresh component at its defaults. */
  fillSlot(slotId: string, type: string): void {
    const props: Record<string, JsonValue> = {};
    if (COMPONENTS[type]?.binds.includes("filter")) props.filter = { $bindState: "/filter/A" };
    if (COMPONENTS[type]?.binds.includes("focus")) props.focus = { $bindState: "/focus/A" };
    this.commit((state) => ({
      ...state,
      spec: fillSlot(state.spec, slotId, type, props),
      // A new member's scopes exist from the start.
      state: {
        ...state.state,
        ...("filter" in props && !state.state.filter?.A ? { filter: { ...state.state.filter, A: {} } } : {}),
        ...("focus" in props && state.state.focus?.A === undefined ? { focus: { ...state.state.focus, A: null } } : {}),
      },
    }));
  }

  removeElement(id: string): void {
    this.setSpec((spec) => removeElement(spec, id));
  }

  swapElements(a: string, b: string): void {
    this.setSpec((spec) => swapElements(spec, a, b));
  }

  setSplitRatio(id: string, ratio: number): void {
    this.setElementProps(id, { ratio });
  }

  /* ── session ───────────────────────────────────────────────────────── */

  private patchSession(patch: Partial<WorkspaceSession>): void {
    this.session.setState((state) => ({ ...state, ...patch }));
  }

  selectElement(id: string | null): void {
    if (this.session.state.selectedElementId !== id) this.patchSession({ selectedElementId: id });
  }

  setFullscreen(id: string | null): void {
    this.patchSession({ fullscreen: id });
  }
}
