import { DEFAULT_VEHICLE, type VehicleConfig } from './VehicleConfig.ts';

export type CarId = 'kestrel' | 'tempest' | 'vortex' | 'falco' | 'sprite';

/** How the engine is synthesized: firing order sets the base pitch, `burble` the sub-harmonic. */
export interface EngineSound {
  cylinders: number;
  /** Sub-harmonic ratio of the firing frequency (1/2 = cross-plane V8 burble, 1/3 = straight-six growl). */
  subHarmonic: number;
  /** 0..1 extra brightness (high-revving engines sound raspier). */
  rasp: number;
}

/** Headline numbers shown in the garage. They are checked against the simulation in tests/catalog.test.ts. */
export interface CarSpecs {
  powerHp: number;
  torqueNm: number;
  /** Simulated 0-100 km/h time (s). */
  zeroToHundred: number;
  /** Simulated top speed (km/h). */
  topSpeedKmh: number;
  weightKg: number;
  layout: string;
  engine: string;
  gears: number;
}

/** Garage rating bars, 0..1. */
export interface CarRatings {
  speed: number;
  acceleration: number;
  handling: number;
  braking: number;
}

export interface CarDefinition {
  id: CarId;
  name: string;
  /** Short class label, e.g. "MID-ENGINE SUPERCAR". */
  category: string;
  description: string;
  config: VehicleConfig;
  specs: CarSpecs;
  ratings: CarRatings;
  sound: EngineSound;
  /** Paint the car wears in its garage presentation when the player never picked one. */
  defaultPaint: number;
}

const torque = (points: [number, number][]): VehicleConfig['torqueCurve'] => points.map(([rpm, t]) => ({ rpm, torque: t }));

/**
 * The garage. All five are rear-wheel drive; they differ in mass, weight distribution,
 * power delivery, gearing, aero and tires, so each one drives differently:
 *  - Kestrel: the balanced sports sedan (the original car).
 *  - Tempest: heavy, torquey front-engine V8 grand tourer; stable and fast.
 *  - Vortex: mid-engine V10 supercar; most power, sharpest turn-in, highest top speed.
 *  - Falco: rear-engine flat-six coupé; huge traction and braking, lively tail.
 *  - Sprite: light roadster; slowest in a straight line, most agile.
 */
