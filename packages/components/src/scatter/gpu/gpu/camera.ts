import type { ViewState } from "../../contracts";
import type { InteractionConfig } from "../../gpu/types";

/** Column-major 4×4 matrix, the layout WGSL `mat4x4f` expects. */
export type Mat4 = Float32Array;

/** Clip-space position of a world point: `m · (x, y, z, 1)`. */
export function transform(m: Mat4, x: number, y: number, z = 0): [number, number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

/** What the renderer needs from a camera; P3's turntable implements the same surface. */
export interface Camera {
  /** Clip-from-world matrix for a viewport of aspect `w / h`. */
  viewProj(aspect: number): Mat4;
  /** World point under an NDC position (2D: on the z = 0 plane). */
  unproject(ndcX: number, ndcY: number, aspect: number): [number, number];
  toViewState(): ViewState;
}

function easeInOutQuint(t: number): number {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - (-2 * t + 2) ** 5 / 2;
}

// Magnetic detent at "home" zoom, where the [-0.9, 0.9] embedding fills ~80% of the canvas.
const SNAP_ZOOM = 0.9;
const SNAP_RANGE = 0.12; // ±12% of SNAP_ZOOM attracts
const SNAP_STRENGTH = 0.3; // 0 = none, 1 = hard snap

/** 2D orthographic pan/zoom with eased wheel zoom, a home-zoom detent, and timed animations. */
export class PanZoom2D implements Camera {
  private pan = [0, 0];
  private zoom = 1;
  private target = { panX: 0, panY: 0, zoom: 1 };
  private timed: { from: ViewState; to: ViewState; start: number; ms: number } | null = null;
  private easing = false;
  private readonly matrix = new Float32Array(16);
  private readonly lerp: number;
  private readonly epsilon: number;
  private readonly minZoom: number;
  private readonly maxZoom: number;

  constructor(config?: InteractionConfig) {
    this.lerp = config?.lerpSpeed ?? 0.06;
    this.epsilon = config?.lerpEpsilon ?? 0.0001;
    this.minZoom = config?.minZoom ?? 0.1;
    this.maxZoom = config?.maxZoom ?? 500;
  }

  viewProj(aspect: number): Mat4 {
    const m = this.matrix;
    m.fill(0);
    m[0] = this.zoom / aspect;
    m[5] = this.zoom;
    m[10] = 1;
    m[12] = (this.pan[0] * this.zoom) / aspect;
    m[13] = this.pan[1] * this.zoom;
    m[15] = 1;
    return m;
  }

  unproject(ndcX: number, ndcY: number, aspect: number): [number, number] {
    return [(ndcX * aspect) / this.zoom - this.pan[0], ndcY / this.zoom - this.pan[1]];
  }

  toViewState(): ViewState {
    return { panX: this.pan[0], panY: this.pan[1], zoom: this.zoom };
  }

  get animating(): boolean {
    return this.easing || this.timed !== null;
  }

  /** Jump to `state`, cancelling any easing. */
  set(state: ViewState): void {
    this.pan = [state.panX, state.panY];
    this.zoom = state.zoom;
    this.target = { ...state };
    this.timed = null;
    this.easing = false;
  }

  /** Drag: keep the world point under the cursor fixed (NDC delta from the previous position). */
  panBy(fromNdc: [number, number], toNdc: [number, number], aspect: number): void {
    const [ax, ay] = this.unproject(fromNdc[0], fromNdc[1], aspect);
    const [bx, by] = this.unproject(toNdc[0], toNdc[1], aspect);
    this.set({ panX: this.pan[0] + bx - ax, panY: this.pan[1] + by - ay, zoom: this.zoom });
  }

  /** Wheel: retarget zoom about the cursor; `step()` eases toward it. */
  zoomAt(ndcX: number, ndcY: number, aspect: number, factor: number): void {
    const t = this.target;
    // World point under the cursor at the target (not the eased) view.
    const wx = (ndcX * aspect) / t.zoom - t.panX;
    const wy = ndcY / t.zoom - t.panY;
    let zoom = Math.max(this.minZoom, Math.min(this.maxZoom, t.zoom * factor));
    const dist = Math.abs(zoom - SNAP_ZOOM);
    if (dist < SNAP_RANGE * SNAP_ZOOM)
      zoom += (SNAP_ZOOM - zoom) * (1 - dist / (SNAP_RANGE * SNAP_ZOOM)) * SNAP_STRENGTH;
    this.target = { panX: (ndcX * aspect) / zoom - wx, panY: ndcY / zoom - wy, zoom };
    this.timed = null;
    this.easing = true;
  }

  animateTo(state: ViewState, ms: number, now: number): void {
    this.timed = { from: this.toViewState(), to: { ...state }, start: now, ms };
    this.target = { ...state };
    this.easing = false;
  }

  /** Finish any easing at its target; true if the view moved. */
  settle(): boolean {
    if (!this.animating) return false;
    this.set(this.target);
    return true;
  }

  /** Advance easing by one frame; true if the view moved. */
  step(now: number): boolean {
    if (this.timed) {
      const { from, to, start, ms } = this.timed;
      const raw = Math.min((now - start) / ms, 1);
      const k = easeInOutQuint(raw);
      this.pan = [from.panX + (to.panX - from.panX) * k, from.panY + (to.panY - from.panY) * k];
      this.zoom = from.zoom + (to.zoom - from.zoom) * k;
      if (raw >= 1) this.set(to);
      return true;
    }
    if (!this.easing) return false;
    const t = this.target;
    this.pan = [this.pan[0] + (t.panX - this.pan[0]) * this.lerp, this.pan[1] + (t.panY - this.pan[1]) * this.lerp];
    this.zoom += (t.zoom - this.zoom) * this.lerp;
    const dz = Math.abs(t.zoom - this.zoom) / Math.max(t.zoom, 0.01);
    const dp = Math.abs(t.panX - this.pan[0]) + Math.abs(t.panY - this.pan[1]);
    if (dz < this.epsilon && dp < this.epsilon) this.set(t);
    return true;
  }
}
