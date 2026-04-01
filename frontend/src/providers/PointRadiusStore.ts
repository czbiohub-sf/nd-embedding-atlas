import { Store } from "@tanstack/store";

export const POINT_RADIUS_MIN = 0.001;
export const POINT_RADIUS_MAX = 0.012;
export const POINT_RADIUS_DEFAULT = 0.003;

export const pointRadiusStore = new Store({ radius: POINT_RADIUS_DEFAULT });

export function setPointRadius(radius: number): void {
  pointRadiusStore.setState(() => ({ radius }));
}
