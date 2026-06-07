/**
 * PluginHost — the one curated context object handed to each plugin instance
 * (PLUGIN-ARCHITECTURE §4.3, §5). Modeled on Pi's `ExtensionContext`: one host
 * object per concern, read/mutate split. Live objects (`Coordinator`,
 * `Selection`) pass by reference (Grafana in-process model); serializable state
 * lives in `config` (`JsonValue`-bound).
 *
 * Phase 0: types only. Concrete hosts are built by `useDashboardHostShim` over
 * today's stores/buses; nothing consumes a host yet.
 */

import type { Coordinator, MosaicClient, Selection } from "@uwdata/mosaic-core";
import type { Metadata } from "@/types";
import type { DeviceLease } from "@/core/gpu/device-broker";
import type { MountReason, PluginCapability, PluginMeta } from "./types";

/** Branded instance id — also the clause-source key for the SelectionBus (§6.3). */
export type PluginInstanceId = string & { readonly __brand: "PluginInstanceId" };

export function asInstanceId(s: string): PluginInstanceId {
  return s as PluginInstanceId;
}

// ── DATA (read) ──────────────────────────────────────────────────────────────

export interface DataContext {
  readonly coordinator: Coordinator;
  readonly table: string;
  readonly metadata: Metadata;
}

/**
 * Server token for a namespaced temp-table-backed predicate (§6.5). The canonical
 * payload an xyflow edge carries (Phase 5). Built by `SelectionBus.makeToken` so
 * plugins never invent the cache-buster comment.
 */
export interface SelectionToken {
  /** SQL predicate referencing `sel_<id>`, carrying the bus's `tok=N` SQL-comment cache-buster. */
  readonly predicate: string;
  /** Monotonic cache-buster value (the `tok=N` source). */
  readonly token: number;
  /** Selected row count. */
  readonly count: number;
  /** Instance-namespaced temp-table name (`sel_<id>`). */
  readonly table: string;
}

/**
 * Capability-gated data API (§6.5). Ungranted methods are `undefined` at
 * construction — a real ergonomic guardrail (a chart instance has no
 * `categorize`); the hard boundary is the Oxlint rule banning `/api/*` literals
 * from `plugins/**` (§7.6).
 */
export interface DataApi {
  /** "read" — every plugin. */
  query<T = unknown>(sql: string, signal?: AbortSignal): Promise<T>;
  /** "selection-out" — instance-scoped; NO fixed `__scatter_selection` (§6.5). */
  publishSelection?(rowIds: number[]): Promise<SelectionToken>;
  disposeSelection?(): void;
  /** "schema-mutate" (scatter only). */
  categorize?(col: string, max?: number): Promise<unknown>;
  loadVarColumn?(name: string, layer?: string): Promise<unknown>;
  /** "spatial" (viewer, gallery). */
  fetchCrop?(params: unknown): Promise<Blob>;
}

// ── Cross-view facets (mapped onto buses) ──────────────────────────────────────

export interface ViewSyncApi {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly linked: boolean;
  broadcast(state: { panX: number; panY: number; zoom: number }): void;
  toggleLock(): void;
}

export interface HighlightApi {
  get(): string | null;
  set(id: string | null): void;
}

export interface RenderApi {
  readonly pointRadius: number;
  setPointRadius(r: number): void;
}

// ── UI surface (Pi ctx.ui — always browser; §4.3) ─────────────────────────────

/**
 * Container abstraction across all four mount surfaces (docked / slide / float /
 * pip — later xyflow node). `panelApi` is the container-native handle (e.g. a
 * Dockview `DockviewPanelApi`); it is typed `unknown` so core stays decoupled
 * from any one layout library, and the owning plugin casts it.
 */
export interface PanelContext {
  readonly id: string;
  readonly title?: string;
  readonly panelApi?: unknown;
  close?(): void;
}

export interface UiApi {
  readonly container: PanelContext;
  notify(msg: string, level?: "info" | "warn" | "error"): void;
}

// ── Options (deferred editor — decision #3) ────────────────────────────────────

/**
 * Typed options builder (Grafana-style). Phase 0/2 ship the options *object*;
 * the generated editor lands Phase 3+. Kept minimal so the type exists now.
 */
export interface OptionsBuilder<Options> {
  defaults(o: Options): void;
}

// ── The host ───────────────────────────────────────────────────────────────────

export interface PluginHost<Config = unknown, Options = unknown> {
  /** Branded; also the clause-source key. */
  readonly instanceId: PluginInstanceId;
  readonly meta: PluginMeta;
  readonly reason: MountReason;

  /** What the instance is allowed to do — mirrors `meta.capabilities`. */
  readonly capabilities: ReadonlySet<PluginCapability>;

  // ── DATA (read) ──
  readonly data: DataContext;
  /** Official Mosaic client lifecycle — auto-unregistered on dispose (§6.1). */
  registerClient(client: MosaicClient): () => void;

  // ── Selection IN ──
  /** Stable identity for the instance's lifetime; bus migrates contents (§6.1). */
  readonly inputSelection: Selection;
  /** Upstream / cross-panel row-set (selection-in), or null. */
  externalRowSet(): readonly number[] | null;
  /**
   * Subscribe to external (non-self) cross-panel row-set changes; `rowIds` is
   * null on clear/empty. Returns an unsubscribe. The selection-IN counterpart to
   * `publishRowSet`/`clearRowSet` (§6.7); broadcast/last-write-wins, not an edge.
   */
  onExternalRowSet(cb: (rowIds: readonly number[] | null) => void): () => void;

  // ── Selection OUT (selection-out capability) ──
  /** Publish one of the instance's predicate facets; null clears it. */
  publishPredicate(facet: string, sql: string | null): void;
  /** GPU dim-mask broadcast (selection-out + wasm-bitmap). */
  publishRowSet(ids: number[]): void;
  /**
   * Clear this instance's row-set broadcast — a TRUE clear (downstream sees
   * "empty"), distinct from `publishRowSet([])` which would broadcast an empty
   * "active" set. Use on lasso/selection clear.
   */
  clearRowSet(): void;

  // ── Cross-view ──
  readonly viewSync: ViewSyncApi;
  readonly highlight: HighlightApi;
  readonly render: RenderApi;

  // ── UI surface ──
  readonly ui: UiApi;

  // ── Resources ──
  /** GPU device lease via the core DeviceBroker (gpu capability). */
  acquireDeviceLease(): Promise<DeviceLease>;
  readonly api: DataApi;

  // ── Config (serializable) + Options (typed render options) ──
  readonly config: Config;
  patchConfig(patch: Partial<Config>): void;
  /** Resolved typed options for this instance (Grafana-style; editor deferred — decision #3). */
  readonly options: Options;

  // ── Lifecycle ──
  /** Runs exactly once on instance teardown. */
  onDispose(fn: () => void): void;
  /** Register an unsubscribe to be called on dispose. */
  track(unsubscribe: () => void): void;
  /** Aborted on instance teardown — thread into async init + device acquire. */
  readonly signal: AbortSignal;
}
