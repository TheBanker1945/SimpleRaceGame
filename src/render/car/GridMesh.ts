import * as THREE from 'three';

/**
 * A structured quad grid (columns × rows of vertices) that becomes a triangle mesh with
 * per-quad materials. Degenerate triangles (collapsed ends, zero-height seams) are dropped,
 * and normals are angle-weighted but split at a crease angle, so smooth panels shade smoothly
 * while wheel-arch lips and panel edges stay crisp.
 */
export class GridSurface {
  readonly cols: number;
  readonly rows: number;
  readonly positions: Float32Array;
  readonly uvs: Float32Array | null;

  constructor(cols: number, rows: number, withUvs = false) {
    this.cols = cols;
    this.rows = rows;
    this.positions = new Float32Array(cols * rows * 3);
    this.uvs = withUvs ? new Float32Array(cols * rows * 2) : null;
  }

  set(i: number, j: number, x: number, y: number, z: number): void {
    const k = (i * this.rows + j) * 3;
    this.positions[k] = x;
    this.positions[k + 1] = y;
    this.positions[k + 2] = z;
  }

  setUv(i: number, j: number, u: number, v: number): void {
    if (!this.uvs) return;
    const k = (i * this.rows + j) * 2;
    this.uvs[k] = u;
    this.uvs[k + 1] = v;
  }

  x(i: number, j: number): number {
    return this.positions[(i * this.rows + j) * 3];
  }

  y(i: number, j: number): number {
    return this.positions[(i * this.rows + j) * 3 + 1];
  }

  z(i: number, j: number): number {
    return this.positions[(i * this.rows + j) * 3 + 2];
  }
}

/**
 * Quad (i..i+1, j..j+1) → material slot, or -1 to leave a hole. With `perTriangle`, it is
 * asked once per triangle: tri 0 = (i,j)(i+1,j)(i+1,j+1), tri 1 = (i,j)(i+1,j+1)(i,j+1).
 */
export type QuadMaterial = (i: number, j: number, nx: number, ny: number, nz: number, tri: 0 | 1) => number;

export interface GridMeshOptions {
  materialCount: number;
  /** Faces meeting at more than this angle get separate normals (radians). */
  creaseAngle?: number;
  /** Reverse the winding (when the grid runs the other way round). */
  flip?: boolean;
  /** Classify each triangle separately (halves the stair-steps along diagonal material edges). */
  perTriangle?: boolean;
}

const MIN_AREA = 1e-8;

export function buildGridGeometry(grid: GridSurface, materialOf: QuadMaterial, opts: GridMeshOptions): THREE.BufferGeometry {
  const { cols, rows, positions: P } = grid;
  const cosCrease = Math.cos(opts.creaseAngle ?? (38 * Math.PI) / 180);
  const tris: number[] = [];
  const triMat: number[] = [];
  const faceN: number[] = [];
  const faceA: number[] = [];

  const pushTri = (a: number, b: number, c: number, mat: number): void => {
    const ax = P[a * 3];
    const ay = P[a * 3 + 1];
    const az = P[a * 3 + 2];
    const e1x = P[b * 3] - ax;
    const e1y = P[b * 3 + 1] - ay;
    const e1z = P[b * 3 + 2] - az;
    const e2x = P[c * 3] - ax;
    const e2y = P[c * 3 + 1] - ay;
    const e2z = P[c * 3 + 2] - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    const area = len / 2;
    if (area < MIN_AREA) return;
    nx /= len;
    ny /= len;
    nz /= len;
    tris.push(a, b, c);
    triMat.push(mat);
    faceN.push(nx, ny, nz);
    faceA.push(area);
  };

  for (let i = 0; i < cols - 1; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const p00 = i * rows + j;
      const p10 = (i + 1) * rows + j;
      const p01 = i * rows + j + 1;
      const p11 = (i + 1) * rows + j + 1;
      // Quad normal (for material decisions) from its diagonals.
      const d1x = P[p11 * 3] - P[p00 * 3];
      const d1y = P[p11 * 3 + 1] - P[p00 * 3 + 1];
      const d1z = P[p11 * 3 + 2] - P[p00 * 3 + 2];
      const d2x = P[p01 * 3] - P[p10 * 3];
      const d2y = P[p01 * 3 + 1] - P[p10 * 3 + 1];
      const d2z = P[p01 * 3 + 2] - P[p10 * 3 + 2];
      let nx = d1y * d2z - d1z * d2y;
      let ny = d1z * d2x - d1x * d2z;
      let nz = d1x * d2y - d1y * d2x;
      if (opts.flip) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      const mat0 = materialOf(i, j, nx / nl, ny / nl, nz / nl, 0);
      const mat1 = opts.perTriangle ? materialOf(i, j, nx / nl, ny / nl, nz / nl, 1) : mat0;
      if (opts.flip) {
        if (mat0 >= 0) pushTri(p00, p11, p10, mat0);
        if (mat1 >= 0) pushTri(p00, p01, p11, mat1);
      } else {
        if (mat0 >= 0) pushTri(p00, p10, p11, mat0);
        if (mat1 >= 0) pushTri(p00, p11, p01, mat1);
      }
    }
  }
  return trianglesToGeometry(P, grid.uvs, tris, triMat, faceN, faceA, opts.materialCount, cosCrease);
}

