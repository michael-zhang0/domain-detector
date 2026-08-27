# Domain Detector

Real-time computer vision toy: detect hand gestures from a webcam, match them against a list of
Jujutsu Kaisen domain expansion hand signs, and when one fires, replace the background with that
domain's animated art and play its audio cue — so it looks like you actually activated the domain.

Status: **two domains working end to end** as of 2026-08-26 — Sukuna's Malevolent Shrine and Gojo's
Unlimited Void, all four stages, pushed to GitHub. See README.md for how to run it and what each
file does. Everything below is still the plan of record; the sections marked *(settled)* record what
building it decided.

Adding a third domain means one entry in `js/domains.js` (pose matcher, naming phrases, background
factory, audio profile, asset paths) plus its matcher and background. `main.js` walks the roster and
knows nothing about any particular domain — keep it that way.

## Pipeline (the whole app in four stages)

1. **Hand tracking** — per-frame hand landmarks from the webcam.
2. **Gesture matching** — classify landmarks into a named domain, or nothing.
3. **Background replacement** — segment the person out, composite animated domain art behind them.
4. **Payoff** — trigger audio + a transition animation on activation.

Stages 1 and 3 are separate models running on the same frame. That matters for performance (see
below).

## Recommended stack (decided, not yet locked)

Browser-based, no build step to start:

- **MediaPipe Tasks JS** — `HandLandmarker` (21 landmarks/hand) or `GestureRecognizer` for stage 1,
  `ImageSegmenter` with the selfie model for stage 3. One runtime covers both, GPU-backed via WebGL.
- **Canvas2D or WebGL** for compositing the mask + background layer.
- **Web Audio API** for the sound cues.

Why browser over Python/OpenCV: segmentation, compositing, shaders, and audio are all first-class
and zero-install; an OpenCV window makes the "cool background" half much more work. Python only wins
if we later want to train a custom sequence model on recorded landmark data.

## Key design decisions from the planning conversation

**Static poses first, sequences later.** A single held hand pose is easy — you can classify it with
plain distance/angle heuristics on the landmarks, no training. But the JJK signs are memorable
partly because they're two-handed *sequences*, so heuristics on a snapshot won't feel "correct" to
anyone who knows the source. Plan: ship 3–4 gestures as single-pose heuristics to get a working
demo fast, then decide whether sequence matching (DTW over a landmark window, or a small LSTM) is
worth the added work. Don't start with the LSTM.

**Video loops before shaders.** Pre-rendered looping video per domain (Gojo's void, Sukuna's
slashed red domain, etc.) validates the pipeline immediately. Generative WebGL shader backgrounds
are the nicer long-term answer — no hunting for or making footage per domain — but only after one
domain works end to end.

**Performance is the real risk.** Hand tracking + selfie segmentation + a compositor in the same
real-time loop is GPU-heavy. Mitigations, in order: run segmentation at a downscaled resolution and
upscale the mask; run the two models on alternating frames; fall back to a cruder chroma-key-style
cutout if frame rate still suffers. Watch mask quality around hair and fingers — that's where cheap
segmentation looks worst, and fingers are on screen constantly in this app.

**Activation is instant, and one-way.** *(settled)* Hold-to-charge was tried and removed — it was
asked for explicitly. The sign fires the moment it is recognised, debounced over 3 frames (~50ms)
purely to reject a single bad landmark frame; that is noise rejection, not a charge. The domain then
*stays* — signing or speaking again does nothing, and the only exit is a reset button that fades in
10s after activation (or `R`). Toggling-off is gone, which also removed the rearm delay it needed.
Constants at the top of `main.js`.

Two things fall out of the domain being one-way, both worth keeping: hand tracking can stop entirely
while it is open, handing the whole GPU budget to segmentation; and speech recognition stops too,
which cuts off the audio stream to Google as soon as it can no longer do anything.

**Both triggers are required together.** *(settled)* The sign *and* the incantation
(領域展開・伏魔御廚子) must both land within 5s of each other, in either order. They cannot be
required on the same frame — speech results arrive a beat behind the words — so each half is
timestamped and counts as satisfied for a window; `js/trigger.js` holds that logic, kept pure and
tested in `test/trigger.test.mjs`.

The important trap: requiring both would make the domain **impossible to open** with the mic off,
denied, or unsupported. `bothRequired()` checks `voice.listening` and silently degrades to
sign-only rather than locking the user out. Do not remove that check.

