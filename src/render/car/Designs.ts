import type { CarId } from '../../vehicle/CarCatalog.ts';
import type { VehicleConfig } from '../../vehicle/VehicleConfig.ts';
import { ellipse, FRONT, LEFT, REAR, REAR_TEXT, roundedRect, smoothOutline, TOP, type Vec2 } from './Decal.ts';
import type { DesignFactory, DetailContext } from './Design.ts';
import {
  cockpit,
  diffuser,
  doorMirror,
  exhaustTip,
  frontSplitter,
  headrestFairing,
  rearWing,
  roadsterWindshield,
  rollHoop,
  sideLine,
  wipers,
} from './Parts.ts';

/*
 * The five body designs. Every line is placed relative to the car's own physics
 * dimensions (axles, wheel radius, overall length), so the bodywork always wraps the
 * simulated wheels and collision box. Heights are metres above the road.
 */

interface Dims {
  zf: number;
  zr: number;
  R: number;
  nose: number;
  tail: number;
}

const dims = (cfg: VehicleConfig): Dims => ({
  zf: cfg.cgToFront,
  zr: cfg.cgToFront - cfg.wheelbase,
  R: cfg.wheelRadius,
  nose: cfg.halfLength - 0.005,
  tail: -cfg.halfLength + 0.005,
});

/** Scales an outline about (ca, cb), e.g. to inset a grille inside its surround. */
const inset = (pts: readonly Vec2[], ca: number, cb: number, ka: number, kb: number): Vec2[] =>
  pts.map(([a, b]) => [ca + (a - ca) * ka, cb + (b - cb) * kb] as Vec2);

/** Rear number plate centered at height y. */
function rearPlate(ctx: DetailContext, y: number, w = 0.52, h = 0.12): void {
  ctx.decal(REAR, roundedRect(0, y, w + 0.03, h + 0.03, 0.012), 'gloss', { offset: 0.003 });
  ctx.decal(REAR_TEXT, roundedRect(0, y, w, h, 0.008), 'plate', { offset: 0.006 });
}

/** Grille opening: gloss surround with a honeycomb insert. */
function grille(ctx: DetailContext, pts: readonly Vec2[], ca: number, cb: number, mirror: boolean, frame: 'gloss' | 'chrome' = 'gloss'): void {
  ctx.decal(FRONT, pts, frame, { mirror, offset: 0.002 });
  ctx.decal(FRONT, inset(pts, ca, cb, 0.93, 0.86), 'grille', { mirror, offset: 0.004, uvScale: 0.09 });
}

// ------------------------------------------------------------------ Kestrel S (sports sedan)

