import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Random, valueNoise1D } from '../core/Random.ts';
import type { QualityProfile } from '../render/Renderer.ts';

export type TimeOfDay = 'day' | 'sunset' | 'night';

interface Preset {
  /** Degrees above the horizon (negative = below). */
  elevation: number;
  azimuth: number;
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  cloudCoverage: number;
  lightColor: number;
  lightIntensity: number;
  /** Direction of the directional light (sun or moon), degrees. */
  lightElevation: number;
  lightAzimuth: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  exposure: number;
  envIntensity: number;
  mountainColor: number;
  groundColor: number;
  night: boolean;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    elevation: 42,
    azimuth: 150,
    turbidity: 2.6,
    rayleigh: 1.1,
    mie: 0.004,
    mieG: 0.82,
    cloudCoverage: 0.32,
    lightColor: 0xfff2e0,
    lightIntensity: 3.2,
    lightElevation: 42,
    lightAzimuth: 150,
    hemiSky: 0xc9d8e8,
    hemiGround: 0x5e5a48,
    hemiIntensity: 0.85,
    fogColor: 0xb5c9dd,
    exposure: 0.62,
    envIntensity: 0.65,
    mountainColor: 0x5b6d7c,
    groundColor: 0x49602f,
    night: false,
  },
  sunset: {
    elevation: 3.2,
    azimuth: 28,
    turbidity: 7,
    rayleigh: 2.6,
    mie: 0.009,
    mieG: 0.9,
    cloudCoverage: 0.38,
    lightColor: 0xffa060,
    lightIntensity: 2.3,
    lightElevation: 7,
    lightAzimuth: 28,
    hemiSky: 0xf0a47a,
    hemiGround: 0x3b3328,
    hemiIntensity: 0.9,
    fogColor: 0xd79a78,
    exposure: 0.55,
    envIntensity: 0.8,
    mountainColor: 0x5b4250,
    groundColor: 0x3d4225,
    night: false,
  },
  night: {
    elevation: -8,
    azimuth: 200,
    turbidity: 1.5,
    rayleigh: 0.35,
    mie: 0.002,
    mieG: 0.7,
    cloudCoverage: 0.2,
    lightColor: 0x8fa6d6,
    lightIntensity: 0.6,
    lightElevation: 38,
    lightAzimuth: 120,
    hemiSky: 0x3a4f78,
    hemiGround: 0x151a22,
    hemiIntensity: 0.85,
    fogColor: 0x0b1220,
    exposure: 0.9,
    envIntensity: 0.8,
    mountainColor: 0x0e1522,
    groundColor: 0x0b100c,
    night: true,
  },
};

const tmpVec = new THREE.Vector3();
const lightDir = new THREE.Vector3();

/**
 * Sky, sun/moon light with a shadow frustum that follows the car, hemisphere fill,
 * distance fog, an image-based environment map for reflections, stars, a distant
 * mountain silhouette and a ground plane that fills the gap to the horizon.
 */
export class Environment {
  readonly sky: Sky;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.Fog;
  private readonly stars: THREE.Points;
  private readonly mountains: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private preset: Preset = PRESETS.day;
  private shadowExtent = 60;
  private time = 0;
  timeOfDay: TimeOfDay = 'day';

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sky = new Sky();
    this.sky.scale.setScalar(3000);
    this.sky.frustumCulled = false;
    // Sky first (it writes no depth), then the far mountains and ground, then everything else.
    this.sky.renderOrder = -3;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.fog = new THREE.Fog(0xffffff, 80, 1500);
    scene.fog = this.fog;

