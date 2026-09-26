import type * as THREE from 'three';
import { buildGridGeometry, GridSurface } from './GridMesh.ts';
import { smoothstep01, toProfile, type Profile, type ProfileLike } from './Profile.ts';

/*
 * Procedural car body surfaces. Coordinates: +Z forward, +X to the car's left, +Y up,
 * origin on the ground under the center of gravity (the physics origin).
 *
 * The lower body is lofted through cross-sections along Z. Each section is a closed ring:
 * a flat floor, the wheel-well wall and ceiling (only inside an arch), then the outer
 * surface — a tucked-in lower side, the waist (widest point) and a superellipse over the
 * shoulders to the hood/deck centerline. Plan-view corner rounding pulls the outer part of
 * the nose and tail back, so the front and rear faces wrap around like real bumpers.
 */

export interface CornerSpec {
  /** How far the corners are pulled back at the very tip (m). */
  depth: number;
  /** Length of the zone over which the rounding blends in (m). */
  length: number;
  /** Plan-view superellipse exponent (2 = round, 4+ = squarer corners). */
  exponent: number;
}

export interface ArchSpec {
  /** Axle position. */
  z: number;
  /** Arch opening radius (tire radius + clearance). */
  radius: number;
  /** Height of the arch center (the wheel hub). */
  centerY: number;
  /** Lateral position of the inner wheel-well wall. */
  innerX: number;
}

/** A sunken cockpit for open cars. */
export interface TubSpec {
  zFront: number;
  zRear: number;
  halfWidth: number;
  depth: number;
}

export interface LowerBodySpec {
  zFront: number;
  zRear: number;
  /** Half width at the waist, along Z. */
  halfWidth: ProfileLike;
  /** Centerline height of the top surface (hood, deck), along Z. */
  top: ProfileLike;
  /** Height of the underside; rises into the bumper faces at the ends. */
  bottom: ProfileLike;
  /** Where the side is widest, as a fraction from bottom to top. */
  waist: ProfileLike;
  /** Superellipse exponent of the upper section: higher = crisper shoulders. */
  shoulder: ProfileLike;
  /** How much the lower side tucks in toward the sill (fraction of half width). */
  tuck: number;
  /** Raised fender crowns near the outer edge (m), along Z. */
  fender: ProfileLike;
  /** Lateral position of the fender crown (fraction of half width) and its spread. */
  fenderX?: number;
  fenderSpread?: number;
  /** Depression of the top surface along the centerline (m), e.g. a hood valley. */
  valley?: ProfileLike;
  nose: CornerSpec;
  tail: CornerSpec;
  arches: ArchSpec[];
  tub?: TubSpec;
  /** Underside below this height near the tail is the (dark) diffuser rather than painted bumper. */
  diffuserTop?: number;
  /** Same at the nose: the lower lip below this height is dark. */
  lipTop?: number;
}

export const MAT_PAINT = 0;
export const MAT_DARK = 1;
export const MAT_INTERIOR = 2;

interface Pt {
  x: number;
  y: number;
}

const FLOOR_ROWS = 5; // F0..F4 before the outer curve
const OUTER_SAMPLES = 27;

/** Resamples a polyline to `count` points, spending more points where it bends. */
function resample(points: Pt[], count: number, bendWeight: number): Pt[] {
  const n = points.length;
  const measure = new Float64Array(n);
  let prevAngle = n > 1 ? Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) : 0;
  for (let i = 1; i < n; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const ds = Math.hypot(dx, dy);
    let turn = 0;
    if (ds > 1e-9) {
      const a = Math.atan2(dy, dx);
      turn = Math.abs(Math.atan2(Math.sin(a - prevAngle), Math.cos(a - prevAngle)));
      prevAngle = a;
    }
    measure[i] = measure[i - 1] + ds + bendWeight * turn;
  }
  const total = measure[n - 1];
  const out: Pt[] = [];
  let k = 1;
  for (let s = 0; s < count; s++) {
    const target = count === 1 ? 0 : (s / (count - 1)) * total;
    while (k < n - 1 && measure[k] < target) k++;
    const span = measure[k] - measure[k - 1];
    const t = span > 1e-12 ? Math.min(1, Math.max(0, (target - measure[k - 1]) / span)) : 1;
    out.push({ x: points[k - 1].x + (points[k].x - points[k - 1].x) * t, y: points[k - 1].y + (points[k].y - points[k - 1].y) * t });
  }
  out[0] = { ...points[0] };
  out[count - 1] = { ...points[n - 1] };
  return out;
}

