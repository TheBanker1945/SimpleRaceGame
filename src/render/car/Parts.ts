import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { DetailContext, MaterialKey } from './Design.ts';
import { FRONT, LEFT, REAR, TOP, type Vec2 } from './Decal.ts';

/*
 * Free-standing parts shared by the designs: mirrors, exhausts, wings, splitters,
 * diffusers, wipers and open-cockpit interiors. Everything is in car coordinates.
 */

/**
 * Aero door mirror on the left side (mirrored to the right): a teardrop pod on a slim arm.
 * (x, y, z) is where the arm meets the door top.
 */
export function doorMirror(ctx: DetailContext, z: number, y: number, x: number, scale = 1): void {
  const s = scale;
  // Pod: rounded-rectangle front section, extruded backward with a big bevel, nose tapered.
  const w = 0.17 * s;
  const h = 0.085 * s;
  const shape = new THREE.Shape();
  const r = h * 0.48;
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const depth = 0.07 * s;
  const pod = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.035 * s, bevelSize: 0.012 * s, bevelSegments: 4, curveSegments: 6 });
  // Extrusion runs +z (toward the front); pinch the front bevel into an aero nose.
  const p = pod.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const zz = p.getZ(i);
    if (zz > depth) {
      const t = (zz - depth) / (0.035 * s);
      p.setX(i, p.getX(i) * (1 - 0.35 * t));
      p.setY(i, p.getY(i) * (1 - 0.3 * t));
    }
  }
  pod.computeVertexNormals();
  const cx = x + 0.1 * s + w / 2;
  const cy = y + 0.075 * s;
  pod.translate(cx, cy, z - depth / 2);
  ctx.add(pod, 'paint', true);
  const glass = new THREE.CircleGeometry(0.5, 20);
  glass.scale(w * 0.9, h * 0.82, 1);
  glass.rotateY(Math.PI);
  glass.translate(cx, cy, z - depth / 2 - 0.036 * s);
  ctx.add(glass, 'mirror', true);
  const arm = new RoundedBoxGeometry(0.15 * s, 0.022 * s, 0.05 * s, 2, 0.009 * s);
  arm.rotateZ(0.42);
  arm.translate(x + 0.07 * s, y + 0.035 * s, z);
  ctx.add(arm, 'gloss', true);
}

/** Round (or oval) exhaust tip pointing backward, flush with the rear surface at (x, y). */
export function exhaustTip(ctx: DetailContext, x: number, y: number, rx: number, ry: number, mirror: boolean, len = 0.12): void {
  const hit = ctx.surface(REAR, x, y);
  const zEnd = (hit ? hit.p.z : ctx.body.spec.zRear) - 0.02;
  const outer = new THREE.CylinderGeometry(1, 1, len, 28, 1, true);
  outer.rotateX(Math.PI / 2);
  outer.scale(rx, ry, 1);
  outer.translate(x, y, zEnd + len / 2);
  ctx.add(outer, 'exhaust', mirror);
  const inner = new THREE.CylinderGeometry(1, 1, len * 0.9, 28, 1, true);
  inner.rotateX(Math.PI / 2);
  inner.scale(rx * 0.86, ry * 0.86, 1);
  inner.translate(x, y, zEnd + len * 0.45);
  // Inner wall faces inward.
  const idx = inner.getIndex();
  if (idx) {
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
  }
  inner.computeVertexNormals();
  ctx.add(inner, 'exhaust', mirror);
  const rim = new THREE.RingGeometry(0.86, 1, 28, 1);
  rim.scale(rx, ry, 1);
  rim.rotateY(Math.PI);
  rim.translate(x, y, zEnd);
  ctx.add(rim, 'exhaust', mirror);
  const back = new THREE.CircleGeometry(1, 28);
  back.scale(rx * 0.86, ry * 0.86, 1);
  back.rotateY(Math.PI);
  back.translate(x, y, zEnd + len * 0.85);
  ctx.add(back, 'exhaustInner', mirror);
}

