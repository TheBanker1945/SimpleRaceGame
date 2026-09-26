export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Moves `current` toward `target` by at most `maxDelta`. */
export const approach = (current: number, target: number, maxDelta: number): number => {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
};

/** Frame-rate independent exponential smoothing factor for a time constant (seconds). */
export const smoothFactor = (dt: number, timeConstant: number): number =>
  timeConstant <= 0 ? 1 : 1 - Math.exp(-dt / timeConstant);

/** Exponentially decays `current` toward `target` with the given time constant. */
export const damp = (current: number, target: number, timeConstant: number, dt: number): number =>
  lerp(current, target, smoothFactor(dt, timeConstant));

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Wraps an angle into (-PI, PI]. */
export const wrapAngle = (a: number): number => {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  else if (r <= -Math.PI) r += Math.PI * 2;
  return r;
};

export const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;

export const MS_TO_KMH = 3.6;
export const KMH_TO_MS = 1 / 3.6;
export const RPM_TO_RADS = (Math.PI * 2) / 60;
export const RADS_TO_RPM = 60 / (Math.PI * 2);
export const GRAVITY = 9.81;
