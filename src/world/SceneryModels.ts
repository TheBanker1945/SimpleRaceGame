import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../core/Random.ts';

/** Paints a whole geometry one vertex color (so several parts can be merged into one draw call). */
function colored(geo: THREE.BufferGeometry, hex: number, jitter = 0, rng?: Random): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const base = new THREE.Color(hex);
  for (let i = 0; i < count; i += 3) {
    const k = rng && jitter > 0 ? 1 + rng.range(-jitter, jitter) : 1;
    for (let v = 0; v < 3 && i + v < count; v++) {
      colors[(i + v) * 3] = base.r * k;
      colors[(i + v) * 3 + 1] = base.g * k;
      colors[(i + v) * 3 + 2] = base.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('Failed to merge scenery geometry');
  merged.computeVertexNormals();
  return merged;
}

/** Conifer: trunk + three stacked cones. ~8-11 m tall at scale 1. */
export function createPineGeometry(): THREE.BufferGeometry {
  const rng = new Random(7);
  const trunk = colored(new THREE.CylinderGeometry(0.16, 0.24, 2.4, 6).translate(0, 1.2, 0), 0x4a3526);
  const parts = [trunk];
  const tiers: [number, number, number][] = [
    [2.6, 3.6, 2.0],
    [2.0, 3.0, 4.1],
    [1.3, 2.6, 6.0],
  ];
  for (const [r, h, y] of tiers) {
    parts.push(colored(new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0), 0x1f4a2a, 0.12, rng));
  }
  return merge(parts);
}

/** Broadleaf tree: trunk + lumpy icosahedron crown. */
export function createBroadleafGeometry(): THREE.BufferGeometry {
  const rng = new Random(11);
  const trunk = colored(new THREE.CylinderGeometry(0.18, 0.28, 3.2, 6).translate(0, 1.6, 0), 0x55402c);
  const crownGeo = new THREE.IcosahedronGeometry(2.8, 1);
  const pos = crownGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const k = 1 + Math.sin(v.x * 1.7) * 0.12 + Math.cos(v.z * 2.1 + v.y) * 0.12;
    pos.setXYZ(i, v.x * k, v.y * k * 0.85, v.z * k);
  }
  const crown = colored(crownGeo.translate(0, 5.2, 0), 0x3d6b2a, 0.14, rng);
  return merge([trunk, crown]);
}

export function createBushGeometry(): THREE.BufferGeometry {
  const rng = new Random(3);
  const geo = new THREE.IcosahedronGeometry(1, 0);
  geo.scale(1.3, 0.8, 1.2).translate(0, 0.45, 0);
  return merge([colored(geo, 0x3b5e27, 0.15, rng)]);
}

/** Median lamp post: 11 m pole with two arms reaching over both carriageways. */
export function createLampPoleGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.1, 0.16, 11, 8).translate(0, 5.5, 0);
  const base = new THREE.CylinderGeometry(0.28, 0.32, 0.5, 8).translate(0, 0.25, 0);
  const armL = new THREE.CylinderGeometry(0.06, 0.07, 2.8, 6).rotateZ(Math.PI / 2 + 0.12).translate(1.35, 10.9, 0);
  const armR = new THREE.CylinderGeometry(0.06, 0.07, 2.8, 6).rotateZ(Math.PI / 2 - 0.12).translate(-1.35, 10.9, 0);
  const parts = [pole, base, armL, armR].map((g) => colored(g, 0x9aa0a6));
  return merge(parts);
}

/** The two lamp heads of a median post (emissive at night). */
export function createLampHeadGeometry(): THREE.BufferGeometry {
  const left = new THREE.BoxGeometry(0.7, 0.14, 0.32).translate(2.75, 10.72, 0);
  const right = new THREE.BoxGeometry(0.7, 0.14, 0.32).translate(-2.75, 10.72, 0);
  return merge([colored(left, 0xffffff), colored(right, 0xffffff)]);
}

export function createRailPostGeometry(): THREE.BufferGeometry {
  return merge([colored(new THREE.BoxGeometry(0.1, 0.78, 0.16).translate(0, 0.39, 0), 0x8d9296)]);
}

// ------------------------------------------------------------------ sign boards

const PLACES = [
  'Northfield',
  'Lakeview',
  'Harbor City',
  'Pine Ridge',
  'Westbrook',
  'Stonebridge',
  'Redmoor',
  'Ashford Vale',
  'Clearwater',
  'Eastgate',
  'Silverton',
  'Maple Hollow',
];