export class LowerBody {
  readonly spec: LowerBodySpec;
  private readonly halfWidth: Profile;
  private readonly top: Profile;
  private readonly bottom: Profile;
  private readonly waist: Profile;
  private readonly shoulder: Profile;
  private readonly fender: Profile;
  private readonly valley: Profile;

  constructor(spec: LowerBodySpec) {
    this.spec = spec;
    this.halfWidth = toProfile(spec.halfWidth);
    this.top = toProfile(spec.top);
    this.bottom = toProfile(spec.bottom);
    this.waist = toProfile(spec.waist);
    this.shoulder = toProfile(spec.shoulder);
    this.fender = toProfile(spec.fender);
    this.valley = toProfile(spec.valley ?? 0);
  }

  widthAt(z: number): number {
    return this.halfWidth.at(z);
  }

  bottomAt(z: number): number {
    return this.bottom.at(z);
  }

  topAt(z: number): number {
    return this.top.at(z);
  }

  /** Height of the tub depression at (x, z). */
  tubDepth(x: number, z: number): number {
    const tub = this.spec.tub;
    if (!tub) return 0;
    const ramp = 0.12;
    const wz = smoothstep01((z - tub.zRear) / ramp) * smoothstep01((tub.zFront - z) / ramp);
    const wx = smoothstep01((tub.halfWidth - Math.abs(x)) / 0.1);
    return tub.depth * wz * wx;
  }

  /** Dense outer curve (from the side bottom to the top centerline) at station z, x ≥ 0. */
  outerCurve(z: number): Pt[] {
    const W = this.halfWidth.at(z);
    const yb = this.bottom.at(z);
    const yt = Math.max(yb, this.top.at(z));
    const yw = yb + this.waist.at(z) * (yt - yb);
    const n = this.shoulder.at(z);
    const tuck = this.spec.tuck;
    const fender = this.fender.at(z);
    const fx = this.spec.fenderX ?? 0.8;
    const fs = this.spec.fenderSpread ?? 0.22;
    const valley = this.valley.at(z);
    const pts: Pt[] = [];
    const NL = 10;
    for (let k = 0; k <= NL; k++) {
      const eta = k / NL;
      pts.push({ x: W * (1 - tuck * (1 - eta) * (1 - eta)), y: yb + eta * (yw - yb) });
    }
    const NU = 44;
    for (let k = 1; k <= NU; k++) {
      const th = (Math.PI / 2) * (k / NU);
      const X = Math.pow(Math.max(0, Math.cos(th)), 2 / n);
      const Y = Math.pow(Math.max(0, Math.sin(th)), 2 / n);
      const x = k === NU ? 0 : W * X;
      let y = yw + (yt - yw) * Y;
      const r = W > 1e-6 ? x / W : 0;
      y += fender * Math.exp(-(((r - fx) / fs) ** 2)) * Y;
      y -= valley * (1 - r * r) ** 2 * Y;
      y -= this.tubDepth(x, z);
      pts.push({ x, y });
    }
    return pts;
  }

  /** Height of the outer surface at lateral offset x (upper part), for seating the cabin. */
  surfaceY(z: number, x: number): number {
    const pts = this.outerCurve(z);
    const ax = Math.abs(x);
    for (let k = pts.length - 1; k > 0; k--) {
      const a = pts[k];
      const b = pts[k - 1];
      if (ax >= a.x && ax <= b.x) {
        const t = b.x - a.x > 1e-9 ? (ax - a.x) / (b.x - a.x) : 0;
        return a.y + (b.y - a.y) * t;
      }
    }
    return pts[pts.length - 1].y;
  }

