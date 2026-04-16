/**
 * Orbit camera controls for PerspectiveCamera.
 *
 * Vendored from idetik (not exported from @idetik/core).
 * Implements the CameraControls interface:
 * - Left drag: orbit (rotate around target)
 * - Shift+left drag or middle drag: pan
 * - Wheel: zoom (dolly in/out)
 */

import {
    type CameraControls,
    type EventContext,
    type PerspectiveCamera,
    Spherical,
} from "@idetik/core";
import { vec3 } from "gl-matrix";

const MOUSE_BUTTON_NONE = -1;
const MOUSE_BUTTON_LEFT = 0;
const MOUSE_BUTTON_MIDDLE = 1;

const ORBIT_SPEED = 0.009;
const PAN_SPEED = 0.001;
const ZOOM_SPEED = 0.0009;
const DEFAULT_DAMPING_FACTOR = 0.5;
const DAMPING_FPS = 60;
const EPSILON = 1e-6;
const VEC3_ZERO = vec3.fromValues(0, 0, 0);

export interface OrbitControlsOptions {
    radius?: number;
    yaw?: number;
    pitch?: number;
    target?: vec3;
    dampingFactor?: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export class OrbitControls implements CameraControls {
    private readonly camera_: PerspectiveCamera;

    private readonly orbitVelocity_ = new Spherical(0, 0, 0);
    private readonly panVelocity_ = vec3.create();

    private readonly currPos_: Spherical;
    private readonly currCenter_ = vec3.create();

    private readonly dampingFactor_: number;

    private currMouseButton_ = MOUSE_BUTTON_NONE;

    constructor(camera: PerspectiveCamera, params?: OrbitControlsOptions) {
        this.camera_ = camera;

        this.currPos_ = new Spherical(params?.radius ?? 1, params?.yaw ?? 0, params?.pitch ?? 0);

        if (params?.target) {
            vec3.copy(this.currCenter_, params.target);
        }

        this.dampingFactor_ = clamp(params?.dampingFactor ?? DEFAULT_DAMPING_FACTOR, 0, 1);

        this.updateCamera();
    }

    public get isMoving(): boolean {
        return (
            this.orbitVelocity_.phi !== 0 ||
            this.orbitVelocity_.theta !== 0 ||
            this.orbitVelocity_.radius !== 0 ||
            this.panVelocity_[0] !== 0 ||
            this.panVelocity_[1] !== 0 ||
            this.panVelocity_[2] !== 0
        );
    }

    /** Reset orbit to look at a target from a given distance. */
    public lookAt(target: vec3, radius?: number): void {
        vec3.copy(this.currCenter_, target);
        if (radius !== undefined) {
            this.currPos_.radius = Math.max(0.01, radius);
        }
        this.updateCamera();
    }

    public onEvent(event: EventContext): void {
        switch (event.type) {
            case "pointerdown":
                this.onPointerDown(event);
                break;
            case "pointermove":
                this.onPointerMove(event);
                break;
            case "wheel":
                this.onWheel(event);
                break;
            case "pointerup":
            case "pointercancel":
                this.onPointerEnd(event);
                break;
        }
    }

    public onUpdate(dt: number): void {
        if (
            this.orbitVelocity_.phi === 0 &&
            this.orbitVelocity_.theta === 0 &&
            this.orbitVelocity_.radius === 0 &&
            vec3.equals(this.panVelocity_, VEC3_ZERO)
        ) {
            return;
        }

        this.currPos_.phi += this.orbitVelocity_.phi;
        this.currPos_.theta += this.orbitVelocity_.theta;
        this.currPos_.radius += this.orbitVelocity_.radius * this.currPos_.radius;

        vec3.add(this.currCenter_, this.currCenter_, this.panVelocity_);

        const limit = Math.PI / 2 - EPSILON;
        this.currPos_.theta = clamp(this.currPos_.theta, -limit, limit);
        this.currPos_.radius = Math.max(0.01, this.currPos_.radius);

        this.updateCamera();

        const damping = (1.0 - this.dampingFactor_) ** (dt * DAMPING_FPS);
        this.orbitVelocity_.phi *= damping;
        this.orbitVelocity_.theta *= damping;
        this.orbitVelocity_.radius *= damping;
        vec3.scale(this.panVelocity_, this.panVelocity_, damping);

        this.cutoffLowVelocity();
    }

    private onPointerDown(event: EventContext): void {
        const e = event.event as PointerEvent;
        this.currMouseButton_ = e.button;
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
    }

    private onPointerMove(event: EventContext): void {
        if (this.currMouseButton_ === MOUSE_BUTTON_NONE) return;

        const e = event.event as PointerEvent;
        const dx = e.movementX ?? 0;
        const dy = e.movementY ?? 0;

        const doOrbit = this.currMouseButton_ === MOUSE_BUTTON_LEFT && !e.shiftKey;
        const doPan =
            (this.currMouseButton_ === MOUSE_BUTTON_LEFT && e.shiftKey) ||
            this.currMouseButton_ === MOUSE_BUTTON_MIDDLE;

        if (doOrbit) this.orbit(dx, dy);
        if (doPan) this.pan(dx, dy);
    }

    private onWheel(event: EventContext): void {
        const e = event.event as WheelEvent;
        e.preventDefault();
        const dy = e.deltaY ?? 0;
        this.zoom(dy);
    }

    private onPointerEnd(event: EventContext): void {
        this.currMouseButton_ = MOUSE_BUTTON_NONE;
        const e = event.event as PointerEvent;
        (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    }

    private orbit(dx: number, dy: number): void {
        this.orbitVelocity_.phi -= dx * ORBIT_SPEED;
        this.orbitVelocity_.theta += dy * ORBIT_SPEED;
    }

    private pan(dx: number, dy: number): void {
        const speed = this.currPos_.radius * PAN_SPEED;
        const delta = vec3.create();
        vec3.scaleAndAdd(delta, delta, this.camera_.right, dx);
        vec3.scaleAndAdd(delta, delta, this.camera_.up, dy);
        vec3.scale(delta, delta, speed);
        vec3.sub(this.panVelocity_, this.panVelocity_, delta);
    }

    private zoom(dy: number): void {
        this.orbitVelocity_.radius += dy * ZOOM_SPEED;
    }

    private updateCamera(): void {
        const p = vec3.add(vec3.create(), this.currCenter_, this.currPos_.toVec3());
        this.camera_.transform.setTranslation(p);
        this.camera_.transform.targetTo(this.currCenter_);
    }

    private cutoffLowVelocity(): void {
        if (Math.abs(this.orbitVelocity_.phi) < EPSILON) this.orbitVelocity_.phi = 0;
        if (Math.abs(this.orbitVelocity_.theta) < EPSILON) this.orbitVelocity_.theta = 0;
        if (Math.abs(this.orbitVelocity_.radius) < EPSILON) this.orbitVelocity_.radius = 0;
        if (vec3.length(this.panVelocity_) < EPSILON) vec3.zero(this.panVelocity_);
    }
}
