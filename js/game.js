import * as THREE from 'three';
import { buildCourse, SECTIONS, sectionIndex } from './course.js';
import { buildCharacter, DEFAULT_STYLE } from './character.js';
import { RUNNERS, loadRunnerKey, saveRunnerKey, buildRunnerAvatar } from './runners.js';
import { createPlayer, stepMovement, GRAV } from './physics.js';
import * as SN from './startng.js';
import { initAudio, sfx, setMuted, isMuted } from './audio.js';

// ------------------------------------------------------------------ config
const STEP = 1 / 120;
const PAR = 150;               // target time (s)
const FINISH_BONUS = 1000;
const CHECKPOINT_PTS = 100;
const STAR_PTS = 10;
const WORDS = ['BONK', 'OUCH', 'WHOA', 'SPLAT', 'YEOW', 'BOING', 'OOF'];

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};
const fmtS = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ------------------------------------------------------------------- scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe9ff, 90, 420);
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#2d7bf0'); gr.addColorStop(0.55, '#86c8ff'); gr.addColorStop(1, '#d9f0ff');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 800);

scene.add(new THREE.HemisphereLight(0xdff0ff, 0x6fa84a, 1.55));
const sun = new THREE.DirectionalLight(0xfff4dd, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 140 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const course = buildCourse(scene);
const TOTAL_STARS = course.stars.length;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 78 : 62;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// --------------------------------------------------------------- particles
class Particles {
  constructor(max = 500) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), max);
    this.mesh.frustumCulled = false;
    this.p = Array.from({ length: max }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1, g: 1 }));
    this.d = new THREE.Object3D(); this.i = 0;
    const c = new THREE.Color(0xffffff);
    for (let k = 0; k < max; k++) { this.mesh.setColorAt(k, c); this.hide(k); }
    scene.add(this.mesh);
  }
  hide(k) { this.d.position.set(0, -999, 0); this.d.scale.setScalar(0); this.d.updateMatrix(); this.mesh.setMatrixAt(k, this.d.matrix); }
  emit(x, y, z, n, { colors = [0xffffff], speed = 5, up = 5, life = 1, size = 1, g = 1 } = {}) {
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const p = this.p[this.i]; const idx = this.i; this.i = (this.i + 1) % this.max;
      const a = Math.random() * Math.PI * 2, r = Math.random() * speed;
      Object.assign(p, { life: life * (0.6 + Math.random() * 0.6), x, y, z, vx: Math.cos(a) * r, vz: Math.sin(a) * r, vy: up * (0.4 + Math.random()), s: size * (0.6 + Math.random() * 0.9), g });
      p.max = p.life;
      c.setHex(colors[(Math.random() * colors.length) | 0]);
      this.mesh.setColorAt(idx, c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    for (let k = 0; k < this.max; k++) {
      const p = this.p[k];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { this.hide(k); continue; }
      p.vy -= 14 * p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      this.d.position.set(p.x, p.y, p.z);
      this.d.scale.setScalar(p.s * Math.min(1, p.life / p.max * 2));
      this.d.rotation.set(p.life * 5, p.life * 3, 0);
      this.d.updateMatrix(); this.mesh.setMatrixAt(k, this.d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const particles = new Particles();

// --------------------------------------------------------------- the player
const P = createPlayer();
let style = DEFAULT_STYLE, styleKey = JSON.stringify(style);
let runnerKey = loadRunnerKey();   // manual pick, persisted in localStorage
let runnerGen = 0;                 // guards async avatar swaps
let avatar = buildCharacter(style);
scene.add(avatar.group);

function setStyle(next) {
  const merged = { ...DEFAULT_STYLE, ...(next || {}) };
  const key = JSON.stringify(merged);
  if (key === styleKey) return;
  style = merged; styleKey = key;
  // start.ng style only recolors the procedural fallback avatar; it never
  // replaces the manually selected Styloos runner (see refreshPlayer).
  if (!avatar.runnerKey) {
    scene.remove(avatar.group); avatar.dispose();
    avatar = buildCharacter(style);
    scene.add(avatar.group);
  }
}

// Swap the visible runner. Async: keeps the current avatar visible while the
// GLB loads (no procedural flash), then swaps exactly once. Never duplicates
// meshes: exactly one avatar group is in the scene; stale async results are
// discarded via runnerGen. Resolves true when the GLB is active, false on
// failure (previous avatar left untouched).
async function setRunner(key, { persist = true } = {}) {
  const { isRunnerKey } = await import('./runners.js');
  if (!isRunnerKey(key)) key = 'student';
  if (persist) saveRunnerKey(key);
  const gen = ++runnerGen;
  const prevKey = runnerKey;
  runnerKey = key;
  if (typeof document !== 'undefined') {
    document.querySelectorAll('#chooseGrid .choice').forEach((el) => {
      el.classList.toggle('sel', el.dataset.key === key);
      el.setAttribute('aria-selected', el.dataset.key === key ? 'true' : 'false');
    });
    const nm = document.getElementById('chooseName');
    if (nm) nm.textContent = (RUNNERS.find((r) => r.key === key) || {}).name || key;
  }
  if (prevKey === key && avatar.runnerKey === key) return true;
  try {
    const next = await buildRunnerAvatar(key);
    if (gen !== runnerGen) { next.dispose(); return false; }  // superseded
    scene.remove(avatar.group);
    try { avatar.dispose(); } catch { /* ignore */ }
    avatar = next;
    scene.add(avatar.group);
    avatar.group.position.set(P.x, P.y, P.z);
    avatar.group.rotation.y = P.heading;
    return true;
  } catch (err) {
    console.warn(`Runner "${key}" failed to load, keeping current avatar:`, err);
    return false;
  }
}

// ------------------------------------------------------------- game state
let state = 'menu';       // menu | countdown | playing | wipeout | finished
let paused = false;
let simT = 0, runT = 0, score = 0, starsGot = 0, wipes = 0, cpIndex = -1;
let spawn = { x: 0, y: 0, z: -1 };
let cdT = 0, lastCount = -1;
let wipeT = 0, invuln = 0, splashed = false, shake = 0;
const tumble = { x: 0, z: 0, sx: 0, sz: 0 };
const sectionWipes = new Array(SECTIONS.length).fill(0);
let lastSection = -1;

function placePlayer(sp) {
  P.x = sp.x; P.y = sp.y; P.z = sp.z; P.vx = P.vy = P.vz = 0;
  P.grounded = false; P.on = null; P.stunned = false; P.heading = Math.PI;
  tumble.x = tumble.z = 0; avatar.pivot.rotation.set(0, 0, 0);
  camSnap = true;
}

function resetRun() {
  course.reset();
  score = 0; starsGot = 0; wipes = 0; cpIndex = -1; runT = 0; invuln = 0; splashed = false;
  sectionWipes.fill(0); lastSection = -1;
  spawn = { x: 0, y: 0, z: -1 };
  placePlayer(spawn);
  state = 'countdown'; cdT = 3.6; lastCount = -1;
  $('results').classList.add('hidden');
  $('fade').style.opacity = 0;
  updateHud();
}

// ------------------------------------------------------------------ input
const keys = { left: false, right: false, up: false, down: false, jump: false };
let jumpQueued = false;
const joy = { x: 0, z: 0, id: null, ox: 0, oy: 0 };
let touchJump = false;

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'jump',
};
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') { if (!e.repeat) togglePause(); return; }
  if (e.code === 'Enter' && state === 'menu') { startGame(); return; }
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (k === 'jump' && !keys.jump) jumpQueued = true;
  keys[k] = true;
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

if (isTouch) {
  $('touch').classList.remove('hidden');
  const zone = $('joy'), base = $('joyBase'), knob = $('joyKnob');
  zone.addEventListener('pointerdown', (e) => {
    if (joy.id !== null) return;
    joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; zone.setPointerCapture(e.pointerId);
    base.style.display = knob.style.display = 'block';
    base.style.left = knob.style.left = e.clientX + 'px'; base.style.top = knob.style.top = e.clientY + 'px';
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
    const l = Math.hypot(dx, dy), max = 55;
    if (l > max) { dx = dx / l * max; dy = dy / l * max; }
    knob.style.left = joy.ox + dx + 'px'; knob.style.top = joy.oy + dy + 'px';
    const nx = dx / max, ny = dy / max;
    joy.x = Math.abs(nx) < 0.15 ? 0 : nx; joy.z = Math.abs(ny) < 0.15 ? 0 : ny;
  });
  const end = (e) => {
    if (e.pointerId !== joy.id) return;
    joy.id = null; joy.x = joy.z = 0; base.style.display = knob.style.display = 'none';
  };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  const jb = $('jumpBtn');
  jb.addEventListener('pointerdown', (e) => { e.preventDefault(); touchJump = true; jumpQueued = true; initAudio(); });
  const jend = () => { touchJump = false; };
  jb.addEventListener('pointerup', jend); jb.addEventListener('pointercancel', jend); jb.addEventListener('pointerleave', jend);
}

function readInput() {
  // Side-on camera: screen-right is world -z (course direction), screen-down/toward camera is world +x.
  let wz = (keys.left ? 1 : 0) - (keys.right ? 1 : 0) - joy.x;
  let wx = (keys.down ? 1 : 0) - (keys.up ? 1 : 0) + joy.z;
  const l = Math.hypot(wx, wz);
  if (l > 1) { wx /= l; wz /= l; }
  const inp = { x: wx, z: wz, jumpPressed: jumpQueued, jumpHeld: keys.jump || touchJump };
  jumpQueued = false;
  return inp;
}

// ------------------------------------------------------------- UI helpers
const popups = $('popups');
function project(x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
}
function popup(html, cls = '', at = null) {
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  if (typeof html === 'string') el.textContent = html; else el.append(...html);
  const s = at || project(P.x, P.y + 2.2, P.z);
  el.style.left = clamp(s.x, 80, innerWidth - 80) + 'px';
  el.style.top = clamp(s.y, 90, innerHeight - 90) + 'px';
  popups.append(el);
  setTimeout(() => el.remove(), 1400);
}
function bigText(t) {
  const b = $('big');
  b.textContent = t; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}

function updateHud() {
  $('time').textContent = fmt(runT);
  $('target').textContent = fmtS(PAR);
  $('score').textContent = Math.round(score);
  $('stars').textContent = `★ ${starsGot} / ${TOTAL_STARS}`;
  const si = sectionIndex(P.z);
  if (si !== lastSection) {
    const goingForward = si > lastSection;
    lastSection = si;
    $('section').textContent = SECTIONS[si].name.toUpperCase();
    // Contextual cheer only on genuine forward progress into a new section.
    if (goingForward && state === 'playing') {
      if (si >= SECTIONS.length - 1) cheerFrom(MESSAGES.finish);
      else if (MESSAGES.hazardSections.includes(si)) cheerFrom(MESSAGES.caution);
      else cheerFrom(MESSAGES.enter);
    }
  }
  $('progfill').style.width = clamp(-P.z / 236, 0, 1) * 100 + '%';
}

// ------------------------------------------------------- start.ng player
let playerInfo = { user: null, guest: null };
let refreshing = false;
async function refreshPlayer() {
  if (refreshing) return;
  refreshing = true;
  try {
    const reply = await SN.whoami();
    if (reply) playerInfo = { user: reply.user || null, guest: reply.guest || null };
    const who = playerInfo.user ?? playerInfo.guest;
    const signedIn = !!playerInfo.user;
    // Manual runner pick always wins for the 3D avatar: start.ng only updates
    // the profile card/leaderboard identity + the procedural fallback colors.
    // (CONFLICT doc: start.ng has no Styloos concept; its style maps to the
    // procedural fallback via setStyle, which no-ops while a GLB is active.)
    setStyle(who?.style);
    $('player-name').textContent = who?.name || 'Guest';
    $('player-account').textContent = playerInfo.user?.account ? `@${playerInfo.user.account}` : 'Not signed in';
    if (who?.face) $('player-face').src = who.face; else $('player-face').removeAttribute('src');
    $('player-sign-in').hidden = signedIn;
    $('player-card').hidden = false;
    $('signBtn').hidden = signedIn;
    // Guest/offline hint only — never claim a "default character", since the
    // player's manually selected Styloos runner always runs the course.
    $('menuHint').textContent = signedIn
      ? ''
      : reply
        ? 'Playing as a guest — sign in to save scores to your start.ng profile.'
        : 'Offline — your selected runner is ready, but scores cannot be saved right now.';
  } finally { refreshing = false; }
}
$('player-sign-in').onclick = () => SN.signIn();
$('signBtn').onclick = () => SN.signIn();
addEventListener('focus', () => refreshPlayer());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPlayer(); });

function renderBoard(ol, entries) {
  ol.replaceChildren();
  const me = playerInfo.user?.id;
  if (!entries || !entries.length) {
    const li = document.createElement('li'); li.textContent = 'No runs yet — be the first!'; li.style.display = 'block'; ol.append(li); return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    if (me != null && e.player_id === me) li.className = 'me';
    const r = document.createElement('span'); r.textContent = '#' + e.rank;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = e.name;
    const s = document.createElement('span'); s.textContent = String(e.stats?.score ?? e.score);
    const t = document.createElement('span'); t.className = 't'; t.textContent = e.stats?.time != null ? fmtS(e.stats.time) : '';
    li.append(r, n, s, t); ol.append(li);
  }
}
async function loadBoard(ol) {
  const r = await SN.getBoard(10);
  if (r?.ok) renderBoard(ol, r.entries);
  else { ol.replaceChildren(); const li = document.createElement('li'); li.style.display = 'block'; li.textContent = 'Leaderboard unavailable right now.'; ol.append(li); }
  return r;
}

// ------------------------------------------------------------ game events
function startGame() {
  initAudio();
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  resetRun();
}
function togglePause() {
  if (state === 'menu' || state === 'finished') return;
  paused = !paused;
  $('pause').classList.toggle('hidden', !paused);
}

function stylePoints(pw, sec) {
  const base = clamp(Math.round(((pw - 5) * 1.2) / 5) * 5, 5, 25);
  const f = [1, 0.6, 0.4, 0.2, 0][Math.min(sectionWipes[sec], 4)];
  sectionWipes[sec]++;
  return Math.round((base * f) / 5) * 5;
}

function wipeout(res) {
  state = 'wipeout'; wipeT = 0; wipes++;
  P.stunned = true; splashed = false; P.on = null;
  const sec = sectionIndex(P.z);
  let word, pw;
  if (res.type === 'splash') {
    word = 'SPLASH'; pw = 8;
    splash(P.x, P.z);
  } else {
    word = WORDS[(Math.random() * WORDS.length) | 0]; pw = res.pw;
    P.vx = res.nx * res.pw; P.vz = res.nz * res.pw; P.vy = res.up;
    tumble.sx = (Math.random() - 0.5) * 16; tumble.sz = (Math.random() - 0.5) * 16 + 6;
    shake = 0.6; sfx('bonk');
    particles.emit(P.x, P.y + 1, P.z, 18, { colors: [0xffffff, 0xffd23a, 0xff6a2b], speed: 5, up: 4, life: 0.7 });
  }
  const pts = stylePoints(pw, sec);
  score += pts;
  const w = document.createElement('span'); w.textContent = word;
  const s = document.createElement('small'); s.textContent = pts ? `+${pts}` : 'no style points';
  popup([w, s], 'bad');
}

function splash(x, z) {
  splashed = true;
  particles.emit(x, -1.1, z, 60, { colors: [0xffffff, 0x9fd8ff, 0x4aa8ff], speed: 4.5, up: 9, life: 1.1, size: 1.3 });
  sfx('splash');
}

// ------------------------------------------------------- motivational cheers
// Replaces the removed in-world obstacle banners: contextual HUD messages at
// section entry / cautionary stretches / checkpoints / the finale approach.
const MESSAGES = {
  enter: ['You’ve got this!', 'Keep going!', 'Nice moves!'],
  caution: ['Careful, don’t trip!', 'Take it steady…', 'Watch those obstacles!'],
  congrats: ['Nice moves!', 'Checkpoint!', 'Smooth!'],
  finish: ['Almost there!', 'What a legend!'],
};
// Section indices whose entry deserves a cautionary nudge (harder hazards).
MESSAGES.hazardSections = [3, 4];
let lastCheerAt = -9, lastCheerMsg = '';
const recentCheers = [];
function cheer(msg) {
  const now = performance.now() / 1000;
  // Global guard: nothing more often than every 2.2s; never the same message
  // back-to-back; avoid the last 4 shown so pools don't feel repetitive.
  if (now - lastCheerAt < 2.2 || msg === lastCheerMsg || recentCheers.includes(msg)) return;
  lastCheerAt = now; lastCheerMsg = msg;
  recentCheers.push(msg);
  if (recentCheers.length > 3) recentCheers.shift();
  const el = $('cheer');
  el.textContent = msg;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(cheer._t);
  cheer._t = setTimeout(() => el.classList.remove('show'), 1700);
}
function cheerFrom(list) { cheer(list[(Math.random() * list.length) | 0]); }

function respawn() {
  placePlayer(spawn);
  P.stunned = false;
  state = 'playing'; invuln = 1.6;
  $('fade').style.opacity = 0;
}

function reachCheckpoint(i) {
  const c = course.checkpoints[i];
  cpIndex = i;
  if (c.finish) { finish(); return; }
  spawn = c.spawn;
  score += CHECKPOINT_PTS;
  sfx('checkpoint');
  popup(`CHECKPOINT +${CHECKPOINT_PTS}`, 'small', project(P.x, P.y + 2.6, P.z));
  particles.emit(P.x, P.y + 1, P.z, 30, { colors: [0xffd23a, 0xffffff, 0xff5fa8], speed: 4, up: 7, life: 1.2, g: 0.5 });
  cheerFrom(MESSAGES.congrats);
}

async function finish() {
  state = 'finished';
  const bonus = FINISH_BONUS + Math.max(0, Math.round((PAR - runT) * 10));
  score += bonus;
  sfx('finish');
  bigText('FINISH!');
  for (let k = 0; k < 4; k++) {
    particles.emit(P.x + (Math.random() - 0.5) * 8, 6 + Math.random() * 3, P.z - 3, 120, {
      colors: [0xff3b3b, 0xffd23a, 0x12c9b0, 0x2b86ff, 0xff5fa8, 0xffffff], speed: 8, up: 4, life: 3, size: 1.1, g: 0.35,
    });
  }
  const final = Math.round(score), t = Math.round(runT);
  $('rScore').textContent = final;
  $('rTime').textContent = fmtS(t);
  $('rStars').textContent = `${starsGot}/${TOTAL_STARS}`;
  $('rWipes').textContent = wipes;
  $('rRank').textContent = '–';
  $('saveMsg').textContent = 'Saving your run…';
  $('resBoard').replaceChildren();
  setTimeout(() => $('results').classList.remove('hidden'), 1400);

  const saved = await SN.saveRun({ score: final, time: t });
  if (saved?.ok) {
    const res = saved.result;
    $('rRank').textContent = '#' + res.rank;
    $('saveMsg').textContent = res.improved ? 'New personal best! 🎉' : `Your best is ${res.stats?.score ?? ''} — not beaten this time.`;
  } else {
    $('saveMsg').textContent = saved?.error || 'Could not save this run (sign in on start.ng to save scores).';
  }
  loadBoard($('resBoard'));
}

// ---------------------------------------------------------------- the step
function step(dt) {
  simT += dt;
  course.update(simT, dt);

  if (state === 'menu') {
    stepMovement(P, course.solids, { x: 0, z: 0, jumpPressed: false, jumpHeld: false }, dt);
    return;
  }

  if (state === 'countdown') {
    stepMovement(P, course.solids, { x: 0, z: 0, jumpPressed: false, jumpHeld: false }, dt);
    cdT -= dt;
    const n = Math.ceil(cdT - 0.6);
    if (n !== lastCount) {
      lastCount = n;
      if (n > 0) { bigText(String(n)); sfx('count'); }
    }
    if (cdT <= 0.6) { state = 'playing'; bigText('GO!'); sfx('go'); }
    return;
  }

  if (state === 'playing' || state === 'finished') {
    if (state === 'playing') runT += dt;
    const prevFeetY = P.y;
    const ev = stepMovement(P, course.solids, readInput(), dt);
    if (ev.jumped) sfx('jump');
    // Giant Bouncing Balls: swept sphere contact AFTER the AABB pass. Feet
    // P.y is the swept segment (prevY -> P.y); a valid descending contact on
    // a ball crown snaps the feet onto the surface and launches one bounce.
    // vy must be <= 0 read BEFORE the bounce overwrites it. Horizontal
    // velocity is untouched so air steering carries to the next ball.
    // The 0.25s per-ball cooldown guarantees one bounce per landing.
    if (P.vy <= 0 && state === 'playing') {
      const hit = course.checkBalls(P.x, prevFeetY, P.y, P.z, P.vy);
      if (hit) {
        if (hit.slide) {
          // Side graze on the ball's curved flank: deflect around it, no
          // bounce. Keeps momentum; falling short still ends in the water.
          P.x += hit.pushX; P.z += hit.pushZ;
          P.vx *= 0.85; P.vz *= 0.85;
          hit.ball.cool = 0.1;
        } else {
          const ball = hit.ball;
          ball.cool = course.bounceCool; ball.squash = 1;
          P.y = hit.surfY; P.vy = course.bounceUp; P.grounded = false; P.on = null;
          sfx('boing');
          particles.emit(P.x, P.y + 0.4, P.z, 14, { colors: [0xffffff, 0x9fd8ff], speed: 3, up: 3.5, life: 0.5 });
        }
      }
    }
    if (ev.landed && P.grounded) sfx('land');
    const spd = Math.hypot(P.vx, P.vz);
    if (spd > 0.6) {
      const target = Math.atan2(P.vx, P.vz);
      let d = target - P.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      P.heading += d * Math.min(1, dt * 16);
    }
    if (P.on && P.on.touch) { const was = P.on.state; P.on.touch(); if (was === 'idle') sfx('tile'); }

    if (P.y < -1.6) {
      if (state === 'finished') { placePlayer(course.checkpoints[course.checkpoints.length - 1].spawn); splash(P.x, P.z); return; }
      wipeout({ type: 'splash' });
      return;
    }
    if (state === 'finished') return;

    if (invuln > 0) invuln -= dt;
    else for (const h of course.hazards) {
      const r = h.hit(P);
      if (r) { wipeout(r); return; }
    }

    for (const s of course.stars) {
      if (s.got) continue;
      const dx = s.x - P.x, dy = s.y - (P.y + 0.9), dz = s.z - P.z;
      if (dx * dx + dy * dy + dz * dz < 1.3) {
        s.got = true; s.mesh.visible = false; starsGot++; score += STAR_PTS; sfx('star');
        particles.emit(s.x, s.y, s.z, 10, { colors: [0xffd23a, 0xffffff], speed: 2.5, up: 3, life: 0.6, g: 0.4 });
        popup(`+${STAR_PTS}`, 'small', project(s.x, s.y + 0.6, s.z));
      }
    }

    const next = cpIndex + 1;
    const c = course.checkpoints[next];
    if (c && P.on === c.solid && P.z < c.triggerZ) reachCheckpoint(next);
    return;
  }

  if (state === 'wipeout') {
    wipeT += dt;
    stepMovement(P, course.solids, { x: 0, z: 0, jumpPressed: false, jumpHeld: false }, dt);
    if (!splashed && P.y < -1.2) splash(P.x, P.z);
    if (P.y < -1.2) { P.vy = Math.max(P.vy, -2.5); P.vx *= 0.9; P.vz *= 0.9; }
    if (P.y < -4) { P.y = -4; P.vy = 0; }
    // spin: flail while airborne, wind down once sliding on the deck
    if (P.grounded) { tumble.sx *= 0.92; tumble.sz *= 0.92; }
    if (P.y > -1) { tumble.x += tumble.sx * dt; tumble.z += tumble.sz * dt; }
    if (wipeT > 1.7) $('fade').style.opacity = 1;
    if (wipeT > 2.1) respawn();
  }
}

// ------------------------------------------------------------------ render
let camX = 0, camY = 5, camSnap = true, menuA = 0;
const lookAt = new THREE.Vector3();
function render(dt, now) {
  // avatar
  const root = avatar.group;
  root.position.set(P.x, P.y, P.z);
  root.rotation.y = P.heading;
  const wip = state === 'wipeout';
  if (wip) {
    avatar.pivot.rotation.x = tumble.x;
    avatar.pivot.rotation.z = tumble.z;
  } else {
    avatar.pivot.rotation.z = 0;
    if (avatar.pivot.rotation.x > 1 || avatar.pivot.rotation.x < -1) avatar.pivot.rotation.x = 0;
  }
  const blink = invuln > 0 && state === 'playing' && Math.floor(now / 90) % 2 === 0;
  root.visible = !blink;
  avatar.animate(dt, { speed: Math.hypot(P.vx, P.vz), grounded: P.grounded, vy: P.vy, tumbling: wip });

  // camera
  shake = Math.max(0, shake - dt * 1.6);
  const k = camSnap ? 1 : 1 - Math.exp(-dt * 5);
  if (state === 'menu') {
    menuA += dt * 0.35;
    camera.position.set(P.x + Math.sin(menuA) * 5.5, 2.6, P.z + Math.cos(menuA) * 5.5);
    camera.lookAt(P.x, 1.2, P.z);
  } else {
    // Side-on 3/4 view: the course scrolls left -> right, obstacles are visible ahead of you.
    const ty = 5.4 + Math.max(0, P.y) * 0.4;
    camX += (P.x * 0.5 - camX) * k;
    camY += (ty - camY) * k;
    camSnap = false;
    camera.position.set(camX + 15 + (Math.random() - 0.5) * shake * 0.5, Math.max(camY, 4) + (Math.random() - 0.5) * shake * 0.5, P.z - 2);
    lookAt.set(P.x * 0.5 - 1, 1.6 + Math.max(0, P.y) * 0.5, P.z - 7.5);
    camera.lookAt(lookAt);
  }

  // sun follows the player so shadows stay crisp
  sun.position.set(P.x + 28, 55, P.z + 18);
  sun.target.position.set(P.x, 0, P.z);

  particles.update(dt);
  if (state !== 'menu') updateHud();
  renderer.render(scene, camera);
}

// -------------------------------------------------------------------- loop
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!paused) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 12) { step(STEP); acc -= STEP; n++; }
    if (n === 12) acc = 0;
  }
  render(paused ? 0 : dt, now);
}

