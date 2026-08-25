// Stage 3b — the domain itself.
//
// Composition follows the shrine as it appears on screen: a two-tiered pagoda
// crowned with crescents, red pillars framing a toothed mouth, standing over
// still water that mirrors it, inside a cylindrical chamber of teal-lit stone,
// under a red boiling sky.
//
// Everything static is pre-rendered into #scene once per resize. The per-frame
// cost is then a few gradients, the rippled mirror, and the particles — which
// matters, because this runs alongside two neural nets.
//
// To use real footage instead, see VideoBackground in ./video.js: same
// resize(w, h) / draw(ctx, t, intensity) shape, so main.js does not care which
// one it is holding.

const CRESCENT = "#141a33";
const LACQUER = "#8f1f1c";
const GOLD = "#c8a24a";
const STONE = "#0b1418";
const WATERLINE = 0.6;

export class MalevolentShrine {
  #w = 0;
  #h = 0;
  #scene = document.createElement("canvas"); // walls + shrine, above the waterline
  #clouds = document.createElement("canvas");
  #sky = null;
  #embers = [];
  #slashes = [];
  #nextSlashAt = 0;

  resize(w, h) {
    if (this.#w === w && this.#h === h) return;
    this.#w = w;
    this.#h = h;
    this.#scene.width = w;
    this.#scene.height = h;
    this.#renderClouds();
    this.#renderScene();
    this.#sky = null;
    this.#embers = Array.from({ length: 70 }, () => this.#spawnEmber(Math.random() * h * WATERLINE));
  }

  #spawnEmber(y = this.#h * WATERLINE) {
    return {
      x: Math.random() * this.#w,
      y,
      r: 0.6 + Math.random() * 2.0,
      vy: 10 + Math.random() * 38,
      drift: (Math.random() - 0.5) * 16,
      phase: Math.random() * Math.PI * 2,
      warm: Math.random() < 0.4,
    };
  }

  // ---- pre-rendered layers -----------------------------------------------