  private archAt(z: number): { top: number; innerX: number } {
    let top = -Infinity;
    let innerX = 0;
    let nearest = Infinity;
    for (const a of this.spec.arches) {
      const dz = Math.abs(z - a.z);
      if (dz < nearest) {
        nearest = dz;
        innerX = a.innerX;
      }
      if (dz < a.radius) top = Math.max(top, a.centerY + Math.sqrt(a.radius * a.radius - dz * dz));
    }
    return { top, innerX };
  }

  /** Station positions: fine at the ends and around the arches, with duplicate stations at arch edges for vertical lips. */
  private stations(): number[] {
    const { zFront, zRear } = this.spec;
    const zs: number[] = [];
    for (let z = zRear; z <= zFront; z += 0.045) zs.push(z);
    for (const [from, to, step] of [
      [zFront - 0.3, zFront, 0.014],
      [zRear, zRear + 0.3, 0.014],
    ] as const) {
      for (let z = from; z <= to; z += step) zs.push(z);
    }
    zs.push(zFront, zRear);
    for (const a of this.spec.arches) {
      const steps = 22;
      for (let k = 1; k < steps; k++) zs.push(a.z + a.radius * Math.cos((k / steps) * Math.PI));
      for (const edge of [a.z - a.radius, a.z + a.radius]) zs.push(edge - 2e-4, edge + 2e-4);
    }
    const sorted = zs.filter((z) => z >= zRear && z <= zFront).sort((p, q) => p - q);
    const out: number[] = [];
    for (const z of sorted) if (out.length === 0 || z - out[out.length - 1] > 5e-5) out.push(z);
    return out;
  }

  /** Right-half section (x ≥ 0) from the floor centerline to the top centerline. */
  halfSection(z: number): Pt[] {
    const yb = this.bottom.at(z);
    const arch = this.archAt(z);
    let outer = this.outerCurve(z);
    let wellTop = yb;
    if (arch.top > yb) {
      // Clip the outer surface where the arch opening cuts it.
      const maxY = Math.max(...outer.map((p) => p.y));
      const cut = Math.min(arch.top, maxY - 0.04);
      if (cut > yb) {
        wellTop = cut;
        let k = 1;
        while (k < outer.length && outer[k].y < cut) k++;
        if (k < outer.length) {
          const a = outer[k - 1];
          const b = outer[k];
          const t = b.y - a.y > 1e-9 ? (cut - a.y) / (b.y - a.y) : 0;
          outer = [{ x: a.x + (b.x - a.x) * t, y: cut }, ...outer.slice(k)];
        }
      }
    }
    const res = resample(outer, OUTER_SAMPLES, 0.12);
    const xo = res[0].x;
    const innerX = Math.min(arch.innerX, xo - 0.02);
    return [
      { x: 0, y: yb },
      { x: innerX * 0.5, y: yb },
      { x: innerX, y: yb },
      { x: innerX, y: wellTop },
      { x: (innerX + xo) / 2, y: wellTop },
      ...res,
    ];
  }

  /** Plan-view corner rounding: how far a point at lateral fraction r is pulled back at station z. */
  private cornerOffset(z: number, r: number): number {
    const { nose, tail, zFront, zRear } = this.spec;
    const shape = (c: CornerSpec): number => {
      const rr = Math.min(1, Math.max(0, r));
      return c.depth * (1 - Math.pow(1 - Math.pow(rr, c.exponent), 1 / c.exponent));
    };
    const wn = smoothstep01((z - (zFront - nose.length)) / nose.length);
    const wt = smoothstep01((zRear + tail.length - z) / tail.length);
    return -shape(nose) * wn + shape(tail) * wt;
  }

