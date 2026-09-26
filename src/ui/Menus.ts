import { PAINT_OPTIONS, type Settings } from '../core/Settings.ts';

export type MenuScreen = 'start' | 'pause' | 'gameover' | 'settings' | 'controls' | null;

export interface GameOverStats {
  score: number;
  best: number;
  newBest: boolean;
  distanceKm: number;
  time: number;
  topSpeed: number;
  averageSpeed: number;
  nearMisses: number;
  closeCalls: number;
  maxCombo: number;
  highSpeedTime: number;
  reason: string;
}

export interface MenuCallbacks {
  start(): void;
  resume(): void;
  restart(): void;
  quitToMenu(): void;
  settingsChanged(settings: Settings, changed: keyof Settings): void;
  click(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

const fmt = (n: number): string => Math.floor(n).toLocaleString('en-US');
const fmtTime = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const CONTROLS: [string, string, string][] = [
  ['Throttle', 'W / ↑', 'Right trigger'],
  ['Brake / reverse', 'S / ↓', 'Left trigger'],
  ['Steer', 'A D / ← →', 'Left stick'],
  ['Handbrake', 'Space', 'B / X'],
  ['Shift up (manual)', 'Shift / E', 'RB'],
  ['Shift down (manual)', 'Ctrl / Q', 'LB'],
  ['Change camera', 'C', 'Y'],
  ['Pause', 'Esc / P', 'Start'],
  ['Restart', 'R', 'Back'],
  ['Fullscreen', 'F', '—'],
];

/** DOM overlay menus. All game actions go through the callbacks. */
export class Menus {
  private readonly root: HTMLElement;
  private readonly screens = new Map<Exclude<MenuScreen, null>, HTMLElement>();
  private current: MenuScreen = null;
  private returnTo: MenuScreen = 'start';
  private readonly settings: Settings;
  private readonly cb: MenuCallbacks;
  private readonly startBest: HTMLElement;
  private readonly overStats: HTMLElement;
  private readonly overTitle: HTMLElement;
  private readonly overReason: HTMLElement;
  private readonly overBadge: HTMLElement;
  private readonly settingControls: (() => void)[] = [];

  constructor(parent: HTMLElement, settings: Settings, callbacks: MenuCallbacks) {
    this.settings = settings;
    this.cb = callbacks;
    this.root = el('div', 'menus', parent);

    // ------------------------------------------------------------ start
    const start = this.screen('start');
    const title = el('div', 'title-block', start);
    el('div', 'title-kicker', title, 'ENDLESS HIGHWAY');
    el('h1', 'title', title, 'REDLINE');
    el('div', 'title-sub', title, 'Weave through traffic at 280 km/h. Near misses build combos. Don’t crash.');
    const startButtons = el('div', 'menu-buttons', start);
    this.button(startButtons, 'DRIVE', () => this.cb.start(), 'primary', 'Enter');
    this.button(startButtons, 'SETTINGS', () => this.open('settings', 'start'));
    this.button(startButtons, 'CONTROLS', () => this.open('controls', 'start'));
    this.startBest = el('div', 'menu-best', start, '');
    el('div', 'menu-hint', start, 'Keyboard or gamepad · Headphones recommended');

    // ------------------------------------------------------------ pause
    const pause = this.screen('pause');
    el('h2', 'menu-title', pause, 'PAUSED');
    const pauseButtons = el('div', 'menu-buttons', pause);
    this.button(pauseButtons, 'RESUME', () => this.cb.resume(), 'primary', 'Esc');
    this.button(pauseButtons, 'RESTART', () => this.cb.restart(), '', 'R');
    this.button(pauseButtons, 'SETTINGS', () => this.open('settings', 'pause'));
    this.button(pauseButtons, 'CONTROLS', () => this.open('controls', 'pause'));
    this.button(pauseButtons, 'QUIT TO MENU', () => this.cb.quitToMenu());

    // --------------------------------------------------------- game over
    const over = this.screen('gameover');
    this.overTitle = el('h2', 'menu-title danger', over, 'WRECKED');
    this.overReason = el('div', 'menu-reason', over, '');
    this.overBadge = el('div', 'new-best', over, 'NEW BEST SCORE!');
    this.overStats = el('div', 'stats', over);
    const overButtons = el('div', 'menu-buttons row', over);
    this.button(overButtons, 'DRIVE AGAIN', () => this.cb.restart(), 'primary', 'R');
    this.button(overButtons, 'MENU', () => this.cb.quitToMenu());

    // ----------------------------------------------------------- settings
    const set = this.screen('settings');
    el('h2', 'menu-title', set, 'SETTINGS');
    const grid = el('div', 'settings-grid', set);
    this.segmented(grid, 'Gearbox', 'transmission', [
      ['automatic', 'Automatic'],
      ['manual', 'Manual'],
    ]);
    this.segmented(grid, 'Graphics', 'quality', [
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
    ]);
    this.segmented(grid, 'Time of day', 'timeOfDay', [
      ['day', 'Day'],
      ['sunset', 'Sunset'],
      ['night', 'Night'],
    ]);
    this.segmented(grid, 'Driving aids', 'assists', [
      [true, 'ABS · TCS · ESC'],
      [false, 'Off'],
    ]);
    this.volumeSlider(grid);
    this.paintPicker(grid);
    this.segmented(grid, 'FPS counter', 'showFps', [
      [false, 'Hidden'],
      [true, 'Shown'],
    ]);
    const setButtons = el('div', 'menu-buttons', set);
    this.button(setButtons, 'BACK', () => this.back(), 'primary', 'Esc');

    // ----------------------------------------------------------- controls
    const ctl = this.screen('controls');
    el('h2', 'menu-title', ctl, 'CONTROLS');
    const table = el('table', 'controls-table', ctl);
    const head = el('tr', '', table);
    el('th', '', head, 'Action');
    el('th', '', head, 'Keyboard');
    el('th', '', head, 'Gamepad');
    for (const [action, key, pad] of CONTROLS) {
      const row = el('tr', '', table);
      el('td', '', row, action);
      el('td', 'key', row, key);
      el('td', 'key', row, pad);
    }
    el(
      'p',
      'controls-note',
      ctl,
      'Automatic gearbox: hold brake at a standstill to reverse. Speed-sensitive steering: the faster you go, the less lock you get — small inputs at 250 km/h.',
    );
    const ctlButtons = el('div', 'menu-buttons', ctl);
    this.button(ctlButtons, 'BACK', () => this.back(), 'primary', 'Esc');
  }

  get activeScreen(): MenuScreen {
    return this.current;
  }

  private screen(name: Exclude<MenuScreen, null>): HTMLElement {
    const s = el('div', `menu-screen menu-${name}`, this.root);
    this.screens.set(name, s);
    return s;
  }

  private button(parent: HTMLElement, label: string, action: () => void, variant = '', hint = ''): HTMLButtonElement {
    const b = el('button', `menu-button ${variant}`, parent);
    el('span', '', b, label);
    if (hint) el('span', 'menu-key', b, hint);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      this.cb.click();
      action();
      b.blur();
    });
    return b;
  }

