import type { VehicleConfig } from './VehicleConfig.ts';

export interface TireOutput {
  /** Longitudinal force in the wheel frame (N, + = forward). */
  fx: number;
  /** Lateral force in the wheel frame (N, + = left). */
  fy: number;
  /** Secant longitudinal stiffness Fx/κ (N per unit slip ratio, ≥ 0). Used by the implicit wheel solver. */
  longStiffness: number;
  /** Normalised combined slip: 1 = at the peak of the grip curve, > 1 = sliding. */
  slip: number;
  /** Friction available at this load (μ·Fz). */
  capacity: number;
}

export const createTireOutput = (): TireOutput => ({ fx: 0, fy: 0, longStiffness: 0, slip: 0, capacity: 0 });

/** Tire friction coefficient after load sensitivity: heavily loaded tires are less efficient. */
export function loadSensitiveMu(cfg: VehicleConfig, fz: number): number {
  const factor = 1 - cfg.tireLoadSensitivity * (fz / cfg.tireNominalLoad - 1);
  return cfg.tireMu * Math.min(1.15, Math.max(0.5, factor));
}

/** Normalised grip curve f(ρ): f(0)=0, peak f(1)=1, sliding value sin(C·π/2). */
export function gripCurve(shape: number, rho: number): number {
  const b = Math.tan(Math.PI / (2 * shape));
  return Math.sin(shape * Math.atan(b * rho));
}

/**
 * Combined-slip tire model.
 *
 * Longitudinal slip ratio κ and lateral slip tan(α) are each normalised by their
 * peak values and combined into one slip vector ρ. A Pacejka-style curve gives the
 * total force from |ρ|, and the force is split along the slip direction. This is a
 * friction ellipse: a wheel locked under braking (κ = -1, ρ ≫ 1) has almost no
 * lateral grip left, and a wheel near its lateral limit cannot also brake hard.
 */
export function computeTireForce(
  cfg: VehicleConfig,
  fz: number,
  slipRatio: number,
  slipTan: number,
  gripScale: number,
  out: TireOutput,
): TireOutput {
  if (fz <= 0) {
    out.fx = 0;
    out.fy = 0;
    out.longStiffness = 0;
    out.slip = 0;
    out.capacity = 0;
    return out;
  }
  const shape = cfg.tireShape;
  const b = Math.tan(Math.PI / (2 * shape));
  const sx = slipRatio / cfg.tirePeakSlipRatio;
  const sy = slipTan / Math.tan(cfg.tirePeakSlipAngle);
  const rho = Math.sqrt(sx * sx + sy * sy);
  const capacity = loadSensitiveMu(cfg, fz) * gripScale * fz;
  // f(ρ)/ρ, with its analytic limit (B·C) near zero slip.
  const fOverRho = rho < 1e-6 ? b * shape : Math.sin(shape * Math.atan(b * rho)) / rho;
  const k = capacity * fOverRho;
  out.fx = k * sx;
  out.fy = -k * sy;
  out.longStiffness = k / cfg.tirePeakSlipRatio;
  out.slip = rho;
  out.capacity = capacity;
  return out;
}
