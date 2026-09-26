import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildTrafficCar } from './TrafficModels.ts';

export type TrafficKind = 'hatch' | 'sedan' | 'suv' | 'van' | 'boxTruck' | 'semi';

export interface TrafficType {
  kind: TrafficKind;
  length: number;
  width: number;
  mass: number;
  /** Desired cruising speed range (km/h). */
  speedMin: number;
  speedMax: number;
  maxAccel: number;
  comfortDecel: number;
  /** Relative spawn weight. */
  weight: number;
  /** Lanes this vehicle may use (0 = fast lane). */
  lanes: number[];
  /** Seconds a lane change takes. */
  laneChangeTime: [number, number];
  paints: number[];
  /** Sound: engine hum base frequency (Hz) and loudness. */
  humFrequency: number;
  loudness: number;
  isTruck: boolean;
}

const CAR_PAINTS = [0xe8e8e8, 0x1b1c1f, 0x8a9096, 0x2b4d8c, 0x7a1a1a, 0xc9c3b5, 0x31543a, 0x5b6f82, 0xd9a21e, 0x3a2b5a, 0xf0f0f0, 0x454a50];

export const TRAFFIC_TYPES: TrafficType[] = [
  {
    kind: 'hatch',
    length: 4.05,
    width: 1.76,
    mass: 1180,
    speedMin: 95,
    speedMax: 128,
    maxAccel: 1.9,
    comfortDecel: 2.6,
    weight: 22,
    lanes: [0, 1, 2, 3],
    laneChangeTime: [2.8, 4.2],
    paints: CAR_PAINTS,
    humFrequency: 95,
    loudness: 0.7,
    isTruck: false,
  },
  {
    kind: 'sedan',
    length: 4.75,
    width: 1.84,
    mass: 1520,
    speedMin: 100,
    speedMax: 142,
    maxAccel: 2.2,
    comfortDecel: 2.8,
    weight: 30,
    lanes: [0, 1, 2, 3],
    laneChangeTime: [2.6, 4],
    paints: CAR_PAINTS,
    humFrequency: 85,
    loudness: 0.75,
    isTruck: false,
  },
  {
    kind: 'suv',
    length: 4.85,
    width: 1.95,
    mass: 2050,
    speedMin: 95,
    speedMax: 135,
    maxAccel: 1.8,
    comfortDecel: 2.6,
    weight: 18,
    lanes: [0, 1, 2, 3],
    laneChangeTime: [3, 4.4],
    paints: CAR_PAINTS,
    humFrequency: 78,
    loudness: 0.85,
    isTruck: false,
  },
  {
    kind: 'van',
    length: 5.4,
    width: 2.02,
    mass: 2700,
    speedMin: 90,
    speedMax: 118,
    maxAccel: 1.4,
    comfortDecel: 2.4,
    weight: 11,
    lanes: [1, 2, 3],
    laneChangeTime: [3.4, 4.8],
    paints: [0xf2f2f0, 0xe4e4e0, 0x9aa1a8, 0x1e3a66, 0xb8b0a0],
    humFrequency: 70,
    loudness: 0.95,
    isTruck: false,
  },
  {
    kind: 'boxTruck',
    length: 8.6,
    width: 2.45,
    mass: 9500,
    speedMin: 80,
    speedMax: 96,
    maxAccel: 0.9,
    comfortDecel: 2.0,
    weight: 8,
    lanes: [1, 2, 3],
    laneChangeTime: [4.5, 6],
    paints: [0xf0f0ee, 0xd23b2b, 0x2a5aa8, 0x2f6b3a, 0xe0b022],
    humFrequency: 52,
    loudness: 1.2,
    isTruck: true,
  },
  {
    kind: 'semi',
    length: 16.5,
    width: 2.55,
    mass: 32000,
    speedMin: 80,
    speedMax: 90,
    maxAccel: 0.6,
    comfortDecel: 1.8,
    weight: 9,
    lanes: [2, 3],
    laneChangeTime: [5.5, 7],
    paints: [0xb3201e, 0x1f4f9c, 0xf2f2f2, 0x26292c, 0x2e7a45, 0xd6a31c],
    humFrequency: 46,
    loudness: 1.4,
    isTruck: true,
  },
];

