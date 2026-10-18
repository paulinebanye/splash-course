// Styloos chibi runner catalog + GLB loading for Splash Course.
// Static, no build step. Models live in ./assets/characters/*.glb (copied from
// Tiny Trouble's PBR "pr" set; Three.js r170 == tiny-trouble's three 0.170.0).
import * as THREE from 'three';
import { GLTFLoader } from '../../lib/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../../lib/addons/utils/SkeletonUtils.js';

export const RUNNER_STORAGE_KEY = 'splash-course:runner';

// Active roster. merchant.glb ("Mayor Honey") is intentionally NOT listed —
// asset kept on disk but inactive. loadRunnerKey() below coerces any stale
// saved 'merchant' pick back to the default (student).
export const RUNNERS = [
  { key: 'student', name: 'Scholar Poppy', file: './assets/characters/student.glb', color: '#ffd23a' },
  { key: 'ninja',   name: 'Shadow Mochi',  file: './assets/characters/ninja.glb',   color: '#7dff7a' },
  { key: 'archer',  name: 'Fern Archer',   file: './assets/characters/archer.glb',  color: '#12c9b0' },
  { key: 'knight',  name: 'Sir Bumble',    file: './assets/characters/knight.glb',  color: '#4aa0ff' },
];

const FILES = Object.fromEntries(RUNNERS.map((r) => [r.key, r.file]));
export const isRunnerKey = (k) => RUNNERS.some((r) => r.key === k);
// Asset base: files[] are relative to the GAME ROOT (index.html), but
// import.meta.url points at js/runners.js. Resolve against the document base
// instead -- new URL('./assets/...', import.meta.url) would wrongly produce
// /js/assets/... (404) and break every preview + avatar swap.
function assetUrl(rel) {
  return new URL(rel, document.baseURI).href;
}

export function loadRunnerKey() {
  try {
    const k = localStorage.getItem(RUNNER_STORAGE_KEY);
    if (isRunnerKey(k)) return k;
  } catch { /* private mode etc. */ }
  return 'student';
}

export function saveRunnerKey(key) {
  if (!isRunnerKey(key)) return;
  try { localStorage.setItem(RUNNER_STORAGE_KEY, key); } catch { /* ignore */ }
}

// Animation-name normalization (knight/ninja use `runanim_` style names,
// archer/merchant/student use `anim_run` style names).
export function normClip(name) {
  const l = String(name).toLowerCase();
  if (l.includes('crouchiddle')) return 'crouch_idle';
  if (l.includes('uncrouch')) return 'uncrouch';
  if (l.includes('crouch')) return 'crouch';
  if (l.includes('dying') || l.includes('die') || l.includes('fall') || l.includes('wipeout')) return 'die';
  if (l.includes('flip')) return 'flip';
  if (l.includes('iddle.001') || l.includes('idle.001') || l.includes('idle_alt')) return 'idle_alt';
  if (l.includes('iddle') || l.includes('idle')) return 'idle';
  if (l.includes('jump')) return 'jump';
  if (l.includes('push')) return 'push';
  if (l.includes('run')) return 'run';
  if (l.includes('walk')) return 'walk';
  return l;
}

const loader = new GLTFLoader();
// Cache raw parsed GLTFs per key; each avatar clones its own scene graph so
// switching/dispose never touches another avatar's objects.
const gltfCache = new Map();   // key -> Promise<GLTF>

