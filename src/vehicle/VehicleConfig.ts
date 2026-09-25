/**
 * Every tuning value for the player car lives here. All units are SI
 * (kg, m, s, N, Nm, rad) unless the name says otherwise (RPM, km/h).
 *
 * The defaults describe a ~380 hp front-engine, rear-wheel-drive sports sedan:
 *  - 0-100 km/h ≈ 5 s, top speed ≈ 280 km/h (drag limited in 6th)
 *  - 100-0 km/h braking ≈ 36 m
 *  - mild understeer at the limit, lift/handbrake oversteer available
 */
export interface TorquePoint {
  rpm: number;
  torque: number;
}

export interface VehicleConfig {
  // ---------------------------------------------------------------- chassis
  /** Total mass including driver. */
  mass: number;
  /** Yaw moment of inertia. Higher = lazier rotation, more stable. */
  yawInertia: number;
  /** Pitch/roll inertia of the sprung mass (drive the visual body motion). */
  pitchInertia: number;
  rollInertia: number;
  wheelbase: number;
  /** Distance from the center of gravity to the front axle. Smaller = more front weight. */
  cgToFront: number;
  cgHeight: number;
  trackFront: number;
  trackRear: number;
  /** Collision box half-extents. */
  halfLength: number;
  halfWidth: number;

  // ------------------------------------------------------------ wheels/tires
  wheelRadius: number;
  /** Rotational inertia per wheel (wheel + tire + brake disc). */
  wheelInertia: number;
  /** Peak tire friction coefficient at nominal load. */
  tireMu: number;
  /**
   * Magic-formula shape factor (C). Controls how much grip is lost past the peak:
   * sliding grip = sin(C·π/2) of peak. 1.41 → ~80 % of peak when fully sliding.
   */
  tireShape: number;
  /**
   * Slip angle (rad) where lateral grip peaks, per axle. A larger front than rear value
   * gives a softer front / stiffer rear, i.e. linear-range understeer (≈1°/g by default),
   * which is what keeps the car calm at 250+ km/h.
   */
  tirePeakSlipAngleFront: number;
  tirePeakSlipAngleRear: number;
  /** Slip ratio where longitudinal grip peaks. */
  tirePeakSlipRatio: number;
  /** Grip loss per unit of load above nominal (tire load sensitivity). Drives understeer from weight transfer. */
  tireLoadSensitivity: number;
  /** Load (N) at which tireMu applies. */
  tireNominalLoad: number;
  /** Per-axle grip multipliers for balance tuning. */
  frontGrip: number;
  rearGrip: number;
  /** Rolling resistance coefficient. */
  rollingResistance: number;

  // ----------------------------------------------------------------- engine
  idleRPM: number;
  /** RPM where the tach turns red and the automatic upshifts at full throttle. */
  redlineRPM: number;
  /** Fuel cut RPM. */
  limiterRPM: number;
  /** RPM the auto-clutch holds while launching from a stop at full throttle. */
  launchRPM: number;
  /** Full-throttle torque curve (engine output, Nm). Linearly interpolated. */
  torqueCurve: TorquePoint[];
  /** Crank + flywheel inertia. Reflected through the gearbox when the clutch is locked. */
  engineInertia: number;
  /** Engine braking torque = friction0 + frictionPerRPM · rpm, applied off-throttle. */
  engineFriction0: number;
  engineFrictionPerRPM: number;

  // ------------------------------------------------------------ transmission
  /** Forward gear ratios, 1st to 6th. */
  gearRatios: number[];
  reverseRatio: number;
  finalDrive: number;
  drivetrainEfficiency: number;
  /** Seconds the clutch is open during a shift. */
  shiftTime: number;
  /** Automatic: full-throttle upshift RPM. */
  autoUpshiftRPM: number;
  /** Automatic: light-throttle upshift RPM. */
  autoUpshiftRPMLight: number;
  /** Automatic: downshift RPM at full throttle (kickdown) and when coasting. */
  autoDownshiftRPM: number;
  autoDownshiftRPMLight: number;

  // ----------------------------------------------------------------- brakes
  /** Total brake torque at full pedal (all four wheels). */
  maxBrakeTorque: number;
  /** Fraction of brake torque on the front axle. */
  brakeBias: number;
  /** Rear-axle torque from the handbrake. Enough to lock the rears at any speed. */
  handbrakeTorque: number;
  /** ABS target slip ratio (fraction of the tire's peak slip ratio). */
  absSlipTarget: number;
  /** Traction control target slip ratio (fraction of the tire's peak slip ratio). */
  tcsSlipTarget: number;
  /**
   * Stability control (ESC). When the car rotates faster than the driver's steering asks
   * for (oversteer), ESC brakes individual wheels to create a correcting yaw moment.
   * Gain is in 1/s (fraction of yaw-rate error removed per second).
   */
  escYawGain: number;
  /** Largest corrective yaw moment ESC can create (Nm), roughly one wheel at its braking limit. */
  escMaxYawMoment: number;
  /** Characteristic speed (m/s) of ESC's reference yaw model; lower = expects more understeer. */
  escCharacteristicSpeed: number;

