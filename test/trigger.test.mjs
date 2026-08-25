// Tests for trigger pairing. Run: node test/trigger.test.mjs
//
// The timing here is the part that cannot be checked by hand without a camera
// and a microphone, so it gets pinned down: either order, the window boundary,
// and that nothing carries over across a reset.

import { TriggerPairing } from "../js/trigger.js";

const WINDOW = 5000;
const BOTH = true;
const EITHER = false;

let failures = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${got} (want ${want})`);
}

// --- both required ---------------------------------------------------------

{
  const p = new TriggerPairing(WINDOW);
  check("both: nothing yet", p.ready(0, BOTH), false);
  p.note("sign", 0);
  check("both: sign alone does not fire", p.ready(0, BOTH), false);
  p.note("voice", 800);
  check("both: voice completes the pair", p.ready(800, BOTH), true);
}

{
  // Speaking first, then signing — recognition often lands before the hands do.
  const p = new TriggerPairing(WINDOW);
  p.note("voice", 0);
  check("both: voice alone does not fire", p.ready(0, BOTH), false);
  p.note("sign", 1200);
  check("both: sign completes the pair (reverse order)", p.ready(1200, BOTH), true);
}

{
  const p = new TriggerPairing(WINDOW);
  p.note("voice", 0);
  p.note("sign", 6000); // voice long expired
  check("both: halves too far apart do not pair", p.ready(6000, BOTH), false);
}

{
  const p = new TriggerPairing(WINDOW);
  p.note("voice", 0);
  p.note("sign", WINDOW);
  check("both: exactly at the window edge still pairs", p.ready(WINDOW, BOTH), true);
  const q = new TriggerPairing(WINDOW);
  q.note("voice", 0);
  q.note("sign", WINDOW + 1);
  check("both: one ms past the edge does not", q.ready(WINDOW + 1, BOTH), false);
}

{
  // A held sign keeps refreshing, so a late incantation still pairs.
  const p = new TriggerPairing(WINDOW);
  for (let t = 0; t <= 8000; t += 100) p.note("sign", t);
  p.note("voice", 8000);
  check("both: held sign pairs with a late incantation", p.ready(8000, BOTH), true);
}

// --- either (the fallback when voice is unavailable) ------------------------

{
  const p = new TriggerPairing(WINDOW);
  p.note("sign", 0);
  check("either: sign alone fires", p.ready(0, EITHER), true);
  const q = new TriggerPairing(WINDOW);
  q.note("voice", 0);
  check("either: voice alone fires", q.ready(0, EITHER), true);
  check("either: nothing fires nothing", new TriggerPairing(WINDOW).ready(0, EITHER), false);
}

// --- clearing --------------------------------------------------------------

{
  const p = new TriggerPairing(WINDOW);
  p.note("sign", 0);
  p.note("voice", 0);
  p.clear();
  check("clear: pair is forgotten", p.ready(0, BOTH), false);
  // The reset case: a leftover half must not pair with the next one.
  p.note("sign", 100);
  check("clear: leftover half cannot reopen the domain", p.ready(100, BOTH), false);
}

{
  const p = new TriggerPairing(WINDOW);
  check("unset reads as unset", p.isUnset("sign"), true);
  p.note("sign", 0);
  check("noted reads as set", p.isUnset("sign"), false);
  check("noted but expired is not current", p.isCurrent("sign", 9999), false);
}

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
