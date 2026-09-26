const PHONE_SVG = `
<svg class="rotate-phone" viewBox="0 0 120 120" aria-hidden="true">
  <g class="rotate-device">
    <rect x="38" y="14" width="44" height="92" rx="8" />
    <line x1="54" y1="22" x2="66" y2="22" />
    <circle cx="60" cy="97" r="3.2" />
  </g>
  <path class="rotate-arrow" d="M96 44 A40 40 0 0 1 100 78" />
  <path class="rotate-arrow-head" d="M92.5 72 L100.5 80 L104.5 69.5" />
</svg>`;

/**
 * Full-screen "rotate your phone" prompt. On touch devices the game is only shown in
 * landscape; in portrait this overlay covers everything and shows a phone turning 90°.
 */
export class RotateOverlay {
  readonly root: HTMLElement;
  private blocking = false;
  private readonly enabled: boolean;
  private readonly onChange: (blocking: boolean) => void;

  constructor(parent: HTMLElement, enabled: boolean, onChange: (blocking: boolean) => void) {
    this.enabled = enabled;
    this.onChange = onChange;
    this.root = document.createElement('div');
    this.root.className = 'rotate-overlay';
    this.root.setAttribute('role', 'alert');
    this.root.innerHTML = `${PHONE_SVG}
      <div class="rotate-title">ROTATE YOUR PHONE</div>
      <div class="rotate-text">Turn your device 90° to landscape to play Redline.</div>`;
    parent.appendChild(this.root);
    const check = (): void => this.update();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    screen.orientation?.addEventListener?.('change', check);
    this.update();
  }

  /** True while the game must stay hidden (portrait on a touch device). */
  get isBlocking(): boolean {
    return this.blocking;
  }

  update(): void {
    const portrait = window.innerHeight > window.innerWidth;
    const blocking = this.enabled && portrait;
    this.root.classList.toggle('visible', blocking);
    document.documentElement.classList.toggle('portrait-blocked', blocking);
    if (blocking !== this.blocking) {
      this.blocking = blocking;
      this.onChange(blocking);
    }
  }
}