  // --------------------------------------------------------------- steering
  /** Maximum road-wheel angle at walking pace. */
  maxSteerAngle: number;
  /**
   * Speed-sensitive steering: the steering lock is limited to
   * wheelbase · steerLateralAccel / v² + steerSlipAllowance, i.e. just enough
   * to reach (and slightly exceed) the tires' grip at any speed.
   */
  steerLateralAccel: number;
  steerSlipAllowance: number;
  /** Maximum steering rack speed at the road wheels (rad/s). */
  steerRate: number;

  // ------------------------------------------------------------- suspension
  /** Pitch spring/damper (Nm/rad, Nm·s/rad). Softer = more dive/squat. */
  pitchStiffness: number;
  pitchDamping: number;
  /** Roll spring/damper incl. anti-roll bars. Softer = more body roll. */
  rollStiffness: number;
  rollDamping: number;
  /** Fraction of roll stiffness on the front axle. >0.5 = more understeer. */
  frontRollShare: number;
  /** Heave spring/damper per unit sprung mass (1/s², 1/s). */
  heaveStiffness: number;
  heaveDamping: number;
  /** Fraction of load transfer that is instantaneous (suspension geometry) instead of via springs. */
  geometricTransfer: number;

  // ------------------------------------------------------------------- aero
  /** Drag coefficient × frontal area (m²). Main top-speed limiter. */
  dragArea: number;
  /** Downforce coefficient × area (m²). */
  downforceArea: number;
  /** Fraction of downforce on the front axle. */
  aeroBalanceFront: number;
  airDensity: number;
}

export const DEFAULT_VEHICLE: VehicleConfig = {
  mass: 1480,
  yawInertia: 2350,
  pitchInertia: 2100,
  rollInertia: 560,
  wheelbase: 2.78,
  cgToFront: 1.3,
  cgHeight: 0.5,
  trackFront: 1.58,
  trackRear: 1.6,
  halfLength: 2.33,
  halfWidth: 0.95,

  wheelRadius: 0.34,
  wheelInertia: 1.3,
  tireMu: 1.1,
  tireShape: 1.41,
  tirePeakSlipAngleFront: 0.14,
  tirePeakSlipAngleRear: 0.095,
  tirePeakSlipRatio: 0.11,
  tireLoadSensitivity: 0.12,
  tireNominalLoad: 3600,
  frontGrip: 1.0,
  rearGrip: 1.08,
  rollingResistance: 0.013,

  idleRPM: 850,
  redlineRPM: 7200,
  limiterRPM: 7500,
  launchRPM: 3600,
  torqueCurve: [
    { rpm: 0, torque: 180 },
    { rpm: 1000, torque: 290 },
    { rpm: 2000, torque: 380 },
    { rpm: 3000, torque: 445 },
    { rpm: 4000, torque: 480 },
    { rpm: 5000, torque: 478 },
    { rpm: 6000, torque: 455 },
    { rpm: 6800, torque: 420 },
    { rpm: 7500, torque: 370 },
    { rpm: 8200, torque: 250 },
  ],
  engineInertia: 0.22,
  engineFriction0: 22,
  engineFrictionPerRPM: 0.0085,

  gearRatios: [3.8, 2.36, 1.69, 1.29, 1.03, 0.84],
  reverseRatio: 3.6,
  finalDrive: 3.62,
  drivetrainEfficiency: 0.9,
  shiftTime: 0.18,
  autoUpshiftRPM: 7050,
  autoUpshiftRPMLight: 2800,
  autoDownshiftRPM: 4300,
  autoDownshiftRPMLight: 1500,

  maxBrakeTorque: 9200,
  brakeBias: 0.66,
  handbrakeTorque: 4200,
  absSlipTarget: 0.9,
  tcsSlipTarget: 1.1,
  escYawGain: 6,
  escMaxYawMoment: 6000,
  escCharacteristicSpeed: 36,

  maxSteerAngle: 0.6,
  steerLateralAccel: 14,
  steerSlipAllowance: 0.095,
  steerRate: 1.0,

  pitchStiffness: 170000,
  pitchDamping: 19000,
  rollStiffness: 105000,
  rollDamping: 7200,
  frontRollShare: 0.64,
  heaveStiffness: 150,
  heaveDamping: 13,
  geometricTransfer: 0.3,

  dragArea: 0.84,
  downforceArea: 0.32,
  aeroBalanceFront: 0.38,
  airDensity: 1.225,
};