// -------------------------------------------------------------------- init
// Hooks for the "Choose Your Runner" screen (same module graph as game.js).
window.__splash = window.__splash || {};
window.__splash.getRunner = () => runnerKey;
window.__splash.setRunner = (k) => setRunner(k);
window.__splash.RUNNERS = RUNNERS;
window.dispatchEvent(new CustomEvent('splash:ready'));
$('playBtn').onclick = startGame;
$('boardBtn').onclick = async () => {
  const w = $('boardWrap');
  w.classList.toggle('hidden');
  if (!w.classList.contains('hidden')) await loadBoard($('menuBoard'));
};
$('resumeBtn').onclick = togglePause;
$('restartBtn').onclick = () => { paused = false; $('pause').classList.add('hidden'); resetRun(); };
$('againBtn').onclick = () => { initAudio(); resetRun(); };
$('pauseBtn').onclick = togglePause;
$('muteBtn').onclick = () => { setMuted(!isMuted()); $('muteBtn').style.opacity = isMuted() ? 0.5 : 1; };

course.reset();
placePlayer(spawn);
// let the character settle on the deck before the menu camera shows it
for (let i = 0; i < 60; i++) step(STEP);
// Load the persisted runner behind the procedural placeholder (menu shows it).
setRunner(runnerKey, { persist: false });
requestAnimationFrame(frame);
refreshPlayer();

