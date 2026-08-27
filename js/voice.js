// Voice trigger — listens for the incantation.
//
// PRIVACY: Chrome's SpeechRecognition is not on-device. Audio is streamed to
// Google's servers for transcription whenever this is listening. That is why it
// is opt-in via VOICE_ENABLED in main.js rather than simply always on.
//
// Chrome only. Firefox and Safari have no usable implementation, in which case
// `supported` is false and the caller falls back to the gesture alone.
//
// Domain-agnostic on purpose: the naming half of each line lives in domains.js
// and is passed in, so this module and its tests never pull in canvas code.

import { TriggerPairing } from "./trigger.js";

// globalThis rather than window so the phrase matcher can be imported and
// tested outside a browser.
const SpeechRecognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;

// 領域展開 — the opening every domain shares. The naming half that follows is
// what picks out which domain, and both are required.
const OPENING = [
  "領域展開",
  "りょういきてんかい",
  "ryoikitenkai",
  "ryouikitenkai",
  "ryoikitengai",
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
 * Which halves of an incantation appear in one transcript.
 * @param {{id: string, phrases: string[]}[]} domains
 * @returns {{opening: boolean, name: string|null}} name is a domain id
 */
export function halvesIn(transcript, domains) {
  const text = normalise(transcript);
  return {
    opening: OPENING.some((p) => text.includes(p)),
    name: domains.find((d) => d.phrases.some((p) => text.includes(p)))?.id ?? null,
  };
}

/**
 * Which domain a single transcript names outright, opening included.
 * @returns {string|null} domain id
 */
export function matchesIncantation(transcript, domains) {
  const { opening, name } = halvesIn(transcript, domains);
  return opening ? name : null;
}

export class VoiceTrigger {
  #recognition = null;
  #domains;
  #onMatch;
  #running = false;
  #lastFiredAt = 0;
  // One pairing per domain. The halves often arrive in separate results — an
  // interim for the opening, then another as the name firms up — so they are
  // accumulated rather than required in a single transcript.
  #heard;

  /**
   * @param {{id: string, phrases: string[]}[]} domains
   * @param {(domainId: string) => void} onMatch
   * @param {string} lang  recognition language; the lines are Japanese
   */
  constructor(domains, onMatch, lang = "ja-JP") {
    this.#domains = domains;
    this.#onMatch = onMatch;
    this.#heard = new Map(
      domains.map((d) => [d.id, new TriggerPairing(HALF_WINDOW_MS, ["opening", "name"])]),
    );
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
    const { opening, name } = halvesIn(transcript, this.#domains);

    // The opening belongs to whichever domain is named next, so it counts for
    // all of them until one completes.
    if (opening) for (const p of this.#heard.values()) p.note("opening", now);
    if (name) this.#heard.get(name)?.note("name", now);

    for (const [id, pairing] of this.#heard) {
      if (!pairing.ready(now, true)) continue;

      // Interim results repeat the same words as they firm up, so one utterance
      // would otherwise fire several times.
      if (now - this.#lastFiredAt < 2500) return true;
      this.#lastFiredAt = now;
      // Next activation has to hear a whole line again.
      for (const p of this.#heard.values()) p.clear();
      this.#onMatch(id);
      return true;
    }
    return false;
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
    for (const p of this.#heard.values()) p.clear();
    this.#recognition.stop();
  }
}
