// Stage 1 — per-frame hand landmarks.

import { createHandLandmarker } from "./mediapipe.js";

export class HandTracker {
  #landmarker = null;
  #lastTs = -1;

  async load() {
    this.#landmarker = await createHandLandmarker();
  }

  /**
   * @returns {{landmarks: {x:number,y:number,z:number}[][], handedness: string[]}}
   *   Landmarks are normalised 0..1 in the *unmirrored* video frame.
   */
  detect(video, timestampMs) {
    // MediaPipe rejects non-increasing timestamps; rAF can fire twice in one ms.
    const ts = timestampMs <= this.#lastTs ? this.#lastTs + 1 : timestampMs;
    this.#lastTs = ts;

    const res = this.#landmarker.detectForVideo(video, ts);
    return {
      landmarks: res.landmarks ?? [],
      handedness: (res.handedness ?? []).map((h) => h[0]?.categoryName ?? "?"),
    };
  }
}
