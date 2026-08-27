// Stage 2 — classify landmarks into a domain, or nothing.
//
// Static-pose heuristics, no training, per CLAUDE.md. Both real signs are
// two-handed sequences; these approximate the final held shape of each:
//
//   Malevolent Shrine — middle + ring extended on both hands and pressed
//   against the other hand's, index + pinky curled, wrists apart so the hands
//   form a steeple.
//
//   Unlimited Void — one raised hand, middle finger crossed over the index,
//   ring and pinky folded away.
//
// The two are separated twice over, which is worth keeping: by hand count (one
// versus two) and by finger pattern (the Shrine raises middle and ring, the
// Void index and middle). Either alone would do; having both means a dropped
// hand or a misread finger cannot make one domain fire as the other.
//
// Every threshold lives in TUNING and every condition reports itself by name,
// so you can watch the debug panel and adjust while standing in front of the
// camera instead of guessing.

export const TUNING = {
  // dist(wrist, tip) / dist(wrist, pip) — how straight a finger has to be.
  extendedRatio: 1.30,
  curledRatio: 1.20,
  // Distances below are multiples of hand scale = dist(wrist, middle MCP).
  // A cleanly held sign measures ~0.5 and ~0.2; these sit well above that on
  // purpose, because nobody presses their fingertips exactly together and tips
  // are the noisiest landmarks MediaPipe reports. Hands held visibly apart
  // still measure past 1.4, so the slack does not cost a rejection.
  middleTipsApart: 1.15,
  ringTipsApart: 1.35,
  wristsApart: 0.80,
  // Void: how far the middle fingertip has to sit past the index on the wrong
  // side of the knuckle line before it counts as crossed rather than merely
  // touching. Uncrossed fingers are negative here; properly crossed run ~0.5.
  crossOver: 0.15,
  // Void: how close to straight up the fingers must point. 0.5 is a 60° cone
  // around vertical — the hand is raised beside the face, not resting.
  pointingUp: 0.5,
};

const WRIST = 0;
// No thumb entry: neither sign constrains it, and a thumb needs its own
// extension threshold (it is shorter and angled), so a half-supported one here
// would be a trap for whoever adds the next domain.
const FINGERS = {
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
  return extensionRatio(lm, finger, aspect) >= TUNING.extendedRatio;
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
 * Unit vector along the knuckle line, index MCP toward pinky MCP.
 *
 * This is the axis fingers are ordered along, and it rotates with the hand, so
 * measuring against it works whichever way the hand is turned or tilted.
 */
function knuckleAxis(lm, aspect) {
  const origin = lm[FINGERS.index.mcp];
  const dx = (lm[FINGERS.pinky.mcp].x - origin.x) * aspect;
  const dy = lm[FINGERS.pinky.mcp].y - origin.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  return { x: dx / len, y: dy / len, origin };
}

/** How far along the knuckle axis a point sits. */
function alongAxis(p, axis, aspect) {
  return (p.x - axis.origin.x) * aspect * axis.x + (p.y - axis.origin.y) * axis.y;
}

/**
 * Raw measurements for one hand, for the debug panel.
 *
 * The thresholds in TUNING were set against synthetic landmarks, which is
 * circular — real hands are the only real evidence. This exposes the numbers
 * live so a pose that will not fire can be diagnosed from what the camera
 * actually sees rather than from a guess.
 */
export function describeHand(lm, aspect) {
  const scale = handScale(lm, aspect);
  const axis = knuckleAxis(lm, aspect);
  const tip = midpoint(lm[FINGERS.index.tip], lm[FINGERS.middle.tip]);
  const reach = dist(lm[WRIST], tip, aspect);
  return {
    index: extensionRatio(lm, "index", aspect),
    middle: extensionRatio(lm, "middle", aspect),
    ring: extensionRatio(lm, "ring", aspect),
    pinky: extensionRatio(lm, "pinky", aspect),
    cross:
      (alongAxis(lm[FINGERS.index.tip], axis, aspect) -
        alongAxis(lm[FINGERS.middle.tip], axis, aspect)) / scale,
    up: reach > 1e-6 ? (lm[WRIST].y - tip.y) / reach : 0,
  };
}

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
    curled(lm, "index", aspect) &&
    extended(lm, "middle", aspect) &&
    extended(lm, "ring", aspect) &&
    curled(lm, "pinky", aspect);

  add("L middle+ring up, index+pinky down", shrineFingers(a));
  add("R middle+ring up, index+pinky down", shrineFingers(b));

  const middleGap = dist(a[FINGERS.middle.tip], b[FINGERS.middle.tip], aspect);
  const ringGap = dist(a[FINGERS.ring.tip], b[FINGERS.ring.tip], aspect);
  add("middle tips together", middleGap <= TUNING.middleTipsApart * scale);
  add("ring tips together", ringGap <= TUNING.ringTipsApart * scale);

  // Fingers meeting while the wrists stay apart is what makes it a shrine roof
  // rather than two hands simply stacked on top of each other.
  const wristGap = dist(a[WRIST], b[WRIST], aspect);
  add("wrists apart (steeple)", wristGap >= TUNING.wristsApart * scale && wristGap > middleGap);

  return { match: checks.every((c) => c.pass), checks };
}

