import { approach, clamp, clamp01, GRAVITY, RADS_TO_RPM, RPM_TO_RADS, wrapAngle } from '../core/math.ts';
import { engineTorque, RevLimiter, torqueCurveAt } from './Engine.ts';
import { Gearbox, NEUTRAL, REVERSE, type TransmissionMode } from './Gearbox.ts';
import { computeTireForce, createTireOutput, type TireOutput } from './Tire.ts';
import type { VehicleConfig } from './VehicleConfig.ts';

/** Driver controls after input smoothing. */
export interface DriverInput {
  /** Accelerator pedal 0..1 (W / up / right trigger). */
  throttle: number;
  /** Brake pedal 0..1 (S / down / left trigger). */
  brake: number;
  /** Steering -1..1, positive = left. */
  steer: number;
  /** Handbrake 0..1. */
  handbrake: number;
}

/** What the car needs to know about the road it is on (all functions of distance along the road). */
export interface RoadProfile {
  /** Horizontal curvature (1/m, positive = bends left). */
  curvature(s: number): number;
  /** Longitudinal grade dh/ds. */
  grade(s: number): number;
  /** Vertical curvature d²h/ds² (positive in dips, negative over crests). */
  verticalCurvature(s: number): number;
  /** Small-scale surface height (m) for suspension excitation. */
  roughness(s: number, d: number): number;
}

export const FLAT_ROAD: RoadProfile = {
  curvature: () => 0,
  grade: () => 0,
  verticalCurvature: () => 0,
  roughness: () => 0,
};

export interface WheelState {
  /** Position in the body frame (x forward, y left). */
  readonly x: number;
  readonly y: number;
  readonly front: boolean;
  /** Vertical load (N). */
  fz: number;
  slipRatio: number;
  /** Slip angle (rad). */
  slipAngle: number;
  /** Normalised combined slip (1 = peak grip). */
  slip: number;
  /** Tire forces in the wheel frame. */
  fx: number;
  fy: number;
  /** Accumulated spin angle for rendering (rad). */
  spin: number;
  /** Suspension compression (m, + = compressed) for rendering. */
  compression: number;
}

type ClutchState = 'locked' | 'slipping' | 'open';

/** Minimum speeds used as slip denominators. They keep the tire model well conditioned at a standstill. */
const LONG_SLIP_MIN_SPEED = 1.0;
const LAT_SLIP_MIN_SPEED = 2.5;

const FL = 0;
const FR = 1;
const RL = 2;
const RR = 3;

/**
 * Four-wheel vehicle dynamics in a road-relative (Frenet) frame.
 *
 * Pose: s (distance along the road centerline), d (lateral offset, + = left),
 * psi (heading relative to the road tangent, + = left).
 * Body velocities: u (forward), v (left), r (yaw rate, + = turning left).
 *
 * Each substep:
 *  1. Wheel loads from static weight, downforce, and pitch/roll springs (weight transfer).
 *  2. Contact-patch slip for each wheel, combined-slip tire forces.
 *  3. Implicit solve of front/rear axle spin with brakes, ABS, drive torque, TCS and clutch.
 *  4. Rigid-body integration of u, v, r, then Frenet kinematics.
 *  5. Sprung-mass pitch/roll/heave integration (visible suspension + dynamic load transfer).
 */
export class VehiclePhysics {
  readonly cfg: VehicleConfig;
  readonly gearbox: Gearbox;
  readonly limiter: RevLimiter;

  // Frenet pose
  s = 0;
  d = 0;
  psi = 0;
  // Body-frame velocities
  u = 0;
  v = 0;
  r = 0;
  // Axle angular velocities (rad/s)
  omegaFront = 0;
  omegaRear = 0;
  /** Engine crank speed (rad/s). */
  engineOmega: number;
  clutch: ClutchState = 'open';
  /** Road-wheel steering angle (rad, + = left). */
  steerAngle = 0;
  // Sprung mass (+pitch = nose down, +roll = right side down, +heave = body up)
  pitch = 0;
  pitchRate = 0;
  roll = 0;
  rollRate = 0;
  heave = 0;
  heaveRate = 0;
  /** Body-frame acceleration from tire + aero forces (m/s²). */
  ax = 0;
  ay = 0;

