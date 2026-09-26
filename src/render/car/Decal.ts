import * as THREE from 'three';

/*
 * Surface decals: flat 2D outlines (a headlight, a grille opening, a door shut line) are
 * triangulated, refined, and projected along a direction onto the body mesh, then lifted
 * a few millimetres off it. The result hugs every curve of the procedural body, which is
 * what makes lamps, intakes and vents look designed rather than stuck on.
 */

export type Vec2 = readonly [number, number];

/** Projection frame: (a, b) are coordinates in the image plane, rays travel along -w. */
export interface Frame {
  u: THREE.Vector3;
  v: THREE.Vector3;
  w: THREE.Vector3;
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Natural frames. Front/rear: (x, y). Left side: (z, y). Top: (x, z). */
export const FRONT: Frame = { u: V(1, 0, 0), v: V(0, 1, 0), w: V(0, 0, 1) };
export const REAR: Frame = { u: V(1, 0, 0), v: V(0, 1, 0), w: V(0, 0, -1) };
export const LEFT: Frame = { u: V(0, 0, 1), v: V(0, 1, 0), w: V(1, 0, 0) };
export const TOP: Frame = { u: V(1, 0, 0), v: V(0, 0, 1), w: V(0, 1, 0) };
/** Rear frame with a = -x, so textures (number plates) read correctly from behind. */
export const REAR_TEXT: Frame = { u: V(-1, 0, 0), v: V(0, 1, 0), w: V(0, 0, -1) };

/** A frame looking along `dir` (the ray direction) with `up` roughly vertical in the image. */
export function frameAlong(dir: THREE.Vector3, up = V(0, 1, 0)): Frame {
  const w = dir.clone().normalize().negate();
  const u = up.clone().cross(w).normalize();
  const v = w.clone().cross(u).normalize();
  return { u, v, w };
}

export interface Hit {
  p: THREE.Vector3;
  n: THREE.Vector3;
}

/** Finds the first surface point along -w for a given (a, b), using a 2D bucket grid. */
export class SurfaceProjector {
  private readonly ab: Float32Array;
  private readonly depth: Float32Array;
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly cells: Int32Array[];
  private readonly minA: number;
  private readonly minB: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly cell: number;

  readonly frame: Frame;

  constructor(geometries: THREE.BufferGeometry[], frame: Frame, cell = 0.035) {
    this.frame = frame;
    const { u, v, w } = frame;
    const ab: number[] = [];
    const depth: number[] = [];
    const pos: number[] = [];
    const nrm: number[] = [];
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const fn = new THREE.Vector3();
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (const g of geometries) {
      const P = g.getAttribute('position');
      const N = g.getAttribute('normal');
      const count = P.count;
      for (let t = 0; t + 2 < count; t += 3) {
        for (let c = 0; c < 3; c++) p[c].fromBufferAttribute(P, t + c);
        e1.subVectors(p[1], p[0]);
        e2.subVectors(p[2], p[0]);
        fn.crossVectors(e1, e2);
        const len = fn.length();
        if (len < 1e-10 || fn.dot(w) / len < 0.02) continue;
        for (let c = 0; c < 3; c++) {
          ab.push(p[c].dot(u), p[c].dot(v));
          depth.push(p[c].dot(w));
          pos.push(p[c].x, p[c].y, p[c].z);
          nrm.push(N.getX(t + c), N.getY(t + c), N.getZ(t + c));
        }
      }
    }
    this.ab = new Float32Array(ab);
    this.depth = new Float32Array(depth);
    this.pos = new Float32Array(pos);
    this.nrm = new Float32Array(nrm);
    let minA = Infinity;
    let minB = Infinity;
    let maxA = -Infinity;
    let maxB = -Infinity;
    for (let i = 0; i < ab.length; i += 2) {
      minA = Math.min(minA, ab[i]);
      maxA = Math.max(maxA, ab[i]);
      minB = Math.min(minB, ab[i + 1]);
      maxB = Math.max(maxB, ab[i + 1]);
    }
    if (!Number.isFinite(minA)) minA = minB = maxA = maxB = 0;
    this.cell = cell;
    this.minA = minA;
    this.minB = minB;
    this.nx = Math.max(1, Math.ceil((maxA - minA) / cell) + 1);
    this.ny = Math.max(1, Math.ceil((maxB - minB) / cell) + 1);
    const buckets: number[][] = Array.from({ length: this.nx * this.ny }, () => []);
    const triCount = ab.length / 6;
    for (let t = 0; t < triCount; t++) {
      const k = t * 6;
      const a0 = Math.min(ab[k], ab[k + 2], ab[k + 4]);
      const a1 = Math.max(ab[k], ab[k + 2], ab[k + 4]);
      const b0 = Math.min(ab[k + 1], ab[k + 3], ab[k + 5]);
      const b1 = Math.max(ab[k + 1], ab[k + 3], ab[k + 5]);
      const i0 = Math.floor((a0 - minA) / cell);
      const i1 = Math.floor((a1 - minA) / cell);
      const j0 = Math.floor((b0 - minB) / cell);
      const j1 = Math.floor((b1 - minB) / cell);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * this.nx + i].push(t);
    }
    this.cells = buckets.map((b) => Int32Array.from(b));
  }

