import { describe, expect, test } from "bun:test";
import { resolveAnnotateCropFields } from "./crop-fields";

describe("resolveAnnotateCropFields", () => {
  test("forwards resolved per-row Z aliases", () => {
    expect(
      resolveAnnotateCropFields({
        obs_columns: ["fov_name", "t", "x", "y", "z_slice", "_dataset"],
        spatial: {
          fov_col: "fov_name",
          crop_fov_col: "fov_name",
          t_col: "t",
          x_col: "x",
          y_col: "y",
          z_col: "z_slice",
        },
      }),
    ).toEqual({
      fov: "fov_name",
      t: "t",
      dataset: "_dataset",
      z: "z_slice",
      x: "x",
      y: "y",
    });
  });

  test("does not treat a well grouping column as a crop-addressable FOV", () => {
    expect(
      resolveAnnotateCropFields({
        obs_columns: ["well", "t"],
        spatial: { fov_col: "well", crop_fov_col: null, t_col: "t" },
      }),
    ).toBeNull();
  });
});
