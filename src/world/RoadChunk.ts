import * as THREE from 'three';
import { Random, fbm2D, hash01 } from '../core/Random.ts';
import type { RoadPath } from './RoadPath.ts';
import { createPathSample } from './RoadPath.ts';
import {
  BARRIER_LEFT,
  CHUNK_LENGTH,
  MARKING_PERIOD,
  MEDIAN_BASE,
  MEDIAN_CENTER,
  OPPOSITE_INNER,
  OPPOSITE_OUTER,
  PAVED_LEFT,
  PAVED_RIGHT,
  RAIL_FAR_LEFT,
  RAIL_RIGHT,
} from './RoadConstants.ts';
import { addPier, createGantry, createOverpass } from './SceneryModels.ts';
import { TERRAIN_COLUMNS, terrainColor, terrainHeight } from './Terrain.ts';

export interface WorldAssets {
  roadMat: THREE.Material;
  terrainMat: THREE.Material;
  concreteMat: THREE.Material;
  steelMat: THREE.Material;
  darkMat: THREE.Material;
  poleMat: THREE.Material;
  lampMat: THREE.Material;
  treeMat: THREE.Material;
  poolMat: THREE.Material;
  pineGeo: THREE.BufferGeometry;
  broadleafGeo: THREE.BufferGeometry;
  bushGeo: THREE.BufferGeometry;
  poleGeo: THREE.BufferGeometry;
  lampHeadGeo: THREE.BufferGeometry;
  postGeo: THREE.BufferGeometry;
  poolGeo: THREE.BufferGeometry;
  signTextures: THREE.Texture[];
}

export type ChunkFeature = 'none' | 'gantry' | 'overpass';

/** Row spacing of the road/barrier strips (m). */
const ROW_STEP = 4;
const ROWS = CHUNK_LENGTH / ROW_STEP + 1;
const TERRAIN_STEP = 8;
const TERRAIN_ROWS = CHUNK_LENGTH / TERRAIN_STEP + 1;
/** Terrain columns + one skirt column that drops out of sight at the far edge. */
const TERRAIN_COLS = TERRAIN_COLUMNS.length + 1;
const MAX_TREES = 90;
const MAX_BUSHES = 40;
const POLE_SPACING = 48;
const POLES = CHUNK_LENGTH / POLE_SPACING;

/** Jersey barrier profile (d relative to the median center, y) plus the flat median strip on both sides. */
const MEDIAN_PROFILE: [number, number][] = [
  [PAVED_LEFT - MEDIAN_CENTER, -0.005],
  [-MEDIAN_BASE / 2, -0.005],
  [-0.28, 0.08],
  [-0.2, 0.28],
  [-0.09, 0.82],
  [-0.07, 0.85],
  [0.07, 0.85],
  [0.09, 0.82],
  [0.2, 0.28],
  [0.28, 0.08],
  [MEDIAN_BASE / 2, -0.005],
  [OPPOSITE_INNER - MEDIAN_CENTER, -0.005],
];

/** W-beam guardrail front face, bottom to top (d offset toward the road, y). */
const RAIL_PROFILE: [number, number][] = [
  [0.0, 0.46],
  [0.05, 0.52],
  [0.02, 0.6],
  [0.05, 0.68],
  [0.0, 0.76],
  [-0.06, 0.78],
];

interface StripSpec {
  /** Cross-section as (d, y) pairs. */
  profile: [number, number][];
  rows: number;
  step: number;
}

/** Allocates a grid geometry sized for a strip spec (positions filled later). */
function allocateStrip(specs: StripSpec[], withUv: boolean, withColor: boolean): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const spec of specs) {
    vertexCount += spec.rows * spec.profile.length;
    indexCount += (spec.rows - 1) * (spec.profile.length - 1) * 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  if (withUv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertexCount * 2), 2));
  if (withColor) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  const index = new Uint32Array(indexCount);
  let base = 0;
  let k = 0;
  for (const spec of specs) {
    const cols = spec.profile.length;
    // Faces must point "outward"; for profiles ordered by increasing d the winding is flipped.
    const flip = spec.profile[cols - 1][0] > spec.profile[0][0];
    for (let r = 0; r < spec.rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = base + r * cols + c;
        const b = a + 1;
        const cc = a + cols;
        const d = cc + 1;
        if (flip) {
          index[k++] = a;
          index[k++] = cc;
          index[k++] = b;
          index[k++] = b;
          index[k++] = cc;
          index[k++] = d;
        } else {
          index[k++] = a;
          index[k++] = b;
          index[k++] = cc;
          index[k++] = b;
          index[k++] = d;
          index[k++] = cc;
        }
      }
    }
    base += spec.rows * cols;
  }
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}

