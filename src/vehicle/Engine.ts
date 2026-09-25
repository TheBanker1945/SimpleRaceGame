import { clamp01 } from '../core/math.ts';
import type { TorquePoint, VehicleConfig } from './VehicleConfig.ts';

/** Full-throttle torque (Nm) at an RPM, linearly interpolated from the curve and clamped at the ends. */
export function torqueCurveAt(curve: readonly TorquePoint[], rpm: number): number {
  if (curve.length === 0) return 0;
  if (rpm <= curve[0].rpm) return curve[0].torque;
  const last = curve[curve.length - 1];
  if (rpm >= last.rpm) return last.torque;
  // Curves are short (≈10 points); a linear scan is faster than a binary search here.
  for (let i = 1; i < curve.length; i++) {
    const p1 = curve[i];
    if (rpm <= p1.rpm) {
      const p0 = curve[i - 1];
      const t = (rpm - p0.rpm) / (p1.rpm - p0.rpm);
      return p0.torque + (p1.torque - p0.torque) * t;
    }
  }
  return last.torque;
}

/** Internal friction + pumping losses (Nm, positive number). This is what gives engine braking. */
export function engineFrictionTorque(cfg: VehicleConfig, rpm: number): number {
  return cfg.engineFriction0 + cfg.engineFrictionPerRPM * Math.max(rpm, 0);
}

/**
 * Net crank torque for a throttle position. The curve is measured output (friction already
 * subtracted), so full throttle returns the curve value and closed throttle returns -friction.
 */
export function engineTorque(cfg: VehicleConfig, rpm: number, throttle: number): number {
  const t = clamp01(throttle);
  const friction = engineFrictionTorque(cfg, rpm);
  const combustion = torqueCurveAt(cfg.torqueCurve, rpm) + friction;
  return t * combustion - friction;
}

/** Power in kW for a given RPM at full throttle. */
export function enginePowerKW(cfg: VehicleConfig, rpm: number): number {
  return (torqueCurveAt(cfg.torqueCurve, rpm) * rpm * (Math.PI * 2)) / 60 / 1000;
}

/**
 * Hard-cut rev limiter with hysteresis: fuel is cut at limiterRPM and restored
 * once the revs fall 180 rpm below it, which produces the classic limiter bounce.
 */
export class RevLimiter {
  cutting = false;
  private readonly hysteresis = 180;
  private readonly limiterRPM: number;

  constructor(limiterRPM: number) {
    this.limiterRPM = limiterRPM;
  }

  /** Returns the throttle the engine actually receives. */
  apply(rpm: number, throttle: number): number {
    if (this.cutting) {
      if (rpm < this.limiterRPM - this.hysteresis) this.cutting = false;
    } else if (rpm >= this.limiterRPM) {
      this.cutting = true;
    }
    return this.cutting ? 0 : throttle;
  }

  reset(): void {
    this.cutting = false;
  }
}
