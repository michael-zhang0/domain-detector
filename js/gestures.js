// Stage 2 — classify landmarks into a domain, or nothing.
//
// One domain so far: Sukuna's Malevolent Shrine (伏魔御廚子). Static-pose
// heuristics, no training, per CLAUDE.md. The real sign is a two-handed
// sequence; this approximates its final held shape:
//
//   both hands, index + middle extended and pressed against the other hand's,
//   ring + pinky curled away, wrists apart so the hands form a steeple.
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
};

const WRIST = 0;
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

  // With more than two hands in frame, take the two largest — closest to camera.
  const [a, b] = [...hands]
    .sort((h1, h2) => handScale(h2, aspect) - handScale(h1, aspect))
    .slice(0, 2);

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
