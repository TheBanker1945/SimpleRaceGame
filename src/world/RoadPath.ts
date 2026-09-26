import { clamp } from '../core/math.ts';
import { Random } from '../core/Random.ts';
import type { RoadProfile } from '../vehicle/VehiclePhysics.ts';

export interface PathSample {
  /** Absolute world position of the centerline (float64). */
  x: number;
  y: number;
  z: number;
  /** Heading: forward = (sin h, 0, cos h). Increasing heading turns left. */
  heading: number;
  grade: number;
  curvature: number;
}

export const createPathSample = (): PathSample => ({ x: 0, y: 0, z: 0, heading: 0, grade: 0, curvature: 0 });

/** Sample spacing along the road (m). */
const SPACING = 2;
/** Ring buffer size: 12 000 samples = 24 km of road kept in memory at most. */
const CAPACITY = 12000;
/** Straight, flat run-up at the start of every run. */
const START_STRAIGHT = 700;

/**
 * Procedural, infinite highway centerline.
 *
 * Horizontal alignment is a sequence of straights and constant-radius curves joined by
 * clothoids (curvature changes linearly with distance), as on real motorways. Vertical
 * alignment is a sequence of constant grades joined by parabolic vertical curves; the grade
 * choice is biased back toward sea level so elevation never drifts far.
 *
 * Positions are integrated in float64 and kept in a ring buffer; old samples are trimmed
 * behind the player so memory stays bounded however long the drive.
 */
export class RoadPath implements RoadProfile {
  private readonly xs = new Float64Array(CAPACITY);
  private readonly zs = new Float64Array(CAPACITY);
  private readonly hs = new Float64Array(CAPACITY);
  private readonly headings = new Float64Array(CAPACITY);
  private readonly curvatures = new Float64Array(CAPACITY);
  private readonly grades = new Float64Array(CAPACITY);
  private readonly vcurvs = new Float64Array(CAPACITY);
  /** Global index of the oldest stored sample, and number stored. */
  private first = 0;
  private count = 0;

  private rng = new Random(1);
  // Generator state (at global sample index first + count - 1).
  private curv = 0;
  private curvTarget = 0;
  private curvStep = 0;
  private curvHold = 0;
  private genGrade = 0;
  private genGradeTarget = 0;
  private genGradeStep = 0;
  private genGradeHold = 0;

  constructor(seed = 1) {
    this.reset(seed);
  }

  /**
   * Starts a new road. `startS` and the start position let a run begin arbitrarily far
   * from the world origin (used to verify precision on very long drives).
   */
  reset(seed: number, startS = 0, x0 = 0, z0 = 0): void {
    this.rng = new Random(seed);
    this.first = Math.max(0, Math.round(startS / SPACING));
    this.count = 1;
    const i = this.first % CAPACITY;
    this.xs[i] = x0;
    this.zs[i] = z0;
    this.hs[i] = 0;
    this.headings[i] = 0;
    this.curvatures[i] = 0;
    this.grades[i] = 0;
    this.vcurvs[i] = 0;
    this.curv = 0;
    this.curvTarget = 0;
    this.curvStep = 0;
    this.curvHold = START_STRAIGHT;
    this.genGrade = 0;
    this.genGradeTarget = 0;
    this.genGradeStep = 0;
    this.genGradeHold = START_STRAIGHT;
  }

  /** Distance of the last generated sample. */
  get endS(): number {
    return (this.first + this.count - 1) * SPACING;
  }

  get startS(): number {
    return this.first * SPACING;
  }

  /** Generates road until at least `s`. */
  ensure(s: number): void {
    while (this.endS < s) this.generateNext();
  }

  /** Forgets road before `s` (keeps memory bounded). */
  trim(s: number): void {
    const idx = Math.floor(s / SPACING) - 1;
    if (idx <= this.first) return;
    const drop = Math.min(idx - this.first, this.count - 2);
    if (drop <= 0) return;
    this.first += drop;
    this.count -= drop;
  }

  private generateNext(): void {
    if (this.count >= CAPACITY) throw new Error('RoadPath capacity exceeded; call trim()');
    this.planCurvature();
    this.planGrade();
    const prev = (this.first + this.count - 1) % CAPACITY;
    const next = (this.first + this.count) % CAPACITY;

    const prevCurv = this.curv;
    this.curv = this.curvStep !== 0 ? stepToward(this.curv, this.curvTarget, this.curvStep) : this.curv;
    const prevGrade = this.genGrade;
    this.genGrade = this.genGradeStep !== 0 ? stepToward(this.genGrade, this.genGradeTarget, this.genGradeStep) : this.genGrade;

    // Midpoint integration keeps the centerline smooth.
    const heading = this.headings[prev] + 0.5 * (prevCurv + this.curv) * SPACING;
    const midHeading = 0.5 * (this.headings[prev] + heading);
    this.headings[next] = heading;
    this.xs[next] = this.xs[prev] + Math.sin(midHeading) * SPACING;
    this.zs[next] = this.zs[prev] + Math.cos(midHeading) * SPACING;
    this.hs[next] = this.hs[prev] + 0.5 * (prevGrade + this.genGrade) * SPACING;
    this.curvatures[next] = this.curv;
    this.grades[next] = this.genGrade;
    this.vcurvs[next] = (this.genGrade - prevGrade) / SPACING;
    this.count++;
  }

