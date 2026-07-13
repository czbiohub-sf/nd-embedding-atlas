/** Process-wide scatter point radius. */

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

export const renderBus: RenderBus = createRenderBus();
