import { paintFor, PAINT_OPTIONS, type Settings } from '../core/Settings.ts';
import { CARS, getCar, type CarId } from '../vehicle/CarCatalog.ts';

export type MenuScreen = 'start' | 'pause' | 'gameover' | 'settings' | 'controls' | 'garage' | null;

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
  /** The garage is showing a different car (live preview). */
  carChanged(id: CarId): void;
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

const TOUCH_CONTROLS: [string, string][] = [
  ['Steer', '◀ ▶ buttons, bottom left (or tilt the phone, see Settings)'],
  ['Throttle', 'GAS pedal, bottom right'],
  ['Brake / reverse', 'BRAKE pedal (hold at a standstill to reverse)'],
  ['Handbrake', 'HB button above the pedals'],
  ['Shift (manual)', '+ / − buttons next to the pedals'],
  ['Camera / pause', 'Buttons at the top right'],
];

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** DOM overlay menus. All game actions go through the callbacks. */
export class Menus {
  private readonly root: HTMLElement;
  private readonly screens = new Map<Exclude<MenuScreen, null>, HTMLElement>();
  private current: MenuScreen = null;
  private returnTo: MenuScreen = 'start';
  private readonly settings: Settings;
  private readonly cb: MenuCallbacks;
  private readonly touch: boolean;
  private readonly startBest: HTMLElement;
  private readonly startCar: HTMLElement;
  private readonly overStats: HTMLElement;
  private readonly overTitle: HTMLElement;
  private readonly overReason: HTMLElement;
  private readonly overBadge: HTMLElement;
  private readonly settingControls: (() => void)[] = [];
  private readonly garageRefresh: () => void;

  constructor(parent: HTMLElement, settings: Settings, callbacks: MenuCallbacks, touch: boolean) {
    this.settings = settings;
    this.cb = callbacks;
    this.touch = touch;
    this.root = el('div', 'menus', parent);

    // ------------------------------------------------------------ start
    const start = this.screen('start');
    const title = el('div', 'title-block', start);
    el('div', 'title-kicker', title, 'ENDLESS HIGHWAY');
    el('h1', 'title', title, 'REDLINE');
    el('div', 'title-sub', title, 'Weave through traffic at 300 km/h. Near misses build combos. Don’t crash.');
    const startButtons = el('div', 'menu-buttons', start);
    this.button(startButtons, 'DRIVE', () => this.cb.start(), 'primary', 'Enter');
    const garageButton = this.button(startButtons, 'GARAGE', () => this.open('garage', 'start'), 'garage-button', 'G');
    this.startCar = el('span', 'menu-car', garageButton, '');
    garageButton.insertBefore(this.startCar, garageButton.lastChild);
    this.button(startButtons, 'SETTINGS', () => this.open('settings', 'start'));
    this.button(startButtons, 'CONTROLS', () => this.open('controls', 'start'));
    this.startBest = el('div', 'menu-best', start, '');
    el('div', 'menu-hint', start, touch ? 'Touch controls · Play in landscape · Headphones recommended' : 'Keyboard or gamepad · Headphones recommended');

    // ------------------------------------------------------------ garage
    const garage = this.screen('garage');
    const head = el('div', 'garage-head', garage);
    el('div', 'title-kicker', head, 'GARAGE · CHOOSE YOUR CAR');
    const nav = el('div', 'garage-nav', garage);
    const prev = el('button', 'garage-arrow', nav, '◀');
    prev.setAttribute('aria-label', 'Previous car');
    const nameBlock = el('div', 'garage-name-block', nav);
    const category = el('div', 'garage-category', nameBlock, '');
    const name = el('h2', 'garage-name', nameBlock, '');
    const next = el('button', 'garage-arrow', nav, '▶');
    next.setAttribute('aria-label', 'Next car');
    const dots = el('div', 'garage-dots', garage);
    const dotEls = CARS.map((c) => {
      const d = el('button', 'garage-dot', dots);
      d.title = c.name;
      d.setAttribute('aria-label', c.name);
      d.addEventListener('click', () => {
        this.cb.click();
        this.selectCar(c.id);
      });
      return d;
    });
    const desc = el('p', 'garage-desc', garage, '');
    const specs = el('div', 'garage-specs', garage);
    const ratings = el('div', 'garage-ratings', garage);
    const paintRow = el('div', 'garage-paint', garage);
    el('div', 'setting-label', paintRow, 'Paint');
    const swatchWrap = el('div', 'swatches', paintRow);
    const swatches = PAINT_OPTIONS.map((p) => {
      const b = el('button', 'swatch', swatchWrap);
      b.title = p.name;
      b.setAttribute('aria-label', p.name);
      b.style.background = hex(p.color);
      b.addEventListener('click', () => {
        this.cb.click();
        this.settings.paints = { ...this.settings.paints, [this.settings.car]: p.color };
        this.garageRefresh();
        this.cb.settingsChanged(this.settings, 'paints');
      });
      return { b, color: p.color };
    });
    const garageButtons = el('div', 'menu-buttons row', garage);
    this.button(garageButtons, 'DRIVE', () => this.cb.start(), 'primary', 'Enter');
    this.button(garageButtons, 'BACK', () => this.back(), '', 'Esc');
    prev.addEventListener('click', () => {
      this.cb.click();
      this.garageStep(-1);
    });
    next.addEventListener('click', () => {
      this.cb.click();
      this.garageStep(1);
    });
    this.garageRefresh = () => {
      const car = getCar(this.settings.car);
      category.textContent = car.category;
      name.textContent = car.name;
      desc.textContent = car.description;
      dotEls.forEach((d, i) => d.classList.toggle('active', CARS[i].id === car.id));
      specs.replaceChildren();
      const rows: [string, string][] = [
        ['Power', `${car.specs.powerHp} hp`],
        ['Torque', `${car.specs.torqueNm} Nm`],
        ['0–100 km/h', `${car.specs.zeroToHundred.toFixed(1)} s`],
        ['Top speed', `${car.specs.topSpeedKmh} km/h`],
        ['Weight', `${fmt(car.specs.weightKg)} kg`],
        ['Gearbox', `${car.specs.gears}-speed`],
        ['Engine', car.specs.engine],
        ['Layout', car.specs.layout],
      ];
      for (const [k, v] of rows) {
        const row = el('div', 'garage-spec', specs);
        el('span', 'stat-label', row, k);
        el('span', 'stat-value', row, v);
      }
      ratings.replaceChildren();
      const bars: [string, number][] = [
        ['Speed', car.ratings.speed],
        ['Acceleration', car.ratings.acceleration],
        ['Handling', car.ratings.handling],
        ['Braking', car.ratings.braking],
      ];
      for (const [k, v] of bars) {
        const row = el('div', 'garage-rating', ratings);
        el('span', 'stat-label', row, k);
        const bar = el('span', 'garage-bar', row);
        const fill = el('span', 'garage-bar-fill', bar);
        fill.style.transform = `scaleX(${v})`;
      }
      const paint = paintFor(this.settings, car.id);
      for (const s of swatches) s.b.classList.toggle('active', s.color === paint);
      this.startCar.textContent = car.name.toUpperCase();
    };

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
    if (touch) {
      this.segmented(grid, 'Steering', 'steering', [
        ['buttons', 'Buttons'],
        ['tilt', 'Tilt phone'],
      ]);
    }
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
    const headRow = el('tr', '', table);
    if (touch) {
      el('th', '', headRow, 'Action');
      el('th', '', headRow, 'Touch');
      for (const [action, how] of TOUCH_CONTROLS) {
        const row = el('tr', '', table);
        el('td', '', row, action);
        el('td', '', row, how);
      }
    } else {
      el('th', '', headRow, 'Action');
      el('th', '', headRow, 'Keyboard');
      el('th', '', headRow, 'Gamepad');
      for (const [action, key, pad] of CONTROLS) {
        const row = el('tr', '', table);
        el('td', '', row, action);
        el('td', 'key', row, key);
        el('td', 'key', row, pad);
      }
    }
    el(
      'p',
      'controls-note',
      ctl,
      'Automatic gearbox: hold brake at a standstill to reverse. Speed-sensitive steering: the faster you go, the less lock you get — small inputs at 250 km/h.',
    );
    const ctlButtons = el('div', 'menu-buttons', ctl);
    this.button(ctlButtons, 'BACK', () => this.back(), 'primary', 'Esc');

    this.garageRefresh();
  }

