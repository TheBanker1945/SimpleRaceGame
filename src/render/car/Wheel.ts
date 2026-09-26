import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type RimStyle = 'fiveDouble' | 'tenSpoke' | 'ySpoke' | 'mesh' | 'fiveSpoke' | 'turbine';
export type RimFinish = 'silver' | 'gunmetal' | 'black' | 'bronze' | 'machined';

export interface WheelDesign {
  style: RimStyle;
  finish: RimFinish;
  caliper: number;
  /** Tire section width (m). */
  width: number;
  /** Rim radius as a fraction of the tire radius (low profile ≈ 0.7). */
  rimRatio: number;
  /** How deep the spokes dish in toward the hub (m). */
  dish?: number;
}

const FINISHES: Record<RimFinish, { color: number; metalness: number; roughness: number }> = {
  silver: { color: 0xc9cdd2, metalness: 1, roughness: 0.24 },
  machined: { color: 0xd8dade, metalness: 1, roughness: 0.16 },
  gunmetal: { color: 0x3f4349, metalness: 0.95, roughness: 0.32 },
  black: { color: 0x17181a, metalness: 0.7, roughness: 0.38 },
  bronze: { color: 0x7a5d34, metalness: 1, roughness: 0.3 },
};

/** Materials shared by the four wheels of one car. */
export interface WheelMaterials {
  tire: THREE.Material;
  rim: THREE.Material;
  barrel: THREE.Material;
  disc: THREE.Material;
  caliper: THREE.Material;
  lug: THREE.Material;
}

export function createWheelMaterials(design: WheelDesign): WheelMaterials {
  const f = FINISHES[design.finish];
  return {
    tire: new THREE.MeshStandardMaterial({ color: 0x151516, roughness: 0.88, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: f.color, metalness: f.metalness, roughness: f.roughness }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x3b3e42, metalness: 0.8, roughness: 0.45, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6e7176, metalness: 0.85, roughness: 0.42 }),
    caliper: new THREE.MeshStandardMaterial({ color: design.caliper, metalness: 0.2, roughness: 0.35 }),
    lug: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.2 }),
  };
}

/** Geometry for one wheel (axle along +X, outer face at +X), shared by all four corners. */
export interface WheelGeometry {
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  barrel: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  caliper: THREE.BufferGeometry;
  lugs: THREE.BufferGeometry;
}

type P2 = [number, number];

