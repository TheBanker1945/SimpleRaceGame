/**
 * Pure driver-model functions used by traffic (kept free of rendering so they can be unit tested).
 */

export interface IdmParams {
  /** Maximum acceleration (m/s²). */
  maxAccel: number;
  /** Comfortable deceleration (m/s², positive). */
  comfortDecel: number;
  /** Desired time headway (s). */
  headway: number;
  /** Minimum standstill gap (m). */
  minGap: number;
  /** Hardest braking the driver will ever use (m/s², positive). */
  maxDecel: number;
}

/**
 * Intelligent Driver Model (Treiber et al.).
 * @param v own speed (m/s)
 * @param v0 desired speed (m/s)
 * @param gap bumper-to-bumper distance to the leader (m); Infinity when the road is free
 * @param dv approach rate v − v_leader (m/s, positive when closing)
 * @returns acceleration (m/s²)
 */
export function idmAcceleration(v: number, v0: number, gap: number, dv: number, p: IdmParams): number {
  const free = 1 - Math.pow(Math.max(v, 0) / Math.max(v0, 0.1), 4);
  if (!Number.isFinite(gap)) return Math.max(-p.maxDecel, p.maxAccel * free);
  const sStar = p.minGap + Math.max(0, v * p.headway + (v * dv) / (2 * Math.sqrt(p.maxAccel * p.comfortDecel)));
  const g = Math.max(gap, 0.1);
  const a = p.maxAccel * (free - (sStar / g) * (sStar / g));
  return Math.max(-p.maxDecel, a);
}

export interface LaneChangeInput {
  /** Own acceleration staying in the current lane. */
  accelCurrent: number;
  /** Own acceleration if it were in the target lane (with that lane's leader). */
  accelTarget: number;
  /** New follower's current acceleration, and its acceleration after we cut in. */
  followerBefore: number;
  followerAfter: number;
  /** Gap to the new follower and new leader (m). */
  gapBehind: number;
  gapAhead: number;
  /** +1 = toward the right (slow) lanes, −1 = toward the left. */
  direction: number;
}

export interface LaneChangeParams {
  politeness: number;
  /** Required advantage (m/s²). */
  threshold: number;
  /** Extra incentive for keeping right / penalty for moving left. */
  keepRightBias: number;
  /** Largest deceleration we may impose on the new follower (m/s², positive). */
  safeDecel: number;
  minGapBehind: number;
  minGapAhead: number;
}

/**
 * MOBIL lane-change criterion: change only if it is safe for the new follower and the
 * own advantage (minus a politeness-weighted disadvantage for the follower) beats a threshold.
 * A keep-right bias makes drivers return to the slow lanes after overtaking.
 */
export function shouldChangeLane(i: LaneChangeInput, p: LaneChangeParams): boolean {
  if (i.gapBehind < p.minGapBehind || i.gapAhead < p.minGapAhead) return false;
  if (i.followerAfter < -p.safeDecel) return false;
  const advantage = i.accelTarget - i.accelCurrent;
  const followerLoss = i.followerBefore - i.followerAfter;
  const bias = i.direction > 0 ? p.keepRightBias : -p.keepRightBias;
  return advantage - p.politeness * followerLoss + bias > p.threshold;
}

/** Smooth lateral progress (0..1 → 0..1) for a lane change, with zero lateral speed at both ends. */
export function laneChangeProfile(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Derivative of laneChangeProfile with respect to t. */
export function laneChangeRate(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 30 * x * x * (x - 1) * (x - 1);
}
