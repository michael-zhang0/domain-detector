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
const SHRINE = ["middle", "ring"];
const VOID = ["index", "middle"];
const OPEN = ["thumb", "index", "middle", "ring", "pinky"];
const MEET = [0.5 * ASPECT, 0.34];
const CENTRE = 0.5 * ASPECT;

/**
 * Build a plausible 21-landmark hand in isotropic units (u spans 0..aspect,
 * v spans 0..1). Converted to MediaPipe's normalised coordinates by lm(), which
 * is exactly the squash gestures.js has to undo.
 */
function hand({ wrist, dir, size, extended, chirality = 1, spread = 1, crossed = false }) {
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
    // `spread` fans the two front fingers apart, to model a peace sign.
    const s = name === "index" || name === "middle" ? across * spread : across;
    // Crossing swaps the fingertips over each other while the knuckles stay in
    // their normal order — which is exactly the asymmetry the matcher looks for.
    let tipS = s;
    if (crossed && name === "index") tipS = 0.05;
    if (crossed && name === "middle") tipS = 0.55;
    out[base] = pt(0.9, s);                       // MCP
    out[base + 1] = pt(1.35, s);                  // PIP
    out[base + 2] = pt(ext ? 1.7 : 1.15, tipS);   // DIP
    out[base + 3] = pt(ext ? 2.1 : 1.05, tipS);   // TIP
  }
  out[9] = pt(0.9, 0); // middle MCP sets hand scale, so keep it on the axis

  return out;
}

const lm = (h) => h.map((p) => ({ x: p.u / ASPECT, y: p.v, z: 0 }));

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

// ---- Unlimited Void: one raised hand, two fingers up as a blade ------------

/**
 * @param {number[]} dir  which way the fingers point; [0,-1] is straight up
 * @param {number} spread 1 = pressed together, higher fans them into a V
 */
function voidPose({ extended = VOID, dir = [0, -1], spread = 1, size = SIZE, crossed = true } = {}) {
  return [lm(hand({ wrist: [CENTRE, 0.7], dir, size, extended, spread, crossed }))];
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
report("close to camera", voidPose({ size: 0.12 }), matchUnlimitedVoid, true);
report("far from camera", voidPose({ size: 0.03 }), matchUnlimitedVoid, true);
report("tilted, still upward", voidPose({ dir: [0.5, -0.87] }), matchUnlimitedVoid, true);
report("no hands", [], matchUnlimitedVoid, false);
report("hand open", voidPose({ extended: OPEN }), matchUnlimitedVoid, false);
report("fist", voidPose({ extended: [] }), matchUnlimitedVoid, false);
// The things people actually do at a webcam without meaning anything by it.
// Both have the same two fingers up; only the crossing tells them apart.
report("two fingers up, uncrossed", voidPose({ crossed: false }), matchUnlimitedVoid, false);
report("peace sign (spread, uncrossed)", voidPose({ crossed: false, spread: 3 }), matchUnlimitedVoid, false);
report("pointing sideways", voidPose({ dir: [1, 0] }), matchUnlimitedVoid, false);
report("pointing down", voidPose({ dir: [0, 1] }), matchUnlimitedVoid, false);

console.log("\nthe two domains must not collide:");
// Hand count is the entire discriminator, so these two are the load-bearing
// assertions in this file.
report("Shrine pose vs Void matcher", shrinePose(), matchUnlimitedVoid, false);
report("Void pose vs Shrine matcher", voidPose(), matchMalevolentShrine, false);
// Beyond hand count, the finger patterns now disagree outright: the Shrine
// raises middle and ring, the Void index and middle. A lone Shrine hand fails
// the Void on three separate checks (fingers, crossing, tilt), so a dropped
// hand mid-sign cannot be misread as the other domain.
report("a lone Shrine hand is not the Void", [shrinePose()[0]], matchUnlimitedVoid, false);
report("...and one hand is not the Shrine either", [shrinePose()[0]], matchMalevolentShrine, false);
// And the reverse: two crossed-finger hands are not a Shrine sign.
report("two Void hands are not the Shrine", [voidPose()[0], voidPose()[0]], matchMalevolentShrine, false);

// The Void must not depend on hand count. MediaPipe's count flickers between
// one and two as a second hand drifts in and out of confidence; gating on it
// made the domain unopenable in practice. Exclusivity comes from the fingers.
{
  const idle = lm(hand({ wrist: [0.15 * ASPECT, 0.8], dir: [0, -1], size: SIZE, extended: OPEN }));
  const fist = lm(hand({ wrist: [0.15 * ASPECT, 0.8], dir: [0, -1], size: SIZE, extended: [] }));
  report("Void fires with an idle hand also in frame", [voidPose()[0], idle], matchUnlimitedVoid, true);
  report("Void fires with a fist also in frame", [fist, voidPose()[0]], matchUnlimitedVoid, true);
  report("...and neither combination is the Shrine", [voidPose()[0], idle], matchMalevolentShrine, false);
}

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
