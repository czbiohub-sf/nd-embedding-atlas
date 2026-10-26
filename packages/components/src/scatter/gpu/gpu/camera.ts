import type { PanZoomView, TurntableView, ViewSyncState } from "@ndea/sdk";
import type { InteractionConfig } from "../../gpu/types";

/** Column-major 4×4 matrix, the layout WGSL `mat4x4f` expects. */
export type Mat4 = Float32Array;
type Vec3 = [number, number, number];

/** Clip-space position of a world point: `m · (x, y, z, 1)`. */
export function transform(m: Mat4, x: number, y: number, z = 0): [number, number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

/** `a · b`. */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** View matrix: the eye at `eye` looks at `target`, y up (right-handed: the camera looks down −z). */
function lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  const f = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  // prettier-ignore
  return Float32Array.of(
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  );
}

/** Perspective projection into WebGPU clip space (depth 0 at `near`, 1 at `far`). */
function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  // prettier-ignore
  return Float32Array.of(
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (near * far) / (near - far), 0,
  );
}

/** Orthographic projection of a centered `2·halfW × 2·halfH` view into WebGPU clip space. */
function orthographic(halfW: number, halfH: number, near: number, far: number): Mat4 {
  // prettier-ignore
  return Float32Array.of(
    1 / halfW, 0, 0, 0,
    0, 1 / halfH, 0, 0,
    0, 0, 1 / (near - far), 0,
    0, 0, near / (near - far), 1,
  );
}

/** World-space bounding box of the points. */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** What the renderer and the pointer controller need from a camera. */
export interface Camera {
  /** Clip-from-world matrix for a viewport of aspect `w / h`. */
  viewProj(aspect: number): Mat4;
  toViewState(): PanZoomView | TurntableView;
  /** Zoom relative to the home view; scales the marker size. */
  readonly scale: number;
  readonly animating: boolean;
  /** Apply a synced view; false when it is the other dimensionality's (see `ViewSyncState`). */
  set(state: ViewSyncState): boolean;
  /** Pointer drag between NDC positions: 2D pans; 3D orbits, or pans when `pan`. */
  drag(from: [number, number], to: [number, number], aspect: number, pan: boolean): void;
  /** Wheel: zoom (2D) or dolly (3D) about the cursor, applied at once. */
  zoomAt(ndcX: number, ndcY: number, aspect: number, factor: number): void;
  /** Animate to a view that frames `bounds` (the one timed animation). */
  fit(bounds: Bounds, aspect: number, ms: number, now: number): void;
  /** Stop a running `fit` where the view is now; true if it was moving. */
  halt(): boolean;
  /** Advance the `fit` animation by one frame; true if the view moved. */
  step(now: number): boolean;
}

function easeInOutQuint(t: number): number {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - (-2 * t + 2) ** 5 / 2;
}

/** 2D orthographic pan/zoom: wheel zoom about the cursor, and a timed fit animation. */
export class PanZoom2D implements Camera {
  private pan = [0, 0];
  private zoom = 1;
  private timed: { from: PanZoomView; to: PanZoomView; start: number; ms: number } | null = null;
  private readonly matrix = new Float32Array(16);
  private readonly minZoom: number;
  private readonly maxZoom: number;

  constructor(config?: InteractionConfig) {
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

  toViewState(): PanZoomView {
    return { panX: this.pan[0], panY: this.pan[1], zoom: this.zoom };
  }

  get scale(): number {
    return this.zoom;
  }

  get animating(): boolean {
    return this.timed !== null;
  }

  set(state: ViewSyncState): boolean {
    if (state.yaw !== undefined) return false;
    this.jump(state);
    return true;
  }

  /** Jump to `state`, cancelling any animation. */
  private jump(state: PanZoomView): void {
    this.pan = [state.panX, state.panY];
    this.zoom = state.zoom;
    this.timed = null;
  }

  /** World point (z = 0) under an NDC position. */
  private unproject(ndcX: number, ndcY: number, aspect: number): [number, number] {
    return [(ndcX * aspect) / this.zoom - this.pan[0], ndcY / this.zoom - this.pan[1]];
  }

  /** Keeps the world point under the cursor fixed. */
  drag(from: [number, number], to: [number, number], aspect: number): void {
    const [ax, ay] = this.unproject(from[0], from[1], aspect);
    const [bx, by] = this.unproject(to[0], to[1], aspect);
    this.jump({ panX: this.pan[0] + bx - ax, panY: this.pan[1] + by - ay, zoom: this.zoom });
  }

  zoomAt(ndcX: number, ndcY: number, aspect: number, factor: number): void {
    const [wx, wy] = this.unproject(ndcX, ndcY, aspect);
    const zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    this.jump({ panX: (ndcX * aspect) / zoom - wx, panY: ndcY / zoom - wy, zoom });
  }

  fit({ min, max }: Bounds, aspect: number, ms: number, now: number): void {
    const padding = 0.88;
    const zoom = Math.min(
      (2 * padding) / Math.max(max[1] - min[1], 1e-6),
      (2 * aspect * padding) / Math.max(max[0] - min[0], 1e-6),
    );
    this.timed = {
      from: this.toViewState(),
      to: { panX: -(min[0] + max[0]) / 2, panY: -(min[1] + max[1]) / 2, zoom },
      start: now,
      ms,
    };
  }

  halt(): boolean {
    if (!this.animating) return false;
    this.jump(this.toViewState());
    return true;
  }

  step(now: number): boolean {
    if (!this.timed) return false;
    const { from, to, start, ms } = this.timed;
    const raw = Math.min((now - start) / ms, 1);
    const k = easeInOutQuint(raw);
    this.pan = [from.panX + (to.panX - from.panX) * k, from.panY + (to.panY - from.panY) * k];
    this.zoom = from.zoom + (to.zoom - from.zoom) * k;
    if (raw >= 1) this.jump(to);
    return true;
  }
}

const FOV = Math.PI / 4;
const TAN = Math.tan(FOV / 2);
/** Eye distance that frames the [-1, 1]³ cube's bounding sphere: the 3D "zoom 1". */
const HOME = Math.sqrt(3) / Math.sin(FOV / 2);
const MAX_PITCH = Math.PI / 2 - 0.01;

/** Orbit basis of a view, in world coordinates: right, up, and back (target → eye). */
export function basis({ yaw, pitch }: Pick<TurntableView, "yaw" | "pitch">): [Vec3, Vec3, Vec3] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [
    [cy, 0, -sy],
    [-sp * sy, cp, -sp * cy],
    [cp * sy, sp, cp * cy],
  ];
}

