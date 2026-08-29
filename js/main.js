// Wiring for the four stages, plus the activation state machine.

import { HandTracker } from "./hand-tracking.js";
import { matchMalevolentShrine, describeHand, describePair, TUNING } from "./gestures.js";
import { PersonSegmenter } from "./segmentation.js";
import { Compositor } from "./compositor.js";
import { MalevolentShrine } from "./backgrounds/malevolent-shrine.js";
import { VideoBackground } from "./backgrounds/video.js";
import { VoiceTrigger } from "./voice.js";
import { TriggerPairing } from "./trigger.js";
import { DomainAudio } from "./audio.js";

// Optional. Drop your own files at these paths and they replace the generated
// art and audio; if a file is absent the procedural version is used instead,
// so nothing here needs to exist for the app to run.
const ASSETS = {
  art: "assets/malevolent-shrine.mp4",
  cue: "assets/malevolent-shrine-cue.mp3",   // one-shot, on activation
  bed: "assets/malevolent-shrine-bed.mp3",   // loops while the domain is open
};

// Activation fires the instant the sign is recognised. CONFIRM_FRAMES is not a
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
// domain opens when both are current.
const REQUIRE_BOTH = true;
const PAIR_WINDOW_MS = 5000;

const el = (id) => document.getElementById(id);

const video = el("cam");
const compositor = new Compositor(el("out"));
const tracker = new HandTracker();
const segmenter = new PersonSegmenter();
const audio = new DomainAudio();

// Swapped for a VideoBackground during boot if the art file is there.
let background = new MalevolentShrine();

const state = {
  active: false,
  confirmFrames: 0,
  activatedAt: -Infinity,
  fps: 0,
  segEveryNth: 1,
  frame: 0,
  lastMask: null,
  showDebug: false,
};

const pairing = new TriggerPairing(PAIR_WINDOW_MS);

const voice = new VoiceTrigger(() => {
  const now = performance.now();
  pairing.note("voice", now);
  tryActivate(now);
});

