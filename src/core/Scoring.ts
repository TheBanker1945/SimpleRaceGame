import { clamp } from './math.ts';

/** Speed above which the high-speed bonus kicks in (km/h). */
export const HIGH_SPEED_KMH = 100;
/** Seconds a near-miss combo stays alive without another near miss. */
export const COMBO_WINDOW = 4.5;
export const MAX_COMBO = 10;

export interface NearMissResult {
  points: number;
  combo: number;
  close: boolean;
}

/**
 * Score model:
 *  - distance: 1 point per 10 m driven,
 *  - high-speed bonus: above 100 km/h distance points are multiplied by
 *    1 + (km/h − 100) / 100 (×2 at 200 km/h, ×2.8 at 280 km/h),
 *  - near misses: 150 × combo (+50 % for a "close call" under 0.5 m), where the combo
 *    grows with each near miss inside a 4.5 s window, up to ×10,
 *  - hitting anything breaks the combo.
 */
export class Scoring {
  score = 0;
  distance = 0;
  time = 0;
  topSpeedKmh = 0;
  nearMisses = 0;
  closeCalls = 0;
  combo = 0;
  maxCombo = 0;
  comboTimer = 0;
  highSpeedTime = 0;
  /** Current distance multiplier (for the HUD). */
  multiplier = 1;

  reset(): void {
    this.score = 0;
    this.distance = 0;
    this.time = 0;
    this.topSpeedKmh = 0;
    this.nearMisses = 0;
    this.closeCalls = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.comboTimer = 0;
    this.highSpeedTime = 0;
    this.multiplier = 1;
  }

  static speedMultiplier(kmh: number): number {
    return kmh > HIGH_SPEED_KMH ? 1 + (kmh - HIGH_SPEED_KMH) / 100 : 1;
  }

  /**
   * @param dt seconds
   * @param forwardDistance meters advanced along the road this step (negative when reversing)
   * @param speedKmh current speed
   */
  update(dt: number, forwardDistance: number, speedKmh: number): void {
    this.time += dt;
    this.topSpeedKmh = Math.max(this.topSpeedKmh, speedKmh);
    this.multiplier = Scoring.speedMultiplier(speedKmh);
    if (speedKmh > HIGH_SPEED_KMH) this.highSpeedTime += dt;
    if (forwardDistance > 0) {
      this.distance += forwardDistance;
      this.score += forwardDistance * 0.1 * this.multiplier;
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  nearMiss(gap: number): NearMissResult {
    this.combo = clamp(this.combo + 1, 1, MAX_COMBO);
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboTimer = COMBO_WINDOW;
    this.nearMisses++;
    const close = gap < 0.5;
    if (close) this.closeCalls++;
    const points = Math.round(150 * this.combo * (close ? 1.5 : 1));
    this.score += points;
    return { points, combo: this.combo, close };
  }

  collision(): void {
    this.combo = 0;
    this.comboTimer = 0;
  }

  get averageSpeedKmh(): number {
    return this.time > 0 ? (this.distance / this.time) * 3.6 : 0;
  }
}