const kestrel: DesignFactory = (cfg) => {
  const { zf, zr, R, nose, tail } = dims(cfg);
  return {
    body: {
      zFront: nose,
      zRear: tail,
      halfWidth: [
        [nose, 0.83],
        [nose - 0.22, 0.91],
        [zf, 0.95],
        [0, 0.94],
        [zr, 0.955],
        [tail + 0.3, 0.93],
        [tail, 0.86],
      ],
      top: [
        [nose, 0.6],
        [nose - 0.04, 0.68],
        [nose - 0.18, 0.76],
        [nose - 0.6, 0.82],
        [zf, 0.85],
        [0.8, 0.88],
        [0, 0.92],
        [-1.0, 0.98],
        [tail + 0.5, 1.0],
        [tail + 0.12, 0.995],
        [tail + 0.04, 0.9],
        [tail, 0.62],
      ],
      bottom: [
        [nose, 0.6],
        [nose - 0.02, 0.46],
        [nose - 0.08, 0.3],
        [nose - 0.22, 0.18],
        [nose - 0.42, 0.155],
        [tail + 0.5, 0.16],
        [tail + 0.3, 0.2],
        [tail + 0.12, 0.3],
        [tail + 0.03, 0.46],
        [tail, 0.62],
      ],
      waist: 0.56,
      shoulder: 3.8,
      tuck: 0.09,
      fender: [
        [nose - 0.1, 0],
        [zf, 0.05],
        [zf - 0.5, 0.01],
        [zr + 0.5, 0.01],
        [zr, 0.045],
        [tail + 0.2, 0],
      ],
      fenderX: 0.84,
      valley: [
        [nose, 0],
        [zf, 0.012],
        [0.8, 0],
      ],
      nose: { depth: 0.26, length: 0.55, exponent: 3.2 },
      tail: { depth: 0.2, length: 0.45, exponent: 3.6 },
      arches: [
        { z: zf, radius: R + 0.055, centerY: R, innerX: 0.45 },
        { z: zr, radius: R + 0.055, centerY: R, innerX: 0.55 },
      ],
      diffuserTop: 0.28,
      lipTop: 0.21,
    },
    cabin: {
      zFront: 0.86,
      zRear: -1.34,
      roof: [
        [0.86, 0.86],
        [0.6, 1.0],
        [0.3, 1.16],
        [0.05, 1.28],
        [-0.3, 1.36],
        [-0.7, 1.37],
        [-0.95, 1.33],
        [-1.12, 1.22],
        [-1.24, 1.1],
        [-1.34, 1.0],
      ],
      rail: [
        [0.86, 0.84],
        [0.5, 1.02],
        [0.2, 1.17],
        [-0.1, 1.29],
        [-0.6, 1.32],
        [-0.95, 1.27],
        [-1.15, 1.13],
        [-1.34, 0.98],
      ],
      baseHalfWidth: [
        [0.86, 0.78],
        [0, 0.82],
        [-1.34, 0.76],
      ],
      railHalfWidth: [
        [0.86, 0.7],
        [0, 0.67],
        [-1.34, 0.6],
      ],
      roofShape: 2.6,
      sink: 0.04,
    },
    windows: {
      windshieldTop: 0.0,
      aPillar: 0.075,
      sideTopInset: 0.02,
      belt: 0.075,
      sideRearTop: -1.02,
      sideRearBottom: -1.17,
      bPillar: { z: -0.36, width: 0.085 },
      rearTop: -0.92,
      rearBottom: -1.3,
      rearInset: 0.09,
      roof: 'paint',
      frame: 'chrome',
    },
    wheels: { style: 'fiveDouble', finish: 'silver', caliper: 0x1f4fb0, width: 0.25, rimRatio: 0.68, dish: 0.03 },
    headlight: [0.64, 0.66, nose - 0.1],
    hoodCamera: [0, 1.12, 0.98],
    detail(ctx) {
      // Headlights with projector pair and a DRL brow.
      const head: Vec2[] = smoothOutline(
        [
          [0.44, 0.7],
          [0.66, 0.725],
          [0.82, 0.71],
          [0.84, 0.66],
          [0.7, 0.63],
          [0.46, 0.64],
        ],
        5,
      );
      ctx.decal(FRONT, head, 'lampHousing', { mirror: true, maxEdge: 0.035 });
      ctx.decal(FRONT, inset(head, 0.64, 0.68, 0.94, 0.3).map(([a, b]) => [a, b + 0.022] as Vec2), 'drl', { mirror: true, offset: 0.005, maxEdge: 0.035 });
      for (const x of [0.54, 0.68]) ctx.decal(FRONT, ellipse(x, 0.668, 0.035, 0.024, 18), 'headLamp', { mirror: true, offset: 0.005, maxEdge: 0.03 });
      // Twin kidney grille, lower intake and side vents.
      const kidney = roundedRect(0.15, 0.56, 0.24, 0.17, 0.05);
      grille(ctx, kidney, 0.15, 0.56, true, 'chrome');
      grille(ctx, roundedRect(0, 0.3, 0.9, 0.12, 0.04), 0, 0.3, false);
      grille(ctx, smoothOutline([
        [0.58, 0.38],
        [0.8, 0.4],
        [0.84, 0.26],
        [0.6, 0.26],
      ], 4), 0.7, 0.32, true);
      frontSplitter(ctx, 0.16, 0.015, 0.014, 'trim');
      // Shut lines: bonnet, doors (with B-pillar), fuel filler, sills, handles.
      ctx.decal(TOP, [
        [-0.8, 1.66],
        [0.8, 1.66],
        [0.8, 1.655],
        [-0.8, 1.655],
      ], 'dark', { offset: 0.0015, maxEdge: 0.04 });
      sideLine(ctx, [[0.8, 0.28], [0.82, 0.55], [0.8, 0.84]], 0.006);
      sideLine(ctx, [[-0.33, 0.3], [-0.34, 0.86]], 0.006);
      sideLine(ctx, [[-1.08, 0.46], [-1.0, 0.62], [-1.02, 0.9]], 0.006);
      sideLine(ctx, [[0.7, 0.2], [-1.0, 0.2]], 0.04, 'trim');
      sideLine(ctx, [[0.95, 0.72], [-1.45, 0.76]], 0.006, 'chrome');
      for (const z of [0.0, -0.78]) ctx.decal(LEFT, roundedRect(z, 0.8, 0.13, 0.03, 0.012), 'chrome', { mirror: true, offset: 0.004 });
      doorMirror(ctx, 0.66, 0.9, 0.76, 1.05);
      wipers(ctx, 0.84, 0.87, 0.6);
      // Rear: L-shaped lamps, trunk lip, quad exhausts, diffuser, plate.
      const tailLamp: Vec2[] = [
        [0.46, 0.93],
        [0.86, 0.915],
        [0.86, 0.82],
        [0.76, 0.82],
        [0.76, 0.87],
        [0.46, 0.875],
      ];
      ctx.decal(REAR, tailLamp, 'tailLens', { mirror: true, maxEdge: 0.035 });
      ctx.decal(REAR, inset(tailLamp, 0.68, 0.875, 0.9, 0.6), 'tail', { mirror: true, offset: 0.005, maxEdge: 0.035 });
      ctx.decal(REAR, roundedRect(0.52, 0.9, 0.07, 0.022, 0.006), 'reverse', { mirror: true, offset: 0.007 });
      ctx.decal(TOP, [
        [-0.72, tail + 0.14],
        [0.72, tail + 0.14],
        [0.7, tail + 0.05],
        [-0.7, tail + 0.05],
      ], 'gloss', { offset: 0.004, maxEdge: 0.04 });
      rearPlate(ctx, 0.66);
      for (const x of [0.5, 0.64]) exhaustTip(ctx, x, 0.27, 0.042, 0.042, true);
      diffuser(ctx, 0.7, 5);
      ctx.decal(REAR, roundedRect(0, 0.26, 1.5, 0.08, 0.03), 'trim', { offset: 0.002 });
      // Shark-fin antenna.
      const fin = ctx.surface(TOP, 0, -0.95, true);
      if (fin) {
        ctx.decal(TOP, smoothOutline([
          [0, -0.82],
          [0.035, -0.92],
          [0.03, -1.02],
          [-0.03, -1.02],
          [-0.035, -0.92],
        ], 4), 'gloss', { offset: 0.012, onCabin: true, maxEdge: 0.03 });
      }
    },
  };
};

