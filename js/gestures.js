// Stage 2 — classify landmarks into a domain, or nothing.
//
// Static-pose heuristics, no training, per CLAUDE.md. Both real signs are
// two-handed sequences; these approximate the final held shape of each:
//
//   Malevolent Shrine — index + middle extended on both hands and pressed
//   against the other hand's, ring + pinky curled, wrists apart so the hands
//   form a steeple.
//
//   Unlimited Void — one raised hand, index and middle extended and pressed
//   together pointing up, ring and pinky folded away.
//
// The two must be mutually exclusive or both fire at once, and here that is not
// a matter of degree: the Void's finger pattern is exactly what each individual
// hand in the Shrine's sign is doing. **Hand count is the whole discriminator.**
// The Void needs exactly one hand in frame, the Shrine two. Nothing else
// separates them, so do not relax either bound.
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
  indexTipsApart: 1.15,
  middleTipsApart: 1.35,
  wristsApart: 0.80,
  // Void: index and middle held as one, which is what separates the seal from
  // an ordinary peace sign. Pressed together measures ~0.35, a spread V ~1.0.
  fingersTogether: 0.62,
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
 * One hand raised beside the face, index and middle extended and pressed
 * together pointing up, ring and pinky folded. The thumb is left unconstrained:
 * it is tucked in the source but sits wherever it likes in practice, and it is
 * not needed to tell this from anything else.
 *
 * The single-hand requirement is load-bearing, not incidental. This exact
 * finger pattern is what each hand in the Shrine's sign is doing, so allowing a
 * second hand in frame would make both domains fire on the Shrine's pose.
 *
 * @param {{x:number,y:number}[][]} hands  normalised landmark sets
 * @param {number} aspect                  video width / height
 * @returns {{match: boolean, checks: {name: string, pass: boolean}[]}}
 */
export function matchUnlimitedVoid(hands, aspect) {
  const checks = [];
  const add = (name, pass) => (checks.push({ name, pass }), pass);

  // Exactly one, not "at least one" — see above.
  if (!add("exactly one hand", hands.length === 1)) return { match: false, checks };

  const lm = hands[0];
  const scale = handScale(lm, aspect);

  add(
    "index+middle up, ring+pinky down",
    extended(lm, "index", aspect) &&
      extended(lm, "middle", aspect) &&
      curled(lm, "ring", aspect) &&
      curled(lm, "pinky", aspect),
  );

  // Held as one blade. Splitting them is a peace sign, which is a thing people
  // do at cameras by accident all day.
  const spread = dist(lm[FINGERS.index.tip], lm[FINGERS.middle.tip], aspect);
  add("fingers pressed together", spread <= TUNING.fingersTogether * scale);

  // Raised, not resting. y grows downward in image space, so an upward hand has
  // its fingertips above the wrist.
  const tip = midpoint(lm[FINGERS.index.tip], lm[FINGERS.middle.tip]);
  const reach = dist(lm[WRIST], tip, aspect);
  const rise = lm[WRIST].y - tip.y;
  add("fingers pointing up", reach > 1e-6 && rise / reach >= TUNING.pointingUp);

  return { match: checks.every((c) => c.pass), checks };
}
