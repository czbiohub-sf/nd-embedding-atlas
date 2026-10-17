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
