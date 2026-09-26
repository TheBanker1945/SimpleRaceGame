import { smoothstep } from '../core/math.ts';
import { fbm2D } from '../core/Random.ts';

/** Lateral distances (m, measured outward from the verge) of the terrain grid columns. */
export const TERRAIN_COLUMNS = [0, 1.2, 3.5, 6, 10, 16, 26, 40, 60, 90, 130, 180, 250, 340, 450];
export const TERRAIN_MAX = TERRAIN_COLUMNS[TERRAIN_COLUMNS.length - 1];

/**
 * Terrain height relative to the local road surface.
 * @param s distance along the road
 * @param outward distance from the verge, increasing away from the road
 * @param side -1 = right of the road, +1 = beyond the opposite carriageway
 */
export function terrainHeight(s: number, outward: number, side: number, seed: number): number {
  // Gravel verge, drainage ditch, then rolling hills that grow with distance.
  let h: number;
  if (outward < 1.2) h = -0.02 - outward * 0.08;
  else if (outward < 3.5) h = -0.12 - ((outward - 1.2) / 2.3) * 0.8;
  else if (outward < 6) h = -0.92 + ((outward - 3.5) / 2.5) * 0.7;
  else h = -0.22;
  const hills = fbm2D(s / 320, outward / 170 + side * 41.3, 4, seed + (side > 0 ? 11 : 0));
  const amplitude = smoothstep(6, 70, outward) * (7 + outward * 0.085);
  const rise = smoothstep(12, 160, outward) * 5;
  return h + hills * amplitude + rise;
}

/** Grass color (linear RGB 0..1) varying with position; darker and greener in the ditch. */
export function terrainColor(s: number, outward: number, side: number, seed: number, out: [number, number, number]): void {
  if (outward < 1.2) {
    out[0] = 0.42;
    out[1] = 0.4;
    out[2] = 0.36;
    return;
  }
  const n = fbm2D(s / 90, outward / 60 + side * 17, 3, seed + 5);
  const dry = smoothstep(-0.2, 0.6, n);
  // Lush green ↔ dry olive.
  out[0] = 0.24 + dry * 0.2;
  out[1] = 0.4 + dry * 0.1 - (outward < 6 ? 0.05 : 0);
  out[2] = 0.16 + dry * 0.04;
}
