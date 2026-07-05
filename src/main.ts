/**
 * main.ts
 * -----------------------------------------------------------------------------
 * Application bootstrap and the main animation loop — the only place where all
 * systems are assembled and where wall-clock time (requestAnimationFrame) is
 * converted into simulation ticks. Everything else stays decoupled and testable.
 *
 * Loop model: each rendered frame runs `config.sim.speed` deterministic sim
 * steps (unless paused), then renders once. Simulation speed is thus a clean
 * multiplier that never changes per-tick outcomes — only how many ticks elapse
 * per second. Charts and readouts refresh a few times per second, not every
 * frame, since they change slowly and are comparatively costly to redraw.
 * -----------------------------------------------------------------------------
 */

import { DEFAULT_CONFIG, cloneConfig, SimConfig } from './config.js';
import { Simulation } from './simulation.js';
import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { InputController } from './input.js';
import { Charts, ChartName } from './charts.js';
import { UI } from './ui.js';
import type { Point } from './utils.js';

class App {
  private config: SimConfig;
  private canvas: HTMLCanvasElement;
  private sim: Simulation;
  private camera: Camera;
  private renderer: Renderer;
  private charts: Charts;
  private ui: UI;
  private input: InputController;

  private paused: boolean;
  private selectedId: number | null = null;
  private _lastStatsPaint = 0;