export function createSignTexture(seed: number, maxAnisotropy: number): THREE.CanvasTexture {
  const rng = new Random(seed);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  ctx.fillStyle = '#0f5a32';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#e8efe9';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 492, 236);
  ctx.fillStyle = '#f4f7f4';
  ctx.textBaseline = 'middle';
  const kind = seed % 3;
  if (kind === 0) {
    const exit = rng.int(12, 98);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(28, 26, 150, 56);
    ctx.fillStyle = '#10301f';
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.fillText(`EXIT ${exit}`, 40, 55);
    ctx.fillStyle = '#f4f7f4';
    ctx.font = 'bold 56px Arial, sans-serif';
    ctx.fillText(rng.pick(PLACES), 32, 138);
    ctx.font = 'bold 44px Arial, sans-serif';
    ctx.fillText(`${rng.int(1, 3)} km  ↗`, 32, 205);
  } else if (kind === 1) {
    ctx.font = 'bold 46px Arial, sans-serif';
    const a = rng.pick(PLACES);
    let b = rng.pick(PLACES);
    if (b === a) b = PLACES[(PLACES.indexOf(a) + 3) % PLACES.length];
    const da = rng.int(8, 40);
    ctx.fillText(a, 32, 80);
    ctx.fillText(b, 32, 170);
    ctx.textAlign = 'right';
    ctx.fillText(`${da}`, 480, 80);
    ctx.fillText(`${da + rng.int(15, 70)}`, 480, 170);
  } else {
    ctx.font = 'bold 50px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(rng.pick(PLACES), 256, 90);
    ctx.font = 'bold 72px Arial, sans-serif';
    ctx.fillText('↑   ↑   ↑   ↑', 256, 180);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Overhead sign gantry spanning the player's carriageway. Built in a local frame
 * where +X points to the left of the road (increasing d) and the origin is on the
 * centerline at road height.
 */
export function createGantry(signs: THREE.Texture[], steel: THREE.Material, fromD: number, toD: number): THREE.Group {
  const group = new THREE.Group();
  const span = toD - fromD;
  const mid = (toD + fromD) / 2;
  for (const d of [fromD, toD]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7.6, 0.35), steel);
    post.position.set(d, 3.8, 0);
    post.castShadow = true;
    group.add(post);
  }
  for (const y of [6.3, 7.4]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.22, 0.22), steel);
    beam.position.set(mid, y, 0);
    beam.castShadow = true;
    group.add(beam);
  }
  const width = 5.2;
  const height = 2.6;
  signs.forEach((tex, i) => {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 0.1),
      [
        steel,
        steel,
        steel,
        steel,
        new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.6 }),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 }),
      ],
    );
    // The textured −Z face looks back at drivers approaching along +Z.
    const d = toD - 3.2 - i * (width + 0.6);
    board.position.set(d, 6.85, -0.2);
    board.castShadow = true;
    group.add(board);
  });
  return group;
}

/**
 * Overpass bridge crossing the whole motorway. Local frame: +X = left of the road,
 * origin on the centerline at road height; the deck runs along X.
 */
export function createOverpass(concrete: THREE.Material, dark: THREE.Material, fromD: number, toD: number): THREE.Group {
  const group = new THREE.Group();
  const length = toD - fromD;
  const mid = (fromD + toD) / 2;
  const deckY = 7.2;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(length, 1.1, 12), concrete);
  deck.position.set(mid, deckY, 0);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  const road = new THREE.Mesh(new THREE.BoxGeometry(length, 0.05, 10.4), dark);
  road.position.set(mid, deckY + 0.58, 0);
  group.add(road);
  for (const z of [-5.8, 5.8]) {
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(length, 0.9, 0.35), concrete);
    parapet.position.set(mid, deckY + 1.0, z);
    parapet.castShadow = true;
    group.add(parapet);
  }
  const girder = new THREE.Mesh(new THREE.BoxGeometry(length, 0.6, 9), dark);
  girder.position.set(mid, deckY - 0.8, 0);
  group.add(girder);
  return group;
}

/** Adds a row of bridge piers at lateral offset d reaching down to `groundY` (local). */
export function addPier(group: THREE.Group, concrete: THREE.Material, d: number, groundY: number): void {
  const top = 6.1;
  const height = top - groundY;
  for (const z of [-3.6, 3.6]) {
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, height, 12), concrete);
    pier.position.set(d, groundY + height / 2, z);
    pier.castShadow = true;
    group.add(pier);
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 10), concrete);
  cap.position.set(d, top + 0.3, 0);
  cap.castShadow = true;
  group.add(cap);
}