// ------------------------------------------------------------------ Tempest GT (grand tourer)

const tempest: DesignFactory = (cfg) => {
  const { zf, zr, R, nose, tail } = dims(cfg);
  return {
    body: {
      zFront: nose,
      zRear: tail,
      halfWidth: [
        [nose, 0.8],
        [nose - 0.25, 0.92],
        [zf, 0.98],
        [0.4, 0.95],
        [-0.4, 0.95],
        [zr, 0.985],
        [tail + 0.3, 0.95],
        [tail, 0.86],
      ],
      top: [
        [nose, 0.55],
        [nose - 0.05, 0.63],
        [nose - 0.25, 0.71],
        [nose - 0.7, 0.77],
        [zf, 0.8],
        [0.45, 0.85],
        [-0.4, 0.9],
        [-1.3, 0.93],
        [tail + 0.28, 0.955],
        [tail + 0.11, 0.975],
        [tail + 0.04, 0.88],
        [tail, 0.6],
      ],
      bottom: [
        [nose, 0.55],
        [nose - 0.03, 0.42],
        [nose - 0.12, 0.24],
        [nose - 0.3, 0.145],
        [nose - 0.5, 0.135],
        [tail + 0.5, 0.14],
        [tail + 0.28, 0.2],
        [tail + 0.1, 0.32],
        [tail + 0.02, 0.48],
        [tail, 0.6],
      ],
      waist: 0.5,
      shoulder: 3.2,
      tuck: 0.12,
      fender: [
        [nose - 0.1, 0.01],
        [zf, 0.085],
        [zf - 0.55, 0.02],
        [0.0, 0],
        [zr + 0.55, 0.04],
        [zr, 0.1],
        [tail + 0.3, 0.02],
      ],
      fenderX: 0.8,
      valley: [
        [nose, 0],
        [zf, 0.02],
        [0.5, 0],
      ],
      nose: { depth: 0.36, length: 0.65, exponent: 2.4 },
      tail: { depth: 0.2, length: 0.45, exponent: 3 },
      arches: [
        { z: zf, radius: R + 0.06, centerY: R, innerX: 0.47 },
        { z: zr, radius: R + 0.06, centerY: R, innerX: 0.58 },
      ],
      diffuserTop: 0.3,
      lipTop: 0.18,
    },
    cabin: {
      zFront: 0.5,
      zRear: -1.72,
      roof: [
        [0.5, 0.84],
        [0.25, 0.98],
        [0.0, 1.11],
        [-0.25, 1.21],
        [-0.55, 1.25],
        [-0.85, 1.21],
        [-1.15, 1.12],
        [-1.45, 1.02],
        [-1.72, 0.95],
      ],
      rail: [
        [0.5, 0.82],
        [0.15, 0.99],
        [-0.15, 1.12],
        [-0.5, 1.19],
        [-0.85, 1.14],
        [-1.15, 1.04],
        [-1.45, 0.97],
        [-1.72, 0.93],
      ],
      baseHalfWidth: [
        [0.5, 0.74],
        [-0.4, 0.8],
        [-1.2, 0.74],
        [-1.72, 0.6],
      ],
      railHalfWidth: [
        [0.5, 0.64],
        [-0.4, 0.64],
        [-1.2, 0.55],
        [-1.72, 0.4],
      ],
      roofShape: 2.3,
      sink: 0.04,
    },
    windows: {
      windshieldTop: -0.3,
      aPillar: 0.07,
      sideTopInset: 0.018,
      belt: 0.068,
      sideRearTop: -1.08,
      sideRearBottom: -0.98,
      rearTop: -0.98,
      rearBottom: -1.66,
      rearInset: 0.13,
      roof: 'paint',
      frame: 'chrome',
    },
    wheels: { style: 'tenSpoke', finish: 'machined', caliper: 0x111111, width: 0.27, rimRatio: 0.69, dish: 0.025 },
    headlight: [0.66, 0.62, nose - 0.16],
    hoodCamera: [0, 1.06, 0.62],
    detail(ctx) {
      // Swept teardrop headlights.
      const head = smoothOutline(
        [
          [0.46, 0.66],
          [0.7, 0.69],
          [0.86, 0.66],
          [0.84, 0.6],
          [0.62, 0.595],
        ],
        5,
      );
      ctx.decal(FRONT, head, 'lampHousing', { mirror: true, maxEdge: 0.035 });
      ctx.decal(FRONT, [
        [0.5, 0.655],
        [0.7, 0.676],
        [0.82, 0.656],
        [0.8, 0.648],
        [0.69, 0.664],
        [0.51, 0.645],
      ], 'drl', { mirror: true, offset: 0.005 });
      for (const x of [0.62, 0.74]) ctx.decal(FRONT, ellipse(x, 0.63, 0.03, 0.02, 16), 'headLamp', { mirror: true, offset: 0.005, maxEdge: 0.03 });
      // Big trapezoid grille with chrome surround and a slim lower lip.
      const g = smoothOutline(
        [
          [-0.46, 0.5],
          [0, 0.53],
          [0.46, 0.5],
          [0.4, 0.24],
          [0, 0.22],
          [-0.4, 0.24],
        ],
        5,
      );
      ctx.decal(FRONT, inset(g, 0, 0.37, 1.05, 1.08), 'chrome', { offset: 0.0015 });
      grille(ctx, g, 0, 0.37, false);
      grille(ctx, roundedRect(0.66, 0.26, 0.2, 0.08, 0.03), 0.66, 0.26, true);
      frontSplitter(ctx, 0.14, 0.02, 0.014, 'carbon');
      // Bonnet vents and fender strakes.
      for (const x of [0.28]) ctx.decal(TOP, roundedRect(x, 1.55, 0.12, 0.4, 0.03), 'gloss', { mirror: true, offset: 0.002 });
      const strake = smoothOutline([
        [0.95, 0.66],
        [0.62, 0.62],
        [0.64, 0.56],
        [0.96, 0.58],
      ], 4);
      ctx.decal(LEFT, strake, 'gloss', { mirror: true, offset: 0.002 });
      sideLine(ctx, [[0.94, 0.61], [0.64, 0.59]], 0.012, 'chrome');
      sideLine(ctx, [[0.44, 0.26], [0.46, 0.55], [0.44, 0.8]], 0.006);
      sideLine(ctx, [[-0.9, 0.3], [-0.95, 0.6], [-0.92, 0.86]], 0.006);
      sideLine(ctx, [[0.8, 0.19], [-0.95, 0.19]], 0.045, 'carbon');
      ctx.decal(LEFT, roundedRect(-0.62, 0.8, 0.12, 0.025, 0.01), 'chrome', { mirror: true, offset: 0.004 });
      doorMirror(ctx, 0.28, 0.87, 0.72, 1);
      wipers(ctx, 0.48, 0.84, 0.58);
      // Rear: slim wraparound lamps, ducktail, quad pipes, diffuser.
      const tailLamp: Vec2[] = smoothOutline(
        [
          [0.34, 0.9],
          [0.7, 0.915],
          [0.86, 0.88],
          [0.82, 0.84],
          [0.36, 0.86],
        ],
        5,
      );
      ctx.decal(REAR, tailLamp, 'tailLens', { mirror: true, maxEdge: 0.035 });
      ctx.decal(REAR, inset(tailLamp, 0.6, 0.878, 0.95, 0.4), 'tail', { mirror: true, offset: 0.005, maxEdge: 0.035 });
      ctx.decal(REAR, roundedRect(0, 0.87, 0.5, 0.012, 0.005), 'chrome', { offset: 0.004 });
      rearPlate(ctx, 0.62, 0.5, 0.11);
      for (const x of [0.38, 0.5]) exhaustTip(ctx, x, 0.28, 0.045, 0.045, true);
      diffuser(ctx, 0.62, 5);
    },
  };
};

