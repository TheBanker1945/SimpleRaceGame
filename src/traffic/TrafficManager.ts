import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math.ts';
import { Random } from '../core/Random.ts';
import { createBody, createContact, obbContact, resolveContact, type ImpactResult } from '../physics/Collision.ts';
import { bodyToVehicle, vehicleToBody } from '../physics/VehicleBody.ts';
import type { SoundSource } from '../audio/AudioEngine.ts';
import type { VehiclePhysics } from '../vehicle/VehiclePhysics.ts';
import { LANE_COUNT, laneCenter, oppositeLaneCenter } from '../world/RoadConstants.ts';
import type { World } from '../world/World.ts';
import { idmAcceleration, shouldChangeLane, type IdmParams, type LaneChangeParams } from './TrafficAI.ts';
import { TrafficCar } from './TrafficCar.ts';
import type { TrafficRenderer, TrafficVisual } from './TrafficRenderer.ts';
import { TRAFFIC_TYPES, type TrafficType } from './TrafficTypes.ts';

export type TrafficEvent =
  | { kind: 'nearMiss'; car: TrafficCar; gap: number; relativeSpeed: number }
  | { kind: 'collision'; car: TrafficCar; closingSpeed: number; impulse: number }
  | { kind: 'trafficCrash'; car: TrafficCar; closingSpeed: number };

interface OncomingCar {
  id: number;
  type: TrafficType;
  s: number;
  prevS: number;
  lane: number;
  speed: number;
  paint: THREE.Color;
}

/** Road-space proxy of the player for the AI. */
interface PlayerProxy {
  s: number;
  d: number;
  speed: number;
  hl: number;
  hw: number;
}

const PLAYER_IDM: IdmParams = { maxAccel: 3, comfortDecel: 4, headway: 0.8, minGap: 2, maxDecel: 9 };
const LANE_PARAMS: LaneChangeParams = {
  politeness: 0.3,
  threshold: 0.35,
  keepRightBias: 0.25,
  safeDecel: 3.5,
  minGapBehind: 6,
  minGapAhead: 6,
};
const ONCOMING_LANE_SPEEDS = [36, 33, 30, 24.5];
const LOOKAHEAD = 220;
const MAX_CARS = 48;

const tmpCorridor: [number, number] = [0, 0];
const tmpCorridor2: [number, number] = [0, 0];

interface Neighbor {
  gap: number;
  speed: number;
  idm: IdmParams;
  desired: number;
  found: boolean;
}
const LEAD: Neighbor = { gap: Infinity, speed: 0, idm: PLAYER_IDM, desired: 0, found: false };
const FOLLOW: Neighbor = { gap: Infinity, speed: 0, idm: PLAYER_IDM, desired: 0, found: false };

/**
 * Spawns, drives, collides and recycles all traffic. Density and speeds ramp up with
 * run time; vehicles are pooled and rendered through the instanced TrafficRenderer.
 */
