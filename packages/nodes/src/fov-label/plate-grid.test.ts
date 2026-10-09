import { describe, expect, test } from "bun:test";
import { decodePlateGrid, looksGridCoded, splitFovName } from "./plate-grid";

/** The real shape: 3 wells x 7x7 grid-coded fields (h2bc21 bf_midslice). */
const gridCoded = ["B/3", "B/4", "B/5"].flatMap((well) =>
  Array.from({ length: 7 }, (_row, r) =>
    Array.from({ length: 7 }, (_col, c) => `${well}/${String(r * 1000 + c).padStart(6, "0")}`),
  ).flat(),
);

describe("splitFovName", () => {
  test("splits well from field", () => {
    expect(splitFovName("B/3/000000")).toEqual({ well: "B/3", field: "000000" });
  });

  test("rejects values with no field segment", () => {
    for (const bad of ["", "B3", "/000000", "B/3/"]) expect(splitFovName(bad)).toBeNull();
  });
});

describe("looksGridCoded", () => {
  test("RRRCCC field ids span several decoded rows", () => {
    expect(looksGridCoded(["000000", "000006", "001000", "006006"])).toBe(true);
  });

  test("dense acquisition-order ids do not", () => {
    // The online pre-scan stores number fields 0000..0048; every one decodes to row 0.
    expect(looksGridCoded(Array.from({ length: 49 }, (_, i) => String(i).padStart(4, "0")))).toBe(false);
  });

  test("empty and non-numeric inputs are not grid codes", () => {
    expect(looksGridCoded([])).toBe(false);
    expect(looksGridCoded(["abc", "def"])).toBe(false);
  });
});

describe("decodePlateGrid", () => {
  test("recovers 3 wells of 7x7 from real-shaped field ids", () => {
    const grid = decodePlateGrid(gridCoded);
    expect(grid.layout).toBe("grid-code");
    expect(grid.wells.map((w) => w.well)).toEqual(["B/3", "B/4", "B/5"]);
    for (const well of grid.wells) {
      expect({ rows: well.rows, cols: well.cols, n: well.cells.length }).toEqual({ rows: 7, cols: 7, n: 49 });
    }
  });

  test("places each FOV at its decoded position, row-major", () => {
    const [b3] = decodePlateGrid(gridCoded).wells;
    expect(b3.cells[0]).toEqual({ fovName: "B/3/000000", well: "B/3", row: 0, col: 0 });
    expect(b3.cells[7]).toEqual({ fovName: "B/3/001000", well: "B/3", row: 1, col: 0 });
    expect(b3.cells.at(-1)).toEqual({ fovName: "B/3/006006", well: "B/3", row: 6, col: 6 });
  });

  test("derives extents from the data, so a 9x9 dataset is not squeezed into 7x7", () => {
    const nine = Array.from({ length: 9 }, (_row, r) =>
      Array.from({ length: 9 }, (_col, c) => `B/3/${String(r * 1000 + c).padStart(6, "0")}`),
    ).flat();
    const [well] = decodePlateGrid(nine).wells;
    expect({ rows: well.rows, cols: well.cols }).toEqual({ rows: 9, cols: 9 });
  });

  test("keeps holes when an acquisition is partial", () => {
    const partial = ["B/3/000000", "B/3/000002", "B/3/002000"];
    const [well] = decodePlateGrid(partial).wells;
    expect({ rows: well.rows, cols: well.cols, n: well.cells.length }).toEqual({ rows: 3, cols: 3, n: 3 });
    expect(well.cells.map((c) => [c.row, c.col])).toEqual([
      [0, 0],
      [0, 2],
      [2, 0],
    ]);
  });

  test("falls back to a square-ish fill for dense acquisition-order ids", () => {
    // Replay pre-scan output: 0000..0048, no grid information to recover.
    const dense = Array.from({ length: 49 }, (_, i) => `B/3/${String(i).padStart(4, "0")}`);
    const grid = decodePlateGrid(dense);
    expect(grid.layout).toBe("sequential");
    const [well] = grid.wells;
    expect({ rows: well.rows, cols: well.cols, n: well.cells.length }).toEqual({ rows: 7, cols: 7, n: 49 });
    expect(well.cells[0]).toMatchObject({ fovName: "B/3/0000", row: 0, col: 0 });
    expect(well.cells.at(-1)).toMatchObject({ fovName: "B/3/0048", row: 6, col: 6 });
  });

  test("ignores unparseable names rather than throwing", () => {
    expect(decodePlateGrid(["", "nope", "B/3/000000"]).wells).toHaveLength(1);
  });
});