export const CARS: readonly CarDefinition[] = [
  {
    id: 'kestrel',
    name: 'Kestrel S',
    category: 'SPORTS SEDAN',
    description: 'Four doors, a twin-turbo straight six and a chassis that forgives. The all-rounder.',
    config: DEFAULT_VEHICLE,
    specs: {
      powerHp: 400,
      torqueNm: 480,
      zeroToHundred: 4.7,
      topSpeedKmh: 282,
      weightKg: 1480,
      layout: 'Front · RWD',
      engine: '3.0 L twin-turbo I6',
      gears: 6,
    },
    ratings: { speed: 0.62, acceleration: 0.5, handling: 0.65, braking: 0.6 },
    sound: { cylinders: 6, subHarmonic: 1 / 3, rasp: 0.3 },
    defaultPaint: 0xb3121b,
  },
  {
    id: 'tempest',
    name: 'Tempest GT',
    category: 'GRAND TOURER',
    description: 'A long bonnet over a thundering V8. Heavy, planted and brutally fast on the motorway.',
    config: {
      ...DEFAULT_VEHICLE,
      mass: 1640,
      yawInertia: 2650,
      pitchInertia: 2350,
      rollInertia: 600,
      wheelbase: 2.74,
      cgToFront: 1.34,
      cgHeight: 0.47,
      trackFront: 1.62,
      trackRear: 1.62,
      halfLength: 2.31,
      halfWidth: 0.98,
      wheelRadius: 0.35,
      tireMu: 1.12,
      tirePeakSlipAngleFront: 0.14,
      tirePeakSlipAngleRear: 0.092,
      rearGrip: 1.1,
      idleRPM: 800,
      redlineRPM: 6900,
      limiterRPM: 7200,
      launchRPM: 3000,
      torqueCurve: torque([
        [0, 250],
        [1000, 430],
        [2000, 640],
        [3000, 700],
        [4000, 700],
        [5000, 690],
        [6000, 660],
        [6800, 610],
        [7200, 570],
        [7900, 380],
      ]),
      engineInertia: 0.26,
      engineFriction0: 26,
      engineFrictionPerRPM: 0.0095,
      gearRatios: [3.4, 2.2, 1.62, 1.28, 1.05, 0.88],
      reverseRatio: 3.4,
      finalDrive: 3.2,
      autoUpshiftRPM: 6750,
      autoUpshiftRPMLight: 2500,
      autoDownshiftRPM: 3900,
      autoDownshiftRPMLight: 1400,
      maxBrakeTorque: 10600,
      brakeBias: 0.64,
      handbrakeTorque: 4600,
      escCharacteristicSpeed: 35,
      pitchStiffness: 185000,
      pitchDamping: 20500,
      rollStiffness: 112000,
      rollDamping: 7600,
      dragArea: 0.86,
      downforceArea: 0.3,
    },
    specs: {
      powerHp: 590,
      torqueNm: 700,
      zeroToHundred: 4.4,
      topSpeedKmh: 318,
      weightKg: 1640,
      layout: 'Front-mid · RWD',
      engine: '4.0 L twin-turbo V8',
      gears: 6,
    },
    ratings: { speed: 0.86, acceleration: 0.72, handling: 0.6, braking: 0.63 },
    sound: { cylinders: 8, subHarmonic: 1 / 2, rasp: 0.15 },
    defaultPaint: 0x14452f,
  },
  {
    id: 'vortex',
    name: 'Vortex V10',
    category: 'MID-ENGINE SUPERCAR',
    description: 'A screaming 8,700 rpm V10 behind your head and a wedge that slices the air. Fastest in the garage.',
    config: {
      ...DEFAULT_VEHICLE,
      mass: 1470,
      yawInertia: 2150,
      pitchInertia: 1900,
      rollInertia: 520,
      wheelbase: 2.62,
      cgToFront: 1.47,
      cgHeight: 0.44,
      trackFront: 1.66,
      trackRear: 1.64,
      halfLength: 2.27,
      halfWidth: 0.99,
      wheelRadius: 0.35,
      tireMu: 1.2,
      tirePeakSlipAngleFront: 0.13,
      tirePeakSlipAngleRear: 0.088,
      frontGrip: 1.0,
      rearGrip: 1.12,
      idleRPM: 950,
      redlineRPM: 8500,
      limiterRPM: 8700,
      launchRPM: 4200,
      torqueCurve: torque([
        [0, 200],
        [1000, 300],
        [2000, 400],
        [3000, 480],
        [4000, 540],
        [5000, 580],
        [6000, 600],
        [6500, 600],
        [7500, 575],
        [8250, 545],
        [8700, 510],
        [9400, 330],
      ]),
      engineInertia: 0.19,
      engineFriction0: 24,
      engineFrictionPerRPM: 0.0082,
      gearRatios: [3.1, 2.19, 1.68, 1.35, 1.13, 0.98, 0.886],
      reverseRatio: 3.2,
      finalDrive: 3.8,
      autoUpshiftRPM: 8350,
      autoUpshiftRPMLight: 3000,
      autoDownshiftRPM: 5200,
      autoDownshiftRPMLight: 1700,
      maxBrakeTorque: 10400,
      brakeBias: 0.6,
      handbrakeTorque: 4400,
      escCharacteristicSpeed: 38,
      frontRollShare: 0.6,
      pitchStiffness: 190000,
      pitchDamping: 20000,
      rollStiffness: 125000,
      rollDamping: 7800,
      dragArea: 0.9,
      downforceArea: 0.5,
      aeroBalanceFront: 0.4,
    },
    specs: {
      powerHp: 640,
      torqueNm: 600,
      zeroToHundred: 3.6,
      topSpeedKmh: 322,
      weightKg: 1470,
      layout: 'Mid · RWD',
      engine: '5.2 L V10',
      gears: 7,
    },
    ratings: { speed: 0.95, acceleration: 0.95, handling: 0.85, braking: 0.85 },
    sound: { cylinders: 10, subHarmonic: 1 / 2, rasp: 0.75 },
    defaultPaint: 0xe07a12,
  },
  {
    id: 'falco',
    name: 'Falco 6 RS',
    category: 'REAR-ENGINE COUPÉ',
    description: 'A 9,000 rpm flat six hung out over the rear axle: monster traction, fierce braking, a tail that talks.',
    config: {
      ...DEFAULT_VEHICLE,
      mass: 1440,
      yawInertia: 2150,
      pitchInertia: 1850,
      rollInertia: 520,
      wheelbase: 2.46,
      cgToFront: 1.5,
      cgHeight: 0.46,
      trackFront: 1.58,
      trackRear: 1.56,
      halfLength: 2.25,
      halfWidth: 0.95,
      wheelRadius: 0.345,
      tireMu: 1.18,
      tirePeakSlipAngleFront: 0.13,
      tirePeakSlipAngleRear: 0.08,
      rearGrip: 1.17,
      frontRollShare: 0.64,
      idleRPM: 900,
      redlineRPM: 9000,
      limiterRPM: 9200,
      launchRPM: 4500,
      torqueCurve: torque([
        [0, 180],
        [1000, 260],
        [2000, 330],
        [3000, 390],
        [4000, 430],
        [5000, 450],
        [6000, 465],
        [6500, 470],
        [7500, 460],
        [8500, 434],
        [9200, 400],
        [9800, 280],
      ]),
      engineInertia: 0.18,
      engineFriction0: 22,
      engineFrictionPerRPM: 0.008,
      gearRatios: [3.75, 2.38, 1.76, 1.39, 1.16, 1.0, 0.9],
      reverseRatio: 3.4,
      finalDrive: 3.97,
      autoUpshiftRPM: 8850,
      autoUpshiftRPMLight: 3100,
      autoDownshiftRPM: 5200,
      autoDownshiftRPMLight: 1700,
      maxBrakeTorque: 10200,
      brakeBias: 0.58,
      handbrakeTorque: 4300,
      escCharacteristicSpeed: 36,
      pitchStiffness: 175000,
      pitchDamping: 19000,
      rollStiffness: 118000,
      rollDamping: 7400,
      dragArea: 0.86,
      downforceArea: 0.46,
      aeroBalanceFront: 0.3,
    },
    specs: {
      powerHp: 525,
      torqueNm: 470,
      zeroToHundred: 3.5,
      topSpeedKmh: 306,
      weightKg: 1440,
      layout: 'Rear · RWD',
      engine: '4.0 L flat six',
      gears: 7,
    },
    ratings: { speed: 0.82, acceleration: 0.85, handling: 0.82, braking: 0.88 },
    sound: { cylinders: 6, subHarmonic: 1 / 2, rasp: 0.9 },
    defaultPaint: 0xa9adb3,
  },
  {
    id: 'sprite',
    name: 'Sprite R',
    category: 'ROADSTER',
    description: 'Roof down, 1,180 kg and a turbo four. Slowest on the straights, but it changes lanes like nothing else.',
    config: {
      ...DEFAULT_VEHICLE,
      mass: 1180,
      yawInertia: 1650,
      pitchInertia: 1400,
      rollInertia: 420,
      wheelbase: 2.4,
      cgToFront: 1.2,
      cgHeight: 0.45,
      trackFront: 1.52,
      trackRear: 1.52,
      halfLength: 2.02,
      halfWidth: 0.9,
      wheelRadius: 0.32,
      wheelInertia: 1.1,
      tireMu: 1.12,
      tirePeakSlipAngleFront: 0.135,
      tirePeakSlipAngleRear: 0.098,
      rearGrip: 1.06,
      tireNominalLoad: 2900,
      idleRPM: 850,
      redlineRPM: 7000,
      limiterRPM: 7200,
      launchRPM: 3800,
      torqueCurve: torque([
        [0, 160],
        [1000, 230],
        [2000, 340],
        [3000, 380],
        [4000, 380],
        [5000, 370],
        [6000, 345],
        [6500, 325],
        [7200, 290],
        [7800, 190],
      ]),
      engineInertia: 0.17,
      engineFriction0: 18,
      engineFrictionPerRPM: 0.0075,
      gearRatios: [3.45, 2.19, 1.54, 1.18, 1.0, 0.84],
      reverseRatio: 3.5,
      finalDrive: 3.73,
      autoUpshiftRPM: 6850,
      autoUpshiftRPMLight: 2700,
      autoDownshiftRPM: 3900,
      autoDownshiftRPMLight: 1500,
      maxBrakeTorque: 7600,
      brakeBias: 0.62,
      handbrakeTorque: 3600,
      escCharacteristicSpeed: 34,
      steerLateralAccel: 15,
      steerRate: 1.15,
      pitchStiffness: 140000,
      pitchDamping: 15500,
      rollStiffness: 86000,
      rollDamping: 5900,
      dragArea: 0.86,
      downforceArea: 0.22,
    },
    specs: {
      powerHp: 300,
      torqueNm: 380,
      zeroToHundred: 4.9,
      topSpeedKmh: 254,
      weightKg: 1180,
      layout: 'Front-mid · RWD',
      engine: '2.0 L turbo I4',
      gears: 6,
    },
    ratings: { speed: 0.45, acceleration: 0.45, handling: 0.95, braking: 0.66 },
    sound: { cylinders: 4, subHarmonic: 1 / 2, rasp: 0.5 },
    defaultPaint: 0x2b6cc4,
  },
];

export const DEFAULT_CAR: CarId = 'kestrel';

export const CAR_IDS: readonly CarId[] = CARS.map((c) => c.id);

export function isCarId(value: unknown): value is CarId {
  return typeof value === 'string' && (CAR_IDS as readonly string[]).includes(value);
}

export function getCar(id: CarId): CarDefinition {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}
