// Stage 2 — classify landmarks into a domain, or nothing.
//
// Static-pose heuristics, no training, per CLAUDE.md. Both real signs are
// two-handed sequences; these approximate the final held shape of each:
//
//   Malevolent Shrine — index + middle extended on both hands and pressed
//   against the other hand's, ring + pinky curled, wrists apart so the hands
//   form a steeple.
//
//   Unlimited Void — thumbs and index fingers extended and meeting tip to tip,
//   everything else curled, so the hands enclose an aperture.
//
// The two must be mutually exclusive or both fire at once. The middle finger
// does that job: extended for the Shrine, curled for the Void. Nothing else
// separates them reliably, since both are two-handed and fingertip-to-fingertip.
//
// Every threshold lives in TUNING and every condition reports itself by name,
// so you can watch the debug panel and adjust while standing in front of the
// camera instead of guessing.

export const TUNING = {
  // dist(wrist, tip) / dist(wrist, pip) — how straight a finger has to be.
  extendedRatio: 1.30,
  curledRatio: 1.20,
  // The thumb is shorter and sits at an angle, so its ratio never reaches what
  // the fingers manage and it needs its own bar. Measured under 8% landmark
  // noise: an extended thumb runs 1.01–1.36, a folded one 0.54–0.82. This sits
  // in the empty band between, rather than just under the extended range —
  // 1.12 looked reasonable and silently cost a quarter of the frames.
  thumbExtendedRatio: 0.95,
  // Distances below are multiples of hand scale = dist(wrist, middle MCP).
  // A cleanly held sign measures ~0.5 and ~0.2; these sit well above that on
  // purpose, because nobody presses their fingertips exactly together and tips
  // are the noisiest landmarks MediaPipe reports. Hands held visibly apart
  // still measure past 1.4, so the slack does not cost a rejection.
  indexTipsApart: 1.15,
  middleTipsApart: 1.35,
  thumbTipsApart: 1.15,
  wristsApart: 0.80,
  // Thumbs and index tips must sit at different heights, or a pair of hands
  // simply clasped together would read as an aperture.
  apertureOpen: 0.45,
};

const WRIST = 0;
const FINGERS = {
  thumb: { mcp: 2, pip: 3, tip: 4 },
  index: { mcp: 5, pip: 6, tip: 8 },
  middle: { mcp: 9, pip: 10, tip: 12 },
  ring: { mcp: 13, pip: 14, tip: 16 },
  pinky: { mcp: 17, pip: 18, tip: 20 },
};

// Normalised landmarks are 0..1 per axis, so x is squashed on a 16:9 frame.
// Every distance goes through here to get back to isotropic units.
function dist(a, b, aspect) {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function extensionRatio(lm, finger, aspect) {
  const f = FINGERS[finger];
  const toPip = dist(lm[WRIST], lm[f.pip], aspect);
  if (toPip < 1e-6) return 0;
  return dist(lm[WRIST], lm[f.tip], aspect) / toPip;
}

function handScale(lm, aspect) {
  return Math.max(dist(lm[WRIST], lm[FINGERS.middle.mcp], aspect), 1e-6);
}

function extended(lm, finger, aspect) {
  const bar = finger === "thumb" ? TUNING.thumbExtendedRatio : TUNING.extendedRatio;
  return extensionRatio(lm, finger, aspect) >= bar;
}

function curled(lm, finger, aspect) {
  return extensionRatio(lm, finger, aspect) <= TUNING.curledRatio;
}

/** The two hands nearest the camera, largest first. */
function twoHands(hands, aspect) {
  return [...hands]
    .sort((h1, h2) => handScale(h2, aspect) - handScale(h1, aspect))
    .slice(0, 2);
}

const midpoint = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

/**
 * Evaluate the Malevolent Shrine pose.
 *
 * @param {{x:number,y:number}[][]} hands  normalised landmark sets
 * @param {number} aspect                  video width / height
 * @returns {{match: boolean, checks: {name: string, pass: boolean}[]}}
 */
export function matchMalevolentShrine(hands, aspect) {
  const checks = [];
  const add = (name, pass) => (checks.push({ name, pass }), pass);

  if (!add("two hands", hands.length >= 2)) return { match: false, checks };

  const [a, b] = twoHands(hands, aspect);
  const scale = (handScale(a, aspect) + handScale(b, aspect)) / 2;

  const shrineFingers = (lm) =>
    extended(lm, "index", aspect) &&
    extended(lm, "middle", aspect) &&
    curled(lm, "ring", aspect) &&
    curled(lm, "pinky", aspect);

  add("L index+middle up, ring+pinky down", shrineFingers(a));
  add("R index+middle up, ring+pinky down", shrineFingers(b));

  const indexGap = dist(a[FINGERS.index.tip], b[FINGERS.index.tip], aspect);
  const middleGap = dist(a[FINGERS.middle.tip], b[FINGERS.middle.tip], aspect);
  add("index tips together", indexGap <= TUNING.indexTipsApart * scale);
  add("middle tips together", middleGap <= TUNING.middleTipsApart * scale);

  // Fingers meeting while the wrists stay apart is what makes it a shrine roof
  // rather than two hands simply stacked on top of each other.
  const wristGap = dist(a[WRIST], b[WRIST], aspect);
  add("wrists apart (steeple)", wristGap >= TUNING.wristsApart * scale && wristGap > indexGap);

  return { match: checks.every((c) => c.pass), checks };
}

/**
 * Evaluate the Unlimited Void pose — Gojo's 無量空処.
 *
 * Thumbs meeting, index fingertips meeting, everything else folded away, so the
 * two hands enclose an opening. The curled middle finger is what keeps this
 * from colliding with the Shrine.
 *
 * @param {{x:number,y:number}[][]} hands  normalised landmark sets
 * @param {number} aspect                  video width / height
 * @returns {{match: boolean, checks: {name: string, pass: boolean}[]}}
 */
export function matchUnlimitedVoid(hands, aspect) {
  const checks = [];
  const add = (name, pass) => (checks.push({ name, pass }), pass);

  if (!add("two hands", hands.length >= 2)) return { match: false, checks };

  const [a, b] = twoHands(hands, aspect);
  const scale = (handScale(a, aspect) + handScale(b, aspect)) / 2;

  const voidFingers = (lm) =>
    extended(lm, "thumb", aspect) &&
    extended(lm, "index", aspect) &&
    curled(lm, "middle", aspect) &&
    curled(lm, "ring", aspect) &&
    curled(lm, "pinky", aspect);

  add("L thumb+index out, rest folded", voidFingers(a));
  add("R thumb+index out, rest folded", voidFingers(b));

  const thumbGap = dist(a[FINGERS.thumb.tip], b[FINGERS.thumb.tip], aspect);
  const indexGap = dist(a[FINGERS.index.tip], b[FINGERS.index.tip], aspect);
  add("thumb tips together", thumbGap <= TUNING.thumbTipsApart * scale);
  add("index tips together", indexGap <= TUNING.indexTipsApart * scale);

  // Thumbs meet at one corner and index tips at another; if those two meeting
  // points sit on top of each other the hands are just clasped, not framing
  // anything.
  const span = dist(
    midpoint(a[FINGERS.thumb.tip], b[FINGERS.thumb.tip]),
    midpoint(a[FINGERS.index.tip], b[FINGERS.index.tip]),
    aspect,
  );
  add("aperture open", span >= TUNING.apertureOpen * scale);

  return { match: checks.every((c) => c.pass), checks };
}