// Requiring both only makes sense if voice can actually happen. With the mic
// off, unsupported, or denied, this would otherwise make the domain impossible
// to open at all, so it quietly falls back to the sign alone.
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

  // Optional assets, loaded in parallel. Neither failing is an error.
  await Promise.all([
    new VideoBackground(ASSETS.art)
      .load()
      .then((v) => (background = v))
      .catch(() => {}),
    audio.loadAssets({ cue: ASSETS.cue, bed: ASSETS.bed }),
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

function updateActivation(matched, now) {
  if (!matched) {
    state.confirmFrames = 0;
    return;
  }
  state.confirmFrames++;
  // Held signs keep refreshing the timestamp, so speaking after signing works
  // just as well as signing after speaking.
  if (state.confirmFrames >= CONFIRM_FRAMES) {
    pairing.note("sign", now);
    tryActivate(now);
  }
}

/** Open the domain if everything the current trigger mode asks for is current. */
function tryActivate(now) {
  if (state.active) return;
  if (pairing.ready(now, bothRequired())) activateDomain(now);
}

function activateDomain(now) {
  if (state.active) return; // already inside; nothing to re-trigger
  state.active = true;
  state.confirmFrames = 0;
  state.activatedAt = now;
  pairing.clear();

  // Only meaningful for a video background — no point decoding frames for a
  // domain nobody is inside.
  background.setPlaying?.(true);
  audio.activate();

  // Stop streaming microphone audio the moment it can no longer do anything.
  voice.stop();
}

function reset() {
  if (!state.active) return;
  state.active = false;
  state.confirmFrames = 0;
  state.activatedAt = -Infinity;
  // Cleared, or a stale half from before the reset could pair with the next one
  // and reopen the domain immediately.
  pairing.clear();
  state.lastMask = null;

  background.setPlaying?.(false);
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

  // While the domain is open nothing can re-trigger it, so hand tracking is
  // pure waste — skipping it hands the whole GPU budget to segmentation.
  let landmarks = [];
  let match = false;
  let checks = [];
  if (!state.active) {
    const aspect = video.videoWidth / video.videoHeight;
    ({ landmarks } = tracker.detect(video, now));
    ({ match, checks } = matchMalevolentShrine(landmarks, aspect));
    updateActivation(match, now);
  } else if (now - state.activatedAt >= RESET_AFTER_MS && el("reset").hidden) {
    // Guarded: this branch runs every frame, and rewriting `hidden` would be a
    // pointless DOM write 60 times a second.
    el("reset").hidden = false;
  }

  // Segmentation is the expensive half, so it only runs when its output is
  // about to be visible: while the domain is open, and on the frames where the
  // sign is showing, so a mask is already warm the instant it opens.
  const wantsMask = state.active || match;
  let segmented = false;
  if (wantsMask && state.frame % state.segEveryNth === 0) {
    const mask = segmenter.segment(video, now);
    if (mask) state.lastMask = mask;
    segmented = true;
  }
  // Mitigation ladder from CLAUDE.md, step two: drop segmentation to every
  // other frame before touching mask quality.
  if (wantsMask) state.segEveryNth = state.fps < 24 ? 2 : 1;

  const flash = Math.max(0, 1 - (now - state.activatedAt) / FLASH_MS);

  if (state.active) {
    compositor.drawDomain(video, state.lastMask, background, now, flash);
  } else {
    compositor.drawCamera(video);
  }

  updateHud(landmarks, checks, segmented);
}

// ---- HUD -------------------------------------------------------------------

function updateHud(landmarks, checks, segmented) {
  if (!state.showDebug) return;
  el("d-fps").textContent = state.fps.toFixed(0);
  el("d-hands").textContent = landmarks.length;
  el("d-state").textContent = state.active ? "ACTIVE" : "idle";

  // With two conditions to line up, knowing which half is missing is the whole
  // point of the panel.
  const now = performance.now();
  const age = (which) =>
    pairing.isUnset(which) ? "–" : pairing.isCurrent(which, now) ? "OK" : "stale";
  el("d-mode").textContent = bothRequired() ? "sign+voice" : "either";
  el("d-sign").textContent = age("sign");
  el("d-voice").textContent = voice.supported
    ? voice.listening ? age("voice") : "off"
    : "n/a";
  el("d-seg").textContent = segmented ? "1/" + state.segEveryNth : "off";
  el("d-checks").innerHTML = checks
    .map((c) => '<div class="check ' + (c.pass ? "pass" : "fail") +
      '"><span>' + (c.pass ? "✓" : "·") + " " + c.name + "</span></div>")
    .join("");

  el("d-raw").innerHTML = renderMeasurements(landmarks);
}

/**
 * What the camera is actually measuring, against what each check wants.
 *
 * Pass/fail alone cannot tell you whether a finger is marginally short of the
 * bar or nowhere near it, and the thresholds were only ever calibrated against
 * synthetic landmarks. These are the numbers to read out when a sign will not
 * fire.
 */
function renderMeasurements(landmarks) {
  if (!landmarks.length) return '<div class="legend">no hand</div>';

  const aspect = video.videoWidth / video.videoHeight;
  const row = (name, value, ok, want) =>
    `<div class="check ${ok ? "pass" : "fail"}">` +
    `<span>${name} ${value.toFixed(2)}</span><b>${want}</b></div>`;

  // The hand nearest the camera, which is the one the matcher weighs first.
  const hand = describeHand(landmarks[0], aspect);
  const up = TUNING.extendedRatio;
  const down = TUNING.curledRatio;
  let html =
    row("index", hand.index, hand.index >= up, "up ≥" + up) +
    row("middle", hand.middle, hand.middle >= up, "up ≥" + up) +
    row("ring", hand.ring, hand.ring <= down, "down ≤" + down) +
    row("pinky", hand.pinky, hand.pinky <= down, "down ≤" + down);

  const pair = describePair(landmarks, aspect);
  if (pair) {
    html +=
      row("idx gap", pair.indexGap, pair.indexGap <= TUNING.indexTipsApart, "≤" + TUNING.indexTipsApart) +
      row("mid gap", pair.middleGap, pair.middleGap <= TUNING.middleTipsApart, "≤" + TUNING.middleTipsApart) +
      row("wrists", pair.wristGap, pair.wristGap >= TUNING.wristsApart, "≥" + TUNING.wristsApart);
  } else {
    html += '<div class="legend">second hand needed for gaps</div>';
  }
  return html;
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
