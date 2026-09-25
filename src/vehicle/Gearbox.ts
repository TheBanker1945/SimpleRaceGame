import { clamp01, lerp, RADS_TO_RPM } from '../core/math.ts';
import type { VehicleConfig } from './VehicleConfig.ts';

export type TransmissionMode = 'automatic' | 'manual';

export const REVERSE = -1;
export const NEUTRAL = 0;

export interface AutoShiftContext {
  /** Driven-axle angular velocity (rad/s). */
  wheelOmega: number;
  throttle: number;
  brake: number;
}

/**
 * Sequential 6-speed gearbox with reverse and neutral.
 * A shift opens the clutch for `shiftTime` seconds (no drive torque) and then re-engages.
 */
export class Gearbox {
  gear = 1;
  mode: TransmissionMode;
  /** > 0 while the clutch is open for a shift. */
  shiftTimer = 0;
  /** Increments on every shift; lets audio/UI detect shifts without callbacks. */
  shiftCount = 0;
  lastShiftDirection = 0;
  private cooldown = 0;
  private readonly cfg: VehicleConfig;

  constructor(cfg: VehicleConfig, mode: TransmissionMode = 'automatic') {
    this.cfg = cfg;
    this.mode = mode;
  }

  get topGear(): number {
    return this.cfg.gearRatios.length;
  }

  /** Overall engine→wheel ratio (negative in reverse, 0 in neutral). */
  ratio(gear: number = this.gear): number {
    if (gear === NEUTRAL) return 0;
    if (gear === REVERSE) return -this.cfg.reverseRatio * this.cfg.finalDrive;
    const idx = Math.min(Math.max(gear, 1), this.topGear) - 1;
    return this.cfg.gearRatios[idx] * this.cfg.finalDrive;
  }

  /** Engine RPM the driven wheels would impose in a given gear. */
  rpmAt(gear: number, wheelOmega: number): number {
    return Math.abs(wheelOmega * this.ratio(gear)) * RADS_TO_RPM;
  }

  isShifting(): boolean {
    return this.shiftTimer > 0;
  }

  gearLabel(): string {
    if (this.gear === REVERSE) return 'R';
    if (this.gear === NEUTRAL) return 'N';
    return String(this.gear);
  }

  reset(mode: TransmissionMode = this.mode): void {
    this.mode = mode;
    this.gear = 1;
    this.shiftTimer = 0;
    this.cooldown = 0;
    this.lastShiftDirection = 0;
  }

  /** Starts a shift to `gear`. Returns false if already in that gear. */
  shiftTo(gear: number): boolean {
    if (gear === this.gear) return false;
    this.lastShiftDirection = gear > this.gear ? 1 : -1;
    this.gear = gear;
    this.shiftTimer = this.cfg.shiftTime;
    this.cooldown = this.cfg.shiftTime + 0.35;
    this.shiftCount++;
    return true;
  }

  /** Manual upshift request. */
  shiftUp(): boolean {
    if (this.gear >= this.topGear) return false;
    return this.shiftTo(this.gear + 1);
  }

  /**
   * Manual downshift request. Refuses a downshift that would throw the engine past the
   * limiter (money-shift protection) and only allows reverse when nearly stopped.
   */
  shiftDown(wheelOmega: number, forwardSpeed: number): boolean {
    if (this.gear === REVERSE) return false;
    const target = this.gear - 1;
    if (target === REVERSE && Math.abs(forwardSpeed) > 2) return false;
    if (target >= 1 && this.rpmAt(target, wheelOmega) > this.cfg.limiterRPM + 200) return false;
    return this.shiftTo(target);
  }

  /** RPM above which the automatic upshifts, blended by throttle. */
  upshiftRPM(throttle: number): number {
    return lerp(this.cfg.autoUpshiftRPMLight, this.cfg.autoUpshiftRPM, clamp01((throttle - 0.15) / 0.75));
  }

  /** RPM below which the automatic downshifts, blended by throttle (kickdown at full throttle). */
  downshiftRPM(throttle: number, brake: number): number {
    const base = lerp(this.cfg.autoDownshiftRPMLight, this.cfg.autoDownshiftRPM, clamp01((throttle - 0.3) / 0.65));
    // Downshift earlier while braking so engine braking helps and the car is ready to pull.
    return brake > 0.1 ? Math.max(base, 2600) : base;
  }

  update(dt: number, ctx: AutoShiftContext): void {
    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.mode !== 'automatic' || this.cooldown > 0 || this.gear < 1) return;

    const rpm = this.rpmAt(this.gear, ctx.wheelOmega);
    const up = this.upshiftRPM(ctx.throttle);
    const down = this.downshiftRPM(ctx.throttle, ctx.brake);

    if (this.gear < this.topGear && rpm > up) {
      // Only upshift if the next gear does not immediately want to shift back down.
      if (this.rpmAt(this.gear + 1, ctx.wheelOmega) > down + 250) this.shiftTo(this.gear + 1);
      return;
    }
    if (this.gear > 1 && rpm < down) {
      const lower = this.rpmAt(this.gear - 1, ctx.wheelOmega);
      if (lower < Math.min(up - 400, this.cfg.redlineRPM - 200)) this.shiftTo(this.gear - 1);
    }
  }
}