  cast(a: number, b: number, out?: Hit): Hit | null {
    const i = Math.floor((a - this.minA) / this.cell);
    const j = Math.floor((b - this.minB) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return null;
    const list = this.cells[j * this.nx + i];
    const ab = this.ab;
    let best = -Infinity;
    let bt = -1;
    let bw0 = 0;
    let bw1 = 0;
    let bw2 = 0;
    for (let q = 0; q < list.length; q++) {
      const t = list[q];
      const k = t * 6;
      const ax = ab[k];
      const ay = ab[k + 1];
      const bx = ab[k + 2];
      const by = ab[k + 3];
      const cx = ab[k + 4];
      const cy = ab[k + 5];
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-14) continue;
      const w0 = ((by - cy) * (a - cx) + (cx - bx) * (b - cy)) / det;
      const w1 = ((cy - ay) * (a - cx) + (ax - cx) * (b - cy)) / det;
      const w2 = 1 - w0 - w1;
      const eps = -1e-5;
      if (w0 < eps || w1 < eps || w2 < eps) continue;
      const d = this.depth[t * 3] * w0 + this.depth[t * 3 + 1] * w1 + this.depth[t * 3 + 2] * w2;
      if (d > best) {
        best = d;
        bt = t;
        bw0 = w0;
        bw1 = w1;
        bw2 = w2;
      }
    }
    if (bt < 0) return null;
    const hit = out ?? { p: new THREE.Vector3(), n: new THREE.Vector3() };
    const P = this.pos;
    const N = this.nrm;
    const k = bt * 9;
    hit.p.set(
      P[k] * bw0 + P[k + 3] * bw1 + P[k + 6] * bw2,
      P[k + 1] * bw0 + P[k + 4] * bw1 + P[k + 7] * bw2,
      P[k + 2] * bw0 + P[k + 5] * bw1 + P[k + 8] * bw2,
    );
    hit.n
      .set(N[k] * bw0 + N[k + 3] * bw1 + N[k + 6] * bw2, N[k + 1] * bw0 + N[k + 4] * bw1 + N[k + 7] * bw2, N[k + 2] * bw0 + N[k + 5] * bw1 + N[k + 8] * bw2)
      .normalize();
    return hit;
  }
}

// ------------------------------------------------------------------ outlines

/** Rounded rectangle outline (center, size, corner radius). */
export function roundedRect(ca: number, cb: number, w: number, h: number, r: number, segments = 4): Vec2[] {
  const rr = Math.min(r, w / 2, h / 2);
  const pts: Vec2[] = [];
  const corners: [number, number, number][] = [
    [ca + w / 2 - rr, cb + h / 2 - rr, 0],
    [ca - w / 2 + rr, cb + h / 2 - rr, Math.PI / 2],
    [ca - w / 2 + rr, cb - h / 2 + rr, Math.PI],
    [ca + w / 2 - rr, cb - h / 2 + rr, (3 * Math.PI) / 2],
  ];
  for (const [x, y, a0] of corners) {
    for (let s = 0; s <= segments; s++) {
      const a = a0 + (s / segments) * (Math.PI / 2);
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
  }
  return pts;
}

export function ellipse(ca: number, cb: number, ra: number, rb: number, segments = 24): Vec2[] {
  const pts: Vec2[] = [];
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    pts.push([ca + Math.cos(a) * ra, cb + Math.sin(a) * rb]);
  }
  return pts;
}

/** Smooth closed outline through control points (uniform Catmull-Rom). */
export function smoothOutline(points: readonly Vec2[], perSegment = 6): Vec2[] {
  const n = points.length;
  const pts: Vec2[] = [];
  const P = (i: number): THREE.Vector2 => {
    const [a, b] = points[((i % n) + n) % n];
    return new THREE.Vector2(a, b);
  };
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const a = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const b = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      pts.push([a, b]);
    }
  }
  return pts;
}