// ------------------------------------------------------------------ Vortex V10 (mid-engine supercar)

const vortex: DesignFactory = (cfg) => {
  const { zf, zr, R, nose, tail } = dims(cfg);
  return {
    body: {
      zFront: nose,
      zRear: tail,
      halfWidth: [
        [nose, 0.84],
        [nose - 0.18, 0.93],
        [zf, 0.99],
        [zf - 0.7, 0.955],
        [0.1, 0.93],
        [-0.5, 0.95],
        [zr, 0.99],
        [tail + 0.35, 0.97],
        [tail, 0.9],
      ],
      top: [
        [nose, 0.4],
        [nose - 0.06, 0.5],
        [nose - 0.22, 0.6],
        [nose - 0.5, 0.66],
        [zf, 0.7],
        [1.05, 0.76],
        [0.5, 0.8],
        [-0.3, 0.86],
        [-1.0, 0.94],
        [-1.7, 0.97],
        [tail + 0.15, 0.955],
        [tail + 0.05, 0.84],
        [tail, 0.62],
      ],
      bottom: [
        [nose, 0.4],
        [nose - 0.025, 0.3],
        [nose - 0.09, 0.19],
        [nose - 0.22, 0.13],
        [nose - 0.4, 0.115],
        [tail + 0.55, 0.12],
        [tail + 0.3, 0.2],
        [tail + 0.1, 0.34],
        [tail + 0.02, 0.5],
        [tail, 0.62],
      ],
      waist: 0.5,
      shoulder: 3.4,
      tuck: 0.1,
      fender: [
        [nose - 0.05, 0],
        [nose - 0.35, 0.06],
        [zf, 0.16],
        [zf - 0.45, 0.06],
        [0.3, 0],
        [-0.3, 0.01],
        [zr + 0.45, 0.08],
        [zr, 0.1],
        [zr - 0.5, 0.05],
        [tail + 0.1, 0],
      ],
      fenderX: 0.82,
      fenderSpread: 0.2,
      valley: [
        [nose, 0],
        [nose - 0.3, 0.02],
        [zf, 0.03],
        [1.0, 0.0],
      ],
      nose: { depth: 0.34, length: 0.6, exponent: 2.4 },
      tail: { depth: 0.16, length: 0.42, exponent: 3.2 },
      arches: [
        { z: zf, radius: R + 0.06, centerY: R, innerX: 0.5 },
        { z: zr, radius: R + 0.06, centerY: R, innerX: 0.6 },
      ],
      diffuserTop: 0.36,
      lipTop: 0.16,
    },
    cabin: {
      zFront: 1.08,
      zRear: -1.5,
      roof: [
        [1.08, 0.7],
        [0.82, 0.86],
        [0.5, 0.99],
        [0.2, 1.08],
        [-0.1, 1.12],
        [-0.38, 1.11],
        [-0.7, 1.06],
        [-1.05, 1.01],
        [-1.5, 0.96],
      ],
      rail: [
        [1.08, 0.68],
        [0.72, 0.84],
        [0.42, 0.96],
        [0.12, 1.045],
        [-0.25, 1.065],
        [-0.55, 1.02],
        [-0.95, 0.965],
        [-1.5, 0.93],
      ],
      baseHalfWidth: [
        [1.08, 0.68],
        [0.5, 0.76],
        [-0.3, 0.78],
        [-0.9, 0.72],
        [-1.5, 0.6],
      ],
      railHalfWidth: [
        [1.08, 0.6],
        [0.5, 0.62],
        [-0.3, 0.6],
        [-0.9, 0.5],
        [-1.5, 0.4],
      ],
      roofShape: 2.2,
      sink: 0.04,
    },
    windows: {
      windshieldTop: 0.18,
      aPillar: 0.07,
      sideTopInset: 0.02,
      belt: 0.07,
      sideRearTop: -0.48,
      sideRearBottom: -0.78,
      rearTop: -0.6,
      rearBottom: -1.42,
      rearInset: 0.1,
      roof: 'black',
      louvres: true,
    },
    wheels: { style: 'ySpoke', finish: 'gunmetal', caliper: 0xf2c200, width: 0.27, rimRatio: 0.7, dish: 0.03 },
    headlight: [0.62, 0.56, nose - 0.12],
    hoodCamera: [0, 0.98, 1.2],
    detail(ctx) {
      // Headlights: slim angular clusters on the nose.
      const head: Vec2[] = [
        [0.4, 0.545],
        [0.8, 0.585],
        [0.86, 0.56],
        [0.82, 0.52],
        [0.5, 0.505],
      ];
      ctx.decal(FRONT, head, 'lampHousing', { mirror: true, offset: 0.003, maxEdge: 0.035 });
      ctx.decal(FRONT, [
        [0.45, 0.537],
        [0.8, 0.572],
        [0.82, 0.565],
        [0.47, 0.53],
      ], 'drl', { mirror: true, offset: 0.005, maxEdge: 0.035 });
      for (const x of [0.6, 0.72]) ctx.decal(FRONT, ellipse(x, 0.527, 0.028, 0.012, 16), 'headLamp', { mirror: true, offset: 0.005, maxEdge: 0.03 });
      // Front intakes.
      const intake: Vec2[] = smoothOutline([
        [0.36, 0.34],
        [0.8, 0.37],
        [0.86, 0.2],
        [0.5, 0.16],
      ], 5);
      grille(ctx, intake, 0.62, 0.265, true);
      grille(ctx, roundedRect(0, 0.235, 0.56, 0.12, 0.03), 0, 0.235, false);
      frontSplitter(ctx, 0.115, 0.035);
      // Hood vents.
      for (const x of [0.12, 0.26]) ctx.decal(TOP, roundedRect(x, 1.9, 0.07, 0.22, 0.02), 'gloss', { mirror: true, offset: 0.002 });
      // Side intake ahead of the rear wheel.
      const scoop: Vec2[] = smoothOutline([
        [-0.18, 0.62],
        [-0.62, 0.66],
        [-0.76, 0.5],
        [-0.66, 0.3],
        [-0.3, 0.36],
      ], 6);
      ctx.decal(LEFT, scoop, 'gloss', { mirror: true, offset: 0.002, maxEdge: 0.04 });
      ctx.decal(LEFT, inset(scoop, -0.47, 0.48, 0.82, 0.72), 'grille', { mirror: true, offset: 0.004, uvScale: 0.09 });
      // Door shut lines and skirt.
      sideLine(ctx, [[0.98, 0.24], [1.0, 0.5], [0.97, 0.72]], 0.006);
      sideLine(ctx, [[-0.12, 0.3], [-0.16, 0.6]], 0.006);
      sideLine(ctx, [[1.05, 0.19], [-0.72, 0.2]], 0.05, 'trim');
      doorMirror(ctx, 0.8, 0.76, 0.7, 1);
      // Rear: light bar, heat-extraction mesh, diffuser, exhausts, wing, plate.
      const tailLamp: Vec2[] = [
        [0.28, 0.87],
        [0.82, 0.86],
        [0.84, 0.82],
        [0.78, 0.8],
        [0.3, 0.83],
      ];
      ctx.decal(REAR, tailLamp, 'tailLens', { mirror: true, offset: 0.003 });
      ctx.decal(REAR, inset(tailLamp, 0.56, 0.84, 0.94, 0.35), 'tail', { mirror: true, offset: 0.005 });
      ctx.decal(REAR, roundedRect(0, 0.655, 1.3, 0.17, 0.04), 'grille', { offset: 0.003, uvScale: 0.09 });
      ctx.decal(REAR, roundedRect(0.62, 0.79, 0.08, 0.02, 0.006), 'reverse', { mirror: true, offset: 0.006 });
      diffuser(ctx, 1.25, 7);
      exhaustTip(ctx, 0.5, 0.45, 0.06, 0.05, true);
      rearPlate(ctx, 0.47, 0.5, 0.11);
      rearWing(ctx, { z: tail + 0.46, y: 1.07, span: 1.72, chord: 0.3, angle: 0.1, struts: [0.42], endplates: true });
      wipers(ctx, 0.98, 0.75, 0.55);
    },
  };
};

