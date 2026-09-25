import { describe, expect, it } from 'vitest';
import { KMH_TO_MS, MS_TO_KMH } from '../src/core/math.ts';
import { DEFAULT_VEHICLE, type VehicleConfig } from '../src/vehicle/VehicleConfig.ts';
import { FLAT_ROAD, VehiclePhysics, type DriverInput, type RoadProfile } from '../src/vehicle/VehiclePhysics.ts';

const DT = 1 / 120;

const makeCar = (cfg: VehicleConfig = DEFAULT_VEHICLE, kmh = 0): VehiclePhysics => {
  const car = new VehiclePhysics(cfg);
  car.reset(0, 0, kmh * KMH_TO_MS);
  return car;
};

const input = (partial: Partial<DriverInput>): DriverInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, ...partial });

/** Runs until `until` returns true or the time limit passes; returns elapsed seconds. */
const run = (car: VehiclePhysics, controls: DriverInput, maxTime: number, until?: () => boolean, road: RoadProfile = FLAT_ROAD): number => {
  let t = 0;
  while (t < maxTime) {
    car.update(DT, controls, road);
    t += DT;
    if (until?.()) break;
  }
  return t;
};

describe('longitudinal performance', () => {
  it('accelerates 0-100 km/h in a sports-car time (4-6 s)', () => {
    const car = makeCar();
    const t = run(car, input({ throttle: 1 }), 15, () => car.u * MS_TO_KMH >= 100);
    expect(t).toBeGreaterThan(4);
    expect(t).toBeLessThan(6);
  });

  it('reaches a top speed around 280 km/h', () => {
    const car = makeCar(DEFAULT_VEHICLE, 200);
    run(car, input({ throttle: 1 }), 120);
    const top = car.u * MS_TO_KMH;
    expect(top).toBeGreaterThan(268);
    expect(top).toBeLessThan(292);
    expect(car.gearbox.gear).toBe(6);
  });

  it('uses every gear on a full-throttle run and never exceeds the limiter', () => {
    const car = makeCar();
    const gears = new Set<number>();
    let maxRpm = 0;
    run(car, input({ throttle: 1 }), 50, () => {
      gears.add(car.gearbox.gear);
      maxRpm = Math.max(maxRpm, car.rpm);
      return false;
    });
    expect([...gears].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(maxRpm).toBeLessThan(DEFAULT_VEHICLE.limiterRPM + 200);
  });

  it('brakes from 100 km/h in a realistic distance (32-40 m with ABS)', () => {
    const car = makeCar(DEFAULT_VEHICLE, 100);
    run(car, input({ brake: 1 }), 10, () => car.u < 0.05);
    expect(car.s).toBeGreaterThan(32);
    expect(car.s).toBeLessThan(40);
  });

  it('locks the wheels and stops later without ABS', () => {
    const withAbs = makeCar(DEFAULT_VEHICLE, 100);
    run(withAbs, input({ brake: 1 }), 10, () => withAbs.u < 0.05);
    const noAbs = makeCar(DEFAULT_VEHICLE, 100);
    noAbs.absEnabled = false;
    let locked = false;
    run(noAbs, input({ brake: 1 }), 10, () => {
      if (noAbs.omegaFront === 0 && noAbs.u > 5) locked = true;
      return noAbs.u < 0.05;
    });
    expect(locked).toBe(true);
    expect(noAbs.s).toBeGreaterThan(withAbs.s);
  });

  it('slows down from engine braking and drag when coasting', () => {
    const car = makeCar(DEFAULT_VEHICLE, 150);
    run(car, input({}), 5);
    expect(car.u * MS_TO_KMH).toBeLessThan(135);
    expect(car.u * MS_TO_KMH).toBeGreaterThan(90);
  });

  it('bounces off the rev limiter in manual 1st gear', () => {
    const car = makeCar();
    car.gearbox.mode = 'manual';
    let cuts = 0;
    let wasCutting = false;
    run(car, input({ throttle: 1 }), 6, () => {
      if (car.limiter.cutting && !wasCutting) cuts++;
      wasCutting = car.limiter.cutting;
      return false;
    });
    expect(car.gearbox.gear).toBe(1);
    expect(cuts).toBeGreaterThan(3);
    expect(car.rpm).toBeGreaterThan(DEFAULT_VEHICLE.limiterRPM - 400);
  });

  it('selects reverse when holding the brake at a standstill (automatic) and backs up', () => {
    const car = makeCar();
    run(car, input({ brake: 1 }), 2);
    expect(car.gearbox.gear).toBe(-1);
    run(car, input({ brake: 1 }), 2);
    expect(car.u).toBeLessThan(-1);
    run(car, input({ throttle: 1 }), 3);
    expect(car.gearbox.gear).toBeGreaterThan(0);
  });

  it('slows down climbing a grade', () => {
    const uphill: RoadProfile = { ...FLAT_ROAD, grade: () => 0.06 };
    const flat = makeCar(DEFAULT_VEHICLE, 100);
    const hill = makeCar(DEFAULT_VEHICLE, 100);
    run(flat, input({}), 4);
    run(hill, input({}), 4, undefined, uphill);
    // 6% grade ≈ 0.59 m/s² of extra deceleration → ~2.3 m/s over 4 s.
    expect(hill.u).toBeLessThan(flat.u - 1.8);
  });
});

describe('weight transfer and suspension', () => {
  it('nose dives under braking and the front tires carry more load', () => {
    const car = makeCar(DEFAULT_VEHICLE, 120);
    run(car, input({ brake: 1 }), 0.6);
    expect(car.pitch).toBeGreaterThan(0.01);
    const front = car.wheels[0].fz + car.wheels[1].fz;
    const rear = car.wheels[2].fz + car.wheels[3].fz;
    expect(front).toBeGreaterThan(rear * 1.5);
  });

  it('squats under acceleration', () => {
    const car = makeCar(DEFAULT_VEHICLE, 30);
    run(car, input({ throttle: 1 }), 0.8);
    expect(car.pitch).toBeLessThan(-0.005);
    const front = car.wheels[0].fz + car.wheels[1].fz;
    const rear = car.wheels[2].fz + car.wheels[3].fz;
    expect(rear).toBeGreaterThan(front);
  });

  it('rolls toward the outside of a turn and loads the outside tires', () => {
    const car = makeCar(DEFAULT_VEHICLE, 90);
    run(car, input({ steer: 0.6, throttle: 0.3 }), 1.5);
    // Turning left: body rolls right (positive roll), right tires are loaded.
    expect(car.r).toBeGreaterThan(0);
    expect(car.roll).toBeGreaterThan(0.01);
    expect(car.wheels[1].fz).toBeGreaterThan(car.wheels[0].fz);
    expect(car.wheels[3].fz).toBeGreaterThan(car.wheels[2].fz);
  });

  it('settles back to level after the input stops', () => {
    const car = makeCar(DEFAULT_VEHICLE, 90);
    run(car, input({ brake: 1 }), 0.5);
    run(car, input({ throttle: 0.2 }), 3);
    expect(Math.abs(car.pitch)).toBeLessThan(0.006);
    expect(Math.abs(car.roll)).toBeLessThan(0.002);
  });

  it('keeps the total wheel load equal to the weight in steady state', () => {
    const car = makeCar(DEFAULT_VEHICLE, 0);
    run(car, input({}), 1);
    const total = car.wheels.reduce((sum, w) => sum + w.fz, 0);
    expect(total).toBeCloseTo(DEFAULT_VEHICLE.mass * 9.81, -1);
  });
});

describe('handling', () => {
  it('steering lock shrinks with speed', () => {
    const car = makeCar();
    expect(car.maxSteerAt(5)).toBeCloseTo(DEFAULT_VEHICLE.maxSteerAngle);
    expect(car.maxSteerAt(30)).toBeLessThan(car.maxSteerAt(15));
    expect(car.maxSteerAt(75)).toBeLessThan(0.12);
  });

  it('understeers at the limit: front tires slide more than the rears', () => {
    for (const kmh of [80, 140, 200]) {
      const car = makeCar(DEFAULT_VEHICLE, kmh);
      run(car, input({ steer: 1, throttle: 0.35 }), 2.5);
      const front = (car.wheels[0].slip + car.wheels[1].slip) / 2;
      const rear = (car.wheels[2].slip + car.wheels[3].slip) / 2;
      expect(front).toBeGreaterThan(rear);
      expect(front).toBeGreaterThan(0.95);
    }
  });

  it('corners at close to 1 g at the limit', () => {
    const car = makeCar(DEFAULT_VEHICLE, 120);
    let maxAy = 0;
    run(car, input({ steer: 1, throttle: 0.4 }), 3, () => {
      maxAy = Math.max(maxAy, Math.abs(car.ay));
      return false;
    });
    expect(maxAy / 9.81).toBeGreaterThan(0.9);
    expect(maxAy / 9.81).toBeLessThan(1.25);
  });

  it('stays controllable in a quick lane change at 250 km/h', () => {
    const car = makeCar(DEFAULT_VEHICLE, 250);
    let maxSideslip = 0;
    const track = (): boolean => {
      maxSideslip = Math.max(maxSideslip, Math.abs(Math.atan2(car.v, car.u)));
      return false;
    };
    run(car, input({ steer: 0.7, throttle: 0.8 }), 0.5, track);
    run(car, input({ steer: -0.7, throttle: 0.8 }), 0.6, track);
    run(car, input({ steer: 0, throttle: 0.8 }), 2, track);
    expect(maxSideslip).toBeLessThan(0.09);
    expect(Math.abs(car.r)).toBeLessThan(0.05);
    expect(car.u * MS_TO_KMH).toBeGreaterThan(230);
  });

  it('without driver aids a violent flick at 250 km/h slides much more than with ESC', () => {
    const flick = (aids: boolean): number => {
      const car = makeCar(DEFAULT_VEHICLE, 250);
      car.escEnabled = car.tcsEnabled = car.absEnabled = aids;
      let maxSideslip = 0;
      const track = (): boolean => {
        maxSideslip = Math.max(maxSideslip, Math.abs(Math.atan2(car.v, Math.abs(car.u))));
        return false;
      };
      run(car, input({ steer: 1, throttle: 0.8 }), 0.6, track);
      run(car, input({ steer: -1, throttle: 0.8 }), 0.6, track);
      run(car, input({ steer: 0, throttle: 0.8 }), 2, track);
      return maxSideslip;
    };
    const withEsc = flick(true);
    const withoutEsc = flick(false);
    expect(withEsc).toBeLessThan(0.12);
    expect(withoutEsc).toBeGreaterThan(withEsc * 3);
  });

  it('ESC does not remove understeer or limit cornering grip', () => {
    const grip = (esc: boolean): number => {
      const car = makeCar(DEFAULT_VEHICLE, 120);
      car.escEnabled = esc;
      let maxAy = 0;
      run(car, input({ steer: 1, throttle: 0.4 }), 3, () => {
        maxAy = Math.max(maxAy, Math.abs(car.ay));
        return false;
      });
      return maxAy;
    };
    expect(grip(true)).toBeGreaterThan(grip(false) * 0.95);
  });

  it('loses cornering grip when braking hard while steering', () => {
    const cornering = makeCar(DEFAULT_VEHICLE, 130);
    run(cornering, input({ steer: 1, throttle: 0.4 }), 1.2);
    const braking = makeCar(DEFAULT_VEHICLE, 130);
    run(braking, input({ steer: 1, brake: 1 }), 1.2);
    expect(Math.abs(braking.ay)).toBeLessThan(Math.abs(cornering.ay));
  });

  it('the handbrake at speed makes the car rotate (oversteer)', () => {
    const car = makeCar(DEFAULT_VEHICLE, 90);
    run(car, input({ steer: 0.4, handbrake: 1 }), 1.2);
    expect(Math.abs(car.psi)).toBeGreaterThan(0.6);
    expect(car.wheels[2].slip).toBeGreaterThan(2);
  });

  it('goes straight when there is no input', () => {
    const car = makeCar(DEFAULT_VEHICLE, 180);
    run(car, input({ throttle: 0.6 }), 5);
    expect(Math.abs(car.d)).toBeLessThan(0.01);
    expect(Math.abs(car.psi)).toBeLessThan(0.001);
  });

  it('follows a curved road only when steered (Frenet kinematics)', () => {
    const curve: RoadProfile = { ...FLAT_ROAD, curvature: () => 1 / 500 };
    const car = makeCar(DEFAULT_VEHICLE, 100);
    run(car, input({ throttle: 0.4 }), 3, undefined, curve);
    // Unsteered, the car drifts to the outside (right) of a left-hand bend.
    expect(car.d).toBeLessThan(-3);
  });
});

describe('determinism', () => {
  it('produces identical results for identical inputs', () => {
    const a = makeCar(DEFAULT_VEHICLE, 50);
    const b = makeCar(DEFAULT_VEHICLE, 50);
    const controls = input({ throttle: 0.8, steer: 0.3 });
    run(a, controls, 3);
    run(b, controls, 3);
    expect(a.s).toBe(b.s);
    expect(a.d).toBe(b.d);
    expect(a.r).toBe(b.r);
  });
});
