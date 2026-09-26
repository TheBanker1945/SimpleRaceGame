import { clamp01 } from '../core/math.ts';

export interface HudState {
  speedKmh: number;
  rpm: number;
  redlineRPM: number;
  limiterRPM: number;
  maxRPM: number;
  gear: string;
  shifting: boolean;
  manual: boolean;
  score: number;
  best: number;
  distanceKm: number;
  time: number;
  multiplier: number;
  combo: number;
  /** 0..1 remaining combo window. */
  comboFraction: number;
  damage: number;
  abs: boolean;
  tcs: boolean;
  esc: boolean;
  limiter: boolean;
  cameraMode: string;
  fps: number | null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

const formatTime = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const formatScore = (n: number): string => Math.floor(n).toLocaleString('en-US');

/**
 * In-game HUD: score block, combo/multiplier, near-miss popups, damage bar,
 * driver-aid lamps and a canvas gauge cluster (speedometer + tachometer).
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly score: HTMLElement;
  private readonly best: HTMLElement;
  private readonly distance: HTMLElement;
  private readonly time: HTMLElement;
  private readonly multiplier: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly comboValue: HTMLElement;
  private readonly comboBar: HTMLElement;
  private readonly popups: HTMLElement;
  private readonly damageFill: HTMLElement;
  private readonly damageBlock: HTMLElement;
  private readonly lamps: Record<'abs' | 'tcs' | 'esc', HTMLElement>;
  private readonly mode: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cssW = 420;
  private cssH = 210;
  private lastScoreText = '';
  private bannerTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', parent);
    this.vignette = el('div', 'hud-vignette', this.root);

    const tl = el('div', 'hud-panel hud-score', this.root);
    el('div', 'hud-label', tl, 'SCORE');
    this.score = el('div', 'hud-score-value', tl, '0');
    const meta = el('div', 'hud-meta', tl);
    this.best = el('span', '', meta, 'BEST 0');
    this.distance = el('span', '', meta, '0.0 km');
    this.time = el('span', '', meta, '00:00');

    const center = el('div', 'hud-center', this.root);
    this.multiplier = el('div', 'hud-multiplier', center, '');
    this.combo = el('div', 'hud-combo', center);
    el('span', 'hud-combo-label', this.combo, 'COMBO');
    this.comboValue = el('span', 'hud-combo-value', this.combo, '×1');
    const barWrap = el('div', 'hud-combo-bar', this.combo);
    this.comboBar = el('div', 'hud-combo-fill', barWrap);
    this.popups = el('div', 'hud-popups', center);

    const tr = el('div', 'hud-panel hud-damage', this.root);
    this.damageBlock = tr;
    el('div', 'hud-label', tr, 'DAMAGE');
    const dmg = el('div', 'hud-damage-bar', tr);
    this.damageFill = el('div', 'hud-damage-fill', dmg);
    this.fps = el('div', 'hud-fps', tr, '');

    const bl = el('div', 'hud-panel hud-aids', this.root);
    this.lamps = {
      abs: el('span', 'hud-lamp', bl, 'ABS'),
      tcs: el('span', 'hud-lamp', bl, 'TCS'),
      esc: el('span', 'hud-lamp', bl, 'ESC'),
    };
    this.mode = el('div', 'hud-mode', bl, 'AUTO');

    this.banner = el('div', 'hud-banner', this.root, '');

    this.canvas = el('canvas', 'hud-gauges', this.root);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.ctx = ctx;
    this.resize();
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  resize(): void {
    const narrow = window.innerWidth < 760;
    this.cssW = narrow ? 300 : 420;
    this.cssH = narrow ? 150 : 210;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Floating "+points" message in the center. */
  popup(text: string, points: number, variant: 'near' | 'close' | 'bad' = 'near'): void {
    const p = el('div', `hud-popup ${variant}`, this.popups);
    el('div', 'hud-popup-title', p, text);
    if (points > 0) el('div', 'hud-popup-points', p, `+${formatScore(points)}`);
    setTimeout(() => p.remove(), 1500);
    while (this.popups.children.length > 4) this.popups.firstElementChild?.remove();
  }

  showBanner(text: string, seconds: number): void {
    this.banner.textContent = text;
    this.banner.classList.add('visible');
    this.bannerTimer = seconds;
  }

  flashDamage(): void {
    this.damageBlock.classList.remove('hit');
    // Force reflow so the animation restarts.
    void this.damageBlock.offsetWidth;
    this.damageBlock.classList.add('hit');
  }

