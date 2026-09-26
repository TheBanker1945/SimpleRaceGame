import * as THREE from 'three';
import { clamp, GRAVITY } from '../core/math.ts';
import { collideWithBarriers, createBody, createContact, type Body2D, type ImpactResult } from '../physics/Collision.ts';
import { BARRIER_LEFT, BARRIER_RIGHT, laneAt, laneCenter } from '../world/RoadConstants.ts';
import { laneChangeProfile, laneChangeRate, type IdmParams } from './TrafficAI.ts';
import type { TrafficType } from './TrafficTypes.ts';

let nextId = 1;
const impact: ImpactResult = { closingSpeed: 0, impulse: 0 };
const contact = createContact();

/**
 * One AI vehicle. Drives in road coordinates: `s` along the road, `d` lateral.
 * Normal driving is lane-based (IDM speed control + smooth lane changes); after a
 * real impact it becomes a sliding rigid body ("wreck") that brakes to a stop with
 * its hazard lights on.
 */
export class TrafficCar {
  readonly id = nextId++;
  type!: TrafficType;
  readonly paint = new THREE.Color();
  readonly idm: IdmParams = { maxAccel: 1.5, comfortDecel: 2.5, headway: 1.4, minGap: 3, maxDecel: 8 };

  s = 0;
  d = 0;
  psi = 0;
  prevS = 0;
  prevD = 0;
  prevPsi = 0;
  /** Speed along the road (m/s). */
  speed = 0;
  accel = 0;
  desiredSpeed = 30;

  lane = 0;
  fromLane = 0;
  /** Lane-change progress 0..1 (1 = settled in `lane`). */
  laneT = 1;
  laneDuration = 3;
  /** Indicator: +1 left, −1 right, 0 off. */
  signal = 0;
  signalTimer = 0;
  pendingLane = -1;
  decisionTimer = 0;
  politeness = 0.3;
  /** Occasionally misjudges the closing speed of cars coming from behind. */
  careless = false;

  /** Residual lateral offset / heading after a light bump, decays back to the lane. */
  bumpOffset = 0;
  bumpPsi = 0;

  wrecked = false;
  wreckTime = 0;
  readonly body: Body2D = createBody();

  // Scoring / effects bookkeeping.
  relToPlayer = 0;
  nearMissDone = false;
  lastPlayerContact = -100;
  /** Last honk time (s), to avoid honking every frame. */
  lastHonk = -100;

  get halfLength(): number {
    return this.type.length / 2;
  }

  get halfWidth(): number {
    return this.type.width / 2;
  }

  get changingLanes(): boolean {
    return this.laneT < 1;
  }

  /** Lateral span this car claims on the road: its body, plus the target lane while changing. */
  corridor(out: [number, number]): [number, number] {
    let lo = this.d - this.halfWidth;
    let hi = this.d + this.halfWidth;
    if (this.changingLanes || this.pendingLane >= 0) {
      const target = laneCenter(this.pendingLane >= 0 ? this.pendingLane : this.lane);
      lo = Math.min(lo, target - this.halfWidth);
      hi = Math.max(hi, target + this.halfWidth);
    }
    out[0] = lo;
    out[1] = hi;
    return out;
  }

  spawn(type: TrafficType, s: number, lane: number, desiredSpeed: number, speed: number, paint: number, careless: boolean): void {
    this.type = type;
    this.paint.setHex(paint);
    this.s = this.prevS = s;
    this.lane = this.fromLane = lane;
    this.d = this.prevD = laneCenter(lane);
    this.psi = this.prevPsi = 0;
    this.laneT = 1;
    this.signal = 0;
    this.signalTimer = 0;
    this.pendingLane = -1;
    this.desiredSpeed = desiredSpeed;
    this.speed = speed;
    this.accel = 0;
    this.decisionTimer = Math.random() * 2;
    this.careless = careless;
    this.politeness = type.isTruck ? 0.5 : 0.15 + Math.random() * 0.35;
    this.idm.maxAccel = type.maxAccel;
    this.idm.comfortDecel = type.comfortDecel;
    this.idm.headway = (type.isTruck ? 1.7 : 1.1) + Math.random() * 0.6;
    this.idm.minGap = type.isTruck ? 4 : 2.5;
    this.idm.maxDecel = type.isTruck ? 6 : 8.5;
    this.bumpOffset = 0;
    this.bumpPsi = 0;
    this.wrecked = false;
    this.wreckTime = 0;
    this.nearMissDone = false;
    this.lastPlayerContact = -100;
    this.lastHonk = -100;
  }

