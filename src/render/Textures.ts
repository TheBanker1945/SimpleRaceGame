import * as THREE from 'three';
import { Random } from '../core/Random.ts';
import {
  LANE_COUNT,
  LANE_WIDTH,
  LANES_HALF_WIDTH,
  MARKING_PERIOD,
  PAVED_LEFT,
  PAVED_RIGHT,
  laneCenter,
} from '../world/RoadConstants.ts';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  return [canvas, ctx];
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, rng: Random, colors: string[], size: number): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rng.pick(colors);
    const s = size * rng.range(0.5, 1.5);
    ctx.fillRect(rng.range(0, w), rng.range(0, h), s, s);
  }
}

/**
 * Asphalt with lane markings, laid out across the full paved width
 * (u = 0 at the left paved edge, u = 1 at the right paved edge) and
 * repeating every MARKING_PERIOD meters along the road.
 */
export function createRoadTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const [canvas, ctx] = makeCanvas(W, H);
  const rng = new Random(1234);
  const width = PAVED_LEFT - PAVED_RIGHT;
  const px = (d: number): number => ((PAVED_LEFT - d) / width) * W;
  const pxPerM = W / width;
  const pyPerM = H / MARKING_PERIOD;

  ctx.fillStyle = '#3a3c3f';
  ctx.fillRect(0, 0, W, H);
  // Shoulders are a slightly different, lighter mix.
  ctx.fillStyle = '#44464a';
  ctx.fillRect(0, 0, px(LANES_HALF_WIDTH), H);
  ctx.fillRect(px(-LANES_HALF_WIDTH), 0, W - px(-LANES_HALF_WIDTH), H);
  speckle(ctx, W, H, 26000, rng, ['#2e3033', '#46494c', '#35373a', '#505356', '#292b2e'], 2);

  // Polished wheel tracks in every lane.
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const c = laneCenter(lane);
    for (const off of [-0.9, 0.9]) {
      const g = ctx.createLinearGradient(px(c + off + 0.45), 0, px(c + off - 0.45), 0);
      g.addColorStop(0, 'rgba(20,20,22,0)');
      g.addColorStop(0.5, 'rgba(20,20,22,0.28)');
      g.addColorStop(1, 'rgba(20,20,22,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px(c + off + 0.45), 0, 0.9 * pxPerM, H);
    }
  }

  // Tar-sealed cracks.
  ctx.strokeStyle = 'rgba(18,18,20,0.55)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    let x = rng.range(0, W);
    let y = rng.range(0, H);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += rng.range(-18, 18);
      y += rng.range(-30, 30);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const line = (d: number, w: number, color: string, dashed: boolean): void => {
    ctx.fillStyle = color;
    const x = px(d) - (w * pxPerM) / 2;
    if (dashed) {
      ctx.fillRect(x, 0, w * pxPerM, 4 * pyPerM);
    } else {
      ctx.fillRect(x, 0, w * pxPerM, H);
    }
  };
  // Left edge (yellow), lane dividers (dashed white), right edge (solid white).
  line(LANES_HALF_WIDTH - 0.12, 0.2, '#d8b43a', false);
  for (let i = 1; i < LANE_COUNT; i++) line(LANES_HALF_WIDTH - i * LANE_WIDTH, 0.15, '#e6e6e0', true);
  line(-LANES_HALF_WIDTH + 0.14, 0.25, '#e8e8e2', false);

  // Rumble strip grooves on the right shoulder.
  ctx.fillStyle = 'rgba(25,25,28,0.7)';
  for (let y = 0; y < H; y += 0.3 * pyPerM) {
    ctx.fillRect(px(-LANES_HALF_WIDTH - 0.35), y, 0.4 * pxPerM, 0.12 * pyPerM);
  }
  // Worn paint speckles on the markings.
  speckle(ctx, W, H, 3000, rng, ['rgba(58,60,63,0.8)'], 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Tileable grass/earth detail texture (multiplied with vertex colors). */
export function createGrassTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const S = 256;
  const [canvas, ctx] = makeCanvas(S, S);
  const rng = new Random(99);
  ctx.fillStyle = '#b8b8b8';
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, 9000, rng, ['#a0a0a0', '#c8c8c8', '#9a9a9a', '#d4d4d4', '#aaaaaa'], 2);
  for (let i = 0; i < 1400; i++) {
    ctx.strokeStyle = rng.chance(0.5) ? 'rgba(90,90,90,0.35)' : 'rgba(230,230,230,0.3)';
    ctx.beginPath();
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-2, 2), y - rng.range(2, 6));
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial gradient used for light pools, glows and headlight beams. */
export function createGlowTexture(): THREE.CanvasTexture {
  const S = 128;
  const [canvas, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Headlight beam footprint: bright near the car, fading and widening with distance. */
export function createBeamTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 256;
  const [canvas, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const along = y / (H - 1); // 0 = at the car, 1 = far end
    for (let x = 0; x < W; x++) {
      const across = Math.abs(x / (W - 1) - 0.5) * 2;
      const spread = 0.35 + along * 0.65;
      const lateral = Math.max(0, 1 - Math.pow(across / spread, 2));
      const falloff = Math.pow(1 - along, 1.6) * Math.min(1, along * 8);
      const v = Math.round(255 * lateral * falloff);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