const tmpSample = createPathSample();
const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const tmpColor = new THREE.Color();
const rgb: [number, number, number] = [0, 0, 0];

/**
 * One recycled 96 m slice of the world: both carriageways, median barrier, guardrails,
 * terrain with ditches and hills, trees, bushes, lamp posts and optional gantry/overpass.
 * All vertex buffers are allocated once and rewritten in place when the chunk is reused.
 */
export class RoadChunk {
  readonly group = new THREE.Group();
  index = -1;
  s0 = 0;
  /** Absolute world position the chunk's local geometry is relative to. */
  readonly anchor = { x: 0, y: 0, z: 0 };

  private readonly assets: WorldAssets;
  private readonly road: THREE.Mesh;
  private readonly terrain: THREE.Mesh;
  private readonly median: THREE.Mesh;
  private readonly rails: THREE.Mesh;
  private readonly posts: THREE.InstancedMesh;
  private readonly poles: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly pools: THREE.InstancedMesh;
  private readonly pines: THREE.InstancedMesh;
  private readonly broadleaves: THREE.InstancedMesh;
  private readonly bushes: THREE.InstancedMesh;
  private feature: THREE.Group | null = null;

  constructor(assets: WorldAssets) {
    this.assets = assets;
    const roadSpecs: StripSpec[] = [
      { profile: [[PAVED_LEFT, 0], [PAVED_RIGHT, 0]], rows: ROWS, step: ROW_STEP },
      { profile: [[OPPOSITE_OUTER, 0], [OPPOSITE_INNER, 0]], rows: ROWS, step: ROW_STEP },
    ];
    this.road = new THREE.Mesh(allocateStrip(roadSpecs, true, false), assets.roadMat);
    this.road.receiveShadow = true;

    const terrainProfile: [number, number][] = [];
    for (let c = 0; c < TERRAIN_COLS; c++) terrainProfile.push([0, 0]);
    // Right side is ordered outward = decreasing d (no flip); far side outward = increasing d.
    const rightSpec: StripSpec = { profile: terrainProfile.map((_, c) => [-c, 0]), rows: TERRAIN_ROWS, step: TERRAIN_STEP };
    const leftSpec: StripSpec = { profile: terrainProfile.map((_, c) => [c, 0]), rows: TERRAIN_ROWS, step: TERRAIN_STEP };
    this.terrain = new THREE.Mesh(allocateStrip([rightSpec, leftSpec], true, true), assets.terrainMat);
    this.terrain.receiveShadow = true;

    this.median = new THREE.Mesh(allocateStrip([{ profile: MEDIAN_PROFILE, rows: ROWS, step: ROW_STEP }], false, false), assets.concreteMat);
    this.median.castShadow = true;
    this.median.receiveShadow = true;

    this.rails = new THREE.Mesh(
      allocateStrip(
        [
          { profile: RAIL_PROFILE, rows: ROWS, step: ROW_STEP },
          { profile: RAIL_PROFILE, rows: ROWS, step: ROW_STEP },
        ],
        false,
        false,
      ),
      assets.steelMat,
    );
    this.rails.castShadow = true;

    this.posts = new THREE.InstancedMesh(assets.postGeo, assets.poleMat, (ROWS - 1) * 2);
    this.posts.castShadow = true;
    this.poles = new THREE.InstancedMesh(assets.poleGeo, assets.poleMat, POLES);
    this.poles.castShadow = true;
    this.heads = new THREE.InstancedMesh(assets.lampHeadGeo, assets.lampMat, POLES);
    this.pools = new THREE.InstancedMesh(assets.poolGeo, assets.poolMat, POLES * 2);
    this.pools.renderOrder = 1;
    this.pines = new THREE.InstancedMesh(assets.pineGeo, assets.treeMat, MAX_TREES);
    this.broadleaves = new THREE.InstancedMesh(assets.broadleafGeo, assets.treeMat, MAX_TREES);
    this.bushes = new THREE.InstancedMesh(assets.bushGeo, assets.treeMat, MAX_BUSHES);
    for (const m of [this.pines, this.broadleaves, this.bushes]) {
      m.castShadow = true;
      m.receiveShadow = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.count * 3), 3);
    }
    this.group.add(this.road, this.terrain, this.median, this.rails, this.posts, this.poles, this.heads, this.pools);
    this.group.add(this.pines, this.broadleaves, this.bushes);
    this.group.matrixAutoUpdate = true;
  }

  setNightLights(visible: boolean): void {
    this.pools.visible = visible;
  }

  build(index: number, path: RoadPath, seed: number, density: number, feature: ChunkFeature): void {
    this.index = index;
    this.s0 = index * CHUNK_LENGTH;
    path.sample(this.s0, tmpSample);
    this.anchor.x = tmpSample.x;
    this.anchor.y = tmpSample.y;
    this.anchor.z = tmpSample.z;

    this.buildRoad(path);
    this.buildTerrain(path, seed);
    this.buildMedian(path);
    this.buildRails(path);
    this.buildPostsAndPoles(path);
    this.buildVegetation(path, seed, density);
    this.buildFeature(path, seed, feature);
  }

  /** Moves the chunk to the render-space position for the current floating origin. */
  place(originX: number, originZ: number): void {
    this.group.position.set(this.anchor.x - originX, this.anchor.y, this.anchor.z - originZ);
  }

  // ----------------------------------------------------------------- builders

  private writeStrip(
    geo: THREE.BufferGeometry,
    vertexOffset: number,
    path: RoadPath,
    profile: readonly [number, number][],
    rows: number,
    step: number,
    dOffset = 0,
    dSign = 1,
  ): void {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const cols = profile.length;
    for (let r = 0; r < rows; r++) {
      path.sample(this.s0 + r * step, tmpSample);
      const cx = Math.cos(tmpSample.heading);
      const sx = Math.sin(tmpSample.heading);
      const bx = tmpSample.x - this.anchor.x;
      const by = tmpSample.y - this.anchor.y;
      const bz = tmpSample.z - this.anchor.z;
      for (let c = 0; c < cols; c++) {
        const d = dOffset + dSign * profile[c][0];
        const i = (vertexOffset + r * cols + c) * 3;
        arr[i] = bx + cx * d;
        arr[i + 1] = by + profile[c][1];
        arr[i + 2] = bz - sx * d;
      }
    }
  }

  private finish(geo: THREE.BufferGeometry): void {
    geo.getAttribute('position').needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  }

  private buildRoad(path: RoadPath): void {
    const geo = this.road.geometry;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const uva = uv.array as Float32Array;
    this.writeStrip(geo, 0, path, [[PAVED_LEFT, 0], [PAVED_RIGHT, 0]], ROWS, ROW_STEP);
    this.writeStrip(geo, ROWS * 2, path, [[OPPOSITE_OUTER, 0], [OPPOSITE_INNER, 0]], ROWS, ROW_STEP);
    for (let r = 0; r < ROWS; r++) {
      const v = (r * ROW_STEP) / MARKING_PERIOD;
      // Ours: u=0 at the median side, 1 at the outer edge.
      uva[(r * 2) * 2] = 0;
      uva[(r * 2) * 2 + 1] = v;
      uva[(r * 2 + 1) * 2] = 1;
      uva[(r * 2 + 1) * 2 + 1] = v;
      // Opposite carriageway is the mirror image: outer edge first.
      const o = ROWS * 2;
      uva[(o + r * 2) * 2] = 1;
      uva[(o + r * 2) * 2 + 1] = -v;
      uva[(o + r * 2 + 1) * 2] = 0;
      uva[(o + r * 2 + 1) * 2 + 1] = -v;
    }
    uv.needsUpdate = true;
    this.finish(geo);
  }

  private buildTerrain(path: RoadPath, seed: number): void {
    const geo = this.terrain.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const col = (geo.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    const uva = (geo.getAttribute('uv') as THREE.BufferAttribute).array as Float32Array;
    const n = TERRAIN_COLUMNS.length;
    for (let side = 0; side < 2; side++) {
      // side 0: right of our carriageway (outward = -d); side 1: beyond the opposite carriageway.
      const sign = side === 0 ? -1 : 1;
      const edge = side === 0 ? PAVED_RIGHT : OPPOSITE_OUTER;
      const offset = side * TERRAIN_ROWS * TERRAIN_COLS;
      for (let r = 0; r < TERRAIN_ROWS; r++) {
        const s = this.s0 + r * TERRAIN_STEP;
        path.sample(s, tmpSample);
        const cx = Math.cos(tmpSample.heading);
        const sx = Math.sin(tmpSample.heading);
        const bx = tmpSample.x - this.anchor.x;
        const by = tmpSample.y - this.anchor.y;
        const bz = tmpSample.z - this.anchor.z;
        for (let c = 0; c < TERRAIN_COLS; c++) {
          const skirt = c === n;
          const outward = TERRAIN_COLUMNS[Math.min(c, n - 1)];
          const d = edge + sign * outward;
          const h = skirt ? -70 : terrainHeight(s, outward, sign, seed);
          const i = offset + r * TERRAIN_COLS + c;
          arr[i * 3] = bx + cx * d;
          arr[i * 3 + 1] = by + h;
          arr[i * 3 + 2] = bz - sx * d;
          terrainColor(s, outward, sign, seed, rgb);
          col[i * 3] = rgb[0];
          col[i * 3 + 1] = rgb[1];
          col[i * 3 + 2] = rgb[2];
          uva[i * 2] = (outward + (skirt ? 60 : 0)) / 7;
          uva[i * 2 + 1] = (r * TERRAIN_STEP) / 7;
        }
      }
    }
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
    this.finish(geo);
  }

  private buildMedian(path: RoadPath): void {
    this.writeStrip(this.median.geometry, 0, path, MEDIAN_PROFILE, ROWS, ROW_STEP, MEDIAN_CENTER, 1);
    this.finish(this.median.geometry);
  }

  private buildRails(path: RoadPath): void {
    const geo = this.rails.geometry;
    // Right rail faces +d (toward our road); far rail faces −d (toward the opposite road).
    this.writeStrip(geo, 0, path, RAIL_PROFILE, ROWS, ROW_STEP, RAIL_RIGHT, 1);
    this.writeStrip(geo, ROWS * RAIL_PROFILE.length, path, RAIL_PROFILE, ROWS, ROW_STEP, RAIL_FAR_LEFT, -1);
    this.finish(geo);
  }

  private setInstance(mesh: THREE.InstancedMesh, i: number, s: number, d: number, dy: number, yawOffset: number, scale: number, path: RoadPath): void {
    path.sample(s, tmpSample);
    tmpPos.set(
      tmpSample.x + Math.cos(tmpSample.heading) * d - this.anchor.x,
      tmpSample.y - this.anchor.y + dy,
      tmpSample.z - Math.sin(tmpSample.heading) * d - this.anchor.z,
    );
    tmpQuat.setFromAxisAngle(UP, tmpSample.heading + yawOffset);
    tmpScale.setScalar(scale);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    mesh.setMatrixAt(i, tmpMatrix);
  }

  private finishInstances(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.visible = count > 0;
  }

  private buildPostsAndPoles(path: RoadPath): void {
    let k = 0;
    for (let r = 0; r < ROWS - 1; r++) {
      const s = this.s0 + r * ROW_STEP + 2;
      this.setInstance(this.posts, k++, s, RAIL_RIGHT - 0.12, 0, 0, 1, path);
      this.setInstance(this.posts, k++, s, RAIL_FAR_LEFT + 0.12, 0, 0, 1, path);
    }
    this.finishInstances(this.posts, k);

    for (let p = 0; p < POLES; p++) {
      const s = this.s0 + POLE_SPACING * (p + 0.5);
      this.setInstance(this.poles, p, s, MEDIAN_CENTER, 0.85, 0, 1, path);
      this.setInstance(this.heads, p, s, MEDIAN_CENTER, 0.85, 0, 1, path);
      // Light pools centred over the middle of each carriageway.
      this.setInstance(this.pools, p * 2, s, MEDIAN_CENTER - 6.8, 0.03, 0, 1, path);
      this.setInstance(this.pools, p * 2 + 1, s, MEDIAN_CENTER + 6.8, 0.03, 0, 1, path);
    }
    this.finishInstances(this.poles, POLES);
    this.finishInstances(this.heads, POLES);
    this.finishInstances(this.pools, POLES * 2);
  }

  private buildVegetation(path: RoadPath, seed: number, density: number): void {
    const rng = new Random(Math.floor(hash01(this.index, seed) * 4294967295));
    let pines = 0;
    let broad = 0;
    let bushes = 0;
    const candidates = Math.round(95 * density);
    for (let k = 0; k < candidates; k++) {
      const side = rng.chance(0.55) ? -1 : 1;
      const s = this.s0 + rng.range(0, CHUNK_LENGTH);
      // Biased toward the road so the near scenery is dense and the far hills sparser.
      const outward = 9 + Math.pow(rng.next(), 1.7) * 330;
      const forest = fbm2D(s / 420, outward / 230 + side * 9.1, 3, seed + 21);
      if (forest + rng.range(-0.3, 0.3) < -0.02) continue;
      const edge = side < 0 ? PAVED_RIGHT : OPPOSITE_OUTER;
      const d = edge + side * outward;
      const h = terrainHeight(s, outward, side, seed);
      const scale = rng.range(0.75, 1.45);
      const conifer = fbm2D(s / 700, outward / 300, 2, seed + 33) + rng.range(-0.25, 0.25) > 0;
      const mesh = conifer ? this.pines : this.broadleaves;
      const i = conifer ? pines : broad;
      if (i >= MAX_TREES) continue;
      this.setInstance(mesh, i, s, d, h - 0.1, rng.range(0, Math.PI * 2), scale, path);
      tmpColor.setRGB(rng.range(0.8, 1.15), rng.range(0.85, 1.15), rng.range(0.8, 1.1));
      mesh.setColorAt(i, tmpColor);
      if (conifer) pines++;
      else broad++;
    }
    const bushCandidates = Math.round(40 * density);
    for (let k = 0; k < bushCandidates && bushes < MAX_BUSHES; k++) {
      const side = rng.chance(0.6) ? -1 : 1;
      const s = this.s0 + rng.range(0, CHUNK_LENGTH);
      const outward = rng.range(5, 40);
      const edge = side < 0 ? PAVED_RIGHT : OPPOSITE_OUTER;
      const h = terrainHeight(s, outward, side, seed);
      this.setInstance(this.bushes, bushes, s, edge + side * outward, h - 0.1, rng.range(0, 6.28), rng.range(0.6, 1.5), path);
      tmpColor.setRGB(rng.range(0.8, 1.2), rng.range(0.85, 1.2), rng.range(0.8, 1.1));
      this.bushes.setColorAt(bushes, tmpColor);
      bushes++;
    }
    this.finishInstances(this.pines, pines);
    this.finishInstances(this.broadleaves, broad);
    this.finishInstances(this.bushes, bushes);
  }

  private disposeFeature(): void {
    if (!this.feature) return;
    this.group.remove(this.feature);
    this.feature.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        // Sign-face materials are created per gantry (textures are shared and kept).
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m.userData.perFeature) m.dispose();
      }
    });
    this.feature = null;
  }

  private buildFeature(path: RoadPath, seed: number, feature: ChunkFeature): void {
    this.disposeFeature();
    if (feature === 'none') return;
    const a = this.assets;
    const s = this.s0 + CHUNK_LENGTH / 2;
    path.sample(s, tmpSample);
    let group: THREE.Group;
    if (feature === 'gantry') {
      const rng = new Random(this.index * 31 + seed);
      const signs = [rng.pick(a.signTextures), rng.pick(a.signTextures)];
      group = createGantry(signs, a.steelMat, RAIL_RIGHT - 0.4, BARRIER_LEFT + 0.2);
      group.traverse((o) => {
        if (o instanceof THREE.Mesh && Array.isArray(o.material)) {
          const face = o.material[5];
          face.userData.perFeature = true;
          o.material[4].userData.perFeature = true;
        }
      });
    } else {
      const from = RAIL_RIGHT - 34;
      const to = RAIL_FAR_LEFT + 34;
      group = createOverpass(a.concreteMat, a.darkMat, from, to);
      addPier(group, a.concreteMat, RAIL_RIGHT - 5, terrainHeight(s, 5, -1, seed) - 0.3);
      addPier(group, a.concreteMat, MEDIAN_CENTER, 0.8);
      addPier(group, a.concreteMat, RAIL_FAR_LEFT + 5, terrainHeight(s, 5, 1, seed) - 0.3);
      addPier(group, a.concreteMat, from + 3, terrainHeight(s, 31, -1, seed) - 0.5);
      addPier(group, a.concreteMat, to - 3, terrainHeight(s, 31, 1, seed) - 0.5);
    }
    group.position.set(tmpSample.x - this.anchor.x, tmpSample.y - this.anchor.y, tmpSample.z - this.anchor.z);
    group.rotation.y = tmpSample.heading;
    this.feature = group;
    this.group.add(group);
  }
}
