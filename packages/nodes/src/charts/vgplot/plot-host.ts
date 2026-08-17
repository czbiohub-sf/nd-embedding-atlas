/**
 * The vgplot integration seam: turns a JSON mosaic-spec plot into a live,
 * disposable DOM subtree driven by the app's `Coordinator`.
 *
 * Two things this does that vgplot's own top-level API cannot:
 *
 * 1. **Owns mark registration.** vgplot's `plot()` directive registers marks
 *    directly with its coordinator and exposes no matching release callbacks,
 *    so every remount otherwise leaks clients. We install a replacement `plot`
 *    directive through `createAPIContext({ extensions })` (extensions override
 *    vgplot's own exports), register each mark through the host seam, and retain
 *    its release callback for `dispose()`.
 * 2. **Injects pre-existing params.** `astToDOM` skips any param the spec
 *    declares whose name is already in the passed `params` map, which is the
 *    sanctioned way to hand the node's own input `Selection` to a spec. Three
 *    names are reserved:
 *      - `"table"` — `Param` holding the source table; entries say `from: "$table"`
 *      - `"scope"` — the input predicate `Selection`; entries say `filterBy: "$scope"`
 *      - `"brush"` — the interactor's target `Selection`, declared by the spec
 *        (`as: "$brush"`) and read back out of the returned `params` map
 *
 * The spec envelope deliberately carries no `data` section: `astToDOM` only
 * iterates declared data nodes, and this app's tables are already registered
 * server-side in DuckDB.
 */

import { isSelection, Param } from "@uwdata/mosaic-core";
import type { Coordinator, MosaicClient, Selection } from "@uwdata/mosaic-core";
import { Plot } from "@uwdata/mosaic-plot";
import { astToDOM, parseSpec } from "@uwdata/mosaic-spec";
import type { Plot as PlotSpec, Spec } from "@uwdata/mosaic-spec";
import { createAPIContext } from "@uwdata/vgplot";
import type { JsonValue } from "@ndea/sdk";

import { predicateToSql } from "../core/mosaic-helpers";
import type { PlotEntry } from "./spec-schema";

/** Param name carrying the source table; mark entries reference it as `$table`. */
export const TABLE_PARAM = "table";
/** Param name carrying the input predicate; mark entries filter by `$scope`. */
export const SCOPE_PARAM = "scope";
/** Param name an interactor publishes to; read back out after instantiation. */
export const BRUSH_PARAM = "brush";

export interface MountPlotOptions {
  coordinator: Coordinator;
  registerClient(client: MosaicClient): () => void;
  table: string;
  entries: readonly PlotEntry[];
  attributes: Readonly<Record<string, JsonValue>>;
  /** Seeded under the name "scope"; specs reference it as "$scope". */
  scope: Selection;
  width: number;
  height: number;
  onSelection: (sql: string | null) => void;
}

export interface MountedPlot {
  /** Detached: the caller owns parenting. */
  readonly element: HTMLElement;
  clearSelection(): void;
  dispose(): void;
}

/** A vgplot directive: every mark, interactor, legend and attribute is one. */
type PlotDirective = (plot: Plot) => void;

/** The `plot` directive's own signature: directives in, detached element out. */
type PlotFactory = (...directives: (PlotDirective | PlotDirective[])[]) => HTMLElement;

/** Params a spec may hold: our seeded values plus whatever the spec declares. */
type SpecParams = Map<string, Param<string> | Selection>;

/**
 * vgplot's `plot()`, retaining each constructed `Plot` to recover its root
 * element and each host registration callback to release its marks later.
 * Mirrors `@uwdata/vgplot/src/plot/plot.js`.
 */
function retainingPlot(
  registerClient: MountPlotOptions["registerClient"],
  retained: Plot[],
  releases: (() => void)[],
): PlotFactory {
  return function plot(...directives): HTMLElement {
    const p = new Plot();
    retained.push(p);
    directives.flat().forEach((directive) => directive(p));
    for (const mark of p.marks) releases.push(registerClient(mark));
    // Schedules the first render, needed when the plot has no marks. The
    // returned promise resolves on render, so it is deliberately not awaited;
    // the argument is the mark to mark ready, and there is none here.
    void p.update(null);
    return p.element;
  };
}

function releaseAll(releases: (() => void)[]): void {
  for (const release of releases.splice(0)) release();
}

export async function mountPlot(options: MountPlotOptions): Promise<MountedPlot> {
  const { coordinator, registerClient, table, entries, attributes, scope, width, height, onSelection } = options;

  // mosaic-spec types plot entries as a closed union of literal-tagged mark
  // interfaces; ours are schema-validated JSON that is one of those shapes at
  // runtime. `Record<string, JsonValue>` shares no declared member with that
  // nominal union, so TS rejects a single-step assertion (TS2352) and the widen
  // step is unavoidable. This is the one type boundary between persisted
  // JsonValue config and mosaic-spec's own types; `parseSpec` re-validates the
  // shape at runtime and throws on anything that is not a real entry.
  const plotEntries = [...entries] as unknown as PlotSpec["plot"];
  const spec: Spec = { plot: plotEntries, ...attributes, width, height };

  const retained: Plot[] = [];
  const releases: (() => void)[] = [];
  const api = createAPIContext({
    coordinator,
    extensions: { plot: retainingPlot(registerClient, retained, releases) },
  });
  // Built by assignment, not from an entries array: a tuple-array constructor
  // infers its value type from the first entry (`Param<string>`), which then
  // rejects the `Selection`. The annotation drives the type instead.
  const params: SpecParams = new Map();
  params.set(TABLE_PARAM, Param.value(table));
  params.set(SCOPE_PARAM, scope);

  try {
    // The returned element is the plot directive's own <div> (read off the
    // retained Plot below); the returned params map is `params`, mutated in place.
    // `astToDOM` publishes this slot as `Map<string, Param<any>>`, which is
    // narrower than its own JSDoc ("A map of predefined Params/Selections"):
    // `Param` carries a `protected _value`, so a `Selection` is not assignable
    // to `Param<any>` even though it extends `Param`. The map contents are
    // correct; only the published signature needs bridging.
    // oxlint-disable-next-line no-explicit-any -- mirrors astToDOM's published slot type.
    await astToDOM(parseSpec(spec), { api, params: params as unknown as Map<string, Param<any>> });
  } catch (cause) {
    // A half-instantiated spec may already have connected marks.
    releaseAll(releases);
    throw new Error(`vgplot spec failed to mount: ${JSON.stringify(spec)}`, { cause });
  }

  // `astToDOM` types its element as `HTMLElement | SVGSVGElement`; our root is
  // always the plot directive's own <div>, so read it off the retained Plot.
  const rootPlot = retained[0];
  if (!rootPlot) {
    releaseAll(releases);
    throw new Error(`vgplot spec produced no plot: ${JSON.stringify(spec)}`);
  }
  const element = rootPlot.element;

  const brush = params.get(BRUSH_PARAM);
  let unsubscribeBrush: (() => void) | null = null;
  if (isSelection(brush)) {
    const onBrush = (): void => {
      onSelection(predicateToSql(brush));
    };
    brush.addEventListener("value", onBrush);
    unsubscribeBrush = () => {
      brush.removeEventListener("value", onBrush);
    };
  }

  let disposed = false;
  return {
    element,
    clearSelection(): void {
      if (isSelection(brush)) brush.reset();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeBrush?.();
      unsubscribeBrush = null;
      releaseAll(releases);
      element.remove();
    },
  };
}
