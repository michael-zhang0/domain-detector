// Stage 4 — the payoff.
//
// Synthesised by default, because no audio files ship with the project. Supply
// your own with loadAssets({ cue, bed }) and they take over: `cue` is the
// one-shot hit on activation, `bed` is the loop that sustains underneath while
// the domain is open. Either can be omitted and the synth covers that half.
//
// The synth is texture, not melody — taiko, a choir pad on a held minor chord,
// a brass swell, and the slashes. It is aiming at the *shape* of the moment
// (impact, then dread that sustains), which is what sells the activation.

const MINOR_CHORD = [55, 65.41, 82.41, 110]; // A1, C2, E2, A2
const PULSE_PERIOD = 1.4; // seconds between taiko hits under an open domain

export class DomainAudio {
  #ctx = null;
  #master = null;
  #bus = null;
  #noise = null;
  #bed = null;
  // Every source currently running, so they can all be stopped on reset.
  // Entries remove themselves when they end on their own.
  #voices = new Set();
  // Keyed by domain id. Fetched before the context exists (fetching needs no
  // context, decoding does), then decoded on unlock.
  #encoded = new Map();
  #buffers = new Map();

  /**
   * Fetch optional audio files for every domain. Safe to call before unlock();
   * anything that fails to fetch is simply left to the synthesiser.
   * @param {{id: string, assets: {cue?: string, bed?: string}}[]} domains
   */
  async loadAssets(domains) {
    await Promise.all(
      domains.map(async (domain) => {
        const slots = {};
        await Promise.all(
          ["cue", "bed"].map(async (slot) => {
            const url = domain.assets?.[slot];
            if (!url) return;
            try {
              const res = await fetch(url);
              if (!res.ok) return;
              slots[slot] = await res.arrayBuffer();
            } catch {
              // No file, no problem — the synth path stays in place.
            }
          }),
        );
        if (Object.keys(slots).length) this.#encoded.set(domain.id, slots);
      }),
    );
  }

  /** Must be called from a user gesture — browsers start contexts suspended. */
  unlock() {
    if (this.#ctx) {
      if (this.#ctx.state === "suspended") this.#ctx.resume();
      return;
    }

    const ctx = new (window.AudioContext ?? window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0.72;

    // The layers stack hard on the downbeat, and clipping ruins the low end.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 9;
    comp.attack.value = 0.003;
    comp.release.value = 0.28;

    // Every layer goes through the bus rather than straight to master, so that
    // stopAll() can mute the whole domain in one move — including a supplied
    // cue file, which may be far longer than anything the synth produces.
    const bus = ctx.createGain();
    bus.gain.value = 1;

    bus.connect(master).connect(comp).connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 2);
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.#ctx = ctx;
    this.#master = master;
    this.#bus = bus;
    this.#noise = noise;

    for (const [id, slots] of this.#encoded) {
      for (const [slot, raw] of Object.entries(slots)) {
        ctx.decodeAudioData(raw)
          .then((buf) => {
            if (!this.#buffers.has(id)) this.#buffers.set(id, {});
            this.#buffers.get(id)[slot] = buf;
          })
          .catch(() => {});
      }
    }
    this.#encoded.clear();
  }

  /** True once a supplied file is decoded and in use for that domain's slot. */
  has(domainId, slot) {
    return Boolean(this.#buffers.get(domainId)?.[slot]);
  }

  // ---- layers ------------------------------------------------------------

  /**
   * Start a source and remember it, so reset can stop everything still running.
   * Sources that finish on their own drop out of the set by themselves.
   */
  #spawn(node, at, stopAt) {
    node.start(at);
    if (stopAt !== undefined) node.stop(stopAt);
    this.#voices.add(node);
    node.addEventListener("ended", () => this.#voices.delete(node), { once: true });
    return node;
  }

  #noiseSource(at, stopAt) {
    const src = this.#ctx.createBufferSource();
    src.buffer = this.#noise;
    this.#spawn(src, at, stopAt);
    return src;
  }

  /** Big drum: pitched membrane, stick transient, long body. */
  #taiko(at, level = 1) {
    const ctx = this.#ctx;

    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = "sine";
    body.frequency.setValueAtTime(150, at);
    body.frequency.exponentialRampToValueAtTime(44, at + 0.16);
    bodyGain.gain.setValueAtTime(level, at);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.85);
    body.connect(bodyGain).connect(this.#bus);
    this.#spawn(body, at, at + 0.9);

    // Skin resonance just above the fundamental keeps it from sounding like a
    // pure sine thud.
    const skin = ctx.createOscillator();
    const skinGain = ctx.createGain();
    skin.type = "triangle";
    skin.frequency.setValueAtTime(96, at);
    skin.frequency.exponentialRampToValueAtTime(58, at + 0.25);
    skinGain.gain.setValueAtTime(level * 0.4, at);
    skinGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    skin.connect(skinGain).connect(this.#bus);
    this.#spawn(skin, at, at + 0.55);

    // Stick attack.
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1100;
    const tick = ctx.createGain();
    tick.gain.setValueAtTime(level * 0.5, at);
    tick.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);
    this.#noiseSource(at, at + 0.06).connect(hp).connect(tick).connect(this.#bus);
  }

  #subDrop(at) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(82, at);
    osc.frequency.exponentialRampToValueAtTime(26, at + 1.8);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.8, at + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 2.2);
    osc.connect(gain).connect(this.#bus);
    this.#spawn(osc, at, at + 2.3);
  }

