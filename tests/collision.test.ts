import { describe, expect, it } from 'vitest';
import { collideWithBarriers, createBody, createContact, obbContact, resolveContact, type Body2D } from '../src/physics/Collision.ts';
import { bodyToVehicle, vehicleToBody } from '../src/physics/VehicleBody.ts';
import { DEFAULT_VEHICLE } from '../src/vehicle/VehicleConfig.ts';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.ts';

const car = (x: number, y: number, angle = 0, vy = 0, mass = 1500): Body2D => {
  const b = createBody();
  b.x = x;
  b.y = y;
  b.angle = angle;
  b.vy = vy;
  b.invMass = 1 / mass;
  b.invInertia = 1 / 2500;
  b.hl = 2.3;
  b.hw = 0.95;
  return b;
};

describe('oriented box contact', () => {
  it('detects overlap and separation', () => {
    const c = createContact();
    expect(obbContact(car(0, 0), car(0, 4), c)).toBe(true);
    expect(obbContact(car(0, 0), car(0, 4.7), c)).toBe(false);
    expect(obbContact(car(0, 0), car(1.8, 0), c)).toBe(true);
    expect(obbContact(car(0, 0), car(2, 0), c)).toBe(false);
  });

  it('normal points from A to B along the shallowest axis', () => {
    const c = createContact();
    obbContact(car(0, 0), car(0, 4.4), c);
    expect(c.ny).toBeCloseTo(1);
    expect(c.depth).toBeCloseTo(0.2);
  });

  it('handles rotated boxes', () => {
    const c = createContact();
    // A car rotated 90° is 4.6 m wide along X.
    expect(obbContact(car(0, 0, Math.PI / 2), car(3.1, 0), c)).toBe(true);
    expect(obbContact(car(0, 0, Math.PI / 2), car(3.4, 0), c)).toBe(false);
  });
});

describe('impulse resolution', () => {
  it('conserves momentum in a rear-end collision and slows the faster car', () => {
    const a = car(0, 0, 0, 30);
    const b = car(0, 4.5, 0, 20);
    const c = createContact();
    expect(obbContact(a, b, c)).toBe(true);
    const out = { closingSpeed: 0, impulse: 0 };
    resolveContact(a, b, c, 0.2, 0.3, out);
    expect(out.closingSpeed).toBeCloseTo(10, 0);
    expect(a.vy + b.vy).toBeCloseTo(50, 5);
    expect(a.vy).toBeLessThan(30);
    expect(b.vy).toBeGreaterThan(20);
  });

  it('an off-center hit makes the car spin', () => {
    const a = car(0, 0, 0, 25);
    const b = car(1.4, 4.4, 0, 0, 3000);
    const c = createContact();
    expect(obbContact(a, b, c)).toBe(true);
    resolveContact(a, b, c, 0.2, 0.3, { closingSpeed: 0, impulse: 0 });
    expect(Math.abs(a.omega)).toBeGreaterThan(0.1);
  });

  it('does nothing when bodies are already separating', () => {
    const a = car(0, 0, 0, 10);
    const b = car(0, 4.5, 0, 20);
    const c = createContact();
    obbContact(a, b, c);
    const out = { closingSpeed: 0, impulse: 0 };
    resolveContact(a, b, c, 0.2, 0.3, out);
    expect(out.impulse).toBe(0);
    expect(a.vy).toBe(10);
  });
});

describe('barriers', () => {
  it('bounces a car off the left barrier and scrubs speed', () => {
    // Heading 10° to the left (+d) at 50 m/s, overlapping the left barrier at d = 8.5.
    const b = car(-7.8, 0, 0.17, 0);
    b.vx = -50 * Math.sin(0.17);
    b.vy = 50 * Math.cos(0.17);
    const out = { closingSpeed: 0, impulse: 0 };
    const contact = createContact();
    const hit = collideWithBarriers(b, 8.5, -10, 0.2, 0.4, out, contact);
    expect(hit).toBe(true);
    expect(out.closingSpeed).toBeGreaterThan(5);
    // The contact point no longer moves into the wall...
    const pointVx = b.vx - b.omega * (contact.py - b.y);
    expect(pointVx).toBeGreaterThanOrEqual(-1e-6);
    // ...the car is turned away from the barrier (clockwise = to the right) and loses speed.
    expect(b.omega).toBeLessThan(0);
    expect(b.vy).toBeLessThan(50 * Math.cos(0.17));
    // And it has been pushed back out of the barrier.
    expect(b.x - Math.sin(0.17) * 2.3 - Math.cos(0.17) * 0.95).toBeGreaterThan(-8.5 - 0.01);
  });

  it('leaves a car in its lane untouched', () => {
    const b = car(0, 0, 0, 30);
    expect(collideWithBarriers(b, 8.5, -10, 0.2, 0.4, { closingSpeed: 0, impulse: 0 }, createContact())).toBe(false);
    expect(b.vy).toBe(30);
  });
});

describe('vehicle ↔ body conversion', () => {
  it('round-trips the vehicle state', () => {
    const v = new VehiclePhysics(DEFAULT_VEHICLE);
    v.reset(100, 2, 30);
    v.psi = 0.3;
    v.v = 1.5;
    v.r = 0.2;
    const b = vehicleToBody(v, createBody());
    // Along-road velocity should match the Frenet projection.
    expect(b.vy).toBeCloseTo(v.u * Math.cos(0.3) - v.v * Math.sin(0.3));
    expect(-b.vx).toBeCloseTo(v.u * Math.sin(0.3) + v.v * Math.cos(0.3));
    const u = v.u;
    const lat = v.v;
    bodyToVehicle(b, v);
    expect(v.u).toBeCloseTo(u);
    expect(v.v).toBeCloseTo(lat);
    expect(v.s).toBe(100);
    expect(v.d).toBe(2);
  });
});
