import { describe, expect, it } from 'vitest';
import { createPathSample, RoadPath } from '../src/world/RoadPath.ts';
import { BARRIER_LEFT, BARRIER_RIGHT, laneAt, laneCenter, LANE_COUNT, PAVED_LEFT, PAVED_RIGHT } from '../src/world/RoadConstants.ts';
import { terrainHeight } from '../src/world/Terrain.ts';

describe('road path', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = new RoadPath(42);
    const b = new RoadPath(42);
    const c = new RoadPath(43);
    a.ensure(20000);
    b.ensure(20000);
    c.ensure(20000);
    const pa = a.sample(15000, createPathSample());
    const pb = b.sample(15000, createPathSample());
    const pc = c.sample(15000, createPathSample());
    expect(pa.x).toBe(pb.x);
    expect(pa.z).toBe(pb.z);
    expect(Math.hypot(pa.x - pc.x, pa.z - pc.z)).toBeGreaterThan(1);
  });

  it('starts with a straight, flat run-up', () => {
    const path = new RoadPath(7);
    path.ensure(1000);
    for (let s = 0; s < 600; s += 10) {
      expect(path.curvature(s)).toBe(0);
      expect(path.grade(s)).toBe(0);
    }
  });

  it('only has gentle curves and grades (motorway design limits)', () => {
    const path = new RoadPath(99);
    const sample = createPathSample();
    let maxCurv = 0;
    let maxGrade = 0;
    let minH = Infinity;
    let maxH = -Infinity;
    for (let s = 0; s < 200000; s += 5) {
      path.ensure(s + 10);
      path.sample(s, sample);
      maxCurv = Math.max(maxCurv, Math.abs(sample.curvature));
      maxGrade = Math.max(maxGrade, Math.abs(sample.grade));
      minH = Math.min(minH, sample.y);
      maxH = Math.max(maxH, sample.y);
      path.trim(s - 500);
    }
    expect(1 / maxCurv).toBeGreaterThan(890);
    expect(maxGrade).toBeLessThanOrEqual(0.0401);
    // Elevation is pulled back toward sea level, so it never drifts away on long drives.
    expect(maxH).toBeLessThan(120);
    expect(minH).toBeGreaterThan(-120);
    expect(maxCurv).toBeGreaterThan(0);
  });

  it('is continuous: consecutive samples are one step apart with smooth heading', () => {
    const path = new RoadPath(5);
    path.ensure(20000);
    const p0 = createPathSample();
    const p1 = createPathSample();
    for (let s = 0; s < 19000; s += 1) {
      path.sample(s, p0);
      path.sample(s + 1, p1);
      const step = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      expect(step).toBeGreaterThan(0.99);
      expect(step).toBeLessThan(1.01);
      expect(Math.abs(p1.heading - p0.heading)).toBeLessThan(0.002);
      expect(Math.abs(p1.y - p0.y)).toBeLessThan(0.05);
    }
  });

  it('keeps memory bounded when trimmed while driving far', () => {
    const path = new RoadPath(3);
    for (let s = 0; s < 500000; s += 500) {
      path.ensure(s + 3000);
      path.trim(s - 800);
    }
    expect(path.endS - path.startS).toBeLessThan(6000);
  });

  it('places lateral offsets perpendicular to the road (left = positive d)', () => {
    const path = new RoadPath(1);
    path.ensure(500);
    const p = path.pointAt(100, 5, { x: 0, y: 0, z: 0 });
    // The run-up heads along +Z, so left is +X.
    expect(p.x).toBeCloseTo(5);
    expect(p.z).toBeCloseTo(100);
  });

  it('provides small, bounded surface roughness', () => {
    const path = new RoadPath(1);
    for (let s = 0; s < 1000; s += 0.37) expect(Math.abs(path.roughness(s, 0))).toBeLessThan(0.01);
  });
});

describe('road cross-section', () => {
  it('lanes are ordered left to right and lie inside the paved area', () => {
    for (let i = 0; i < LANE_COUNT; i++) {
      expect(laneAt(laneCenter(i))).toBe(i);
      if (i > 0) expect(laneCenter(i)).toBeLessThan(laneCenter(i - 1));
      expect(laneCenter(i)).toBeLessThan(PAVED_LEFT);
      expect(laneCenter(i)).toBeGreaterThan(PAVED_RIGHT);
    }
  });

  it('barriers sit outside the paved carriageway', () => {
    expect(BARRIER_LEFT).toBeGreaterThanOrEqual(PAVED_LEFT);
    expect(BARRIER_RIGHT).toBeLessThanOrEqual(PAVED_RIGHT);
  });

  it('terrain meets the road edge and has a ditch next to the verge', () => {
    expect(Math.abs(terrainHeight(100, 0, -1, 1))).toBeLessThan(0.05);
    expect(terrainHeight(100, 3.5, -1, 1)).toBeLessThan(-0.5);
  });
});