/** Symmetric airfoil section (chord along +x of the shape, thickness along y). */
function airfoil(chord: number, thickness: number, camber = 0.04): THREE.Shape {
  const shape = new THREE.Shape();
  const N = 18;
  const upper: Vec2[] = [];
  const lower: Vec2[] = [];
  for (let i = 0; i <= N; i++) {
    const x = (1 - Math.cos((i / N) * Math.PI)) / 2;
    const t = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const c = camber * 4 * x * (1 - x);
    upper.push([x * chord, (c + t) * chord]);
    lower.push([x * chord, (c - t) * chord]);
  }
  shape.moveTo(upper[0][0], upper[0][1]);
  for (const [a, b] of upper.slice(1)) shape.lineTo(a, b);
  for (const [a, b] of lower.reverse().slice(1)) shape.lineTo(a, b);
  shape.closePath();
  return shape;
}

export interface WingSpec {
  /** Leading edge z and height. */
  z: number;
  y: number;
  span: number;
  chord: number;
  /** Angle of attack (rad, + = trailing edge up). */
  angle: number;
  /** Struts from the deck: x positions (left side, mirrored). */
  struts?: number[];
  endplates?: boolean;
  material?: 'carbon' | 'paint' | 'gloss';
}

export function rearWing(ctx: DetailContext, w: WingSpec): void {
  const shape = airfoil(w.chord, 0.12, -0.05);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: w.span, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 8 });
  blade.translate(0, 0, -w.span / 2);
  // Trailing edge up = inverted airfoil producing downforce.
  blade.rotateZ(w.angle);
  blade.rotateY(Math.PI / 2);
  blade.translate(0, w.y, w.z);
  ctx.add(blade, w.material ?? 'carbon');
  if (w.endplates) {
    const plate = new RoundedBoxGeometry(0.012, 0.14, w.chord * 1.15, 2, 0.005);
    plate.translate(w.span / 2 + 0.006, w.y - 0.01, w.z - w.chord * 0.5);
    ctx.add(plate, w.material ?? 'carbon', true);
  }
  for (const x of w.struts ?? []) {
    const hit = ctx.surface(TOP, x, w.z - w.chord * 0.55);
    const base = hit ? hit.p.y : w.y - 0.2;
    const h = w.y - base + 0.01;
    if (h <= 0.01) continue;
    const strut = new RoundedBoxGeometry(0.018, h, w.chord * 0.45, 2, 0.006);
    strut.translate(x, base + h / 2 - 0.005, w.z - w.chord * 0.55);
    ctx.add(strut, 'gloss', true);
  }
}

/** Flat blade under the nose following the plan-view outline, protruding by `lip`. */
export function frontSplitter(ctx: DetailContext, y: number, lip: number, thickness = 0.018, mat: 'carbon' | 'trim' = 'carbon'): void {
  const body = ctx.body;
  const W = body.widthAt(body.spec.zFront - 0.3) * 0.94;
  const pts: Vec2[] = [];
  const back = body.spec.zFront - 0.45;
  pts.push([-W, back]);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const x = -W + (2 * W * i) / steps;
    // Find the front surface at this x just above the splitter height.
    const hit = ctx.surface(FRONT, x, y + 0.03);
    const z = hit ? hit.p.z : back;
    pts.push([x, Math.max(back + 0.05, z + lip)]);
  }
  pts.push([W, back]);
  const shape = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
  // Shape (x, z) → XZ plane: rotate so the shape's y becomes +z and the extrusion goes down.
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y, 0);
  ctx.add(geo, mat);
}

/**
 * Rear diffuser strakes: vertical plates under the rising floor. Their top edge follows the
 * underside, the bottom edge stays at flat-floor height, so they read as fins in the tunnel.
 */