/** A thin ribbon along a polyline (for shut lines, trim strips). */
export function strip(points: readonly Vec2[], width: number): Vec2[] {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    left.push([p[0] - dy * (width / 2), p[1] + dx * (width / 2)]);
    right.push([p[0] + dy * (width / 2), p[1] - dx * (width / 2)]);
  }
  return [...left, ...right.reverse()];
}

/** Polyline sampled from a function over [t0, t1]. */
export function polyline(f: (t: number) => Vec2, t0: number, t1: number, steps: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) pts.push(f(t0 + ((t1 - t0) * i) / steps));
  return pts;
}

// ---------------------------------------------------------------- building

interface Mesh2D {
  verts: number[];
  tris: number[];
}

/** Conforming red-green refinement: splits every edge longer than maxEdge, neighbors agree. */
function refine(mesh: Mesh2D, maxEdge: number): void {
  const { verts } = mesh;
  let tris = mesh.tris;
  for (let pass = 0; pass < 10; pass++) {
    const mids = new Map<number, number>();
    const edgeKey = (i: number, j: number): number => (i < j ? i * 1048576 + j : j * 1048576 + i);
    const long = (i: number, j: number): boolean => Math.hypot(verts[i * 2] - verts[j * 2], verts[i * 2 + 1] - verts[j * 2 + 1]) > maxEdge;
    let any = false;
    for (let t = 0; t < tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const i = tris[t + e];
        const j = tris[t + ((e + 1) % 3)];
        const key = edgeKey(i, j);
        if (!mids.has(key) && long(i, j)) {
          verts.push((verts[i * 2] + verts[j * 2]) / 2, (verts[i * 2 + 1] + verts[j * 2 + 1]) / 2);
          mids.set(key, verts.length / 2 - 1);
          any = true;
        }
      }
    }
    if (!any) break;
    const out: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const v = [tris[t], tris[t + 1], tris[t + 2]];
      const m = [0, 1, 2].map((e) => mids.get(edgeKey(v[e], v[(e + 1) % 3])) ?? -1);
      const marked = m.filter((x) => x >= 0).length;
      if (marked === 0) {
        out.push(v[0], v[1], v[2]);
      } else if (marked === 3) {
        out.push(v[0], m[0], m[2], m[0], v[1], m[1], m[2], m[1], v[2], m[0], m[1], m[2]);
      } else {
        // Rotate so the first marked edge (in winding order) starts at index 0.
        let r = 0;
        if (marked === 1) r = m.findIndex((x) => x >= 0);
        else r = m[0] >= 0 && m[1] >= 0 ? 0 : m[1] >= 0 && m[2] >= 0 ? 1 : 2;
        const a = v[r];
        const b = v[(r + 1) % 3];
        const c = v[(r + 2) % 3];
        const mab = m[r];
        const mbc = m[(r + 1) % 3];
        if (marked === 1) {
          out.push(a, mab, c, mab, b, c);
        } else {
          out.push(mab, b, mbc, a, mab, mbc, a, mbc, c);
        }
      }
    }
    tris = out;
  }
  mesh.tris = tris;
}

export interface DecalOptions {
  /** Lift off the surface along its normal (m). */
  offset?: number;
  /** Refinement edge length (m). Smaller follows curvature better. */
  maxEdge?: number;
  /** Holes cut out of the outline. */
  holes?: readonly (readonly Vec2[])[];
  /** UV scale: uv = (a, b) / uvScale. If omitted, UVs span the outline's bounding box 0..1. */
  uvScale?: number;
  /** Extra push along the projection direction toward the viewer (m), for raised parts. */
  raise?: number;
  /**
   * Triangles stretched more than this (3D area / projected area) are dropped: they span
   * from one surface to another one far behind it (a "curtain") instead of lying on the body.
   */
  maxStretch?: number;
}