  buildGeometry(): THREE.BufferGeometry {
    const zs = this.stations();
    const half = OUTER_SAMPLES + FLOOR_ROWS;
    const rows = half * 2 - 1;
    const grid = new GridSurface(zs.length, rows);
    const kind = (j: number): 'floor' | 'well' | 'outer' => {
      const h = j < half ? j : rows - 1 - j;
      if (h < 2) return 'floor';
      if (h < FLOOR_ROWS) return 'well';
      return 'outer';
    };
    const tubbed = new Uint8Array(zs.length * rows);
    const arched = new Uint8Array(zs.length);
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      const W = Math.max(1e-6, this.halfWidth.at(z));
      const sec = this.halfSection(z);
      // Wall/ceiling rows only form a wheel well where the arch actually cuts the section.
      if (sec[3].y > sec[2].y + 1e-4) arched[i] = 1;
      for (let j = 0; j < rows; j++) {
        const h = j < half ? j : rows - 1 - j;
        const p = sec[h];
        const x = j < half ? -p.x : p.x;
        const dz = this.cornerOffset(z, p.x / W);
        grid.set(i, j, x, p.y, z + dz);
        if (this.tubDepth(p.x, z) > 0.03) tubbed[i * rows + j] = 1;
      }
    }
    return buildGridGeometry(
      grid,
      (i, j, _nx, ny) => {
        const k = kind(j);
        if (k === 'well' && (arched[i] || arched[i + 1])) return MAT_DARK;
        if (k !== 'outer') {
          if (ny < -0.6) return MAT_DARK;
          const y = grid.y(i, j);
          const z = zs[i];
          const mid = (this.spec.zFront + this.spec.zRear) / 2;
          if (z < mid && y < (this.spec.diffuserTop ?? 0)) return MAT_DARK;
          if (z > mid && y < (this.spec.lipTop ?? 0)) return MAT_DARK;
          return MAT_PAINT;
        }
        if (tubbed[i * rows + j] && tubbed[(i + 1) * rows + j + 1]) return MAT_INTERIOR;
        return MAT_PAINT;
      },
      { materialCount: 3, creaseAngle: (40 * Math.PI) / 180 },
    );
  }
}

// ----------------------------------------------------------------------- cabin

export interface CabinSpec {
  /** Windshield base (cowl) and rear end of the glasshouse. */
  zFront: number;
  zRear: number;
  /** Centerline height of the roof/windscreen/backlight. */
  roof: ProfileLike;
  /** Height of the corner between side glass and roof (A-pillar, roof rail, C-pillar line). */
  rail: ProfileLike;
  /** Half width where the glasshouse meets the body. */
  baseHalfWidth: ProfileLike;
  /** Half width at the rail (tumblehome). */
  railHalfWidth: ProfileLike;
  /** Superellipse exponent across the roof. */
  roofShape: number;
  /** How far the base is sunk into the body. */
  sink: number;
}

/** Per-station layout of the cabin, used to draw the window mask in (z, s) space. */
export interface CabinStation {
  z: number;
  /** Arc length from the roof centerline to the rail and to the base (m). */
  sRail: number;
  sBase: number;
  /** Heights at the rail and at the base. */
  railY: number;
  baseY: number;
}

export const CABIN_S_MAX = 1.6;

const CABIN_TOP = 17;
const CABIN_SIDE = 7;

export class Cabin {
  readonly spec: CabinSpec;
  readonly stations: CabinStation[] = [];
  private readonly roof: Profile;
  private readonly rail: Profile;
  private readonly baseW: Profile;
  private readonly railW: Profile;
  private readonly body: LowerBody;

  constructor(spec: CabinSpec, body: LowerBody) {
    this.spec = spec;
    this.body = body;
    this.roof = toProfile(spec.roof);
    this.rail = toProfile(spec.rail);
    this.baseW = toProfile(spec.baseHalfWidth);
    this.railW = toProfile(spec.railHalfWidth);
  }

  /** Station positions along the cabin (finer where the glass curves). */
  private zs(): number[] {
    const { zFront, zRear } = this.spec;
    const n = Math.max(24, Math.round((zFront - zRear) / 0.038));
    const out: number[] = [];
    for (let i = 0; i <= n; i++) out.push(zRear + ((zFront - zRear) * i) / n);
    return out;
  }

