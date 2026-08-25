// Pairing for the two activation triggers.
//
// The sign and the incantation almost never land on the same frame: speech
// results arrive a beat behind the words, and you might sign first or speak
// first. So each half is remembered with a timestamp and counts as satisfied
// for a window afterwards. Kept free of DOM and timers so it can be tested.

export class TriggerPairing {
  #windowMs;
  #at = { sign: -Infinity, voice: -Infinity };

  constructor(windowMs) {
    this.#windowMs = windowMs;
  }

  /** Record that one half just happened. */
  note(which, now) {
    this.#at[which] = now;
  }

  /** Forget both — used on activation and on reset, so nothing carries over. */
  clear() {
    this.#at.sign = -Infinity;
    this.#at.voice = -Infinity;
  }

  /** @returns {boolean} whether that half happened recently enough to count. */
  isCurrent(which, now) {
    // now - (-Infinity) is Infinity, so an unset half is never current.
    return now - this.#at[which] <= this.#windowMs;
  }

  /** Never fired, versus fired but expired — only used for the debug readout. */
  isUnset(which) {
    return this.#at[which] === -Infinity;
  }

  /**
   * @param {boolean} requireBoth  both halves, or either one alone
   */
  ready(now, requireBoth) {
    const sign = this.isCurrent("sign", now);
    const voice = this.isCurrent("voice", now);
    return requireBoth ? sign && voice : sign || voice;
  }
}
