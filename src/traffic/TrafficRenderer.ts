import * as THREE from 'three';
import { createBeamTexture, createGlowTexture } from '../render/Textures.ts';
import { buildTrafficGeometry, TRAFFIC_TYPES, type TrafficGeometry, type TrafficKind } from './TrafficTypes.ts';

/** What the renderer needs to draw one vehicle this frame. */
export interface TrafficVisual {
  kind: TrafficKind;
  position: THREE.Vector3;
  yaw: number;
  /** Nose-down pitch and right-down roll (rad). */
  pitch: number;
  roll: number;
  paint: THREE.Color;
  brake: number;
  signalLeft: boolean;
  signalRight: boolean;
}

interface Batch {
  geo: TrafficGeometry;
  body: THREE.InstancedMesh;
  detail: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
  tail: THREE.InstancedMesh;
  left: THREE.InstancedMesh;
  right: THREE.InstancedMesh;
  count: number;
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpScale = new THREE.Vector3(1, 1, 1);
const tmpPos = new THREE.Vector3();
const tmpLocal = new THREE.Vector3();
const tmpColor = new THREE.Color();
const glowMatrix = new THREE.Matrix4();
const glowScale = new THREE.Vector3();
const beamMatrix = new THREE.Matrix4();

const HEAD_DAY = new THREE.Color(0.62, 0.64, 0.66);
const HEAD_NIGHT = new THREE.Color(1, 1, 0.95);
const TAIL_OFF = new THREE.Color(0.28, 0.02, 0.02);
const TAIL_NIGHT = new THREE.Color(0.75, 0.04, 0.03);
const TAIL_BRAKE = new THREE.Color(1, 0.12, 0.08);
const SIGNAL_ON = new THREE.Color(1, 0.62, 0.05);
const SIGNAL_OFF = new THREE.Color(0.28, 0.16, 0.03);

/**
 * Draws all traffic with instancing: each vehicle type is six instanced meshes
 * (paint, fixed-color details, head/tail lamps, left/right indicators), so the whole
 * traffic stream costs a constant ~40 draw calls. At night, camera-facing glow sprites
 * and headlight footprints on the road are added, also instanced.
 */
export class TrafficRenderer {
  readonly group = new THREE.Group();
  private readonly batches = new Map<TrafficKind, Batch>();
  private readonly glows: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;
  private glowCount = 0;
  private beamCount = 0;
  night = false;

