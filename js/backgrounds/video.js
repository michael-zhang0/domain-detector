// A looping video standing in for the procedural domain art.
//
// Same resize(w, h) / draw(ctx, t, intensity) shape as MalevolentShrine, so
// main.js holds one or the other without caring which.

export class VideoBackground {
  #video = document.createElement("video");
  #w = 0;
  #h = 0;
  #ready = false;

  constructor(src) {
    Object.assign(this.#video, {
      src,
      loop: true,
      muted: true,        // required for autoplay; the cue comes from audio.js
      playsInline: true,
      preload: "auto",
    });
  }

  /** Resolves once the clip can actually be drawn, rejects if it cannot load. */
  load() {
    return new Promise((resolve, reject) => {
      this.#video.addEventListener("error", () => reject(new Error("could not load " + this.#video.src)), { once: true });
      this.#video.addEventListener(
        "canplay",
        () => {
          this.#ready = true;
          resolve(this);
        },
        { once: true },
      );
      this.#video.load();
    });
  }

  resize(w, h) {
    this.#w = w;
    this.#h = h;
  }

  /** Keeps the clip running only while the domain is on screen. */
  setPlaying(playing) {
    if (!this.#ready) return;
    if (playing) this.#video.play().catch(() => {});
    else this.#video.pause();
  }

  draw(ctx, t, intensity = 1) {
    const w = this.#w;
    const h = this.#h;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    if (!this.#ready) return;

    // Cover-fit: fill the frame, crop the overflow, never letterbox.
    const vw = this.#video.videoWidth || w;
    const vh = this.#video.videoHeight || h;
    const scale = Math.max(w / vw, h / vh);
    const dw = vw * scale;
    const dh = vh * scale;

    ctx.save();
    ctx.globalAlpha = intensity;
    ctx.drawImage(this.#video, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
  }
}