// ------------------------------------------------- choose-your-runner screen
(function initChooseScreen() {
  const grid = $('chooseGrid');
  if (!grid) return;
  const show = (el, on) => el.classList.toggle('hidden', !on);
  const open = () => {
    show($('menu'), false); show($('choose'), true);
    state = 'menu'; // linger on the menu orbit cam behind the panel
    buildCards();
    markSelected(runnerKey);
  };
  const close = () => { show($('choose'), false); show($('menu'), true); };
  $('chooseBtn').onclick = open;
  $('chooseBackBtn').onclick = close;
  // Await the swap so Play never starts on a stale avatar: with the URL fix
  // the GLB resolves in ms on repeat visits (cached), ~1-3s first load.
  $('runBtn').onclick = async () => {
    const btn = $('runBtn');
    btn.disabled = true; btn.textContent = 'Loading runner…';
    try { await setRunner(runnerKey); }
    finally { btn.disabled = false; btn.textContent = 'Run With This Character'; }
    close(); startGame();
  };
  addEventListener('keydown', (e) => {
    if ($('choose').classList.contains('hidden')) return;
    if (e.code === 'Escape') close();
    if (e.code === 'Enter') { close(); startGame(); }
  });

  let built = false;
  function markSelected(key) {
    grid.querySelectorAll('.choice').forEach((el) => {
      const on = el.dataset.key === key;
      el.classList.toggle('sel', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const r = RUNNERS.find((x) => x.key === key);
    $('chooseName').textContent = r ? r.name : key;
  }

  async function buildCards() {
    if (built) { markSelected(runnerKey); return; }
    built = true;
    const { renderRunnerThumb } = await import('./runners.js');
    for (const r of RUNNERS) {
      const b = document.createElement('button');
      b.className = 'choice'; b.dataset.key = r.key;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-label', `Run as ${r.name}`);
      const cv = document.createElement('canvas');
      cv.width = 220; cv.height = 293; // 3:4 to match CSS aspect-ratio
      const nm = document.createElement('b'); nm.textContent = r.name;
      const st = document.createElement('span'); st.className = 'st'; st.textContent = 'loading…';
      b.append(cv, nm, st);
      b.onclick = async () => {
        markSelected(r.key);
        st.textContent = 'loading…';
        const ok = await setRunner(r.key);
        st.textContent = ok ? '' : 'load failed — kept previous runner';
      };
      grid.append(b);
      markSelected(runnerKey);
      // Sequential thumbnails: one tiny WebGL context at a time, disposed
      // immediately so we never hold 5 contexts open.
      try {
        const thumb = await renderRunnerThumb(r.key, cv, { w: cv.width, h: cv.height });
        thumb.dispose();
        st.textContent = '';
      } catch (err) {
        console.warn(`Thumbnail for "${r.key}" failed:`, err);
        st.textContent = 'preview unavailable';
      }
    }
    markSelected(runnerKey);
    $('chooseHint').textContent = 'All five Styloos runners are stored in the game — no downloads needed.';
  }
})();

// ------------------------------------------------------------ menu extras
// How to Play toggle (control list moved out of the always-visible menu).
$('howBtn').onclick = () => {
  const w = $('howWrap');
  const open = w.classList.toggle('hidden') === false;
  $('howBtn').setAttribute('aria-expanded', String(open));
};

// Sign in with start.ng (existing auth flow). Uses the same entry point as
// the profile pill's Sign in button.
$('menuSignInBtn').onclick = () => SN.signIn();
