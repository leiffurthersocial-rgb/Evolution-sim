/**
 * charts.ts
 * -----------------------------------------------------------------------------
 * Minimal, dependency-free line/area charts drawn to small <canvas> elements.
 * Purpose-built for the statistics panel — just enough to plot the time-series
 * that statistics.ts collects. Separate from the world renderer because these
 * draw data over TIME, not the world in SPACE (different lifecycle and cadence).
 * -----------------------------------------------------------------------------
 */

import { GENE_KEYS, GENES } from './config.js';
import { norm } from './utils.js';
import type { Statistics } from './statistics.js';

const PALETTE = [
  '#e6584d', '#4d9de6', '#5fd97a', '#e6c34d', '#b96be6',
  '#4de6d0', '#e68a4d', '#8ae64d', '#e64d9d', '#4d6be6',
  '#d0e64d', '#4de68a',
];

interface PlotOpts {
  min?: number;
  max?: number;
  fill?: string;
  lineWidth?: number;
}

function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number): void {
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

function plotSeries(
  ctx: CanvasRenderingContext2D,
  data: number[],
  w: number,
  h: number,
  color: string,
  opts: PlotOpts = {}
): void {
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

function label(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.font = '10px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'left';
  ctx.fillText(text, 6, 12);
}

export type ChartName = 'population' | 'traits' | 'diversity' | 'mutations' | 'lifehistory';

export class Charts {
  private _contexts: Record<string, CanvasRenderingContext2D> = {};

  constructor(private canvases: Record<ChartName, HTMLCanvasElement>, public stats: Statistics) {
    for (const key in canvases) {
      const c = canvases[key as ChartName];
      const ctx = c.getContext('2d');
      if (ctx) this._contexts[key] = ctx;
    }
  }

  private size(name: ChartName): { w: number; h: number } {
    const c = this.canvases[name];
    return { w: c.width, h: c.height };
  }

  render(): void {
    this.renderPopulation();
    this.renderTraits();
    this.renderDiversity();
    this.renderMutations();
    this.renderLifeHistory();
  }

  private renderPopulation(): void {
    const ctx = this._contexts.population;
    if (!ctx) return;
    const { w, h } = this.size('population');
    drawFrame(ctx, w, h);
    plotSeries(ctx, this.stats.history.population, w, h, '#5fd97a', { min: 0, fill: 'rgba(95,217,122,0.12)' });
    label(ctx, `Population: ${this.stats.current.population}`);
  }

  private renderTraits(): void {
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

  private renderDiversity(): void {
    const ctx = this._contexts.diversity;
    if (!ctx) return;
    const { w, h } = this.size('diversity');
    drawFrame(ctx, w, h);
    plotSeries(ctx, this.stats.history.diversity, w, h, '#b96be6', { min: 0, fill: 'rgba(185,107,230,0.12)' });
    label(ctx, `Genetic diversity: ${this.stats.current.diversity.toFixed(3)}`);
  }

  private renderMutations(): void {
    const ctx = this._contexts.mutations;
    if (!ctx) return;
    const { w, h } = this.size('mutations');
    drawFrame(ctx, w, h);
    const m = this.stats.history.mutations;
    (['minor', 'major', 'duplication', 'suppression', 'macro'] as const).forEach((t, i) => {
      plotSeries(ctx, m[t], w, h, PALETTE[i % PALETTE.length], { min: 0, lineWidth: 1.2 });
    });
    label(ctx, 'Mutation frequency by type');
  }

  private renderLifeHistory(): void {
    const ctx = this._contexts.lifehistory;
    if (!ctx) return;
    const { w, h } = this.size('lifehistory');
    drawFrame(ctx, w, h);
    plotSeries(ctx, this.stats.history.avgLifespan, w, h, '#4d9de6', { min: 0 });
    plotSeries(ctx, this.stats.history.avgOffspring, w, h, '#e6c34d', { min: 0 });
    label(ctx, 'Avg lifespan (blue) & offspring (yellow)');
  }
}
