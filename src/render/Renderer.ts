import * as THREE from 'three';

export type Quality = 'low' | 'medium' | 'high';

export interface QualityProfile {
  /** Multiplier on devicePixelRatio, then clamped by maxPixelRatio. */
  pixelScale: number;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Half-size of the shadow camera frustum around the car (m). */
  shadowExtent: number;
  /** How far ahead road chunks are generated (m). */
  drawDistance: number;
  /** Scenery density multiplier. */
  sceneryDensity: number;
  /** Adds real spot lights on the player's headlights at night. */
  headlightSpots: boolean;
}

export const QUALITY_PROFILES: Record<Quality, QualityProfile> = {
  low: {
    pixelScale: 0.75,
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 1024,
    shadowExtent: 40,
    drawDistance: 900,
    sceneryDensity: 0.45,
    headlightSpots: false,
  },
  medium: {
    pixelScale: 1,
    maxPixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 2048,
    shadowExtent: 60,
    drawDistance: 1400,
    sceneryDensity: 0.75,
    headlightSpots: true,
  },
  high: {
    pixelScale: 1,
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 4096,
    shadowExtent: 85,
    drawDistance: 2000,
    sceneryDensity: 1,
    headlightSpots: true,
  },
};

/** Owns the WebGL renderer and the scene; applies quality settings. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  profile: QualityProfile;
  quality: Quality;

  constructor(container: HTMLElement, quality: Quality) {
    this.quality = quality;
    this.profile = QUALITY_PROFILES[quality];
    this.renderer = new THREE.WebGLRenderer({
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    this.applyQuality(quality);
  }

  get maxAnisotropy(): number {
    return Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
  }

  applyQuality(quality: Quality): void {
    this.quality = quality;
    this.profile = QUALITY_PROFILES[quality];
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.renderer.setPixelRatio(Math.min(dpr * this.profile.pixelScale, this.profile.maxPixelRatio));
    this.renderer.shadowMap.enabled = this.profile.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    this.renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  get aspect(): number {
    const size = this.renderer.getSize(new THREE.Vector2());
    return size.y > 0 ? size.x / size.y : 1;
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }
}
