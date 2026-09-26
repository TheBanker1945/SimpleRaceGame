import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Cabin, COARSE_BODY, COARSE_CABIN, LowerBody, MAT_PAINT, type CabinSpec, type LowerBodySpec } from '../render/car/Body.ts';
import { windowClassifier } from '../render/car/CabinMask.ts';
import { buildDecal, ellipse, FRONT, LEFT, mirrorX, REAR, roundedRect, smoothOutline, SurfaceProjector, type Frame, type Vec2 } from '../render/car/Decal.ts';
import type { WindowSpec } from '../render/car/Design.ts';
import type { TrafficGeometry, TrafficType } from './TrafficTypes.ts';

/*
 * Traffic cars (hatchback, sedan, SUV) built with the same lofted bodies as the player's
 * cars, at a coarser resolution: painted panels go in the instance-coloured body mesh,
 * glass/wells/trim/wheels in the vertex-coloured detail mesh, and lamps are projected onto
 * the body so they follow its curves.
 */

const GLASS = 0x1b232b;
const DARK = 0x0d0e10;
const TRIM = 0x202225;
const TIRE = 0x151515;
const RIM = 0x9aa0a6;
const PLATE = 0xe6e6de;

interface TrafficCarDesign {
  body: LowerBodySpec;
  cabin: CabinSpec;
  windows: WindowSpec;
  wheelRadius: number;
  zf: number;
  zr: number;
  track: number;
  /** Lamps (left side, mirrored) in front/rear view coordinates. */
  head: Vec2[];
  tail: Vec2[];
  /** Front/rear indicator centers (x, y). */
  signalFront: Vec2;
  signalRear: Vec2;
  /** Grille outline (front view, full width). */
  grille: Vec2[];
  plateY: number;
  /** Extra dark details: SUV cladding. */
  cladding?: boolean;
}