  update(dt: number, s: HudState): void {
    const scoreText = formatScore(s.score);
    if (scoreText !== this.lastScoreText) {
      this.score.textContent = scoreText;
      this.lastScoreText = scoreText;
    }
    this.best.textContent = `BEST ${formatScore(Math.max(s.best, s.score))}`;
    this.distance.textContent = `${s.distanceKm.toFixed(1)} km`;
    this.time.textContent = formatTime(s.time);

    const bonus = s.multiplier >= 1.05;
    this.multiplier.textContent = bonus ? `×${s.multiplier.toFixed(1)} HIGH SPEED` : '';
    this.multiplier.classList.toggle('active', bonus);
    this.combo.classList.toggle('active', s.combo > 0);
    this.comboValue.textContent = `×${s.combo}`;
    this.comboBar.style.transform = `scaleX(${clamp01(s.comboFraction)})`;

    this.damageFill.style.transform = `scaleX(${clamp01(s.damage / 100)})`;
    this.damageFill.style.background = s.damage > 70 ? '#ff3b30' : s.damage > 40 ? '#ff9f0a' : '#30d158';
    this.lamps.abs.classList.toggle('on', s.abs);
    this.lamps.tcs.classList.toggle('on', s.tcs);
    this.lamps.esc.classList.toggle('on', s.esc);
    this.mode.textContent = `${s.manual ? 'MANUAL' : 'AUTO'} · ${s.cameraMode.toUpperCase()} CAM`;
    this.fps.textContent = s.fps !== null ? `${s.fps.toFixed(0)} FPS` : '';
    this.vignette.style.opacity = String(clamp01((s.speedKmh - 150) / 130) * 0.55);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('visible');
    }
    this.drawGauges(s);
  }

  // ------------------------------------------------------------------ gauges

  private drawGauges(s: HudState): void {
    const ctx = this.ctx;
    const W = this.cssW;
    const H = this.cssH;
    ctx.clearRect(0, 0, W, H);
    const r = H * 0.43;
    const cy = H * 0.52;
    const speedX = r + 8;
    const tachX = W - r - 8;
    const start = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;

    // --- speedometer
    this.dialBase(speedX, cy, r);
    const maxSpeed = 320;
    ctx.save();
    ctx.translate(speedX, cy);
    for (let v = 0; v <= maxSpeed; v += 10) {
      const a = start + (v / maxSpeed) * sweep;
      const major = v % 40 === 0;
      ctx.strokeStyle = major ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * (major ? 0.8 : 0.86), Math.sin(a) * r * (major ? 0.8 : 0.86));
      ctx.lineTo(Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93);
      ctx.stroke();
      if (major && r > 70) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = `${Math.round(r * 0.11)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66);
      }
    }
    // Speed arc
    const speedA = start + (Math.min(s.speedKmh, maxSpeed) / maxSpeed) * sweep;
    ctx.strokeStyle = s.speedKmh > 100 ? '#ffb020' : '#4fc3f7';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.97, start, speedA);
    ctx.stroke();
    this.needle(speedA, r, '#ff6a2b');
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `italic 700 ${Math.round(r * 0.36)}px system-ui, sans-serif`;
    ctx.fillText(String(Math.round(s.speedKmh)), 0, r * 0.5);
    ctx.font = `${Math.round(r * 0.12)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('km/h', 0, r * 0.76);
    ctx.restore();

    // --- tachometer
    this.dialBase(tachX, cy, r);
    ctx.save();
    ctx.translate(tachX, cy);
    const maxRpm = s.maxRPM;
    const redA = start + (s.redlineRPM / maxRpm) * sweep;
    ctx.strokeStyle = 'rgba(255,40,40,0.85)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.89, redA, start + sweep);
    ctx.stroke();
    for (let v = 0; v <= maxRpm; v += 500) {
      const a = start + (v / maxRpm) * sweep;
      const major = v % 1000 === 0;
      ctx.strokeStyle = v >= s.redlineRPM ? 'rgba(255,90,90,0.95)' : major ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * (major ? 0.78 : 0.85), Math.sin(a) * r * (major ? 0.78 : 0.85));
      ctx.lineTo(Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = `${Math.round(r * 0.13)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v / 1000), Math.cos(a) * r * 0.64, Math.sin(a) * r * 0.64);
      }
    }
    const rpmA = start + (Math.min(s.rpm, maxRpm) / maxRpm) * sweep;
    this.needle(rpmA, r, '#ff6a2b');
    // Gear
    ctx.fillStyle = s.shifting ? 'rgba(255,255,255,0.45)' : '#ffffff';
    ctx.font = `italic 800 ${Math.round(r * 0.46)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.gear, 0, r * 0.45);
    ctx.font = `${Math.round(r * 0.11)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('×1000 rpm', 0, r * 0.78);
    ctx.restore();

    // --- shift lights above the tach
    const lights = 7;
    const fraction = clamp01((s.rpm - s.redlineRPM * 0.72) / (s.redlineRPM * 0.28));
    const flash = s.limiter && Math.floor(performance.now() / 70) % 2 === 0;
    for (let i = 0; i < lights; i++) {
      const lit = fraction * lights > i + 0.5 || flash;
      const x = tachX - r * 0.6 + (i * r * 1.2) / (lights - 1);
      const y = cy - r - 2 > 6 ? cy - r * 1.05 : 6;
      ctx.beginPath();
      ctx.arc(x, Math.max(6, y), 4.5, 0, Math.PI * 2);
      const color = i < 3 ? '#30d158' : i < 5 ? '#ffd60a' : '#ff3b30';
      ctx.fillStyle = lit ? (flash ? '#4fc3f7' : color) : 'rgba(255,255,255,0.12)';
      ctx.fill();
    }
  }

  private dialBase(x: number, y: number, r: number): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.02);
    g.addColorStop(0, 'rgba(18,22,28,0.82)');
    g.addColorStop(1, 'rgba(8,10,14,0.72)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.02, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private needle(angle: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(-r * 0.12, -2.2);
    ctx.lineTo(r * 0.9, -0.8);
    ctx.lineTo(r * 0.9, 0.8);
    ctx.lineTo(-r * 0.12, 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#1b1f26';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
