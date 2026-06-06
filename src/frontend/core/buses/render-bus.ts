/**
 * RenderBus (PLUGIN-ARCHITECTURE §5) — the core seam behind `host.render`.
 * Phase 0 exposes only the point-radius knob (`PointRadiusStore`), which is the
 * one render setting the `RenderApi` contract surfaces today. Quality knobs in
 * `RenderSettingsStore` (opacity, tone-mapping, blend) stay wired through the
 * existing dev-tools subscription until the options editor lands (decision #3).
 */

import { pointRadiusStore, setPointRadius } from "@/stores/PointRadiusStore";

export interface RenderBus {
  pointRadius(): number;
  setPointRadius(r: number): void;
}

export function createRenderBus(): RenderBus {
  return {
    pointRadius() {
      return pointRadiusStore.state.radius;
    },
    setPointRadius(r) {
      setPointRadius(r);
    },
  };
}

/** Process-wide render bus — global point-radius shared across scatter panels. */
export const renderBus: RenderBus = createRenderBus();
