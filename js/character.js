import * as THREE from 'three';
import { RoundedBoxGeometry } from '../lib/RoundedBoxGeometry.js';

export const DEFAULT_STYLE = {
  body: 'female', primaryColor: '#a55eea', secondaryColor: '#0c6e5a', skinColor: '#8d5524',
  hairColor: '#17120f', hair: 'short', hat: 'none', accessory: 'none',
};

const HEX = /^#[0-9a-f]{6}$/i;
const col = (v, fb) => (typeof v === 'string' && HEX.test(v) ? v : fb);

/**
 * Builds a low-poly 3D version of a start.ng character (see "Character style fields").
 * Feet are at y = 0, the character faces +Z. `group.rotation.y` turns it, `pivot` tumbles it.
 */
export function buildCharacter(style) {
  const s = { ...DEFAULT_STYLE, ...(style || {}) };
  const primary = col(s.primaryColor, DEFAULT_STYLE.primaryColor);
  const secondary = col(s.secondaryColor, DEFAULT_STYLE.secondaryColor);
  const skin = col(s.skinColor, DEFAULT_STYLE.skinColor);
  const hairC = col(s.hairColor, DEFAULT_STYLE.hairColor);
  const female = s.body !== 'male';

  const M = (c, r = 0.55) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const mPrimary = M(primary), mSecondary = M(secondary), mSkin = M(skin, 0.7), mHair = M(hairC, 0.8);
  const mGold = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.25, metalness: 0.6 });
  const mDark = M(0x1b1b24, 0.5);

  const group = new THREE.Group();
  const pivot = new THREE.Group();
  const body = new THREE.Group();
  pivot.position.y = 0.9; body.position.y = -0.9;
  group.add(pivot); pivot.add(body);

  const add = (parent, geo, material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.castShadow = true;
    parent.add(m);
    return m;
  };

  // torso
  const tw = female ? 0.4 : 0.5;
  add(body, new RoundedBoxGeometry(tw, 0.6, 0.27, 2, 0.07), mPrimary, 0, 0.92, 0);
  // legs
  const legMat = female ? mSkin : mSecondary;
  const legs = [-1, 1].map((sx) => {
    const g = new THREE.Group(); g.position.set(sx * 0.11, 0.64, 0);
    add(g, new THREE.CapsuleGeometry(female ? 0.07 : 0.085, 0.32, 4, 8), legMat, 0, -0.27, 0);
    add(g, new RoundedBoxGeometry(0.15, 0.1, 0.26, 2, 0.04), mDark, 0, -0.58, 0.04);
    body.add(g);
    return g;
  });
  if (female) add(body, new THREE.CylinderGeometry(0.2, 0.34, 0.32, 14), mSecondary, 0, 0.7, 0);
  // arms
  const arms = [-1, 1].map((sx) => {
    const g = new THREE.Group(); g.position.set(sx * (tw / 2 + 0.07), 1.17, 0);
    add(g, new THREE.CapsuleGeometry(0.065, 0.16, 4, 8), mPrimary, 0, -0.14, 0);
    add(g, new THREE.CapsuleGeometry(0.055, 0.14, 4, 8), mSkin, 0, -0.32, 0);
    body.add(g);
    return g;
  });
  // head
  const headY = 1.5;
  const head = add(body, new THREE.SphereGeometry(0.28, 20, 16), mSkin, 0, headY, 0);
  head.castShadow = true;
  for (const sx of [-1, 1]) {
    add(body, new THREE.SphereGeometry(0.036, 8, 6), mDark, sx * 0.1, headY + 0.03, 0.255);
  }
  const smile = add(body, new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), M(0x7a1f2b), 0, headY - 0.08, 0.265);
  smile.rotation.z = Math.PI;
  smile.castShadow = false;

  // hair
  const cap = (r = 0.3, ph = 0.56) => add(body, new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI * ph), mHair, 0, headY + 0.01, -0.015);
  const strand = (x, y, z, len = 0.5, rad = 0.04, tilt = 0) => {
    const m = add(body, new THREE.CylinderGeometry(rad, rad * 0.8, len, 6), mHair, x, y, z);
    m.rotation.x = tilt;
    return m;
  };
  switch (s.hair) {
    case 'bald': break;
    case 'afro': add(body, new THREE.SphereGeometry(0.43, 20, 16), mHair, 0, headY + 0.1, -0.04); break;
    case 'bun': cap(); add(body, new THREE.SphereGeometry(0.13, 12, 10), mHair, 0, headY + 0.34, -0.02); break;
    case 'ponytail': {
      cap();
      const tail = add(body, new THREE.CapsuleGeometry(0.06, 0.34, 4, 8), mHair, 0, headY - 0.1, -0.33);
      tail.rotation.x = -0.35;
      break;
    }
    case 'braids':
      cap(0.31, 0.6);
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * 0.15 + (i / 6) * Math.PI * 0.7; // back arc
        strand(Math.cos(a + Math.PI) * 0.27, headY - 0.22, -Math.sin(a) * 0.2 - 0.05, 0.5, 0.035);
      }
      break;
    case 'dreads':
      cap(0.31, 0.6);
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        strand(Math.cos(a) * 0.28, headY - 0.18, Math.sin(a) * 0.26 - 0.03, 0.5, 0.045);
      }
      break;
    case 'short':
    default: cap(); break;
  }

  // hat
  switch (s.hat) {
    case 'cap': {
      add(body, new THREE.SphereGeometry(0.315, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), mSecondary, 0, headY + 0.04, 0);
      add(body, new THREE.CylinderGeometry(0.2, 0.2, 0.035, 16, 1, false, -Math.PI / 2, Math.PI), mSecondary, 0, headY + 0.07, 0.27);
      break;
    }
    case 'beanie': {
      add(body, new THREE.SphereGeometry(0.325, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mSecondary, 0, headY + 0.04, 0);
      add(body, new THREE.SphereGeometry(0.08, 10, 8), mPrimary, 0, headY + 0.36, 0);
      break;
    }
    case 'tophat': {
      add(body, new THREE.CylinderGeometry(0.4, 0.4, 0.04, 20), mDark, 0, headY + 0.24, 0);
      add(body, new THREE.CylinderGeometry(0.22, 0.24, 0.42, 20), mDark, 0, headY + 0.45, 0);
      add(body, new THREE.CylinderGeometry(0.245, 0.245, 0.08, 20), mPrimary, 0, headY + 0.32, 0);
      break;
    }
    case 'crown': {
      add(body, new THREE.CylinderGeometry(0.25, 0.22, 0.14, 12, 1, true), mGold, 0, headY + 0.3, 0).material.side = THREE.DoubleSide;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(body, new THREE.ConeGeometry(0.06, 0.16, 6), mGold, Math.cos(a) * 0.23, headY + 0.45, Math.sin(a) * 0.23);
      }
      break;
    }
    default: break;
  }

  // accessory
  switch (s.accessory) {
    case 'glasses': {
      for (const sx of [-1, 1]) {
        add(body, new THREE.TorusGeometry(0.075, 0.014, 6, 16), mDark, sx * 0.11, headY + 0.03, 0.27);
      }
      add(body, new THREE.BoxGeometry(0.06, 0.014, 0.014), mDark, 0, headY + 0.04, 0.275);
      break;
    }
    case 'earrings':
      for (const sx of [-1, 1]) add(body, new THREE.SphereGeometry(0.04, 8, 6), mGold, sx * 0.285, headY - 0.1, 0);
      break;
    case 'beard': {
      const b = add(body, new THREE.SphereGeometry(0.2, 14, 10), mHair, 0, headY - 0.17, 0.1);
      b.scale.set(1, 0.85, 0.8);
      break;
    }
    case 'scarf': {
      const t = add(body, new THREE.TorusGeometry(0.19, 0.065, 8, 16), mSecondary, 0, 1.27, 0);
      t.rotation.x = Math.PI / 2;
      add(body, new RoundedBoxGeometry(0.1, 0.34, 0.05, 2, 0.02), mSecondary, 0.1, 1.1, 0.16);
      break;
    }
    case 'backpack':
      add(body, new RoundedBoxGeometry(0.34, 0.46, 0.2, 2, 0.06), mSecondary, 0, 0.95, -0.24);
      break;
    default: break;
  }

  // ---- animation
  let phase = 0, idleT = 0;
  const api = {
    group, pivot,
    /** a: { speed, grounded, vy, tumbling } */
    animate(dt, a) {
      idleT += dt;
      if (a.tumbling) {
        phase += dt * 14;
        arms[0].rotation.x = Math.sin(phase) * 2.2; arms[1].rotation.x = Math.cos(phase * 1.2) * 2.2;
        legs[0].rotation.x = Math.cos(phase * 0.9) * 1.4; legs[1].rotation.x = Math.sin(phase * 1.1) * 1.4;
        arms[0].rotation.z = 0.5; arms[1].rotation.z = -0.5;
        return;
      }
      arms[0].rotation.z = 0; arms[1].rotation.z = 0;
      if (!a.grounded) {
        arms[0].rotation.x = -2.5 + Math.sin(idleT * 12) * 0.12;
        arms[1].rotation.x = -2.5 - Math.sin(idleT * 12) * 0.12;
        legs[0].rotation.x = -0.7; legs[1].rotation.x = 0.55;
        pivot.rotation.x += (0.12 - pivot.rotation.x) * Math.min(1, dt * 10);
      } else if (a.speed > 0.5) {
        phase += dt * a.speed * 1.9;
        const k = Math.min(1, a.speed / 6);
        const sw = Math.sin(phase) * 1.0 * k;
        legs[0].rotation.x = sw; legs[1].rotation.x = -sw;
        arms[0].rotation.x = -sw * 0.9; arms[1].rotation.x = sw * 0.9;
        pivot.rotation.x += (0.2 * k - pivot.rotation.x) * Math.min(1, dt * 10);
      } else {
        const b = Math.sin(idleT * 2.2) * 0.04;
        legs[0].rotation.x = legs[1].rotation.x = 0;
        arms[0].rotation.x = arms[1].rotation.x = b;
        pivot.rotation.x += (0 - pivot.rotation.x) * Math.min(1, dt * 10);
      }
    },
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    },
  };
  return api;
}