function withColor(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = clean(geo);
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Non-indexed with only position + normal (so everything merges). */
function clean(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  g.clearGroups();
  return g;
}

/** Traffic is never seen from below: drop the flat floor, keep wheel wells and bumper faces. */
function dropFlatUnderside(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const P = geo.getAttribute('position') as THREE.BufferAttribute;
  const N = geo.getAttribute('normal') as THREE.BufferAttribute;
  const pos: number[] = [];
  const nrm: number[] = [];
  for (let t = 0; t + 2 < P.count; t += 3) {
    const ny = (N.getY(t) + N.getY(t + 1) + N.getY(t + 2)) / 3;
    if (ny < -0.95) continue;
    for (let c = 0; c < 3; c++) {
      pos.push(P.getX(t + c), P.getY(t + c), P.getZ(t + c));
      nrm.push(N.getX(t + c), N.getY(t + c), N.getZ(t + c));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

/** Copies one material group of a grouped geometry. */
function group(geo: THREE.BufferGeometry, index: number): THREE.BufferGeometry | null {
  const gr = geo.groups.find((g) => g.materialIndex === index);
  if (!gr) return null;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal'] as const) {
    const attr = geo.getAttribute(name) as THREE.BufferAttribute;
    out.setAttribute(name, new THREE.BufferAttribute((attr.array as Float32Array).slice(gr.start * 3, (gr.start + gr.count) * 3), 3));
  }
  return out;
}

function merge(parts: (THREE.BufferGeometry | null)[]): THREE.BufferGeometry {
  const list = parts.filter((p): p is THREE.BufferGeometry => p !== null);
  const merged = mergeGeometries(list, false);
  if (!merged) throw new Error('Traffic geometry merge failed');
  merged.computeBoundingSphere();
  return merged;
}

function wheel(radius: number, width: number, x: number, z: number): THREE.BufferGeometry[] {
  const pts: THREE.Vector2[] = [];
  const rimR = radius * 0.64;
  const hw = width / 2;
  for (const [r, y] of [
    [rimR, -hw + 0.01],
    [radius - 0.03, -hw],
    [radius, -hw + 0.03],
    [radius, hw - 0.03],
    [radius - 0.03, hw],
    [rimR, hw - 0.01],
  ] as const) {
    pts.push(new THREE.Vector2(r, y));
  }
  const tire = new THREE.LatheGeometry(pts, 18);
  tire.rotateZ(-Math.PI / 2);
  const face = new THREE.CircleGeometry(rimR, 18);
  face.rotateY(Math.PI / 2);
  face.translate(hw - 0.02, 0, 0);
  const hub = new THREE.CircleGeometry(rimR * 0.35, 10);
  hub.rotateY(Math.PI / 2);
  hub.translate(hw - 0.015, 0, 0);
  const parts = [withColor(tire, TIRE), withColor(face, RIM), withColor(hub, DARK)];
  return parts.map((p) => {
    const g = x < 0 ? mirrorX(p) : p;
    g.translate(x, radius, z);
    return g;
  });
}

function design(t: TrafficType): TrafficCarDesign {
  const L = t.length;
  const hw = t.width / 2;
  const nose = L / 2 - 0.005;
  const tail = -nose;
  switch (t.kind) {
    case 'hatch': {
      const R = 0.31;
      const zf = L / 2 - 0.85;
      const zr = -L / 2 + 0.75;
      return {
        wheelRadius: R,
        zf,
        zr,
        track: t.width - 0.26,
        body: {
          zFront: nose,
          zRear: tail,
          halfWidth: [
            [nose, hw - 0.1],
            [nose - 0.25, hw - 0.015],
            [zf, hw],
            [zr, hw],
            [tail + 0.2, hw - 0.02],
            [tail, hw - 0.07],
          ],
          top: [
            [nose, 0.62],
            [nose - 0.05, 0.7],
            [nose - 0.25, 0.79],
            [zf, 0.84],
            [0.6, 0.88],
            [-0.5, 0.94],
            [tail + 0.3, 0.97],
            [tail + 0.06, 0.96],
            [tail, 0.72],
          ],
          bottom: [
            [nose, 0.62],
            [nose - 0.03, 0.46],
            [nose - 0.1, 0.3],
            [nose - 0.26, 0.2],
            [nose - 0.4, 0.19],
            [tail + 0.35, 0.2],
            [tail + 0.15, 0.28],
            [tail + 0.04, 0.42],
            [tail, 0.72],
          ],
          waist: 0.55,
          shoulder: 3.4,
          tuck: 0.08,
          fender: [
            [zf, 0.03],
            [0, 0],
            [zr, 0.03],
          ],
          nose: { depth: 0.26, length: 0.5, exponent: 2.6 },
          tail: { depth: 0.14, length: 0.35, exponent: 3.4 },
          arches: [
            { z: zf, radius: R + 0.05, centerY: R, innerX: 0.5 },
            { z: zr, radius: R + 0.05, centerY: R, innerX: 0.5 },
          ],
          diffuserTop: 0.3,
          lipTop: 0.26,
        },
        cabin: {
          zFront: 0.78,
          zRear: tail + 0.07,
          roof: [
            [0.78, 0.9],
            [0.45, 1.1],
            [0.12, 1.29],
            [-0.3, 1.41],
            [-1.2, 1.44],
            [-1.6, 1.4],
            [-1.8, 1.28],
            [tail + 0.07, 0.99],
          ],
          rail: [
            [0.78, 0.88],
            [0.35, 1.12],
            [0.0, 1.3],
            [-0.4, 1.38],
            [-1.3, 1.4],
            [-1.65, 1.33],
            [tail + 0.07, 0.97],
          ],
          baseHalfWidth: [
            [0.78, hw - 0.12],
            [-1.0, hw - 0.1],
            [tail + 0.07, hw - 0.16],
          ],
          railHalfWidth: [
            [0.78, hw - 0.2],
            [-1.0, hw - 0.24],
            [tail + 0.07, hw - 0.3],
          ],
          roofShape: 2.8,
          sink: 0.04,
        },
        windows: {
          windshieldTop: -0.22,
          aPillar: 0.07,
          sideTopInset: 0.02,
          belt: 0.07,
          sideRearTop: -1.42,
          sideRearBottom: -1.5,
          bPillar: { z: -0.55, width: 0.1 },
          rearTop: -1.68,
          rearBottom: -1.94,
          rearInset: 0.07,
          roof: 'paint',
        },
        head: smoothOutline([
          [0.48, 0.76],
          [0.72, 0.75],
          [0.74, 0.68],
          [0.52, 0.68],
        ], 3),
        tail: smoothOutline([
          [0.56, 0.9],
          [0.76, 0.89],
          [0.76, 0.76],
          [0.6, 0.77],
        ], 3),
        signalFront: [0.72, 0.6],
        signalRear: [0.66, 0.7],
        grille: roundedRect(0, 0.56, 0.8, 0.12, 0.04),
        plateY: 0.52,
      };
    }
    case 'suv': {
      const R = 0.37;
      const zf = L / 2 - 0.95;
      const zr = -L / 2 + 1.05;
      return {
        wheelRadius: R,
        zf,
        zr,
        track: t.width - 0.28,
        cladding: true,
        body: {
          zFront: nose,
          zRear: tail,
          halfWidth: [
            [nose, hw - 0.1],
            [nose - 0.25, hw - 0.015],
            [zf, hw],
            [zr, hw],
            [tail + 0.25, hw - 0.02],
            [tail, hw - 0.07],
          ],
          top: [
            [nose, 0.95],
            [nose - 0.07, 1.0],
            [nose - 0.3, 1.04],
            [zf, 1.06],
            [0.9, 1.1],
            [-0.5, 1.14],
            [tail + 0.3, 1.16],
            [tail + 0.06, 1.15],
            [tail, 0.9],
          ],
          bottom: [
            [nose, 0.95],
            [nose - 0.03, 0.7],
            [nose - 0.12, 0.42],
            [nose - 0.3, 0.29],
            [nose - 0.45, 0.28],
            [tail + 0.45, 0.28],
            [tail + 0.2, 0.34],
            [tail + 0.05, 0.52],
            [tail, 0.9],
          ],
          waist: 0.48,
          shoulder: 4.2,
          tuck: 0.06,
          fender: [
            [zf, 0.03],
            [0, 0],
            [zr, 0.03],
          ],
          nose: { depth: 0.22, length: 0.5, exponent: 3.2 },
          tail: { depth: 0.12, length: 0.35, exponent: 3.6 },
          arches: [
            { z: zf, radius: R + 0.07, centerY: R, innerX: 0.55 },
            { z: zr, radius: R + 0.07, centerY: R, innerX: 0.55 },
          ],
          diffuserTop: 0.42,
          lipTop: 0.38,
        },
        cabin: {
          zFront: 1.02,
          zRear: tail + 0.08,
          roof: [
            [1.02, 1.12],
            [0.7, 1.36],
            [0.4, 1.56],
            [0.1, 1.68],
            [-0.4, 1.72],
            [-1.6, 1.71],
            [-2.05, 1.66],
            [-2.25, 1.45],
            [tail + 0.08, 1.16],
          ],
          rail: [
            [1.02, 1.1],
            [0.6, 1.38],
            [0.2, 1.6],
            [-0.3, 1.67],
            [-1.7, 1.66],
            [-2.1, 1.6],
            [tail + 0.08, 1.14],
          ],
          baseHalfWidth: [
            [1.02, hw - 0.13],
            [-1.0, hw - 0.1],
            [tail + 0.08, hw - 0.14],
          ],
          railHalfWidth: [
            [1.02, hw - 0.22],
            [-1.0, hw - 0.22],
            [tail + 0.08, hw - 0.27],
          ],
          roofShape: 3.2,
          sink: 0.04,
        },
        windows: {
          windshieldTop: 0.08,
          aPillar: 0.08,
          sideTopInset: 0.025,
          belt: 0.08,
          sideRearTop: -1.9,
          sideRearBottom: -1.98,
          bPillar: { z: -0.45, width: 0.1 },
          rearTop: -2.08,
          rearBottom: -2.32,
          rearInset: 0.08,
          roof: 'paint',
        },
        head: smoothOutline([
          [0.5, 0.93],
          [0.82, 0.92],
          [0.84, 0.85],
          [0.54, 0.85],
        ], 3),
        tail: smoothOutline([
          [0.6, 1.08],
          [0.82, 1.07],
          [0.82, 0.92],
          [0.64, 0.93],
        ], 3),
        signalFront: [0.76, 0.78],
        signalRear: [0.72, 0.86],
        grille: roundedRect(0, 0.7, 0.86, 0.2, 0.05),
        plateY: 0.68,
      };
    }
    default: {
      // Family sedan
      const R = 0.32;
      const zf = L / 2 - 0.95;
      const zr = -L / 2 + 1.0;
      return {
        wheelRadius: R,
        zf,
        zr,
        track: t.width - 0.24,
        body: {
          zFront: nose,
          zRear: tail,
          halfWidth: [
            [nose, hw - 0.12],
            [nose - 0.25, hw - 0.02],
            [zf, hw],
            [zr, hw],
            [tail + 0.3, hw - 0.02],
            [tail, hw - 0.1],
          ],
          top: [
            [nose, 0.62],
            [nose - 0.05, 0.7],
            [nose - 0.25, 0.78],
            [zf, 0.82],
            [0.9, 0.86],
            [0, 0.9],
            [-1.2, 0.96],
            [tail + 0.4, 0.98],
            [tail + 0.1, 0.97],
            [tail + 0.03, 0.88],
            [tail, 0.66],
          ],
          bottom: [
            [nose, 0.62],
            [nose - 0.03, 0.46],
            [nose - 0.1, 0.3],
            [nose - 0.28, 0.2],
            [nose - 0.45, 0.19],
            [tail + 0.45, 0.2],
            [tail + 0.25, 0.25],
            [tail + 0.08, 0.36],
            [tail, 0.66],
          ],
          waist: 0.55,
          shoulder: 3.6,
          tuck: 0.08,
          fender: [
            [zf, 0.025],
            [0, 0],
            [zr, 0.025],
          ],
          nose: { depth: 0.24, length: 0.5, exponent: 3 },
          tail: { depth: 0.2, length: 0.45, exponent: 3.2 },
          arches: [
            { z: zf, radius: R + 0.05, centerY: R, innerX: 0.5 },
            { z: zr, radius: R + 0.05, centerY: R, innerX: 0.5 },
          ],
          diffuserTop: 0.28,
          lipTop: 0.26,
        },
        cabin: {
          zFront: 0.95,
          zRear: -1.25,
          roof: [
            [0.95, 0.88],
            [0.6, 1.08],
            [0.3, 1.26],
            [0.0, 1.38],
            [-0.4, 1.44],
            [-0.8, 1.43],
            [-1.0, 1.36],
            [-1.15, 1.2],
            [-1.25, 1.0],
          ],
          rail: [
            [0.95, 0.86],
            [0.5, 1.1],
            [0.1, 1.33],
            [-0.3, 1.4],
            [-0.85, 1.38],
            [-1.08, 1.22],
            [-1.25, 0.98],
          ],
          baseHalfWidth: [
            [0.95, hw - 0.14],
            [0, hw - 0.1],
            [-1.25, hw - 0.16],
          ],
          railHalfWidth: [
            [0.95, hw - 0.22],
            [0, hw - 0.25],
            [-1.25, hw - 0.3],
          ],
          roofShape: 2.6,
          sink: 0.04,
        },
        windows: {
          windshieldTop: 0.02,
          aPillar: 0.07,
          sideTopInset: 0.02,
          belt: 0.07,
          sideRearTop: -0.98,
          sideRearBottom: -1.12,
          bPillar: { z: -0.4, width: 0.1 },
          rearTop: -0.9,
          rearBottom: -1.22,
          rearInset: 0.07,
          roof: 'paint',
        },
        head: smoothOutline([
          [0.44, 0.76],
          [0.74, 0.745],
          [0.76, 0.68],
          [0.48, 0.68],
        ], 3),
        tail: smoothOutline([
          [0.46, 0.88],
          [0.76, 0.87],
          [0.76, 0.77],
          [0.5, 0.78],
        ], 3),
        signalFront: [0.74, 0.62],
        signalRear: [0.66, 0.72],
        grille: roundedRect(0, 0.56, 0.9, 0.13, 0.04),
        plateY: 0.6,
      };
    }
  }
}

export function buildTrafficCar(t: TrafficType): TrafficGeometry {
  const d = design(t);
  const body = new LowerBody(d.body, COARSE_BODY);
  const lower = body.buildGeometry();
  const w = d.windows;
  // Rows on the window edges: glass is picked per quad, so its edges follow rows exactly.
  const cabin = new Cabin(d.cabin, body, {
    ...COARSE_CABIN,
    align: { belt: w.belt, sideTop: w.aPillar * 0.35 + w.sideTopInset, aPillar: w.aPillar },
  });
  const cabinGeo = cabin.buildGeometry(windowClassifier(d.windows, d.cabin.zFront), 2);

  const projectors = new Map<Frame, SurfaceProjector>();
  const decal = (frame: Frame, outline: readonly Vec2[], offset = 0.004, maxEdge = 0.18): THREE.BufferGeometry | null => {
    let p = projectors.get(frame);
    if (!p) {
      p = new SurfaceProjector([lower], frame, 0.06);
      projectors.set(frame, p);
    }
    const g = buildDecal(p, outline, { offset, maxEdge });
    return g ? clean(g) : null;
  };
  const both = (g: THREE.BufferGeometry | null): THREE.BufferGeometry[] => (g ? [g, mirrorX(g)] : []);
  const center = (pts: readonly Vec2[]): Vec2 => {
    let a = 0;
    let b = 0;
    for (const [x, y] of pts) {
      a += x;
      b += y;
    }
    return [a / pts.length, b / pts.length];
  };

  // Body: painted lower panels + painted cabin (roof, pillars).
  const bodyGeo = merge([clean(group(lower, MAT_PAINT) as THREE.BufferGeometry), group(cabinGeo, 0)]);

  // Detail: wells/underbody, glass, grille, bumper trims, plates, wheels.
  const detail: THREE.BufferGeometry[] = [];
  const dark = group(lower, 1);
  if (dark) detail.push(withColor(dropFlatUnderside(dark), DARK));
  const glass = group(cabinGeo, 1);
  if (glass) detail.push(withColor(glass, GLASS));
  const add = (g: THREE.BufferGeometry | null, color: number, mirror = false): void => {
    if (!g) return;
    detail.push(withColor(g, color));
    if (mirror) detail.push(withColor(mirrorX(g), color));
  };
  add(decal(FRONT, d.grille), TRIM);
  add(decal(FRONT, roundedRect(0, d.body.lipTop ? d.body.lipTop + 0.04 : 0.3, t.width - 0.5, 0.08, 0.03)), TRIM);
  add(decal(FRONT, roundedRect(0, d.plateY - 0.2, 0.46, 0.1, 0.01), 0.006), PLATE);
  add(decal(REAR, roundedRect(0, d.plateY, 0.46, 0.1, 0.01), 0.006), PLATE);
  add(decal(REAR, roundedRect(0, (d.body.diffuserTop ?? 0.3) + 0.04, t.width - 0.45, 0.08, 0.03)), TRIM);
  if (d.cladding) {
    add(decal(LEFT, [
      [d.zf + 0.9, 0.3],
      [d.zr - 0.8, 0.3],
      [d.zr - 0.8, 0.42],
      [d.zf + 0.9, 0.42],
    ], 0.003), TRIM, true);
  }
  // Door mirrors (painted), just behind the A-pillar base.
  const mz = d.cabin.zFront - 0.24;
  const mx = body.widthAt(mz) - 0.12;
  const mirror = new THREE.BoxGeometry(0.16, 0.1, 0.1);
  mirror.translate(mx + 0.1, body.surfaceY(mz, mx) + 0.1, mz);
  const mirrorGeo = clean(mirror);
  for (const [x, z] of [
    [d.track / 2, d.zf],
    [-d.track / 2, d.zf],
    [d.track / 2, d.zr],
    [-d.track / 2, d.zr],
  ] as const) {
    detail.push(...wheel(d.wheelRadius, 0.21, x, z));
  }

  // Lamps.
  const head = both(decal(FRONT, d.head, 0.006, 0.05));
  const tail = both(decal(REAR, d.tail, 0.006, 0.05));
  const sigL: THREE.BufferGeometry[] = [];
  const sf = decal(FRONT, ellipse(d.signalFront[0], d.signalFront[1], 0.05, 0.025, 10), 0.006);
  const sr = decal(REAR, ellipse(d.signalRear[0], d.signalRear[1], 0.05, 0.025, 10), 0.006);
  // Side repeater on the front fender, behind the wheel.
  const rep = decal(LEFT, roundedRect(d.zf - d.wheelRadius - 0.22, d.wheelRadius * 2 + 0.14, 0.08, 0.03, 0.01), 0.004);
  for (const g of [sf, sr, rep]) if (g) sigL.push(g);
  const sigR = sigL.map((g) => mirrorX(g));

  const hc = center(d.head);
  const tc = center(d.tail);
  const surf = (frame: Frame, a: number, b: number): [number, number, number] => {
    const p = projectors.get(frame)?.cast(a, b);
    return p ? [p.p.x, p.p.y, p.p.z + (frame === FRONT ? 0.05 : -0.05)] : [a, b, frame === FRONT ? t.length / 2 : -t.length / 2];
  };
  const headL = surf(FRONT, hc[0], hc[1]);
  const tailL = surf(REAR, tc[0], tc[1]);

  return {
    body: merge([bodyGeo, mirrorGeo, mirrorX(mirrorGeo)]),
    detail: merge(detail),
    head: merge(head),
    tail: merge(tail),
    signalLeft: merge(sigL),
    signalRight: merge(sigR),
    headLamps: [headL, [-headL[0], headL[1], headL[2]]],
    tailLamps: [tailL, [-tailL[0], tailL[1], tailL[2]]],
  };
}