  /** Half section (x ≥ 0) from the base up to the roof centerline. */
  private halfSection(z: number): { pts: Pt[]; sideCount: number; st: CabinStation } {
    const Wb = this.baseW.at(z);
    const Wr = Math.min(this.railW.at(z), Wb);
    const baseY = this.body.surfaceY(z, Wb) - this.spec.sink;
    const roofY = Math.max(baseY, this.roof.at(z));
    const railY = Math.min(roofY, Math.max(baseY, this.rail.at(z)));
    const side: Pt[] = [];
    for (let k = 0; k <= CABIN_SIDE; k++) {
      const t = k / CABIN_SIDE;
      // Slight outward bow of the side glass.
      const bow = Math.sin(t * Math.PI) * 0.012 * Math.min(1, (railY - baseY) / 0.25);
      side.push({ x: Wb + (Wr - Wb) * t + bow, y: baseY + (railY - baseY) * t });
    }
    const dense: Pt[] = [];
    const n = this.spec.roofShape;
    for (let k = 0; k <= 48; k++) {
      const th = (Math.PI / 2) * (k / 48);
      const X = k === 48 ? 0 : Math.pow(Math.cos(th), 2 / n);
      const Y = Math.pow(Math.sin(th), 2 / n);
      dense.push({ x: Wr * X, y: railY + (roofY - railY) * Y });
    }
    const topPts = resample(dense, CABIN_TOP, 0.05);
    const pts = [...side, ...topPts.slice(1)];
    let sRail = 0;
    for (let k = topPts.length - 1; k > 0; k--) sRail += Math.hypot(topPts[k].x - topPts[k - 1].x, topPts[k].y - topPts[k - 1].y);
    let sBase = sRail;
    for (let k = side.length - 1; k > 0; k--) sBase += Math.hypot(side[k].x - side[k - 1].x, side[k].y - side[k - 1].y);
    return { pts, sideCount: side.length, st: { z, sRail, sBase, railY, baseY } };
  }

  buildGeometry(): THREE.BufferGeometry {
    const zs = this.zs();
    const halfCount = CABIN_SIDE + CABIN_TOP;
    const rows = halfCount * 2 - 1;
    const grid = new GridSurface(zs.length, rows, true);
    const { zFront, zRear } = this.spec;
    this.stations.length = 0;
    for (let i = 0; i < zs.length; i++) {
      const { pts, st } = this.halfSection(zs[i]);
      this.stations.push(st);
      // Arc length from the centerline for each half-section point.
      const s = new Float64Array(pts.length);
      for (let k = pts.length - 2; k >= 0; k--) s[k] = s[k + 1] + Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y);
      for (let j = 0; j < rows; j++) {
        const h = j < halfCount ? j : rows - 1 - j;
        const p = pts[h];
        grid.set(i, j, j < halfCount ? -p.x : p.x, p.y, zs[i]);
        grid.setUv(i, j, (zs[i] - zRear) / (zFront - zRear), s[h] / CABIN_S_MAX);
      }
    }
    return buildGridGeometry(grid, () => 0, { materialCount: 1, creaseAngle: (50 * Math.PI) / 180 });
  }

  /** Station layout interpolated at z (after buildGeometry). */
  stationAt(z: number): CabinStation {
    const st = this.stations;
    if (z <= st[0].z) return st[0];
    for (let i = 1; i < st.length; i++) {
      if (z <= st[i].z) {
        const a = st[i - 1];
        const b = st[i];
        const t = (z - a.z) / (b.z - a.z);
        return {
          z,
          sRail: a.sRail + (b.sRail - a.sRail) * t,
          sBase: a.sBase + (b.sBase - a.sBase) * t,
          railY: a.railY + (b.railY - a.railY) * t,
          baseY: a.baseY + (b.baseY - a.baseY) * t,
        };
      }
    }
    return st[st.length - 1];
  }
}
