import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Cabin, LowerBody } from '../src/render/car/Body.ts';
import { DESIGNS } from '../src/render/car/Designs.ts';
import { Profile } from '../src/render/car/Profile.ts';
import { buildTrafficGeometry, TRAFFIC_TYPES } from '../src/traffic/TrafficTypes.ts';
import { CARS } from '../src/vehicle/CarCatalog.ts';

const triangles = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

function bounds(g: THREE.BufferGeometry): { min: number[]; max: number[]; finite: boolean } {
  const p = g.getAttribute('position');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let finite = true;
  for (let i = 0; i < p.count; i++) {
    const v = [p.getX(i), p.getY(i), p.getZ(i)];
    for (let k = 0; k < 3; k++) {
      if (!Number.isFinite(v[k])) finite = false;
      min[k] = Math.min(min[k], v[k]);
      max[k] = Math.max(max[k], v[k]);
    }
  }
  return { min, max, finite };
}

describe('profile curves', () => {
  it('pass through their knots without overshoot', () => {
    const p = new Profile([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ]);
    expect(p.at(1)).toBeCloseTo(1);
    expect(p.at(2)).toBeCloseTo(1);
    for (let x = 0; x <= 3; x += 0.05) {
      expect(p.at(x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(p.at(x)).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(p.at(-5)).toBe(0);
    expect(p.at(9)).toBe(0);
  });
});

describe('player car bodies', () => {
  for (const car of CARS) {
    const cfg = car.config;
    const design = DESIGNS[car.id](cfg);

    it(`${car.name}: body fits the physics footprint and clears the wheels`, () => {
      const body = new LowerBody(design.body);
      const geo = body.buildGeometry();
      const b = bounds(geo);
      expect(b.finite).toBe(true);
      expect(triangles(geo)).toBeGreaterThan(5000);
      expect(b.max[2]).toBeLessThanOrEqual(cfg.halfLength + 0.01);
      expect(b.min[2]).toBeGreaterThanOrEqual(-cfg.halfLength - 0.01);
      expect(Math.max(b.max[0], -b.min[0])).toBeLessThanOrEqual(cfg.halfWidth + 0.03);
      expect(b.min[1]).toBeGreaterThan(0.08);

      // No body vertex may sit inside a (slightly shrunk) tire.
      const tireHalfWidth = design.wheels.width / 2 - 0.01;
      const R = cfg.wheelRadius - 0.01;
      const wheels: [number, number][] = [
        [cfg.trackFront / 2, cfg.cgToFront],
        [cfg.trackRear / 2, cfg.cgToFront - cfg.wheelbase],
      ];
      const p = geo.getAttribute('position');
      let inside = 0;
      for (let i = 0; i < p.count; i++) {
        const x = Math.abs(p.getX(i));
        const y = p.getY(i);
        const z = p.getZ(i);
        for (const [hubX, hubZ] of wheels) {
          const dy = y - cfg.wheelRadius;
          const dz = z - hubZ;
          if (Math.abs(x - hubX) < tireHalfWidth && dy * dy + dz * dz < R * R) inside++;
        }
      }
      expect(inside).toBe(0);
    });

    it(`${car.name}: glasshouse sits on the body`, () => {
      if (!design.cabin) return;
      const body = new LowerBody(design.body);
      const cabin = new Cabin(design.cabin, body);
      const geo = cabin.buildGeometry();
      const b = bounds(geo);
      expect(b.finite).toBe(true);
      expect(b.max[1]).toBeLessThan(1.5);
      expect(b.min[1]).toBeGreaterThan(0.5);
      for (const st of cabin.stations) {
        expect(st.sBase).toBeGreaterThanOrEqual(st.sRail);
        expect(st.railY).toBeGreaterThanOrEqual(st.baseY - 1e-9);
      }
    });
  }
});

describe('traffic vehicles', () => {
  for (const type of TRAFFIC_TYPES) {
    it(`${type.kind}: builds within its footprint and a triangle budget`, () => {
      const g = buildTrafficGeometry(type);
      const parts = [g.body, g.detail, g.head, g.tail, g.signalLeft, g.signalRight];
      let total = 0;
      for (const part of parts) {
        const b = bounds(part);
        expect(b.finite).toBe(true);
        expect(b.max[2]).toBeLessThanOrEqual(type.length / 2 + 0.07);
        expect(b.min[2]).toBeGreaterThanOrEqual(-type.length / 2 - 0.07);
        // Mirrors stick out a little past the body.
        expect(Math.max(b.max[0], -b.min[0])).toBeLessThanOrEqual(type.width / 2 + 0.15);
        total += triangles(part);
      }
      expect(total).toBeLessThan(14000);
      expect(g.headLamps).toHaveLength(2);
      expect(g.tailLamps).toHaveLength(2);
      expect(g.headLamps[0][2]).toBeGreaterThan(0);
      expect(g.tailLamps[0][2]).toBeLessThan(0);
    });
  }
});
