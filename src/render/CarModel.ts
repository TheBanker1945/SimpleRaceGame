import * as THREE from 'three';
import type { VehicleConfig } from '../vehicle/VehicleConfig.ts';

/** Build parameters for the procedural sports sedan. */
export interface CarModelOptions {
  paint: number;
  /** Adds real spotlights for the headlights (player car only). */
  withHeadlightLights: boolean;
}

interface WheelRig {
  /** Positioned at the hub, moves up/down with suspension. */
  mount: THREE.Group;
  /** Rotates around Y for steering (front only). */
  steer: THREE.Group;
  /** Rotates around X for wheel spin. */
  spin: THREE.Group;
  baseY: number;
}

/**
 * Procedural low-poly sports sedan. Built facing +Z with its origin on the ground
 * under the center of gravity, so it can be driven directly by the physics state.
 *
 * Hierarchy: root → body (pitch/roll/heave from the suspension) + four wheel rigs
 * that stay on the road, so suspension travel is visible in the wheel arches.
 */
export class CarModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  private readonly wheels: WheelRig[] = [];
  private readonly brakeLightMat: THREE.MeshStandardMaterial;
  private readonly reverseLightMat: THREE.MeshStandardMaterial;
  private readonly headLightMat: THREE.MeshStandardMaterial;
  readonly paintMaterial: THREE.MeshPhysicalMaterial;
  private readonly spotLights: THREE.SpotLight[] = [];
  private headlightsOn = false;

  constructor(cfg: VehicleConfig, options: CarModelOptions) {
    const a = cfg.cgToFront;
    const b = cfg.wheelbase - a;
    const R = cfg.wheelRadius;
    const width = cfg.halfWidth * 2 - 0.02;
    // The extrude bevel grows the outline by ~0.07 m, so the profile is drawn slightly inside the box.
    const front = cfg.halfLength - 0.08;
    const rear = -cfg.halfLength + 0.08;

    this.paintMaterial = new THREE.MeshPhysicalMaterial({
      color: options.paint,
      metalness: 0.55,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.2 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c1218,
      metalness: 0.2,
      roughness: 0.05,
      transparent: true,
      opacity: 0.88,
      clearcoat: 1,
    });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 1, roughness: 0.18 });
    this.headLightMat = new THREE.MeshStandardMaterial({
      color: 0xe8f0ff,
      emissive: 0xdde8ff,
      emissiveIntensity: 0.25,
      roughness: 0.1,
      metalness: 0.3,
    });
    this.brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0x550508,
      emissive: 0xff1010,
      emissiveIntensity: 0.35,
      roughness: 0.3,
    });
    this.reverseLightMat = new THREE.MeshStandardMaterial({
      color: 0xdddddd,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.3,
    });

    // ----------------------------------------------------------- lower body
    const archR = R + 0.13;
    const side = new THREE.Shape();
    side.moveTo(rear + 0.06, 0.26);
    side.lineTo(-b - archR - 0.02, 0.26);
    side.absarc(-b, R + 0.01, archR, Math.PI, 0, true);
    side.lineTo(a - archR, 0.22);
    side.absarc(a, R + 0.01, archR, Math.PI, 0, true);
    side.lineTo(front - 0.12, 0.24);
    side.quadraticCurveTo(front + 0.02, 0.26, front, 0.44);
    side.quadraticCurveTo(front - 0.02, 0.62, front - 0.28, 0.7);
    side.lineTo(a - 0.2, 0.84);
    side.lineTo(0.85, 0.9);
    side.lineTo(-1.62, 0.93);
    side.quadraticCurveTo(rear + 0.22, 0.94, rear + 0.05, 0.9);
    side.quadraticCurveTo(rear - 0.02, 0.62, rear + 0.06, 0.26);
    const bodyGeo = new THREE.ExtrudeGeometry(side, {
      depth: width - 0.16,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.07,
      bevelSegments: 3,
      curveSegments: 12,
    });
    // The shape's X becomes the car's forward axis (+Z) and the extrusion becomes its width (X).
    bodyGeo.rotateY(-Math.PI / 2);
    bodyGeo.translate((width - 0.16) / 2, 0, 0);
    shapeBody(bodyGeo, width / 2, front, rear);
    bodyGeo.computeVertexNormals();
    const bodyMesh = new THREE.Mesh(bodyGeo, this.paintMaterial);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.body.add(bodyMesh);

    // Dark wheel wells hide the see-through gap above the tires.
    for (const z of [a, -b]) {
      const well = new THREE.Mesh(new THREE.BoxGeometry(width - 0.62, 0.36, archR * 2 - 0.2), trimMat);
      well.position.set(0, 0.62, z);
      this.body.add(well);
    }

    // ------------------------------------------------------------- greenhouse
    const cabin = new THREE.Shape();
    cabin.moveTo(0.95, 0.86);
    cabin.quadraticCurveTo(0.45, 1.2, 0.12, 1.3);
    cabin.lineTo(-0.85, 1.31);
    cabin.quadraticCurveTo(-1.35, 1.22, -1.72, 0.92);
    cabin.lineTo(0.95, 0.86);
    const cabinWidth = width - 0.34;
    const cabinGeo = new THREE.ExtrudeGeometry(cabin, {
      depth: cabinWidth,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 2,
      curveSegments: 10,
    });
    cabinGeo.rotateY(-Math.PI / 2);
    cabinGeo.translate(cabinWidth / 2, 0, 0);
    // Tumblehome: glasshouse narrows toward the roof.
    taperByHeight(cabinGeo, 0.9, 1.32, 0.8);
    cabinGeo.computeVertexNormals();
    const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
    cabinMesh.castShadow = true;
    this.body.add(cabinMesh);

    // Roof panel and pillars in body color.
    const roofGeo = new THREE.BoxGeometry(cabinWidth * 0.8, 0.05, 0.98, 4, 1, 4);
    bulgeTop(roofGeo, 0.03);
    const roof = new THREE.Mesh(roofGeo, this.paintMaterial);
    roof.position.set(0, 1.325, -0.36);
    roof.castShadow = true;
    this.body.add(roof);
    for (const sx of [-1, 1]) {
      const aPillar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.62, 0.08), this.paintMaterial);
      aPillar.position.set(sx * (cabinWidth / 2 - 0.02) * 0.9, 1.08, 0.53);
      aPillar.rotation.x = -0.95;
      aPillar.rotation.z = sx * 0.12;
      this.body.add(aPillar);
      const cPillar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.34), this.paintMaterial);
      cPillar.position.set(sx * (cabinWidth / 2 - 0.02) * 0.9, 1.1, -1.18);
      cPillar.rotation.x = 0.75;
      cPillar.rotation.z = -sx * 0.12;
      this.body.add(cPillar);
      // Mirrors
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.12), this.paintMaterial);
      mirror.position.set(sx * (width / 2 + 0.04), 0.98, 0.62);
      this.body.add(mirror);
      const mirrorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.07), chromeMat);
      mirrorGlass.position.set(sx * (width / 2 + 0.05), 0.98, 0.555);
      mirrorGlass.rotation.y = Math.PI;
      this.body.add(mirrorGlass);
      // Side skirt
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, a + b - archR * 2 - 0.1), trimMat);
      skirt.position.set(sx * (width / 2 - 0.01), 0.27, (a - b) / 2);
      this.body.add(skirt);
    }

    // ------------------------------------------------------------ front end
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.16), this.headLightMat);
      lamp.position.set(sx * (width / 2 - 0.3), 0.66, front - 0.2);
      lamp.rotation.x = -0.35;
      lamp.rotation.y = sx * 0.2;
      this.body.add(lamp);
      const drl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.05), this.headLightMat);
      drl.position.set(sx * (width / 2 - 0.3), 0.6, front - 0.08);
      this.body.add(drl);
    }
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.08), trimMat);
    grille.position.set(0, 0.42, front - 0.02);
    this.body.add(grille);
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.04, 0.2), trimMat);
    splitter.position.set(0, 0.2, front - 0.08);
    this.body.add(splitter);
    for (const sx of [-1, 1]) {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), trimMat);
      intake.position.set(sx * 0.62, 0.34, front - 0.02);
      this.body.add(intake);
    }

    // ------------------------------------------------------------- rear end
    for (const sx of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.06), this.brakeLightMat);
      tail.position.set(sx * (width / 2 - 0.3), 0.8, rear + 0.02);
      this.body.add(tail);
      const rev = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.05), this.reverseLightMat);
      rev.position.set(sx * 0.35, 0.8, rear + 0.02);
      this.body.add(rev);
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.14, 12), chromeMat);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(sx * 0.5, 0.26, rear - 0.02);
      this.body.add(exhaust);
    }
    const centerTail = new THREE.Mesh(new THREE.BoxGeometry(width - 0.6, 0.025, 0.05), this.brakeLightMat);
    centerTail.position.set(0, 0.83, rear + 0.03);
    this.body.add(centerTail);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, 0.1, 0.2), trimMat);
    diffuser.position.set(0, 0.25, rear + 0.1);
    this.body.add(diffuser);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, 0.03, 0.2), this.paintMaterial);
    spoiler.position.set(0, 0.97, rear + 0.15);
    spoiler.rotation.x = 0.12;
    this.body.add(spoiler);

    // --------------------------------------------------------------- wheels
    const tireGeo = new THREE.CylinderGeometry(R, R, 0.25, 28, 1);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
    const rimGeo = new THREE.CylinderGeometry(R * 0.66, R * 0.66, 0.26, 20, 1);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.3 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.5 });
    const spokeGeo = new THREE.BoxGeometry(0.03, R * 1.2, 0.06);
    const discGeo = new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.04, 18);
    discGeo.rotateZ(Math.PI / 2);
    const discMat = new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.8, roughness: 0.45 });
    const caliperMat = new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.4 });

    const positions: [number, number, boolean][] = [
      [cfg.trackFront / 2, a, true],
      [-cfg.trackFront / 2, a, true],
      [cfg.trackRear / 2, -b, false],
      [-cfg.trackRear / 2, -b, false],
    ];
    for (const [x, z, isFront] of positions) {
      const mount = new THREE.Group();
      mount.position.set(x, R, z);
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      const outward = Math.sign(x);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      spin.add(tire);
      const rim = new THREE.Mesh(rimGeo, hubMat);
      spin.add(rim);
      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(spokeGeo, rimMat);
        spoke.rotation.x = (i / 5) * Math.PI;
        spoke.position.x = outward * 0.11;
        spin.add(spoke);
      }
      const lip = new THREE.Mesh(new THREE.TorusGeometry(R * 0.66, 0.018, 6, 24), rimMat);
      lip.rotation.y = Math.PI / 2;
      lip.position.x = outward * 0.125;
      spin.add(lip);
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.x = outward * 0.02;
      steer.add(disc);
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.12), caliperMat);
      caliper.position.set(outward * 0.05, 0.08, isFront ? -0.14 : 0.14);
      steer.add(caliper);
      steer.add(spin);
      mount.add(steer);
      this.root.add(mount);
      this.wheels.push({ mount, steer, spin, baseY: R });
    }

    this.root.add(this.body);

    if (options.withHeadlightLights) {
      for (const sx of [-1, 1]) {
        const spot = new THREE.SpotLight(0xfff4e0, 0, 140, 0.42, 0.55, 1.2);
        spot.position.set(sx * 0.6, 0.66, front - 0.1);
        spot.target.position.set(sx * 1.2, -0.6, front + 25);
        spot.castShadow = false;
        this.body.add(spot);
        this.body.add(spot.target);
        this.spotLights.push(spot);
      }
    }
  }

  /** Applies suspension, steering and wheel spin from the physics state. */
  updateDynamics(
    pitch: number,
    roll: number,
    heave: number,
    steerAngle: number,
    wheelSpin: readonly number[],
    compression: readonly number[],
  ): void {
    this.body.rotation.order = 'YXZ';
    this.body.rotation.x = pitch;
    this.body.rotation.z = roll;
    this.body.position.y = heave;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      // Wheels stay on the road; only a little of the body motion reaches them.
      w.mount.position.y = w.baseY + Math.max(-0.05, Math.min(0.05, compression[i] * 0.25));
      if (i < 2) w.steer.rotation.y = steerAngle;
      w.spin.rotation.x = wheelSpin[i];
    }
  }

  setLights(brake: number, reverse: boolean): void {
    this.brakeLightMat.emissiveIntensity = (this.headlightsOn ? 0.9 : 0.35) + brake * 3.2;
    this.reverseLightMat.emissiveIntensity = reverse ? 2.5 : 0;
  }

  setHeadlights(on: boolean): void {
    this.headlightsOn = on;
    this.headLightMat.emissiveIntensity = on ? 4 : 0.25;
    for (const s of this.spotLights) s.intensity = on ? 90 : 0;
  }

  setPaint(color: number): void {
    this.paintMaterial.color.setHex(color);
  }
}