/** Geometry for one vehicle type, split by how it is shaded. */
export interface TrafficGeometry {
  /** Painted panels (instance color = paint). */
  body: THREE.BufferGeometry;
  /** Fixed-color parts: glass, tires, trim, trailer (vertex colors). */
  detail: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  signalLeft: THREE.BufferGeometry;
  signalRight: THREE.BufferGeometry;
  /** Local positions of the head/tail lamps for night glows (x, y, z). */
  headLamps: [number, number, number][];
  tailLamps: [number, number, number][];
}

// ------------------------------------------------------------------ helpers

function paintVertices(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const color = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

function plain(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('Traffic geometry merge failed');
  merged.computeBoundingSphere();
  return merged;
}

const box = (w: number, h: number, l: number, x: number, y: number, z: number): THREE.BufferGeometry =>
  new THREE.BoxGeometry(w, h, l).translate(x, y, z);

const rounded = (w: number, h: number, l: number, r: number, x: number, y: number, z: number): THREE.BufferGeometry =>
  new RoundedBoxGeometry(w, h, l, 2, r).translate(x, y, z);

function wheels(radius: number, width: number, track: number, axles: number[]): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const z of axles) {
    for (const side of [-1, 1]) {
      const tire = new THREE.CylinderGeometry(radius, radius, width, 14).rotateZ(Math.PI / 2).translate((side * track) / 2, radius, z);
      out.push(paintVertices(tire, 0x151515));
      const hub = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 10)
        .rotateZ(Math.PI / 2)
        .translate((side * track) / 2, radius, z);
      out.push(paintVertices(hub, 0x8c9095));
    }
  }
  return out;
}

interface LampSet {
  head: THREE.BufferGeometry[];
  tail: THREE.BufferGeometry[];
  left: THREE.BufferGeometry[];
  right: THREE.BufferGeometry[];
  headLamps: [number, number, number][];
  tailLamps: [number, number, number][];
}

function lamps(width: number, front: number, rear: number, headY: number, tailY: number, lampW = 0.34): LampSet {
  const set: LampSet = { head: [], tail: [], left: [], right: [], headLamps: [], tailLamps: [] };
  const inset = width / 2 - lampW / 2 - 0.06;
  for (const side of [-1, 1]) {
    const x = side * inset;
    set.head.push(plain(box(lampW, 0.12, 0.06, x, headY, front)));
    set.tail.push(plain(box(lampW, 0.12, 0.06, x, tailY, rear)));
    set.headLamps.push([x, headY, front + 0.05]);
    set.tailLamps.push([x, tailY, rear - 0.05]);
    const sig = [
      plain(box(0.12, 0.08, 0.06, side * (width / 2 - 0.08), headY - 0.12, front)),
      plain(box(0.12, 0.08, 0.06, side * (width / 2 - 0.08), tailY + 0.12, rear)),
      plain(box(0.04, 0.06, 0.16, side * (width / 2 + 0.01), headY, front - 0.5)),
    ];
    // +X is the vehicle's left side.
    (side > 0 ? set.left : set.right).push(...sig);
  }
  return set;
}

function finish(body: THREE.BufferGeometry[], detail: THREE.BufferGeometry[], l: LampSet): TrafficGeometry {
  return {
    body: mergeAll(body.map(plain)),
    detail: mergeAll(detail),
    head: mergeAll(l.head),
    tail: mergeAll(l.tail),
    signalLeft: mergeAll(l.left),
    signalRight: mergeAll(l.right),
    headLamps: l.headLamps,
    tailLamps: l.tailLamps,
  };
}

// ------------------------------------------------------------------ builders
// All models face +Z with the origin on the ground at the vehicle center.

function buildVan(t: TrafficType): TrafficGeometry {
  const L = t.length;
  const W = t.width;
  const front = L / 2;
  const rear = -L / 2;
  const ground = 0.28;
  const body: THREE.BufferGeometry[] = [
    rounded(W, 1.95, L - 0.9, 0.12, 0, ground + 0.975, -0.45),
    rounded(W, 0.8, 1.0, 0.15, 0, ground + 0.4, front - 0.5),
  ];
  const detail: THREE.BufferGeometry[] = [
    // Sloped windshield: rotate about its own center, then place it.
    paintVertices(new THREE.BoxGeometry(W * 0.9, 1.05, 0.08).rotateX(-0.35).translate(0, ground + 1.3, front - 0.72), 0x1b232b),
    paintVertices(box(W + 0.01, 0.5, 1.0, 0, ground + 1.45, front - 1.4), 0x1b232b),
    paintVertices(box(W - 0.1, 0.2, 0.12, 0, ground + 0.12, front - 0.02), 0x222426),
    paintVertices(box(W - 0.1, 0.2, 0.12, 0, ground + 0.12, rear + 0.03), 0x222426),
    paintVertices(box(0.44, 0.11, 0.02, 0, ground + 0.5, rear - 0.01), 0xe6e6de),
  ];
  detail.push(...wheels(0.36, 0.24, W - 0.26, [L / 2 - 0.95, -L / 2 + 1.05]));
  return finish(body, detail, lamps(W, front + 0.005, rear - 0.005, ground + 0.62, ground + 0.9));
}

