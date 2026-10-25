/**
 * WorkspaceStore: this tab's copy of the server-owned document (`data`,
 * `layouts`, `layout`, `state`) plus its editor session. Every document write
 * goes through `commit`; `WorkspaceSync` diffs `snapshot()` against the
 * server's acknowledged revision and PATCHes the difference. Views ask
 * questions (`element`, `elementPredicate`, `coordination`) instead of reading
 * the document.
 */

import { Store } from "@tanstack/store";
import type { JsonValue } from "@ndea/sdk";

import {
  createCoordination,
  withoutRemovedContributions,
  type CoordinationScopeCellPort,
} from "@/core/coordination/coordination";
import {
  findElement,
  layoutOf,
  setElementProps,
  splitElement,
  swapElements,
  takenIds,
  tileProps,
  type Dashboard,
  type DashboardElement,
  type SplitSide,
} from "./dashboard";
import { elementPredicate, type DataSources } from "./data-sources";
import { emptyWorkspaceDocument } from "./document";
import { applyDashboardEdits, type DashboardEdit } from "./edits";
import type { WorkspaceDocument, WorkspaceSession } from "./types";

export class WorkspaceStore {
  /** The workspace file stem: the `<name>` in `ndea://<name>/<element-id>` references. */
  readonly name: string;
  private readonly documentStore = new Store<WorkspaceDocument>(emptyWorkspaceDocument());
  readonly coordination: CoordinationScopeCellPort = createCoordination({
    snapshot: () => this.documentStore.state,
    update: (mutator) => this.commit((state) => mutator(state) as WorkspaceDocument),
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
   * contributions with them; the session drops references to them.
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

  /** Edit the spec of the layout holding element `id`; a no-op when no layout does. */
  private setSpec(id: string, update: (spec: Dashboard, reserved: ReadonlySet<string>) => Dashboard): void {
    this.commit((state) => {
      const layout = layoutOf(state, id);
      if (layout === undefined) return state;
      const spec = update(state.layouts[layout].spec, takenIds(state));
      return { ...state, layouts: { ...state.layouts, [layout]: { ...state.layouts[layout], spec } } };
    });
  }

  /* ── dashboard edits ───────────────────────────────────────────────── */

  /** Apply named edits (`edits.ts`, the ops agents use); throws `WorkspaceEditError` for an op that cannot apply. */
  apply(edits: readonly DashboardEdit[]): void {
    this.commit((state) => applyDashboardEdits(state, edits));
  }

  setElementProps(id: string, patch: Record<string, JsonValue | undefined>): void {
    this.setSpec(id, (spec) => setElementProps(spec, id, patch));
  }

  splitElement(id: string, side: SplitSide): void {
    this.setSpec(id, (spec, reserved) => splitElement(spec, id, side, reserved)[0]);
  }

  /** Fill a slot with a fresh component at its defaults, bound to filter A and focus A when it can bind them. */
  fillSlot(slotId: string, type: string): void {
    this.apply([{ op: "add", type, props: tileProps(type), at: { slot: slotId } }]);
  }

  removeElement(id: string): void {
    this.apply([{ op: "remove", id }]);
  }

  swapElements(a: string, b: string): void {
    this.setSpec(a, (spec) => swapElements(spec, a, b));
  }

  setSplitRatio(id: string, ratio: number): void {
    this.setElementProps(id, { ratio });
  }

  /* ── data sources ──────────────────────────────────────────────────── */

  setDataSource(name: string, source: DataSources[string]): void {
    this.apply([{ op: "set_data", name, source }]);
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