function loadGltf(key) {
  if (!gltfCache.has(key)) {
    gltfCache.set(key, (async () => {
      const res = await fetch(assetUrl(FILES[key]));
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${FILES[key]}`);
      const buf = await res.arrayBuffer();
      return await new Promise((resolve, reject) =>
        loader.parse(buf, '', resolve, reject));
    }));
  }
  return gltfCache.get(key);
}

export async function buildRunnerAvatar(key) {
  if (!isRunnerKey(key)) key = 'student';
  let gltf;
  try { gltf = await loadGltf(key); } catch (err) {
    console.warn(`Runner "${key}" failed to load, procedural fallback will be used:`, err);
    return null;
  }
  const group = new THREE.Group();
  group.name = 'runner-' + key;
  const pivot = new THREE.Group();
  pivot.position.y = 0.9;
  const inner = new THREE.Group();
  inner.position.y = -0.9;
  group.add(pivot); pivot.add(inner);
  // SkeletonUtils.clone keeps skinned-mesh bone bindings valid (plain
  // Object3D.clone would leave animations broken on these rigged GLBs).
  // NOTE: cloneSkinned shares geometries/materials with the cache source, so
  // dispose() below must NOT dispose them (the cache owns them).
  const model = cloneSkinned(gltf.scene);
  const clips = (gltf.animations || []).map((c) => c.clone());
  const bbox = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const s = size.y > 1e-4 ? 1.78 / size.y : 1;
  model.scale.setScalar(s);
  bbox.setFromObject(model);
  model.position.y -= bbox.min.y;
  inner.add(model);
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.isMeshStandardMaterial) {
          if (m.roughness == null || m.roughness < 0.85) m.roughness = 0.85;
          if (m.metalness == null || m.metalness > 0.05) m.metalness = 0.05;
          m.side = THREE.DoubleSide;
        }
      }
    }
  });
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of clips) {
    const std = normClip(clip.name);
    let action = null;
    try { action = mixer.clipAction(clip); } catch { action = null; }
    if (!action) continue;
    if (std === 'jump' || std === 'flip' || std === 'die' || std === 'push') action.clampWhenFinished = true;
    if (!actions[std]) actions[std] = action;
    if (!actions[clip.name]) actions[clip.name] = action;
  }
  const hasClips = Object.keys(actions).length > 0;
  if (hasClips) {
    Object.values(actions).forEach((a) => { a.play(); a.weight = 0; });
  }
  let active = null;
  const fadeTo = (name, dur) => {
    if (!hasClips) return;
    dur = dur == null ? 0.18 : dur;
    const next = actions[name] || actions[normClip(name)]
      || actions.idle || actions.walk || actions.run || Object.values(actions)[0];
    if (!next || next === active) return;
    next.enabled = true; next.reset(); next.setEffectiveWeight(1);
    next.fadeIn(dur); next.play();
    if (active && active !== next) active.fadeOut(dur);
    active = next;
  };
  fadeTo('idle', 0.05);
  let phase = 0, airT = 0;
  const api = {
    group, pivot, runnerKey: key,
    animate(dt, a) {
      a = a || {};
      dt = Math.min(Math.max(dt, 0), 0.1);
      const speed = a.speed || 0;
      if (a.tumbling) fadeTo('die', 0.1);
      else if (!a.grounded) fadeTo('jump', 0.12);
      else if (speed > 3.2) fadeTo('run', 0.15);
      else if (speed > 0.15) fadeTo('walk', 0.15);
      else fadeTo('idle', 0.2);
      if (!hasClips) {
        // Procedural fallback for static (animation-less) GLBs: bob while
        // running, stretch + tilt in air, upright on ground. Wipeout tumble
        // is applied by game.js via pivot rotation.
        if (!a.grounded) {
          airT += dt;
          inner.position.y = -0.9 + 0.06;
          model.rotation.x += ((-0.25) - model.rotation.x) * Math.min(1, dt * 8);
        } else {
          airT = 0;
          model.rotation.x += (0 - model.rotation.x) * Math.min(1, dt * 10);
          if (speed > 0.5) {
            phase += dt * (4 + speed * 1.6);
            inner.position.y = -0.9 + Math.abs(Math.sin(phase)) * 0.09 * Math.min(1, speed / 6);
            model.rotation.z = Math.sin(phase) * 0.045 * Math.min(1, speed / 6);
          } else {
            phase += dt * 2.2;
            inner.position.y = -0.9 + Math.sin(phase) * 0.02;
            model.rotation.z *= 1 - Math.min(1, dt * 8);
          }
        }
      } else if (!a.tumbling && a.grounded && speed > 0.5) {
        phase += dt * speed * 1.9;
        inner.position.y = -0.9 + Math.abs(Math.sin(phase)) * 0.05 * Math.min(1, speed / 6);
      } else {
        inner.position.y += (-0.9 - inner.position.y) * Math.min(1, dt * 10);
      }
      if (hasClips) mixer.update(dt);
    },
    dispose() {
      // Cache owns geometries/materials/textures (shared across avatars);
      // just stop the mixer and detach. No per-avatar GL dispose needed.
      mixer.stopAllAction();
      if (model.parent) model.parent.remove(model);
    },
  };
  return api;
}

// Shared offscreen renderer for ALL selection thumbnails. One context total:
// render each card, then copy to its 2D canvas (survives dispose; per-card
// WebGL canvases went blank because dispose() destroys their buffer).
let thumbRenderer = null;
function getThumbRenderer(w, h) {
  if (!thumbRenderer) {
    const cv = document.createElement('canvas');
    thumbRenderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  thumbRenderer.setSize(w, h, false);
  thumbRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  return thumbRenderer;
}

// Render a one-off idle thumbnail for a selection card into a 2D canvas.
// Sequential calls share one hidden WebGL context (no context exhaustion);
// the card keeps a plain 2D copy so nothing is wiped by later renders.
export async function renderRunnerThumb(key, canvas2d, opts) {
  opts = opts || {};
  const w = opts.w || 220, h = opts.h || 220;
  const gltf = await loadGltf(key);
  const renderer = getThumbRenderer(w, h);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdff0ff, 0x6fa84a, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4dd, 2.4);
  sun.position.set(3, 6, 4); scene.add(sun);
  // Extra fill so dark/textured models don't render near-black in the preview.
  const fill = new THREE.DirectionalLight(0xffffff, 0.9);
  fill.position.set(-4, 3, -2); scene.add(fill);
  const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 50);
  const model = cloneSkinned(gltf.scene);
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m && m.isMeshStandardMaterial) m.side = THREE.DoubleSide; });
    }
  });
  const bbox = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const center = new THREE.Vector3(); bbox.getCenter(center);
  const s = size.y > 1e-4 ? 1.78 / size.y : 1;
  model.scale.setScalar(s);
  model.position.x -= center.x * s;
  model.position.z -= center.z * s;
  model.position.y -= bbox.min.y * s;
  model.rotation.y = 0.5;
  scene.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clips = gltf.animations || [];
  const idle = clips.find((c) => normClip(c.name) === 'idle') || clips[0];
  if (idle) {
    try { const a = mixer.clipAction(idle); a.play(); mixer.update(0.6); }
    catch { /* static model: keep bind pose */ }
  }
  // Frame from the FINAL posed + rotated bounding box (includes hats, hair,
  // accessories and any idle-pose limb extension), not a fixed offset.
  model.updateWorldMatrix(true, true);
  const fitBox = new THREE.Box3().setFromObject(model);
  const fitSize = new THREE.Vector3(); fitBox.getSize(fitSize);
  const fitCenter = new THREE.Vector3(); fitBox.getCenter(fitCenter);
  const PAD = 1.1; // 10% headroom so nothing touches the frame edge
  const halfH = (fitSize.y * PAD) / 2;
  const halfW = (fitSize.x * PAD) / 2;
  const vFOV = THREE.MathUtils.degToRad(cam.fov);
  const distForH = halfH / Math.tan(vFOV / 2);
  const hFOV = 2 * Math.atan(Math.tan(vFOV / 2) * cam.aspect);
  const distForW = halfW / Math.tan(hFOV / 2);
  const dist = Math.max(distForH, distForW);
  // Aim at the true centre of the fitted box; small z-offset keeps a 3/4 view.
  cam.position.set(fitCenter.x + 0.6, fitCenter.y + 0.1, fitCenter.z + dist);
  cam.lookAt(fitCenter);
  cam.updateMatrixWorld();
  renderer.render(scene, cam);
  mixer.stopAllAction();
  // Copy to the card's plain 2D canvas: keeps the image after later renders
  // reuse (and eventually dispose) the shared GL context.
  try {
    canvas2d.width = w * Math.min(window.devicePixelRatio || 1, 2);
    canvas2d.height = h * Math.min(window.devicePixelRatio || 1, 2);
    const ctx = canvas2d.getContext('2d');
    ctx.clearRect(0, 0, canvas2d.width, canvas2d.height);
    ctx.drawImage(renderer.domElement, 0, 0, canvas2d.width, canvas2d.height);
  } catch (err) {
    console.warn(`Thumbnail copy for "${key}" failed:`, err);
    throw err;
  }
  return { dispose() { /* shared renderer lives for the session */ } };
}