  /** Billowing cloud texture, scrolled and tinted at draw time. */
  #renderClouds() {
    const size = 512;
    this.#clouds.width = this.#clouds.height = size;
    const g = this.#clouds.getContext("2d");
    g.clearRect(0, 0, size, size);
    g.globalCompositeOperation = "lighter";
    // Stacked soft blobs read as billows far more cheaply than real noise.
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = size * (0.04 + Math.random() * 0.16);
      const blob = g.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.18 + Math.random() * 0.3;
      blob.addColorStop(0, "rgba(255, 84, 54, " + a + ")");
      blob.addColorStop(0.55, "rgba(190, 30, 24, " + a * 0.5 + ")");
      blob.addColorStop(1, "rgba(255, 70, 50, 0)");
      g.fillStyle = blob;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  #renderScene() {
    const w = this.#w;
    const h = this.#h;
    const g = this.#scene.getContext("2d");
    g.clearRect(0, 0, w, h);
    this.#drawWalls(g, w, h);
    this.#drawShrine(g, w, h);
  }

  /** The chamber: teal-lit stone slabs curving away on both sides. */
  #drawWalls(g, w, h) {
    const wl = h * WATERLINE;
    const top = h * 0.18;

    g.fillStyle = STONE;
    g.fillRect(0, top, w, wl - top);

    // Slabs, narrowing toward the centre so the wall reads as curved.
    const cx = w / 2;
    for (let i = -9; i <= 9; i++) {
      const t = i / 9;
      const x = cx + Math.sign(t) * (t * t) * w * 0.55;
      const lit = 1 - Math.abs(t) * 0.55;
      const slab = g.createLinearGradient(0, top, 0, wl);
      slab.addColorStop(0, "rgba(18, 46, 52, " + 0.25 * lit + ")");
      slab.addColorStop(0.55, "rgba(38, 128, 134, " + 0.5 * lit + ")");
      slab.addColorStop(1, "rgba(96, 220, 216, " + 0.72 * lit + ")");
      g.fillStyle = slab;
      g.fillRect(x - w * 0.026, top, w * 0.052, wl - top);

      g.strokeStyle = "rgba(4, 10, 12, 0.75)";
      g.lineWidth = Math.max(1, w * 0.0016);
      g.beginPath();
      g.moveTo(x + w * 0.026, top);
      g.lineTo(x + w * 0.026, wl);
      g.stroke();
    }

    // Horizontal courses.
    g.strokeStyle = "rgba(4, 12, 14, 0.55)";
    for (let y = top; y < wl; y += h * 0.075) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }

    // Glow rising off the water.
    const rise = g.createLinearGradient(0, wl, 0, top);
    rise.addColorStop(0, "rgba(120, 240, 232, 0.34)");
    rise.addColorStop(1, "rgba(120, 240, 232, 0)");
    g.fillStyle = rise;
    g.fillRect(0, top, w, wl - top);

    // Feather the top edge away, or the chamber ends in a hard line ruled
    // straight across the sky.
    const fade = h * 0.22;
    const mask = g.createLinearGradient(0, top, 0, top + fade);
    mask.addColorStop(0, "rgba(0, 0, 0, 1)");
    mask.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = mask;
    g.fillRect(0, top, w, fade);
    g.restore();
  }

  // ---- the shrine ---------------------------------------------------------

  #drawShrine(g, w, h) {
    const cx = w / 2;
    const hw = w * 0.17;           // half-width of the shrine body
    const baseY = h * WATERLINE;
    const bodyTop = h * 0.29;

    // Platform the whole thing stands on.
    g.fillStyle = "#0d0a0d";
    g.fillRect(cx - hw * 1.32, baseY - h * 0.045, hw * 2.64, h * 0.045);
    g.fillStyle = GOLD;
    g.globalAlpha = 0.55;
    g.fillRect(cx - hw * 1.32, baseY - h * 0.048, hw * 2.64, h * 0.005);
    g.globalAlpha = 1;

    // Dark interior the pillars and teeth sit against.
    g.fillStyle = "#080609";
    g.fillRect(cx - hw, bodyTop, hw * 2, baseY - bodyTop - h * 0.04);

    // Toothed mouths flank the centre. The middle is left as a dark arch —
    // that is where the live person ends up standing, so it stays readable
    // rather than glowing.
    this.#drawMouth(g, cx - hw * 0.72, h * 0.44, hw * 0.24, h * 0.075);
    this.#drawMouth(g, cx + hw * 0.72, h * 0.44, hw * 0.24, h * 0.075);
    this.#drawArch(g, cx, bodyTop + h * 0.03, hw * 0.34, baseY - h * 0.04);

    this.#drawPillars(g, cx, hw, bodyTop, baseY - h * 0.04, h);
    this.#drawFrieze(g, cx, hw * 1.16, bodyTop, h * 0.028);

    // Lower roof, then upper roof, then the crown.
    this.#drawRoof(g, cx, bodyTop, hw * 1.55, h * 0.075);
    this.#drawFrieze(g, cx, hw * 0.95, h * 0.2, h * 0.022);
    this.#drawRoof(g, cx, h * 0.2, hw * 1.2, h * 0.065);
    this.#drawCrown(g, cx, h * 0.135, hw * 1.05, h * 0.055);
  }

  /** Concave pagoda roof with flicked-up eaves. */
  #drawRoof(g, cx, y, hw, hgt) {
    const path = new Path2D();
    path.moveTo(cx - hw, y - hgt * 0.18);
    path.bezierCurveTo(cx - hw * 0.62, y - hgt * 0.1, cx - hw * 0.34, y - hgt * 0.62, cx, y - hgt);
    path.bezierCurveTo(cx + hw * 0.34, y - hgt * 0.62, cx + hw * 0.62, y - hgt * 0.1, cx + hw, y - hgt * 0.18);
    path.lineTo(cx + hw * 0.88, y + hgt * 0.2);
    path.bezierCurveTo(cx + hw * 0.4, y + hgt * 0.02, cx - hw * 0.4, y + hgt * 0.02, cx - hw * 0.88, y + hgt * 0.2);
    path.closePath();

    g.fillStyle = "#16241f";
    g.fill(path);

    // Tiles are clipped to the roof, otherwise the strokes shoot off past the
    // eaves as loose diagonal lines.
    g.save();
    g.clip(path);
    g.strokeStyle = "rgba(30, 52, 44, 0.9)";
    g.lineWidth = Math.max(1, this.#w * 0.0016);
    for (let i = -9; i <= 9; i++) {
      const x = cx + (i / 9) * hw * 0.98;
      g.beginPath();
      g.moveTo(x, y - hgt * 1.2);
      g.lineTo(x, y + hgt * 0.4);
      g.stroke();
    }
    g.restore();

    g.strokeStyle = "rgba(190, 150, 70, 0.7)";
    g.lineWidth = Math.max(1, this.#w * 0.0016);
    g.stroke(path);

    // Eave tips flick upward.
    g.fillStyle = "#16241f";
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + dir * hw * 0.99, y - hgt * 0.16);
      g.quadraticCurveTo(cx + dir * hw * 1.09, y - hgt * 0.46, cx + dir * hw * 1.14, y - hgt * 0.66);
      g.lineTo(cx + dir * hw * 1.05, y - hgt * 0.12);
      g.quadraticCurveTo(cx + dir * hw * 1.02, y + hgt * 0.04, cx + dir * hw * 0.9, y + hgt * 0.12);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }

  /**
   * The fan of crescents standing above the top roof.
   *
   * Punched out on a scratch canvas rather than filled even-odd: arc() chains a
   * connecting line from the previous subpath, which makes a two-arc path fill
   * as a ring instead of a lune.
   */
  #drawCrown(g, cx, y, hw, size) {
    for (let i = -2; i <= 2; i++) {
      const t = i / 2;
      const dir = t === 0 ? 1 : Math.sign(t);
      const r = size * (1 - Math.abs(t) * 0.24);
      const x = cx + t * hw * 0.74;
      const cy = y - size * 0.3 + Math.abs(t) * size * 0.55;

      const pad = Math.ceil(r * 1.3);
      const tile = document.createElement("canvas");
      tile.width = tile.height = pad * 2;
      const c = tile.getContext("2d");

      c.fillStyle = CRESCENT;
      c.beginPath();
      c.arc(pad, pad, r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "rgba(120, 160, 225, 0.55)";
      c.lineWidth = Math.max(1, this.#w * 0.002);
      c.stroke();

      // Bite taken from below, tilted outward, so the horns point up and away.
      c.globalCompositeOperation = "destination-out";
      c.beginPath();
      c.arc(pad + dir * r * 0.3, pad + r * 0.62, r * 0.95, 0, Math.PI * 2);
      c.fill();

      g.drawImage(tile, x - pad, cy - pad);
    }
  }

  /** The central recess. Deliberately dark — the live person stands in it. */
  #drawArch(g, cx, top, hw, bottom) {
    g.save();
    g.beginPath();
    g.moveTo(cx - hw, bottom);
    g.lineTo(cx - hw, top + hw * 0.55);
    g.quadraticCurveTo(cx, top - hw * 0.35, cx + hw, top + hw * 0.55);
    g.lineTo(cx + hw, bottom);
    g.closePath();

    g.fillStyle = "#040305";
    g.fill();

    // Only a rim of heat, so a person composited here still reads.
    g.clip();
    const rim = g.createRadialGradient(cx, bottom, 0, cx, bottom, hw * 2.1);
    rim.addColorStop(0, "rgba(255, 110, 40, 0.3)");
    rim.addColorStop(0.5, "rgba(150, 30, 12, 0.14)");
    rim.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = rim;
    g.fillRect(cx - hw, top - hw, hw * 2, bottom - top + hw * 2);

    // Fangs along the top of the recess.
    g.fillStyle = "#d9cdb8";
    for (let i = 0; i < 9; i++) {
      const x = cx - hw + ((i + 0.5) / 9) * hw * 2;
      const dip = top + hw * 0.5 - Math.cos(((i + 0.5) / 9 - 0.5) * Math.PI) * hw * 0.72;
      const len = hw * (0.3 - Math.abs(i - 4) * 0.028);
      g.beginPath();
      g.moveTo(x - hw * 0.1, dip);
      g.lineTo(x, dip + len);
      g.lineTo(x + hw * 0.1, dip);
      g.closePath();
      g.fill();
    }
    g.restore();

    g.strokeStyle = "rgba(200, 162, 74, 0.6)";
    g.lineWidth = Math.max(1, this.#w * 0.0018);
    g.beginPath();
    g.moveTo(cx - hw, bottom);
    g.lineTo(cx - hw, top + hw * 0.55);
    g.quadraticCurveTo(cx, top - hw * 0.35, cx + hw, top + hw * 0.55);
    g.lineTo(cx + hw, bottom);
    g.stroke();
  }

  #drawFrieze(g, cx, hw, y, hgt) {
    g.fillStyle = "#2a1410";
    g.fillRect(cx - hw, y, hw * 2, hgt);
    g.fillStyle = GOLD;
    const n = 26;
    for (let i = 0; i < n; i++) {
      const x = cx - hw + ((i + 0.5) / n) * hw * 2;
      g.globalAlpha = 0.8;
      g.fillRect(x - hw * 0.012, y + hgt * 0.2, hw * 0.024, hgt * 0.6);
      g.globalAlpha = 1;
    }
    g.fillStyle = "rgba(200, 162, 74, 0.5)";
    g.fillRect(cx - hw, y, hw * 2, hgt * 0.13);
    g.fillRect(cx - hw, y + hgt * 0.87, hw * 2, hgt * 0.13);
  }

  #drawPillars(g, cx, hw, top, bottom, h) {
    const pw = hw * 0.075;
    // Inner pair frames the arch, outer pair brackets the toothed mouths.
    for (const k of [-0.98, -0.48, 0.48, 0.98]) {
      const x = cx + k * hw;
      const grad = g.createLinearGradient(x - pw, 0, x + pw, 0);
      grad.addColorStop(0, "#5d100f");
      grad.addColorStop(0.4, LACQUER);
      grad.addColorStop(1, "#3c0a0a");
      g.fillStyle = grad;
      g.fillRect(x - pw, top, pw * 2, bottom - top);
      g.strokeStyle = "rgba(20, 4, 4, 0.9)";
      g.lineWidth = Math.max(1, this.#w * 0.0012);
      g.strokeRect(x - pw, top, pw * 2, bottom - top);
    }
    // Cross beam, torii-style.
    g.fillStyle = LACQUER;
    g.fillRect(cx - hw * 1.05, top + h * 0.035, hw * 2.1, h * 0.014);
  }

  /** A dark opening ringed with teeth. */
  #drawMouth(g, cx, cy, rx, ry) {
    g.save();
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = "#000";
    g.fill();

    // Glow sunk into the throat.
    const throat = g.createRadialGradient(cx, cy + ry * 0.2, 0, cx, cy, rx);
    throat.addColorStop(0, "rgba(255, 120, 50, 0.5)");
    throat.addColorStop(0.6, "rgba(120, 20, 10, 0.25)");
    throat.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = throat;
    g.fill();

    // Teeth around the rim, clipped so they only bite inward.
    g.clip();
    g.fillStyle = "#d9cdb8";
    const n = 16;
    for (let i = 0; i < n; i++) {
      for (const sign of [-1, 1]) {
        const a = ((i + 0.5) / n) * Math.PI;
        const bx = cx - rx * Math.cos(a);
        const by = cy + sign * ry * Math.sin(a) * 0.98;
        const len = ry * 0.34 * (0.6 + 0.4 * Math.sin(a));
        g.beginPath();
        g.moveTo(bx - rx * 0.055, by);
        g.lineTo(bx, by - sign * len);
        g.lineTo(bx + rx * 0.055, by);
        g.closePath();
        g.fill();
      }
    }
    g.restore();

    g.strokeStyle = "rgba(200, 162, 74, 0.55)";
    g.lineWidth = Math.max(1, this.#w * 0.0018);
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.stroke();
  }

  // ---- per-frame ---------------------------------------------------------

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} t          milliseconds, monotonic
   * @param {number} intensity  0 = barely there (charging), 1 = full domain
   */
  draw(ctx, t, intensity = 1) {
    const w = this.#w;
    const h = this.#h;
    const wl = h * WATERLINE;

    this.#sky ??= (() => {
      const s = ctx.createLinearGradient(0, 0, 0, h);
      s.addColorStop(0, "#150207");
      s.addColorStop(0.35, "#340410");
      s.addColorStop(0.6, "#08161a");
      s.addColorStop(1, "#020709");
      return s;
    })();
    ctx.fillStyle = this.#sky;
    ctx.fillRect(0, 0, w, h);

    this.#drawSky(ctx, t, w, h, wl);
    this.#drawSlashes(ctx, t, intensity);

    ctx.drawImage(this.#scene, 0, 0);
    this.#drawReflection(ctx, t, w, h, wl);
    this.#drawWaterline(ctx, t, w, h, wl);
    this.#drawEmbers(ctx, t);

    const vig = ctx.createRadialGradient(w / 2, h * 0.48, h * 0.3, w / 2, h * 0.48, h * 0.92);
    vig.addColorStop(0, "rgba(0, 0, 0, 0)");
    vig.addColorStop(1, "rgba(0, 0, 0, 0.85)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  /** Two passes of the cloud texture, drifting at different rates. */
  #drawSky(ctx, t, w, h, wl) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [scale, speed, alpha] of [[1.6, 0.006, 0.75], [2.6, -0.0032, 0.5]]) {
      const tw = w * scale;
      const th = wl * scale;
      const x = ((t * speed) % tw) - tw;
      ctx.globalAlpha = alpha;
      for (let i = 0; i < 2; i++) {
        ctx.drawImage(this.#clouds, x + i * tw, -th * 0.25, tw, th);
      }
    }
    ctx.restore();

    // Heat at the horizon behind the shrine.
    const glow = ctx.createRadialGradient(w / 2, wl * 0.72, 0, w / 2, wl * 0.72, w * 0.5);
    glow.addColorStop(0, "rgba(255, 96, 48, 0.28)");
    glow.addColorStop(1, "rgba(255, 60, 30, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, wl);
  }

  /** Mirror the scene into the water, band by band, with a slow ripple. */
  #drawReflection(ctx, t, w, h, wl) {
    const bands = 26;
    const bh = (h - wl) / bands;
    ctx.save();
    for (let i = 0; i < bands; i++) {
      const srcY = wl - (i + 1) * bh;
      if (srcY < 0) break;
      const dstY = wl + i * bh;
      const depth = i / bands;
      const dx = Math.sin(t / 900 + i * 0.55) * w * 0.004 * (0.4 + depth);

      ctx.globalAlpha = 0.78 * (1 - depth * 0.55);
      ctx.setTransform(1, 0, 0, -1, dx, dstY + bh);
      ctx.drawImage(this.#scene, 0, srcY, w, bh, 0, 0, w, bh);
    }
    ctx.restore();

    // Tint the water and sink the far end into darkness.
    const water = ctx.createLinearGradient(0, wl, 0, h);
    water.addColorStop(0, "rgba(10, 40, 46, 0.18)");
    water.addColorStop(1, "rgba(2, 8, 10, 0.62)");
    ctx.fillStyle = water;
    ctx.fillRect(0, wl, w, h - wl);
  }

  #drawWaterline(ctx, t, w, h, wl) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const y = wl + Math.sin(t / (1600 + i * 480)) * h * 0.006;
      const band = ctx.createLinearGradient(0, y - h * 0.05, 0, y + h * 0.05);
      band.addColorStop(0, "rgba(120, 240, 232, 0)");
      band.addColorStop(0.5, "rgba(140, 245, 236, " + (0.14 - i * 0.04) + ")");
      band.addColorStop(1, "rgba(120, 240, 232, 0)");
      ctx.fillStyle = band;
      ctx.fillRect(0, y - h * 0.05, w, h * 0.1);
    }
    ctx.restore();
  }

  #drawSlashes(ctx, t, intensity) {
    const w = this.#w;
    const h = this.#h;

    if (t >= this.#nextSlashAt) {
      this.#nextSlashAt = t + 420 + Math.random() * 1200;
      this.#slashes.push({
        born: t,
        life: 380 + Math.random() * 320,
        x: Math.random() * w,
        y: Math.random() * h * 0.5,
        len: h * (0.4 + Math.random() * 0.6),
        angle: (-0.9 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1),
        thick: 1 + Math.random() * 2.5,
      });
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of this.#slashes) {
      const age = (t - s.born) / s.life;
      if (age >= 1) continue;
      // Fast in, slow out — it should read as a cut, not a fade.
      const a = (age < 0.12 ? age / 0.12 : 1 - (age - 0.12) / 0.88) * intensity;
      const dx = Math.cos(s.angle) * s.len;
      const dy = Math.sin(s.angle) * s.len;
      const grad = ctx.createLinearGradient(s.x - dx / 2, s.y - dy / 2, s.x + dx / 2, s.y + dy / 2);
      grad.addColorStop(0, "rgba(255, 120, 90, 0)");
      grad.addColorStop(0.5, "rgba(255, 228, 214, " + 0.8 * a + ")");
      grad.addColorStop(1, "rgba(255, 60, 40, 0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = s.thick;
      ctx.beginPath();
      ctx.moveTo(s.x - dx / 2, s.y - dy / 2);
      ctx.lineTo(s.x + dx / 2, s.y + dy / 2);
      ctx.stroke();
    }
    ctx.restore();

    this.#slashes = this.#slashes.filter((s) => t - s.born < s.life);
  }

  #drawEmbers(ctx, t) {
    const dt = 1 / 60;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < this.#embers.length; i++) {
      const e = this.#embers[i];
      e.y -= e.vy * dt;
      if (e.y < -10) {
        this.#embers[i] = this.#spawnEmber();
        continue;
      }
      ctx.fillStyle = e.warm ? "rgba(255, 214, 170, 0.8)" : "rgba(255, 96, 54, 0.65)";
      ctx.beginPath();
      ctx.arc(e.x + Math.sin(t / 900 + e.phase) * e.drift, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
