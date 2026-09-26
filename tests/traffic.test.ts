import { describe, expect, it } from 'vitest';
import { idmAcceleration, laneChangeProfile, laneChangeRate, shouldChangeLane, type IdmParams } from '../src/traffic/TrafficAI.ts';
import { TrafficManager } from '../src/traffic/TrafficManager.ts';
import { DEFAULT_VEHICLE } from '../src/vehicle/VehicleConfig.ts';
import { FLAT_ROAD, VehiclePhysics } from '../src/vehicle/VehiclePhysics.ts';
import { laneCenter } from '../src/world/RoadConstants.ts';

const P: IdmParams = { maxAccel: 1.8, comfortDecel: 2.5, headway: 1.4, minGap: 2.5, maxDecel: 8 };

describe('intelligent driver model', () => {
  it('accelerates on a free road and levels off at the desired speed', () => {
    expect(idmAcceleration(10, 30, Infinity, 0, P)).toBeGreaterThan(1.5);
    expect(Math.abs(idmAcceleration(30, 30, Infinity, 0, P))).toBeLessThan(0.01);
    expect(idmAcceleration(35, 30, Infinity, 0, P)).toBeLessThan(0);
  });

  it('brakes when closing on a slower leader and more when closer', () => {
    const far = idmAcceleration(30, 33, 80, 8, P);
    const near = idmAcceleration(30, 33, 25, 8, P);
    expect(near).toBeLessThan(far);
    expect(near).toBeLessThan(-2);
  });

  it('never brakes harder than its limit', () => {
    expect(idmAcceleration(40, 40, 0.5, 40, P)).toBeGreaterThanOrEqual(-P.maxDecel);
  });

  it('follows a leader at a stable distance without colliding', () => {
    // Leader brakes from 30 to 10 m/s; follower must stay behind it.
    let ls = 60;
    let lv = 30;
    let fs = 0;
    let fv = 30;
    let minGap = Infinity;
    for (let t = 0; t < 40; t += 0.02) {
      const la = t > 5 && lv > 10 ? -4 : 0;
      lv = Math.max(10, lv + la * 0.02);
      ls += lv * 0.02;
      const gap = ls - fs - 4.7;
      minGap = Math.min(minGap, gap);
      fv = Math.max(0, fv + idmAcceleration(fv, 33, gap, fv - lv, P) * 0.02);
      fs += fv * 0.02;
    }
    expect(minGap).toBeGreaterThan(P.minGap);
    expect(Math.abs(fv - lv)).toBeLessThan(0.5);
  });
});

describe('lane change decision', () => {
  const params = { politeness: 0.3, threshold: 0.3, keepRightBias: 0.2, safeDecel: 3.5, minGapBehind: 6, minGapAhead: 6 };

  it('changes when the target lane is clearly better and safe', () => {
    expect(
      shouldChangeLane(
        { accelCurrent: -2, accelTarget: 1, followerBefore: 0.5, followerAfter: 0.2, gapBehind: 40, gapAhead: 80, direction: -1 },
        params,
      ),
    ).toBe(true);
  });

  it('refuses when the new follower would have to brake hard', () => {
    expect(
      shouldChangeLane(
        { accelCurrent: -2, accelTarget: 1, followerBefore: 0.5, followerAfter: -5, gapBehind: 40, gapAhead: 80, direction: -1 },
        params,
      ),
    ).toBe(false);
  });

  it('refuses when there is no physical gap', () => {
    expect(
      shouldChangeLane(
        { accelCurrent: -2, accelTarget: 1, followerBefore: 0, followerAfter: 0, gapBehind: 3, gapAhead: 80, direction: 1 },
        params,
      ),
    ).toBe(false);
  });

  it('keep-right bias returns cars to the slow lane when nothing is lost', () => {
    const base = { accelCurrent: 0.2, accelTarget: 0.35, followerBefore: 0, followerAfter: 0, gapBehind: 50, gapAhead: 90 };
    expect(shouldChangeLane({ ...base, direction: 1 }, params)).toBe(true);
    expect(shouldChangeLane({ ...base, direction: -1 }, params)).toBe(false);
  });

  it('lane change profile is smooth with zero lateral speed at both ends', () => {
    expect(laneChangeProfile(0)).toBe(0);
    expect(laneChangeProfile(1)).toBe(1);
    expect(laneChangeProfile(0.5)).toBeCloseTo(0.5);
    expect(laneChangeRate(0)).toBe(0);
    expect(laneChangeRate(1)).toBe(0);
    let prev = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      expect(laneChangeProfile(t)).toBeGreaterThanOrEqual(prev);
      prev = laneChangeProfile(t);
    }
  });
});

