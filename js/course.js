import * as THREE from 'three';
import { RoundedBoxGeometry } from '../lib/RoundedBoxGeometry.js';
import { H, crownContact } from './physics.js';

// ---------------------------------------------------------------- helpers
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const matCache = new Map();
function mat(color, rough = 0.42, extra = {}) {
  const key = color + '|' + rough + '|' + JSON.stringify(extra);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02, ...extra }));
  return matCache.get(key);
}
function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const COLORS = {
  orange: 0xff6a2b, teal: 0x12c9b0, blue: 0x2b86ff, red: 0xff3b3b, yellow: 0xffc83d, white: 0xffffff, pink: 0xff5fa8,
};

// -------------------------------------------------------------- sections
export const SECTIONS = [
  { name: 'Start Line', z: 100 },
  { name: 'Big Balls', z: -14 },
  { name: 'The Spinner', z: -56 },
  { name: 'Sliders', z: -86 },
  { name: 'Balance Beam', z: -126 },
  { name: 'Falling Tiles', z: -170 },
  { name: 'Bouncing Balls', z: -208 },
];
export function sectionIndex(z) {
  let idx = 0;
  for (let i = 0; i < SECTIONS.length; i++) if (z <= SECTIONS[i].z) idx = i;
  return idx;
}

// ----------------------------------------------------------------- solids
class Solid {
  constructor(x, top, z, w, h, d) {
    this.w = w; this.h = h; this.d = d;
    this.dx = 0; this.dy = 0; this.dz = 0;
    this.active = true;
    this.group = null;
    this.set(x, top, z);
  }
  set(x, top, z) {
    this.x = x; this.y = top; this.z = z;
    this.minX = x - this.w / 2; this.maxX = x + this.w / 2;
    this.minY = top - this.h; this.maxY = top;
    this.minZ = z - this.d / 2; this.maxZ = z + this.d / 2;
  }
}

class Tile extends Solid {
  constructor(x, top, z, w, h, d, delay) {
    super(x, top, z, w, h, d);
    this.delay = delay; this.state = 'idle'; this.timer = 0; this.vy = 0; this.spin = 0;
    this.baseTop = top;
  }
  touch() { if (this.state === 'idle') { this.state = 'shaking'; this.timer = this.delay; } }
  tick(dt, t) {
    const g = this.group;
    if (this.state === 'shaking') {
      this.timer -= dt;
      g.position.x = this.x + Math.sin(t * 60) * 0.06;
      g.position.y = this.baseTop + Math.sin(t * 47) * 0.03;
      if (this.timer <= 0) { this.state = 'falling'; this.active = false; this.vy = 0; this.spin = (Math.random() - 0.5) * 3; }
    } else if (this.state === 'falling') {
      this.vy -= 22 * dt;
      g.position.y += this.vy * dt;
      g.rotation.z += this.spin * dt;
      g.rotation.x += this.spin * 0.6 * dt;
      if (g.position.y < -8) { this.state = 'gone'; this.timer = 4.5; g.visible = false; }
    } else if (this.state === 'gone') {
      this.timer -= dt;
      if (this.timer <= 0) this.reset();
    }
  }
  reset() {
    this.state = 'idle'; this.active = true; this.vy = 0;
    this.group.visible = true;
    this.group.position.set(this.x, this.baseTop, this.z);
    this.group.rotation.set(0, 0, 0);
  }
}