  private segmented<K extends keyof Settings>(parent: HTMLElement, label: string, key: K, options: [Settings[K], string][]): void {
    el('div', 'setting-label', parent, label);
    const group = el('div', 'segmented', parent);
    const buttons: [HTMLButtonElement, Settings[K]][] = [];
    for (const [value, text] of options) {
      const b = el('button', 'segment', group, text);
      b.addEventListener('click', () => {
        this.cb.click();
        this.settings[key] = value;
        refresh();
        this.cb.settingsChanged(this.settings, key);
        b.blur();
      });
      buttons.push([b, value]);
    }
    const refresh = (): void => {
      for (const [b, v] of buttons) b.classList.toggle('active', this.settings[key] === v);
    };
    this.settingControls.push(refresh);
    refresh();
  }

  private volumeSlider(parent: HTMLElement): void {
    el('div', 'setting-label', parent, 'Volume');
    const wrap = el('div', 'slider-wrap', parent);
    const input = el('input', 'slider', wrap);
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    const value = el('span', 'slider-value', wrap, '');
    const refresh = (): void => {
      input.value = String(Math.round(this.settings.volume * 100));
      value.textContent = `${input.value}%`;
    };
    input.addEventListener('input', () => {
      this.settings.volume = Number(input.value) / 100;
      value.textContent = `${input.value}%`;
      this.cb.settingsChanged(this.settings, 'volume');
    });
    this.settingControls.push(refresh);
    refresh();
  }

  private paintPicker(parent: HTMLElement): void {
    el('div', 'setting-label', parent, 'Paint');
    const wrap = el('div', 'swatches', parent);
    const swatches: [HTMLButtonElement, number][] = [];
    for (const p of PAINT_OPTIONS) {
      const b = el('button', 'swatch', wrap);
      b.title = p.name;
      b.style.background = `#${p.color.toString(16).padStart(6, '0')}`;
      b.addEventListener('click', () => {
        this.cb.click();
        this.settings.paint = p.color;
        refresh();
        this.cb.settingsChanged(this.settings, 'paint');
      });
      swatches.push([b, p.color]);
    }
    const refresh = (): void => {
      for (const [b, c] of swatches) b.classList.toggle('active', this.settings.paint === c);
    };
    this.settingControls.push(refresh);
    refresh();
  }

  private open(screen: Exclude<MenuScreen, null>, returnTo: MenuScreen): void {
    this.returnTo = returnTo;
    for (const r of this.settingControls) r();
    this.show(screen);
  }

  /** Goes back from settings/controls. Returns true if it handled the request. */
  back(): boolean {
    if (this.current === 'settings' || this.current === 'controls') {
      this.show(this.returnTo);
      return true;
    }
    return false;
  }

  show(screen: MenuScreen): void {
    this.current = screen;
    for (const [name, s] of this.screens) s.classList.toggle('visible', name === screen);
    this.root.classList.toggle('visible', screen !== null);
  }

  showStart(best: number): void {
    this.startBest.textContent = best > 0 ? `BEST SCORE  ${fmt(best)}` : '';
    this.show('start');
  }

  showGameOver(stats: GameOverStats): void {
    this.overTitle.textContent = 'WRECKED';
    this.overReason.textContent = stats.reason;
    this.overBadge.style.display = stats.newBest ? 'block' : 'none';
    this.overStats.replaceChildren();
    const rows: [string, string][] = [
      ['Score', fmt(stats.score)],
      ['Best', fmt(stats.best)],
      ['Distance', `${stats.distanceKm.toFixed(2)} km`],
      ['Time', fmtTime(stats.time)],
      ['Top speed', `${Math.round(stats.topSpeed)} km/h`],
      ['Average speed', `${Math.round(stats.averageSpeed)} km/h`],
      ['Near misses', `${stats.nearMisses} (${stats.closeCalls} close)`],
      ['Best combo', `×${stats.maxCombo}`],
      ['Time above 100 km/h', fmtTime(stats.highSpeedTime)],
    ];
    for (const [k, v] of rows) {
      const row = el('div', 'stat', this.overStats);
      el('span', 'stat-label', row, k);
      el('span', 'stat-value', row, v);
    }
    this.show('gameover');
  }
}
