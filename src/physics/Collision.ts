/**
 * 2D rigid-body collision in the local road plane.
 *
 * Frame: X = −d (to the right of the road), Y = s (along the road). In this frame a
 * heading ψ (positive = left) is an ordinary counter-clockwise angle, and yaw rate r
 * is the angular velocity. Road curvature is ignored locally (radius ≥ 900 m versus
 * car-sized contacts), which keeps the math exact enough and cheap.
 */
export interface Body2D {
  x: number;
  y: number;
  /** Heading (rad, CCW, 0 = facing +Y). */
  angle: number;
  vx: number;
  vy: number;
  omega: number;
  /** 1/mass (0 = immovable). */
  invMass: number;
  /** 1/yaw inertia (0 = cannot rotate). */
  invInertia: number;
  /** Half length (along heading) and half width. */
  hl: number;
  hw: number;
}

export interface Contact {
  /** Unit normal pointing from body A to body B. */
  nx: number;
  ny: number;
  depth: number;
  /** Contact point. */
  px: number;
  py: number;
}

export interface ImpactResult {
  /** Closing speed along the normal before the impulse (m/s, ≥ 0). */
  closingSpeed: number;
  /** Normal impulse magnitude (N·s). */
  impulse: number;
}

export const createBody = (): Body2D => ({ x: 0, y: 0, angle: 0, vx: 0, vy: 0, omega: 0, invMass: 0, invInertia: 0, hl: 1, hw: 1 });
export const createContact = (): Contact => ({ nx: 0, ny: 0, depth: 0, px: 0, py: 0 });

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Forward and left unit axes of a body. */
function axes(b: Body2D, out: number[]): void {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  out[0] = -s; // forward x
  out[1] = c; // forward y
  out[2] = -c; // left x
  out[3] = -s; // left y
}

const axA = [0, 0, 0, 0];
const axB = [0, 0, 0, 0];

function projectRadius(ax: number[], hl: number, hw: number, nx: number, ny: number): number {
  return hl * Math.abs(ax[0] * nx + ax[1] * ny) + hw * Math.abs(ax[2] * nx + ax[3] * ny);
}

/** Vertex of `b` that lies furthest along (dx, dy). */
function supportPoint(b: Body2D, ax: number[], dx: number, dy: number, out: number[]): void {
  const sf = ax[0] * dx + ax[1] * dy >= 0 ? 1 : -1;
  const sl = ax[2] * dx + ax[3] * dy >= 0 ? 1 : -1;
  out[0] = b.x + ax[0] * b.hl * sf + ax[2] * b.hw * sl;
  out[1] = b.y + ax[1] * b.hl * sf + ax[3] * b.hw * sl;
}

const sp = [0, 0];

/**
 * Separating-axis test between two oriented boxes.
 * @returns true and fills `out` when they overlap.
 */
export function obbContact(a: Body2D, b: Body2D, out: Contact): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const reach = a.hl + a.hw + b.hl + b.hw;
  if (dx * dx + dy * dy > reach * reach) return false;
  axes(a, axA);
  axes(b, axB);
  const candidates = [axA[0], axA[1], axA[2], axA[3], axB[0], axB[1], axB[2], axB[3]];
  let bestDepth = Infinity;
  let bestAxis = 0;
  let bestSign = 1;
  for (let k = 0; k < 4; k++) {
    const nx = candidates[k * 2];
    const ny = candidates[k * 2 + 1];
    const ra = projectRadius(axA, a.hl, a.hw, nx, ny);
    const rb = projectRadius(axB, b.hl, b.hw, nx, ny);
    const dist = dx * nx + dy * ny;
    const depth = ra + rb - Math.abs(dist);
    if (depth <= 0) return false;
    if (depth < bestDepth) {
      bestDepth = depth;
      bestAxis = k;
      bestSign = dist >= 0 ? 1 : -1;
    }
  }
  const nx = candidates[bestAxis * 2] * bestSign;
  const ny = candidates[bestAxis * 2 + 1] * bestSign;
  out.nx = nx;
  out.ny = ny;
  out.depth = bestDepth;
  if (bestAxis < 2) {
    // Face of A: the deepest point is B's vertex furthest toward A.
    supportPoint(b, axB, -nx, -ny, sp);
  } else {
    // Face of B: A's vertex furthest toward B.
    supportPoint(a, axA, nx, ny, sp);
  }
  out.px = sp[0];
  out.py = sp[1];
  return true;
}

/**
 * Resolves a contact between two bodies with restitution and Coulomb friction,
 * including angular response (off-center hits make cars spin), then separates them.
 * Uses a few iterations of accumulated, clamped impulses so friction cannot push the
 * contact point back into the other body.
 */
