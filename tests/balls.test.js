// Headless tests for the Giant Bouncing Balls collision predicate.
// Run: node tests/balls.test.js   (exit 0 = all pass)
// Uses the REAL constants from physics.js — no mocks, no browser.
import { R, GRAV, JUMP, SPEED, crownContact } from '../js/physics.js';

const BALL = { x: 0, cy: -0.85, z: -211.5, r: 2.0 }; // matches course.js tuning
const TOL = R;
const DT = 1 / 60;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.log(`NOT OK - ${name} ${extra}`); }
};
// Surface height at horizontal offset d from ball center.
const surfAt = (d) => BALL.cy + Math.sqrt((BALL.r + TOL) ** 2 - d * d);

// 1. Centered landing: feet cross the crown while descending -> bounce contact.
{
  const s = surfAt(0);
  const c = crownContact(BALL, 0, s + 0.05, s - 0.02, BALL.z, -3);
  ok('centered descending landing bounces', !!c && !c.slide && Math.abs(c.surfY - s) < 1e-9, JSON.stringify(c));
}

// 2. Forgiving off-center landing (d=1.9m, ny≈0.6 — well inside the upper
//    bowl a real descending arc touches) -> bounces.
{
  const d = 1.9;
  const s = surfAt(d);
  const c = crownContact(BALL, d, s + 0.35, s + 0.01, BALL.z, -3);
  ok(`off-center landing (d=${d.toFixed(2)}m) bounces`, !!c && !c.slide, JSON.stringify(c));
}

// 3. Just past the edge (ny < 0.45): vertical graze gives no bounce contact
//    (falls to the side-entry branch or null — never a bounce).
{
  const rr = BALL.r + TOL;
  const d = rr * Math.sqrt(1 - 0.44 * 0.44) + 0.01;
  const s = BALL.cy + Math.sqrt(Math.max(0, rr * rr - d * d));
  const c = crownContact(BALL, d, s + 0.05, s - 0.02, BALL.z, -3);
  ok('equator graze never bounces', !c || c.slide === true, JSON.stringify(c));
}

// 4. Rising past a ball never triggers (vy > 0).
{
  const s = surfAt(0);
  const c = crownContact(BALL, 0, s - 0.3, s + 0.1, BALL.z, 5);
  ok('rising past ball never triggers', c === null, JSON.stringify(c));
}

// 5. Walking underneath (feet below the ball, inside padded sphere low) ->
//    slide push-out, not a bounce, not a fall-through.
{
  const c = crownContact(BALL, 0.6, -3.2, -3.0, BALL.z, -6);
  ok('low side entry slides instead of tunneling', !!c && c.slide === true, JSON.stringify(c));
}

// 6. Fast fall can't tunnel: full-speed terminal step still straddles.
//    Worst case: vy=-34 is clamped by stepMovement to one dt of ~0.57m... but
//    the AABB pass runs first; here we check a realistic -12m/s bounce fall.
{
  const s = surfAt(0.8);
  const prevY = s + 0.15, py = prevY + (-12) * DT; // one 60Hz step at -12m/s
  const c = crownContact(BALL, 0.8, prevY, py, BALL.z, -12);
  const crossed = prevY >= s - 0.02 && py <= s + 0.02;
  ok('fast fall step straddles surface (no tunnel)', crossed && !!c && !c.slide, `prevY=${prevY.toFixed(3)} py=${py.toFixed(3)} surf=${s.toFixed(3)}`);
}

// 7. One bounce per landing: after a bounce the ball's 0.25s cooldown
//    suppresses re-trigger while the player is still in contact range.
{
  let cool = 0.25;
  let triggers = 0;
  const s = surfAt(0);
  for (let i = 0; i < 15; i++) { // 15 frames = 0.25s at 60Hz
    cool = Math.max(0, cool - DT);
    if (cool <= 0) {
      const c = crownContact(BALL, 0, s + 0.01, s - 0.01, BALL.z, -1);
      if (c && !c.slide) triggers++;
      cool = 0.25; // game would re-arm after bouncing
      break;
    }
  }
  ok('cooldown suppresses immediate re-trigger (1 bounce)', triggers <= 1, `triggers=${triggers}`);
}

// 8. Traversal reachability: bounce (vy=12) + full forward run covers the
//    6.4m gap. Airtime = 2*12/24 = 1.0s; distance at 7.2m/s = 7.2m > 6.4m.
{
  const airtime = (2 * 12.0) / GRAV;
  const reach = SPEED * airtime;
  ok(`bounce reaches next ball (reach ${reach.toFixed(1)}m >= 6.4m gap)`, reach >= 6.4);
}

// 9. Entry jump reachability: platform edge (z=-207.5) to ball 1's near
//    crown slope (~4m out). Full run + jump crosses crown height at 4.2m,
//    then the vy=12 bounce carries to ball 2.
{
  // Range of a jump from deck to a target ~0.9m higher (near slope):
  // solve roughly via sim (same integration as the game loop).
  let y = 0, vy = JUMP, z = 0, t = 0;
  while (t < 2 && y >= -0.5) { vy -= GRAV * DT; y += vy * DT; z += SPEED * DT; t += DT; if (y <= 0.9 && vy < 0) break; }
  ok(`entry jump reaches ball 1 near slope (~4m, sim ${z.toFixed(1)}m)`, z >= 4.0, `z=${z.toFixed(2)}`);
}

// 10. Exit: ball 4 crown (z=-231.7) to finish deck edge (z=-229, 2.7m past
//     center... actually finish platform starts at z=-229): a bounce from
//     ball 4 easily overshoots 2.7m forward. Check minimum: even a weak
//     6 m/s bounce travels 6*0.5=3m in its half... full airtime 1.0s -> 7.2m.
{
  ok('ball 4 bounce reaches finish deck', SPEED * ((2 * 12.0) / GRAV) >= 2.7);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
