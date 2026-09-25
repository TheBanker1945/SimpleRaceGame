import * as THREE from 'three';
import { createRoadTexture } from '../render/Textures.ts';
import { MARKING_PERIOD, PAVED_LEFT, PAVED_RIGHT } from './RoadConstants.ts';

/** Straight, flat test road that follows the car (milestone 1). */
export class FlatRoad {
  readonly group = new THREE.Group();
  private readonly road: THREE.Mesh;
  private readonly length = 3000;

  constructor(maxAnisotropy: number) {
    const tex = createRoadTexture(maxAnisotropy);
    tex.repeat.set(1, this.length / MARKING_PERIOD);
    const width = PAVED_LEFT - PAVED_RIGHT;
    const geo = new THREE.PlaneGeometry(width, this.length);
    geo.rotateX(-Math.PI / 2);
    // Plane's +X should map to the left edge (u = 0 at left): flip U.
    geo.rotateY(Math.PI);
    this.road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    this.road.receiveShadow = true;
    this.group.add(this.road);

    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(400, this.length).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x4f7a34, roughness: 1 }),
    );
    grass.position.y = -0.05;
    grass.receiveShadow = true;
    this.group.add(grass);
  }

  /** Keeps the strip under the car; snaps to the marking period so the dashes don't slide. */
  update(carS: number, originS: number): void {
    const base = Math.floor(carS / MARKING_PERIOD) * MARKING_PERIOD;
    const centerD = (PAVED_LEFT + PAVED_RIGHT) / 2;
    this.road.position.set(centerD, 0, base - originS + this.length / 2 - 500);
    this.group.children[1].position.set(0, -0.05, base - originS + this.length / 2 - 500);
  }
}
