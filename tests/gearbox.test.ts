import { describe, expect, it } from 'vitest';
import { RPM_TO_RADS } from '../src/core/math.ts';
import { Gearbox, NEUTRAL, REVERSE } from '../src/vehicle/Gearbox.ts';
import { DEFAULT_VEHICLE } from '../src/vehicle/VehicleConfig.ts';

const cfg = DEFAULT_VEHICLE;

/** Wheel angular velocity that puts the engine at `rpm` in `gear`. */
const wheelOmegaFor = (gb: Gearbox, gear: number, rpm: number): number => (rpm * RPM_TO_RADS) / Math.abs(gb.ratio(gear));

/** Advances the gearbox until any shift completes. */
const settle = (gb: Gearbox, ctx: { wheelOmega: number; throttle: number; brake: number }): void => {
  for (let i = 0; i < 120; i++) gb.update(1 / 120, ctx);
};

describe('gear ratios', () => {
  it('has six forward gears with decreasing ratios', () => {
    const gb = new Gearbox(cfg);
    expect(gb.topGear).toBe(6);
    for (let g = 2; g <= 6; g++) expect(gb.ratio(g)).toBeLessThan(gb.ratio(g - 1));
  });

  it('includes the final drive, is negative in reverse and zero in neutral', () => {
    const gb = new Gearbox(cfg);
    expect(gb.ratio(1)).toBeCloseTo(cfg.gearRatios[0] * cfg.finalDrive);
    expect(gb.ratio(REVERSE)).toBeLessThan(0);
    expect(gb.ratio(NEUTRAL)).toBe(0);
  });

  it('computes engine rpm from wheel speed', () => {
    const gb = new Gearbox(cfg);
    const omega = wheelOmegaFor(gb, 3, 5000);
    expect(gb.rpmAt(3, omega)).toBeCloseTo(5000);
    expect(gb.rpmAt(4, omega)).toBeLessThan(5000);
  });
});

describe('automatic gearbox', () => {
  it('upshifts at high rpm under full throttle', () => {
    const gb = new Gearbox(cfg, 'automatic');
    gb.gear = 2;
    const count = gb.shiftCount;
    gb.update(1 / 120, { wheelOmega: wheelOmegaFor(gb, 2, cfg.autoUpshiftRPM + 100), throttle: 1, brake: 0 });
    expect(gb.gear).toBe(3);
    expect(gb.shiftCount).toBe(count + 1);
    expect(gb.isShifting()).toBe(true);
  });

  it('holds the gear below the upshift point', () => {
    const gb = new Gearbox(cfg, 'automatic');
    gb.gear = 2;
    settle(gb, { wheelOmega: wheelOmegaFor(gb, 2, 6000), throttle: 1, brake: 0 });
    expect(gb.gear).toBe(2);
  });

  it('upshifts much earlier at light throttle', () => {
    const gb = new Gearbox(cfg, 'automatic');
    gb.gear = 2;
    gb.update(1 / 120, { wheelOmega: wheelOmegaFor(gb, 2, 3200), throttle: 0.2, brake: 0 });
    expect(gb.gear).toBe(3);
  });

  it('kicks down when flooring it at low rpm', () => {
    const gb = new Gearbox(cfg, 'automatic');
    gb.gear = 6;
    gb.update(1 / 120, { wheelOmega: wheelOmegaFor(gb, 6, 3000), throttle: 1, brake: 0 });
    expect(gb.gear).toBe(5);
  });

  it('does not kick down into a gear that would be near the redline', () => {
    const gb = new Gearbox(cfg, 'automatic');
    gb.gear = 2;
    // 4200 rpm in 2nd is below the kickdown point, but 1st would put the engine at ~6800 rpm.
    settle(gb, { wheelOmega: wheelOmegaFor(gb, 2, 4200), throttle: 1, brake: 0 });
    expect(gb.gear).toBe(2);
  });

  it('respects a cooldown so it cannot shift twice in a row instantly', () => {
    const gb = new Gearbox(cfg, 'automatic');
    gb.gear = 1;
    const omega = wheelOmegaFor(gb, 1, 7400);
    gb.update(1 / 120, { wheelOmega: omega, throttle: 1, brake: 0 });
    expect(gb.gear).toBe(2);
    gb.update(1 / 120, { wheelOmega: omega * 3, throttle: 1, brake: 0 });
    expect(gb.gear).toBe(2);
  });

  it('never hunts between two gears at a steady cruise', () => {
    const gb = new Gearbox(cfg, 'automatic');
    gb.gear = 4;
    const omega = wheelOmegaFor(gb, 4, 2500);
    const start = gb.shiftCount;
    for (let i = 0; i < 1200; i++) gb.update(1 / 120, { wheelOmega: omega, throttle: 0.35, brake: 0 });
    expect(gb.shiftCount - start).toBeLessThanOrEqual(1);
  });

  it('downshifts earlier while braking', () => {
    const gb = new Gearbox(cfg, 'automatic');
    expect(gb.downshiftRPM(0, 1)).toBeGreaterThan(gb.downshiftRPM(0, 0));
  });
});

describe('manual gearbox', () => {
  it('shifts up and down sequentially and ignores automatic logic', () => {
    const gb = new Gearbox(cfg, 'manual');
    gb.gear = 1;
    settle(gb, { wheelOmega: wheelOmegaFor(gb, 1, 7400), throttle: 1, brake: 0 });
    expect(gb.gear).toBe(1);
    expect(gb.shiftUp()).toBe(true);
    expect(gb.gear).toBe(2);
    expect(gb.shiftDown(wheelOmegaFor(gb, 2, 3000), 10)).toBe(true);
    expect(gb.gear).toBe(1);
  });

  it('refuses a downshift that would exceed the limiter', () => {
    const gb = new Gearbox(cfg, 'manual');
    gb.gear = 4;
    expect(gb.shiftDown(wheelOmegaFor(gb, 4, 6500), 50)).toBe(false);
    expect(gb.gear).toBe(4);
  });

  it('cannot shift above top gear', () => {
    const gb = new Gearbox(cfg, 'manual');
    gb.gear = 6;
    expect(gb.shiftUp()).toBe(false);
  });

  it('goes through neutral to reverse only when nearly stopped', () => {
    const gb = new Gearbox(cfg, 'manual');
    gb.gear = 1;
    expect(gb.shiftDown(0, 0)).toBe(true);
    expect(gb.gear).toBe(NEUTRAL);
    expect(gb.shiftDown(0, 10)).toBe(false);
    expect(gb.shiftDown(0, 0.5)).toBe(true);
    expect(gb.gear).toBe(REVERSE);
    expect(gb.gearLabel()).toBe('R');
  });
});