export function resolveContact(a: Body2D, b: Body2D, c: Contact, restitution: number, friction: number, out: ImpactResult): ImpactResult {
  const rax = c.px - a.x;
  const ray = c.py - a.y;
  const rbx = c.px - b.x;
  const rby = c.py - b.y;
  relativeVelocity(a, b, rax, ray, rbx, rby, rv);
  const vn0 = rv[0] * c.nx + rv[1] * c.ny;
  out.closingSpeed = Math.max(0, -vn0);
  out.impulse = 0;

  const totalInvMass = a.invMass + b.invMass;
  if (totalInvMass > 0) {
    // Positional correction: push apart along the normal, split by inverse mass.
    const push = Math.max(0, c.depth - 0.005) / totalInvMass;
    a.x -= c.nx * push * a.invMass;
    a.y -= c.ny * push * a.invMass;
    b.x += c.nx * push * b.invMass;
    b.y += c.ny * push * b.invMass;
  }
  if (vn0 >= 0) return out;

  const raN = cross(rax, ray, c.nx, c.ny);
  const rbN = cross(rbx, rby, c.nx, c.ny);
  const kn = totalInvMass + raN * raN * a.invInertia + rbN * rbN * b.invInertia;
  if (kn <= 0) return out;
  // Friction acts against the initial sliding direction.
  let tx = rv[0] - vn0 * c.nx;
  let ty = rv[1] - vn0 * c.ny;
  const tl = Math.hypot(tx, ty);
  const hasTangent = tl > 1e-6;
  if (hasTangent) {
    tx /= tl;
    ty /= tl;
  }
  const raT = cross(rax, ray, tx, ty);
  const rbT = cross(rbx, rby, tx, ty);
  const kt = totalInvMass + raT * raT * a.invInertia + rbT * rbT * b.invInertia;
  const targetVn = -restitution * vn0;

  let jn = 0;
  let jt = 0;
  for (let iter = 0; iter < 4; iter++) {
    relativeVelocity(a, b, rax, ray, rbx, rby, rv);
    const vn = rv[0] * c.nx + rv[1] * c.ny;
    const newJn = Math.max(0, jn + (targetVn - vn) / kn);
    const dn = newJn - jn;
    jn = newJn;
    applyImpulse(a, b, rax, ray, rbx, rby, c.nx * dn, c.ny * dn);
    if (!hasTangent || kt <= 0) continue;
    relativeVelocity(a, b, rax, ray, rbx, rby, rv);
    const vt = rv[0] * tx + rv[1] * ty;
    const maxF = friction * jn;
    const newJt = Math.min(maxF, Math.max(-maxF, jt - vt / kt));
    const dt = newJt - jt;
    jt = newJt;
    applyImpulse(a, b, rax, ray, rbx, rby, tx * dt, ty * dt);
  }
  // Final normal pass so the contact is never left approaching.
  relativeVelocity(a, b, rax, ray, rbx, rby, rv);
  const vnEnd = rv[0] * c.nx + rv[1] * c.ny;
  if (vnEnd < 0) {
    const dn = -vnEnd / kn;
    jn += dn;
    applyImpulse(a, b, rax, ray, rbx, rby, c.nx * dn, c.ny * dn);
  }
  out.impulse = jn;
  return out;
}

const rv = [0, 0];

function relativeVelocity(a: Body2D, b: Body2D, rax: number, ray: number, rbx: number, rby: number, out: number[]): void {
  out[0] = b.vx - b.omega * rby - (a.vx - a.omega * ray);
  out[1] = b.vy + b.omega * rbx - (a.vy + a.omega * rax);
}

function applyImpulse(a: Body2D, b: Body2D, rax: number, ray: number, rbx: number, rby: number, jx: number, jy: number): void {
  a.vx -= jx * a.invMass;
  a.vy -= jy * a.invMass;
  a.omega -= cross(rax, ray, jx, jy) * a.invInertia;
  b.vx += jx * b.invMass;
  b.vy += jy * b.invMass;
  b.omega += cross(rbx, rby, jx, jy) * b.invInertia;
}

const WALL: Body2D = createBody();
const corner = [0, 0];

/**
 * Collides a body with the two straight barriers that bound the carriageway.
 * In road terms the barriers sit at d = leftD and d = rightD (leftD > rightD);
 * in the collision frame they are the lines X = −leftD and X = −rightD.
 */
export function collideWithBarriers(
  b: Body2D,
  leftD: number,
  rightD: number,
  restitution: number,
  friction: number,
  out: ImpactResult,
  contact: Contact,
): boolean {
  axes(b, axB);
  const wallLeftX = -leftD;
  const wallRightX = -rightD;
  let deepest = 0;
  let side = 0;
  for (let i = 0; i < 4; i++) {
    const sf = i & 1 ? 1 : -1;
    const sl = i & 2 ? 1 : -1;
    corner[0] = b.x + axB[0] * b.hl * sf + axB[2] * b.hw * sl;
    corner[1] = b.y + axB[1] * b.hl * sf + axB[3] * b.hw * sl;
    const penLeft = wallLeftX - corner[0];
    const penRight = corner[0] - wallRightX;
    if (penLeft > deepest) {
      deepest = penLeft;
      side = 1;
      contact.px = corner[0];
      contact.py = corner[1];
    }
    if (penRight > deepest) {
      deepest = penRight;
      side = -1;
      contact.px = corner[0];
      contact.py = corner[1];
    }
  }
  out.closingSpeed = 0;
  out.impulse = 0;
  if (side === 0) return false;
  // The wall is body A (immovable); the normal points from the wall into the car.
  WALL.invMass = 0;
  WALL.invInertia = 0;
  WALL.vx = WALL.vy = WALL.omega = 0;
  WALL.x = contact.px;
  WALL.y = contact.py;
  contact.nx = side === 1 ? 1 : -1;
  contact.ny = 0;
  contact.depth = deepest;
  resolveContact(WALL, b, contact, restitution, friction, out);
  return true;
}
