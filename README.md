# Domain Detector

Throw Sukuna's hand sign at your webcam and the room behind you becomes the Malevolent Shrine.

Adding more in the future

Side project built with Claude for fun

## Run it

```bash
git clone https://github.com/michael-zhang0/domain-detector.git
```

```bash
cd domain-detector && node serve.mjs
```

Then open <http://localhost:8080> and click **Enable camera**.

Requires Node (any recent version) and Chrome or Edge. There is nothing to install — no build step,
no dependencies, no `npm install`. The MediaPipe models are fetched from a CDN on first load, so the
first run needs a network connection.

Serving matters: `getUserMedia` needs a secure context, and `file://` is not one. Opening
`index.html` by double-clicking will not get you a camera.

A fresh clone runs with an empty `assets/` folder — the shrine is drawn and the audio synthesised at
runtime. Supplying your own files is optional; see [using your own art and audio](#using-your-own-art-and-audio).

## Using it

Opening the domain takes **both** of these together:

- **Throw the sign** — index and middle extended on both hands, fingertips pressed together, wrists
  apart.
- **Say the whole incantation** — 領域展開・伏魔御廚子 (*ryōiki tenkai, fukuma mizushi*). Both
  halves are required; neither counts on its own.

They do not have to land at the same instant. Each is remembered for 5 seconds, so signing then
speaking works as well as speaking then signing, and holding the sign while you say the line is
fine. `PAIR_WINDOW_MS` in [main.js](js/main.js) sets the window; `REQUIRE_BOTH = false` goes back to
either one firing alone.

If the microphone is off, denied, or unsupported, requiring both would make the domain impossible to
open — so in that case it falls back to the sign alone rather than locking you out.

**Once open, the domain stays open.** Signing or speaking again does nothing — the only way out is
the reset button, a circular `↻` that fades in at the bottom of the screen ten seconds after
activation, late enough that it never covers the payoff.

Nothing else is drawn on screen — no titles, no meters.

| Key | |
|---|---|
| `D` | debug panel: fps, hand count, and which gesture conditions are passing |
| `R` | reset immediately, without waiting out the ten seconds |

The debug panel is the tuning tool. Stand in front of the camera, hold the sign, and see which
condition is failing; the thresholds it reports are all in `TUNING` at the top of
[gestures.js](js/gestures.js).

The panel also shows the trigger mode and whether each half is currently satisfied (`OK` / `stale`),
which is the fastest way to see which one is missing when it does not fire.

```bash
node test/gestures.test.mjs; node test/voice.test.mjs; node test/trigger.test.mjs
```

### About the microphone

Voice is on by default. Chrome's `SpeechRecognition` is **not on-device** — while it is listening,
microphone audio is streamed to Google's servers for transcription. Set `VOICE_ENABLED = false` at
the top of [main.js](js/main.js) to switch it off entirely; the gesture still works. Chrome and Edge
only; elsewhere the app silently falls back to gesture-only.

Recognition runs in `ja-JP`. Accepted spellings — kanji, kana, and romaji — are listed as `OPENING`
and `NAME` in [voice.js](js/voice.js) and pinned by `test/voice.test.mjs`.

The two halves rarely arrive in one transcript: an utterance usually produces several results as it
firms up, so each half is remembered for 6 seconds (`HALF_WINDOW_MS`) and the trigger fires when
both are current. Saying them in either order works; saying one and stopping does not.

## How it fits together

Four stages per frame, wired in [main.js](js/main.js):

| Stage | File | Notes |
|---|---|---|
| 1. Hand tracking | [hand-tracking.js](js/hand-tracking.js) | MediaPipe `HandLandmarker`, 21 landmarks/hand, GPU |
| 2. Gesture matching | [gestures.js](js/gestures.js) | Static-pose heuristics, no training, no DOM — so it is testable |
| 3. Segmentation | [segmentation.js](js/segmentation.js) | MediaPipe `ImageSegmenter`, selfie model, run at 144p |
| 3. Compositing | [compositor.js](js/compositor.js) | Mask upscaled and blurred, person graded into the domain |
| 3. Domain art | [backgrounds/malevolent-shrine.js](js/backgrounds/malevolent-shrine.js) | Canvas2D, procedural |
| 4. Payoff | [audio.js](js/audio.js) | Web Audio, synthesised |

### Performance

The two models never both run on a frame. Idle frames pay for hand tracking only; segmentation
starts on the frames where the sign is showing, so a mask is warm the instant the domain opens.
Once it is open, nothing can re-trigger it, so hand tracking stops entirely and segmentation gets
the whole GPU budget. If frame rate still drops below 24, segmentation falls back to every other
frame before mask quality is touched.

### Using your own art and audio

The shrine and its cue are generated at runtime because the project ships with no assets. To use
your own instead, drop files at these paths — each one is picked up independently, and anything
missing falls back to the generated version:

| Path | |
|---|---|
| `assets/malevolent-shrine.mp4` | looping background video, replaces the drawn shrine |
| `assets/malevolent-shrine-cue.mp3` | one-shot hit on activation |
| `assets/malevolent-shrine-bed.mp3` | loops while the domain is open, cut on reset |

Paths are configured in `ASSETS` at the top of [main.js](js/main.js). With no `assets/` directory
the console logs three 404s at boot; that is the probe, not a failure. Video is cover-fitted, so
any aspect ratio works, and it is paused whenever the domain is closed.

Source your own footage and audio — this repo does not include any, and ripping it from a stream
is a copyright problem, not a technical one.

[dev/preview.html](dev/preview.html) drives the compositor and the domain art with a synthetic
figure so the art can be iterated on without a camera. It is not part of the app.