  constructor() {
    this.config = cloneConfig(DEFAULT_CONFIG);

    this.canvas = document.getElementById('world') as HTMLCanvasElement;
    this.sim = new Simulation(this.config);
    this.camera = new Camera();
    this.renderer = new Renderer(this.canvas, this.sim, this.camera);
    this.fitView();

    this.charts = new Charts(this.collectChartCanvases(), this.sim.stats);
    this.paused = this.config.sim.paused;

    this.ui = new UI({
      config: this.config,
      renderer: this.renderer,
      camera: this.camera,
      isPaused: () => this.paused,
      onTogglePause: () => this.togglePause(),
      onStep: () => this.singleStep(),
      onReset: () => this.reset(),
      onRebuild: () => this.rebuild(),
      onExport: () => this.exportCSV(),
      onFit: () => this.fitView(),
      onZoom: (factor) => this.zoomCentre(factor),
      onDeselect: () => this.select(null),
      onSetMode: (mode) => this.sim.setReproductionMode(mode),
      onFairMode: (on) => { this.config.mutation.fairMode = on; },
      onTerrain: (on) => this.setTerrain(on),
      onAddIndividual: (count) => this.addIndividuals(count),
      onCull: (fraction) => this.sim.cull(fraction),
      onCloneSelected: () => this.cloneSelected(),
      onKillSelected: () => this.killSelected(),
      onBoostSelected: () => this.boostSelected(),
    });

    // Canvas interaction: pick organisms, pan, zoom, hover.
    this.input = new InputController(this.canvas, this.camera, {
      onPick: (world) => this.pickAt(world),
      onHover: (world) => this.hoverAt(world),
      onCameraChange: () => this.ui.updateViewReadout(),
    });

    this.wireKeyboard();
    window.addEventListener('resize', () => this.onResize());

    this.ui.updateViewReadout();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  private collectChartCanvases(): Record<ChartName, HTMLCanvasElement> {
    const byId = (id: string) => document.getElementById(id) as HTMLCanvasElement;
    return {
      population: byId('chart-population'),
      traits: byId('chart-traits'),
      diversity: byId('chart-diversity'),
      mutations: byId('chart-mutations'),
      lifehistory: byId('chart-lifehistory'),
    };
  }

  // ---- View ---------------------------------------------------------------
  private fitView(): void {
    const { w, h } = this.renderer.resize();
    this.camera.fit(this.sim.env.width, this.sim.env.height, w, h);
    this.ui?.updateViewReadout();
  }

  private zoomCentre(factor: number): void {
    this.camera.zoomAt(this.renderer.viewW / 2, this.renderer.viewH / 2, factor);
    this.ui.updateViewReadout();
  }

  private onResize(): void {
    const wasFitted = this.camera.fitted;
    const { w, h } = this.renderer.resize();
    // If the user hadn't manually panned/zoomed, keep the whole map in view.
    if (wasFitted) this.camera.fit(this.sim.env.width, this.sim.env.height, w, h);
    this.ui.updateViewReadout();
  }

  // ---- Evolution & population tools ---------------------------------------
  private setTerrain(on: boolean): void {
    this.config.world.terrainEnabled = on;
    this.sim.env.generateTerrain();       // regenerate the fertility field live
    this.renderer.overlays.terrain = on;  // show the heatmap when enabled
  }

  private addIndividuals(count: number): void {
    const env = this.sim.env;
    for (let i = 0; i < count; i++) {
      // A single add lands at the world centre; batches scatter randomly.
      if (count === 1) {
        this.sim.addOrganism({});
      } else {
        this.sim.addOrganism({ x: this.sim.rng.range(0, env.width), y: this.sim.rng.range(0, env.height) });
      }
    }
  }

  private cloneSelected(): void {
    if (this.selectedId === null) return;
    const o = this.sim.findById(this.selectedId);
    if (o) this.sim.cloneOrganism(o);
  }

  private killSelected(): void {
    if (this.selectedId === null) return;
    const o = this.sim.findById(this.selectedId);
    if (o) o.die('culled');
    this.select(null);
  }

  private boostSelected(): void {
    if (this.selectedId === null) return;
    const o = this.sim.findById(this.selectedId);
    if (o) o.energy = o.maxEnergyValue;
  }

  // ---- Selection ----------------------------------------------------------
  private pickAt(world: Point): void {
    const o = this.renderer.pick(world.x, world.y);
    this.select(o ? o.id : null);
  }

  private hoverAt(world: Point): void {
    const o = this.renderer.pick(world.x, world.y);
    this.renderer.hoveredId = o ? o.id : null;
    this.canvas.style.cursor = o ? 'pointer' : 'grab';
  }

  private select(id: number | null): void {
    this.selectedId = id;
    this.renderer.selectedId = id;
    this.ui.updateInspector(id !== null ? this.sim.findById(id) : null);
  }

  // ---- Controls -----------------------------------------------------------
  private togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  private singleStep(): void {
    if (!this.sim.extinct) this.sim.step();
    this.renderFrame(performance.now(), true);
  }

  private rebuild(): void {
    this.sim.build();
    this.renderer.sim = this.sim;
    this.charts.stats = this.sim.stats;
    this.select(null);
    this.ui.resetEventLog();
    this.fitView();
  }

  private reset(): void {
    this.sim.reset();
    this.renderer.sim = this.sim;
    this.charts.stats = this.sim.stats;
    this.select(null);
    this.ui.resetEventLog();
    this.fitView();
    this.ui.syncPauseButton(this.paused);
  }

  private exportCSV(): void {
    const csv = this.sim.stats.toCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evolution_seed${this.config.seed}_t${this.sim.tick}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private wireKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      // Ignore when typing in an input (e.g. the seed field).
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.ui.syncPauseButton(this.togglePause());
          break;
        case 'f':
          this.fitView();
          break;
        case 'n':
          this.singleStep();
          break;
        case '+':
        case '=':
          this.zoomCentre(1.25);
          break;
        case '-':
          this.zoomCentre(1 / 1.25);
          break;
        case 'Escape':
          this.select(null);
          break;
      }
    });
  }

  // ---- Loop ---------------------------------------------------------------
  private renderFrame(timestamp: number, forceStats = false): void {
    this.renderer.render();

    // Keep the inspector tracking a live organism (clear it if it died).
    if (this.selectedId !== null) {
      const o = this.sim.findById(this.selectedId);
      if (!o) this.select(null);
      else this.ui.updateInspector(o);
    }

    if (forceStats || timestamp - this._lastStatsPaint > 160) {
      this._lastStatsPaint = timestamp;
      this.ui.updateReadout(this.sim.stats);
      this.charts.render();
      this.ui.updateEventLog(this.sim.stats);
    }
  }

  private loop(timestamp: number): void {
    if (!this.paused && !this.sim.extinct) {
      const steps = Math.max(1, this.config.sim.speed | 0);
      for (let i = 0; i < steps; i++) this.sim.step();
    }
    this.renderFrame(timestamp);
    requestAnimationFrame(this.loop);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new App());
} else {
  new App();
}