  private planCurvature(): void {
    if (this.curv !== this.curvTarget) return;
    if (this.curvHold > 0) {
      this.curvHold -= SPACING;
      this.curvStep = 0;
      return;
    }
    const r = this.rng;
    if (this.curvTarget !== 0 || r.chance(0.35)) {
      // Back to a straight.
      this.curvTarget = 0;
      this.curvHold = r.range(200, 800);
    } else {
      // A new curve: radius 900-3000 m, left or right.
      const radius = r.range(900, 3000);
      this.curvTarget = r.sign() / radius;
      this.curvHold = r.range(200, 700);
    }
    const transition = r.range(160, 320);
    this.curvStep = (Math.abs(this.curvTarget - this.curv) / transition) * SPACING;
  }

  private planGrade(): void {
    if (this.genGrade !== this.genGradeTarget) return;
    if (this.genGradeHold > 0) {
      this.genGradeHold -= SPACING;
      this.genGradeStep = 0;
      return;
    }
    const r = this.rng;
    const h = this.hs[(this.first + this.count - 1) % CAPACITY];
    // Random grade up to ±3.5 %, pulled back toward sea level so hills never drift away.
    this.genGradeTarget = clamp(r.range(-0.035, 0.035) - h * 0.0012, -0.04, 0.04);
    if (r.chance(0.25)) this.genGradeTarget = clamp(-h * 0.0008, -0.01, 0.01);
    this.genGradeHold = r.range(150, 600);
    const transition = r.range(260, 520);
    this.genGradeStep = (Math.abs(this.genGradeTarget - this.genGrade) / transition) * SPACING;
  }

  /** Interpolates the centerline at distance s. */
  sample(s: number, out: PathSample): PathSample {
    const f = s / SPACING;
    let i = Math.floor(f);
    let t = f - i;
    const lo = this.first;
    const hi = this.first + this.count - 2;
    if (i < lo) {
      i = lo;
      t = 0;
    } else if (i > hi) {
      i = hi;
      t = 1;
    }
    const a = i % CAPACITY;
    const b = (i + 1) % CAPACITY;
    out.x = this.xs[a] + (this.xs[b] - this.xs[a]) * t;
    out.y = this.hs[a] + (this.hs[b] - this.hs[a]) * t;
    out.z = this.zs[a] + (this.zs[b] - this.zs[a]) * t;
    out.heading = this.headings[a] + (this.headings[b] - this.headings[a]) * t;
    out.grade = this.grades[a] + (this.grades[b] - this.grades[a]) * t;
    out.curvature = this.curvatures[a] + (this.curvatures[b] - this.curvatures[a]) * t;
    return out;
  }

  /** Absolute world position of the point at distance s and lateral offset d (flat cross-section). */
  pointAt(s: number, d: number, out: { x: number; y: number; z: number }, sample: PathSample = scratch): { x: number; y: number; z: number } {
    this.sample(s, sample);
    out.x = sample.x + Math.cos(sample.heading) * d;
    out.y = sample.y;
    out.z = sample.z - Math.sin(sample.heading) * d;
    return out;
  }

  // ------------------------------------------------------------- RoadProfile
  private index(s: number): number {
    const i = Math.min(Math.max(Math.round(s / SPACING), this.first), this.first + this.count - 1);
    return i % CAPACITY;
  }

  curvature(s: number): number {
    return this.curvatures[this.index(s)];
  }

  grade(s: number): number {
    return this.grades[this.index(s)];
  }

  verticalCurvature(s: number): number {
    return this.vcurvs[this.index(s)];
  }

  /** A few millimetres of surface undulation so the suspension is never perfectly still. */
  roughness(s: number, d: number): number {
    return 0.0035 * (Math.sin(s * 0.83) + 0.6 * Math.sin(s * 2.31 + d * 0.5) + 0.4 * Math.sin(s * 4.9 + d * 1.3));
  }
}

const scratch = createPathSample();

function stepToward(value: number, target: number, step: number): number {
  if (value < target) return Math.min(value + step, target);
  return Math.max(value - step, target);
}
