/**
 * Fixed-timestep accumulator. Simulation always advances in exact `step`
 * increments regardless of display refresh rate; rendering interpolates between the
 * last two simulation states using `alpha`.
 */
export class FixedStepLoop {
  readonly step: number;
  /** Frames longer than this are clamped (tab switches, debugger pauses). */
  readonly maxFrame: number;
  private accumulator = 0;
  /** Interpolation factor between the previous and current simulation state. */
  alpha = 0;

  constructor(step = 1 / 120, maxFrame = 0.1) {
    this.step = step;
    this.maxFrame = maxFrame;
  }

  /**
   * Advances the accumulator and runs as many fixed steps as are due.
   * @returns number of steps run
   */
  advance(frameDt: number, timeScale: number, stepFn: (dt: number) => void): number {
    this.accumulator += Math.min(Math.max(frameDt, 0), this.maxFrame) * timeScale;
    let steps = 0;
    while (this.accumulator >= this.step) {
      stepFn(this.step);
      this.accumulator -= this.step;
      steps++;
    }
    this.alpha = this.accumulator / this.step;
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
    this.alpha = 0;
  }
}
