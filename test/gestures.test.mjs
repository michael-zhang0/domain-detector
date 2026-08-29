// Tests for the gesture heuristics. Run: node test/gestures.test.mjs
//
// gestures.js is deliberately free of DOM and MediaPipe imports so it can be
// checked here against synthetic landmarks instead of by standing in front of a
// webcam. When sequence matching arrives, this is where the recorded windows
// should be replayed.

import { matchMalevolentShrine, describeHand, describePair, TUNING } from "../js/gestures.js";

const ASPECT = 16 / 9;
const SIZE = 0.06;
const SHRINE = ["index", "middle"];
const OPEN = ["index", "middle", "ring", "pinky"];
const MEET = [0.5 * ASPECT, 0.34];

/**
 * Build a plausible 21-landmark hand. Geometry is done in isotropic units
 * (u spans 0..aspect, v spans 0..1) and converted to MediaPipe's normalised
 * coordinates at the end — which is exactly the squash gestures.js has to undo.
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

  const lm = new Array(21);
  lm[0] = pt(0, 0);
  lm[1] = pt(0.3, -0.5);
  lm[2] = pt(0.6, -0.8);
  lm[3] = pt(0.9, -1.0);
  lm[4] = pt(1.2, -1.1);

  for (const [name, base, across] of [
    ["index", 5, 0.45],
    ["middle", 9, 0.15],
    ["ring", 13, -0.15],
    ["pinky", 17, -0.45],
  ]) {
    const out = extended.includes(name);
    lm[base] = pt(0.9, across);                    // MCP
    lm[base + 1] = pt(1.35, across);               // PIP
    lm[base + 2] = pt(out ? 1.7 : 1.15, across);   // DIP
    lm[base + 3] = pt(out ? 2.1 : 1.05, across);   // TIP
  }
  lm[9] = pt(0.9, 0); // middle MCP sets hand scale, so keep it on the axis

  return lm.map((p) => ({ x: p.u / ASPECT, y: p.v, z: 0 }));
}

/** One half of the sign: angled inward so the fingertips meet at MEET. */
function shrineHand(side, { extended = SHRINE, reach = 2.1, size = SIZE } = {}) {
  const a = (side * Math.PI) / 3; // ±60° off vertical
  const dir = [Math.sin(a), -Math.cos(a)];
  return hand({
    wrist: [MEET[0] - dir[0] * reach * size, MEET[1] - dir[1] * reach * size],
    dir,
    size,
    extended,
    chirality: side,
  });
}

const cases = [
  ["the sign", [shrineHand(1), shrineHand(-1)], true],
  ["the sign, close to camera", [shrineHand(1, { size: 0.12 }), shrineHand(-1, { size: 0.12 })], true],
  ["the sign, far from camera", [shrineHand(1, { size: 0.03 }), shrineHand(-1, { size: 0.03 })], true],
  ["the sign, held sloppily", [shrineHand(1, { reach: 1.9 }), shrineHand(-1, { reach: 1.9 })], true],
  ["no hands", [], false],
  ["one hand only", [shrineHand(1)], false],
  ["both hands open", [shrineHand(1, { extended: OPEN }), shrineHand(-1, { extended: OPEN })], false],
  ["fists", [shrineHand(1, { extended: [] }), shrineHand(-1, { extended: [] })], false],
  [
    "right fingers, hands apart",
    [
      hand({ wrist: [0.35 * ASPECT, 0.7], dir: [0, -1], size: SIZE, extended: SHRINE }),
      hand({ wrist: [0.75 * ASPECT, 0.7], dir: [0, -1], size: SIZE, extended: SHRINE, chirality: -1 }),
    ],
    false,
  ],
  [
    "hands stacked, wrists together",
    [
      hand({ wrist: [0.5 * ASPECT, 0.5], dir: [0.1, -1], size: SIZE, extended: SHRINE }),
      hand({ wrist: [0.5 * ASPECT, 0.5], dir: [-0.1, -1], size: SIZE, extended: SHRINE, chirality: -1 }),
    ],
    false,
  ],
];

let failures = 0;
for (const [name, hands, want] of cases) {
  const { match, checks } = matchMalevolentShrine(hands, ASPECT);
  const ok = match === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(28)} match=${match} want=${want}`);
  if (!ok) for (const c of checks) console.log(`         ${c.pass ? "ok  " : "MISS"} ${c.name}`);
}

// The pose has to survive landmark jitter, since it is held for over a second
// and a dropped frame drains the charge bar.
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
const jitter = (h, amt) => h.map((p) => ({ x: p.x + rnd() * amt, y: p.y + rnd() * amt, z: 0 }));

console.log("\nmatch rate under landmark noise (as % of hand scale):");
for (const pct of [2, 5, 8, 12]) {
  let hits = 0;
  for (let i = 0; i < 400; i++) {
    const amt = (pct / 100) * SIZE;
    const hands = [jitter(shrineHand(1), amt), jitter(shrineHand(-1), amt)];
    if (matchMalevolentShrine(hands, ASPECT).match) hits++;
  }
  const rate = Math.round((hits / 400) * 100);
  // Below ~8% noise the charge bar should fill without stuttering.
  if (pct <= 8 && rate < 95) failures++;
  console.log(`  ${String(pct).padStart(3)}% noise -> ${String(rate).padStart(3)}% match`);
}

// The debug readout has to agree with the matcher. If the panel reported
// numbers that disagreed with the pass/fail beside them, it would send whoever
// is tuning after the wrong finger.
console.log("\ndebug readout agrees with the matcher:");
{
  const good = [shrineHand(1), shrineHand(-1)];
  const hand = describeHand(good[0], ASPECT);
  const pair = describePair(good, ASPECT);
  const check = (name, got, want) => {
    const ok = got === want;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} ${got} (want ${want})`);
  };

  check("index reads as extended", hand.index >= TUNING.extendedRatio, true);
  check("middle reads as extended", hand.middle >= TUNING.extendedRatio, true);
  check("ring reads as curled", hand.ring <= TUNING.curledRatio, true);
  check("pinky reads as curled", hand.pinky <= TUNING.curledRatio, true);
  check("index gap within threshold", pair.indexGap <= TUNING.indexTipsApart, true);
  check("middle gap within threshold", pair.middleGap <= TUNING.middleTipsApart, true);
  check("wrists past threshold", pair.wristGap >= TUNING.wristsApart, true);
  // Every one of those agreeing is the same verdict the matcher reaches.
  check("...which is what the matcher says", matchMalevolentShrine(good, ASPECT).match, true);

  // And a pose that fails should show it in the numbers, not just the verdict.
  const fists = [shrineHand(1, { extended: [] }), shrineHand(-1, { extended: [] })];
  check("a fist reads as not extended", describeHand(fists[0], ASPECT).index >= TUNING.extendedRatio, false);
  check("one hand has no pair to measure", describePair([shrineHand(1)], ASPECT), null);
}

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
