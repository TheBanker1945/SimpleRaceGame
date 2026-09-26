import * as THREE from 'three';
import { createGlowTexture } from './Textures.ts';

const VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  varying float vAlpha;
  varying vec3 vTint;
  uniform float scale;
  #include <fog_pars_vertex>
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / max(-mvPosition.z, 0.1);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  varying float vAlpha;
  varying vec3 vTint;
  #include <fog_pars_fragment>
  void main() {
    vec4 tex = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vTint, tex.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
    #include <fog_fragment>
  }
`;

interface ParticleOptions {
  capacity: number;
  additive: boolean;
  gravity: number;
  drag: number;
  /** Size growth per second (m/s). */
  growth: number;
}

/** Pooled GPU point particles (one draw call) with per-particle size, alpha and tint. */
class ParticleSystem {
  readonly points: THREE.Points;
  private readonly opts: ParticleOptions;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly tint: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly startAlpha: Float32Array;
  private next = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor(opts: ParticleOptions, texture: THREE.Texture) {
    this.opts = opts;
    const n = opts.capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.tint = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n).fill(1);
    this.startAlpha = new Float32Array(n);
    this.age.fill(2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: texture }, scale: { value: 600 } }]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.material.uniforms.map.value = texture;
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setViewportHeight(pixels: number, fovDeg: number): void {
    // World-space size → pixels: size * (h / 2) / tan(fov/2) / distance.
    this.material.uniforms.scale.value = pixels / 2 / Math.tan((fovDeg * Math.PI) / 360);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, alpha: number, r: number, g: number, b: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.opts.capacity;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.startAlpha[i] = alpha;
    this.alpha[i] = alpha;
    this.tint[i * 3] = r;
    this.tint[i * 3 + 1] = g;
    this.tint[i * 3 + 2] = b;
    this.age[i] = 0;
    this.life[i] = life;
  }

  update(dt: number): void {
    const { gravity, drag, growth, capacity } = this.opts;
    const damping = Math.exp(-drag * dt);
    for (let i = 0; i < capacity; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      this.vel[i * 3] *= damping;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damping - gravity * dt;
      this.vel[i * 3 + 2] *= damping;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += growth * dt;
      this.alpha[i] = this.startAlpha[i] * (1 - t) * Math.min(1, t * 8);
    }
    const geo = this.points.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('size').needsUpdate = true;
    geo.getAttribute('alpha').needsUpdate = true;
    geo.getAttribute('tint').needsUpdate = true;
  }

  shift(dx: number, dz: number): void {
    for (let i = 0; i < this.opts.capacity; i++) {
      this.pos[i * 3] -= dx;
      this.pos[i * 3 + 2] -= dz;
    }
  }

  clear(): void {
    this.age.fill(2);
    this.life.fill(1);
    this.alpha.fill(0);
  }
}

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpEuler = new THREE.Euler();

/** Persistent tire marks: a ring buffer of thin dark quads laid on the road. */
class SkidMarks {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private next = 0;
  private count = 0;
  private readonly last: (THREE.Vector3 | null)[] = [null, null, null, null];

  constructor(capacity: number) {
    this.capacity = capacity;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0c0c0c,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Extends wheel `i`'s mark to point `p`, or lifts it when `p` is null. */
  track(i: number, p: THREE.Vector3 | null): void {
    const prev = this.last[i];
    if (!p) {
      this.last[i] = null;
      return;
    }
    if (prev) {
      const dx = p.x - prev.x;
      const dz = p.z - prev.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.25) return;
      if (len < 6) {
        tmpPos.set((p.x + prev.x) / 2, (p.y + prev.y) / 2 + 0.02, (p.z + prev.z) / 2);
        tmpEuler.set(0, Math.atan2(dx, dz), 0);
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(0.22, 1, len + 0.05);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        this.mesh.setMatrixAt(this.next, tmpMatrix);
        this.next = (this.next + 1) % this.capacity;
        this.count = Math.min(this.count + 1, this.capacity);
        this.mesh.count = this.count;
        this.mesh.instanceMatrix.needsUpdate = true;
      }
      prev.copy(p);
    } else {
      this.last[i] = p.clone();
    }
  }

  shift(dx: number, dz: number): void {
    for (let i = 0; i < this.count; i++) {
      this.mesh.getMatrixAt(i, tmpMatrix);
      tmpMatrix.elements[12] -= dx;
      tmpMatrix.elements[14] -= dz;
      this.mesh.setMatrixAt(i, tmpMatrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const p of this.last) {
      if (p) {
        p.x -= dx;
        p.z -= dz;
      }
    }
  }

  clear(): void {
    this.count = 0;
    this.next = 0;
    this.mesh.count = 0;
    this.last.fill(null);
  }
}

/**
 * Tire smoke, sparks and skid marks. All positions are in render space; `shiftOrigin`
 * keeps them in place when the floating origin moves.
 */
export class Effects {
  readonly group = new THREE.Group();
  private readonly smoke: ParticleSystem;
  private readonly sparks: ParticleSystem;
  private readonly skids: SkidMarks;

  constructor() {
    const glow = createGlowTexture();
    this.smoke = new ParticleSystem({ capacity: 420, additive: false, gravity: -0.35, drag: 1.4, growth: 2.2 }, glow);
    this.sparks = new ParticleSystem({ capacity: 260, additive: true, gravity: 9.81, drag: 0.6, growth: -0.05 }, glow);
    this.skids = new SkidMarks(900);
    this.group.add(this.skids.mesh, this.smoke.points, this.sparks.points);
  }

  setViewport(heightPx: number, fov: number): void {
    this.smoke.setViewportHeight(heightPx, fov);
    this.sparks.setViewportHeight(heightPx, fov);
  }

  /** Smoke puff from a sliding tire. `intensity` 0..1. */
  tireSmoke(p: THREE.Vector3, carVelocity: THREE.Vector3, intensity: number, night: boolean): void {
    const shade = night ? 0.35 : 0.82;
    this.smoke.emit(
      p.x + (Math.random() - 0.5) * 0.3,
      p.y + 0.15,
      p.z + (Math.random() - 0.5) * 0.3,
      carVelocity.x * 0.25 + (Math.random() - 0.5) * 1.2,
      0.4 + Math.random() * 0.6,
      carVelocity.z * 0.25 + (Math.random() - 0.5) * 1.2,
      1.2 + Math.random() * 0.9,
      0.5 + intensity * 0.5,
      0.18 + intensity * 0.3,
      shade,
      shade,
      shade * 1.02,
    );
  }

  /** Shower of sparks from a metal-on-metal/concrete contact. */
  sparkBurst(p: THREE.Vector3, carVelocity: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      this.sparks.emit(
        p.x,
        p.y,
        p.z,
        carVelocity.x * 0.6 + (Math.random() - 0.5) * 7,
        1 + Math.random() * 3.5,
        carVelocity.z * 0.6 + (Math.random() - 0.5) * 7,
        0.25 + Math.random() * 0.45,
        0.09 + Math.random() * 0.08,
        1,
        1,
        0.55 + Math.random() * 0.3,
        0.15,
      );
    }
  }

  skidMark(wheel: number, p: THREE.Vector3 | null): void {
    this.skids.track(wheel, p);
  }

  update(dt: number): void {
    this.smoke.update(dt);
    this.sparks.update(dt);
  }

  shiftOrigin(dx: number, dz: number): void {
    this.smoke.shift(dx, dz);
    this.sparks.shift(dx, dz);
    this.skids.shift(dx, dz);
  }

  clear(): void {
    this.smoke.clear();
    this.sparks.clear();
    this.skids.clear();
  }
}
