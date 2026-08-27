// Wiring for the four stages, plus the activation state machine.

import { HandTracker } from "./hand-tracking.js";
import { PersonSegmenter } from "./segmentation.js";
import { Compositor } from "./compositor.js";
import { VideoBackground } from "./backgrounds/video.js";
import { VoiceTrigger } from "./voice.js";
import { TriggerPairing } from "./trigger.js";
import { DomainAudio } from "./audio.js";
import { DOMAINS, domainById } from "./domains.js";

// Activation fires the instant a sign is recognised. CONFIRM_FRAMES is not a
// charge-up — it is noise rejection, three frames at ~60fps being about 50ms,
// short enough to feel immediate but long enough that a single bad landmark
// frame cannot open a domain on its own.
const CONFIRM_FRAMES = 3;
const FLASH_MS = 550;

// Once open, the domain stays open. The only way out is the reset button, which
// appears this long after activation so it never covers the payoff.
const RESET_AFTER_MS = 10_000;

// Say the incantation as well as signing it. Set false to switch the microphone
// off entirely: Chrome's speech recognition is not on-device, it streams audio
// to Google's servers while listening.
const VOICE_ENABLED = true;

// Require the sign AND the incantation together. They do not have to land on
// the same frame — speech results arrive a beat behind the words, and you may
// sign first or speak first — so each is remembered for this long and the
// domain opens when both are current. Both must name the same domain.
const REQUIRE_BOTH = true;
const PAIR_WINDOW_MS = 5000;

const el = (id) => document.getElementById(id);

const video = el("cam");
const compositor = new Compositor(el("out"));
const tracker = new HandTracker();
const segmenter = new PersonSegmenter();
const audio = new DomainAudio();

const state = {
  domain: null,          // the open domain, or null
  confirmFor: null,      // which domain the confirm frames are counting toward
  confirmFrames: 0,
  activatedAt: -Infinity,
  fps: 0,
  segEveryNth: 1,
  frame: 0,
  lastMask: null,
  showDebug: false,
};

// Sign and incantation are paired per domain, so signing one and speaking the
// other never opens anything.
const pairings = new Map(DOMAINS.map((d) => [d.id, new TriggerPairing(PAIR_WINDOW_MS)]));

// Created on first use, or pre-seeded at boot with a VideoBackground when the
// domain has an art file. Each background pre-renders on its first resize, so
// there is no reason to build one nobody has opened.
const backgrounds = new Map();

function backgroundFor(domain) {
  if (!backgrounds.has(domain.id)) backgrounds.set(domain.id, domain.createBackground());
  return backgrounds.get(domain.id);
}

const voice = new VoiceTrigger(DOMAINS, (domainId) => {
  const now = performance.now();
  pairings.get(domainId)?.note("voice", now);
  const domain = domainById(domainId);
  if (domain) tryActivate(domain, now);
});

// Requiring both only makes sense if voice can actually happen. With the mic
// off, unsupported, or denied, this would otherwise make every domain
// impossible to open, so it quietly falls back to the sign alone.
const bothRequired = () => REQUIRE_BOTH && VOICE_ENABLED && voice.supported && voice.listening;

// ---- boot ------------------------------------------------------------------

async function boot() {
  const msg = el("boot-msg");
  const start = el("start");

  try {
    msg.textContent = "Loading hand tracking and segmentation models…";
    await Promise.all([tracker.load(), segmenter.load()]);
  } catch (err) {
    msg.textContent = "Could not load the MediaPipe models: " + err.message +
      "\n\nThis needs a network connection the first time — the models come from a CDN.";
    return;
  }

  // Optional assets for every domain, loaded in parallel. None of it failing is
  // an error; each domain falls back to its procedural art and synth cue.
  await Promise.all([
    ...DOMAINS.map((d) =>
      new VideoBackground(d.assets.art)
        .load()
        .then((v) => backgrounds.set(d.id, v))
        .catch(() => {})),
    audio.loadAssets(DOMAINS),
  ]);

  msg.hidden = true;
  start.hidden = false;

  start.addEventListener("click", async () => {
    start.disabled = true;
    // The click is the user gesture the AudioContext needs.
    audio.unlock();
    try {
      await openCamera();
    } catch (err) {
      msg.hidden = false;
      msg.textContent = "Camera unavailable: " + err.message;
      start.disabled = false;
      return;
    }
    // Speech recognition prompts for the microphone on its own.
    if (VOICE_ENABLED && voice.supported) voice.start();
    el("boot").hidden = true;
    requestAnimationFrame(loop);
  });
}

async function openCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  await new Promise((resolve) => {
    if (video.videoWidth) return resolve();
    video.addEventListener("loadedmetadata", resolve, { once: true });
  });
  compositor.resize(video.videoWidth, video.videoHeight);
}

// ---- state machine ---------------------------------------------------------

function updateActivation(domain, now) {
  if (!domain) {
    state.confirmFrames = 0;
    state.confirmFor = null;
    return;
  }
  // Switching poses restarts the count rather than inheriting the other one's.
  if (state.confirmFor !== domain.id) {
    state.confirmFor = domain.id;
    state.confirmFrames = 0;
  }
  state.confirmFrames++;
  // Held signs keep refreshing the timestamp, so speaking after signing works
  // just as well as signing after speaking.
  if (state.confirmFrames >= CONFIRM_FRAMES) {
    pairings.get(domain.id).note("sign", now);
    tryActivate(domain, now);
  }
}