  constructor(capacityPerType: number, maxGlows: number) {
    const paintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.42 });
    const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.55 });
    const lampMat = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    for (const type of TRAFFIC_TYPES) {
      const geo = buildTrafficGeometry(type);
      const make = (g: THREE.BufferGeometry, m: THREE.Material, shadow: boolean): THREE.InstancedMesh => {
        const mesh = new THREE.InstancedMesh(g, m, capacityPerType);
        mesh.count = 0;
        mesh.castShadow = shadow;
        mesh.receiveShadow = shadow;
        // Instances move every frame, so culling per batch would need a new bounding sphere each frame.
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
        return mesh;
      };
      const batch: Batch = {
        geo,
        body: make(geo.body, paintMat, true),
        detail: make(geo.detail, detailMat, true),
        head: make(geo.head, lampMat(), false),
        tail: make(geo.tail, lampMat(), false),
        left: make(geo.signalLeft, lampMat(), false),
        right: make(geo.signalRight, lampMat(), false),
        count: 0,
      };
      for (const m of [batch.body, batch.head, batch.tail, batch.left, batch.right]) {
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacityPerType * 3), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      this.batches.set(type.kind, batch);
    }

    const glowMat = new THREE.MeshBasicMaterial({
      map: createGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: true,
    });
    this.glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMat, maxGlows);
    this.glows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxGlows * 3), 3);
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 2;
    this.glows.count = 0;
    this.group.add(this.glows);

    const beamMat = new THREE.MeshBasicMaterial({
      map: createBeamTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    // Footprint lies on the road, extending 34 m ahead of the lamps.
    const beamGeo = new THREE.PlaneGeometry(9, 34).rotateX(-Math.PI / 2).translate(0, 0.06, 17);
    this.beams = new THREE.InstancedMesh(beamGeo, beamMat, Math.ceil(maxGlows / 2));
    this.beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.ceil(maxGlows / 2) * 3), 3);
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 1;
    this.beams.count = 0;
    this.group.add(this.beams);
  }

  begin(): void {
    for (const b of this.batches.values()) b.count = 0;
    this.glowCount = 0;
    this.beamCount = 0;
  }

  /** Adds one vehicle to this frame's instance buffers. */
  draw(v: TrafficVisual, camera: THREE.Camera, blinkOn: boolean): void {
    const batch = this.batches.get(v.kind);
    if (!batch || batch.count >= batch.body.instanceMatrix.count) return;
    const i = batch.count++;
    tmpEuler.set(v.pitch, v.yaw, v.roll, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpMatrix.compose(v.position, tmpQuat, tmpScale);
    for (const m of [batch.body, batch.detail, batch.head, batch.tail, batch.left, batch.right]) m.setMatrixAt(i, tmpMatrix);
    batch.body.setColorAt(i, v.paint);
    batch.head.setColorAt(i, this.night ? HEAD_NIGHT : HEAD_DAY);
    tmpColor.copy(this.night ? TAIL_NIGHT : TAIL_OFF).lerp(TAIL_BRAKE, Math.min(1, v.brake * 1.5));
    batch.tail.setColorAt(i, tmpColor);
    batch.left.setColorAt(i, v.signalLeft && blinkOn ? SIGNAL_ON : SIGNAL_OFF);
    batch.right.setColorAt(i, v.signalRight && blinkOn ? SIGNAL_ON : SIGNAL_OFF);

    if (this.night) {
      for (const lamp of batch.geo.headLamps) this.addGlow(tmpMatrix, lamp, 1.6, 1, 0.95, 0.85, camera);
      const tailBoost = 0.6 + Math.min(1, v.brake * 1.5) * 0.9;
      for (const lamp of batch.geo.tailLamps) this.addGlow(tmpMatrix, lamp, 1.1 * tailBoost, 0.9 * tailBoost, 0.05, 0.03, camera);
      if (this.beamCount < this.beams.instanceMatrix.count) {
        const front = batch.geo.headLamps[0][2];
        tmpLocal.set(0, -batch.geo.headLamps[0][1], front).applyMatrix4(tmpMatrix);
        tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, v.yaw);
        tmpPos.copy(tmpLocal);
        beamMatrix.compose(tmpPos, tmpQuat, tmpScale);
        this.beams.setMatrixAt(this.beamCount, beamMatrix);
        this.beams.setColorAt(this.beamCount, tmpColor.setRGB(0.55, 0.52, 0.45));
        this.beamCount++;
      }
    } else if (v.brake > 0.2) {
      for (const lamp of batch.geo.tailLamps) this.addGlow(tmpMatrix, lamp, 0.7, 0.35, 0.02, 0.01, camera);
    }
  }

  private addGlow(
    vehicleMatrix: THREE.Matrix4,
    lamp: [number, number, number],
    size: number,
    r: number,
    g: number,
    b: number,
    camera: THREE.Camera,
  ): void {
    if (this.glowCount >= this.glows.instanceMatrix.count) return;
    tmpPos.set(lamp[0], lamp[1], lamp[2]).applyMatrix4(vehicleMatrix);
    glowMatrix.compose(tmpPos, camera.quaternion, glowScale.setScalar(size));
    this.glows.setMatrixAt(this.glowCount, glowMatrix);
    this.glows.setColorAt(this.glowCount, tmpColor.setRGB(r, g, b));
    this.glowCount++;
  }

  end(): void {
    for (const b of this.batches.values()) {
      for (const m of [b.body, b.detail, b.head, b.tail, b.left, b.right]) {
        m.count = b.count;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
    this.glows.count = this.glowCount;
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
    this.beams.count = this.beamCount;
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
  }
}
