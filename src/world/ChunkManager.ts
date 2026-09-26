import * as THREE from 'three';
import { Random } from '../core/Random.ts';
import { CHUNK_LENGTH } from './RoadConstants.ts';
import { RoadChunk, type ChunkFeature, type WorldAssets } from './RoadChunk.ts';
import type { RoadPath } from './RoadPath.ts';

/** How many chunks are kept behind the player. */
const CHUNKS_BEHIND = 2;
/** Chunk builds per frame while driving (spreads the cost; the initial fill is unlimited). */
const BUILDS_PER_FRAME = 2;

/**
 * Keeps a window of recycled chunks around the player. Chunks that fall behind are
 * rebuilt in place for the next stretch of road ahead, so no geometry is allocated
 * while driving. Gantries and overpasses are scheduled deterministically from the seed.
 */
export class ChunkManager {
  readonly group = new THREE.Group();
  private readonly assets: WorldAssets;
  private readonly path: RoadPath;
  private readonly pool: RoadChunk[] = [];
  private readonly active = new Map<number, RoadChunk>();
  private seed = 1;
  private density = 1;
  private ahead = 15;
  private nightLights = false;

  private readonly features = new Map<number, ChunkFeature>();
  private scheduledUntil = 0;
  private nextOverpass = 0;
  private nextGantry = 0;
  private featureRng = new Random(1);

  constructor(assets: WorldAssets, path: RoadPath) {
    this.assets = assets;
    this.path = path;
  }

  configure(drawDistance: number, density: number): void {
    const newAhead = Math.ceil(drawDistance / CHUNK_LENGTH) + 1;
    const densityChanged = density !== this.density;
    this.ahead = newAhead;
    this.density = density;
    if (densityChanged) {
      // Rebuild vegetation at the new density on the next update.
      for (const chunk of this.active.values()) {
        this.pool.push(chunk);
        this.group.remove(chunk.group);
      }
      this.active.clear();
    }
  }

  reset(seed: number): void {
    this.seed = seed;
    for (const chunk of this.active.values()) {
      this.pool.push(chunk);
      this.group.remove(chunk.group);
    }
    this.active.clear();
    this.features.clear();
    this.scheduledUntil = 0;
    this.featureRng = new Random(seed * 7 + 3);
    this.nextOverpass = 12 + this.featureRng.int(0, 8);
    this.nextGantry = 5 + this.featureRng.int(0, 4);
  }

  get farthestS(): number {
    let max = 0;
    for (const idx of this.active.keys()) max = Math.max(max, (idx + 1) * CHUNK_LENGTH);
    return max;
  }

  private featureFor(index: number): ChunkFeature {
    while (this.scheduledUntil <= index) {
      const i = this.scheduledUntil++;
      let f: ChunkFeature = 'none';
      if (i === this.nextOverpass) {
        f = 'overpass';
        this.nextOverpass = i + this.featureRng.int(14, 30);
        if (this.nextGantry <= i + 2) this.nextGantry = i + 3;
      } else if (i === this.nextGantry) {
        f = 'gantry';
        this.nextGantry = i + this.featureRng.int(7, 16);
        if (this.nextGantry === this.nextOverpass) this.nextGantry++;
      }
      this.features.set(i, f);
    }
    return this.features.get(index) ?? 'none';
  }

  /**
   * @param playerS player distance along the road
   * @param unlimited build every missing chunk now (used after a reset)
   */
  update(playerS: number, originX: number, originZ: number, unlimited = false): void {
    const current = Math.floor(playerS / CHUNK_LENGTH);
    const first = Math.max(0, current - CHUNKS_BEHIND);
    const last = current + this.ahead;
    this.path.ensure((last + 2) * CHUNK_LENGTH);

    for (const [idx, chunk] of this.active) {
      if (idx < first || idx > last) {
        this.active.delete(idx);
        this.group.remove(chunk.group);
        this.pool.push(chunk);
      }
    }
    for (const idx of this.features.keys()) if (idx < first - 4) this.features.delete(idx);

    let budget = unlimited ? Infinity : BUILDS_PER_FRAME;
    // Build nearest-first so a burst never leaves a hole right in front of the car.
    for (let idx = current; idx <= last && budget > 0; idx++) budget = this.ensureChunk(idx, originX, originZ, budget);
    for (let idx = current - 1; idx >= first && budget > 0; idx--) budget = this.ensureChunk(idx, originX, originZ, budget);
  }

  private ensureChunk(idx: number, originX: number, originZ: number, budget: number): number {
    if (this.active.has(idx)) return budget;
    const chunk = this.pool.pop() ?? new RoadChunk(this.assets);
    chunk.build(idx, this.path, this.seed, this.density, this.featureFor(idx));
    chunk.setNightLights(this.nightLights);
    chunk.place(originX, originZ);
    this.active.set(idx, chunk);
    this.group.add(chunk.group);
    return budget - 1;
  }

  /** Re-positions every chunk after a floating-origin shift. */
  applyOrigin(originX: number, originZ: number): void {
    for (const chunk of this.active.values()) chunk.place(originX, originZ);
  }

  setNightLights(on: boolean): void {
    this.nightLights = on;
    for (const chunk of this.active.values()) chunk.setNightLights(on);
  }
}
