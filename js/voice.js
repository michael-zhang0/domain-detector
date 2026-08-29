// Voice trigger — listens for the incantation.
//
// PRIVACY: Chrome's SpeechRecognition is not on-device. Audio is streamed to
// Google's servers for transcription whenever this is listening. That is why it
// is opt-in via VOICE_ENABLED in main.js rather than simply always on.
//
// Chrome only. Firefox and Safari have no usable implementation, in which case
// `supported` is false and the caller falls back to the gesture alone.

// globalThis rather than window so the phrase matcher can be imported and
// tested outside a browser.
const SpeechRecognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;

// 領域展開 on its own is the trigger. Saying the domain's name after it is
// optional — the full line still works, since the opening is in it either way.
//
// Requiring the name as well was tried and dropped: it is the harder half to
// get recognised, and with a single domain it disambiguates nothing. A second
// domain would need it back, because then the name is the only thing saying
// *which* domain to open.
//
// Several spellings per phrase because recognition returns kanji, kana, or
// romaji depending on how it hears you, and mishears predictable syllables.
const OPENING = [
  "領域展開",
  "りょういきてんかい",
  "ryoikitenkai",
  "ryouikitenkai",
  "ryoikitengai",
];

/** Fold katakana to hiragana and drop everything that is not a word character. */
export function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　.,!?、。・「」ー-]/g, "");
}

/** Whether a transcript contains the incantation. Exported for tests. */
export function matchesIncantation(transcript) {
  const text = normalise(transcript);
  return OPENING.some((p) => text.includes(p));
}

export class VoiceTrigger {
  #recognition = null;
  #onMatch;
  #running = false;
  #lastFiredAt = 0;

  /**
   * @param {() => void} onMatch  called when the incantation is heard
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
    if (!matchesIncantation(transcript)) return false;

    // Interim results repeat the same words as they firm up, so one utterance
    // would otherwise fire several times.
    const now = performance.now();
    if (now - this.#lastFiredAt < 2500) return true;
    this.#lastFiredAt = now;
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
    this.#recognition.stop();
  }
}