/** Shared back end: indexed triangles over a vertex pool → non-indexed geometry with creased normals and material groups. */
export function trianglesToGeometry(
  P: ArrayLike<number>,
  uvs: ArrayLike<number> | null,
  tris: number[],
  triMat: number[],
  faceN: number[],
  faceA: number[],
  materialCount: number,
  cosCrease: number,
): THREE.BufferGeometry {
  const vertexCount = P.length / 3;
  const triCount = triMat.length;
  // Vertex → incident faces (CSR).
  const counts = new Int32Array(vertexCount + 1);
  for (let t = 0; t < tris.length; t++) counts[tris[t] + 1]++;
  for (let v = 0; v < vertexCount; v++) counts[v + 1] += counts[v];
  const incident = new Int32Array(tris.length);
  const fill = counts.slice(0, vertexCount);
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) incident[fill[tris[t * 3 + c]]++] = t;
  }

  // Corner angles: angle-weighted normals don't depend on how quads are split or how
  // unevenly the stations are spaced (area weighting streaks glossy panels).
  const corner = new Float32Array(tris.length);
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const v = tris[t * 3 + c];
      const a = tris[t * 3 + ((c + 1) % 3)];
      const b = tris[t * 3 + ((c + 2) % 3)];
      const ax = P[a * 3] - P[v * 3];
      const ay = P[a * 3 + 1] - P[v * 3 + 1];
      const az = P[a * 3 + 2] - P[v * 3 + 2];
      const bx = P[b * 3] - P[v * 3];
      const by = P[b * 3 + 1] - P[v * 3 + 1];
      const bz = P[b * 3 + 2] - P[v * 3 + 2];
      const d = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
      corner[t * 3 + c] = d > 0 ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / d))) : 0;
    }
  }

  const order: number[] = [];
  const groupStarts: number[] = [];
  const groupCounts: number[] = [];
  for (let m = 0; m < materialCount; m++) {
    const start = order.length;
    for (let t = 0; t < triCount; t++) if (triMat[t] === m) order.push(t);
    groupStarts.push(start * 3);
    groupCounts.push((order.length - start) * 3);
  }

  const outP = new Float32Array(order.length * 9);
  const outN = new Float32Array(order.length * 9);
  const outUv = uvs ? new Float32Array(order.length * 6) : null;
  let o = 0;
  for (const t of order) {
    const fnx = faceN[t * 3];
    const fny = faceN[t * 3 + 1];
    const fnz = faceN[t * 3 + 2];
    for (let c = 0; c < 3; c++) {
      const v = tris[t * 3 + c];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let k = counts[v]; k < counts[v + 1]; k++) {
        const f = incident[k];
        const gx = faceN[f * 3];
        const gy = faceN[f * 3 + 1];
        const gz = faceN[f * 3 + 2];
        if (gx * fnx + gy * fny + gz * fnz < cosCrease) continue;
        const c0 = tris[f * 3] === v ? 0 : tris[f * 3 + 1] === v ? 1 : 2;
        const a = corner[f * 3 + c0] + faceA[f] * 1e-6;
        sx += gx * a;
        sy += gy * a;
        sz += gz * a;
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      outP[o * 3] = P[v * 3];
      outP[o * 3 + 1] = P[v * 3 + 1];
      outP[o * 3 + 2] = P[v * 3 + 2];
      outN[o * 3] = sx / l;
      outN[o * 3 + 1] = sy / l;
      outN[o * 3 + 2] = sz / l;
      if (outUv && uvs) {
        outUv[o * 2] = uvs[v * 2];
        outUv[o * 2 + 1] = uvs[v * 2 + 1];
      }
      o++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(outP, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
  if (outUv) geo.setAttribute('uv', new THREE.BufferAttribute(outUv, 2));
  for (let m = 0; m < materialCount; m++) if (groupCounts[m] > 0) geo.addGroup(groupStarts[m], groupCounts[m], m);
  geo.computeBoundingSphere();
  return geo;
}