// ------------------------------------------------------------ main builder
export function buildCourse(scene) {
  const solids = [];
  const movers = [];
  const tiles = [];
  const hazards = [];
  const stars = [];
  const checkpoints = [];
  const updaters = [];
  const root = new THREE.Group();
  scene.add(root);

  // ---- platform visuals
  function slabVisual(w, h, d, color, topColor = COLORS.white) {
    const g = new THREE.Group();
    const topH = Math.min(0.55, h * 0.5);
    const base = new THREE.Mesh(new RoundedBoxGeometry(w, h - topH + 0.25, d, 3, 0.16), mat(color, 0.38));
    base.position.y = -(h + topH) / 2 + 0.12;
    const top = new THREE.Mesh(new RoundedBoxGeometry(w, topH, d, 3, 0.16), mat(topColor, 0.5));
    top.position.y = -topH / 2;
    for (const m of [base, top]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    return g;
  }
  function platform({ x = 0, z, w, d, h = 2.2, top = 0, color = COLORS.orange, topColor }) {
    const s = new Solid(x, top, z, w, h, d);
    s.group = slabVisual(w, h, d, color, topColor);
    s.group.position.set(x, top, z);
    root.add(s.group);
    solids.push(s);
    return s;
  }

// ---- banners removed; obstacle names now announced via HUD messages
  function flag(x, z, color = COLORS.red) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), mat(0xffffff));
    pole.position.y = 1.6;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8 }));
    cloth.position.set(0.7, 2.7, 0);
    g.add(pole, cloth);
    g.position.set(x, 0, z);
    root.add(g);
    updaters.push((t) => { cloth.rotation.y = Math.sin(t * 3 + x) * 0.25; });
  }

  // ---- hazards
  function sphereHit(c, r, p) {
    const yy = clamp(c.y, p.y + 0.4, p.y + H - 0.4);
    const dx = p.x - c.x, dy = p.y + 0.9 - c.y, dz = p.z - c.z;
    const ddy = c.y - yy;
    const d2 = dx * dx + ddy * ddy + dz * dz;
    const lim = r + 0.38;
    return d2 < lim * lim ? { dx, dy, dz } : null;
  }

  function roller({ x = 0, z, top = 0, R = 1.1, A = 3.6, w = 1.3, ph = 0 }) {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), mat(0xff2a2a, 0.22));
    ball.castShadow = true;
    g.add(ball);
    const dotM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(R * 0.24, 16), dotM);
      const dir = new THREE.Vector3(Math.cos(i * 1.05), Math.sin(i * 1.05), 0.2 * (i % 2 ? 1 : -1)).normalize();
      dot.position.copy(dir).multiplyScalar(R * 1.002);
      dot.lookAt(dir.clone().multiplyScalar(5));
      g.add(dot);
    }
    root.add(g);
    const c = new THREE.Vector3();
    let bvx = 0;
    const hz = {
      update(t) {
        const a = w * t + ph;
        c.set(x + A * Math.sin(a), top + R, z);
        bvx = A * w * Math.cos(a);
        g.position.copy(c);
        g.rotation.z = -(c.x - x) / R;
      },
      hit(p) {
        const h = sphereHit(c, R, p);
        if (!h) return null;
        let nx = Math.sign(bvx || h.dx) * 1.0, nz = h.dz * 0.9;
        const l = Math.hypot(nx, nz) || 1;
        return { nx: nx / l, nz: nz / l, pw: 8.5 + Math.abs(bvx) * 0.8, up: 7.5 };
      },
    };
    hz.update(0);
    hazards.push(hz);
    return hz;
  }

  function sweeper({ x = 0, z, top = 0, len = 6.4, arms = 2, omega = (t) => 1.6 * t, omegaDot = () => 1.6, color = COLORS.yellow }) {
    const g = new THREE.Group();
    g.position.set(x, top, z);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1.3, 20), mat(COLORS.blue, 0.35));
    hub.position.y = 0.65; hub.castShadow = true;
    g.add(hub);
    const spin = new THREE.Group();
    g.add(spin);
    const offs = [];
    for (let i = 0; i < arms; i++) {
      const off = (i * Math.PI * 2) / arms;
      offs.push(off);
      const arm = new THREE.Group();
      arm.rotation.y = off;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, len, 14), mat(color, 0.3));
      bar.rotation.z = Math.PI / 2;
      bar.position.set(len / 2, 0.5, 0);
      bar.castShadow = true;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), mat(COLORS.red, 0.3));
      tip.position.set(len, 0.5, 0);
      tip.castShadow = true;
      arm.add(bar, tip);
      spin.add(arm);
    }
    root.add(g);
    let theta = 0, wNow = 1;
    const hz = {
      update(t) { theta = omega(t); wNow = omegaDot(t); spin.rotation.y = theta; },
      hit(p) {
        if (p.y > top + 0.8 || p.y + H < top + 0.2) return null;
        const rx = p.x - x, rz = p.z - z;
        for (const off of offs) {
          const a = theta + off;
          const dx = Math.cos(a), dz = -Math.sin(a);
          const tt = clamp(rx * dx + rz * dz, 0, len);
          const qx = rx - dx * tt, qz = rz - dz * tt;
          const d = Math.hypot(qx, qz);
          if (d < 0.3 + 0.38) {
            const s = Math.sign(wNow) || 1;
            let nx = -Math.sin(a) * s + qx * 0.6, nz = -Math.cos(a) * s + qz * 0.6;
            const l = Math.hypot(nx, nz) || 1;
            return { nx: nx / l, nz: nz / l, pw: 8 + Math.abs(wNow) * Math.max(tt, 2) * 0.7, up: 7 };
          }
        }
        return null;
      },
    };
    hz.update(0);
    hazards.push(hz);
    return hz;
  }

  function pendulum({ px = 0, py = 6.5, z, L = 5, amp = 0.85, w = 1.5, ph = 0, shape = 'pillar', R = 0.5 }) {
    const g = new THREE.Group();
    root.add(g);
    const ropeM = mat(0xdddddd, 0.6);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), ropeM);
    g.add(rope);
    let bob;
    if (shape === 'pillar') {
      bob = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 2.4, 20), mat(0xf4f4f4, 0.35));
      const capA = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.3, 20), mat(COLORS.blue, 0.35));
      capA.position.y = 1.1;
      const capB = capA.clone(); capB.position.y = -1.1;
      body.castShadow = true;
      bob.add(body, capA, capB);
    } else {
      bob = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 20), mat(0xff2a2a, 0.22));
      bob.castShadow = true;
    }
    g.add(bob);
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let vx = 0;
    const offs = shape === 'pillar' ? [-0.9, 0, 0.9] : [0];
    const hr = shape === 'pillar' ? 0.5 : R;
    const hz = {
      update(t) {
        const a = w * t + ph;
        const th = amp * Math.sin(a);
        dir.set(Math.sin(th), -Math.cos(th), 0);
        pos.set(px + L * dir.x, py + L * dir.y, z);
        vx = amp * w * Math.cos(a) * L * Math.cos(th);
        bob.position.copy(pos);
        if (shape === 'pillar') bob.quaternion.setFromUnitVectors(UP, dir);
        rope.position.set(px + dir.x * L / 2, py + dir.y * L / 2, z);
        rope.scale.y = L;
        rope.quaternion.setFromUnitVectors(UP, dir);
      },
      hit(p) {
        for (const o of offs) {
          const c = new THREE.Vector3(pos.x + dir.x * o, pos.y + dir.y * o, pos.z);
          const h = sphereHit(c, hr, p);
          if (h) {
            const nx = Math.sign(vx || h.dx), nz = h.dz * 0.5;
            const l = Math.hypot(nx, nz) || 1;
            return { nx: nx / l, nz: nz / l, pw: 8.5 + Math.abs(vx) * 0.8, up: 7 };
          }
        }
        return null;
      },
    };
    hz.update(0);
    hazards.push(hz);
    return hz;
  }

  function gantry(z, hw, y = 6.5) {
    const g = new THREE.Group();
    const m = mat(0xe9eef5, 0.5);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, y + 1.2, 10), m);
      post.position.set(sx * hw, (y + 1.2) / 2 - 1.1, 0);
      post.castShadow = true; g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, hw * 2, 10), mat(COLORS.blue, 0.4));
    beam.rotation.z = Math.PI / 2; beam.position.y = y + 0.1; beam.castShadow = true;
    g.add(beam);
    g.position.z = z;
    root.add(g);
  }

  // ---- stars
  const starShape = (() => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 ? 0.22 : 0.5;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) s.moveTo(px, py); else s.lineTo(px, py);
    }
    s.closePath();
    return s;
  })();
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
  starGeo.translate(0, 0, -0.08);
  const starMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffa400, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.4 });
  function addStar(x, y, z) {
    const m = new THREE.Mesh(starGeo, starMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    root.add(m);
    stars.push({ mesh: m, x, y, z, got: false });
  }

  // =============================================================== COURSE
  const O = COLORS.orange, T = COLORS.teal, B = COLORS.blue, Y = COLORS.yellow, PK = COLORS.pink;

  // Start deck
  const start = platform({ z: -6, w: 16, d: 16, color: B });

  // 1 — Big Balls
  const p1 = platform({ z: -21.5, w: 10, d: 10, color: O });
  roller({ z: -21.5, A: 3.6, w: 1.3, ph: 0 });
  const p2 = platform({ z: -34, w: 10, d: 14, color: T });
  roller({ z: -31.5, A: 3.6, w: 1.5, ph: 0 });
  roller({ z: -36.5, A: 3.6, w: 1.5, ph: Math.PI });
  const cp1 = platform({ z: -47.5, w: 12, d: 12, color: PK });
  flag(-5, -47.5); flag(5, -47.5);

  // 2 — The Spinner
  const p3 = platform({ z: -63.5, w: 14, d: 14, color: B });
  sweeper({ z: -63.5, len: 6.4, arms: 2, omega: (t) => 1.7 * t, omegaDot: () => 1.7 });
  const cp2 = platform({ z: -79.5, w: 12, d: 12, color: PK });
  flag(-5, -79.5); flag(5, -79.5);

  // 3 — Sliders
  const sliderZ = [-90, -96.5, -103, -109.5];
  const sliderW = [0.95, 1.2, 0.85, 1.35];
  const sliderP = [0, 2, 4, 1];
  const sliderC = [O, T, Y, B];
  sliderZ.forEach((z, i) => {
    const s = platform({ x: 0, z, w: 4, d: 4, h: 1.4, color: sliderC[i] });
    s.motion = (t) => ({ x: 4.4 * Math.sin(sliderW[i] * t + sliderP[i]), y: 0, z });
    movers.push(s);
  });
  const cp3 = platform({ z: -119.5, w: 12, d: 12, color: PK });
  flag(-5, -119.5); flag(5, -119.5);

  // 4 — Balance Beam + swinging pillars
  const beam = platform({ z: -143, w: 2.1, d: 30, h: 0.9, color: Y, topColor: 0xffffff });
  [-136, -143, -150].forEach((z, i) => {
    gantry(z, 6.5);
    pendulum({ px: 0, py: 6.5, z, L: 5, amp: 0.85, w: 1.5, ph: i * 2.1, shape: 'pillar' });
  });
  const cp4 = platform({ z: -164, w: 12, d: 12, color: PK });
  flag(-5, -164); flag(5, -164);

  // 5 — Falling tiles
  const rand = rng(7);
  for (let row = 0; row < 7; row++) {
    const weak = Math.floor(rand() * 3);
    for (let col = 0; col < 3; col++) {
      const x = (col - 1) * 3.1;
      const z = -174 - row * 3.1;
      const isWeak = col === weak || (row % 3 === 2 && col === (weak + 1) % 3);
      const tile = new Tile(x, 0, z, 2.8, 1.2, 2.8, isWeak ? 0.3 : 1.25);
      tile.group = slabVisual(2.8, 1.2, 2.8, (row + col) % 2 ? T : O);
      tile.group.position.set(x, 0, z);
      root.add(tile.group);
      solids.push(tile);
      tiles.push(tile);
    }
  }
  const cp5 = platform({ z: -201.5, w: 12, d: 12, color: PK });
  flag(-5, -201.5); flag(5, -201.5);

  // 6 — Giant Bouncing Balls (Wipeout-style finale over open water)
  // Four large balls FLOATING in a STRAIGHT LINE (x = 0) between the tiles
  // checkpoint platform and the finish platform. No poles, no base rings:
  // the balls themselves are the challenge.
  //
  // Collision is spherical, not a flat box: each frame the game calls
  // course.checkBalls(prevFeet, dt) with the player's swept feet segment.
  // A contact counts when the descending segment crosses the sphere's upper
  // surface within (radius + player radius) tolerance. Contact places the
  // feet on the surface and returns the ball so the game can apply one
  // controlled bounce. Rising past a ball never triggers.
  const BALL_R = 2.0, BOUNCE_UP = 12.0, BOUNCE_COOL = 0.25;
  const BALL_GAP = 6.4;
  // Ball 1 close enough to jump onto from the cp5 platform edge (z=-207.5):
  // near-slope contact ≈4m out, inside a full jump's 4.2m reach at crown
  // height. Ball-to-ball 6.4m gaps are then covered by the vy=12 bounce
  // (7.2m reach at full run). Ball 4 sits ~6.5m clear of the finish deck so
  // the final bounce lands on open water gap, then the deck — never on an
  // overlapping ball+platform ambiguity.
  const BALL_Z0 = -209.5;
  // Crown heights follow medium → higher → lower → higher: ±0.55m steps are
  // visible but stay inside the bounce envelope (a 7.2m-range bounce climbs
  // ~3m, so a 0.55m rise between balls costs almost no distance).
  const BALL_TOP = 1.15;
  const ballDefs = [
    { z: BALL_Z0, color: O, top: BALL_TOP },
    { z: BALL_Z0 - BALL_GAP, color: T, top: BALL_TOP + 0.55 },
    { z: BALL_Z0 - 2 * BALL_GAP, color: Y, top: BALL_TOP - 0.55 },
    { z: BALL_Z0 - 3 * BALL_GAP, color: COLORS.red, top: BALL_TOP + 0.35 },
  ];
  const ballState = ballDefs.map(({ z, color, top }) => {
    const cy = top - BALL_R;
    // Floating ball: sphere + white polka dots (matches section-1 rollers).
    const g = new THREE.Group();
    const inner = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 28), mat(color, 0.22));
    ball.castShadow = true; ball.receiveShadow = true;
    inner.add(ball);
    const dotM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 0.2, 16), dotM);
      const dir = new THREE.Vector3(Math.cos(i * 0.785), Math.sin(i * 1.7), Math.sin(i * 0.785) * 0.9 + 0.35).normalize();
      dot.position.copy(dir).multiplyScalar(BALL_R * 1.003);
      dot.lookAt(dir.clone().multiplyScalar(5));
      inner.add(dot);
    }
    inner.position.y = cy;
    g.add(inner);
    g.position.set(0, 0, z);
    root.add(g);
    return { x: 0, cy, z, r: BALL_R, top, group: g, inner, cool: 0, squash: 0 };
  });
  updaters.push((t, dt) => {
    for (let i = 0; i < ballState.length; i++) {
      const b = ballState[i];
      b.cool = Math.max(0, b.cool - dt);
      // Gentle idle bob; the collision center bobs WITH the visual so
      // contact detection and the rendered ball never disagree by more
      // than the (small) squash term, which is purely cosmetic.
      b.group.position.y = Math.sin(t * 1.4 + i * 1.7) * 0.1;
      // Squash-and-stretch after a landing; decays back to round.
      b.squash = Math.max(0, b.squash - dt * 3.0);
      const q = b.squash;
      b.inner.scale.set(1 + q * 0.25, 1 - q * 0.3, 1 + q * 0.25);
      b.inner.rotation.y = t * (0.35 + i * 0.1);
    }
  });
  // Swept sphere contact: segment prevFeet->feet vs ball surface.
  // Returns the ball on a valid descending upper-hemisphere contact, else null.
  // Delegates to the pure crownContact() predicate in physics.js (headless-
  // testable); this wrapper only adds bob-adjusted cy + the per-ball cooldown.
  function checkBalls(px, prevY, py, pz, vy) {
    if (vy > 0) return null; // rising past a ball never bounces
    for (const b of ballState) {
      if (b.cool > 0) continue;
      const c = crownContact({ x: b.x, cy: b.cy + b.group.position.y, z: b.z, r: b.r }, px, prevY, py, pz, vy, undefined, b);
      if (c) return { ball: b, surfY: c.surfY, nx: c.nx, ny: c.ny };
    }
    return null;
  }
  // Finish deck pushed back so ball 4's collision sphere (extent ≈ z4-2.4m
  // incl. player radius) clears the deck's near edge by a full stride.
  const fin = platform({ z: -243, w: 16, d: 18, color: Y });
  flag(-7, -245, COLORS.blue); flag(7, -245, COLORS.blue);

  // Checkpoints / finish
  const cpDefs = [
    [cp1, -44, 'Big Balls cleared'], [cp2, -76.5, 'Spinner cleared'], [cp3, -116.5, 'Sliders cleared'],
    [cp4, -161, 'Beam cleared'], [cp5, -198.5, 'Tiles cleared'],
  ];
  for (const [s, tz, label] of cpDefs) checkpoints.push({ solid: s, triggerZ: tz, spawn: { x: 0, y: 0, z: s.z + 1.5 }, label });
  checkpoints.push({ solid: fin, triggerZ: -238, spawn: { x: 0, y: 0, z: -241 }, label: 'FINISH', finish: true });

  // Stars
  const starPos = [
    [0, 2.3, -15.2], [0, 2.3, -27.8], [0, 2.3, -40.2], [0, 1, -47.5],
    [0, 2.3, -54.8], [-5, 1, -61], [5, 1, -66], [0, 2.3, -72],
    [0, 2.5, -87.3], [0, 2.5, -93.3], [0, 2.5, -99.8], [0, 2.5, -106.3], [0, 2.5, -112.8],
    [0, 2.3, -126.8], [0, 1, -132], [0, 1, -139.5], [0, 1, -146.5], [0, 1, -153.5],
    [-3.1, 1, -176.1], [3.1, 1, -182.3], [0, 1, -188.5], [0, 2.3, -194.3],
    [0, 2.3, -208.3], [0, 2.6, -209.5], [0, 2.6, -215.9], [0, 2.6, -222.3], [0, 2.6, -228.7], [0, 1.6, -234.2], [0, 1, -238],
    [-5, 1, -23.5], [5, 1, -41], [-5, 1, -97], [5, 1, -125],
  ];
  starPos.forEach((s) => addStar(...s));

  // ================================================================ WORLD
  // water
  const waterTex = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#1f9bff'; c.fillRect(0, 0, w, h);
    const r = rng(3);
    for (let i = 0; i < 70; i++) {
      const x = r() * w, y = r() * h, rad = 8 + r() * 26;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const gr = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = gr; c.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
    c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y = r() * h;
      for (const ox of [-w, 0, w]) {
        c.beginPath(); c.moveTo(x + ox, y); c.quadraticCurveTo(x + ox + 12, y - 6, x + ox + 26, y); c.stroke();
      }
    }
  }, true);
  waterTex.repeat.set(26, 120);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 280),
    new THREE.MeshStandardMaterial({ map: waterTex, roughness: 0.12, metalness: 0.15, color: 0xffffff })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -1.2, -123);
  water.receiveShadow = true;
  root.add(water);
  updaters.push((t) => { waterTex.offset.set(t * 0.012, -t * 0.02); });

  // grass + curbs
  const grassM = mat(0x5cc24a, 0.9);
  function grass(x, z, w, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d), grassM);
    m.position.set(x, -1.3, z); m.receiveShadow = true; root.add(m);
  }
  grass(-122, -180, 200, 560); grass(122, -180, 200, 560);
  grass(0, 90, 44, 200); grass(0, -450, 44, 360);
  const curbM = mat(0xffffff, 0.6);
  for (const sx of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 280), curbM);
    c.position.set(sx * 22.4, -0.5, -123); c.receiveShadow = true; root.add(c);
  }
  for (const zz of [17, -263]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(46, 0.5, 1.2), curbM);
    c.position.set(0, -0.5, zz); root.add(c);
  }

  // trees (instanced)
  const tr = rng(11);
  const TREES = 130;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 7), mat(0x7a4b2a, 0.9), TREES);
  const crownA = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 5, 8), mat(0x2f9e44, 0.85), TREES);
  const crownB = new THREE.InstancedMesh(new THREE.ConeGeometry(2.0, 4, 8), mat(0x3dbb55, 0.85), TREES);
  const dm = new THREE.Object3D();
  for (let i = 0; i < TREES; i++) {
    const side = tr() < 0.5 ? -1 : 1;
    const x = side * (26 + tr() * 90), z = 60 - tr() * 360;
    const sc = 0.8 + tr() * 1.1;
    dm.rotation.set(0, 0, 0);
    dm.scale.setScalar(sc);
    dm.position.set(x, -0.3 + 1.5 * sc, z); dm.updateMatrix(); trunk.setMatrixAt(i, dm.matrix);
    dm.position.set(x, -0.3 + 4.2 * sc, z); dm.updateMatrix(); crownA.setMatrixAt(i, dm.matrix);
    dm.position.set(x, -0.3 + 6.4 * sc, z); dm.updateMatrix(); crownB.setMatrixAt(i, dm.matrix);
  }
  for (const m of [trunk, crownA, crownB]) { m.castShadow = true; root.add(m); }

  // hills
  const hillM = mat(0x6fd05a, 0.95);
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), hillM);
    const s = 24 + tr() * 30;
    h.scale.set(s, s * 0.45, s);
    h.position.set(side * (130 + tr() * 60), -2, 40 - i * 32);
    root.add(h);
  }

  // skyline
  const nb = 60;
  const bld = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), nb);
  const col = new THREE.Color();
  for (let i = 0; i < nb; i++) {
    const w = 10 + tr() * 18, h = 25 + tr() * 80, d = 10 + tr() * 18;
    const a = (i / nb) * Math.PI * 2;
    const rad = 330 + tr() * 40;
    dm.position.set(Math.cos(a) * rad, h / 2 - 3, -125 + Math.sin(a) * rad * 1.0);
    dm.scale.set(w, h, d); dm.rotation.set(0, 0, 0); dm.updateMatrix();
    bld.setMatrixAt(i, dm.matrix);
    col.setHSL(0.58 + tr() * 0.05, 0.25, 0.62 + tr() * 0.18);
    bld.setColorAt(i, col);
  }
  root.add(bld);

  // windmills
  const blades = [];
  for (const [x, z] of [[-62, -70], [70, -150], [-75, -215]]) {
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.0, 16, 10), mat(0xffffff, 0.6));
    tower.position.y = 8; tower.castShadow = true;
    const hubG = new THREE.Group(); hubG.position.set(0, 16, 1);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.2), mat(0xffffff, 0.6));
      b.position.y = 4.5;
      const pivot = new THREE.Group(); pivot.rotation.z = (i * Math.PI * 2) / 3; pivot.add(b); hubG.add(pivot);
    }
    g.add(tower, hubG); g.position.set(x, -0.3, z);
    g.rotation.y = x < 0 ? 0.5 : -0.5;
    root.add(g); blades.push(hubG);
  }
  updaters.push((t) => blades.forEach((b, i) => { b.rotation.z = t * (0.6 + i * 0.15); }));

  // clouds
  const clouds = [];
  const cloudM = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    const n = 4 + Math.floor(tr() * 3);
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(5 + tr() * 5, 10, 8), cloudM);
      s.position.set(k * 7 - n * 3.5, tr() * 3, tr() * 4); s.scale.y = 0.6; g.add(s);
    }
    g.position.set(-220 + tr() * 440, 55 + tr() * 30, 40 - tr() * 340);
    root.add(g); clouds.push(g);
  }
  updaters.push((t, dt) => clouds.forEach((c) => { c.position.x += dt * 1.2; if (c.position.x > 230) c.position.x = -230; }));

  // ============================================================ API
  const course = {
    root, solids, hazards, stars, checkpoints, tiles, start, finish: fin,
    balls: ballState, checkBalls, bounceUp: BOUNCE_UP, bounceCool: BOUNCE_COOL,
    update(t, dt) {
      for (const m of movers) {
        const px = m.x, py = m.y, pz = m.z;
        const n = m.motion(t);
        m.set(n.x, n.y, n.z);
        m.dx = m.x - px; m.dy = m.y - py; m.dz = m.z - pz;
        m.group.position.set(m.x, m.y, m.z);
      }
      for (const tl of tiles) tl.tick(dt, t);
      for (const h of hazards) h.update(t);
      for (const s of stars) {
        if (s.got) continue;
        s.mesh.rotation.y = t * 2 + s.x;
        s.mesh.position.y = s.y + Math.sin(t * 2.4 + s.z) * 0.15;
      }
      for (const u of updaters) u(t, dt);
    },
    reset() {
      for (const tl of tiles) tl.reset();
      for (const s of stars) { s.got = false; s.mesh.visible = true; }
      for (const b of ballState) { b.cool = 0; b.squash = 0; }
    },
  };
  course.update(0, 0);
  return course;
}
