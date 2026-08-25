// Voice trigger — listens for the incantation.
//
// PRIVACY: Chrome's SpeechRecognition is not on-device. Audio is streamed to
// Google's servers for transcription whenever this is listening. That is why it
// is opt-in via VOICE_ENABLED in main.js rather than simply always on.
//
// Chrome only. Firefox and Safari have no usable implementation, in which case
// `supported` is false and the caller falls back to the gesture alone.

import { TriggerPairing } from "./trigger.js";

// globalThis rather than window so the phrase matcher can be imported and
// tested outside a browser.
const SpeechRecognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;

// The line is 領域展開・伏魔御廚子, and both halves are required. Each half has
// several accepted spellings because recognition returns kanji, kana, or romaji
// depending on how it hears you, and mishears predictable syllables.
const OPENING = [
  "領域展開",
  "りょういきてんかい",
  "ryoikitenkai",
  "ryouikitenkai",
  "ryoikitengai",
];

const NAME = [
  "伏魔御廚子", // the 廚 and 厨 variants of the last character both appear
  "伏魔御厨子",
  "ふくまみずし",
  "fukumamizushi",
  "fukumamizuchi",
];

// How long one half waits for the other. The full line takes a couple of
// seconds to say and recognition trails it, so this is generous — but it is not
// unbounded, or half a line said a minute ago would still count.
const HALF_WINDOW_MS = 6000;

/** Fold katakana to hiragana and drop everything that is not a word character. */
export function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　.,!?、。・「」ー-]/g, "");
}

/**
 * Which halves of the incantation appear in one transcript.
 * @returns {{opening: boolean, name: boolean}}
 */
export function halvesIn(transcript) {
  const text = normalise(transcript);
  return {
    opening: OPENING.some((p) => text.includes(p)),
    name: NAME.some((p) => text.includes(p)),
  };
}

/** Whether a single transcript contains the whole line. Exported for tests. */
export function matchesIncantation(transcript) {
  const { opening, name } = halvesIn(transcript);
  return opening && name;
}

export class VoiceTrigger {
  #recognition = null;
  #onMatch;
  #running = false;
  #lastFiredAt = 0;
  // The halves often arrive in separate results — an interim for the first
  // words, then another as the rest firms up — so they are accumulated rather
  // than required in one transcript.
  #heard = new TriggerPairing(HALF_WINDOW_MS, ["opening", "name"]);

  /**
   * @param {() => void} onMatch  called when the whole incantation is heard
   * @param {string} lang         recognition language; the line is Japanese
   */
  constructor(onMatch, lang = "ja-JP") {
    this.#onMatch = onMatch;
    if (!SpeechRecognition) return;

    const r = new SpeechRecognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true; // fire on the partial, do not wait for the pause
    r.maxAlternatives = 3;

    r.addEventListener("result", (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        for (const alt of e.results[i]) {
          if (this.#test(alt.transcript)) return;
        }
      }
    });

    // Chrome ends the session on its own every so often; restart it.
    r.addEventListener("end", () => {
      if (this.#running) {
        try {
          r.start();
        } catch {
          // Already restarting — the next end event will retry.
        }
      }
    });

    r.addEventListener("error", (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.#running = false; // mic denied; stop trying
      }
    });

    this.#recognition = r;
  }

  get supported() {
    return Boolean(this.#recognition);
  }

  get listening() {
    return this.#running;
  }

  #test(transcript) {
    const now = performance.now();
    const { opening, name } = halvesIn(transcript);
    if (opening) this.#heard.note("opening", now);
    if (name) this.#heard.note("name", now);

    if (!this.#heard.ready(now, true)) return false;

    // Interim results repeat the same words as they firm up, so one utterance
    // would otherwise fire several times.
    if (now - this.#lastFiredAt < 2500) return true;
    this.#lastFiredAt = now;
    // Next activation has to hear the whole line again.
    this.#heard.clear();
    this.#onMatch();
    return true;
  }

  start() {
    if (!this.#recognition || this.#running) return;
    this.#running = true;
    try {
      this.#recognition.start();
    } catch {
      // Start while already started throws; harmless.
    }
  }

  stop() {
    if (!this.#recognition) return;
    this.#running = false;
    this.#heard.clear();
    this.#recognition.stop();
  }
}
