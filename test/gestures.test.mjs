// Tests for the gesture heuristics. Run: node test/gestures.test.mjs
//
// gestures.js is deliberately free of DOM and MediaPipe imports so it can be
// checked here against synthetic landmarks instead of by standing in front of a
// webcam. When sequence matching arrives, this is where the recorded windows
// should be replayed.
//
// The load-bearing cases are at the bottom: each domain's pose must be rejected
// by the other domain's matcher. Both signs are two-handed and
// fingertip-to-fingertip, so a sloppy threshold makes both fire at once.

import { matchMalevolentShrine, matchUnlimitedVoid } from "../js/gestures.js";

const ASPECT = 16 / 9;
const SIZE = 0.06;
const SHRINE = ["index", "middle"];
const VOID = ["thumb", "index"];
const OPEN = ["thumb", "index", "middle", "ring", "pinky"];
const MEET = [0.5 * ASPECT, 0.34];
const CENTRE = 0.5 * ASPECT;

/**
 * Build a plausible 21-landmark hand in isotropic units (u spans 0..aspect,
 * v spans 0..1). Converted to MediaPipe's normalised coordinates by lm(), which
 * is exactly the squash gestures.js has to undo.
 */
function hand({ wrist, dir, size, extended, chirality = 1 }) {
  const [dx, dy] = dir;
  // Knuckle spread runs perpendicular to the hand axis and flips between a left
  // and a right hand, which is what puts both index fingers on the inner side
  // when the hands are held palm to palm.
  const [px, py] = [-dy * chirality, dx * chirality];
  const pt = (along, across) => ({
    u: wrist[0] + dx * along * size + px * across * size,
    v: wrist[1] + dy * along * size + py * across * size,
  });

  const out = new Array(21);
  out[0] = pt(0, 0);
  // Thumb. Folding it pulls the tip back across the palm rather than out.
  const thumbOut = extended.includes("thumb");
  out[1] = pt(0.3, -0.5);
  out[2] = pt(0.6, -0.8);
  out[3] = pt(0.9, -1.0);
  out[4] = thumbOut ? pt(1.2, -1.1) : pt(0.75, -0.6);

  for (const [name, base, across] of [
    ["index", 5, 0.45],
    ["middle", 9, 0.15],
    ["ring", 13, -0.15],
    ["pinky", 17, -0.45],
  ]) {
    const ext = extended.includes(name);
    out[base] = pt(0.9, across);                    // MCP
    out[base + 1] = pt(1.35, across);               // PIP
    out[base + 2] = pt(ext ? 1.7 : 1.15, across);   // DIP
    out[base + 3] = pt(ext ? 2.1 : 1.05, across);   // TIP
  }
  out[9] = pt(0.9, 0); // middle MCP sets hand scale, so keep it on the axis

  return out;
}

const lm = (h) => h.map((p) => ({ x: p.u / ASPECT, y: p.v, z: 0 }));

/**
 * Move and scale a hand so two of its landmarks land on chosen points. A
 * similarity transform has exactly four degrees of freedom, so two point pairs
 * determine it — which lets a pose be specified by where the fingertips must
 * meet rather than by guessing at wrist angles.
 */
function place(h, [i1, i2], q1, q2) {
  const p1 = h[i1];
  const p2 = h[i2];
  const dp = { u: p2.u - p1.u, v: p2.v - p1.v };
  const dq = { u: q2.u - q1.u, v: q2.v - q1.v };
  const den = dp.u * dp.u + dp.v * dp.v;
  // Complex division dq/dp gives rotation and scale together.
  const a = { u: (dq.u * dp.u + dq.v * dp.v) / den, v: (dq.v * dp.u - dq.u * dp.v) / den };
  return h.map((p) => {
    const z = { u: p.u - p1.u, v: p.v - p1.v };
    return { u: q1.u + a.u * z.u - a.v * z.v, v: q1.v + a.v * z.u + a.u * z.v };
  });
}

/** Reflecting a hand flips its handedness, which is what the other hand is. */
const mirror = (h, cu) => h.map((p) => ({ u: 2 * cu - p.u, v: p.v }));

// ---- Malevolent Shrine: angled inward so the fingertips meet at MEET -------

function shrineHand(side, { extended = SHRINE, reach = 2.1, size = SIZE } = {}) {
  const a = (side * Math.PI) / 3; // ±60° off vertical
  const dir = [Math.sin(a), -Math.cos(a)];
  return lm(
    hand({
      wrist: [MEET[0] - dir[0] * reach * size, MEET[1] - dir[1] * reach * size],
      dir,
      size,
      extended,
      chirality: side,
    }),
  );
}

