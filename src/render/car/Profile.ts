/** Knots (x, y) of a smooth 1D profile, e.g. a height along the car. */
export type Knots = readonly (readonly [number, number])[];

/**
 * Smooth, overshoot-free curve through knots (monotone cubic Hermite, Fritsch–Carlson).
 * Used for every side-view and plan-view line of the procedural car bodies, so a
 * designer can place a few points and get a clean, fair surface without wiggles.
 * Outside the knot range the end values are held.
 */
export class Profile {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly ms: Float64Array;

  constructor(knots: Knots) {
    if (knots.length === 0) throw new Error('Profile needs at least one knot');
    const sorted = [...knots].sort((a, b) => a[0] - b[0]);
    const n = sorted.length;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.ms = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.xs[i] = sorted[i][0];
      this.ys[i] = sorted[i][1];
    }
    if (n === 1) return;
    const d = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const h = this.xs[i + 1] - this.xs[i];
      d[i] = h > 1e-9 ? (this.ys[i + 1] - this.ys[i]) / h : 0;
    }
    this.ms[0] = d[0];
    this.ms[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      this.ms[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    }
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        this.ms[i] = 0;
        this.ms[i + 1] = 0;
        continue;
      }
      const a = this.ms[i] / d[i];
      const b = this.ms[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        this.ms[i] = t * a * d[i];
        this.ms[i + 1] = t * b * d[i];
      }
    }
  }

  static constant(value: number): Profile {
    return new Profile([[0, value]]);
  }

  get minX(): number {
    return this.xs[0];
  }

  get maxX(): number {
    return this.xs[this.xs.length - 1];
  }

  at(x: number): number {
    const xs = this.xs;
    const n = xs.length;
    if (n === 1 || x <= xs[0]) return this.ys[0];
    if (x >= xs[n - 1]) return this.ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * this.ys[lo] +
      (t3 - 2 * t2 + t) * h * this.ms[lo] +
      (-2 * t3 + 3 * t2) * this.ys[hi] +
      (t3 - t2) * h * this.ms[hi]
    );
  }
}

/** Accepts either a fixed number or a profile. */
export type ProfileLike = number | Knots | Profile;

export function toProfile(p: ProfileLike): Profile {
  if (p instanceof Profile) return p;
  if (typeof p === 'number') return Profile.constant(p);
  return new Profile(p);
}

export const smoothstep01 = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
