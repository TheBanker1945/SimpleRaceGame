import type { Quality } from '../render/Renderer.ts';
import { DEFAULT_CAR, getCar, isCarId, type CarId } from '../vehicle/CarCatalog.ts';
import type { TransmissionMode } from '../vehicle/Gearbox.ts';
import type { TimeOfDay } from '../world/Environment.ts';

/** On touch screens: steer with on-screen buttons or by tilting the phone like a wheel. */
export type SteeringMode = 'buttons' | 'tilt';

export interface Settings {
  transmission: TransmissionMode;
  quality: Quality;
  /** Master volume 0..1. */
  volume: number;
  timeOfDay: TimeOfDay;
  /** ABS, traction control and stability control. */
  assists: boolean;
  /** Selected car. */
  car: CarId;
  /** Paint chosen per car (hex); cars without an entry wear their default colour. */
  paints: Partial<Record<CarId, number>>;
  steering: SteeringMode;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  transmission: 'automatic',
  quality: 'medium',
  volume: 0.7,
  timeOfDay: 'day',
  assists: true,
  car: DEFAULT_CAR,
  paints: {},
  steering: 'buttons',
  showFps: false,
};

export const PAINT_OPTIONS: { name: string; color: number }[] = [
  { name: 'Rosso', color: 0xb3121b },
  { name: 'Midnight', color: 0x1a2a52 },
  { name: 'Silver', color: 0xa9adb3 },
  { name: 'Racing Green', color: 0x14452f },
  { name: 'Sunburst', color: 0xe07a12 },
  { name: 'Electric Blue', color: 0x2b6cc4 },
  { name: 'Lime', color: 0x7fb800 },
  { name: 'Onyx', color: 0x111214 },
  { name: 'Pearl', color: 0xe8e8e4 },
];

/** Paint the given car should wear. */
export function paintFor(s: Settings, car: CarId): number {
  return s.paints[car] ?? getCar(car).defaultPaint;
}

const SETTINGS_KEY = 'redline-highway.settings.v1';
const BEST_KEY = 'redline-highway.best.v1';

const QUALITIES: Quality[] = ['low', 'medium', 'high'];
const TIMES: TimeOfDay[] = ['day', 'sunset', 'night'];

/** Safe localStorage access (private mode or disabled storage must not break the game). */
function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, paints: {} };
  const raw = storage()?.getItem(SETTINGS_KEY);
  if (!raw) return s;
  try {
    const data = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    if (data.transmission === 'automatic' || data.transmission === 'manual') s.transmission = data.transmission;
    if (typeof data.quality === 'string' && (QUALITIES as string[]).includes(data.quality)) s.quality = data.quality as Quality;
    if (typeof data.volume === 'number' && data.volume >= 0 && data.volume <= 1) s.volume = data.volume;
    if (typeof data.timeOfDay === 'string' && (TIMES as string[]).includes(data.timeOfDay)) s.timeOfDay = data.timeOfDay as TimeOfDay;
    if (typeof data.assists === 'boolean') s.assists = data.assists;
    if (isCarId(data.car)) s.car = data.car;
    if (data.paints && typeof data.paints === 'object') {
      const paints: Settings['paints'] = {};
      for (const [id, color] of Object.entries(data.paints as Record<string, unknown>)) {
        if (isCarId(id) && typeof color === 'number' && Number.isInteger(color) && color >= 0 && color <= 0xffffff) paints[id] = color;
      }
      s.paints = paints;
    }
    // v1 stored a single paint for the only car there was.
    const legacy = (data as { paint?: unknown }).paint;
    if (typeof legacy === 'number' && s.paints.kestrel === undefined) s.paints = { ...s.paints, kestrel: legacy };
    if (data.steering === 'buttons' || data.steering === 'tilt') s.steering = data.steering;
    if (typeof data.showFps === 'boolean') s.showFps = data.showFps;
  } catch {
    // Corrupt settings: fall back to defaults.
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage full or unavailable; settings just won't persist.
  }
}

export function loadBestScore(): number {
  const raw = storage()?.getItem(BEST_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function saveBestScore(score: number): void {
  try {
    storage()?.setItem(BEST_KEY, String(Math.floor(score)));
  } catch {
    // Ignore storage failures.
  }
}