/** `target + (right·x + up·y)·k`: a move in the view plane. */
function slide(v: TurntableView, x: number, y: number, k: number): Vec3 {
  const [r, u] = basis(v);
  return [
    v.target[0] + (r[0] * x + u[0] * y) * k,
    v.target[1] + (r[1] * x + u[1] * y) * k,
    v.target[2] + (r[2] * x + u[2] * y) * k,
  ];
}

function mix(a: TurntableView, b: TurntableView, k: number): TurntableView {
  const m = (x: number, y: number) => x + (y - x) * k;
  return {
    yaw: m(a.yaw, b.yaw),
    pitch: m(a.pitch, b.pitch),
    distance: m(a.distance, b.distance),
    target: [m(a.target[0], b.target[0]), m(a.target[1], b.target[1]), m(a.target[2], b.target[2])],
    projection: b.projection,
  };
}

/**
 * 3D turntable: yaw/pitch orbit about a target, eased dolly-to-cursor, pan in
 * the view plane, perspective or orthographic. The orthographic view height
 * follows the distance, so toggling keeps the target plane's scale.
 */
export class Turntable3D implements Camera {
  private view: TurntableView = { yaw: 0.6, pitch: 0.35, distance: HOME, target: [0, 0, 0], projection: "perspective" };
  private timed: { from: TurntableView; to: TurntableView; start: number; ms: number } | null = null;
  private readonly minDistance: number;
  private readonly maxDistance: number;

  constructor(config?: InteractionConfig) {
    this.minDistance = HOME / (config?.maxZoom ?? 500);
    this.maxDistance = HOME / (config?.minZoom ?? 0.1);
  }

  viewProj(aspect: number): Mat4 {
    const v = this.view;
    const back = basis(v)[2];
    const eye: Vec3 = [
      v.target[0] + back[0] * v.distance,
      v.target[1] + back[1] * v.distance,
      v.target[2] + back[2] * v.distance,
    ];
    // Depth range: the normalized data lies within √3 of the origin.
    const reach = Math.hypot(...v.target) + Math.sqrt(3);
    const far = v.distance + reach;
    const halfH = v.distance * TAN;
    const proj =
      v.projection === "perspective"
        ? perspective(FOV, aspect, Math.max(v.distance - reach, v.distance * 1e-3), far)
        : orthographic(halfH * aspect, halfH, v.distance - reach, far);
    return multiply(proj, lookAt(eye, v.target));
  }

  toViewState(): TurntableView {
    return { ...this.view, target: [...this.view.target] };
  }

  get scale(): number {
    return HOME / this.view.distance;
  }

  get animating(): boolean {
    return this.timed !== null;
  }

  get projection(): TurntableView["projection"] {
    return this.view.projection;
  }

  setProjection(projection: TurntableView["projection"]): void {
    this.view = { ...this.view, projection };
    if (this.timed) this.timed.to = { ...this.timed.to, projection };
  }

  set({ yaw, pitch, distance, target, projection }: ViewSyncState): boolean {
    if (yaw === undefined || pitch === undefined || distance === undefined || !target || !projection) return false;
    this.jump({ yaw, pitch, distance, target, projection });
    return true;
  }

  private jump(v: TurntableView): void {
    this.view = { ...v, target: [...v.target] };
    this.timed = null;
  }

  drag(from: [number, number], to: [number, number], aspect: number, pan: boolean): void {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const v = this.view;
    if (pan) this.jump({ ...v, target: slide(v, -dx * aspect, -dy, v.distance * TAN) });
    else {
      const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, v.pitch - (dy * Math.PI) / 2));
      this.jump({ ...v, yaw: v.yaw - dx * Math.PI, pitch });
    }
  }

  /** Dolly toward the cursor: the point under it on the target plane stays put. */
  zoomAt(ndcX: number, ndcY: number, aspect: number, factor: number): void {
    const v = this.view;
    const distance = Math.max(this.minDistance, Math.min(this.maxDistance, v.distance / factor));
    this.jump({ ...v, distance, target: slide(v, ndcX * aspect, ndcY, (v.distance - distance) * TAN) });
  }

  fit({ min, max }: Bounds, aspect: number, ms: number, now: number): void {
    const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const radius = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, 1e-3);
    const distance = radius / (Math.sin(FOV / 2) * Math.min(1, aspect));
    this.timed = { from: this.view, to: { ...this.view, target, distance }, start: now, ms };
  }

  halt(): boolean {
    if (!this.animating) return false;
    this.jump(this.view);
    return true;
  }

  step(now: number): boolean {
    if (!this.timed) return false;
    const { from, to, start, ms } = this.timed;
    const raw = Math.min((now - start) / ms, 1);
    this.view = mix(from, to, easeInOutQuint(raw));
    if (raw >= 1) this.jump(to);
    return true;
  }
}