/** Open a domain if everything the current trigger mode asks for is current. */
function tryActivate(domain, now) {
  if (state.domain) return;
  if (pairings.get(domain.id).ready(now, bothRequired())) activateDomain(domain, now);
}

function activateDomain(domain, now) {
  if (state.domain) return; // already inside one; nothing to re-trigger
  state.domain = domain;
  state.confirmFrames = 0;
  state.confirmFor = null;
  state.activatedAt = now;
  for (const p of pairings.values()) p.clear();

  // Only meaningful for a video background — no point decoding frames for a
  // domain nobody is inside.
  backgroundFor(domain).setPlaying?.(true);
  audio.activate(domain);

  // Stop streaming microphone audio the moment it can no longer do anything.
  voice.stop();
}

function reset() {
  if (!state.domain) return;
  backgroundFor(state.domain).setPlaying?.(false);

  state.domain = null;
  state.confirmFrames = 0;
  state.confirmFor = null;
  state.activatedAt = -Infinity;
  // Cleared, or a stale half from before the reset could pair with the next one
  // and reopen a domain immediately.
  for (const p of pairings.values()) p.clear();
  state.lastMask = null;

  audio.stopAll();
  el("reset").hidden = true;

  if (VOICE_ENABLED && voice.supported) voice.start();
}

// ---- loop ------------------------------------------------------------------

let lastFrameAt = 0;

function loop(now) {
  requestAnimationFrame(loop);
  if (video.readyState < 2) return;

  const dtMs = lastFrameAt ? Math.min(now - lastFrameAt, 100) : 16;
  lastFrameAt = now;
  state.fps = state.fps ? state.fps * 0.9 + (1000 / dtMs) * 0.1 : 1000 / dtMs;
  state.frame++;

  compositor.resize(video.videoWidth, video.videoHeight);

  // While a domain is open nothing can re-trigger it, so hand tracking is pure
  // waste — skipping it hands the whole GPU budget to segmentation.
  let landmarks = [];
  let matched = null;
  let results = [];
  if (!state.domain) {
    const aspect = video.videoWidth / video.videoHeight;
    ({ landmarks } = tracker.detect(video, now));
    for (const domain of DOMAINS) {
      const result = domain.match(landmarks, aspect);
      results.push({ domain, ...result });
      // First match wins rather than last, so that if the matchers ever stop
      // being mutually exclusive the behaviour is at least deterministic and
      // follows roster order. The gesture tests assert they cannot both fire.
      if (result.match && !matched) matched = domain;
    }
    updateActivation(matched, now);
  } else if (now - state.activatedAt >= RESET_AFTER_MS && el("reset").hidden) {
    // Guarded: this branch runs every frame, and rewriting `hidden` would be a
    // pointless DOM write 60 times a second.
    el("reset").hidden = false;
  }

  // Segmentation is the expensive half, so it only runs when its output is
  // about to be visible: while a domain is open, and on the frames where a sign
  // is showing, so a mask is already warm the instant it opens.
  const wantsMask = Boolean(state.domain) || Boolean(matched);
  let segmented = false;
  if (wantsMask && state.frame % state.segEveryNth === 0) {
    const mask = segmenter.segment(video, now);
    if (mask) state.lastMask = mask;
    segmented = true;
  }
  // Mitigation ladder from CLAUDE.md, step two: drop segmentation to every
  // other frame before touching mask quality.
  if (wantsMask) state.segEveryNth = state.fps < 24 ? 2 : 1;

  if (state.domain) {
    const flash = Math.max(0, 1 - (now - state.activatedAt) / FLASH_MS);
    compositor.drawDomain(video, state.lastMask, backgroundFor(state.domain), now, flash);
  } else {
    compositor.drawCamera(video);
  }

  updateHud(landmarks.length, results, segmented);
}

// ---- HUD -------------------------------------------------------------------

function updateHud(handCount, results, segmented) {
  if (!state.showDebug) return;
  el("d-fps").textContent = state.fps.toFixed(0);
  el("d-hands").textContent = handCount;
  el("d-seg").textContent = segmented ? "1/" + state.segEveryNth : "off";
  el("d-state").textContent = state.domain ? state.domain.label.toUpperCase() : "idle";

  const now = performance.now();
  el("d-mode").textContent = bothRequired() ? "sign+voice" : "either";

  // Per domain: whether each half of its trigger is currently satisfied.
  el("d-triggers").innerHTML = DOMAINS.map((d) => {
    const p = pairings.get(d.id);
    const half = (k) => (p.isUnset(k) ? "·" : p.isCurrent(k, now) ? "OK" : "old");
    const voiceHalf = voice.supported ? (voice.listening ? half("voice") : "off") : "n/a";
    return `<div class="row"><span>${d.label}</span><b>${half("sign")} / ${voiceHalf}</b></div>`;
  }).join("");

  // Whichever pose is closest to matching is the one worth tuning against.
  const closest = results
    .map((r) => ({ ...r, score: r.checks.filter((c) => c.pass).length }))
    .sort((a, b) => b.score - a.score)[0];
  el("d-checks").innerHTML = closest
    ? `<div class="check-head">${closest.domain.label}</div>` +
      closest.checks
        .map((c) => '<div class="check ' + (c.pass ? "pass" : "fail") +
          '"><span>' + (c.pass ? "✓" : "·") + " " + c.name + "</span></div>")
        .join("")
    : "";
}

el("reset").addEventListener("click", reset);

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "d") {
    state.showDebug = !state.showDebug;
    el("debug").hidden = !state.showDebug;
  } else if (k === "r") {
    // Same as the button, but available before the 10s wait is up.
    reset();
  }
});

boot();
