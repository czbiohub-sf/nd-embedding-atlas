import { Store } from "@tanstack/store";

const POINT_RADIUS_DEFAULT = 0.002;

export const pointRadiusStore = new Store({ radius: POINT_RADIUS_DEFAULT });