    this.stars = createStars();
    scene.add(this.stars);
    this.mountains = createMountains();
    scene.add(this.mountains);
    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(6000, 48).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x4a5f30 }),
    );
    this.ground.renderOrder = -1;
    scene.add(this.ground);
  }

  get isNight(): boolean {
    return this.preset.night;
  }

  apply(tod: TimeOfDay, quality: QualityProfile): void {
    this.timeOfDay = tod;
    const p = PRESETS[tod];
    this.preset = p;
    const u = this.sky.material.uniforms;
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mie;
    u.mieDirectionalG.value = p.mieG;
    if (u.cloudCoverage) u.cloudCoverage.value = quality.clouds ? p.cloudCoverage : 0;
    const sunPos = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - p.elevation),
      THREE.MathUtils.degToRad(p.azimuth),
    );
    u.sunPosition.value.copy(sunPos);
    lightDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - p.lightElevation), THREE.MathUtils.degToRad(p.lightAzimuth));

    this.sun.color.setHex(p.lightColor);
    this.sun.intensity = p.lightIntensity;
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.fog.color.setHex(p.fogColor);
    this.fog.near = Math.min(120, quality.drawDistance * 0.08);
    this.fog.far = quality.drawDistance * 0.97;
    this.renderer.toneMappingExposure = p.exposure;
    (this.stars.material as THREE.PointsMaterial).opacity = p.night ? 0.9 : 0;
    this.stars.visible = p.night;
    const fogCol = new THREE.Color(p.fogColor);
    (this.mountains.material as THREE.MeshBasicMaterial).color.setHex(p.mountainColor).lerp(fogCol, 0.45);
    (this.ground.material as THREE.MeshLambertMaterial).color.setHex(p.groundColor);

    this.shadowExtent = quality.shadowExtent;
    this.sun.castShadow = quality.shadows;
    if (quality.shadows) {
      const cam = this.sun.shadow.camera;
      cam.left = -this.shadowExtent;
      cam.right = this.shadowExtent;
      cam.top = this.shadowExtent;
      cam.bottom = -this.shadowExtent;
      cam.near = 1;
      cam.far = 600;
      cam.updateProjectionMatrix();
      if (this.sun.shadow.mapSize.x !== quality.shadowMapSize) {
        this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.regenerateEnvironment();
  }

  /** Renders the sky into a prefiltered environment map used for paint/glass reflections. */
  private regenerateEnvironment(): void {
    const envScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(1000);
    const src = this.sky.material.uniforms;
    const dst = skyCopy.material.uniforms;
    for (const key of Object.keys(src)) {
      const v = src[key].value;
      dst[key].value = v instanceof THREE.Vector3 ? v.clone() : v;
    }
    if (dst.showSunDisc) dst.showSunDisc.value = 0;
    envScene.add(skyCopy);
    // A dark ground hemisphere so reflections have a horizon.
    const groundGeo = new THREE.SphereGeometry(500, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const groundMat = new THREE.MeshBasicMaterial({ color: this.preset.groundColor, side: THREE.BackSide });
    envScene.add(new THREE.Mesh(groundGeo, groundMat));
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(envScene, 0.02, 0.1, 2000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = this.preset.envIntensity;
    skyCopy.geometry.dispose();
    skyCopy.material.dispose();
    groundGeo.dispose();
    groundMat.dispose();
  }

  /**
   * @param camera active camera (sky and far scenery follow it)
   * @param focus render-space point the shadow frustum is centered on (the car)
   * @param groundY render-space height for the horizon ground plane
   */
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, groundY: number): void {
    this.time += dt;
    const u = this.sky.material.uniforms;
    if (u.time) u.time.value = this.time;
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.mountains.position.set(camera.position.x, groundY - 30, camera.position.z);
    this.ground.position.set(camera.position.x, groundY - 2.5, camera.position.z);

    // Shadow frustum centered slightly ahead of the car, snapped to texels to avoid shimmering.
    const extent = this.shadowExtent;
    const texel = (extent * 2) / this.sun.shadow.mapSize.x;
    tmpVec.copy(focus);
    const cam = this.sun.shadow.camera;
    const right = new THREE.Vector3().crossVectors(lightDir, THREE.Object3D.DEFAULT_UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, lightDir).normalize();
    const rx = Math.round(tmpVec.dot(right) / texel) * texel;
    const uy = Math.round(tmpVec.dot(up) / texel) * texel;
    const along = tmpVec.dot(lightDir);
    tmpVec.copy(right).multiplyScalar(rx).addScaledVector(up, uy).addScaledVector(lightDir, along);
    this.sun.target.position.copy(tmpVec);
    this.sun.position.copy(tmpVec).addScaledVector(lightDir, 300);
    this.sun.target.updateMatrixWorld();
    cam.updateMatrixWorld();
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.pmrem.dispose();
  }
}

function createStars(): THREE.Points {
  const rng = new Random(42);
  const count = 1800;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = rng.range(0, Math.PI * 2);
    const y = rng.range(0.05, 1);
    const r = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(theta) * r * 2000;
    positions[i * 3 + 1] = y * 2000;
    positions[i * 3 + 2] = Math.sin(theta) * r * 2000;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** Ring of low-poly mountain silhouettes far away, drawn without fog as haze-tinted shapes. */
function createMountains(): THREE.Mesh {
  const segments = 160;
  const radius = 2600;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const n = valueNoise1D(i * 0.18, 5) * 0.6 + valueNoise1D(i * 0.55, 9) * 0.3 + valueNoise1D(i * 1.7, 13) * 0.1;
    const h = 90 + (n * 0.5 + 0.5) * 230;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    positions.push(x, -60, z, x, h, z);
    if (i < segments) {
      const b = i * 2;
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const mat = new THREE.MeshBasicMaterial({ color: 0x607080, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return mesh;
}