  // Driver aids
  absEnabled = true;
  tcsEnabled = true;
  absActive = false;
  tcsActive = false;

  // Telemetry for audio/HUD
  /** Throttle actually reaching the engine (after limiter/TCS/shift cut), 0..1. */
  engineLoad = 0;
  /** Pedals after reverse remapping. */
  appliedThrottle = 0;
  appliedBrake = 0;
  appliedHandbrake = 0;
  /** Largest normalised combined slip across the four tires. */
  maxSlip = 0;
  /** Seconds the vehicle has been driving (for stats). */
  driveTime = 0;

  readonly wheels: WheelState[];
  /** Integration substeps per fixed update. */
  substeps = 2;

  private reverseTimer = 0;
  private readonly tireOut: TireOutput[] = [createTireOutput(), createTireOutput(), createTireOutput(), createTireOutput()];
  private readonly vxw = new Float64Array(4);
  private readonly slipTan = new Float64Array(4);
  private readonly longDen = new Float64Array(4);

  constructor(cfg: VehicleConfig, mode: TransmissionMode = 'automatic') {
    this.cfg = cfg;
    this.gearbox = new Gearbox(cfg, mode);
    this.limiter = new RevLimiter(cfg.limiterRPM);
    this.engineOmega = cfg.idleRPM * RPM_TO_RADS;
    const a = cfg.cgToFront;
    const b = cfg.wheelbase - a;
    const mk = (x: number, y: number, front: boolean): WheelState => ({
      x,
      y,
      front,
      fz: 0,
      slipRatio: 0,
      slipAngle: 0,
      slip: 0,
      fx: 0,
      fy: 0,
      spin: 0,
      compression: 0,
    });
    this.wheels = [
      mk(a, cfg.trackFront / 2, true),
      mk(a, -cfg.trackFront / 2, true),
      mk(-b, cfg.trackRear / 2, false),
      mk(-b, -cfg.trackRear / 2, false),
    ];
  }

  /** Speed over ground (m/s). */
  get speed(): number {
    return Math.hypot(this.u, this.v);
  }

  get rpm(): number {
    return this.engineOmega * RADS_TO_RPM;
  }

  /** Places the car on the road, rolling straight at `speed` in a sensible gear. */
  reset(s: number, d: number, speed = 0): void {
    this.s = s;
    this.d = d;
    this.psi = 0;
    this.u = speed;
    this.v = 0;
    this.r = 0;
    this.omegaFront = speed / this.cfg.wheelRadius;
    this.omegaRear = this.omegaFront;
    this.steerAngle = 0;
    this.pitch = this.pitchRate = this.roll = this.rollRate = this.heave = this.heaveRate = 0;
    this.ax = this.ay = 0;
    this.absActive = this.tcsActive = false;
    this.reverseTimer = 0;
    this.driveTime = 0;
    this.limiter.reset();
    this.gearbox.reset();
    // Pick the gear an automatic would be in at this speed.
    let gear = 1;
    while (gear < this.gearbox.topGear && this.gearbox.rpmAt(gear, this.omegaRear) > 4200) gear++;
    this.gearbox.gear = gear;
    this.gearbox.shiftTimer = 0;
    this.engineOmega = Math.max(this.cfg.idleRPM * RPM_TO_RADS, Math.abs(this.omegaRear * this.gearbox.ratio()));
    for (const w of this.wheels) {
      w.spin = 0;
      w.compression = 0;
    }
  }

  /** Steering lock available at a given speed (speed-sensitive steering). */
  maxSteerAt(speed: number): number {
    const v = Math.max(Math.abs(speed), 0.1);
    const cfg = this.cfg;
    return Math.min(cfg.maxSteerAngle, (cfg.wheelbase * cfg.steerLateralAccel) / (v * v) + cfg.steerSlipAllowance);
  }

