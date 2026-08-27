// Gojo's Unlimited Void — 無量空処.
//
// Deliberately the opposite of the Shrine in every visual axis: cold instead of
// warm, formless instead of architectural, radial instead of symmetrical about
// a vertical, and unbounded depth instead of a floor and a waterline. Two
// domains that read the same at a glance would make the detector pointless.
//
// The idea being drawn is infinite information arriving at once — a luminous
// mass at the centre, endless motes falling into it, and layers receding past
// any distance the frame can show.
//
// Same resize(w, h) / draw(ctx, t, intensity) shape as every other background.

const CORE = "#eaf4ff";
const GLOW = "#5cc0ff";
const DEEP = "#0a1f52";

export class UnlimitedVoid {
  #w = 0;
  #h = 0;
  #stars = document.createElement("canvas");
  #sky = null;
  #motes = [];
  #rings = [];

  resize(w, h) {
    if (this.#w === w && this.#h === h) return;
    this.#w = w;
    this.#h = h;
    this.#sky = null;
    this.#renderStars();
    this.#motes = Array.from({ length: 150 }, () => this.#spawnMote(Math.random()));
    // Fixed ring geometry, so the swirl is stable frame to frame and only the
    // rotation changes.
    this.#rings = Array.from({ length: 22 }, (_, i) => ({
      r: 0.08 + (i / 22) * 0.46,
      tilt: Math.random() * Math.PI,
      squash: 0.15 + Math.random() * 0.75,
      speed: (0.04 + Math.random() * 0.16) * (Math.random() < 0.5 ? 1 : -1),
      arc: 0.6 + Math.random() * 2.4,
      width: 0.4 + Math.random() * 2.2,
      alpha: 0.06 + Math.random() * 0.2,
    }));
  }

  /** @param {number} life 0 = just spawned at the rim, 1 = reaching the core */
  #spawnMote(life = 0) {
    return {
      angle: Math.random() * Math.PI * 2,
      dist: 0.5 + Math.random() * 0.6, // fraction of the half-diagonal
      life,
      speed: 0.06 + Math.random() * 0.16,
      size: 0.4 + Math.random() * 1.8,
      warm: Math.random() < 0.12, // a few pale gold ones keep it from going flat
    };
  }

  /** Starfield, drawn once — the "infinite information" backdrop. */
  #renderStars() {
    const w = this.#w;
    const h = this.#h;
    this.#stars.width = w;
    this.#stars.height = h;
    const g = this.#stars.getContext("2d");
    g.clearRect(0, 0, w, h);

    for (let i = 0; i < 900; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = Math.random() ** 3 * 1.6 + 0.2;
      const a = 0.15 + Math.random() * 0.65;
      g.fillStyle = `rgba(200, 228, 255, ${a})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }

    // A handful of brighter ones with a cross flare.
    g.strokeStyle = "rgba(220, 240, 255, 0.5)";
    g.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const s = 3 + Math.random() * 7;
      g.beginPath();
      g.moveTo(x - s, y);
      g.lineTo(x + s, y);
      g.moveTo(x, y - s);
      g.lineTo(x, y + s);
      g.stroke();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} t          milliseconds, monotonic
   * @param {number} intensity  0 = barely there, 1 = full domain
   */
  draw(ctx, t, intensity = 1) {
    const w = this.#w;
    const h = this.#h;
    const cx = w / 2;
    const cy = h * 0.32; // above head height, so the composited person is lit from behind
    const unit = Math.min(w, h);
    const breath = 0.5 + 0.5 * Math.sin(t / 1900);

    this.#sky ??= (() => {
      const s = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.6);
      s.addColorStop(0, "#123a7a");
      s.addColorStop(0.35, DEEP);
      s.addColorStop(1, "#01030c");
      return s;
    })();
    ctx.fillStyle = this.#sky;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.#stars, 0, 0);
    ctx.restore();

    this.#drawRings(ctx, t, cx, cy, unit);
    this.#drawMotes(ctx, cx, cy, unit);
    this.#drawCore(ctx, cx, cy, unit, breath, intensity);

    // Cold vignette — pulls the eye to the centre and hides the frame edges.
    const vig = ctx.createRadialGradient(cx, cy, unit * 0.3, cx, cy, unit * 0.95);
    vig.addColorStop(0, "rgba(0, 0, 0, 0)");
    vig.addColorStop(1, "rgba(0, 2, 10, 0.88)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  /** Ellipses at assorted tilts, so the mass reads as volume rather than a disc. */
  #drawRings(ctx, t, cx, cy, unit) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const ring of this.#rings) {
      const r = ring.r * unit;
      const rot = ring.tilt + (t / 1000) * ring.speed;
      const start = rot * 1.7;
      ctx.strokeStyle = `rgba(120, 200, 255, ${ring.alpha})`;
      ctx.lineWidth = ring.width;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * ring.squash, rot, start, start + ring.arc);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Motes falling inward — information arriving faster than it can be read. */
  #drawMotes(ctx, cx, cy, unit) {
    const dt = 1 / 60;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < this.#motes.length; i++) {
      const m = this.#motes[i];
      m.life += m.speed * dt;
      if (m.life >= 1) {
        this.#motes[i] = this.#spawnMote(0);
        continue;
      }
      // Ease in, so they accelerate as they are drawn down.
      const k = m.life * m.life;
      const d = m.dist * (1 - k) * unit;
      const a = m.angle + m.life * 1.1; // spiral rather than fall straight in
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d * 0.72;
      const fade = Math.min(1, (1 - m.life) * 2.4);

      ctx.fillStyle = m.warm
        ? `rgba(255, 226, 180, ${0.7 * fade})`
        : `rgba(190, 232, 255, ${0.8 * fade})`;
      ctx.beginPath();
      ctx.arc(x, y, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  #drawCore(ctx, cx, cy, unit, breath, intensity) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * (0.42 + breath * 0.05));
    halo.addColorStop(0, `rgba(150, 214, 255, ${0.42 * intensity})`);
    halo.addColorStop(0.4, `rgba(60, 130, 230, ${0.2 * intensity})`);
    halo.addColorStop(1, "rgba(10, 30, 90, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, this.#w, this.#h);

    const rCore = unit * (0.085 + breath * 0.012);
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, rCore);
    core.addColorStop(0, CORE);
    core.addColorStop(0.45, GLOW);
    core.addColorStop(1, "rgba(40, 110, 220, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, rCore, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