function buildBoxTruck(t: TrafficType): TrafficGeometry {
  const L = t.length;
  const W = t.width;
  const front = L / 2;
  const rear = -L / 2;
  const ground = 0.4;
  const cabLen = 2.1;
  const body: THREE.BufferGeometry[] = [rounded(W - 0.1, 1.9, cabLen, 0.14, 0, ground + 0.95, front - cabLen / 2)];
  const boxLen = L - cabLen - 0.2;
  const detail: THREE.BufferGeometry[] = [
    paintVertices(rounded(W, 2.7, boxLen, 0.05, 0, ground + 0.3 + 1.35, rear + boxLen / 2), 0xe9e9e6),
    paintVertices(box(W - 0.2, 0.75, 0.06, 0, ground + 1.35, front + 0.005), 0x1b232b),
    paintVertices(box(W - 0.3, 0.3, 0.3, 0, ground + 0.15, rear + 2.5), 0x2a2c2e),
    paintVertices(box(W, 0.25, 0.14, 0, ground + 0.05, front - 0.05), 0x2a2c2e),
    paintVertices(box(W - 0.1, 0.12, 0.1, 0, ground + 0.25, rear + 0.05), 0x7a1c1c),
  ];
  detail.push(...wheels(0.48, 0.3, W - 0.34, [front - 1.2, rear + 1.6]));
  return finish(body, detail, lamps(W - 0.1, front + 0.005, rear - 0.005, ground + 0.45, ground + 0.4, 0.3));
}

function buildSemi(t: TrafficType): TrafficGeometry {
  const L = t.length;
  const W = t.width;
  const front = L / 2;
  const rear = -L / 2;
  const ground = 0.45;
  const cabLen = 2.4;
  const body: THREE.BufferGeometry[] = [
    rounded(W - 0.05, 2.5, cabLen, 0.18, 0, ground + 1.25, front - cabLen / 2),
    rounded(W - 0.25, 0.7, 1.4, 0.2, 0, ground + 2.85, front - 1.2),
  ];
  const trailerLen = L - cabLen - 0.5;
  const detail: THREE.BufferGeometry[] = [
    paintVertices(rounded(W, 2.85, trailerLen, 0.06, 0, ground + 0.75 + 1.425, rear + trailerLen / 2), 0xdcdedf),
    paintVertices(box(W - 0.25, 0.9, 0.06, 0, ground + 1.85, front + 0.005), 0x1b232b),
    paintVertices(box(W - 0.2, 0.55, 0.1, 0, ground + 0.45, front + 0.01), 0x26282a),
    paintVertices(box(1.0, 0.3, 3.2, 0, ground + 0.3, front - cabLen - 1.0), 0x2a2c2e),
    paintVertices(box(W - 0.1, 0.12, 0.1, 0, ground + 0.62, rear + 0.05), 0x7a1c1c),
  ];
  const r = 0.5;
  detail.push(...wheels(r, 0.32, W - 0.36, [front - 1.2, front - cabLen - 0.9, front - cabLen - 2.2, rear + 2.4, rear + 1.1]));
  return finish(body, detail, lamps(W - 0.1, front + 0.005, rear - 0.005, ground + 0.5, ground + 0.7, 0.3));
}

export function buildTrafficGeometry(t: TrafficType): TrafficGeometry {
  switch (t.kind) {
    case 'hatch':
    case 'sedan':
    case 'suv':
      // Cars use the same lofted bodies as the player's cars (see TrafficModels).
      return buildTrafficCar(t);
    case 'van':
      return buildVan(t);
    case 'boxTruck':
      return buildBoxTruck(t);
    case 'semi':
      return buildSemi(t);
  }
}