// ------------------------------------------------------------------ Falco 6 RS (rear-engine coupé)

const falco: DesignFactory = (cfg) => {
  const { zf, zr, R, nose, tail } = dims(cfg);
  return {
    body: {
      zFront: nose,
      zRear: tail,
      halfWidth: [
        [nose, 0.76],
        [nose - 0.22, 0.86],
        [zf, 0.9],
        [0.8, 0.895],
        [0.2, 0.875],
        [zr + 0.35, 0.93],
        [zr, 0.95],
        [tail + 0.35, 0.93],
        [tail, 0.82],
      ],
      top: [
        [nose, 0.5],
        [nose - 0.08, 0.6],
        [nose - 0.3, 0.67],
        [zf, 0.71],
        [1.0, 0.76],
        [0.5, 0.8],
        [-0.3, 0.86],
        [-1.0, 0.94],
        [-1.7, 0.965],
        [tail + 0.16, 0.95],
        [tail + 0.05, 0.84],
        [tail, 0.6],
      ],
      bottom: [
        [nose, 0.5],
        [nose - 0.03, 0.36],
        [nose - 0.1, 0.22],
        [nose - 0.28, 0.145],
        [tail + 0.5, 0.15],
        [tail + 0.25, 0.22],
        [tail + 0.08, 0.34],
        [tail + 0.02, 0.48],
        [tail, 0.6],
      ],
      waist: 0.5,
      shoulder: 2.9,
      tuck: 0.12,
      fender: [
        [nose - 0.02, 0.04],
        [nose - 0.18, 0.13],
        [zf, 0.19],
        [zf - 0.6, 0.07],
        [0.2, 0.01],
        [zr + 0.55, 0.07],
        [zr, 0.13],
        [tail + 0.35, 0.05],
        [tail + 0.1, 0],
      ],
      fenderX: 0.78,
      fenderSpread: 0.2,
      valley: [
        [nose, 0.02],
        [zf, 0.05],
        [1.0, 0.0],
      ],
      nose: { depth: 0.3, length: 0.6, exponent: 2.2 },
      tail: { depth: 0.26, length: 0.5, exponent: 2.6 },
      arches: [
        { z: zf, radius: R + 0.055, centerY: R, innerX: 0.45 },
        { z: zr, radius: R + 0.06, centerY: R, innerX: 0.58 },
      ],
      diffuserTop: 0.3,
      lipTop: 0.2,
    },
    cabin: {
      zFront: 0.98,
      zRear: -1.95,
      roof: [
        [0.98, 0.79],
        [0.72, 0.95],
        [0.45, 1.1],
        [0.15, 1.23],
        [-0.2, 1.28],
        [-0.55, 1.24],
        [-0.9, 1.14],
        [-1.3, 1.04],
        [-1.95, 0.955],
      ],
      rail: [
        [0.98, 0.77],
        [0.6, 0.96],
        [0.3, 1.12],
        [0.0, 1.21],
        [-0.35, 1.23],
        [-0.7, 1.15],
        [-1.05, 1.04],
        [-1.95, 0.935],
      ],
      baseHalfWidth: [
        [0.98, 0.66],
        [0, 0.72],
        [-1.0, 0.72],
        [-1.95, 0.55],
      ],
      railHalfWidth: [
        [0.98, 0.58],
        [0, 0.6],
        [-1.0, 0.54],
        [-1.95, 0.35],
      ],
      roofShape: 2.0,
      sink: 0.04,
    },
    windows: {
      windshieldTop: 0.12,
      aPillar: 0.07,
      sideTopInset: 0.018,
      belt: 0.065,
      sideRearTop: -0.62,
      sideRearBottom: -0.9,
      rearTop: -0.72,
      rearBottom: -1.45,
      rearInset: 0.14,
      roof: 'paint',
      frame: 'black',
    },
    wheels: { style: 'mesh', finish: 'black', caliper: 0xd11a1a, width: 0.26, rimRatio: 0.7, dish: 0.035 },
    headlight: [0.62, 0.66, nose - 0.2],
    hoodCamera: [0, 1.08, 1.08],
    detail(ctx) {
      // Oval headlights on top of the fenders, four-point DRLs inside.
      const head = ellipse(0.62, 0.67, 0.12, 0.08, 28);
      ctx.decal(FRONT, head, 'lampHousing', { mirror: true, maxEdge: 0.03 });
      ctx.decal(FRONT, ellipse(0.62, 0.67, 0.045, 0.034, 18), 'headLamp', { mirror: true, offset: 0.005, maxEdge: 0.03 });
      for (const [dx, dy] of [
        [-0.075, 0.035],
        [0.075, 0.035],
        [-0.075, -0.035],
        [0.075, -0.035],
      ]) {
        ctx.decal(FRONT, roundedRect(0.62 + dx, 0.67 + dy, 0.04, 0.012, 0.005), 'drl', { mirror: true, offset: 0.006 });
      }
      // Three front intakes.
      const side = smoothOutline([
        [0.46, 0.4],
        [0.76, 0.43],
        [0.8, 0.28],
        [0.5, 0.26],
      ], 4);
      grille(ctx, side, 0.63, 0.34, true);
      grille(ctx, roundedRect(0, 0.3, 0.5, 0.11, 0.04), 0, 0.3, false);
      frontSplitter(ctx, 0.15, 0.03, 0.016, 'carbon');
      ctx.decal(TOP, [
        [-0.5, nose - 0.45],
        [0.5, nose - 0.45],
        [0.5, nose - 0.455],
        [-0.5, nose - 0.455],
      ], 'dark', { offset: 0.0015, maxEdge: 0.04 });
      sideLine(ctx, [[0.88, 0.26], [0.92, 0.55], [0.9, 0.78]], 0.006);
      sideLine(ctx, [[-0.5, 0.36], [-0.48, 0.6], [-0.5, 0.82]], 0.006);
      sideLine(ctx, [[0.95, 0.2], [-0.55, 0.2]], 0.04, 'trim');
      ctx.decal(LEFT, roundedRect(-0.28, 0.78, 0.13, 0.025, 0.01), 'gloss', { mirror: true, offset: 0.004 });
      doorMirror(ctx, 0.68, 0.84, 0.66, 1);
      wipers(ctx, 0.96, 0.82, 0.52);
      // Engine lid grille on the rear deck.
      ctx.decal(TOP, roundedRect(0, -1.72, 0.62, 0.34, 0.05), 'gloss', { offset: 0.002, onCabin: true });
      for (let k = 0; k < 7; k++) {
        ctx.decal(TOP, roundedRect(0, -1.58 - k * 0.045, 0.56, 0.018, 0.006), 'grille', { offset: 0.004, onCabin: true, uvScale: 0.09 });
      }
      // Rear: full-width light bar, oval lamps, center exhausts, swan-neck wing.
      ctx.decal(REAR, roundedRect(0, 0.83, 1.5, 0.028, 0.012), 'tailLens', { offset: 0.003, maxEdge: 0.04 });
      ctx.decal(REAR, roundedRect(0, 0.83, 1.46, 0.01, 0.004), 'tail', { offset: 0.005, maxEdge: 0.04 });
      const lamp = smoothOutline([
        [0.56, 0.87],
        [0.8, 0.86],
        [0.8, 0.8],
        [0.58, 0.79],
      ], 4);
      ctx.decal(REAR, lamp, 'tail', { mirror: true, offset: 0.006 });
      ctx.decal(REAR, roundedRect(0.4, 0.83, 0.06, 0.02, 0.006), 'reverse', { mirror: true, offset: 0.007 });
      rearPlate(ctx, 0.52, 0.5, 0.11);
      exhaustTip(ctx, 0.08, 0.32, 0.048, 0.048, true);
      diffuser(ctx, 0.9, 6);
      rearWing(ctx, { z: tail + 0.5, y: 1.13, span: 1.6, chord: 0.32, angle: 0.13, struts: [0.34], endplates: true });
    },
  };
};

