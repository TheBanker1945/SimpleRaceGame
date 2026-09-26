import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CarDefinition } from '../vehicle/CarCatalog.ts';
import { Cabin, LowerBody, MAT_DARK, MAT_INTERIOR, MAT_PAINT } from './car/Body.ts';
import { drawCabinMask } from './car/CabinMask.ts';
import { buildDecal, mirrorX, SurfaceProjector, type Frame } from './car/Decal.ts';
import type { DetailContext, MaterialKey } from './car/Design.ts';
import { DESIGNS } from './car/Designs.ts';
import { createCarbonTexture, createHoneycombTexture, createPlateTexture } from './car/DetailTextures.ts';
import { buildWheel, buildWheelGeometry, createWheelMaterials } from './car/Wheel.ts';

/** Build parameters for a procedural car. */
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
 * Procedural sports car built from a design (src/render/car/Designs.ts): a lofted body with
 * real wheel arches, a glasshouse with painted-in windows, surface-hugging lamps, grilles,
 * vents and shut lines, and detailed wheels with brakes. Faces +Z with its origin on the
 * ground under the center of gravity, so it can be driven directly by the physics state.
 *
 * Hierarchy: root → body (pitch/roll/heave from the suspension) + four wheel rigs
 * that stay on the road, so suspension travel is visible in the wheel arches.
 */
