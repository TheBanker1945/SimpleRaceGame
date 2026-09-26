import * as THREE from 'three';
import { CABIN_S_MAX, type Cabin } from './Body.ts';
import type { WindowSpec } from './Design.ts';

/*
 * The glasshouse is one smooth shell; windows, pillars and seals are painted into a
 * texture laid out in (z along the car, s = arc length from the roof centerline).
 * The colour map multiplies the paint colour (white = paint, black = glass), and a second
 * map carries roughness (G) and metalness (B), so glass is mirror-smooth and seals satin.
 * Both sides of the car share the same texture, so the windows are always symmetric.
 */

const TW = 1024;
const TH = 512;

type Region = 'paint' | 'glass' | 'trim' | 'chrome';

const COLOR: Record<Region, string> = { paint: '#ffffff', glass: '#000000', trim: '#0c0c0d', chrome: '#9a9ea3' };
// G = roughness, B = metalness.
const ORM: Record<Region, string> = {
  paint: 'rgb(255,82,140)',
  glass: 'rgb(255,10,40)',
  trim: 'rgb(255,120,30)',
  chrome: 'rgb(255,50,255)',
};

export interface CabinTextures {
  map: THREE.CanvasTexture;
  orm: THREE.CanvasTexture;
}

export function drawCabinMask(cabin: Cabin, spec: WindowSpec): CabinTextures {
  const { zFront, zRear } = cabin.spec;
  const px = (z: number): number => ((z - zRear) / (zFront - zRear)) * TW;
  const py = (s: number): number => (s / CABIN_S_MAX) * TH;
  const mk = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = TW;
    c.height = TH;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    return [c, ctx];
  };
  const [colorCanvas, cc] = mk();
  const [ormCanvas, oc] = mk();
  const both = (fn: (ctx: CanvasRenderingContext2D, region: (r: Region) => void) => void): void => {
    fn(cc, (r) => {
      cc.fillStyle = COLOR[r];
      cc.strokeStyle = COLOR[r];
    });
    fn(oc, (r) => {
      oc.fillStyle = ORM[r];
      oc.strokeStyle = ORM[r];
    });
  };

  const steps = 90;
  const zs = (a: number, b: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) out.push(a + ((b - a) * i) / steps);
    return out;
  };
  const st = (z: number): ReturnType<Cabin['stationAt']> => cabin.stationAt(z);

  /** Polygon path in (z, s). */
  const path = (ctx: CanvasRenderingContext2D, pts: [number, number][]): void => {
    ctx.beginPath();
    pts.forEach(([z, s], i) => (i === 0 ? ctx.moveTo(px(z), py(s)) : ctx.lineTo(px(z), py(s))));
    ctx.closePath();
  };

  const frame: Region = spec.frame === 'chrome' ? 'chrome' : 'trim';
  const seal = 0.012;

  // Base: paint everywhere; optional contrasting roof.
  both((ctx, region) => {
    region('paint');
    ctx.fillRect(0, 0, TW, TH);
    if (spec.roof !== 'paint') {
      region(spec.roof === 'glass' ? 'glass' : 'trim');
      const pts: [number, number][] = [];
      for (const z of zs(spec.rearTop, spec.windshieldTop)) pts.push([z, st(z).sRail + 0.004]);
      pts.push([spec.windshieldTop, 0], [spec.rearTop, 0]);
      path(ctx, pts);
      ctx.fill();
    }
  });

  // Windscreen: from the centerline to the A-pillar, cowl to roof edge.
  const windshield: [number, number][] = [];
  for (const z of zs(spec.windshieldTop, zFront)) windshield.push([z, Math.max(0, st(z).sRail - spec.aPillar)]);
  windshield.push([zFront + 0.2, 0], [spec.windshieldTop, 0]);

  // Side glass: under the rail, above the belt, up to the slanted rear edge.
  const sideFront = spec.sideFront ?? zFront;
  const side: [number, number][] = [];
  const sideTop = (z: number): number => st(z).sRail + spec.aPillar * 0.35 + spec.sideTopInset;
  const sideBottom = (z: number): number => st(z).sBase - spec.belt;
  {
    // The closing segment from the rear-bottom back to the rear-top corner is the slanted C-pillar edge.
    const zTop = spec.sideRearTop;
    const zBot = spec.sideRearBottom;
    // Top edge from the rear-top corner to the front.
    for (const z of zs(zTop, sideFront)) {
      const a = sideTop(z);
      const b = sideBottom(z);
      if (b > a) side.push([z, a]);
    }
    // Bottom edge from the front back to the rear-bottom corner.
    for (const z of zs(sideFront, zBot)) {
      const a = sideTop(z);
      const b = sideBottom(z);
      if (b > a) side.push([z, b]);
    }
  }

  const quarter: [number, number][] = [];
  if (spec.quarter) {
    const q = spec.quarter;
    for (const z of zs(q.zRearTop, q.zFront)) quarter.push([z, sideTop(z)]);
    for (const z of zs(q.zFront, q.zRearBottom)) quarter.push([z, sideBottom(z)]);
  }

  // Rear window: from the centerline to the rail minus the C-pillar margin.
  const rear: [number, number][] = [];
  for (const z of zs(spec.rearBottom, spec.rearTop)) rear.push([z, Math.max(0, st(z).sRail - spec.rearInset)]);
  rear.push([spec.rearTop, 0], [spec.rearBottom, 0]);

  both((ctx, region) => {
    ctx.lineJoin = 'round';
    for (const poly of [windshield, side, quarter, rear]) {
      if (poly.length < 3) continue;
      // Seal: a slightly larger dark outline under the glass.
      region(frame);
      ctx.lineWidth = (seal / CABIN_S_MAX) * TH * 2;
      path(ctx, poly);
      ctx.stroke();
      region('glass');
      path(ctx, poly);
      ctx.fill();
    }
    if (spec.bPillar) {
      region('trim');
      const { z, width } = spec.bPillar;
      const pts: [number, number][] = [
        [z + width / 2, 0],
        [z - width / 2, 0],
        [z - width / 2, sideBottom(z) + 0.01],
        [z + width / 2, sideBottom(z) + 0.01],
      ];
      // Only over the side (below the rail).
      ctx.save();
      path(ctx, [
        [z + width, st(z).sRail + 0.005],
        [z - width, st(z).sRail + 0.005],
        [z - width, st(z).sBase],
        [z + width, st(z).sBase],
      ]);
      ctx.clip();
      path(ctx, pts);
      ctx.fill();
      ctx.restore();
    }
    if (spec.louvres) {
      region('trim');
      for (let z = spec.rearBottom + 0.08; z < spec.rearTop - 0.05; z += 0.07) {
        const s1 = Math.max(0, st(z).sRail - spec.rearInset - 0.03);
        ctx.fillRect(px(z) - 2, 0, 4, py(s1));
      }
    }
  });

  const tex = (canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(canvas);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: tex(colorCanvas, true), orm: tex(ormCanvas, false) };
}
