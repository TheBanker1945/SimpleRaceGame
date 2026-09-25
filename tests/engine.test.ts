import { describe, expect, it } from 'vitest';
import { engineFrictionTorque, enginePowerKW, engineTorque, RevLimiter, torqueCurveAt } from '../src/vehicle/Engine.ts';
import { DEFAULT_VEHICLE } from '../src/vehicle/VehicleConfig.ts';

const cfg = DEFAULT_VEHICLE;

describe('torque curve', () => {
  const curve = [
    { rpm: 1000, torque: 200 },
    { rpm: 3000, torque: 400 },
    { rpm: 6000, torque: 300 },
  ];

  it('returns exact values at the curve points', () => {
    expect(torqueCurveAt(curve, 1000)).toBe(200);
    expect(torqueCurveAt(curve, 3000)).toBe(400);
    expect(torqueCurveAt(curve, 6000)).toBe(300);
  });

  it('interpolates linearly between points', () => {
    expect(torqueCurveAt(curve, 2000)).toBeCloseTo(300);
    expect(torqueCurveAt(curve, 4500)).toBeCloseTo(350);
  });

  it('clamps outside the defined range', () => {
    expect(torqueCurveAt(curve, 0)).toBe(200);
    expect(torqueCurveAt(curve, 9000)).toBe(300);
    expect(torqueCurveAt([], 3000)).toBe(0);
  });

  it('default engine peaks in the mid range and falls off toward the limiter', () => {
    const peak = Math.max(...cfg.torqueCurve.map((p) => p.torque));
    const peakRpm = cfg.torqueCurve.find((p) => p.torque === peak)?.rpm ?? 0;
    expect(peakRpm).toBeGreaterThanOrEqual(3500);
    expect(peakRpm).toBeLessThanOrEqual(5500);
    expect(torqueCurveAt(cfg.torqueCurve, cfg.limiterRPM)).toBeLessThan(peak);
  });

  it('default engine makes roughly 280-300 kW near the redline', () => {
    const maxPower = Math.max(...[5000, 5500, 6000, 6500, 7000, 7200].map((rpm) => enginePowerKW(cfg, rpm)));
    expect(maxPower).toBeGreaterThan(270);
    expect(maxPower).toBeLessThan(310);
  });
});

describe('engine torque with throttle', () => {
  it('full throttle equals the curve', () => {
    expect(engineTorque(cfg, 4000, 1)).toBeCloseTo(torqueCurveAt(cfg.torqueCurve, 4000));
  });

  it('closed throttle produces engine braking that grows with rpm', () => {
    const low = engineTorque(cfg, 2000, 0);
    const high = engineTorque(cfg, 6000, 0);
    expect(low).toBeLessThan(0);
    expect(high).toBeLessThan(low);
    expect(high).toBeCloseTo(-engineFrictionTorque(cfg, 6000));
  });

  it('is monotonic in throttle', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const tq = engineTorque(cfg, 4500, t);
      expect(tq).toBeGreaterThan(prev);
      prev = tq;
    }
  });
});

describe('rev limiter', () => {
  it('cuts fuel at the limiter and restores it below the hysteresis band', () => {
    const lim = new RevLimiter(7500);
    expect(lim.apply(7000, 1)).toBe(1);
    expect(lim.apply(7500, 1)).toBe(0);
    expect(lim.cutting).toBe(true);
    // Still inside the hysteresis band: stays cut.
    expect(lim.apply(7400, 1)).toBe(0);
    expect(lim.apply(7300, 1)).toBe(1);
    expect(lim.cutting).toBe(false);
  });
});
