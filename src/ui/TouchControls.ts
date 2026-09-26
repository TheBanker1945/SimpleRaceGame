import type { Input, TouchControl } from '../input/Input.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

/** True on phones and tablets (a touch screen is the main pointer). */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(pointer: fine)').matches);
}

type DeviceOrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * On-screen controls for phones and tablets in landscape:
 *  - bottom left: steering pad (◀ ▶); a finger can slide between the two halves,
 *  - bottom right: BRAKE and GAS pedals, handbrake above, +/− shift buttons (manual gearbox),
 *  - top right: pause and camera buttons.
 * Every control supports multi-touch through pointer capture, so gas + steer + handbrake
 * can be held at the same time. Tilt steering (optional) reads the phone's roll in landscape.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private readonly input: Input;
  private readonly steerPad: HTMLElement;
  private readonly steerLeft: HTMLElement;
  private readonly steerRight: HTMLElement;
  private readonly shiftBox: HTMLElement;
  private readonly tiltHint: HTMLElement;
  private readonly steerPointers = new Map<number, -1 | 1>();
  private tiltEnabled = false;
  private tiltListener: ((e: DeviceOrientationEvent) => void) | null = null;
  private tiltSeen = false;

  constructor(parent: HTMLElement, input: Input) {
    this.input = input;
    this.root = el('div', 'touch-controls hidden', parent);

    // Steering pad
    this.steerPad = el('div', 'touch-steer', this.root);
    this.steerLeft = el('div', 'touch-btn touch-steer-left', this.steerPad);
    this.steerLeft.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4 7 12l8.5 8" /></svg>';
    this.steerRight = el('div', 'touch-btn touch-steer-right', this.steerPad);
    this.steerRight.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 4 17 12l-8.5 8" /></svg>';
    this.bindSteerPad();

    // Pedals and handbrake
    const pedals = el('div', 'touch-pedals', this.root);
    this.shiftBox = el('div', 'touch-shift hidden', pedals);
    this.actionButton(this.shiftBox, 'touch-btn touch-small', '+', 'shiftUp');
    this.actionButton(this.shiftBox, 'touch-btn touch-small', '−', 'shiftDown');
    const brakeCol = el('div', 'touch-col', pedals);
    this.holdButton(brakeCol, 'touch-btn touch-hb', 'HB', 'handbrake');
    this.holdButton(brakeCol, 'touch-btn touch-pedal touch-brake', 'BRAKE', 'brake');
    this.holdButton(pedals, 'touch-btn touch-pedal touch-gas', 'GAS', 'throttle');

    // Top-right utility buttons
    const top = el('div', 'touch-top', this.root);
    this.actionButton(top, 'touch-btn touch-icon', '', 'camera').innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v10H3zM14 10l6-3v10l-6-3" /></svg>';
    this.actionButton(top, 'touch-btn touch-icon', '', 'pause').innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>';

    this.tiltHint = el('div', 'touch-tilt-hint hidden', this.root, 'TILT TO STEER');

    // Never let the page scroll, zoom or show a context menu under the controls.
    for (const t of ['touchstart', 'touchmove', 'contextmenu'] as const) {
      this.root.addEventListener(t, (e) => e.preventDefault(), { passive: false });
    }
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) {
      this.input.releaseTouch();
      this.steerPointers.clear();
      this.steerLeft.classList.remove('active');
      this.steerRight.classList.remove('active');
    }
  }

  setManual(manual: boolean): void {
    this.shiftBox.classList.toggle('hidden', !manual);
  }

  /** Switches between button and tilt steering. Call from a user gesture (iOS asks permission). */
  setTilt(enabled: boolean): void {
    this.tiltEnabled = enabled;
    this.steerPad.classList.toggle('hidden', enabled);
    this.tiltHint.classList.toggle('hidden', !enabled);
    if (!enabled) {
      if (this.tiltListener) window.removeEventListener('deviceorientation', this.tiltListener);
      this.tiltListener = null;
      this.input.setTilt(null);
      return;
    }
    if (this.tiltListener) return;
    const Ctor = (window as unknown as { DeviceOrientationEvent?: DeviceOrientationPermission }).DeviceOrientationEvent;
    const listen = (): void => {
      this.tiltListener = (e) => this.onOrientation(e);
      window.addEventListener('deviceorientation', this.tiltListener);
    };
    if (Ctor?.requestPermission) {
      Ctor.requestPermission()
        .then((state) => {
          if (state === 'granted') listen();
          else this.fallBackToButtons();
        })
        .catch(() => this.fallBackToButtons());
    } else {
      listen();
    }
  }

  private fallBackToButtons(): void {
    this.tiltEnabled = false;
    this.steerPad.classList.remove('hidden');
    this.tiltHint.classList.add('hidden');
  }

  private onOrientation(e: DeviceOrientationEvent): void {
    if (!this.tiltEnabled || e.beta === null) return;
    if (!this.tiltSeen) {
      this.tiltSeen = true;
      this.tiltHint.classList.add('fade');
    }
    const angle = screenAngle();
    // In landscape, rolling the phone like a steering wheel changes beta.
    let tilt = angle === 90 ? -e.beta : angle === 270 ? e.beta : -(e.gamma ?? 0);
    const dead = 2.5;
    const full = 24;
    const mag = Math.max(0, Math.abs(tilt) - dead) / (full - dead);
    tilt = Math.sign(tilt) * Math.min(1, mag);
    this.input.setTilt(tilt);
  }

  private bindSteerPad(): void {
    const update = (): void => {
      let dir = 0;
      for (const d of this.steerPointers.values()) dir = d;
      this.input.setTouch('left', dir === -1);
      this.input.setTouch('right', dir === 1);
      this.steerLeft.classList.toggle('active', dir === -1);
      this.steerRight.classList.toggle('active', dir === 1);
    };
    const dirAt = (x: number): -1 | 1 => {
      const r = this.steerPad.getBoundingClientRect();
      return x < r.left + r.width / 2 ? -1 : 1;
    };
    this.steerPad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(this.steerPad, e.pointerId);
      this.steerPointers.set(e.pointerId, dirAt(e.clientX));
      update();
    });
    this.steerPad.addEventListener('pointermove', (e) => {
      if (!this.steerPointers.has(e.pointerId)) return;
      this.steerPointers.set(e.pointerId, dirAt(e.clientX));
      update();
    });
    const end = (e: PointerEvent): void => {
      if (this.steerPointers.delete(e.pointerId)) update();
    };
    this.steerPad.addEventListener('pointerup', end);
    this.steerPad.addEventListener('pointercancel', end);
    this.steerPad.addEventListener('lostpointercapture', end);
  }

  private holdButton(parent: HTMLElement, cls: string, label: string, control: TouchControl): HTMLElement {
    const b = el('div', cls, parent, label);
    const pointers = new Set<number>();
    const refresh = (): void => {
      this.input.setTouch(control, pointers.size > 0);
      b.classList.toggle('active', pointers.size > 0);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(b, e.pointerId);
      pointers.add(e.pointerId);
      refresh();
    });
    const end = (e: PointerEvent): void => {
      if (pointers.delete(e.pointerId)) refresh();
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
    return b;
  }

  private actionButton(parent: HTMLElement, cls: string, label: string, action: Parameters<Input['press']>[0]): HTMLElement {
    const b = el('div', cls, parent, label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('active');
      this.input.press(action);
    });
    const end = (): void => b.classList.remove('active');
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('pointerleave', end);
    return b;
  }
}

/** Keeps receiving a finger's events even if it slides off the button. */
function capture(target: HTMLElement, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Synthetic or already-released pointers can't be captured; the press still counts.
  }
}

/** Screen rotation in degrees (0, 90, 180, 270). */
export function screenAngle(): number {
  const o = typeof screen !== 'undefined' ? screen.orientation : undefined;
  if (o && typeof o.angle === 'number') return ((o.angle % 360) + 360) % 360;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? ((legacy % 360) + 360) % 360 : 0;
}