/** Outline of the window between two spokes (spoke centers at angles a0 < a1, half width sw). */
function spokeWindow(a0: number, a1: number, sw: number, r0: number, r1: number, twist = 0): P2[] | null {
  // Smallest radius where the window has a usable width.
  const span = a1 - a0;
  const rMin = Math.max(r0, (2 * sw + 0.008) / span);
  if (rMin > r1 - 0.012) return null;
  const pts: P2[] = [];
  const N = 6;
  const at = (r: number, side: number): P2 => {
    const a = side < 0 ? a0 + sw / r : a1 - sw / r;
    const t = a + twist * (r - r0);
    return [Math.cos(t) * r, Math.sin(t) * r];
  };
  // Outer arc
  for (let k = 0; k <= N; k++) {
    const aStart = a0 + sw / r1;
    const aEnd = a1 - sw / r1;
    const a = aStart + ((aEnd - aStart) * k) / N + twist * (r1 - r0);
    pts.push([Math.cos(a) * r1, Math.sin(a) * r1]);
  }
  // Down the trailing spoke edge
  for (let k = 1; k < N; k++) pts.push(at(r1 - ((r1 - rMin) * k) / N, 1));
  // Inner arc (rounded)
  const ai = a0 + sw / rMin;
  const bi = a1 - sw / rMin;
  for (let k = 0; k <= 4; k++) {
    const a = bi + ((ai - bi) * k) / 4 + twist * (rMin - r0);
    const r = rMin - Math.sin((k / 4) * Math.PI) * Math.min(0.01, (bi - ai) * rMin * 0.25);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // Up the leading spoke edge
  for (let k = 1; k < N; k++) pts.push(at(rMin + ((r1 - rMin) * k) / N, -1));
  return pts;
}

function rimWindows(style: RimStyle, rHub: number, rIn: number): P2[][] {
  const out: P2[][] = [];
  const push = (w: P2[] | null): void => {
    if (w) out.push(w);
  };
  const TAU = Math.PI * 2;
  switch (style) {
    case 'fiveSpoke':
      for (let i = 0; i < 5; i++) push(spokeWindow((i * TAU) / 5, ((i + 1) * TAU) / 5, 0.032, rHub, rIn));
      break;
    case 'tenSpoke':
      for (let i = 0; i < 10; i++) push(spokeWindow((i * TAU) / 10, ((i + 1) * TAU) / 10, 0.011, rHub, rIn));
      break;
    case 'turbine':
      for (let i = 0; i < 14; i++) push(spokeWindow((i * TAU) / 14, ((i + 1) * TAU) / 14, 0.008, rHub, rIn, 2.2));
      break;
    case 'fiveDouble': {
      const pair = 0.13;
      const centers: number[] = [];
      for (let i = 0; i < 5; i++) centers.push((i * TAU) / 5 - pair, (i * TAU) / 5 + pair);
      for (let i = 0; i < centers.length; i++) {
        const a0 = centers[i];
        const a1 = i + 1 < centers.length ? centers[i + 1] : centers[0] + TAU;
        push(spokeWindow(a0, a1, 0.011, rHub, rIn));
      }
      break;
    }
    case 'ySpoke': {
      // Five spokes that fork near the rim.
      const fork = 0.17;
      const rFork = rHub + (rIn - rHub) * 0.45;
      for (let i = 0; i < 5; i++) {
        const c = (i * TAU) / 5;
        push(spokeWindow(c + fork, c + TAU / 5 - fork, 0.013, rHub, rIn));
        push(spokeWindow(c - fork, c + fork, 0.012, rFork, rIn));
      }
      break;
    }
    case 'mesh': {
      const rMid = rHub + (rIn - rHub) * 0.52;
      for (let i = 0; i < 10; i++) {
        push(spokeWindow((i * TAU) / 10, ((i + 1) * TAU) / 10, 0.009, rHub, rMid - 0.009));
      }
      for (let i = 0; i < 20; i++) {
        const o = TAU / 40;
        push(spokeWindow((i * TAU) / 20 + o, ((i + 1) * TAU) / 20 + o, 0.006, rMid + 0.009, rIn));
      }
      break;
    }
  }
  return out;
}

export function buildWheelGeometry(radius: number, design: WheelDesign): WheelGeometry {
  const R = radius;
  const w = design.width;
  const Rr = R * design.rimRatio;
  const h = R - Rr;

  // ------------------------------------------------------------------ tire
  const prof: THREE.Vector2[] = [];
  const hw = w / 2;
  const side = (s: number): void => {
    // s = -1 inner, +1 outer; walk from the bead to the tread edge.
    const pts: P2[] = [
      [Rr - 0.004, s * (hw - 0.014)],
      [Rr + h * 0.18, s * (hw + 0.001)],
      [Rr + h * 0.45, s * (hw + 0.006)],
      [Rr + h * 0.72, s * (hw + 0.002)],
      [R - 0.016, s * (hw - 0.008)],
      [R - 0.004, s * (hw - 0.024)],
      [R, s * (hw - 0.04)],
    ];
    if (s > 0) pts.reverse();
    for (const [r, y] of pts) prof.push(new THREE.Vector2(r, y));
  };
  side(-1);
  // Tread with four circumferential grooves.
  const grooves = [-0.24, 0.24];
  for (const g of grooves) {
    const y = g * (w - 0.08);
    prof.push(new THREE.Vector2(R, y - 0.008), new THREE.Vector2(R - 0.007, y - 0.005), new THREE.Vector2(R - 0.007, y + 0.005), new THREE.Vector2(R, y + 0.008));
  }
  side(1);
  const tire = new THREE.LatheGeometry(prof, 44);
  tire.rotateZ(-Math.PI / 2);
  tire.computeVertexNormals();

  // --------------------------------------------------------------- rim face
  const rIn = Rr - 0.016;
  const rHub = R * 0.2;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rIn + 0.006, 0, Math.PI * 2, false);
  for (const win of rimWindows(design.style, rHub, rIn)) {
    const hole = new THREE.Path();
    hole.moveTo(win[0][0], win[0][1]);
    for (let k = 1; k < win.length; k++) hole.lineTo(win[k][0], win[k][1]);
    hole.closePath();
    shape.holes.push(hole);
  }
  // Center bore for the cap.
  const bore = new THREE.Path();
  bore.absarc(0, 0, R * 0.07, 0, Math.PI * 2, true);
  shape.holes.push(bore);
  const face = new THREE.ExtrudeGeometry(shape, {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.004,
    bevelSegments: 1,
    curveSegments: 28,
  });
  // Dish: the spokes sink toward the hub.
  const dish = design.dish ?? 0.035;
  const fp = face.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < fp.count; i++) {
    const r = Math.hypot(fp.getX(i), fp.getY(i));
    fp.setZ(i, fp.getZ(i) - dish * Math.pow(1 - Math.min(1, r / rIn), 1.6));
  }
  face.computeVertexNormals();
  face.rotateY(Math.PI / 2);
  face.translate(hw - 0.05, 0, 0);

  // Rim lip ring and center cap.
  const lip = new THREE.TorusGeometry(Rr - 0.006, 0.011, 6, 44);
  lip.rotateY(Math.PI / 2);
  lip.translate(hw - 0.022, 0, 0);
  const cap = new THREE.CylinderGeometry(R * 0.075, R * 0.08, 0.02, 20);
  cap.rotateZ(-Math.PI / 2);
  cap.translate(hw - 0.05 - dish + 0.028, 0, 0);
  const rimParts = [face, lip, cap].map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of rimParts) g.deleteAttribute('uv');
  const rim = mergeGeometries(rimParts, false) as THREE.BufferGeometry;

  // Barrel: seen through the spokes.
  const barrel = new THREE.CylinderGeometry(Rr - 0.018, Rr - 0.018, w - 0.06, 40, 1, true);
  barrel.rotateZ(-Math.PI / 2);
  const barrelBack = new THREE.CircleGeometry(Rr - 0.018, 40);
  barrelBack.rotateY(-Math.PI / 2);
  barrelBack.translate(-(w - 0.06) / 2, 0, 0);
  const barrelMerged = mergeGeometries([barrel.toNonIndexed(), barrelBack.toNonIndexed()], false) as THREE.BufferGeometry;

  // Lug nuts on the hub.
  const lugParts: THREE.BufferGeometry[] = [];
  const lugR = R * 0.13;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 10;
    const lug = new THREE.CylinderGeometry(0.0085, 0.0085, 0.02, 6);
    lug.rotateZ(-Math.PI / 2);
    lug.translate(hw - 0.05 - dish + 0.018, Math.cos(a) * lugR, Math.sin(a) * lugR);
    lugParts.push(lug.toNonIndexed());
  }
  const lugs = mergeGeometries(lugParts, false) as THREE.BufferGeometry;

  // Ventilated disc with a darker hat.
  const discR = Rr - 0.045;
  const disc = new THREE.CylinderGeometry(discR, discR, 0.03, 44, 1, false);
  disc.rotateZ(-Math.PI / 2);
  disc.translate(hw - 0.12, 0, 0);

  // Caliper: an arc-shaped block hugging the disc edge, toward the rear top.
  const cs = new THREE.Shape();
  const c0 = discR - 0.07;
  const c1 = discR + 0.012;
  const span = 0.62;
  cs.absarc(0, 0, c1, -span / 2, span / 2, false);
  cs.absarc(0, 0, c0, span / 2, -span / 2, true);
  const caliper = new THREE.ExtrudeGeometry(cs, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 12 });
  caliper.translate(0, 0, -0.035);
  caliper.rotateY(Math.PI / 2);
  caliper.translate(hw - 0.12, 0, 0);

  return { tire, rim, barrel: barrelMerged, disc, caliper, lugs };
}

/** One wheel: `spin` rotates about X; the caliper stays put (add it to the steering group). */
export function buildWheel(geo: WheelGeometry, mats: WheelMaterials): { spin: THREE.Group; caliper: THREE.Mesh } {
  const spin = new THREE.Group();
  const tire = new THREE.Mesh(geo.tire, mats.tire);
  tire.castShadow = true;
  spin.add(tire);
  spin.add(new THREE.Mesh(geo.rim, mats.rim));
  spin.add(new THREE.Mesh(geo.barrel, mats.barrel));
  spin.add(new THREE.Mesh(geo.disc, mats.disc));
  spin.add(new THREE.Mesh(geo.lugs, mats.lug));
  const caliper = new THREE.Mesh(geo.caliper, mats.caliper);
  return { spin, caliper };
}
