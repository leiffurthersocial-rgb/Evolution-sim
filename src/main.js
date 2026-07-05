/**
 * main.js
 * -----------------------------------------------------------------------------
 * Application bootstrap and the main animation loop. This is the only place
 * where all the systems are assembled and where wall-clock time (requestAnimation
 * Frame) is converted into simulation ticks. Everything else is decoupled and
 * testable in isolation.
 *
 * Loop model:
 *   - Each rendered frame runs `config.sim.speed` simulation steps (unless
 *     paused), then renders the world once. This makes "simulation speed" a
 *     clean multiplier that never changes the deterministic per-tick outcome —
 *     only how many ticks elapse per second.
 *   - Charts and the numeric readout refresh a few times per second (not every
 *     frame) since they change slowly and redrawing them is comparatively costly.
 * -----------------------------------------------------------------------------
 */

import { DEFAULT_CONFIG, cloneConfig } from './config.js';
import { Simulation } from './simulation.js';
import { Renderer } from './renderer.js';
import { Charts } from './charts.js';
import { UI } from './ui.js';

class App {
  constructor() {
    // The live, mutable config. Defaults are deep-cloned so a reset always has
    // a pristine reference to fall back on.
    this.config = cloneConfig(DEFAULT_CONFIG);

    this.canvas = document.getElementById('world');
    this.sim = new Simulation(this.config);
    this.renderer = new Renderer(this.canvas, this.sim);
    this.renderer.resize();

    this.charts = new Charts({
      population: document.getElementById('chart-population'),
      traits: document.getElementById('chart-traits'),
      diversity: document.getElementById('chart-diversity'),
      mutations: document.getElementById('chart-mutations'),
      lifehistory: document.getElementById('chart-lifehistory'),
    }, this.sim.stats);

    this.paused = this.config.sim.paused;

    // Wire the UI, giving it callbacks into the app so it never reaches into
    // internals directly.
    this.ui = new UI({
      config: this.config,
      renderer: this.renderer,
      isPaused: () => this.paused,
      onTogglePause: () => this.togglePause(),
      onStep: () => this.singleStep(),
      onReset: () => this.reset(),
      onRebuild: () => this.rebuild(),
      onExport: () => this.exportCSV(),
    });

    this._lastStatsPaint = 0;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  /** Advance exactly one tick while paused (for careful inspection). */
  singleStep() {
    if (!this.sim.extinct) this.sim.step();
    this.renderer.render();
    this.ui.updateReadout(this.sim.stats);
    this.charts.render();
    this.ui.updateEventLog(this.sim.stats);
  }

  /**
   * Rebuild the world in place after a structural config change (world size,
   * initial population, obstacle count...). Reuses the same seed so the change
   * is reproducible. Charts/renderer are re-pointed at the fresh sim state.
   */
  rebuild() {
    this.sim.build();
    this.renderer.sim = this.sim;
    this.renderer.resize();
    this.charts.stats = this.sim.stats;
    this.ui.resetEventLog();
  }

  /** Full reset from the current seed + config. */
  reset() {
    this.sim.reset();
    this.renderer.sim = this.sim;
    this.renderer.resize();
    this.charts.stats = this.sim.stats;
    this.ui.resetEventLog();
    // Keep the sim running after a reset unless it was explicitly paused.
    this.ui.syncPauseButton(this.paused);
  }

  /** Trigger a CSV download of the collected statistics history. */
  exportCSV() {
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

  /** The main animation frame. */
  loop(timestamp) {
    if (!this.paused && !this.sim.extinct) {
      const steps = Math.max(1, this.config.sim.speed | 0);
      for (let i = 0; i < steps; i++) this.sim.step();
    }

    this.renderer.render();

    // Refresh the (relatively expensive) stats UI ~6× per second.
    if (timestamp - this._lastStatsPaint > 160) {
      this._lastStatsPaint = timestamp;
      this.ui.updateReadout(this.sim.stats);
      this.charts.render();
      this.ui.updateEventLog(this.sim.stats);
    }

    requestAnimationFrame(this.loop);
  }
}

// Kick everything off once the DOM is ready.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new App());
} else {
  new App();
}