describe('traffic manager (headless simulation)', () => {
  const PLAYER_IDM: IdmParams = { maxAccel: 3, comfortDecel: 3.5, headway: 1.0, minGap: 3, maxDecel: 9 };

  /**
   * @param playerLane lane the test driver keeps (or null to park it on the shoulder,
   *   invisible to traffic, so only AI-to-AI behavior is measured)
   */
  const simulate = (seconds: number, playerKmh: number, playerLane: number | null, seed = 7) => {
    const traffic = new TrafficManager(null);
    traffic.seed(seed);
    const player = new VehiclePhysics(DEFAULT_VEHICLE);
    const d = playerLane === null ? -9.2 : laneCenter(playerLane);
    player.reset(100, d, playerKmh / 3.6);
    traffic.reset(player.s);
    let crashes = 0;
    let collisions = 0;
    let laneChanges = 0;
    let maxCount = 0;
    let speed = playerKmh / 3.6;
    const lanes = new Map<number, number>();
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      // The test driver keeps its lane and follows whatever is ahead with IDM.
      let gap = Infinity;
      let leadSpeed = 0;
      for (const car of traffic.active) {
        if (Math.abs(car.d - d) > car.halfWidth + 1.2) continue;
        const g = car.s - car.halfLength - (player.s + 2.33);
        if (g > -2 && g < gap) {
          gap = g;
          leadSpeed = car.speed;
        }
      }
      speed = Math.max(0, speed + idmAcceleration(speed, playerKmh / 3.6, gap, speed - leadSpeed, PLAYER_IDM) * dt);
      player.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, FLAT_ROAD);
      player.u = speed;
      player.d = d;
      player.psi = 0;
      player.v = 0;
      player.r = 0;
      traffic.fixedUpdate(dt, player);
      for (const e of traffic.events) {
        if (e.kind === 'trafficCrash') crashes++;
        if (e.kind === 'collision') collisions++;
      }
      traffic.events.length = 0;
      for (const car of traffic.active) {
        const prev = lanes.get(car.id);
        if (prev !== undefined && prev !== car.lane) laneChanges++;
        lanes.set(car.id, car.lane);
      }
      maxCount = Math.max(maxCount, traffic.active.length);
    }
    return { traffic, crashes, collisions, laneChanges, maxCount };
  };

  it('AI traffic drives for minutes without ever crashing into itself', () => {
    for (const seed of [1, 2, 3]) {
      const r = simulate(240, 105, null, seed);
      expect(r.crashes).toBe(0);
      expect(r.laneChanges).toBeGreaterThan(5);
      expect(r.maxCount).toBeGreaterThan(10);
    }
  });

  it('a careful driver sharing the road is not hit by traffic', () => {
    for (const seed of [4, 5]) {
      const r = simulate(180, 110, 2, seed);
      expect(r.crashes).toBe(0);
      expect(r.collisions).toBe(0);
    }
  });

  it('density grows with run time', () => {
    const traffic = new TrafficManager(null);
    const start = traffic.targetCount();
    traffic.runTime = 400;
    expect(traffic.targetCount()).toBeGreaterThan(start * 2);
    expect(traffic.speedScale()).toBeGreaterThan(1.1);
  });

  it('recycles vehicles through the pool instead of allocating', () => {
    const r = simulate(60, 200, null);
    expect(r.traffic.active.length).toBeLessThanOrEqual(48);
  });
});