  get activeScreen(): MenuScreen {
    return this.current;
  }

  get isTouch(): boolean {
    return this.touch;
  }

  private screen(name: Exclude<MenuScreen, null>): HTMLElement {
    const s = el('div', `menu-screen menu-${name}`, this.root);
    this.screens.set(name, s);
    return s;
  }

  private button(parent: HTMLElement, label: string, action: () => void, variant = '', hint = ''): HTMLButtonElement {
    const b = el('button', `menu-button ${variant}`, parent);
    el('span', 'menu-label', b, label);
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

  /** Shows the previous/next car in the garage. */
  garageStep(dir: number): void {
    const i = CARS.findIndex((c) => c.id === this.settings.car);
    const n = CARS.length;
    this.selectCar(CARS[(((i + dir) % n) + n) % n].id);
  }

  private selectCar(id: CarId): void {
    if (id === this.settings.car) return;
    this.settings.car = id;
    this.garageRefresh();
    this.cb.carChanged(id);
    this.cb.settingsChanged(this.settings, 'car');
  }

  open(screen: Exclude<MenuScreen, null>, returnTo: MenuScreen): void {
    this.returnTo = returnTo;
    for (const r of this.settingControls) r();
    if (screen === 'garage') this.garageRefresh();
    this.show(screen);
  }

  /** Goes back from settings/controls/garage. Returns true if it handled the request. */
  back(): boolean {
    if (this.current === 'settings' || this.current === 'controls' || this.current === 'garage') {
      this.show(this.returnTo);
      return true;
    }
    return false;
  }

  show(screen: MenuScreen): void {
    this.current = screen;
    for (const [name, s] of this.screens) s.classList.toggle('visible', name === screen);
    this.root.classList.toggle('visible', screen !== null);
    this.root.classList.toggle('garage-open', screen === 'garage');
  }

  showStart(best: number): void {
    this.startBest.textContent = best > 0 ? `BEST SCORE  ${fmt(best)}` : '';
    this.garageRefresh();
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
