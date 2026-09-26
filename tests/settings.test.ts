import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadBestScore, loadSettings, paintFor, saveBestScore, saveSettings } from '../src/core/Settings.ts';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

describe('settings persistence', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadBestScore()).toBe(0);
  });

  it('round-trips settings and the best score', () => {
    saveSettings({ ...DEFAULT_SETTINGS, transmission: 'manual', quality: 'high', volume: 0.3, timeOfDay: 'night', assists: false });
    const s = loadSettings();
    expect(s.transmission).toBe('manual');
    expect(s.quality).toBe('high');
    expect(s.volume).toBe(0.3);
    expect(s.timeOfDay).toBe('night');
    expect(s.assists).toBe(false);
    saveBestScore(12345.7);
    expect(loadBestScore()).toBe(12345);
  });

  it('remembers the car and a paint per car, and migrates the old single paint', () => {
    saveSettings({ ...DEFAULT_SETTINGS, car: 'vortex', paints: { vortex: 0x123456 }, steering: 'tilt' });
    const s = loadSettings();
    expect(s.car).toBe('vortex');
    expect(s.paints.vortex).toBe(0x123456);
    expect(s.steering).toBe('tilt');
    expect(paintFor(s, 'vortex')).toBe(0x123456);
    expect(paintFor(s, 'sprite')).toBe(0x2b6cc4);
    localStorage.setItem('redline-highway.settings.v1', '{"paint":1193046,"car":"lambo","paints":{"falco":"red","nope":1}}');
    const legacy = loadSettings();
    expect(legacy.car).toBe('kestrel');
    expect(legacy.paints).toEqual({ kestrel: 1193046 });
  });

  it('ignores corrupt or invalid stored values', () => {
    localStorage.setItem('redline-highway.settings.v1', '{"quality":"ultra","volume":7,"transmission":"cvt"}');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem('redline-highway.settings.v1', 'not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem('redline-highway.best.v1', 'NaN');
    expect(loadBestScore()).toBe(0);
  });

  it('works without localStorage at all', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveBestScore(10)).not.toThrow();
  });
});
