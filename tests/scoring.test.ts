import { describe, expect, it } from 'vitest';
import { COMBO_WINDOW, MAX_COMBO, Scoring } from '../src/core/Scoring.ts';

describe('scoring', () => {
  it('awards distance points (1 per 10 m) below 100 km/h', () => {
    const s = new Scoring();
    s.update(1, 25, 90);
    expect(s.score).toBeCloseTo(2.5);
    expect(s.distance).toBe(25);
  });

  it('multiplies distance points above 100 km/h', () => {
    expect(Scoring.speedMultiplier(80)).toBe(1);
    expect(Scoring.speedMultiplier(200)).toBeCloseTo(2);
    expect(Scoring.speedMultiplier(280)).toBeCloseTo(2.8);
    const s = new Scoring();
    s.update(1, 55.6, 200);
    expect(s.score).toBeCloseTo(11.12);
    expect(s.highSpeedTime).toBe(1);
  });

  it('does not score reversing', () => {
    const s = new Scoring();
    s.update(1, -5, 18);
    expect(s.score).toBe(0);
  });

  it('builds a near-miss combo inside the window and caps it', () => {
    const s = new Scoring();
    expect(s.nearMiss(1).points).toBe(150);
    expect(s.nearMiss(1).points).toBe(300);
    expect(s.combo).toBe(2);
    for (let i = 0; i < 20; i++) s.nearMiss(1);
    expect(s.combo).toBe(MAX_COMBO);
    expect(s.maxCombo).toBe(MAX_COMBO);
  });

  it('pays extra for close calls', () => {
    const s = new Scoring();
    const r = s.nearMiss(0.3);
    expect(r.close).toBe(true);
    expect(r.points).toBe(225);
  });

  it('drops the combo after the window or on a collision', () => {
    const s = new Scoring();
    s.nearMiss(1);
    s.nearMiss(1);
    s.update(COMBO_WINDOW + 0.1, 0, 50);
    expect(s.combo).toBe(0);
    s.nearMiss(1);
    s.collision();
    expect(s.combo).toBe(0);
    expect(s.nearMiss(1).points).toBe(150);
  });

  it('tracks top and average speed', () => {
    const s = new Scoring();
    s.update(10, 500, 180);
    s.update(10, 300, 110);
    expect(s.topSpeedKmh).toBe(180);
    expect(s.averageSpeedKmh).toBeCloseTo(144);
  });
});