export function diffuser(ctx: DetailContext, width: number, fins: number, length = 0.55): void {
  const body = ctx.body;
  const zBack = body.spec.zRear;
  const zFront = zBack + length;
  const flat = body.bottomAt(zFront + 0.3) + 0.01;
  const top = body.spec.diffuserTop ?? flat + 0.2;
  // The strakes end where the rising floor meets the top of the diffuser.
  let zEnd = zBack;
  while (zEnd < zFront && body.bottomAt(zEnd) > top) zEnd += 0.005;
  for (let i = 0; i < fins; i++) {
    const x = -width / 2 + (width * (i + 0.5)) / fins;
    const pts: THREE.Vector2[] = [];
    const steps = 12;
    // Plate outline in (z, y): along the floor from front to back, then back along the lower edge.
    for (let k = 0; k <= steps; k++) {
      const z = zFront - (zFront - zEnd) * (k / steps);
      pts.push(new THREE.Vector2(z, body.bottomAt(z) + 0.012));
    }
    pts.push(new THREE.Vector2(zEnd, flat + (top - flat) * 0.3), new THREE.Vector2(zFront, flat));
    const fin = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.012, bevelEnabled: false });
    // rotateY(-90°): shape x → car z, extrusion (0..0.012) → car -x.
    fin.rotateY(-Math.PI / 2);
    fin.translate(x + 0.006, 0, 0);
    ctx.add(fin, 'gloss');
  }
}

/** Two wiper blades lying at the base of the windscreen. */
export function wipers(ctx: DetailContext, z: number, y: number, length: number): void {
  for (const [x, ang] of [
    [0.05, 0.12],
    [-0.52, 0.08],
  ] as const) {
    const arm = new THREE.BoxGeometry(length, 0.012, 0.02);
    arm.translate(length / 2, 0, 0);
    arm.rotateY(ang);
    arm.translate(x, y, z);
    ctx.add(arm, 'trim');
  }
}

/** Open-cockpit interior: seats with headrests, dashboard and steering wheel. */
export function cockpit(ctx: DetailContext, opts: { zDash: number; zSeat: number; floorY: number; dashY: number; seatX: number }): void {
  const { zDash, zSeat, floorY, dashY, seatX } = opts;
  for (const sx of [1, -1]) {
    const x = sx * seatX;
    const cushion = new RoundedBoxGeometry(0.46, 0.12, 0.5, 3, 0.05);
    cushion.translate(x, floorY + 0.12, zSeat + 0.1);
    ctx.add(cushion, 'seat');
    const back = new RoundedBoxGeometry(0.46, 0.5, 0.12, 3, 0.05);
    back.rotateX(-0.28);
    back.translate(x, floorY + 0.4, zSeat - 0.2);
    ctx.add(back, 'seat');
    const bolster = new RoundedBoxGeometry(0.07, 0.4, 0.13, 2, 0.03);
    for (const bx of [-0.2, 0.2]) {
      const g = bolster.clone();
      g.rotateX(-0.28);
      g.translate(x + bx, floorY + 0.38, zSeat - 0.16);
      ctx.add(g, 'seat');
    }
    const head = new RoundedBoxGeometry(0.26, 0.2, 0.1, 3, 0.04);
    head.rotateX(-0.2);
    head.translate(x, floorY + 0.68, zSeat - 0.3);
    ctx.add(head, 'seat');
  }
  const dash = new RoundedBoxGeometry(1.36, 0.16, 0.34, 3, 0.05);
  dash.translate(0, dashY, zDash);
  ctx.add(dash, 'interior');
  const hood = new RoundedBoxGeometry(0.36, 0.06, 0.18, 2, 0.025);
  hood.translate(seatX, dashY + 0.09, zDash - 0.04);
  ctx.add(hood, 'interior');
  const wheel = new THREE.TorusGeometry(0.17, 0.018, 8, 28);
  wheel.rotateX(-0.45);
  wheel.translate(seatX, dashY - 0.03, zDash - 0.3);
  ctx.add(wheel, 'trim');
  const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12);
  hub.rotateX(Math.PI / 2 - 0.45);
  hub.translate(seatX, dashY - 0.03, zDash - 0.28);
  ctx.add(hub, 'trim');
  const tunnel = new RoundedBoxGeometry(0.24, 0.22, 0.9, 3, 0.05);
  tunnel.translate(0, floorY + 0.1, zDash - 0.55);
  ctx.add(tunnel, 'interior');
}