/** Narrows the body toward the nose/tail and rounds its shoulders. */
function shapeBody(geo: THREE.BufferGeometry, halfWidth: number, front: number, rear: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nose = Math.max(0, (z - (front - 0.9)) / 0.9);
    const tail = Math.max(0, ((rear + 0.7) - z) / 0.7);
    let scale = 1 - 0.1 * nose * nose - 0.06 * tail * tail;
    // Shoulder rounding above the beltline.
    if (y > 0.72) scale *= 1 - (y - 0.72) * 0.35;
    // Hood slopes down toward the edges a little.
    const edge = Math.abs(x) / halfWidth;
    if (y > 0.7) pos.setY(i, y - edge * edge * 0.035);
    pos.setX(i, x * scale);
  }
  pos.needsUpdate = true;
}

function taperByHeight(geo: THREE.BufferGeometry, y0: number, y1: number, topScale: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
    pos.setX(i, pos.getX(i) * (1 - (1 - topScale) * t));
  }
  pos.needsUpdate = true;
}

function bulgeTop(geo: THREE.BufferGeometry, amount: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const bb = geo.boundingBox as THREE.Box3;
  const hx = (bb.max.x - bb.min.x) / 2;
  const hz = (bb.max.z - bb.min.z) / 2;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) <= 0) continue;
    const nx = pos.getX(i) / hx;
    const nz = pos.getZ(i) / hz;
    pos.setY(i, pos.getY(i) + amount * (1 - nx * nx) * (1 - nz * nz));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}