export class CarModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly paintMaterial: THREE.MeshPhysicalMaterial;
  /** Hood camera eye and look-at points in body coordinates. */
  readonly hoodEye: THREE.Vector3;
  readonly hoodLook: THREE.Vector3;
  private readonly cabinMaterial: THREE.MeshPhysicalMaterial | null = null;
  private readonly wheels: WheelRig[] = [];
  private readonly brakeLightMat: THREE.MeshStandardMaterial;
  private readonly reverseLightMat: THREE.MeshStandardMaterial;
  private readonly headLightMat: THREE.MeshStandardMaterial;
  private readonly drlMat: THREE.MeshStandardMaterial;
  private readonly spotLights: THREE.SpotLight[] = [];
  private headlightsOn = false;

  constructor(def: CarDefinition, options: CarModelOptions) {
    const cfg = def.config;
    const design = DESIGNS[def.id](cfg);
    const a = cfg.cgToFront;
    const b = cfg.wheelbase - a;
    const R = cfg.wheelRadius;

    this.paintMaterial = new THREE.MeshPhysicalMaterial({
      color: options.paint,
      metalness: 0.55,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
    this.headLightMat = new THREE.MeshStandardMaterial({ color: 0xe8f0ff, emissive: 0xdde8ff, emissiveIntensity: 0.3, roughness: 0.1, metalness: 0.3 });
    this.drlMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, emissive: 0xeef4ff, emissiveIntensity: 1.4, roughness: 0.2 });
    this.brakeLightMat = new THREE.MeshStandardMaterial({ color: 0x550508, emissive: 0xff1010, emissiveIntensity: 0.35, roughness: 0.3 });
    this.reverseLightMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });

    const mats: Record<MaterialKey, THREE.Material> = {
      paint: this.paintMaterial,
      trim: new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.55, metalness: 0.1 }),
      gloss: new THREE.MeshPhysicalMaterial({ color: 0x060607, roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xe2e5ea, roughness: 0.1, metalness: 1 }),
      carbon: new THREE.MeshPhysicalMaterial({ color: 0x9a9ea6, map: createCarbonTexture(), roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
      grille: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, map: createHoneycombTexture(), roughness: 0.6, metalness: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.92 }),
      interior: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.8 }),
      seat: new THREE.MeshStandardMaterial({ color: 0x2b1714, roughness: 0.62 }),
      lampHousing: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.22, metalness: 0.95 }),
      headLamp: this.headLightMat,
      drl: this.drlMat,
      tail: this.brakeLightMat,
      tailLens: new THREE.MeshPhysicalMaterial({ color: 0x2a0305, roughness: 0.1, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }),
      reverse: this.reverseLightMat,
      plate: new THREE.MeshStandardMaterial({ map: createPlateTexture(def.name.split(' ')[0].toUpperCase()), roughness: 0.45 }),
      exhaust: new THREE.MeshStandardMaterial({ color: 0xc4c7cb, roughness: 0.22, metalness: 1 }),
      exhaustInner: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 }),
      mirror: new THREE.MeshStandardMaterial({ color: 0xaab4bf, roughness: 0.04, metalness: 1 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x0d1418,
        roughness: 0.04,
        metalness: 0.1,
        transparent: true,
        opacity: 0.38,
        clearcoat: 1,
        depthWrite: false,
      }),
      amber: new THREE.MeshStandardMaterial({ color: 0x7a4200, emissive: 0xff8a00, emissiveIntensity: 0.15, roughness: 0.2 }),
    };

    // ----------------------------------------------------------- shells
    const body = new LowerBody(design.body);
    const lowerGeo = body.buildGeometry();
    const lowerMats: THREE.Material[] = [];
    lowerMats[MAT_PAINT] = this.paintMaterial;
    lowerMats[MAT_DARK] = mats.dark;
    lowerMats[MAT_INTERIOR] = mats.interior;
    const lowerMesh = new THREE.Mesh(lowerGeo, lowerMats);
    lowerMesh.castShadow = true;
    lowerMesh.receiveShadow = true;
    this.body.add(lowerMesh);

    let cabin: Cabin | null = null;
    let cabinGeo: THREE.BufferGeometry | null = null;
    if (design.cabin && design.windows) {
      cabin = new Cabin(design.cabin, body);
      cabinGeo = cabin.buildGeometry();
      const tex = drawCabinMask(cabin, design.windows);
      this.cabinMaterial = new THREE.MeshPhysicalMaterial({
        color: options.paint,
        map: tex.map,
        roughnessMap: tex.orm,
        metalnessMap: tex.orm,
        roughness: 1,
        metalness: 1,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
      });
      const cabinMesh = new THREE.Mesh(cabinGeo, this.cabinMaterial);
      cabinMesh.castShadow = true;
      this.body.add(cabinMesh);
    }

    // ---------------------------------------------------------- details
    const parts = new Map<MaterialKey, THREE.BufferGeometry[]>();
    const push = (mat: MaterialKey, geo: THREE.BufferGeometry, mirror: boolean): void => {
      const list = parts.get(mat) ?? [];
      const g = normalizeGeometry(geo);
      list.push(g);
      if (mirror) list.push(mirrorX(g));
      parts.set(mat, list);
    };
    const projectors = new Map<Frame, [SurfaceProjector | null, SurfaceProjector | null]>();
    const projector = (frame: Frame, onCabin: boolean): SurfaceProjector => {
      const entry = projectors.get(frame) ?? [null, null];
      const k = onCabin ? 1 : 0;
      if (!entry[k]) entry[k] = new SurfaceProjector(onCabin && cabinGeo ? [lowerGeo, cabinGeo] : [lowerGeo], frame);
      projectors.set(frame, entry);
      return entry[k] as SurfaceProjector;
    };
    const ctx: DetailContext = {
      cfg,
      body,
      cabin,
      zf: a,
      zr: -b,
      R,
      decal: (frame, outline, mat, opts = {}) => {
        const geo = buildDecal(projector(frame, opts.onCabin ?? false), outline, opts);
        if (geo) push(mat, geo, opts.mirror ?? false);
      },
      add: (geo, mat, mirror = false) => push(mat, geo, mirror),
      surface: (frame, sa, sb, onCabin = false) => projector(frame, onCabin).cast(sa, sb),
    };
    design.detail(ctx);
    for (const [key, list] of parts) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mats[key]);
      const lamp = key === 'headLamp' || key === 'drl' || key === 'tail' || key === 'reverse' || key === 'amber' || key === 'glass';
      mesh.castShadow = !lamp;
      mesh.receiveShadow = !lamp;
      if (key === 'glass') mesh.renderOrder = 1;
      this.body.add(mesh);
    }

    // ----------------------------------------------------------- wheels
    const wheelGeo = buildWheelGeometry(R, design.wheels);
    const wheelMats = createWheelMaterials(design.wheels);
    const positions: [number, number, boolean][] = [
      [cfg.trackFront / 2, a, true],
      [-cfg.trackFront / 2, a, true],
      [cfg.trackRear / 2, -b, false],
      [-cfg.trackRear / 2, -b, false],
    ];
    for (const [x, z] of positions) {
      const mount = new THREE.Group();
      mount.position.set(x, R, z);
      const steer = new THREE.Group();
      const side = new THREE.Group();
      // Right-hand wheels are mirror images, so the rim face always points outward.
      if (x < 0) side.scale.x = -1;
      const { spin, caliper } = buildWheel(wheelGeo, wheelMats);
      caliper.rotation.x = 0.65;
      side.add(caliper);
      side.add(spin);
      steer.add(side);
      mount.add(steer);
      this.root.add(mount);
      this.wheels.push({ mount, steer, spin, baseY: R });
    }

    this.root.add(this.body);

    const [hx, hy, hz] = design.headlight;
    if (options.withHeadlightLights) {
      for (const sx of [-1, 1]) {
        const spot = new THREE.SpotLight(0xfff4e0, 0, 140, 0.42, 0.55, 1.2);
        spot.position.set(sx * hx, hy, hz);
        spot.target.position.set(sx * 1.2, -0.6, hz + 25);
        spot.castShadow = false;
        this.body.add(spot);
        this.body.add(spot.target);
        this.spotLights.push(spot);
      }
    }
    this.hoodEye = new THREE.Vector3(...design.hoodCamera);
    this.hoodLook = new THREE.Vector3(0, design.hoodCamera[1] - 0.1, 30);
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

  /**
   * @param on lamps lit (night)
   * @param castLight also light the road with real spot lights (disabled on low quality)
   */
  setHeadlights(on: boolean, castLight = true): void {
    this.headlightsOn = on;
    this.headLightMat.emissiveIntensity = on ? 4 : 0.3;
    this.drlMat.emissiveIntensity = on ? 3 : 1.4;
    for (const s of this.spotLights) {
      s.visible = on && castLight;
      s.intensity = on && castLight ? 90 : 0;
    }
  }

  setPaint(color: number): void {
    this.paintMaterial.color.setHex(color);
    this.cabinMaterial?.color.setHex(color);
  }

  /** Frees GPU resources (geometries, materials, textures). */
  dispose(): void {
    const seen = new Set<unknown>();
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (!seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list as THREE.Material[]) {
        if (seen.has(m)) continue;
        seen.add(m);
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
        m.dispose();
      }
    });
  }
}

/** Non-indexed with position, normal and uv, so any parts can be merged together. */
function normalizeGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  g.clearGroups();
  return g;
}
