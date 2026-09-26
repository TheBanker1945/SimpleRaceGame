import type { Quality } from '../render/Renderer.ts';
import type { TransmissionMode } from '../vehicle/Gearbox.ts';
import type { TimeOfDay } from '../world/Environment.ts';

export interface Settings {
  transmission: TransmissionMode;
  quality: Quality;
  /** Master volume 0..1. */
  volume: number;
  timeOfDay: TimeOfDay;
  /** ABS, traction control and stability control. */
  assists: boolean;
  /** Player car paint (hex). */
  paint: number;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  transmission: 'automatic',
  quality: 'medium',
  volume: 0.7,
  timeOfDay: 'day',
  assists: true,
  paint: 0xb3121b,
  showFps: false,
};

export const PAINT_OPTIONS: { name: string; color: number }[] = [
  { name: 'Rosso', color: 0xb3121b },
  { name: 'Midnight', color: 0x1a2a52 },
  { name: 'Silver', color: 0xa9adb3 },
  { name: 'Racing Green', color: 0x14452f },
  { name: 'Sunburst', color: 0xe07a12 },
  { name: 'Onyx', color: 0x111214 },
  { name: 'Pearl', color: 0xe8e8e4 },
];

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
  const s = { ...DEFAULT_SETTINGS };
  const raw = storage()?.getItem(SETTINGS_KEY);
  if (!raw) return s;
  try {
    const data = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    if (data.transmission === 'automatic' || data.transmission === 'manual') s.transmission = data.transmission;
    if (typeof data.quality === 'string' && (QUALITIES as string[]).includes(data.quality)) s.quality = data.quality as Quality;
    if (typeof data.volume === 'number' && data.volume >= 0 && data.volume <= 1) s.volume = data.volume;
    if (typeof data.timeOfDay === 'string' && (TIMES as string[]).includes(data.timeOfDay)) s.timeOfDay = data.timeOfDay as TimeOfDay;
    if (typeof data.assists === 'boolean') s.assists = data.assists;
    if (typeof data.paint === 'number') s.paint = data.paint;
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
