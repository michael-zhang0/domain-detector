// Stage 3a — cut the person out of the frame.
//
// Two performance decisions from CLAUDE.md are baked in here:
//   1. Segmentation runs on a downscaled copy of the frame (SEG_HEIGHT), and
//      the small mask gets upscaled during compositing. Mask detail is worth
//      far less than the pixels it costs.
//   2. The caller only runs this while a domain is active. Idle frames pay for
//      hand tracking alone.

import { createSegmenter } from "./mediapipe.js";

const SEG_HEIGHT = 144;

export class PersonSegmenter {
  #segmenter = null;
  #small = document.createElement("canvas");
  #smallCtx = null;
  #mask = document.createElement("canvas");
  #maskCtx = null;
  #imageData = null;
  #lastTs = -1;
  // selfie_segmenter's label ordering is not worth trusting blind, so we infer
  // it: the border of a webcam frame is background nearly all of the time.
  #backgroundLabel = 0;

  async load() {
    this.#segmenter = await createSegmenter();
  }

  #resize(w, h) {
    if (this.#small.width === w && this.#small.height === h) return;
    this.#small.width = this.#mask.width = w;
    this.#small.height = this.#mask.height = h;
    this.#smallCtx = this.#small.getContext("2d", { willReadFrequently: false });
    this.#maskCtx = this.#mask.getContext("2d", { willReadFrequently: false });
    this.#imageData = this.#maskCtx.createImageData(w, h);
    // White throughout; only alpha carries the mask.
    const d = this.#imageData.data;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255;
  }

  #inferBackgroundLabel(labels, w, h) {
    const tally = new Map();
    const bump = (i) => tally.set(labels[i], (tally.get(labels[i]) ?? 0) + 1);
    for (let x = 0; x < w; x++) {
      bump(x);
      bump((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      bump(y * w);
      bump(y * w + w - 1);
    }
    let best = this.#backgroundLabel;
    let bestCount = -1;
    for (const [label, count] of tally) {
      if (count > bestCount) [best, bestCount] = [label, count];
    }
    return best;
  }

  /**
   * @returns {HTMLCanvasElement|null} low-res canvas whose alpha channel is the
   *   person mask, or null if no result was available this frame.
   */
  segment(video, timestampMs) {
    const aspect = (video.videoWidth || 16) / (video.videoHeight || 9);
    const h = SEG_HEIGHT;
    const w = Math.round(h * aspect);
    this.#resize(w, h);

    this.#smallCtx.drawImage(video, 0, 0, w, h);

    const ts = timestampMs <= this.#lastTs ? this.#lastTs + 1 : timestampMs;
    this.#lastTs = ts;

    let labels = null;
    const take = (result) => {
      const m = result?.categoryMask;
      if (!m) return;
      labels = m.getAsUint8Array().slice();
      m.close();
    };
    take(this.#segmenter.segmentForVideo(this.#small, ts, take));
    if (!labels) return null;

    const bg = this.#inferBackgroundLabel(labels, w, h);
    const data = this.#imageData.data;
    let personPixels = 0;
    for (let i = 0; i < labels.length; i++) {
      const isPerson = labels[i] !== bg;
      data[i * 4 + 3] = isPerson ? 255 : 0;
      if (isPerson) personPixels++;
    }

    // A "person" covering almost the whole frame means the border inference
    // picked the wrong label. Keep the previous label and drop this frame
    // rather than flashing an inverted cutout.
    if (personPixels > 0.9 * labels.length) return null;
    this.#backgroundLabel = bg;

    this.#maskCtx.putImageData(this.#imageData, 0, 0);
    return this.#mask;
  }
}