export class TrafficManager {
  /** Null when simulating headless (tests). */
  readonly renderer: TrafficRenderer | null;
  readonly active: TrafficCar[] = [];
  readonly events: TrafficEvent[] = [];
  private readonly pool: TrafficCar[] = [];
  private readonly oncoming: OncomingCar[] = [];
  private readonly oncomingPool: OncomingCar[] = [];
  private rng = new Random(12345);
  private readonly playerBody = createBody();
  private readonly contact = createContact();
  private readonly impact: ImpactResult = { closingSpeed: 0, impulse: 0 };
  private readonly player: PlayerProxy = { s: 0, d: 0, speed: 0, hl: 2.3, hw: 0.95 };
  private readonly visual: TrafficVisual = {
    kind: 'sedan',
    position: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    paint: new THREE.Color(),
    brake: 0,
    signalLeft: false,
    signalRight: false,
  };
  private readonly pose = { position: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private spawnDistance = 700;
  private spawnTimer = 0;
  private oncomingTimer = 0;
  private oncomingSerial = 0;
  /** Seconds since the run started; drives difficulty. */
  runTime = 0;
  private simTime = 0;

  constructor(renderer: TrafficRenderer | null) {
    this.renderer = renderer;
    for (let i = 0; i < MAX_CARS; i++) this.pool.push(new TrafficCar());
  }

  /** Seeds the spawner (a fresh stream of traffic per run). */
  seed(seed: number): void {
    this.rng = new Random(seed);
  }

  setDrawDistance(distance: number): void {
    this.spawnDistance = clamp(distance * 0.6, 480, 1000);
  }

  /** Number of cars the road should hold, growing from light traffic to rush hour over ~7 minutes. */
  targetCount(): number {
    return Math.round(lerp(13, 40, smoothstep(0, 420, this.runTime)));
  }

  /** Multiplier on traffic desired speeds (up to +18 %). */
  speedScale(): number {
    return 1 + 0.18 * smoothstep(20, 480, this.runTime);
  }

  /** Share of drivers who misjudge fast cars approaching from behind. */
  carelessShare(): number {
    return lerp(0.05, 0.2, smoothstep(0, 480, this.runTime));
  }

  reset(playerS: number): void {
    for (const car of this.active) this.pool.push(car);
    this.active.length = 0;
    for (const o of this.oncoming) this.oncomingPool.push(o);
    this.oncoming.length = 0;
    this.events.length = 0;
    this.runTime = 0;
    this.spawnTimer = 0;
    // Initial traffic spread ahead of the player, keeping the start clear.
    let s = playerS + 90;
    while (s < playerS + this.spawnDistance && this.active.length < this.targetCount()) {
      this.trySpawnAt(s, false);
      s += this.rng.range(35, 85);
    }
    for (let k = 0; k < 14; k++) this.spawnOncoming(playerS + this.rng.range(-200, this.spawnDistance));
  }

  // ------------------------------------------------------------------ spawning

  private pickType(): TrafficType {
    const weights = TRAFFIC_TYPES.map((t) => t.weight);
    return TRAFFIC_TYPES[this.rng.weighted(weights)];
  }

  private laneFree(s: number, lane: number, clearance: number): boolean {
    const c = laneCenter(lane);
    for (const car of this.active) {
      if (Math.abs(car.s - s) > clearance + car.halfLength) continue;
      car.corridor(tmpCorridor);
      if (tmpCorridor[1] > c - 1.2 && tmpCorridor[0] < c + 1.2) return false;
    }
    if (Math.abs(this.player.s - s) < clearance + 10 && Math.abs(this.player.d - c) < 2.5) return false;
    return true;
  }

  /** Tries to place a random vehicle at distance s. Returns true on success. */
  private trySpawnAt(s: number, fromBehind: boolean): boolean {
    const car = this.pool.pop();
    if (!car) return false;
    const type = this.pickType();
    // Slow vehicles prefer the right lanes; faster cars coming from behind use the left ones.
    let lanes = type.lanes;
    if (fromBehind) lanes = lanes.filter((l) => l <= 1);
    if (lanes.length === 0) {
      this.pool.push(car);
      return false;
    }
    const lane = this.rng.pick(lanes);
    if (!this.laneFree(s, lane, type.isTruck ? 45 : 32)) {
      this.pool.push(car);
      return false;
    }
    const scale = this.speedScale();
    // Left lanes run faster.
    const laneBoost = 1 + (LANE_COUNT - 1 - lane) * 0.035;
    let kmh = this.rng.range(type.speedMin, type.speedMax) * laneBoost;
    if (!type.isTruck) kmh *= scale;
    if (fromBehind) kmh = Math.max(kmh, 128 * scale);
    const desired = kmh / 3.6;
    car.spawn(type, s, lane, desired, desired * this.rng.range(0.92, 1), this.rng.pick(type.paints), this.rng.chance(this.carelessShare()));
    car.relToPlayer = s - this.player.s;
    this.active.push(car);
    return true;
  }

  private spawnOncoming(s: number): void {
    const o = this.oncomingPool.pop() ?? { id: 0, type: TRAFFIC_TYPES[0], s: 0, prevS: 0, lane: 0, speed: 0, paint: new THREE.Color() };
    const type = this.pickType();
    const lanes = type.isTruck ? [2, 3] : [0, 1, 2, 3];
    const lane = this.rng.pick(lanes);
    for (const other of this.oncoming) {
      if (other.lane === lane && Math.abs(other.s - s) < 70) {
        this.oncomingPool.push(o);
        return;
      }
    }
    o.id = 1_000_000 + ++this.oncomingSerial;
    o.type = type;
    o.s = o.prevS = s;
    o.lane = lane;
    o.speed = ONCOMING_LANE_SPEEDS[lane] * (type.isTruck ? 1 : this.speedScale());
    if (type.isTruck) o.speed = Math.min(o.speed, 24.5);
    o.paint.setHex(this.rng.pick(type.paints));
    this.oncoming.push(o);
  }

  // -------------------------------------------------------------------- update

  fixedUpdate(dt: number, playerCar: VehiclePhysics): void {
    this.runTime += dt;
    this.simTime += dt;
    const p = this.player;
    p.s = playerCar.s;
    p.d = playerCar.d;
    p.speed = playerCar.u * Math.cos(playerCar.psi) - playerCar.v * Math.sin(playerCar.psi);
    p.hl = playerCar.cfg.halfLength;
    p.hw = playerCar.cfg.halfWidth;

    const cars = this.active;
    for (const car of cars) car.savePrevious();
    cars.sort((a, b) => a.s - b.s);

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (car.wrecked) {
        car.updateWreck(dt);
        continue;
      }
      car.corridor(tmpCorridor);
      const leader = this.leaderInfo(i, tmpCorridor[0], tmpCorridor[1]);
      let accel = idmAcceleration(car.speed, car.desiredSpeed, leader.gap, car.speed - leader.speed, car.idm);
      if (!Number.isFinite(accel)) accel = 0;
      this.updateLaneLogic(car, i, dt, accel);
      // A car already committed to a lane change also respects the leader in its old lane.
      if (car.changingLanes) {
        const c = laneCenter(car.fromLane);
        const old = this.leaderInfo(i, c - car.halfWidth, c + car.halfWidth);
        if (car.laneT < 0.5) accel = Math.min(accel, idmAcceleration(car.speed, car.desiredSpeed, old.gap, car.speed - old.speed, car.idm));
      }
      car.drive(dt, accel);
    }

    this.collidePlayer(playerCar);
    this.collideTraffic();
    this.detectNearMisses(playerCar);
    this.manageSpawning(dt, playerCar);
    this.updateOncoming(dt);
  }

