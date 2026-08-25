// Pairing for things that must happen together but never arrive together.
//
// Used twice: for the sign against the incantation, and inside voice.js for the
// two halves of the incantation itself. In both cases the parts land at
// different moments — speech results trail the words, and you might sign before
// speaking or after — so each part is remembered with a timestamp and counts as
// satisfied for a window afterwards. Free of DOM and timers so it can be tested.

export class TriggerPairing {
  #windowMs;
  #keys;
  #at;

  /**
   * @param {number} windowMs   how long each part stays satisfied
   * @param {string[]} keys     names of the parts being paired
   */
  constructor(windowMs, keys = ["sign", "voice"]) {
    this.#windowMs = windowMs;
    this.#keys = keys;
    this.#at = Object.fromEntries(keys.map((k) => [k, -Infinity]));
  }

  /** Record that one half just happened. */
  note(which, now) {
    this.#at[which] = now;
  }

  /** Forget every part — used on activation and reset, so nothing carries over. */
  clear() {
    for (const k of this.#keys) this.#at[k] = -Infinity;
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
   * @param {boolean} requireAll  every part, or any one alone
   */
  ready(now, requireAll) {
    const current = this.#keys.map((k) => this.isCurrent(k, now));
    return requireAll ? current.every(Boolean) : current.some(Boolean);
  }
}
