// Tiny platformer physics: a capsule-ish player (box in collisions) vs. AABB solids.
export const R = 0.38;       // player radius
export const H = 1.8;        // player height
export const GRAV = 24;
export const JUMP = 8.8;
export const SPEED = 7.2;

export function createPlayer() {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    grounded: false, on: null, coyote: 0, jumpBuf: 0, cut: false,
    stunned: false, heading: Math.PI,
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const EPS = 1e-3;

function overlaps(p, s) {
  return (
    p.x + R > s.minX && p.x - R < s.maxX &&
    p.z + R > s.minZ && p.z - R < s.maxZ &&
    p.y + H > s.minY + EPS && p.y < s.maxY - EPS
  );
}

function pushHoriz(p, s, axis, delta) {
  // Small lips are stepped over instead of blocking.
  if (s.maxY - p.y <= 0.32 && p.vy <= 0.5) {
    p.y = s.maxY;
    return;
  }
  if (axis === 'x') {
    if (delta > 0) p.x = s.minX - R - 1e-4;
    else if (delta < 0) p.x = s.maxX + R + 1e-4;
    else p.x = p.x < (s.minX + s.maxX) / 2 ? s.minX - R - 1e-4 : s.maxX + R + 1e-4;
    p.vx = 0;
  } else {
    if (delta > 0) p.z = s.minZ - R - 1e-4;
    else if (delta < 0) p.z = s.maxZ + R + 1e-4;
    else p.z = p.z < (s.minZ + s.maxZ) / 2 ? s.minZ - R - 1e-4 : s.maxZ + R + 1e-4;
    p.vz = 0;
  }
}

/**
 * Spherical crown contact for the Giant Bouncing Balls finale.
 * Pure function of (ball, swept feet segment) — no scene access, so headless
 * tests can drive it with the real physics constants.
 * ball: { x, cy, z, r } plain data (pass bob-adjusted cy for animated balls).
 * Returns { surfY, nx, ny } on a valid descending upper-hemisphere contact,
 * { slide: true, pushX, pushZ } when the player enters the ball's side (push
 * the feet out horizontally instead of bouncing), else null. Rising (vy > 0)
 * never contacts. tol pads the sphere by the player's collision radius so
 * feet rest on the visual surface, not inside it.
 */
export function crownContact(ball, px, prevY, py, pz, vy, tol = R, ref = null) {
  if (vy > 0) return null;
  const rr = ball.r + tol;
  const dx = px - ball.x, dz = pz - ball.z;
  const horiz2 = dx * dx + dz * dz;
  // Side entry: feet already inside the padded sphere but off to the side.
  // The old vertical-only crossing test missed this (surface computed at the
  // new position is above the already-deep feet), so the player phased
  // through the curved flank. Resolve radially: bounce off the upper bowl,
  // slide around the lower flank.
  const dy = py - ball.cy;
  const dist2 = horiz2 + dy * dy;
  if (dist2 < rr * rr) {
    const dist = Math.sqrt(dist2) || 1e-6;
    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
    if (ny >= 0.45) {
      // Upper bowl, moving in: snap feet onto the surface, one bounce.
      const k = rr / dist;
      return { surfY: ball.cy + dy * k, nx, ny };
    }
    // Lower flank: horizontal push-out so the player slides around the
    // ball instead of tunneling through it. No bounce here.
    const hl = Math.sqrt(horiz2) || 1e-6;
    const push = rr * 0.55 - hl; // restore to a glancing shell
    if (push > 0) {
      return { slide: true, ball: ref, pushX: (dx / hl) * push, pushZ: (dz / hl) * push };
    }
    return { slide: true, ball: ref, pushX: 0, pushZ: 0 };
  }
  if (horiz2 > rr * rr) return null;
  const surf = ball.cy + Math.sqrt(Math.max(0, rr * rr - horiz2));
  // Swept segment must cross the surface: previous feet above (within a
  // 2cm snap band), new feet at/below. Per-step fall distance (~0.28m max)
  // always straddles this window, so fast falls can't tunnel through.
  if (!(prevY >= surf - 0.02 && py <= surf + 0.02)) return null;
  // Upper hemisphere only: reject side/equator grazes whose surface normal
  // points mostly sideways. ny >= 0.45 accepts the upper bowl (~63° half
  // angle) — forgiving off-center landings, no flat-platform feel.
  const nx = dx / rr, ny = (surf - ball.cy) / rr;
  if (ny < 0.45) return null;
  return { surfY: surf, nx, ny };
}

/**
 * Advance the player one fixed step.
 * inp: { x, z, jumpPressed, jumpHeld }  (x right, z back; magnitude <= 1)
 * returns { jumped, landed }
 */
export function stepMovement(p, solids, inp, dt) {
  const ev = { jumped: false, landed: false };
  const wasGrounded = p.grounded;

  // Ride moving platforms.
  if (p.on && p.on.active) {
    p.x += p.on.dx; p.y += p.on.dy; p.z += p.on.dz;
  }

  // Horizontal steering.
  if (p.stunned) {
    if (p.grounded) {
      const f = 14 * dt;
      p.vx -= clamp(p.vx, -f, f);
      p.vz -= clamp(p.vz, -f, f);
    }
  } else {
    const a = (p.grounded ? 62 : 22) * dt;
    p.vx += clamp(inp.x * SPEED - p.vx, -a, a);
    p.vz += clamp(inp.z * SPEED - p.vz, -a, a);
  }

  // Jump (with coyote time + input buffer).
  p.coyote = p.grounded ? 0.1 : p.coyote - dt;
  if (inp.jumpPressed) p.jumpBuf = 0.12; else p.jumpBuf -= dt;
  if (!p.stunned && p.jumpBuf > 0 && p.coyote > 0) {
    p.vy = JUMP; p.jumpBuf = 0; p.coyote = 0; p.grounded = false; p.on = null; p.cut = false;
    ev.jumped = true;
  }
  if (!inp.jumpHeld && p.vy > 3.5 && !p.grounded && !p.cut && !p.stunned) {
    p.vy *= 0.55; p.cut = true; // short hop
  }

  p.vy = Math.max(p.vy - GRAV * dt, -34);

  // X
  let dx = p.vx * dt;
  p.x += dx;
  for (const s of solids) if (s.active && overlaps(p, s)) pushHoriz(p, s, 'x', dx);
  // Z
  let dz = p.vz * dt;
  p.z += dz;
  for (const s of solids) if (s.active && overlaps(p, s)) pushHoriz(p, s, 'z', dz);
  // Y
  p.y += p.vy * dt;
  p.grounded = false;
  p.on = null;
  for (const s of solids) {
    if (!s.active || !overlaps(p, s)) continue;
    if (p.vy <= 0) {
      p.y = s.maxY; p.vy = 0; p.grounded = true; p.on = s;
    } else {
      p.y = s.minY - H; p.vy = 0;
    }
  }
  if (p.grounded && !wasGrounded) ev.landed = true;
  return ev;
}