const shrinePose = (opts) => [shrineHand(1, opts), shrineHand(-1, opts)];

// ---- Unlimited Void: thumbs meeting low, index tips meeting high -----------

const INDEX_TIP = 8;
const THUMB_TIP = 4;

/**
 * @param {number} gap    how far each hand sits from the centre line
 * @param {number} span   vertical distance between the two meeting points
 */
function voidPose({ extended = VOID, gap = 0.004, span = 0.12, top = 0.30 } = {}) {
  const base = hand({ wrist: [0, 0], dir: [0, -1], size: SIZE, extended, chirality: 1 });
  const left = place(
    base,
    [INDEX_TIP, THUMB_TIP],
    { u: CENTRE - gap, v: top },
    { u: CENTRE - gap, v: top + span },
  );
  return [lm(left), lm(mirror(left, CENTRE))];
}

// ---- cases ----------------------------------------------------------------

let failures = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(40)} ${got} (want ${want})`);
  return ok;
}

function report(name, hands, matcher, want) {
  const { match, checks } = matcher(hands, ASPECT);
  if (!check(name, match, want)) {
    for (const c of checks) console.log(`          ${c.pass ? "ok  " : "MISS"} ${c.name}`);
  }
}

console.log("Malevolent Shrine:");
report("the sign", shrinePose(), matchMalevolentShrine, true);
report("close to camera", shrinePose({ size: 0.12 }), matchMalevolentShrine, true);
report("far from camera", shrinePose({ size: 0.03 }), matchMalevolentShrine, true);
report("held sloppily", shrinePose({ reach: 1.9 }), matchMalevolentShrine, true);
report("no hands", [], matchMalevolentShrine, false);
report("one hand only", [shrineHand(1)], matchMalevolentShrine, false);
report("both hands open", shrinePose({ extended: OPEN }), matchMalevolentShrine, false);
report("fists", shrinePose({ extended: [] }), matchMalevolentShrine, false);
report("hands apart", [
  lm(hand({ wrist: [0.35 * ASPECT, 0.7], dir: [0, -1], size: SIZE, extended: SHRINE })),
  lm(hand({ wrist: [0.75 * ASPECT, 0.7], dir: [0, -1], size: SIZE, extended: SHRINE, chirality: -1 })),
], matchMalevolentShrine, false);

console.log("\nUnlimited Void:");
report("the sign", voidPose(), matchUnlimitedVoid, true);
report("close to camera", voidPose({ span: 0.22 }), matchUnlimitedVoid, true);
report("far from camera", voidPose({ span: 0.06 }), matchUnlimitedVoid, true);
report("fingertips not quite touching", voidPose({ gap: 0.012 }), matchUnlimitedVoid, true);
report("no hands", [], matchUnlimitedVoid, false);
report("one hand only", [voidPose()[0]], matchUnlimitedVoid, false);
report("both hands open", voidPose({ extended: OPEN }), matchUnlimitedVoid, false);
report("fists", voidPose({ extended: [] }), matchUnlimitedVoid, false);
report("hands apart", voidPose({ gap: 0.09 }), matchUnlimitedVoid, false);

console.log("\nthe two domains must not collide:");
report("Shrine pose vs Void matcher", shrinePose(), matchUnlimitedVoid, false);
report("Void pose vs Shrine matcher", voidPose(), matchMalevolentShrine, false);

// ---- noise ----------------------------------------------------------------

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
const jitter = (h, amt) => h.map((p) => ({ x: p.x + rnd() * amt, y: p.y + rnd() * amt, z: 0 }));

console.log("\nmatch rate under landmark noise (as % of hand scale):");
for (const [label, pose, matcher] of [
  ["shrine", shrinePose, matchMalevolentShrine],
  ["void", voidPose, matchUnlimitedVoid],
]) {
  for (const pct of [2, 5, 8]) {
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      const amt = (pct / 100) * SIZE;
      if (matcher(pose().map((h) => jitter(h, amt)), ASPECT).match) hits++;
    }
    const rate = Math.round((hits / 300) * 100);
    // Below ~8% noise a held sign should register essentially every frame.
    if (rate < 90) failures++;
    console.log(`  ${label.padEnd(7)} ${String(pct).padStart(2)}% noise -> ${String(rate).padStart(3)}% match`);
  }
}

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
