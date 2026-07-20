/**
 * ndResolveForm: the standard form-resolution function. The same function
 * runs everywhere a node renders, so a node's form is always explainable.
 *
 *   form = f(zoom-driven base, override, lock, placement, capability)
 *
 * · base comes from the host's zoom bands (with hysteresis, ND_ZOOM)
 * · an override (form-cycle button) wins until zoom next crosses a band,
 *   unless locked: locked overrides always win
 * · placement caps: staged bodies live elsewhere → card max
 * · capability caps: nodes that can't go full → card max
 */

export type NdForm = "chip" | "card" | "full";

export interface NdFormOverride {
  form: NdForm;
  /** true until the zoom-driven base next changes band (host bookkeeping) */
  fresh: boolean;
}

export function ndResolveForm({
  base,
  override,
  locked,
  staged,
  canFull,
}: {
  base: NdForm;
  override: NdFormOverride | null;
  locked: boolean;
  staged: boolean;
  canFull: boolean;
}): NdForm {
  let form = override && (locked || override.fresh) ? override.form : base;
  if (form === "full" && (staged || !canFull)) form = "card";
  return form;
}

/** Zoom → base form with hysteresis: previous band sticks within ±h of a threshold. */
export function ndZoomBand(
  zoom: number,
  prev: NdForm,
  bands: { chipMax: number; fullMin: number; hysteresis: number },
): NdForm {
  const { chipMax, fullMin, hysteresis: h } = bands;
  if (prev === "chip") return zoom > chipMax + h ? (zoom >= fullMin ? "full" : "card") : "chip";
  if (prev === "card") return zoom < chipMax - h ? "chip" : zoom > fullMin + h ? "full" : "card";
  return zoom < fullMin - h ? (zoom < chipMax ? "chip" : "card") : "full";
}
