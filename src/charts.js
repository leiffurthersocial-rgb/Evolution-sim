/**
 * charts.js
 * -----------------------------------------------------------------------------
 * Minimal, dependency-free line/area charts drawn to small <canvas> elements.
 * Purpose-built for the statistics panel — not a general charting library, just
 * enough to plot the time-series that statistics.js collects.
 *
 * Kept separate from the world renderer because these draw *data over time*, not
 * *the world in space*; different concerns, different lifecycle (they only
 * refresh a few times per second, not every animation frame).
 * -----------------------------------------------------------------------------
 */

import { GENE_KEYS, GENES } from './config.js';
import { norm } from './utils.js';

/** A distinct, readable palette for multi-series charts (trait lines etc.). */
const PALETTE = [
  '#e6584d', '#4d9de6', '#5fd97a', '#e6c34d', '#b96be6',
  '#4de6d0', '#e68a4d', '#8ae64d', '#e64d9d', '#4d6be6',
  '#d0e64d', '#4de68a',
];

/** Draw an axis frame + faint gridlines on a canvas context. */
function drawFrame(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

/** Plot a single series scaled to its own min/max. */
function plotSeries(ctx, data, w, h, color, opts = {}) {
  const n = data.length;
  if (n < 2) return;
  let min = opts.min ?? Infinity;
  let max = opts.max ?? -Infinity;
  if (opts.min === undefined || opts.max === undefined) {
    for (const v of data) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h - norm(data[i], min, max) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = opts.lineWidth || 1.5;
  ctx.stroke();

  if (opts.fill) {
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = opts.fill;
    ctx.fill();
  }
}

/** Small text label in the top-left of a chart. */
function label(ctx, text, color = 'rgba(255,255,255,0.75)') {
  ctx.font = '10px monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.fillText(text, 6, 12);
}

export class Charts {
  /**
   * @param {object} canvases - map of chart name -> HTMLCanvasElement
   * @param {Statistics} stats
   */
  constructor(canvases, stats) {
    this.canvases = canvases;
    this.stats = stats;
    this._contexts = {};
    for (const key in canvases) {
      this._contexts[key] = canvases[key].getContext('2d');
    }
  }

  size(name) {
    const c = this.canvases[name];
    return { w: c.width, h: c.height };
  }

  /** Redraw every chart from the latest history. Cheap; call a few Hz. */
  render() {
    this.renderPopulation();
    this.renderTraits();
    this.renderDiversity();
    this.renderMutations();
    this.renderLifeHistory();
  }

  renderPopulation() {
    const ctx = this._contexts.population;
    if (!ctx) return;
    const { w, h } = this.size('population');
    drawFrame(ctx, w, h);
    plotSeries(ctx, this.stats.history.population, w, h, '#5fd97a', {
      min: 0, fill: 'rgba(95,217,122,0.12)',
    });
    const cur = this.stats.current.population;
    label(ctx, `Population: ${cur}`);
  }

  /** All trait means on one normalised (0..1) axis so shapes are comparable. */
  renderTraits() {
    const ctx = this._contexts.traits;
    if (!ctx) return;
    const { w, h } = this.size('traits');
    drawFrame(ctx, w, h);
    GENE_KEYS.forEach((key, i) => {
      const g = GENES[key];
      const series = this.stats.history.genes[key].map((v) => norm(v, g.min, g.max));
      plotSeries(ctx, series, w, h, PALETTE[i % PALETTE.length], { min: 0, max: 1, lineWidth: 1.2 });
    });
    label(ctx, 'Trait means (normalised 0–1)');
  }

  renderDiversity() {
    const ctx = this._contexts.diversity;
    if (!ctx) return;
    const { w, h } = this.size('diversity');
    drawFrame(ctx, w, h);
    plotSeries(ctx, this.stats.history.diversity, w, h, '#b96be6', {
      min: 0, fill: 'rgba(185,107,230,0.12)',
    });
    const d = this.stats.current.diversity;
    label(ctx, `Genetic diversity: ${d.toFixed(3)}`);
  }

  renderMutations() {
    const ctx = this._contexts.mutations;
    if (!ctx) return;
    const { w, h } = this.size('mutations');
    drawFrame(ctx, w, h);
    const m = this.stats.history.mutations;
    const types = ['minor', 'major', 'duplication', 'suppression', 'macro'];
    types.forEach((t, i) => {
      plotSeries(ctx, m[t], w, h, PALETTE[i % PALETTE.length], { min: 0, lineWidth: 1.2 });
    });
    label(ctx, 'Mutation frequency by type');
  }

  /** Lifespan and offspring-count trends together. */
  renderLifeHistory() {
    const ctx = this._contexts.lifehistory;
    if (!ctx) return;
    const { w, h } = this.size('lifehistory');
    drawFrame(ctx, w, h);
    plotSeries(ctx, this.stats.history.avgLifespan, w, h, '#4d9de6', { min: 0 });
    plotSeries(ctx, this.stats.history.avgOffspring, w, h, '#e6c34d', { min: 0 });
    label(ctx, 'Avg lifespan (blue) & offspring (yellow)');
  }
}
