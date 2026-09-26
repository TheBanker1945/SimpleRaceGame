import * as THREE from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  return [c, ctx];
}

function repeatTexture(c: HTMLCanvasElement, repeat: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** Twill-weave carbon fibre. */
export function createCarbonTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  ctx.fillStyle = '#16181b';
  ctx.fillRect(0, 0, 64, 64);
  const cell = 8;
  for (let y = 0; y < 64; y += cell) {
    for (let x = 0; x < 64; x += cell) {
      const phase = ((x + y) / cell) % 4 < 2;
      const g = ctx.createLinearGradient(x, y, phase ? x + cell : x, phase ? y : y + cell);
      g.addColorStop(0, '#2a2e33');
      g.addColorStop(0.5, '#3a3f45');
      g.addColorStop(1, '#1d2023');
      ctx.fillStyle = g;
      ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    }
  }
  return repeatTexture(c, 6);
}

/** Honeycomb mesh for intakes and grilles (UVs are in metres / uvScale). */
export function createHoneycombTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#020203';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#2d3136';
  ctx.lineWidth = 3;
  const r = 16;
  const h = Math.sqrt(3) * r;
  for (let row = -1; row < 6; row++) {
    for (let col = -1; col < 6; col++) {
      const cx = col * r * 1.5 * 1.0667;
      const cy = row * h * 0.62 + (col % 2 ? h * 0.31 : 0);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const x = cx + Math.cos(a) * r * 0.62;
        const y = cy + Math.sin(a) * r * 0.62;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  return repeatTexture(c, 1);
}

/** European-style number plate. */
export function createPlateTexture(text: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 56);
  ctx.fillStyle = '#f1f1ea';
  ctx.fillRect(0, 0, 256, 56);
  ctx.fillStyle = '#1f3f9a';
  ctx.fillRect(0, 0, 24, 56);
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 253, 53);
  ctx.fillStyle = '#141414';
  ctx.font = 'bold 36px "DejaVu Sans Mono", Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${text.slice(0, 6)} 1`, 140, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
