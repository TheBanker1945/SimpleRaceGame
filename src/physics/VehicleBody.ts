import type { VehiclePhysics } from '../vehicle/VehiclePhysics.ts';
import type { Body2D } from './Collision.ts';

/** Copies the player's road-frame state into a collision body. */
export function vehicleToBody(car: VehiclePhysics, out: Body2D): Body2D {
  const c = Math.cos(car.psi);
  const s = Math.sin(car.psi);
  // Forward = (−sinψ, cosψ), left = (−cosψ, −sinψ) in the collision frame (X = −d, Y = s).
  out.x = -car.d;
  out.y = car.s;
  out.angle = car.psi;
  out.vx = -car.u * s - car.v * c;
  out.vy = car.u * c - car.v * s;
  out.omega = car.r;
  out.invMass = 1 / car.cfg.mass;
  out.invInertia = 1 / car.cfg.yawInertia;
  out.hl = car.cfg.halfLength;
  out.hw = car.cfg.halfWidth;
  return out;
}

/** Writes a collision body's post-impact state back to the vehicle. */
export function bodyToVehicle(b: Body2D, car: VehiclePhysics): void {
  const c = Math.cos(car.psi);
  const s = Math.sin(car.psi);
  car.d = -b.x;
  car.s = b.y;
  car.u = -b.vx * s + b.vy * c;
  car.v = -b.vx * c - b.vy * s;
  car.r = b.omega;
}