/** Side-view helper: a strip along the body side following (z, y) points (left side, mirrored). */
export function sideLine(ctx: DetailContext, pts: Vec2[], width: number, mat: MaterialKey = 'dark'): void {
  if (pts.length < 2) return;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    left.push([p[0] - dy * (width / 2), p[1] + dx * (width / 2)]);
    right.push([p[0] + dy * (width / 2), p[1] - dx * (width / 2)]);
  }
  ctx.decal(LEFT, [...left, ...right.reverse()], mat, { mirror: true, offset: 0.0015, maxEdge: 0.03 });
}

/**
 * Open-car windscreen: a curved, raked glass panel with a painted frame.
 * The glass bends back at the sides (wrap) and follows `zBase`→`zTop` in side view.
 */
export function roadsterWindshield(
  ctx: DetailContext,
  opts: { zBase: number; yBase: number; zTop: number; yTop: number; halfWidth: number; wrap: number },
): void {
  const { zBase, yBase, zTop, yTop, halfWidth, wrap } = opts;
  const cols = 16;
  const rows = 8;
  const point = (u: number, v: number): THREE.Vector3 => {
    // u: -1..1 across, v: 0..1 bottom to top.
    const x = u * halfWidth * (1 - 0.1 * v);
    const back = wrap * u * u;
    const z = zBase + (zTop - zBase) * v - back;
    const y = yBase + (yTop - yBase) * v + 0.03 * Math.sin(v * Math.PI);
    return new THREE.Vector3(x, y, z);
  };
  const pos: number[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const u0 = -1 + (2 * i) / cols;
      const u1 = -1 + (2 * (i + 1)) / cols;
      const v0 = j / rows;
      const v1 = (j + 1) / rows;
      const a = point(u0, v0);
      const b = point(u1, v0);
      const c = point(u1, v1);
      const d = point(u0, v1);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    }
  }
  const glass = new THREE.BufferGeometry();
  glass.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  glass.computeVertexNormals();
  ctx.add(glass, 'glass');
  // Frame: header across the top and the two A-pillars.
  const header: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) header.push(point(-1 + i / 10, 1));
  ctx.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(header), 30, 0.018, 6, false), 'gloss');
  for (const u of [-1, 1]) {
    const pillar: THREE.Vector3[] = [];
    for (let j = 0; j <= 6; j++) pillar.push(point(u, j / 6));
    ctx.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pillar), 12, 0.022, 6, false), 'paint');
  }
}

/** Roll hoops behind the seats (left side at x, mirrored). */
export function rollHoop(ctx: DetailContext, x: number, z: number, yBase: number, height: number, width: number): void {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI * (i / 16);
    pts.push(new THREE.Vector3(x + Math.cos(a) * width * 0.5, yBase + Math.sin(a) * height, z - Math.sin(a) * 0.05));
  }
  ctx.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.02, 8, false), 'chrome', true);
}

/** Streamlined humps on the rear deck behind the headrests (left side, mirrored). */
export function headrestFairing(ctx: DetailContext, x: number, zFront: number, zRear: number, width: number, height: number): void {
  const hit = ctx.surface(TOP, x, (zFront + zRear) / 2);
  const base = hit ? hit.p.y : 0.85;
  const len = zFront - zRear;
  const g = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  // Teardrop: fuller at the front, tapering backward.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const zz = p.getZ(i);
    const taper = zz < 0 ? 1 + zz * 0.55 : 1;
    p.setX(i, p.getX(i) * taper);
    p.setY(i, p.getY(i) * taper);
  }
  g.scale(width / 2, height, len / 2);
  g.computeVertexNormals();
  g.translate(x, base - 0.02, (zFront + zRear) / 2);
  ctx.add(g, 'paint', true);
}
