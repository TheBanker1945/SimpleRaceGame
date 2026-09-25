import { describe, expect, it } from 'vitest';
import { computeTireForce, createTireOutput, gripCurve, loadSensitiveMu } from '../src/vehicle/Tire.ts';
import { DEFAULT_VEHICLE } from '../src/vehicle/VehicleConfig.ts';
import { solveWheel } from '../src/vehicle/VehiclePhysics.ts';

const cfg = DEFAULT_VEHICLE;
const FZ = cfg.tireNominalLoad;
const PEAK = cfg.tirePeakSlipAngleFront;

describe('grip curve', () => {
  it('is zero at zero slip and peaks at 1 at the normalised peak', () => {
    expect(gripCurve(cfg.tireShape, 0)).toBe(0);
    expect(gripCurve(cfg.tireShape, 1)).toBeCloseTo(1, 5);
    expect(gripCurve(cfg.tireShape, 0.8)).toBeLessThan(1);
    expect(gripCurve(cfg.tireShape, 1.3)).toBeLessThan(1);
  });

  it('keeps ~80% of the peak when fully sliding', () => {
    const sliding = gripCurve(cfg.tireShape, 50);
    expect(sliding).toBeGreaterThan(0.7);
    expect(sliding).toBeLessThan(0.9);
  });
});

describe('tire forces', () => {
  const out = createTireOutput();

  it('produces forward force for positive slip ratio and opposes lateral sliding', () => {
    computeTireForce(cfg, FZ, 0.05, 0, PEAK, 1, out);
    expect(out.fx).toBeGreaterThan(0);
    expect(out.fy).toBeCloseTo(0);
    computeTireForce(cfg, FZ, 0, 0.05, PEAK, 1, out);
    expect(out.fy).toBeLessThan(0);
    computeTireForce(cfg, FZ, 0, -0.05, PEAK, 1, out);
    expect(out.fy).toBeGreaterThan(0);
  });

  it('peaks at μ·Fz at the peak slip ratio', () => {
    computeTireForce(cfg, FZ, cfg.tirePeakSlipRatio, 0, PEAK, 1, out);
    expect(out.fx).toBeCloseTo(cfg.tireMu * FZ, 0);
    expect(out.slip).toBeCloseTo(1);
  });

  it('peaks at μ·Fz at the peak slip angle', () => {
    computeTireForce(cfg, FZ, 0, Math.tan(PEAK), PEAK, 1, out);
    expect(-out.fy).toBeCloseTo(cfg.tireMu * FZ, 0);
  });

  it('never exceeds the friction circle under combined slip', () => {
    for (const k of [-1, -0.2, -0.05, 0, 0.05, 0.2, 1]) {
      for (const a of [-0.5, -0.1, 0, 0.1, 0.5]) {
        computeTireForce(cfg, FZ, k, a, PEAK, 1, out);
        expect(Math.hypot(out.fx, out.fy)).toBeLessThanOrEqual(out.capacity * 1.0001);
      }
    }
  });

  it('a locked wheel loses almost all of its lateral grip', () => {
    computeTireForce(cfg, FZ, 0, Math.tan(0.05), PEAK, 1, out);
    const rolling = Math.abs(out.fy);
    computeTireForce(cfg, FZ, -1, Math.tan(0.05), PEAK, 1, out);
    const locked = Math.abs(out.fy);
    expect(locked).toBeLessThan(rolling * 0.3);
  });

  it('braking reduces the available cornering force', () => {
    computeTireForce(cfg, FZ, 0, Math.tan(0.1), PEAK, 1, out);
    const pureLateral = Math.abs(out.fy);
    computeTireForce(cfg, FZ, -0.08, Math.tan(0.1), PEAK, 1, out);
    expect(Math.abs(out.fy)).toBeLessThan(pureLateral);
  });

  it('has no force without load', () => {
    computeTireForce(cfg, 0, 0.1, 0.1, PEAK, 1, out);
    expect(out.fx).toBe(0);
    expect(out.fy).toBe(0);
  });

  it('is load sensitive: friction coefficient drops as load rises', () => {
    expect(loadSensitiveMu(cfg, FZ * 1.5)).toBeLessThan(loadSensitiveMu(cfg, FZ));
    expect(loadSensitiveMu(cfg, FZ * 0.5)).toBeGreaterThan(loadSensitiveMu(cfg, FZ));
  });
});

describe('implicit wheel solver', () => {
  it('without brakes solves the linear system exactly', () => {
    expect(solveWheel(10, 50, 0)).toBeCloseTo(5);
  });

  it('locks the wheel when the brake torque exceeds all other torques', () => {
    expect(solveWheel(10, 50, 80)).toBe(0);
    expect(solveWheel(10, -50, 80)).toBe(0);
  });

  it('brake torque opposes rotation in both directions', () => {
    expect(solveWheel(10, 100, 40)).toBeCloseTo(6);
    expect(solveWheel(10, -100, 40)).toBeCloseTo(-6);
  });
});