  #slash(at, pan) {
    const ctx = this.#ctx;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(5400, at);
    band.frequency.exponentialRampToValueAtTime(420, at + 0.22);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.45, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    this.#noiseSource(at, at + 0.35).connect(band).connect(gain).connect(panner).connect(this.#bus);
  }

  /** Brass-ish swell: saw stack opening through a filter. */
  #horn(at) {
    const ctx = this.#ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(180, at);
    lp.frequency.exponentialRampToValueAtTime(2600, at + 0.9);
    lp.frequency.exponentialRampToValueAtTime(400, at + 2.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.22, at + 0.5);
    // Linear through the middle: an exponential tail collapses so fast it
    // leaves a hole between the impact and the choir coming up under it.
    gain.gain.linearRampToValueAtTime(0.09, at + 1.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 2.8);

    for (const detune of [-7, 0, 7]) {
      for (const freq of [55, 82.41]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = freq;
        o.detune.value = detune;
        o.connect(lp);
        this.#spawn(o, at, at + 2.7);
      }
    }
    lp.connect(gain).connect(this.#bus);
  }

  /** Choir-ish pad: detuned saws, slow vibrato, held minor chord. */
  #startChoir(at) {
    const ctx = this.#ctx;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 1.0);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 620;
    lp.Q.value = 5;

    // Slow filter drift so a held domain never settles into a flat tone.
    const sweep = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    sweep.frequency.value = 0.07;
    sweepGain.gain.value = 260;
    sweep.connect(sweepGain).connect(lp.frequency);
    this.#spawn(sweep, at);

    // Shared vibrato is what makes the stack read as voices rather than organ.
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vib.frequency.value = 4.6;
    vibGain.gain.value = 3.5;
    this.#spawn(vib, at);
    vib.connect(vibGain);

    const oscs = [];
    for (const freq of MINOR_CHORD) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = freq;
        o.detune.value = detune;
        vibGain.connect(o.detune);
        o.connect(lp);
        this.#spawn(o, at);
        oscs.push(o);
      }
    }

    lp.connect(gain).connect(this.#bus);
    return { gain, oscs: [...oscs, sweep, vib] };
  }

  /**
   * Taiko heartbeat under an open domain. Scheduled with lookahead rather than
   * fired from the timer directly — setInterval is far too jittery to place
   * audio events on.
   */
  #startPulse(from) {
    let next = from + PULSE_PERIOD;
    const tick = () => {
      const horizon = this.#ctx.currentTime + 0.4;
      while (next < horizon) {
        this.#taiko(next, 0.32);
        next += PULSE_PERIOD;
      }
    };
    tick();
    return setInterval(tick, 150);
  }

  // ---- Unlimited Void layers ---------------------------------------------
  //
  // The mirror image of the Shrine's: rising instead of falling, sustained
  // instead of struck, bright instead of low. Opening one domain should never
  // sound like opening the other, even with your eyes shut.

  /** Filtered noise sweeping upward — an intake of breath. */
  #shimmer(at) {
    const ctx = this.#ctx;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 2.2;
    band.frequency.setValueAtTime(320, at);
    band.frequency.exponentialRampToValueAtTime(7200, at + 1.9);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.4, at + 1.5);
    gain.gain.linearRampToValueAtTime(0.0001, at + 2.4);

    this.#noiseSource(at, at + 2.5).connect(band).connect(gain).connect(this.#bus);
  }

  /** Low bloom that opens upward, where the Shrine's sub drops away. */
  #bloom(at) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(32, at);
    osc.frequency.exponentialRampToValueAtTime(65, at + 2.2);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.7, at + 1.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 3.4);
    osc.connect(gain).connect(this.#bus);
    this.#spawn(osc, at, at + 3.5);
  }

  /** Struck bell, inharmonic partials, long tail. */
  #bell(at, freq, level = 0.2) {
    const ctx = this.#ctx;
    // Ratios pulled away from whole numbers so it rings rather than hums.
    for (const [mult, amp, decay] of [[1, 1, 4.2], [2.76, 0.5, 2.6], [5.4, 0.26, 1.5], [8.9, 0.12, 0.9]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(level * amp, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      osc.connect(gain).connect(this.#bus);
      this.#spawn(osc, at, at + decay + 0.1);
    }
  }

  /** Bed: a high shimmering pad over a distant drone, slowly beating. */
  #startVoidBed(at) {
    const ctx = this.#ctx;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.11, at + 2.0);

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 180;

    const oscs = [];
    // Wide, open voicing — fifths and octaves, no third, so it stays cold.
    for (const freq of [220, 330, 440, 660, 880]) {
      for (const detune of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.detune.value = detune; // the beating between the pair is the shimmer
        o.connect(hp);
        this.#spawn(o, at);
        oscs.push(o);
      }
    }

    const drone = ctx.createOscillator();
    const droneGain = ctx.createGain();
    drone.type = "triangle";
    drone.frequency.value = 55;
    droneGain.gain.setValueAtTime(0.0001, at);
    droneGain.gain.exponentialRampToValueAtTime(0.5, at + 2.5);
    drone.connect(droneGain).connect(gain);
    this.#spawn(drone, at);
    oscs.push(drone);

    hp.connect(gain).connect(this.#bus);
    return { gain, oscs };
  }

  #playBuffer(buffer, at, { loop = false } = {}) {
    const ctx = this.#ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(loop ? 0.0001 : 1, at);
    if (loop) gain.gain.exponentialRampToValueAtTime(0.8, at + 1.4);
    src.connect(gain).connect(this.#bus);
    this.#spawn(src, at);
    return { src, gain };
  }

  // ---- public ------------------------------------------------------------

  /**
   * The cue, then the bed that sustains under the open domain.
   * @param {{id: string, audioProfile: string}} domain
   */
  activate(domain) {
    if (!this.#ctx) return;
    const t = this.#ctx.currentTime + 0.02;
    const files = this.#buffers.get(domain.id) ?? {};
    const isVoid = domain.audioProfile === "void";

    if (files.cue) {
      this.#playBuffer(files.cue, t);
    } else if (isVoid) {
      this.#bloom(t);
      this.#shimmer(t);
      this.#bell(t + 1.5, 523.25, 0.22);      // C5
      this.#bell(t + 1.72, 783.99, 0.16);     // G5
      this.#bell(t + 2.0, 1046.5, 0.1);       // C6
    } else {
      this.#taiko(t, 1);
      this.#subDrop(t);
      this.#slash(t + 0.06, -0.6);
      this.#slash(t + 0.18, 0.55);
      this.#slash(t + 0.28, -0.2);
      this.#taiko(t + 0.42, 0.95);
      this.#horn(t + 0.44);
    }

    if (this.#bed) return;
    if (files.bed) {
      const { src, gain } = this.#playBuffer(files.bed, t + 0.4, { loop: true });
      this.#bed = { gain, timer: null, stop: (at) => src.stop(at) };
    } else if (isVoid) {
      // No pulse under the Void — a heartbeat would give it a floor, and the
      // point of it is that there is not one.
      const { gain, oscs } = this.#startVoidBed(t + 0.9);
      this.#bed = { gain, timer: null, stop: (at) => oscs.forEach((o) => o.stop(at)) };
    } else {
      const { gain, oscs } = this.#startChoir(t + 0.42);
      this.#bed = {
        gain,
        timer: this.#startPulse(t + 0.42),
        stop: (at) => oscs.forEach((o) => o.stop(at)),
      };
    }
  }

  /**
   * Stop everything, now — cue included, whether that is the synth or a
   * supplied file that still has minutes left on it.
   *
   * The bus is ramped down over 60ms rather than cut dead, because yanking a
   * gain to zero mid-waveform pops. That is short enough to read as immediate.
   */
  stopAll() {
    if (!this.#ctx) return;
    const t = this.#ctx.currentTime;
    const silentAt = t + 0.06;

    if (this.#bed?.timer) clearInterval(this.#bed.timer);
    this.#bed = null;

    const bus = this.#bus.gain;
    bus.cancelScheduledValues(t);
    bus.setValueAtTime(bus.value, t);
    bus.linearRampToValueAtTime(0, silentAt);

    for (const node of this.#voices) {
      try {
        node.stop(silentAt);
      } catch {
        // Already stopped, or stop() was scheduled earlier — nothing to do.
      }
    }
    this.#voices.clear();

    // Reopen the bus once everything is silent, ready for the next activation.
    bus.setValueAtTime(1, silentAt + 0.02);
  }
}