/** Builds a decal mesh on the surface seen by `projector`. Returns null if it missed. */
export function buildDecal(projector: SurfaceProjector, outline: readonly Vec2[], opts: DecalOptions = {}): THREE.BufferGeometry | null {
  const offset = opts.offset ?? 0.003;
  const maxEdge = opts.maxEdge ?? 0.05;
  const contour = outline.map(([a, b]) => new THREE.Vector2(a, b));
  const holes = (opts.holes ?? []).map((h) => h.map(([a, b]) => new THREE.Vector2(a, b)));
  // Earcut wants a clockwise-agnostic contour; ShapeUtils handles winding.
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  for (const h of holes) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  const all = [...contour, ...holes.flat()];
  const mesh: Mesh2D = { verts: all.flatMap((p) => [p.x, p.y]), tris: faces.flat() };
  refine(mesh, maxEdge);

  const { w } = projector.frame;
  const n2 = mesh.verts.length / 2;
  const P = new Float32Array(n2 * 3);
  const N = new Float32Array(n2 * 3);
  const ok = new Uint8Array(n2);
  const hit: Hit = { p: new THREE.Vector3(), n: new THREE.Vector3() };
  let minA = Infinity;
  let minB = Infinity;
  let maxA = -Infinity;
  let maxB = -Infinity;
  for (let i = 0; i < n2; i++) {
    const a = mesh.verts[i * 2];
    const b = mesh.verts[i * 2 + 1];
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a);
    minB = Math.min(minB, b);
    maxB = Math.max(maxB, b);
    if (!projector.cast(a, b, hit)) continue;
    ok[i] = 1;
    const raise = opts.raise ?? 0;
    P[i * 3] = hit.p.x + hit.n.x * offset + w.x * raise;
    P[i * 3 + 1] = hit.p.y + hit.n.y * offset + w.y * raise;
    P[i * 3 + 2] = hit.p.z + hit.n.z * offset + w.z * raise;
    N[i * 3] = hit.n.x;
    N[i * 3 + 1] = hit.n.y;
    N[i * 3 + 2] = hit.n.z;
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const sa = opts.uvScale ?? Math.max(1e-6, maxA - minA);
  const sb = opts.uvScale ?? Math.max(1e-6, maxB - minB);
  const oa = opts.uvScale ? 0 : minA;
  const ob = opts.uvScale ? 0 : minB;
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const fn = new THREE.Vector3();
  const avg = new THREE.Vector3();
  const tris = mesh.tris;
  for (let t = 0; t < tris.length; t += 3) {
    let idx = [tris[t], tris[t + 1], tris[t + 2]];
    if (!ok[idx[0]] || !ok[idx[1]] || !ok[idx[2]]) continue;
    e1.set(P[idx[1] * 3] - P[idx[0] * 3], P[idx[1] * 3 + 1] - P[idx[0] * 3 + 1], P[idx[1] * 3 + 2] - P[idx[0] * 3 + 2]);
    e2.set(P[idx[2] * 3] - P[idx[0] * 3], P[idx[2] * 3 + 1] - P[idx[0] * 3 + 1], P[idx[2] * 3 + 2] - P[idx[0] * 3 + 2]);
    fn.crossVectors(e1, e2);
    const area2d = Math.abs(
      (mesh.verts[idx[1] * 2] - mesh.verts[idx[0] * 2]) * (mesh.verts[idx[2] * 2 + 1] - mesh.verts[idx[0] * 2 + 1]) -
        (mesh.verts[idx[2] * 2] - mesh.verts[idx[0] * 2]) * (mesh.verts[idx[1] * 2 + 1] - mesh.verts[idx[0] * 2 + 1]),
    );
    if (fn.length() > area2d * (opts.maxStretch ?? 5) + 1e-9) continue;
    avg.set(0, 0, 0);
    for (const k of idx) avg.x += N[k * 3], avg.y += N[k * 3 + 1], avg.z += N[k * 3 + 2];
    if (fn.dot(avg) < 0) idx = [idx[0], idx[2], idx[1]];
    for (const k of idx) {
      pos.push(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
      nrm.push(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]);
      uv.push((mesh.verts[k * 2] - oa) / sa, (mesh.verts[k * 2 + 1] - ob) / sb);
    }
  }
  if (pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

/** Mirror copy across the car's centerline (x → -x) with corrected winding. */
export function mirrorX(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = (geo.index ? geo.toNonIndexed() : geo).clone();
  const P = g.getAttribute('position') as THREE.BufferAttribute;
  const N = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < P.count; i++) {
    P.setX(i, -P.getX(i));
    if (N) N.setX(i, -N.getX(i));
  }
  // Swap two corners of every triangle to restore the winding.
  for (const name of Object.keys(g.attributes)) {
    const attr = g.getAttribute(name) as THREE.BufferAttribute;
    const size = attr.itemSize;
    const arr = attr.array as Float32Array;
    for (let t = 0; t + 2 < attr.count; t += 3) {
      for (let c = 0; c < size; c++) {
        const i1 = (t + 1) * size + c;
        const i2 = (t + 2) * size + c;
        const tmp = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = tmp;
      }
    }
    attr.needsUpdate = true;
  }
  return g;
}
