/**
 * WorkspaceStore: this tab's copy of the server-owned document (`data`,
 * `layouts`, `layout`, `state`) plus its editor session. Every document write
 * goes through `commit`: named edits (`apply`, the ops agents use), coordination
 * cell writes, and adopted server documents. `WorkspaceSync` diffs
 * `snapshot()` against the server's acknowledged revision and PATCHes the
 * difference. Views ask questions (`element`, `elementPredicate`,
 * `coordination`) instead of reading the document.
 */

import { Store } from "@tanstack/store";

import { createCoordination, type CoordinationScopeCellPort } from "@/core/coordination/coordination";
import { findElement, layoutOf, type DashboardElement } from "./dashboard";
import { elementPredicate } from "./data-sources";
import { emptyWorkspaceDocument } from "./document";
import { applyDashboardEdits, withoutRemovedContributions, type DashboardEdit } from "./edits";
import type { WorkspaceDocument, WorkspaceSession } from "./types";

export class WorkspaceStore {
  /** The workspace file stem: the `<name>` in `ndea://<name>/<element-id>` references. */
  readonly name: string;
  private readonly documentStore = new Store<WorkspaceDocument>(emptyWorkspaceDocument());
  readonly coordination: CoordinationScopeCellPort = createCoordination({
    snapshot: () => this.documentStore.state,
    updateState: (mutator) => this.commit((document) => ({ ...document, state: mutator(document.state) })),
    apply: (edits) => this.apply(edits),
    subscribe: (listener) => this.subscribe(listener),
  });
  /** This tab's editor state. Never persisted, never synced. */
  readonly session = new Store<WorkspaceSession>({
    selectedElementId: null,
    fullscreen: null,
    highlightedElementIds: [],
  });

  constructor(name = "workspace") {
    this.name = name;
  }

  /** The whole document: for sync, history, and json-render's spec only. */
  snapshot(): WorkspaceDocument {
    return this.documentStore.state;
  }

  /** Fires after every document change. */
  subscribe = (listener: () => void): (() => void) => {
    const subscription = this.documentStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  /** An element of any layout (ids are unique across layouts). */
  element(id: string): DashboardElement | undefined {
    return findElement(this.documentStore.state, id);
  }

  /** What the element shows (see `elementPredicate`). */
  elementPredicate(id: string): string | null {
    return elementPredicate(this.documentStore.state, id);
  }

  /**
   * The one document write path. Removed elements take their filter
   * contributions with them (edits settle that themselves; an adopted server
   * document may not); the session drops references to them.
   */
  private commit(update: (state: WorkspaceDocument) => WorkspaceDocument): void {
    const prev = this.documentStore.state;
    const next = update(prev);
    if (next === prev) return;
    const settled = withoutRemovedContributions(prev, next);
    this.documentStore.setState(() => settled);
    const { selectedElementId, fullscreen } = this.session.state;
    const gone = (id: string | null) => id !== null && layoutOf(settled, id) !== settled.layout;
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

  /** Apply named edits (`edits.ts`, the ops agents use); throws `WorkspaceEditError` for an op that cannot apply. */
  apply(edits: readonly DashboardEdit[]): void {
    this.commit((state) => applyDashboardEdits(state, edits));
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

  highlight(ids: readonly string[]): void {
    this.patchSession({ highlightedElementIds: ids });
  }
}
