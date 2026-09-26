import type * as THREE from 'three';
import type { VehicleConfig } from '../../vehicle/VehicleConfig.ts';
import type { Cabin, CabinSpec, LowerBody, LowerBodySpec } from './Body.ts';
import type { DecalOptions, Frame, Vec2 } from './Decal.ts';
import type { WheelDesign } from './Wheel.ts';

/** Material slots a design can put geometry into. Static parts sharing a slot are merged into one mesh. */
export type MaterialKey =
  | 'paint'
  | 'trim'
  | 'gloss'
  | 'chrome'
  | 'carbon'
  | 'grille'
  | 'dark'
  | 'interior'
  | 'seat'
  | 'lampHousing'
  | 'headLamp'
  | 'drl'
  | 'tail'
  | 'tailLens'
  | 'reverse'
  | 'plate'
  | 'exhaust'
  | 'exhaustInner'
  | 'mirror'
  | 'glass'
  | 'amber';

/** How the glasshouse texture is laid out (see Cabin). All z in car coordinates, widths in metres. */
export interface WindowSpec {
  /** z of the windscreen's top edge (front edge of the roof panel). */
  windshieldTop: number;
  aPillar: number;
  /** Side glass: gap below the rail (roof rail / frame), bottom trim height above the base. */
  sideTopInset: number;
  belt: number;
  /** Rear edge of the side glass at its top and bottom (a slanted C-pillar line). */
  sideRearTop: number;
  sideRearBottom: number;
  /** Optional front limit of the side glass (defaults to following the A-pillar). */
  sideFront?: number;
  bPillar?: { z: number; width: number };
  /** Small fixed quarter window behind the B-pillar line. */
  quarter?: { zFront: number; zRearTop: number; zRearBottom: number };
  /** Rear window range and its margin from the rail. */
  rearTop: number;
  rearBottom: number;
  rearInset: number;
  /** Colour of the roof panel. */
  roof: 'paint' | 'black' | 'glass';
  /** Engine-cover louvres drawn inside the rear window (mid-engine cars). */
  louvres?: boolean;
  /** Glass frame colour. */
  frame?: 'black' | 'chrome';
}

/** Context handed to a design's detailing pass. */
export interface DetailContext {
  cfg: VehicleConfig;
  body: LowerBody;
  cabin: Cabin | null;
  /** Front/rear axle positions and wheel radius, for convenience. */
  zf: number;
  zr: number;
  R: number;
  /** Projects an outline onto the body (and cabin) and adds it to a material slot; `mirror` also adds the x-mirrored copy. */
  decal(frame: Frame, outline: readonly Vec2[], mat: MaterialKey, opts?: DecalOptions & { mirror?: boolean; onCabin?: boolean }): void;
  /** Adds free geometry (car coordinates). */
  add(geo: THREE.BufferGeometry, mat: MaterialKey, mirror?: boolean): void;
  /** Surface point along a frame (first hit), or null. */
  surface(frame: Frame, a: number, b: number, onCabin?: boolean): { p: THREE.Vector3; n: THREE.Vector3 } | null;
}

export interface CarDesign {
  body: LowerBodySpec;
  cabin: CabinSpec | null;
  windows: WindowSpec | null;
  wheels: WheelDesign;
  /** Headlight spot light origins (left side, mirrored). */
  headlight: [number, number, number];
  /** Hood camera eye point relative to the body. */
  hoodCamera: [number, number, number];
  detail(ctx: DetailContext): void;
}

export type DesignFactory = (cfg: VehicleConfig) => CarDesign;