  savePrevious(): void {
    this.prevS = this.s;
    this.prevD = this.d;
    this.prevPsi = this.psi;
  }

  beginLaneChange(target: number): void {
    this.fromLane = laneAt(this.d);
    this.lane = target;
    this.laneT = 0;
    const [lo, hi] = this.type.laneChangeTime;
    this.laneDuration = lo + Math.random() * (hi - lo);
    this.pendingLane = -1;
    this.signal = target < this.fromLane ? 1 : -1;
  }

  /** Normal lane-following motion for one step, given the IDM acceleration. */
  drive(dt: number, accel: number): void {
    this.accel = accel;
    this.speed = Math.max(0, this.speed + accel * dt);
    this.s += this.speed * dt;
    let lateralRate = 0;
    if (this.laneT < 1) {
      this.laneT = Math.min(1, this.laneT + dt / this.laneDuration);
      const from = laneCenter(this.fromLane);
      const to = laneCenter(this.lane);
      this.d = from + (to - from) * laneChangeProfile(this.laneT);
      lateralRate = ((to - from) * laneChangeRate(this.laneT)) / this.laneDuration;
      if (this.laneT >= 1) this.signal = 0;
    } else {
      this.d = laneCenter(this.lane);
    }
    // Bumps fade out over ~1 s as the driver corrects.
    const decay = Math.exp(-dt * 1.4);
    this.bumpOffset *= decay;
    this.bumpPsi *= decay;
    this.d += this.bumpOffset;
    this.psi = Math.atan2(lateralRate, Math.max(this.speed, 3)) + this.bumpPsi;
  }

  /** Fills `body` from the current state (collision frame: X = −d, Y = s). */
  syncBody(): Body2D {
    const b = this.body;
    b.x = -this.d;
    b.y = this.s;
    b.angle = this.psi;
    if (!this.wrecked) {
      // Lane driving: velocity is along the road plus the lane-change drift.
      b.vx = -Math.tan(this.psi) * this.speed;
      b.vy = this.speed;
      b.omega = 0;
    }
    b.invMass = 1 / this.type.mass;
    b.invInertia = 12 / (this.type.mass * (this.type.length ** 2 + this.type.width ** 2));
    b.hl = this.halfLength;
    b.hw = this.halfWidth;
    return b;
  }

  /** Applies a collision response computed on `body`. Hard hits turn the car into a wreck. */
  applyBody(closingSpeed: number): void {
    const b = this.body;
    if (closingSpeed > 3.5 || this.wrecked) {
      this.wrecked = true;
      this.signal = 0;
      this.s = b.y;
      this.d = -b.x;
      this.psi = b.angle;
      return;
    }
    // Light bump: keep lane driving, carry the shove as a decaying offset.
    this.speed = Math.max(0, b.vy);
    const newD = -b.x;
    this.bumpOffset += newD - this.d;
    this.bumpPsi = clamp(this.bumpPsi + (-b.vx / Math.max(this.speed, 5)) * 0.5, -0.3, 0.3);
    this.s = b.y;
    this.d = newD;
  }

  /** Sliding, braking rigid-body motion after a crash. */
  updateWreck(dt: number): void {
    this.wreckTime += dt;
    const b = this.body;
    const v = Math.hypot(b.vx, b.vy);
    // Locked wheels on asphalt: ~0.75 g of sliding friction.
    const decel = 0.75 * GRAVITY * dt;
    if (v <= decel) {
      b.vx = 0;
      b.vy = 0;
    } else {
      b.vx -= (b.vx / v) * decel;
      b.vy -= (b.vy / v) * decel;
    }
    b.omega *= Math.exp(-dt * 1.2);
    if (Math.abs(b.omega) < 0.02) b.omega = 0;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.angle += b.omega * dt;
    collideWithBarriers(b, BARRIER_LEFT, BARRIER_RIGHT, 0.2, 0.5, impact, contact);
    this.s = b.y;
    this.d = -b.x;
    this.psi = b.angle;
    this.speed = Math.max(0, b.vy);
    this.accel = -decel / dt;
  }
}
