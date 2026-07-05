/**
 * renderer.js
 * -----------------------------------------------------------------------------
 * All world drawing lives here and NOWHERE else. The renderer reads the
 * simulation's state and paints it; it never mutates simulation state. This
 * strict separation means the simulation can run without a renderer at all
 * (headless), and the renderer can be swapped (WebGL, etc.) without touching
 * game logic.
 *
 * Organisms visually reflect their genes:
 *   - size gene    -> body radius
 *   - speed gene   -> length of the heading "whisker"
 *   - strength     -> body outline thickness (bulkier look)
 *   - vision gene  -> optional sensing-radius ring
 *   - camouflage   -> desaturated colour that blends into terrain
 *   - lineage hue  -> body colour (drifts across generations -> visible clades)
 *
 * Optional overlays (toggled from the UI) draw energy, age, fitness estimate,
 * mutation-activity, and generation.
 * -----------------------------------------------------------------------------
 */

import { hslToCss, clamp } from './utils.js';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Simulation} sim
   */
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;

    /** Overlay toggles, driven by the UI. */
    this.overlays = {
      vision: false,
      energy: false,
      age: false,
      fitness: false,
      mutation: false,
      generation: false,
      terrain: true,
      safeZones: true,
    };
  }

  /** Resize the backing canvas to match the world (accounting for DPI). */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.sim.env.width;
    const h = this.sim.env.height;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Paint one frame. */
  render() {
    const ctx = this.ctx;
    const env = this.sim.env;
    ctx.clearRect(0, 0, env.width, env.height);

    if (this.overlays.terrain) this.drawTerrain();
    else {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, env.width, env.height);
    }
    if (this.overlays.safeZones) this.drawSafeZones();
    this.drawObstacles();
    this.drawFood();
    this.drawOrganisms();
  }

  /** Terrain fertility as a subtle green heatmap. */
  drawTerrain() {
    const ctx = this.ctx;
    const env = this.sim.env;
    const res = env.terrainRes;
    const cw = env.width / res;
    const ch = env.height / res;
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const f = env.terrain[y * res + x];
        // Barren = dark slate, fertile = dark green.
        const l = 0.06 + f * 0.10;
        ctx.fillStyle = hslToCss(130, 0.35, l);
        ctx.fillRect(x * cw, y * ch, cw + 1, ch + 1);
      }
    }
  }

  drawSafeZones() {
    const ctx = this.ctx;
    for (const z of this.sim.env.safeZones) {
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(90, 150, 255, 0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 170, 255, 0.25)';
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawObstacles() {
    const ctx = this.ctx;
    for (const o of this.sim.env.obstacles) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fillStyle = '#2a2f3a';
      ctx.fill();
      ctx.strokeStyle = '#3d4453';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  drawFood() {
    const ctx = this.ctx;
    ctx.fillStyle = '#5fd97a';
    for (const f of this.sim.env.food) {
      if (f.eaten) continue;
      // Small dots; brightness hints at remaining energy.
      const r = 1.6 + (f.energy / this.sim.config.food.energyPerItem) * 1.6;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawOrganisms() {
    const ctx = this.ctx;
    for (const o of this.sim.organisms) {
      this.drawOrganism(o);
    }
    // Overlays that write text are drawn in a second pass so they sit on top.
    if (this.overlays.energy || this.overlays.age || this.overlays.fitness ||
        this.overlays.generation) {
      for (const o of this.sim.organisms) this.drawOrganismOverlay(o);
    }
  }

  drawOrganism(o) {
    const ctx = this.ctx;
    const r = o.radius;

    // Optional vision ring.
    if (this.overlays.vision) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.visionRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Body.
    ctx.beginPath();
    ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
    ctx.fillStyle = o.bodyColor();
    ctx.fill();
    // Strength -> outline thickness (bulkier appearance).
    const strength = o.genome.expressed('strength');
    ctx.lineWidth = 0.5 + strength * 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();

    // Heading whisker whose length encodes speed.
    const speed = o.genome.expressed('speed');
    const wl = r + speed * 10;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(o.x + Math.cos(o.dir) * wl, o.y + Math.sin(o.dir) * wl);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Mutation-activity halo: pulse if temporary duplication/suppression active.
    if (this.overlays.mutation && o.genome.hasActiveModifiers()) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 210, 90, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Energy ring (thin arc around the body) if that overlay is on.
    if (this.overlays.energy) {
      const frac = o.energyFraction();
      ctx.beginPath();
      ctx.arc(o.x, o.y, r + 2, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.strokeStyle = frac > 0.3 ? 'rgba(90,220,120,0.9)' : 'rgba(230,90,90,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /** Text overlays (age/fitness/generation) — drawn sparingly to stay legible. */
  drawOrganismOverlay(o) {
    const ctx = this.ctx;
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'center';
    let label = null;
    if (this.overlays.age) label = `${Math.round(o.ageFraction() * 100)}%`;
    else if (this.overlays.fitness) label = o.fitnessEstimate().toFixed(1);
    else if (this.overlays.generation) label = `g${o.generation}`;
    if (label !== null) ctx.fillText(label, o.x, o.y - o.radius - 3);
  }
}
