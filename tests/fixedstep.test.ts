import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../src/core/FixedStepLoop.ts';
import { DEFAULT_VEHICLE } from '../src/vehicle/VehicleConfig.ts';
import { FLAT_ROAD, VehiclePhysics } from '../src/vehicle/VehiclePhysics.ts';

describe('fixed timestep loop', () => {
  it('runs the same number of steps regardless of frame rate', () => {
    for (const fps of [30, 60, 75, 144, 240]) {
      const loop = new FixedStepLoop(1 / 120);
      let steps = 0;
      for (let i = 0; i < fps * 2; i++) steps += loop.advance(1 / fps, 1, () => undefined);
      expect(Math.abs(steps - 240)).toBeLessThanOrEqual(1);
    }
  });

  it('interpolation alpha stays in [0, 1)', () => {
    const loop = new FixedStepLoop(1 / 120);
    for (let i = 0; i < 100; i++) {
      loop.advance(1 / 144, 1, () => undefined);
      expect(loop.alpha).toBeGreaterThanOrEqual(0);
      expect(loop.alpha).toBeLessThan(1);
    }
  });

  it('clamps huge frame times so a stalled tab cannot explode the simulation', () => {
    const loop = new FixedStepLoop(1 / 120, 0.1);
    expect(loop.advance(5, 1, () => undefined)).toBe(12);
  });

  it('supports slow motion through the time scale', () => {
    const loop = new FixedStepLoop(1 / 120);
    let steps = 0;
    for (let i = 0; i < 60; i++) steps += loop.advance(1 / 60, 0.25, () => undefined);
    expect(Math.abs(steps - 30)).toBeLessThanOrEqual(1);
  });

  it('gives the vehicle identical trajectories at 30 and 144 fps', () => {
    const drive = (fps: number): VehiclePhysics => {
      const car = new VehiclePhysics(DEFAULT_VEHICLE);
      car.reset(0, 0, 20);
      const loop = new FixedStepLoop(1 / 120);
      // 3 seconds of wall time; stop exactly after 360 simulation steps.
      let steps = 0;
      while (steps < 360) {
        loop.advance(1 / fps, 1, (dt) => {
          if (steps >= 360) return;
          car.update(dt, { throttle: 1, brake: 0, steer: 0.3, handbrake: 0 }, FLAT_ROAD);
          steps++;
        });
      }
      return car;
    };
    const slow = drive(30);
    const fast = drive(144);
    expect(fast.s).toBe(slow.s);
    expect(fast.d).toBe(slow.d);
    expect(fast.psi).toBe(slow.psi);
  });
});
