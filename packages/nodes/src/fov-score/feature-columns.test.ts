import { describe, expect, test } from "bun:test";
import { featureColumns, isFeatureColumn } from "./feature-columns";

/** The real 30 obs columns of the converted h2bc21 example store. */
const REAL_COLUMNS = [
  "well_row",
  "well_col",
  "fov",
  "timepoint",
  "goodness",
  "image_width_px",
  "image_height_px",
  "pixel_size_um",
  "filename",
  "fov_name",
  "t",
  "x",
  "y",
  "goodness_label",
  "well",
  "coverage_frac",
  "nn_um_mean",
  "nn_cv",
  "com_offset_norm",
  "mean_distance_to_center_fov",
  "empty_grid_frac",
  "occupancy_entropy",
  "angular_uniformity",
  "central_cov_ratio",
  "edge_frac",
  "mask_occupancy_entropy",
  "max_radius_corner_to_edge",
  "max_radius_between_cells_norm",
  "max_radius_between_cells_offset_norm",
  "nn_mask_um_mean",
];

describe("featureColumns", () => {
  test("recovers exactly the 15 features from the real store's 30 obs columns", () => {
    expect(featureColumns(REAL_COLUMNS)).toEqual([
      "coverage_frac",
      "nn_um_mean",
      "nn_cv",
      "com_offset_norm",
      "mean_distance_to_center_fov",
      "empty_grid_frac",
      "occupancy_entropy",
      "angular_uniformity",
      "central_cov_ratio",
      "edge_frac",
      "mask_occupancy_entropy",
      "max_radius_corner_to_edge",
      "max_radius_between_cells_norm",
      "max_radius_between_cells_offset_norm",
      "nn_mask_um_mean",
    ]);
  });

  test("excludes plate identity, so nobody scores fields by position", () => {
    for (const name of ["well", "well_row", "well_col", "fov", "fov_name", "filename", "timepoint", "t"]) {
      expect(isFeatureColumn(name)).toBe(false);
    }
  });

  test("excludes labels and model outputs, so the score cannot feed on itself", () => {
    for (const name of [
      "goodness",
      "goodness_user",
      "goodness_label",
      "predicted_goodness",
      "predicted_good_proba",
      "score",
      "fov_score",
    ]) {
      expect(isFeatureColumn(name)).toBe(false);
    }
  });

  test("excludes the synthetic crop coordinates and acquisition metadata", () => {
    // x/y are the field centres the converter invents for crop addressing, not measurements.
    for (const name of ["x", "y", "z", "image_width_px", "image_height_px", "pixel_size_um"]) {
      expect(isFeatureColumn(name)).toBe(false);
    }
  });

  test("excludes reduced embeddings, which are computed FROM features", () => {
    for (const name of ["PCA1", "pca2", "TSNE2", "UMAP3", "PHATE1", "umap"]) {
      expect(isFeatureColumn(name)).toBe(false);
    }
    // ...but not a real feature that merely contains those letters.
    expect(isFeatureColumn("umap_density_frac")).toBe(true);
  });

  test("excludes internal columns", () => {
    for (const name of ["__row_index__", "_dataset", "__ev_well_id"]) {
      expect(isFeatureColumn(name)).toBe(false);
    }
  });

  test("accepts the instanseg feature names too, which differ from cellpose's", () => {
    // The two segmenters rename each other's features, so nothing may be hardcoded.
    for (const name of [
      "centroid_radial_mean",
      "max_empty_radius_norm",
      "max_empty_edge_offset_norm",
      "center_gap_norm",
      "max_gap_um",
    ]) {
      expect(isFeatureColumn(name)).toBe(true);
    }
  });

  test("extraExcluded handles per-dataset oddities without editing the list", () => {
    expect(featureColumns(["coverage_frac", "bookkeeping"], ["bookkeeping"])).toEqual(["coverage_frac"]);
  });

  test("preserves dataset order, so plots appear in a stable sequence", () => {
    expect(featureColumns(["b_frac", "a_frac"])).toEqual(["b_frac", "a_frac"]);
  });
});
