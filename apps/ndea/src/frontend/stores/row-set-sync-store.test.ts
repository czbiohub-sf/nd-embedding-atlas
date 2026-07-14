import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rowIndex } from "@ndea/sdk";
import { panelId } from "@/lib/branded-types";
import { disposeBitmap, getBitmapRowIndices } from "./roaring-broadcast-store";
import { externalSource, panelSource, sourceKey, sourcesEqual } from "./row-set-source";
import { broadcastRowSet, clearRowSetSync, rowSetSyncStore } from "./row-set-sync-store";

const PANEL_SOURCE = panelSource(panelId("panel-a"));
const EXTERNAL_SOURCE = externalSource("external-a");

beforeEach(() => clearRowSetSync());
afterEach(() => {
  clearRowSetSync();
  disposeBitmap(PANEL_SOURCE);
  disposeBitmap(EXTERNAL_SOURCE);
});

describe("row-set synchronization store", () => {
  test("tracks source and revision while row indices remain bitmap-backed", () => {
    broadcastRowSet(PANEL_SOURCE, [rowIndex(2), rowIndex(5)]);

    expect(rowSetSyncStore.state).toEqual({ type: "active", source: PANEL_SOURCE, version: 1 });
    expect(getBitmapRowIndices(PANEL_SOURCE)).toEqual([rowIndex(2), rowIndex(5)]);

    broadcastRowSet(PANEL_SOURCE, []);
    expect(rowSetSyncStore.state).toEqual({ type: "active", source: PANEL_SOURCE, version: 2 });
    expect(getBitmapRowIndices(PANEL_SOURCE)).toEqual([]);

    clearRowSetSync(PANEL_SOURCE);
    expect(rowSetSyncStore.state).toEqual({ type: "empty", source: PANEL_SOURCE });
  });

  test("keeps panel and external source identities distinct", () => {
    expect(sourceKey(PANEL_SOURCE)).toBe("p:panel-a");
    expect(sourceKey(EXTERNAL_SOURCE)).toBe("e:external-a");
    expect(sourcesEqual(PANEL_SOURCE, panelSource(panelId("panel-a")))).toBeTrue();
    expect(sourcesEqual(PANEL_SOURCE, EXTERNAL_SOURCE)).toBeFalse();
  });
});