  /** Advances the simulation by one fixed timestep. */
  update(dt: number, input: DriverInput, road: RoadProfile): void {
    const gb = this.gearbox;
    let throttle = clamp01(input.throttle);
    let brake = clamp01(input.brake);

    // Automatic gearbox: holding brake at a standstill selects reverse, where the pedals swap roles.
    if (gb.mode === 'automatic') {
      if (gb.gear === REVERSE) {
        if (input.throttle > 0.1 && this.u > -0.8) {
          gb.shiftTo(1);
        } else {
          throttle = clamp01(input.brake);
          brake = clamp01(input.throttle);
        }
      } else if (input.brake > 0.1 && input.throttle < 0.05 && Math.abs(this.u) < 0.6) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.35) {
          gb.shiftTo(REVERSE);
          throttle = clamp01(input.brake);
          brake = 0;
        }
      } else {
        this.reverseTimer = 0;
      }
      if (gb.gear === NEUTRAL) gb.shiftTo(1);
    }

    gb.update(dt, { wheelOmega: this.omegaRear, throttle, brake });

    this.appliedThrottle = throttle;
    this.appliedBrake = brake;
    this.appliedHandbrake = clamp01(input.handbrake);
    this.absActive = false;
    this.tcsActive = false;

    const h = dt / this.substeps;
    for (let i = 0; i < this.substeps; i++) {
      this.substep(h, throttle, brake, this.appliedHandbrake, clamp(input.steer, -1, 1), road);
    }
    if (this.speed > 1) this.driveTime += dt;
  }

  private substep(dt: number, throttleIn: number, brake: number, handbrake: number, steerIn: number, road: RoadProfile): void {
    const cfg = this.cfg;
    const m = cfg.mass;
    const a = cfg.cgToFront;
    const b = cfg.wheelbase - a;
    const L = cfg.wheelbase;
    const h = cfg.cgHeight;
    const R = cfg.wheelRadius;
    const wheels = this.wheels;

    // ------------------------------------------------------------ steering
    const targetSteer = steerIn * this.maxSteerAt(this.u);
    this.steerAngle = approach(this.steerAngle, targetSteer, cfg.steerRate * dt);
    const cosD = Math.cos(this.steerAngle);
    const sinD = Math.sin(this.steerAngle);

    // --------------------------------------------------------- wheel loads
    const kappa = road.curvature(this.s);
    const grade = road.grade(this.s);
    const kv = road.verticalCurvature(this.s);
    const cosG = 1 / Math.sqrt(1 + grade * grade);
    const sinG = grade * cosG;
    const u2 = this.u * this.u;
    const normalAccel = Math.max(0, GRAVITY * cosG + u2 * kv);
    const downforce = 0.5 * cfg.airDensity * cfg.downforceArea * u2;
    const baseLoad = m * normalAccel;
    const frontStatic = (baseLoad * b) / L + downforce * cfg.aeroBalanceFront;
    const rearStatic = (baseLoad * a) / L + downforce * (1 - cfg.aeroBalanceFront);

    const geo = cfg.geometricTransfer;
    const longTransfer = (geo * (-m * this.ax * h) + cfg.pitchStiffness * this.pitch + cfg.pitchDamping * this.pitchRate) / L;
    const latMoment = geo * m * this.ay * h;
    const share = cfg.frontRollShare;
    const rollSpring = cfg.rollStiffness * this.roll + cfg.rollDamping * this.rollRate;
    const latF = (latMoment * share + rollSpring * share) / cfg.trackFront;
    const latR = (latMoment * (1 - share) + rollSpring * (1 - share)) / cfg.trackRear;
    wheels[FL].fz = Math.max(0, frontStatic / 2 + longTransfer / 2 - latF);
    wheels[FR].fz = Math.max(0, frontStatic / 2 + longTransfer / 2 + latF);
    wheels[RL].fz = Math.max(0, rearStatic / 2 - longTransfer / 2 - latR);
    wheels[RR].fz = Math.max(0, rearStatic / 2 - longTransfer / 2 + latR);

    // --------------------------------------------- contact patch kinematics
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const vx = this.u - this.r * w.y;
      const vy = this.v + this.r * w.x;
      let vxw = vx;
      let vyw = vy;
      if (w.front) {
        vxw = vx * cosD + vy * sinD;
        vyw = -vx * sinD + vy * cosD;
      }
      this.vxw[i] = vxw;
      this.longDen[i] = Math.max(Math.abs(vxw), LONG_SLIP_MIN_SPEED);
      this.slipTan[i] = vyw / Math.max(Math.abs(vxw), LAT_SLIP_MIN_SPEED);
    }

    // First pass at the current wheel speeds → secant stiffness for the implicit solve.
    this.evaluateTires();

    // ------------------------------------------------------------ front axle
    const inertiaFront = 2 * cfg.wheelInertia;
    let brakeFront = brake * cfg.maxBrakeTorque * cfg.brakeBias;
    const front = this.axleTerms(FL, FR);
    {
      const A = inertiaFront / dt + R * R * front.stiffness;
      const base = (inertiaFront * this.omegaFront) / dt + R * front.stiffnessVel;
      brakeFront = this.applyAbs(brakeFront, A, base, front.meanVx);
      this.omegaFront = solveWheel(A, base, brakeFront);
    }

    // ---------------------------------------------- engine, clutch, rear axle
    const gb = this.gearbox;
    const G = gb.ratio();
    const eta = cfg.drivetrainEfficiency;
    const idleOmega = cfg.idleRPM * RPM_TO_RADS;
    const clutchOpen = G === 0 || gb.isShifting() || handbrake > 0.3;
    const wheelEngineOmega = this.omegaRear * G;
    const throttle = this.limiter.apply(this.rpm, throttleIn);
    const launchOmega = (cfg.idleRPM + throttle * (cfg.launchRPM - cfg.idleRPM)) * RPM_TO_RADS;

    if (clutchOpen) this.clutch = 'open';
    else if (wheelEngineOmega >= Math.max(launchOmega, idleOmega) - 1) this.clutch = 'locked';
    else if (throttle > 0.02) this.clutch = 'slipping';
    else this.clutch = 'open';

    let inertiaRear = 2 * cfg.wheelInertia;
    let driveTorque = 0;
    let engineTq = 0;
    if (this.clutch === 'locked') {
      this.engineOmega = wheelEngineOmega;
      engineTq = engineTorque(cfg, this.rpm, throttle);
      driveTorque = engineTq * G * eta;
      inertiaRear += cfg.engineInertia * G * G;
    } else if (this.clutch === 'slipping') {
      // Auto-clutch holds the engine near the launch RPM and passes its torque to the wheels.
      this.engineOmega += (launchOmega - this.engineOmega) * Math.min(1, dt * 12);
      engineTq = engineTorque(cfg, this.rpm, throttle);
      driveTorque = Math.max(0, engineTq) * G * eta;
    } else {
      // Free-revving: neutral, clutch pressed, or mid-shift (revs match toward the new gear).
      if (gb.isShifting() && G !== 0) {
        const target = Math.max(idleOmega, Math.abs(wheelEngineOmega));
        this.engineOmega += (target - this.engineOmega) * Math.min(1, dt * 22);
        engineTq = 0;
      } else {
        engineTq = engineTorque(cfg, this.rpm, throttle);
        // Idle governor keeps the engine alive.
        if (this.engineOmega < idleOmega) engineTq = Math.max(engineTq, 60);
        this.engineOmega += (engineTq / cfg.engineInertia) * dt;
      }
      this.engineOmega = clamp(this.engineOmega, idleOmega * 0.9, (cfg.limiterRPM + 150) * RPM_TO_RADS);
    }

    const rear = this.axleTerms(RL, RR);
    const Arear = inertiaRear / dt + R * R * rear.stiffness;
    const baseNoDrive = (inertiaRear * this.omegaRear) / dt + R * rear.stiffnessVel;

    // Traction control: cap drive torque so the rear slip stays near the tire's peak.
    if (this.tcsEnabled && this.clutch !== 'open' && driveTorque * Math.sign(G) > 0 && brake < 0.05) {
      const dir = Math.sign(G);
      const slipSpeed = cfg.tcsSlipTarget * cfg.tirePeakSlipRatio * Math.max(Math.abs(rear.meanVx), LONG_SLIP_MIN_SPEED);
      const omegaTarget = (rear.meanVx + dir * slipSpeed) / R;
      const limit = Arear * omegaTarget - baseNoDrive;
      // Stability part: when the rear tires are near their lateral limit, torque is trimmed
      // so power cannot use up the grip that keeps the tail in line.
      const rearLateral = Math.max(Math.abs(this.slipTan[RL]), Math.abs(this.slipTan[RR])) / Math.tan(cfg.tirePeakSlipAngle);
      if (rearLateral > 0.8) {
        driveTorque *= clamp(1 - (rearLateral - 0.8) * 2.5, 0.1, 1);
        this.tcsActive = true;
      }
      if (dir > 0 && driveTorque > limit) {
        driveTorque = Math.max(0, limit);
        this.tcsActive = true;
      } else if (dir < 0 && driveTorque < limit) {
        driveTorque = Math.min(0, limit);
        this.tcsActive = true;
      }
    }

    let brakeRear = brake * cfg.maxBrakeTorque * (1 - cfg.brakeBias);
    if (handbrake < 0.1) brakeRear = this.applyAbs(brakeRear, Arear, baseNoDrive + driveTorque, rear.meanVx);
    brakeRear += handbrake * cfg.handbrakeTorque;
    this.omegaRear = solveWheel(Arear, baseNoDrive + driveTorque, brakeRear);

    if (this.clutch === 'locked') {
      this.engineOmega = Math.max(this.omegaRear * G, idleOmega * 0.9);
    }
    const fullTorque = torqueCurveAt(cfg.torqueCurve, this.rpm);
    this.engineLoad =
      this.clutch === 'open' ? (gb.isShifting() ? 0 : throttle) : clamp01(driveTorque / (G * eta || 1) / Math.max(fullTorque, 1));

    // Second pass with the solved wheel speeds → forces applied to the body.
    this.evaluateTires();

    // ------------------------------------------------------------ body forces
    let fx = 0;
    let fy = 0;
    let mz = 0;
    let maxSlip = 0;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const t = this.tireOut[i];
      let bx = t.fx;
      let by = t.fy;
      if (w.front) {
        bx = t.fx * cosD - t.fy * sinD;
        by = t.fx * sinD + t.fy * cosD;
      }
      fx += bx;
      fy += by;
      mz += w.x * by - w.y * bx;
      w.fx = t.fx;
      w.fy = t.fy;
      w.slip = t.slip;
      w.slipAngle = Math.atan(this.slipTan[i]);
      if (t.slip > maxSlip && w.fz > 200) maxSlip = t.slip;
      w.spin += (w.front ? this.omegaFront : this.omegaRear) * dt;
    }
    this.maxSlip = maxSlip;

    const speed = Math.hypot(this.u, this.v);
    const dragK = 0.5 * cfg.airDensity * cfg.dragArea * speed;
    fx -= dragK * this.u;
    fy -= dragK * this.v;
    const totalLoad = baseLoad + downforce;
    fx -= cfg.rollingResistance * totalLoad * Math.tanh(this.u * 2);

    this.ax = fx / m;
    this.ay = fy / m;

    const cosP = Math.cos(this.psi);
    const sinP = Math.sin(this.psi);
    // Gravity along the slope, expressed in the body frame.
    fx -= m * GRAVITY * sinG * cosP;
    fy += m * GRAVITY * sinG * sinP;

    this.u += (fx / m + this.r * this.v) * dt;
    this.v += (fy / m - this.r * this.u) * dt;
    this.r += (mz / cfg.yawInertia) * dt;

    // Hold the car still when stopped on the brakes (static friction).
    if (throttleIn < 0.02 && (brake > 0.05 || handbrake > 0.05) && Math.abs(this.u) < 0.12 && Math.abs(this.v) < 0.12) {
      this.u = 0;
      this.v = 0;
      this.r *= 0.5;
      this.omegaFront = 0;
      this.omegaRear = 0;
    }

    // --------------------------------------------------- Frenet kinematics
    const vs = this.u * cosP - this.v * sinP;
    const vd = this.u * sinP + this.v * cosP;
    const sdot = vs / Math.max(0.2, 1 - kappa * this.d);
    this.s += sdot * dt;
    this.d += vd * dt;
    this.psi = wrapAngle(this.psi + (this.r - kappa * sdot) * dt);

    // ------------------------------------------------------ sprung mass
    const pitchAcc =
      ((1 - geo) * (-m * this.ax * h) - cfg.pitchStiffness * this.pitch - cfg.pitchDamping * this.pitchRate) / cfg.pitchInertia;
    this.pitchRate += pitchAcc * dt;
    this.pitch += this.pitchRate * dt;
    const rollAcc = ((1 - geo) * (m * this.ay * h) - cfg.rollStiffness * this.roll - cfg.rollDamping * this.rollRate) / cfg.rollInertia;
    this.rollRate += rollAcc * dt;
    this.roll += this.rollRate * dt;

    const bump = road.roughness(this.s, this.d);
    const heaveAcc = -cfg.heaveStiffness * (this.heave - bump) - cfg.heaveDamping * this.heaveRate - u2 * kv;
    this.heaveRate += heaveAcc * dt;
    this.heave += this.heaveRate * dt;

    // Per-corner compression for the visual suspension (+ = wheel pushed up into the arch).
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      w.compression = -this.heave + w.x * this.pitch - w.y * this.roll;
    }
  }

  /** Aggregates implicit-solver terms for one axle. */
  private axleTerms(i0: number, i1: number): { stiffness: number; stiffnessVel: number; meanVx: number } {
    const t0 = this.tireOut[i0];
    const t1 = this.tireOut[i1];
    const k0 = t0.longStiffness / this.longDen[i0];
    const k1 = t1.longStiffness / this.longDen[i1];
    return {
      stiffness: k0 + k1,
      stiffnessVel: k0 * this.vxw[i0] + k1 * this.vxw[i1],
      meanVx: 0.5 * (this.vxw[i0] + this.vxw[i1]),
    };
  }

  /** ABS: limits brake torque so the axle's slip ratio does not pass the target (just before the tire's peak). */
  private applyAbs(brakeTorque: number, A: number, base: number, meanVx: number): number {
    if (!this.absEnabled || brakeTorque <= 0 || Math.abs(meanVx) < 1.5) return brakeTorque;
    const dir = Math.sign(meanVx);
    const targetSlip = this.cfg.absSlipTarget * this.cfg.tirePeakSlipRatio;
    const omegaTarget = (meanVx * (1 - targetSlip)) / this.cfg.wheelRadius;
    const needed = dir * (base - A * omegaTarget);
    if (brakeTorque > needed) {
      this.absActive = true;
      return Math.max(0, needed);
    }
    return brakeTorque;
  }

  private evaluateTires(): void {
    const cfg = this.cfg;
    const R = cfg.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const omega = w.front ? this.omegaFront : this.omegaRear;
      const kappa = (omega * R - this.vxw[i]) / this.longDen[i];
      w.slipRatio = kappa;
      computeTireForce(cfg, w.fz, kappa, this.slipTan[i], w.front ? cfg.frontGrip : cfg.rearGrip, this.tireOut[i]);
    }
  }
}

/**
 * Backward-Euler wheel spin update with Coulomb brake friction.
 * Solves  A·ω' = base − sign(ω')·Tb, where A and base already contain the linearised tire force.
 * If the brake can hold the wheel against all other torques, the wheel locks (ω' = 0).
 */
export function solveWheel(A: number, base: number, brakeTorque: number): number {
  if (brakeTorque <= 0) return base / A;
  if (Math.abs(base) <= brakeTorque) return 0;
  return (base - Math.sign(base) * brakeTorque) / A;
}
