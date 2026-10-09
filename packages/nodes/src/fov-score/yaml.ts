/**
 * The deliverable: a `fov_selection.model` block shrimPy can ingest.
 *
 * This tool's responsibility starts at reading pre-scan features and ends here. Everything
 * else — the plots, the labels, the accuracy readout — exists only to get these numbers right.
 *
 * Hand-written rather than via a YAML library: the shape is fixed and shallow (a mapping of
 * mappings of numbers), so a dependency would add more surface than it removes. The cost is
 * that quoting is our problem, so `emitModelYaml` refuses to emit anything it cannot write
 * unquoted instead of producing a file that parses into the wrong thing.
 */

import { DEFAULT_AGGREGATION, type ScoreProfile } from "./desirability";

/** shrimPy dispatches on this in `build_fov_model`. */
const MODEL_TYPE = "ranking_by_defined_range";

/**
 * Parameter order per shape, so the emitted file reads the way the demo config does rather
 * than in whatever order the object happens to iterate.
 */
const PARAM_ORDER: Record<string, readonly string[]> = {
  gaussian: ["center", "fwhm"],
  lognormal: ["center", "fold"],
  sigmoid: ["midpoint", "width", "half_band_lo", "half_band_hi"],
  linear: ["onset", "ideal", "range_lo", "range_hi", "soft_left", "soft_right"],
};

/**
 * `direction` is meaningless for the bells — `_desirability` ignores it for gaussian and
 * lognormal — so emitting it there would imply a knob that does nothing.
 */
const DIRECTION_APPLIES = new Set(["linear", "sigmoid"]);

/** Plain YAML keys only. Anything else would need quoting we are not going to guess at. */
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Format a number so a YAML parser reads it back as the same float.
 *
 * `toString` is already round-trip exact for doubles in JS, and YAML accepts both plain and
 * exponent forms. Integral values get a trailing `.0` so a weight of 1 reads as a float
 * rather than an int — cosmetic, but it matches the config people are used to.
 */
function num(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`refusing to emit non-finite number: ${value}`);
  const text = value.toString();
  return Number.isInteger(value) && !text.includes("e") ? `${text}.0` : text;
}

export interface EmitOptions {
  /** How many top-ranked FOVs the acquisition should keep. Required by shrimPy. */
  topFov: number;
  /** Emitted above the block as a comment; omit for a byte-stable file. */
  provenance?: string;
}

/**
 * Render the tuned profile as the `model:` block of a shrimPy fov_selection config.
 *
 * Only enabled features are emitted — a disabled feature keeps its tuning in the workspace
 * but must not reach the acquisition, or it would silently veto fields the operator excluded
 * from the score.
 */
export function emitModelYaml(profile: ScoreProfile, options: EmitOptions): string {
  const { topFov, provenance } = options;
  if (!Number.isInteger(topFov) || topFov < 1) {
    throw new Error(`top_fov must be a positive integer; got ${topFov}`);
  }

  const enabled = Object.keys(profile.features)
    .filter((name) => profile.features[name].enabled)
    .toSorted();
  if (enabled.length === 0) {
    throw new Error("no features are enabled: the emitted model would rank every FOV identically");
  }

  const lines: string[] = [];
  if (provenance) for (const line of provenance.split("\n")) lines.push(`# ${line}`);
  lines.push("model:");
  lines.push(`  type: ${MODEL_TYPE}`);
  lines.push(`  top_fov: ${topFov}`);
  lines.push(`  aggregation: ${profile.aggregation ?? DEFAULT_AGGREGATION}`);
  lines.push("  features:");

  for (const name of enabled) {
    if (!SAFE_KEY.test(name)) {
      throw new Error(`feature name needs YAML quoting, refusing to emit: ${name}`);
    }
    const spec = profile.features[name];
    lines.push(`    ${name}:`);
    lines.push(`      shape: ${spec.shape}`);
    if (DIRECTION_APPLIES.has(spec.shape)) lines.push(`      direction: ${spec.direction}`);

    const order = PARAM_ORDER[spec.shape] ?? [];
    const ordered = [
      ...order.filter((key) => spec.params[key] !== undefined),
      ...Object.keys(spec.params)
        .filter((key) => !order.includes(key))
        .toSorted(),
    ];
    for (const key of ordered) {
      if (!SAFE_KEY.test(key)) throw new Error(`parameter name needs YAML quoting: ${key}`);
      lines.push(`      ${key}: ${num(spec.params[key])}`);
    }
    lines.push(`      weight: ${num(spec.weight)}`);
  }

  return `${lines.join("\n")}\n`;
}