Voice is Chrome's `SpeechRecognition` only, and it is **not on-device** — audio goes to Google's
servers while listening, so `VOICE_ENABLED` in `main.js` turns it off. The phrase matcher is pure
and exported, tested in `test/voice.test.mjs` — recognition output varies enough (kanji vs kana,
spacing, mishearings) that the accepted forms are worth pinning down.

**Domains must be mutually exclusive, and that is the hard constraint.** *(settled)* The two signs
are separated twice over, and keeping both separations is deliberate:

- **Hand count.** The Void requires `hands.length === 1`, the Shrine `>= 2`.
- **Finger pattern.** The Shrine raises middle + ring; the Void raises index + middle, crossed.

Either alone would suffice; having both means a dropped hand or one misread finger cannot make one
domain fire as the other. A lone Shrine hand currently fails the Void on three separate checks.

The gesture tests assert each pose is *rejected* by the other's matcher, in both directions. A third
domain needs the same treatment: pick a discriminator, then test the rejection, not just the match.

Consequence worth remembering: the Void cannot fire while a second hand is visible. That is inherent
to the hand-count discriminator, not a bug to be fixed.

**Crossing is detected by order, not position.** *(settled)* Along the knuckle line the index sits
before the middle; crossing swaps the *fingertips* while the knuckles stay put, so comparing the two
orderings finds it at any hand rotation. This is also what rejects a peace sign, which has the same
two fingers up in the ordinary order — worth keeping, since it is the single most likely accidental
pose in front of a webcam.

Same for the incantations: `test/voice.test.mjs` checks no phrase belongs to two domains.

**Tune thresholds against measured distributions, not plausibility.** *(settled)* The thumb bar was
set to 1.12 because it looked sensible; measurement showed an extended thumb runs 1.01–1.36 under
noise, so the bar sat inside the range it was meant to accept and silently cost a quarter of the
frames. A folded thumb tops out near 0.82, so 0.95 sits in the empty band. When a pose matches but
only sometimes, measure the per-check failure counts before touching anything.

**The whole line is required, not half of it.** *(settled)* 領域展開 and 伏魔御廚子 are matched as
two separate groups and both must be heard. They almost never land in one transcript — an utterance
produces several results as it firms up — so they are accumulated over a 6s window. `TriggerPairing`
does that job here too, which is why it takes its key names as a constructor argument rather than
hardcoding sign/voice.

**No on-screen text.** *(settled)* The title card and charge meter are gone; the domain art is the
entire feedback channel. The debug panel behind `D` stays — it is a dev tool, not part of the show.

**Segmentation only runs when it will be seen.** *(settled)* Idle frames pay for hand tracking
alone; segmentation starts once the charge bar passes 70%. This turned out to matter more than
either mitigation originally listed, because the app spends most of its time idle.

## Open questions

- Which domains to support next, and where the art/audio comes from. The shrine is procedural
  Canvas2D *only* because no assets exist. Both halves now have working loaders — drop an `.mp4` /
  `.mp3` into `assets/` and it takes over, procedural is the fallback (see README). Note the source
  material is copyrighted, so clips have to be self-made or properly licensed.
- Whether to do true sequence recognition. Still open, and now cheaper to answer:
  `js/gestures.js` has no DOM or MediaPipe imports and is tested against synthetic landmarks in
  `test/gestures.test.mjs`, which is where recorded landmark windows should be replayed.
- How much the single-pose heuristic bothers people who know the source. Unmeasured — nobody has
  used it yet.

## Verified, and not

Checked: both MediaPipe graphs load on the GPU delegate; the compositor produces a correct cutout
over the domain; the gesture matcher accepts the sign at three hand distances, rejects seven
near-miss poses, and holds a 99% match rate under realistic landmark noise.

**Not yet checked with a real webcam and a real person** — frame rate under both models at once,
mask quality around hair and fingers, and whether the sign is comfortable to hold for 1.2s. Those
need a human in front of the camera.

## Environment notes

- Path: `C:\Users\zhang\Documents\Domain Detector`. Deliberately **not** in OneDrive — it was moved
  out to avoid sync locking `node_modules`. Note that Explorer's "Documents" shortcut still points
  at the OneDrive folder, so navigate by full path.
- Windows 11, PowerShell 5.1 primary shell.
- Git repo on `main`, pushed to https://github.com/michael-zhang0/domain-detector.
- `assets/` is gitignored apart from its README. Local art and audio live there and must **stay**
  out of commits — the sourced material is copyrighted, and a media file committed once survives in
  history even after deletion. Check `git diff --cached --name-only` before committing if in doubt.
- Webcam access needs a secure context: `localhost` is fine, `file://` is not. Serve it, don't
  double-click the HTML.
