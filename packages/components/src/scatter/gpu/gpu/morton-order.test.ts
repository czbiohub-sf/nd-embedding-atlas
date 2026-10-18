import { expect, test } from "bun:test";
import { mortonOrder } from "./scene";

test("mortonOrder is a stable permutation sorted by Morton key", () => {
  // 4×4 grid in [-1, 1], row order by y then x, each cell twice (rows 2c, 2c + 1).
  const n = 32;
  const positions = new Float32Array(2 * n);
  for (let r = 0; r < n; r++) {
    const cell = r >> 1;
    positions[r] = -1 + (2 * (cell & 3)) / 3;
    positions[n + r] = -1 + (2 * (cell >> 2)) / 3;
  }
  const perm = mortonOrder(positions, n, 2);
  // Z order of the 4×4 cells (x bits even, y bits odd); equal keys keep row order.
  const cells = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];
  expect([...perm]).toEqual(cells.flatMap((c) => [2 * c, 2 * c + 1]));
});

test("3D mortonOrder clamps out-of-range and NaN coordinates and keeps ties in row order", () => {
  // Rows as (x, y, z); the Morton octant is x | y << 1 | z << 2 of the positive axes.
  const rows = [
    [1, 1, 1], // octant 7
    [NaN, -1, -1], // NaN quantizes to the low edge: octant 0
    [5, 5, 5], // clamps to the high corner: ties row 0
    [-1, -1, -1], // octant 0, ties row 1
    [1, -1, -1], // octant 1
    [-3, 1, -1], // x clamps low: octant 2
  ];
  const n = rows.length;
  const positions = new Float32Array(3 * n);
  rows.forEach((p, r) => p.forEach((v, axis) => (positions[axis * n + r] = v)));
  expect([...mortonOrder(positions, n, 3)]).toEqual([1, 3, 4, 5, 0, 2]);
});