/**
 * Evaluate the Unlimited Void pose — Gojo's 無量空処.
 *
 * One hand raised beside the face, middle finger crossed over the index, ring
 * and pinky folded. The thumb is left unconstrained: it sits wherever it likes
 * in practice and is not needed to tell this from anything else.
 *
 * Crossing is a question of order, not of extension. Along the knuckle line the
 * index sits before the middle; when the fingers cross, their fingertips swap
 * over while the knuckles stay put. Comparing the two orders detects that at
 * any hand rotation, and rejects a peace sign — which has the same two fingers
 * up in the ordinary order.
 *
 * @param {{x:number,y:number}[][]} hands  normalised landmark sets
 * @param {number} aspect                  video width / height
 * @returns {{match: boolean, checks: {name: string, pass: boolean}[]}}
 */
function voidOnHand(lm, aspect) {
  const checks = [];
  const add = (name, pass) => (checks.push({ name, pass }), pass);
  const scale = handScale(lm, aspect);

  add(
    "index+middle up, ring+pinky down",
    extended(lm, "index", aspect) &&
      extended(lm, "middle", aspect) &&
      curled(lm, "ring", aspect) &&
      curled(lm, "pinky", aspect),
  );

  const axis = knuckleAxis(lm, aspect);
  const overlap =
    alongAxis(lm[FINGERS.index.tip], axis, aspect) -
    alongAxis(lm[FINGERS.middle.tip], axis, aspect);
  add("middle crossed over index", overlap >= TUNING.crossOver * scale);

  // Raised, not resting. y grows downward in image space, so an upward hand has
  // its fingertips above the wrist.
  const tip = midpoint(lm[FINGERS.index.tip], lm[FINGERS.middle.tip]);
  const reach = dist(lm[WRIST], tip, aspect);
  const rise = lm[WRIST].y - tip.y;
  add("fingers pointing up", reach > 1e-6 && rise / reach >= TUNING.pointingUp);

  return { match: checks.every((c) => c.pass), checks };
}

export function matchUnlimitedVoid(hands, aspect) {
  if (!hands.length) {
    return { match: false, checks: [{ name: "a hand in frame", pass: false }] };
  }

  // Any hand will do, and the count is deliberately not checked. MediaPipe's
  // hand count flickers between one and two as a second hand drifts in and out
  // of confidence; gating on it made the domain unopenable and made the debug
  // panel appear to switch between domains every few frames.
  //
  // It is safe to drop because the finger patterns already separate the two:
  // the Shrine curls the index, this needs it extended, so a Shrine hand can
  // never satisfy the check below. Keep that true if either sign changes again.
  return hands
    .map((lm) => voidOnHand(lm, aspect))
    .sort((a, b) => b.checks.filter((c) => c.pass).length - a.checks.filter((c) => c.pass).length)[0];
}