  /**
   * Nearest vehicle ahead of cars[i] overlapping [lo, hi], including the player and wrecks.
   * Returns a shared object: copy what you need before the next call.
   */
  private leaderInfo(i: number, lo: number, hi: number): Neighbor {
    const cars = this.active;
    const self = cars[i];
    const front = self.s + self.halfLength;
    let bestGap = Infinity;
    let bestSpeed = 0;
    for (let j = i + 1; j < cars.length; j++) {
      const o = cars[j];
      const gap = o.s - o.halfLength - front;
      if (gap > LOOKAHEAD || gap > bestGap) break;
      o.corridor(tmpCorridor2);
      if (tmpCorridor2[1] <= lo || tmpCorridor2[0] >= hi) continue;
      bestGap = gap;
      bestSpeed = o.wrecked ? 0 : o.speed;
      break;
    }
    // Cars slightly behind in the sorted order can still be ahead bumper-wise (long trucks).
    for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
      const o = cars[j];
      if (o.s <= self.s) continue;
      o.corridor(tmpCorridor2);
      if (tmpCorridor2[1] <= lo || tmpCorridor2[0] >= hi) continue;
      const gap = o.s - o.halfLength - front;
      if (gap < bestGap) {
        bestGap = gap;
        bestSpeed = o.speed;
      }
    }
    const p = this.player;
    if (p.s > self.s && p.d + p.hw > lo && p.d - p.hw < hi) {
      const gap = p.s - p.hl - front;
      if (gap < bestGap && gap < LOOKAHEAD) {
        bestGap = gap;
        bestSpeed = Math.max(0, p.speed);
      }
    }
    LEAD.gap = bestGap;
    LEAD.speed = bestSpeed;
    LEAD.found = Number.isFinite(bestGap);
    return LEAD;
  }

  /** Nearest vehicle behind cars[i] overlapping [lo, hi] (shared result object). */
  private followerInfo(i: number, lo: number, hi: number, careless: boolean): Neighbor {
    const cars = this.active;
    const self = cars[i];
    const rear = self.s - self.halfLength;
    FOLLOW.found = false;
    FOLLOW.gap = Infinity;
    for (let j = i - 1; j >= 0; j--) {
      const o = cars[j];
      const gap = rear - (o.s + o.halfLength);
      if (gap > LOOKAHEAD) break;
      o.corridor(tmpCorridor2);
      if (tmpCorridor2[1] <= lo || tmpCorridor2[0] >= hi) continue;
      FOLLOW.found = true;
      FOLLOW.gap = gap;
      FOLLOW.speed = o.wrecked ? 0 : o.speed;
      FOLLOW.idm = o.idm;
      FOLLOW.desired = o.desiredSpeed;
      break;
    }
    const p = this.player;
    if (p.s < self.s && p.d + p.hw > lo && p.d - p.hw < hi) {
      const gap = rear - (p.s + p.hl);
      // Careless drivers only notice the player once they are right alongside.
      const noticed = !careless || gap < 18;
      if (noticed && gap < FOLLOW.gap) {
        FOLLOW.found = true;
        FOLLOW.gap = gap;
        FOLLOW.speed = p.speed;
        FOLLOW.idm = PLAYER_IDM;
        FOLLOW.desired = Math.max(p.speed, 1);
      }
    }
    return FOLLOW;
  }

  private updateLaneLogic(car: TrafficCar, i: number, dt: number, accelCurrent: number): void {
    if (car.pendingLane >= 0) {
      car.signalTimer -= dt;
      if (car.signalTimer <= 0) {
        // Final shoulder check before moving over.
        if (this.laneChangeSafe(car, i, car.pendingLane)) car.beginLaneChange(car.pendingLane);
        else {
          car.pendingLane = -1;
          car.signal = 0;
          car.decisionTimer = 1 + Math.random();
        }
      }
      return;
    }
    if (car.changingLanes) return;
    car.decisionTimer -= dt;
    if (car.decisionTimer > 0) return;
    car.decisionTimer = 0.7 + Math.random() * 1.6;

    let bestLane = -1;
    let bestScore = -Infinity;
    for (const dir of [1, -1]) {
      // dir +1 = toward the right (higher lane index).
      const target = car.lane + dir;
      if (target < 0 || target >= LANE_COUNT || !car.type.lanes.includes(target)) continue;
      const c = laneCenter(target);
      const lo = c - car.halfWidth - 0.3;
      const hi = c + car.halfWidth + 0.3;
      const leader = this.leaderInfo(i, lo, hi);
      const gapAhead = leader.gap;
      const accelTarget = idmAcceleration(car.speed, car.desiredSpeed, leader.gap, car.speed - leader.speed, car.idm);
      const follower = this.followerInfo(i, lo, hi, car.careless);
      let followerBefore = 0;
      let followerAfter = 0;
      let gapBehind = Infinity;
      if (follower.found) {
        gapBehind = follower.gap;
        followerBefore = idmAcceleration(follower.speed, follower.desired, Infinity, 0, follower.idm);
        followerAfter = idmAcceleration(follower.speed, follower.desired, follower.gap, follower.speed - car.speed, follower.idm);
      }
      const params = car.type.isTruck ? { ...LANE_PARAMS, keepRightBias: 0.45, politeness: car.politeness } : { ...LANE_PARAMS, politeness: car.politeness };
      // Now and then a driver changes lanes on a whim.
      if (Math.random() < 0.04) params.threshold = -0.1;
      const ok = shouldChangeLane(
        { accelCurrent, accelTarget, followerBefore, followerAfter, gapBehind, gapAhead, direction: dir },
        params,
      );
      if (!ok) continue;
      const score = accelTarget - accelCurrent + (dir > 0 ? 0.1 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestLane = target;
      }
    }
    if (bestLane >= 0) {
      car.pendingLane = bestLane;
      car.signal = bestLane < car.lane ? 1 : -1;
      car.signalTimer = 1.1 + Math.random() * 1.3;
    }
  }

  private laneChangeSafe(car: TrafficCar, i: number, target: number): boolean {
    const c = laneCenter(target);
    const lo = c - car.halfWidth - 0.3;
    const hi = c + car.halfWidth + 0.3;
    const leader = this.leaderInfo(i, lo, hi);
    if (leader.gap < LANE_PARAMS.minGapAhead) return false;
    const follower = this.followerInfo(i, lo, hi, car.careless);
    if (!follower.found) return true;
    if (follower.gap < LANE_PARAMS.minGapBehind) return false;
    const after = idmAcceleration(follower.speed, follower.desired, follower.gap, follower.speed - car.speed, follower.idm);
    return after > -LANE_PARAMS.safeDecel * (car.careless ? 2.2 : 1);
  }

  // ---------------------------------------------------------------- collisions

  private collidePlayer(playerCar: VehiclePhysics): void {
    const pb = vehicleToBody(playerCar, this.playerBody);
    let touched = false;
    for (const car of this.active) {
      if (Math.abs(car.s - playerCar.s) > car.halfLength + 4) continue;
      const cb = car.syncBody();
      if (!obbContact(pb, cb, this.contact)) continue;
      resolveContact(pb, cb, this.contact, 0.18, 0.35, this.impact);
      touched = true;
      car.applyBody(this.impact.closingSpeed);
      if (this.impact.closingSpeed > 0.3 && this.simTime - car.lastPlayerContact > 0.25) {
        this.events.push({ kind: 'collision', car, closingSpeed: this.impact.closingSpeed, impulse: this.impact.impulse });
      }
      car.lastPlayerContact = this.simTime;
    }
    if (touched) bodyToVehicle(pb, playerCar);
  }

  private collideTraffic(): void {
    const cars = this.active;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (b.s - a.s > a.halfLength + b.halfLength + 1) break;
        if (Math.abs(a.d - b.d) > a.halfWidth + b.halfWidth + 3) continue;
        const ba = a.syncBody();
        const bb = b.syncBody();
        if (!obbContact(ba, bb, this.contact)) continue;
        resolveContact(ba, bb, this.contact, 0.15, 0.4, this.impact);
        const wasA = a.wrecked;
        const wasB = b.wrecked;
        a.applyBody(this.impact.closingSpeed);
        b.applyBody(this.impact.closingSpeed);
        if ((!wasA && a.wrecked) || (!wasB && b.wrecked)) {
          this.events.push({ kind: 'trafficCrash', car: a.wrecked && !wasA ? a : b, closingSpeed: this.impact.closingSpeed });
        }
      }
    }
  }

  /**
   * A near miss is scored when the player overtakes a car with less than 1.2 m between
   * their sides, fast, and without touching it.
   */
  private detectNearMisses(playerCar: VehiclePhysics): void {
    const p = this.player;
    for (const car of this.active) {
      const rel = car.s - p.s;
      if (!car.wrecked && !car.nearMissDone && car.relToPlayer > 0 && rel <= 0) {
        const lateralGap = Math.abs(car.d - p.d) - car.halfWidth - p.hw;
        const relSpeed = p.speed - car.speed;
        const recentlyTouched = this.simTime - car.lastPlayerContact < 2;
        if (lateralGap < 1.2 && lateralGap > -0.2 && relSpeed > 4 && playerCar.speed > 60 / 3.6 && !recentlyTouched) {
          car.nearMissDone = true;
          this.events.push({ kind: 'nearMiss', car, gap: Math.max(0, lateralGap), relativeSpeed: relSpeed });
        }
      }
      car.relToPlayer = rel;
    }
  }

  private manageSpawning(dt: number, playerCar: VehiclePhysics): void {
    const p = this.player;
    // Despawn far behind or far ahead.
    for (let i = this.active.length - 1; i >= 0; i--) {
      const car = this.active[i];
      const rel = car.s - p.s;
      // Cars far ahead that are pulling away will never be seen again: recycle them early so
      // the budget goes to traffic the player can actually meet.
      const leaving = rel > this.spawnDistance * 0.85 && car.speed > p.speed + 3;
      if (rel < -280 || rel > this.spawnDistance + 320 || leaving) {
        this.active.splice(i, 1);
        this.pool.push(car);
      }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.active.length >= this.targetCount()) return;
    this.spawnTimer = 0.12;
    const avgTraffic = 30 * this.speedScale();
    const slow = p.speed < avgTraffic - 4;
    if (slow && this.rng.chance(0.55)) {
      this.trySpawnAt(p.s - this.rng.range(180, 240), true);
    } else if (playerCar.speed > 5 || this.rng.chance(0.3)) {
      this.trySpawnAt(p.s + this.spawnDistance - this.rng.range(0, 80), false);
    }
  }

  private updateOncoming(dt: number): void {
    for (let i = this.oncoming.length - 1; i >= 0; i--) {
      const o = this.oncoming[i];
      o.prevS = o.s;
      o.s -= o.speed * dt;
      if (o.s < this.player.s - 260) {
        this.oncoming.splice(i, 1);
        this.oncomingPool.push(o);
      }
    }
    this.oncomingTimer -= dt;
    if (this.oncomingTimer <= 0 && this.oncoming.length < 16) {
      this.oncomingTimer = 0.35;
      this.spawnOncoming(this.player.s + this.spawnDistance - this.rng.range(0, 60));
    }
  }

  // --------------------------------------------------------------------- render

  render(alpha: number, world: World, camera: THREE.Camera, night: boolean): void {
    const r = this.renderer;
    if (!r) return;
    r.night = night;
    r.begin();
    const blink = this.simTime % 0.8 < 0.45;
    const v = this.visual;
    for (const car of this.active) {
      const s = lerp(car.prevS, car.s, alpha);
      const d = lerp(car.prevD, car.d, alpha);
      const psi = lerp(car.prevPsi, car.psi, alpha);
      world.poseAt(s, d, psi, this.pose);
      v.kind = car.type.kind;
      v.position.copy(this.pose.position);
      v.yaw = this.pose.yaw;
      // Braking dips the nose slightly; road grade pitches the whole vehicle.
      v.pitch = this.pose.pitch * Math.cos(psi) + clamp(-car.accel * 0.004, -0.01, 0.02);
      v.roll = this.pose.pitch * Math.sin(psi);
      v.paint.copy(car.paint);
      v.brake = car.wrecked ? (car.speed > 0.5 ? 1 : 0) : car.accel < -0.7 ? clamp(-car.accel / 3, 0.35, 1) : 0;
      v.signalLeft = car.wrecked ? true : car.signal > 0;
      v.signalRight = car.wrecked ? true : car.signal < 0;
      r.draw(v, camera, blink);
    }
    for (const o of this.oncoming) {
      const s = lerp(o.prevS, o.s, alpha);
      world.poseAt(s, oppositeLaneCenter(o.lane), Math.PI, this.pose);
      v.kind = o.type.kind;
      v.position.copy(this.pose.position);
      v.yaw = this.pose.yaw;
      v.pitch = -this.pose.pitch;
      v.roll = 0;
      v.paint.copy(o.paint);
      v.brake = 0;
      v.signalLeft = false;
      v.signalRight = false;
      r.draw(v, camera, blink);
    }
    r.end();
  }

  /**
   * Fills `out` with render-space positions of nearby vehicles for the audio engine
   * (both carriageways). Reuses the objects already in `out`.
   */
  collectSoundSources(world: World, alpha: number, focusS: number, out: SoundSource[]): number {
    let n = 0;
    const take = (): SoundSource => {
      if (n >= out.length) out.push({ id: 0, position: new THREE.Vector3(), hum: 80, loudness: 1, speed: 0 });
      return out[n++];
    };
    for (const car of this.active) {
      if (Math.abs(car.s - focusS) > 180) continue;
      const src = take();
      src.id = car.id;
      world.toRender(lerp(car.prevS, car.s, alpha), lerp(car.prevD, car.d, alpha), src.position, 0.8);
      src.hum = car.type.humFrequency;
      src.loudness = car.type.loudness;
      src.speed = car.speed;
    }
    for (const o of this.oncoming) {
      if (Math.abs(o.s - focusS) > 180) continue;
      const src = take();
      src.id = o.id;
      world.toRender(lerp(o.prevS, o.s, alpha), oppositeLaneCenter(o.lane), src.position, 0.8);
      src.hum = o.type.humFrequency;
      src.loudness = o.type.loudness * 0.8;
      src.speed = o.speed;
    }
    return n;
  }
}
