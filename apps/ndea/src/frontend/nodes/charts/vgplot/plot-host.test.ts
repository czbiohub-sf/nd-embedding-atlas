/**
 * plot-host seam tests, entirely in-process. A `Coordinator` subclass records
 * `connect`/`disconnect` instead of wiring real clients, so no query is ever
 * queued and its connector is never reached. A tiny object stands in for the
 * `<div>` that `mosaic-plot`'s `Plot` allocates, and captured animation frames
 * are never invoked, so nothing renders: no network, no database, no WebGPU.
 */

import { describe, expect, test } from "bun:test";
import { clausePoint, Coordinator, Selection, SocketConnector } from "@uwdata/mosaic-core";
import type { MosaicClient } from "@uwdata/mosaic-core";
import type { Mark } from "@uwdata/mosaic-plot";
import { column } from "@uwdata/mosaic-sql";

import { mountPlot } from "./plot-host";
import type { PlotEntry } from "./spec-schema";

interface FakeElement {
  removeCalls: number;
  attributes: Record<string, string>;
  style: Record<string, string>;
  remove(): void;
  setAttribute(name: string, value: string): void;
}

/** Every element `Plot` allocates, newest last. One per mounted plot. */
const createdElements: FakeElement[] = [];

function createFakeElement(): FakeElement {
  const element: FakeElement = {
    removeCalls: 0,
    attributes: {},
    style: {},
    remove() {
      this.removeCalls += 1;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  createdElements.push(element);
  return element;
}

const frames: (() => void)[] = [];

// `Object.assign` fails here: the test runner installs at least one of these as
// a readonly global, and a plain assignment throws. `defineProperty` replaces a
// readonly-but-configurable property, which is what we need.
const domStubs: Record<string, unknown> = {
  document: { createElement: createFakeElement },
  requestAnimationFrame: (callback: () => void) => frames.push(callback),
};
for (const [key, value] of Object.entries(domStubs)) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

/** Records client wiring; never reaches the query manager. */
class RecordingCoordinator extends Coordinator {
  readonly connected: MosaicClient[] = [];
  readonly disconnected: MosaicClient[] = [];

  connect(client: MosaicClient): void {
    this.connected.push(client);
  }

  disconnect(client: MosaicClient): void {
    this.disconnected.push(client);
  }
}

function createCoordinator(): RecordingCoordinator {
  // SocketConnector's constructor only assigns fields; no socket is opened, and
  // `connect` is overridden so no query is ever queued.
  return new RecordingCoordinator(new SocketConnector(), { logger: null });
}

/** The shape `buildEntries("histogram", "value")` produces. */
function histogramMark(): PlotEntry {
  return {
    mark: "rectY",
    data: { from: "$table", filterBy: "$scope" },
    x: { bin: "value" },
    y: { count: [] },
  };
}

interface Mounted {
  coordinator: RecordingCoordinator;
  associated: MosaicClient[];
  disassociated: MosaicClient[];
  scope: Selection;
  element: FakeElement;
  clearSelection: () => void;
  dispose: () => void;
  selections: (string | null)[];
}

async function mount(entries: PlotEntry[]): Promise<Mounted> {
  const coordinator = createCoordinator();
  const associated: MosaicClient[] = [];
  const disassociated: MosaicClient[] = [];
  const scope = Selection.intersect();
  const selections: (string | null)[] = [];
  const before = createdElements.length;
  const mounted = await mountPlot({
    coordinator,
    registerClient: (client) => {
      associated.push(client);
      coordinator.connect(client);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        disassociated.push(client);
        coordinator.disconnect(client);
      };
    },
    table: "dataset",
    entries,
    attributes: { marginLeft: 30 },
    scope,
    width: 240,
    height: 120,
    onSelection: (sql) => selections.push(sql),
  });
  // `Plot`'s constructor is the only caller of `document.createElement`, so the
  // element it allocated for this mount is the one appended during the await.
  const created = createdElements.slice(before);
  expect(created).toHaveLength(1);
  return {
    coordinator,
    associated,
    disassociated,
    scope,
    element: created[0],
    clearSelection: () => mounted.clearSelection(),
    dispose: () => mounted.dispose(),
    selections,
  };
}

describe("mountPlot", () => {
  test("registers each mark once and releases exactly those marks on dispose", async () => {
    const { coordinator, associated, disassociated, dispose } = await mount([histogramMark()]);

    expect(coordinator.connected).toHaveLength(1);
    expect(associated).toEqual(coordinator.connected);
    expect((coordinator.connected[0] as Mark).type).toBe("rectY");
    expect(coordinator.disconnected).toHaveLength(0);

    dispose();

    expect(coordinator.disconnected).toHaveLength(1);
    expect(disassociated).toEqual(coordinator.disconnected);
    expect(coordinator.disconnected[0]).toBe(coordinator.connected[0]);
  });

  test("dispose is idempotent: one disconnect, one element removal", async () => {
    const { coordinator, dispose, element } = await mount([histogramMark()]);

    dispose();
    dispose();
    dispose();

    expect(coordinator.disconnected).toHaveLength(1);
    expect(element.removeCalls).toBe(1);
  });

  test("the seeded scope Selection and table Param survive astToDOM", async () => {
    const { coordinator, scope } = await mount([histogramMark()]);

    const mark = coordinator.connected[0] as Mark;
    // astToDOM skips params already present in the map it is handed, so the
    // mark must filter by the very Selection instance we injected.
    expect(mark.filterBy).toBe(scope);
    expect(mark.sourceTable()).toBe("dataset");
  });

  test("stable scope updates do not recreate or re-register marks", async () => {
    const { coordinator, associated, scope } = await mount([histogramMark()]);
    const mark = coordinator.connected[0] as Mark;

    scope.update(clausePoint(column("peer"), 7, { source: {} }));

    expect(mark.filterBy).toBe(scope);
    expect(coordinator.connected).toEqual([mark]);
    expect(associated).toEqual([mark]);
  });

  test("a brush Selection declared by an interactor drives onSelection", async () => {
    const { coordinator, selections, clearSelection } = await mount([
      histogramMark(),
      { select: "intervalX", as: "$brush", field: "value" },
    ]);

    const mark = coordinator.connected[0] as Mark;
    const plot = mark.plot as { interactors: { selection: Selection }[] };
    const brush = plot.interactors[0].selection;

    brush.update(clausePoint(column("value"), 3, { source: {} }));
    expect(selections).toHaveLength(1);
    expect(selections[0]).toContain("value");

    // `AsyncDispatch.emit` marks the channel pending for the duration of the
    // first broadcast, so a second update in the same tick is ENQUEUED rather
    // than dispatched, landing only once that pending promise settles. Await
    // the dispatcher's own signal; this is queueing, not a dropped event.
    clearSelection();
    await brush.pending("value");
    expect(selections).toHaveLength(2);
    expect(selections[1]).toBeNull();
  });

  test("a mark with no interactor leaves onSelection untouched", async () => {
    const { selections } = await mount([histogramMark()]);

    expect(selections).toEqual([]);
  });

  test("a malformed spec rejects and leaks no connected marks", async () => {
    const coordinator = createCoordinator();

    const promise = mountPlot({
      coordinator,
      registerClient: (client) => {
        coordinator.connect(client);
        return () => coordinator.disconnect(client);
      },
      table: "dataset",
      entries: [{ mark: "notAMarkType" }],
      attributes: {},
      scope: Selection.intersect(),
      width: 240,
      height: 120,
      onSelection: () => {},
    });

    await expect(promise).rejects.toThrow(/vgplot spec failed to mount/);
    expect(coordinator.connected).toHaveLength(0);
  });

  test("a registration error releases every mark registered before the failure", async () => {
    const coordinator = createCoordinator();
    let registrations = 0;

    const promise = mountPlot({
      coordinator,
      registerClient: (client) => {
        registrations += 1;
        if (registrations === 2) throw new Error("connect failed");
        coordinator.connect(client);
        return () => coordinator.disconnect(client);
      },
      table: "dataset",
      entries: [histogramMark(), histogramMark()],
      attributes: {},
      scope: Selection.intersect(),
      width: 240,
      height: 120,
      onSelection: () => {},
    });

    await expect(promise).rejects.toThrow(/vgplot spec failed to mount/);
    expect(coordinator.connected).toHaveLength(1);
    expect(coordinator.disconnected).toEqual(coordinator.connected);
  });
});
