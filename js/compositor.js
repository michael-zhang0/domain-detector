// Stage 3c — put the person back on top of the domain.
//
// The mask arrives at 144p from segmentation.js. Upscaling it with smoothing
// plus a small blur is what keeps hair and finger edges from looking like a
// staircase; it is the cheapest fix available and this app has fingers on
// screen constantly.

export class Compositor {
  #canvas;
  #ctx;
  #person = document.createElement("canvas");
  #personCtx;
  // Tracked here rather than read off the canvas: the element may already carry
  // the target size (a previous Compositor, markup attributes), and guarding on
  // that would skip setup entirely.
  #w = -1;
  #h = -1;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d", { alpha: false });
    this.#personCtx = this.#person.getContext("2d");
  }

  get width() { return this.#w; }
  get height() { return this.#h; }

  resize(w, h) {
    if (this.#w === w && this.#h === h) return;
    this.#w = this.#canvas.width = this.#person.width = w;
    this.#h = this.#canvas.height = this.#person.height = h;
  }

  /** Webcam feels wrong unless it is mirrored, so every camera pixel goes through here. */
  #mirrored(ctx, draw) {
    ctx.save();
    ctx.setTransform(-1, 0, 0, 1, this.width, 0);
    draw();
    ctx.restore();
  }

  /** Idle: just the camera. */
  drawCamera(video) {
    this.#mirrored(this.#ctx, () =>
      this.#ctx.drawImage(video, 0, 0, this.width, this.height));
  }

  /**
   * Active: domain behind, person cut out in front.
   * @param {HTMLCanvasElement|null} mask low-res alpha mask, or null to reuse none
   * @param {number} flash 0..1 activation transition
   */
  drawDomain(video, mask, background, t, flash = 0) {
    const ctx = this.#ctx;
    const w = this.width;
    const h = this.height;

    background.resize(w, h);
    background.draw(ctx, t, 1);

    if (mask) this.#buildPerson(video, mask);
    ctx.drawImage(this.#person, 0, 0);

    if (flash > 0) this.#drawFlash(ctx, w, h, flash);
  }

  #buildPerson(video, mask) {
    const ctx = this.#personCtx;
    const w = this.width;
    const h = this.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.#mirrored(ctx, () => ctx.drawImage(video, 0, 0, w, h));

    ctx.globalCompositeOperation = "destination-in";
    ctx.filter = "blur(2px)";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    this.#mirrored(ctx, () => ctx.drawImage(mask, 0, 0, w, h));
    ctx.filter = "none";

    // Grade the cutout toward the domain so it does not read as a sticker.
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(126, 12, 24, 0.2)";
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = "source-over";
  }

  #drawFlash(ctx, w, h, k) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255, 226, 208, " + 0.95 * k * k + ")";
    ctx.fillRect(0, 0, w, h);

    // Shockwave chasing the flash outward.
    const r = h * (0.1 + (1 - k) * 1.5);
    ctx.strokeStyle = "rgba(255, 140, 100, " + 0.8 * k + ")";
    ctx.lineWidth = h * 0.03 * k;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
