// Tiny synthesized sound effects (no audio files needed).
let ctx = null, master = null, muted = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.35; master.connect(ctx.destination);
  } catch { ctx = null; }
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.35; }
export const isMuted = () => muted;

function tone(type, f0, f1, dur, vol = 0.4, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, freq, vol = 0.5) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master); src.start(t);
}

export function sfx(name) {
  if (!ctx || muted) return;
  switch (name) {
    case 'jump': tone('sine', 260, 560, 0.14, 0.3); break;
    case 'land': tone('sine', 120, 60, 0.1, 0.25); break;
    case 'bonk': tone('square', 220, 70, 0.28, 0.3); tone('sine', 90, 40, 0.3, 0.4); break;
    case 'splash': noise(0.7, 1800, 0.7); tone('sine', 500, 150, 0.3, 0.15); break;
    case 'star': tone('triangle', 880, 880, 0.08, 0.3); tone('triangle', 1320, 1320, 0.14, 0.3, 0.07); break;
    case 'checkpoint': [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.16, 0.35, i * 0.08)); break;
    case 'count': tone('square', 440, 440, 0.14, 0.2); break;
    case 'go': tone('square', 880, 880, 0.4, 0.25); break;
    case 'finish': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.22, 0.35, i * 0.11)); break;
    case 'tile': tone('square', 140, 90, 0.08, 0.1); break;
    case 'boing': tone('sine', 180, 620, 0.22, 0.35); tone('triangle', 90, 220, 0.18, 0.2); break;
  }
}
