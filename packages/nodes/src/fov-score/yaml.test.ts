import { describe, expect, test } from "bun:test";
import type { ScoreProfile } from "./desirability";
import { emitModelYaml } from "./yaml";

const gaussian = (center: number, fwhm: number, weight = 1, enabled = true) =>
  ({ shape: "gaussian", direction: "target", params: { center, fwhm }, weight, enabled }) as const;

/** The three features tuned in the demo clip, with the demo yaml's own values. */
const DEMO: ScoreProfile = {
  aggregation: "gaussian",
  features: {
    coverage_frac: gaussian(0.6824, 0.1415),
    max_empty_radius_norm: gaussian(0.32115, 0.34737),
    nn_um_mean: gaussian(24.86861, 6.76067),
  },
};

describe("emitModelYaml", () => {
  test("reproduces the shape of shrimPy's demo config", () => {
    // Compared verbatim: this file is the interface with the acquisition, so its exact text
    // is the contract, not an implementation detail.
    expect(emitModelYaml(DEMO, { topFov: 20 })).toBe(
      `model:
  type: ranking_by_defined_range
  top_fov: 20
  aggregation: gaussian
  features:
    coverage_frac:
      shape: gaussian
      center: 0.6824
      fwhm: 0.1415
      weight: 1.0
    max_empty_radius_norm:
      shape: gaussian
      center: 0.32115
      fwhm: 0.34737
      weight: 1.0
    nn_um_mean:
      shape: gaussian
      center: 24.86861
      fwhm: 6.76067
      weight: 1.0
`,
    );
  });

  test("omits disabled features entirely", () => {
    // A disabled feature keeps its tuning in the workspace, but reaching the acquisition
    // would let it veto fields the operator deliberately excluded from the score.
    const yaml = emitModelYaml(
      {
        aggregation: "sum",
        features: { kept: gaussian(1, 1), dropped: gaussian(2, 2, 1, false) },
      },
      { topFov: 5 },
    );
    expect(yaml).toContain("kept:");
    expect(yaml).not.toContain("dropped");
  });

  test("refuses to emit a model that ranks nothing", () => {
    expect(() =>
      emitModelYaml({ aggregation: "gaussian", features: { a: gaussian(1, 1, 1, false) } }, { topFov: 5 }),
    ).toThrow(/no features are enabled/);
  });

  test("rejects a top_fov the acquisition cannot use", () => {
    for (const topFov of [0, -1, 2.5, Number.NaN]) {
      expect(() => emitModelYaml(DEMO, { topFov })).toThrow(/top_fov/);
    }
  });

  test("emits direction only for the shapes that read it", () => {
    // `_desirability` ignores direction for gaussian and lognormal; emitting it there would
    // advertise a knob with no effect.
    const bells = emitModelYaml(DEMO, { topFov: 1 });
    expect(bells).not.toContain("direction");

    const monotonic = emitModelYaml(
      {
        aggregation: "sum",
        features: {
          edge_frac: {
            shape: "linear",
            direction: "lower",
            params: { onset: 0.9, ideal: 0.1 },
            weight: 2,
            enabled: true,
          },
        },
      },
      { topFov: 3 },
    );
    expect(monotonic).toContain("shape: linear");
    expect(monotonic).toContain("direction: lower");
    expect(monotonic).toContain("onset: 0.9");
    expect(monotonic).toContain("weight: 2.0");
  });

  test("parameters come out in the config's reading order, not object order", () => {
    const yaml = emitModelYaml(
      {
        aggregation: "product",
        features: {
          f: { shape: "gaussian", direction: "target", params: { fwhm: 2, center: 1 }, weight: 1, enabled: true },
        },
      },
      { topFov: 1 },
    );
    expect(yaml.indexOf("center:")).toBeLessThan(yaml.indexOf("fwhm:"));
  });

  test("integral values read as floats", () => {
    // `weight: 1` would parse as an int; the configs people compare against say 1.0.
    expect(emitModelYaml(DEMO, { topFov: 20 })).toContain("weight: 1.0");
  });

  test("refuses names it cannot write unquoted rather than emitting broken YAML", () => {
    const hostile: ScoreProfile = { aggregation: "sum", features: { "not: safe": gaussian(1, 1) } };
    expect(() => emitModelYaml(hostile, { topFov: 1 })).toThrow(/quoting/);
  });

  test("refuses non-finite numbers", () => {
    const broken: ScoreProfile = {
      aggregation: "sum",
      features: { f: gaussian(Number.NaN, 1) },
    };
    expect(() => emitModelYaml(broken, { topFov: 1 })).toThrow(/non-finite/);
  });

  test("provenance is a comment, so the block still parses", () => {
    const yaml = emitModelYaml(DEMO, { topFov: 20, provenance: "tuned in ndea\nh2bc21 pre-scan" });
    expect(yaml.startsWith("# tuned in ndea\n# h2bc21 pre-scan\nmodel:")).toBe(true);
  });

  test("all three aggregations round-trip into the file", () => {
    for (const aggregation of ["sum", "product", "gaussian"] as const) {
      expect(emitModelYaml({ ...DEMO, aggregation }, { topFov: 1 })).toContain(`aggregation: ${aggregation}`);
    }
  });
});
