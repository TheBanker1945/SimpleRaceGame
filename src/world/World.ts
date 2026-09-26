import * as THREE from 'three';
import type { QualityProfile } from '../render/Renderer.ts';
import { createGlowTexture, createGrassTexture, createRoadTexture } from '../render/Textures.ts';
import { ChunkManager } from './ChunkManager.ts';
import { Environment, type TimeOfDay } from './Environment.ts';
import type { WorldAssets } from './RoadChunk.ts';
import { RoadPath, createPathSample, type PathSample } from './RoadPath.ts';
import {
  createBroadleafGeometry,
  createBushGeometry,
  createLampHeadGeometry,
  createLampPoleGeometry,
  createPineGeometry,
  createRailPostGeometry,
  createSignTexture,
} from './SceneryModels.ts';

/** Render positions are kept within this distance of the render origin. */
const ORIGIN_SHIFT_DISTANCE = 1500;

export interface RenderPose {
  position: THREE.Vector3;
  /** World heading of the road + relative heading. */
  yaw: number;
  /** Road pitch (nose-down positive, matches the suspension convention). */
  pitch: number;
}

/**
 * The procedural world: road path, recycled chunks, environment and the floating origin.
 *
 * Simulation happens in road coordinates (s, d); the world converts them to render space
 * as absolute position minus a floating origin, which is re-centered on the player every
 * 1.5 km so Float32 GPU coordinates never lose precision on long drives.
 */
export class World {
  readonly path = new RoadPath(1);
  readonly chunks: ChunkManager;
  readonly environment: Environment;
  readonly group = new THREE.Group();
  /** Floating origin (absolute world coordinates that map to render-space 0,0). */
  originX = 0;
  originZ = 0;
  private readonly lampMat: THREE.MeshStandardMaterial;
  private readonly poolMat: THREE.MeshBasicMaterial;
  private readonly signTextures: THREE.Texture[];
  private readonly sample: PathSample = createPathSample();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, maxAnisotropy: number) {
    const roadTex = createRoadTexture(maxAnisotropy);
    const grassTex = createGrassTexture(maxAnisotropy);
    this.signTextures = [];
    for (let i = 0; i < 9; i++) this.signTextures.push(createSignTexture(100 + i, maxAnisotropy));
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e0, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 });
    this.poolMat = new THREE.MeshBasicMaterial({
      map: createGlowTexture(),
      color: 0xffb870,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const assets: WorldAssets = {
      roadMat: new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9, metalness: 0, envMapIntensity: 0.5 }),
      terrainMat: new THREE.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 0.97 }),
      concreteMat: new THREE.MeshStandardMaterial({ color: 0x96938b, roughness: 0.9 }),
      steelMat: new THREE.MeshStandardMaterial({ color: 0xc2c7cc, metalness: 0.75, roughness: 0.38, side: THREE.DoubleSide }),
      darkMat: new THREE.MeshStandardMaterial({ color: 0x3c3e42, roughness: 0.9 }),
      poleMat: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.5 }),
      lampMat: this.lampMat,
      treeMat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 }),
      poolMat: this.poolMat,
      pineGeo: createPineGeometry(),
      broadleafGeo: createBroadleafGeometry(),
      bushGeo: createBushGeometry(),
      poleGeo: createLampPoleGeometry(),
      lampHeadGeo: createLampHeadGeometry(),
      postGeo: createRailPostGeometry(),
      poolGeo: new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2),
      signTextures: this.signTextures,
    };
    this.chunks = new ChunkManager(assets, this.path);
    this.group.add(this.chunks.group);
    scene.add(this.group);
    this.environment = new Environment(renderer, scene);
  }

  get isNight(): boolean {
    return this.environment.isNight;
  }

  applySettings(quality: QualityProfile, tod: TimeOfDay): void {
    this.chunks.configure(quality.drawDistance, quality.sceneryDensity);
    this.environment.apply(tod, quality);
    const night = this.environment.isNight;
    this.lampMat.emissiveIntensity = night ? 3.5 : 0;
    this.poolMat.opacity = night ? 0.62 : 0;
    this.chunks.setNightLights(night);
  }

  /**
   * Starts a fresh road for a new run.
   * @param roadStart distance where the road begins (the run starts shortly after it)
   * @param startX absolute world X/Z of the road start (far values exercise the floating origin)
   */
  reset(seed: number, startS: number, roadStart = 0, startX = 0, startZ = 0): void {
    this.path.reset(seed, roadStart, startX, startZ);
    this.chunks.reset(seed);
    this.path.ensure(startS + 400);
    this.path.sample(startS, this.sample);
    this.originX = this.sample.x;
    this.originZ = this.sample.z;
    this.chunks.update(startS, this.originX, this.originZ, true);
  }

  /** Per-frame world maintenance around the player. */
  update(playerS: number): void {
    this.path.sample(playerS, this.sample);
    const dx = this.sample.x - this.originX;
    const dz = this.sample.z - this.originZ;
    if (Math.abs(dx) > ORIGIN_SHIFT_DISTANCE || Math.abs(dz) > ORIGIN_SHIFT_DISTANCE) {
      this.originX = this.sample.x;
      this.originZ = this.sample.z;
      this.chunks.applyOrigin(this.originX, this.originZ);
    }
    this.chunks.update(playerS, this.originX, this.originZ);
    this.path.trim(playerS - 800);
  }

  /** Converts road coordinates to a render-space pose. */
  poseAt(s: number, d: number, psi: number, out: RenderPose, height = 0): RenderPose {
    const p = this.path.sample(s, this.sample);
    out.position.set(
      p.x + Math.cos(p.heading) * d - this.originX,
      p.y + height,
      p.z - Math.sin(p.heading) * d - this.originZ,
    );
    out.yaw = p.heading + psi;
    out.pitch = -Math.atan(p.grade);
    return out;
  }

  /** Render-space position of a road-coordinate point. */
  toRender(s: number, d: number, out: THREE.Vector3, height = 0): THREE.Vector3 {
    const p = this.path.sample(s, this.sample);
    return out.set(p.x + Math.cos(p.heading) * d - this.originX, p.y + height, p.z - Math.sin(p.heading) * d - this.originZ);
  }
}
