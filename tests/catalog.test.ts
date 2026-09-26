import { describe, expect, it } from 'vitest';
import { KMH_TO_MS, MS_TO_KMH } from '../src/core/math.ts';
import { CAR_IDS, CARS, DEFAULT_CAR, getCar, isCarId } from '../src/vehicle/CarCatalog.ts';
import { Gearbox } from '../src/vehicle/Gearbox.ts';
import { enginePowerKW } from '../src/vehicle/Engine.ts';
import { DEFAULT_VEHICLE } from '../src/vehicle/VehicleConfig.ts';
import { FLAT_ROAD, VehiclePhysics, type DriverInput } from '../src/vehicle/VehiclePhysics.ts';

const DT = 1 / 120;
const input = (partial: Partial<DriverInput>): DriverInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, ...partial });

describe('car catalog', () => {
  it('has unique ids and a valid default', () => {
    expect(new Set(CAR_IDS).size).toBe(CARS.length);
    expect(CARS.length).toBeGreaterThanOrEqual(5);
    expect(isCarId(DEFAULT_CAR)).toBe(true);
    expect(isCarId('nope')).toBe(false);
    expect(getCar('kestrel').config).toBe(DEFAULT_VEHICLE);
  });

  for (const car of CARS) {
    describe(car.name, () => {
      const cfg = car.config;

      it('advertises its real peak power (±4 %)', () => {
        let peak = 0;
        for (let rpm = 1000; rpm <= cfg.limiterRPM; rpm += 50) peak = Math.max(peak, enginePowerKW(cfg, rpm));
        const hp = peak * 1.341;
        expect(Math.abs(hp - car.specs.powerHp) / car.specs.powerHp).toBeLessThan(0.04);
        expect(car.specs.gears).toBe(cfg.gearRatios.length);
      });

      it('lets the automatic upshift through every gear before the limiter', () => {
        const gb = new Gearbox(cfg);
        for (let g = 1; g < gb.topGear; g++) {
          // Wheel speed where this gear hits the limiter: the next gear must not ask to shift straight back.
          const omega = (cfg.limiterRPM * Math.PI * 2) / 60 / (cfg.gearRatios[g - 1] * cfg.finalDrive);
          expect(gb.rpmAt(g + 1, omega)).toBeGreaterThan(gb.downshiftRPM(1, 0) + 250);
        }
      });

      it('matches its advertised 0-100 km/h time (±0.3 s)', () => {
        const v = new VehiclePhysics(cfg);
        v.reset(0, 0, 0);
        let t = 0;
        while (t < 15 && v.u * MS_TO_KMH < 100) {
          v.update(DT, input({ throttle: 1 }), FLAT_ROAD);
          t += DT;
        }
        expect(Math.abs(t - car.specs.zeroToHundred)).toBeLessThan(0.3);
      });

      it('matches its advertised top speed (±2 %) without passing the limiter', () => {
        const v = new VehiclePhysics(cfg);
        v.reset(0, 0, 200 * KMH_TO_MS);
        let maxRpm = 0;
        for (let i = 0; i < 120 * 150; i++) {
          v.update(DT, input({ throttle: 1 }), FLAT_ROAD);
          maxRpm = Math.max(maxRpm, v.rpm);
        }
        const top = v.u * MS_TO_KMH;
        expect(Math.abs(top - car.specs.topSpeedKmh) / car.specs.topSpeedKmh).toBeLessThan(0.02);
        expect(v.gearbox.gear).toBe(v.gearbox.topGear);
        expect(maxRpm).toBeLessThan(cfg.limiterRPM + 200);
      });

      it('stops from 100 km/h in 28-38 m with ABS', () => {
        const v = new VehiclePhysics(cfg);
        v.reset(0, 0, 100 * KMH_TO_MS);
        let t = 0;
        while (t < 10 && v.u > 0.05) {
          v.update(DT, input({ brake: 1 }), FLAT_ROAD);
          t += DT;
        }
        expect(v.s).toBeGreaterThan(28);
        expect(v.s).toBeLessThan(38);
      });

      it('changes lanes at 250 km/h without driving aids and settles straight', () => {
        const kmh = Math.min(250, car.specs.topSpeedKmh - 15);
        const v = new VehiclePhysics(cfg);
        v.reset(0, 0, kmh * KMH_TO_MS);
        v.absEnabled = v.tcsEnabled = v.escEnabled = false;
        let t = 0;
        let maxPsi = 0;
        while (t < 6) {
          const steer = t < 0.6 ? 0.35 : t < 1.2 ? -0.35 : 0;
          v.update(DT, input({ throttle: 0.5, steer }), FLAT_ROAD);
          maxPsi = Math.max(maxPsi, Math.abs(v.psi));
          t += DT;
        }
        expect(maxPsi).toBeLessThan(0.35);
        expect(Math.abs(v.r)).toBeLessThan(0.02);
        expect(Number.isFinite(v.s) && Number.isFinite(v.d)).toBe(true);
      });

      it('has sane ratings and dimensions', () => {
        for (const r of Object.values(car.ratings)) {
          expect(r).toBeGreaterThan(0);
          expect(r).toBeLessThanOrEqual(1);
        }
        expect(cfg.halfWidth * 2).toBeGreaterThan(Math.max(cfg.trackFront, cfg.trackRear));
        expect(cfg.halfLength * 2).toBeGreaterThan(cfg.wheelbase + 2 * cfg.wheelRadius);
        expect(cfg.cgToFront).toBeGreaterThan(0);
        expect(cfg.cgToFront).toBeLessThan(cfg.wheelbase);
      });
    });
  }
});
