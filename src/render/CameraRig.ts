import * as THREE from 'three';
import { clamp, clamp01, damp, lerpAngle, smoothFactor } from '../core/math.ts';

export type CameraMode = 'chase' | 'hood';

export interface CameraTarget {
  /** Car root position in render space. */
  position: THREE.Vector3;
  /** World heading of the car (rad). */
  yaw: number;
  /** Car body object (includes suspension motion) for the hood camera. */
  body: THREE.Object3D;
  /** Hood camera eye and look-at point in body coordinates (per car). */
  hoodEye: THREE.Vector3;
  hoodLook: THREE.Vector3;
  /** Speed over ground (m/s). */
  speed: number;
  /** Longitudinal / lateral acceleration (m/s²). */
  accel: number;
  lateralAccel: number;
}

const tmpForward = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Chase and hood cameras.
 * Chase: orbits behind the car on a yaw that lags the car's heading, pulls back under
 * acceleration, widens its FOV with speed, and shakes subtly at very high speed and on impacts.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';

  private yaw = 0;
  private height = 0;
  private accelOffset = 0;
  private rollLean = 0;
  private trauma = 0;
  private time = 0;
  private orbitAngle = 0;
  /** Extra orbit angle from dragging in the garage (rad). */
  private orbitDrag = 0;
  private framing = 0;
  private initialized = false;
  private readonly phases = [Math.random() * 10, Math.random() * 10, Math.random() * 10, Math.random() * 10];

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 4000);
  }

  toggle(): CameraMode {
    this.mode = this.mode === 'chase' ? 'hood' : 'chase';
    return this.mode;
  }

  /**
   * Shifts the image sideways by a fraction of the width (positive = subject to the right),
   * so a menu panel can sit beside the car.
   */
  setFraming(shift: number): void {
    this.framing = Math.abs(shift) < 1e-4 ? 0 : shift;
    if (this.framing === 0) this.camera.clearViewOffset();
    this.applyFraming();
  }

  /** Re-applies the sideways shift for the current aspect (setViewOffset also sets the aspect). */
  private applyFraming(): void {
    const cam = this.camera;
    if (this.framing !== 0) {
      const aspect = cam.aspect;
      cam.setViewOffset(aspect, 1, -this.framing * aspect, 0, aspect, 1);
    } else {
      cam.updateProjectionMatrix();
    }
  }

  /** Rotates the garage orbit by a drag (pixels → radians). */
  drag(dxPixels: number): void {
    this.orbitDrag += dxPixels * 0.006;
  }

  /** Adds impact shake (0..1). */
  addTrauma(amount: number): void {
    this.trauma = clamp01(this.trauma + amount);
  }

  /** Snap to the target without smoothing (on restart). */
  reset(target: CameraTarget): void {
    this.yaw = target.yaw;
    this.height = target.position.y;
    this.accelOffset = 0;
    this.trauma = 0;
    this.initialized = true;
  }

  update(dt: number, target: CameraTarget): void {
    if (!this.initialized) this.reset(target);
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    const cam = this.camera;
    const speedT = clamp01(target.speed / 80);

    if (this.mode === 'chase') {
      // Heading lag: the camera swings out in lane changes and corners.
      this.yaw = lerpAngle(this.yaw, target.yaw, smoothFactor(dt, 0.16));
      this.accelOffset = damp(this.accelOffset, clamp(target.accel * 0.045, -0.5, 0.45), 0.35, dt);
      this.height = damp(this.height, target.position.y, 0.09, dt);
      const dist = 5.7 + speedT * 0.7 + this.accelOffset;
      const camHeight = 1.72 + speedT * 0.1;
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      cam.position.set(target.position.x - fx * dist, this.height + camHeight, target.position.z - fz * dist);
      tmpLook.set(
        target.position.x + Math.sin(target.yaw) * 4,
        this.height + 0.95,
        target.position.z + Math.cos(target.yaw) * 4,
      );
      this.rollLean = damp(this.rollLean, clamp(-target.lateralAccel * 0.0035, -0.04, 0.04), 0.25, dt);
      cam.up.set(Math.cos(this.yaw) * this.rollLean, 1, -Math.sin(this.yaw) * this.rollLean).normalize();
      cam.lookAt(tmpLook);
      cam.fov = 58 + 24 * Math.pow(speedT, 1.3);
    } else {
      const body = target.body;
      body.updateWorldMatrix(true, false);
      // On the hood, just ahead of the windshield: the bonnet stays in the bottom of the frame.
      cam.position.copy(target.hoodEye);
      body.localToWorld(cam.position);
      tmpLook.copy(target.hoodLook);
      body.localToWorld(tmpLook);
      // Inherit half of the body roll so the view is lively but not nauseating.
      tmpUp.set(0, 1, 0).transformDirection(body.matrixWorld).lerp(WORLD_UP, 0.5).normalize();
      cam.up.copy(tmpUp);
      cam.lookAt(tmpLook);
      cam.fov = 66 + 14 * Math.pow(speedT, 1.3);
      this.yaw = target.yaw;
      this.height = target.position.y;
    }

    // Shake: subtle buffeting above ~200 km/h plus impact trauma.
    const highSpeed = clamp01((target.speed - 50) / 30);
    const amp = highSpeed * highSpeed * (this.mode === 'chase' ? 0.022 : 0.012) + this.trauma * this.trauma * 0.35;
    if (amp > 0.0001) {
      const t = this.time;
      const p = this.phases;
      tmpForward.set(
        (Math.sin(t * 23.1 + p[0]) * 0.6 + Math.sin(t * 41.7 + p[1]) * 0.4) * amp,
        (Math.sin(t * 29.3 + p[2]) * 0.6 + Math.sin(t * 53.9 + p[3]) * 0.4) * amp,
        0,
      );
      tmpForward.applyQuaternion(cam.quaternion);
      cam.position.add(tmpForward);
      cam.rotateZ(Math.sin(t * 17.3 + p[1]) * this.trauma * this.trauma * 0.05);
    }
    cam.updateProjectionMatrix();
  }

  /**
   * Slow sweep around the car for the title screen, staying on its left side
   * (over the road, never behind the guardrail).
   * @param heading world heading of the car
   */
  updateOrbit(dt: number, center: THREE.Vector3, heading = 0, garage = false): void {
    const cam = this.camera;
    // The slow sweep plus whatever the player dragged in the garage.
    this.orbitAngle += dt * (garage ? 0.09 : 0.16);
    const r = garage ? 8.2 : 7.2;
    // Left of the car is heading + π/2; sweep ±75° around it (never behind the guardrail).
    const sweep = Math.sin(this.orbitAngle) * (garage ? 0.9 : 1.3) + this.orbitDrag;
    const clamped = clamp(sweep, -1.45, 1.45);
    if (clamped !== sweep) this.orbitDrag -= sweep - clamped;
    const a = heading + Math.PI / 2 + clamped;
    cam.position.set(center.x + Math.sin(a) * r, center.y + (garage ? 1.75 : 1.9), center.z + Math.cos(a) * r);
    cam.up.set(0, 1, 0);
    tmpLook.set(center.x, center.y + (garage ? 0.55 : 0.7), center.z);
    cam.lookAt(tmpLook);
    cam.fov = garage ? 34 : 50;
    this.applyFraming();
    this.initialized = false;
  }
}
