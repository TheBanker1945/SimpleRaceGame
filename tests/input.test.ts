import { describe, expect, it } from 'vitest';
import { Input } from '../src/input/Input.ts';

const makeInput = (): Input => new Input(new EventTarget() as unknown as Window);

describe('touch and tilt input', () => {
  it('ramps the pedals from on-screen buttons like keys', () => {
    const input = makeInput();
    input.setTouch('throttle', true);
    input.update(0.05, 0);
    expect(input.state.throttle).toBeGreaterThan(0);
    expect(input.state.throttle).toBeLessThan(1);
    for (let i = 0; i < 20; i++) input.update(0.05, 0);
    expect(input.state.throttle).toBe(1);
    input.setTouch('throttle', false);
    input.setTouch('brake', true);
    input.setTouch('handbrake', true);
    for (let i = 0; i < 20; i++) input.update(0.05, 0);
    expect(input.state.throttle).toBe(0);
    expect(input.state.brake).toBe(1);
    expect(input.state.handbrake).toBe(1);
    input.releaseTouch();
    for (let i = 0; i < 20; i++) input.update(0.05, 0);
    expect(input.state.brake).toBe(0);
    expect(input.state.handbrake).toBe(0);
  });

  it('steers with the touch pad (+ = left) and recenters on release', () => {
    const input = makeInput();
    input.setTouch('left', true);
    for (let i = 0; i < 30; i++) input.update(0.05, 10);
    expect(input.state.steer).toBe(1);
    input.setTouch('left', false);
    input.setTouch('right', true);
    for (let i = 0; i < 40; i++) input.update(0.05, 10);
    expect(input.state.steer).toBe(-1);
    input.setTouch('right', false);
    for (let i = 0; i < 40; i++) input.update(0.05, 10);
    expect(input.state.steer).toBe(0);
  });

  it('follows tilt steering smoothly and stops when tilt is turned off', () => {
    const input = makeInput();
    input.setTilt(0.5);
    input.update(0.016, 30);
    expect(input.state.steer).toBeGreaterThan(0);
    expect(input.state.steer).toBeLessThan(0.5);
    for (let i = 0; i < 60; i++) input.update(0.016, 30);
    expect(input.state.steer).toBeCloseTo(0.5, 5);
    input.setTilt(-3);
    for (let i = 0; i < 60; i++) input.update(0.016, 30);
    expect(input.state.steer).toBe(-1);
    input.setTilt(null);
    input.update(0.016, 30);
    expect(input.state.steer).toBe(0);
  });

  it('queues one-shot actions from buttons', () => {
    const input = makeInput();
    input.press('pause');
    expect(input.consume('pause')).toBe(true);
    expect(input.consume('pause')).toBe(false);
  });
});
