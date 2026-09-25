import { approach, clamp, clamp01, lerp } from '../core/math.ts';
import type { DriverInput } from '../vehicle/VehiclePhysics.ts';

export type InputAction = 'shiftUp' | 'shiftDown' | 'camera' | 'pause' | 'restart' | 'confirm' | 'fullscreen';

const KEY_ACTIONS: Record<string, InputAction> = {
  ShiftLeft: 'shiftUp',
  ShiftRight: 'shiftUp',
  KeyE: 'shiftUp',
  ControlLeft: 'shiftDown',
  ControlRight: 'shiftDown',
  KeyQ: 'shiftDown',
  KeyC: 'camera',
  Escape: 'pause',
  KeyP: 'pause',
  KeyR: 'restart',
  Enter: 'confirm',
  KeyF: 'fullscreen',
};

/** Keys whose browser default (scrolling, focus changes) must be suppressed while playing. */
const CAPTURED = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'Tab',
]);

// Standard gamepad mapping indices.
const GP_A = 0;
const GP_B = 1;
const GP_X = 2;
const GP_Y = 3;
const GP_LB = 4;
const GP_RB = 5;
const GP_LT = 6;
const GP_RT = 7;
const GP_BACK = 8;
const GP_START = 9;

const GAMEPAD_BUTTON_ACTIONS: [number, InputAction][] = [
  [GP_RB, 'shiftUp'],
  [GP_LB, 'shiftDown'],
  [GP_Y, 'camera'],
  [GP_START, 'pause'],
  [GP_BACK, 'restart'],
  [GP_A, 'confirm'],
];

/**
 * Keyboard + gamepad input. Keyboard pedals and steering are ramped so a key press
 * behaves like a quick but finite pedal/steering-wheel movement instead of a step.
 * Steering ramps slower at high speed, like a driver making smaller corrections.
 */
export class Input {
  /** Smoothed driver controls, updated by `update()`. */
  readonly state: DriverInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  /** True when the most recent analog input came from a gamepad. */
  usingGamepad = false;
  gamepadConnected = false;

  private readonly keys = new Set<string>();
  private readonly pending = new Set<InputAction>();
  private readonly prevButtons = new Map<number, boolean>();
  private kbThrottle = 0;
  private kbBrake = 0;
  private kbSteer = 0;
  private padSteer = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (CAPTURED.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        const action = KEY_ACTIONS[e.code];
        if (action) this.pending.add(action);
      }
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    target.addEventListener('keyup', (e) => {
      if (CAPTURED.has(e.code)) e.preventDefault();
      this.keys.delete(e.code);
    });
    // Releasing everything on focus loss avoids a stuck throttle after alt-tab.
    target.addEventListener('blur', () => this.keys.clear());
    target.addEventListener('gamepadconnected', () => (this.gamepadConnected = true));
    target.addEventListener('gamepaddisconnected', () => (this.gamepadConnected = this.findGamepad() !== null));
  }

  /** Returns true once per press of the action (edge-triggered). */
  consume(action: InputAction): boolean {
    return this.pending.delete(action);
  }

  /** Drops queued presses, e.g. when switching screens. */
  clearPresses(): void {
    this.pending.clear();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /**
   * @param dt frame time in seconds
   * @param speed vehicle speed (m/s) for speed-sensitive keyboard steering
   */
  update(dt: number, speed: number): void {
    const k = this.keys;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const kbHandbrake = k.has('Space');

    this.kbThrottle = approach(this.kbThrottle, up ? 1 : 0, (up ? 6 : 10) * dt);
    this.kbBrake = approach(this.kbBrake, down ? 1 : 0, (down ? 5 : 10) * dt);

    const steerTarget = (left ? 1 : 0) - (right ? 1 : 0);
    const speedFactor = clamp01(speed / 70);
    const rampRate = lerp(3.4, 1.5, speedFactor);
    const centerRate = lerp(6.0, 3.8, speedFactor);
    if (steerTarget === 0) {
      this.kbSteer = approach(this.kbSteer, 0, centerRate * dt);
    } else if (this.kbSteer !== 0 && Math.sign(this.kbSteer) !== steerTarget) {
      // Counter-steering: unwind quickly through center first.
      this.kbSteer = approach(this.kbSteer, 0, centerRate * 1.4 * dt);
      if (this.kbSteer === 0) this.kbSteer = steerTarget * 0.001;
    } else {
      this.kbSteer = approach(this.kbSteer, steerTarget, rampRate * dt);
    }

    let throttle = this.kbThrottle;
    let brake = this.kbBrake;
    let steer = this.kbSteer;
    let handbrake = kbHandbrake ? 1 : 0;

    const pad = this.findGamepad();
    this.gamepadConnected = pad !== null;
    if (pad) {
      const deadzone = 0.1;
      const raw = pad.axes.length > 0 ? pad.axes[0] : 0;
      const mag = Math.max(0, (Math.abs(raw) - deadzone) / (1 - deadzone));
      // Mild expo curve: precise around center, full lock at the edge.
      const target = -Math.sign(raw) * Math.pow(mag, 1.4);
      this.padSteer = approach(this.padSteer, target, 8 * dt);
      const rt = buttonValue(pad, GP_RT);
      const lt = buttonValue(pad, GP_LT);
      const hb = Math.max(buttonValue(pad, GP_B), buttonValue(pad, GP_X));
      const padActive = rt > 0.05 || lt > 0.05 || mag > 0 || hb > 0.5;
      if (padActive) this.usingGamepad = true;
      if (this.usingGamepad) {
        throttle = Math.max(throttle, rt);
        brake = Math.max(brake, lt);
        steer = Math.abs(this.padSteer) > Math.abs(steer) ? this.padSteer : steer;
        handbrake = Math.max(handbrake, hb > 0.5 ? 1 : 0);
      }
      for (const [index, action] of GAMEPAD_BUTTON_ACTIONS) {
        const pressed = buttonValue(pad, index) > 0.5;
        if (pressed && !this.prevButtons.get(index)) this.pending.add(action);
        this.prevButtons.set(index, pressed);
      }
    }

    this.state.throttle = clamp01(throttle);
    this.state.brake = clamp01(brake);
    this.state.steer = clamp(steer, -1, 1);
    this.state.handbrake = handbrake;
  }

  private findGamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const pad of navigator.getGamepads()) {
      if (pad && pad.connected) return pad;
    }
    return null;
  }
}

function buttonValue(pad: Gamepad, index: number): number {
  const b = pad.buttons[index];
  if (!b) return 0;
  return b.value > 0 ? b.value : b.pressed ? 1 : 0;
}