// ------------------------------------------------------------------ Sprite R (roadster)

const sprite: DesignFactory = (cfg) => {
  const { zf, zr, R, nose, tail } = dims(cfg);
  return {
    body: {
      zFront: nose,
      zRear: tail,
      halfWidth: [
        [nose, 0.76],
        [nose - 0.2, 0.85],
        [zf, 0.9],
        [0.3, 0.87],
        [zr, 0.9],
        [tail + 0.3, 0.88],
        [tail, 0.8],
      ],
      top: [
        [nose, 0.5],
        [nose - 0.06, 0.6],
        [nose - 0.25, 0.68],
        [zf, 0.74],
        [0.55, 0.8],
        [0, 0.84],
        [-0.8, 0.87],
        [-1.4, 0.89],
        [tail + 0.14, 0.9],
        [tail + 0.04, 0.8],
        [tail, 0.58],
      ],
      bottom: [
        [nose, 0.5],
        [nose - 0.03, 0.36],
        [nose - 0.1, 0.22],
        [nose - 0.25, 0.14],
        [tail + 0.4, 0.15],
        [tail + 0.2, 0.22],
        [tail + 0.06, 0.36],
        [tail, 0.58],
      ],
      waist: 0.55,
      shoulder: 3.0,
      tuck: 0.1,
      fender: [
        [nose - 0.05, 0.02],
        [zf, 0.1],
        [zf - 0.5, 0.02],
        [zr + 0.45, 0.03],
        [zr, 0.09],
        [tail + 0.15, 0.01],
      ],
      fenderX: 0.8,
      valley: [
        [nose, 0],
        [zf, 0.03],
        [0.6, 0],
      ],
      nose: { depth: 0.3, length: 0.55, exponent: 2.4 },
      tail: { depth: 0.2, length: 0.4, exponent: 3 },
      arches: [
        { z: zf, radius: R + 0.055, centerY: R, innerX: 0.43 },
        { z: zr, radius: R + 0.055, centerY: R, innerX: 0.52 },
      ],
      tub: { zFront: 0.5, zRear: -0.78, halfWidth: 0.68, depth: 0.4 },
      diffuserTop: 0.26,
      lipTop: 0.2,
    },
    cabin: null,
    windows: null,
    wheels: { style: 'fiveSpoke', finish: 'bronze', caliper: 0x202020, width: 0.23, rimRatio: 0.66, dish: 0.04 },
    headlight: [0.6, 0.6, nose - 0.14],
    hoodCamera: [0, 1.0, 0.9],
    detail(ctx) {
      // Almond headlights.
      const head = smoothOutline(
        [
          [0.44, 0.63],
          [0.66, 0.665],
          [0.8, 0.64],
          [0.76, 0.59],
          [0.5, 0.595],
        ],
        5,
      );
      ctx.decal(FRONT, head, 'lampHousing', { mirror: true, maxEdge: 0.035 });
      ctx.decal(FRONT, ellipse(0.66, 0.628, 0.045, 0.022, 18), 'headLamp', { mirror: true, offset: 0.005, maxEdge: 0.03 });
      ctx.decal(FRONT, inset(head, 0.62, 0.628, 0.85, 0.2).map(([a, b]) => [a, b - 0.022] as Vec2), 'drl', { mirror: true, offset: 0.005 });
      // Smiling oval grille and corner intakes.
      grille(ctx, smoothOutline([
        [-0.36, 0.42],
        [0, 0.45],
        [0.36, 0.42],
        [0.3, 0.27],
        [0, 0.25],
        [-0.3, 0.27],
      ], 5), 0, 0.35, false);
      grille(ctx, roundedRect(0.62, 0.3, 0.18, 0.08, 0.03), 0.62, 0.3, true);
      frontSplitter(ctx, 0.14, 0.015, 0.012, 'trim');
      ctx.decal(TOP, [
        [-0.6, 1.62],
        [0.6, 1.62],
        [0.6, 1.615],
        [-0.6, 1.615],
      ], 'dark', { offset: 0.0015, maxEdge: 0.04 });
      sideLine(ctx, [[0.55, 0.26], [0.58, 0.55], [0.55, 0.78]], 0.006);
      sideLine(ctx, [[-0.62, 0.34], [-0.62, 0.82]], 0.006);
      sideLine(ctx, [[0.8, 0.2], [-0.78, 0.2]], 0.035, 'trim');
      ctx.decal(LEFT, roundedRect(-0.45, 0.78, 0.12, 0.025, 0.01), 'chrome', { mirror: true, offset: 0.004 });
      // Open cockpit: windscreen, interior, roll hoops, headrest fairings.
      roadsterWindshield(ctx, { zBase: 0.66, yBase: 0.79, zTop: 0.28, yTop: 1.08, halfWidth: 0.68, wrap: 0.14 });
      cockpit(ctx, { zDash: 0.4, zSeat: -0.3, floorY: 0.44, dashY: 0.8, seatX: 0.35 });
      rollHoop(ctx, 0.35, -0.72, 0.86, 0.26, 0.4);
      headrestFairing(ctx, 0.35, -0.72, -1.55, 0.34, 0.12);
      doorMirror(ctx, 0.52, 0.8, 0.72, 0.95);
      // Rear: round twin lamps, twin exhausts, small diffuser, lip.
      for (const x of [0.52, 0.72]) {
        ctx.decal(REAR, ellipse(x, 0.78, 0.07, 0.055, 22), 'tailLens', { mirror: true, maxEdge: 0.03 });
        ctx.decal(REAR, ellipse(x, 0.78, 0.05, 0.036, 20), 'tail', { mirror: true, offset: 0.005, maxEdge: 0.03 });
      }
      ctx.decal(REAR, roundedRect(0.62, 0.68, 0.06, 0.02, 0.006), 'reverse', { mirror: true, offset: 0.006 });
      ctx.decal(TOP, [
        [-0.6, tail + 0.12],
        [0.6, tail + 0.12],
        [0.58, tail + 0.05],
        [-0.58, tail + 0.05],
      ], 'gloss', { offset: 0.004 });
      rearPlate(ctx, 0.5, 0.5, 0.11);
      exhaustTip(ctx, 0.36, 0.26, 0.042, 0.042, true);
      diffuser(ctx, 0.5, 4);
    },
  };
};

export const DESIGNS: Record<CarId, DesignFactory> = { kestrel, tempest, vortex, falco, sprite };
