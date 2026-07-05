/**
 * ui.js
 * -----------------------------------------------------------------------------
 * All DOM wiring: builds the control sliders, overlay toggles, live readouts,
 * trait bars, and the event log; and routes user input to the live config /
 * simulation / renderer. It is intentionally the ONLY module that touches the
 * document beyond the canvases, so simulation and rendering stay UI-agnostic.
 *
 * Controls are declared as data (CONTROL_SPEC). Each entry names a dotted path
 * into the live config, a range, and whether changing it requires a world
 * rebuild (e.g. world size, seed) or takes effect live (e.g. mutation rate).
 * Adding a new runtime knob is a single entry here.
 * -----------------------------------------------------------------------------
 */

import { GENE_KEYS, GENES } from './config.js';
import { norm } from './utils.js';

/**
 * Declarative control specification.
 * `rebuild: true` => changing it reconstructs the world (structural change).
 * `rebuild: false` => applied live to the running simulation.
 */
const CONTROL_SPEC = [
  { group: 'Population' },
  { path: 'population.cap', label: 'Population Cap', min: 50, max: 2000, step: 10, rebuild: false },
  { path: 'population.initial', label: 'Initial Population', min: 5, max: 400, step: 5, rebuild: true },

  { group: 'Resources' },
  { path: 'food.density', label: 'Food Density', min: 0.00002, max: 0.0008, step: 0.00001, rebuild: false, fmt: (v) => v.toExponential(1) },
  { path: 'food.regenPerTick', label: 'Food Regen / tick', min: 0, max: 6, step: 0.1, rebuild: false },
  { path: 'food.energyPerItem', label: 'Energy / Food', min: 5, max: 100, step: 1, rebuild: false },

  { group: 'Mutation' },
  { path: 'mutation.rate', label: 'Mutation Rate', min: 0, max: 1, step: 0.01, rebuild: false },
  { path: 'mutation.magnitude', label: 'Mutation Size', min: 0.01, max: 0.5, step: 0.01, rebuild: false },
  { path: 'mutation.pBeneficial', label: 'P(beneficial)', min: 0, max: 1, step: 0.01, rebuild: false },
  { path: 'mutation.pHarmful', label: 'P(harmful)', min: 0, max: 1, step: 0.01, rebuild: false },
  { path: 'mutation.pNeutral', label: 'P(neutral)', min: 0, max: 1, step: 0.01, rebuild: false },
  { path: 'mutation.pMajor', label: 'P(major)', min: 0, max: 0.5, step: 0.01, rebuild: false },
  { path: 'mutation.pDuplication', label: 'P(duplication)', min: 0, max: 0.3, step: 0.01, rebuild: false },
  { path: 'mutation.pSuppression', label: 'P(suppression)', min: 0, max: 0.3, step: 0.01, rebuild: false },
  { path: 'mutation.pMacro', label: 'P(macro)', min: 0, max: 0.1, step: 0.001, rebuild: false },

  { group: 'Environment' },
  { path: 'world.width', label: 'World Width', min: 480, max: 1600, step: 20, rebuild: true },
  { path: 'world.height', label: 'World Height', min: 360, max: 1200, step: 20, rebuild: true },
  { path: 'world.obstacleCount', label: 'Obstacles', min: 0, max: 30, step: 1, rebuild: true },
  { path: 'world.safeZoneCount', label: 'Safe Zones', min: 0, max: 8, step: 1, rebuild: true },
];

/** Overlay toggles wired to renderer.overlays. */
const OVERLAY_SPEC = [
  { key: 'terrain', label: 'Terrain fertility' },
  { key: 'safeZones', label: 'Safe zones' },
  { key: 'vision', label: 'Vision radius' },
  { key: 'energy', label: 'Energy rings' },
  { key: 'age', label: 'Age %' },
  { key: 'fitness', label: 'Fitness estimate' },
  { key: 'generation', label: 'Generation' },
  { key: 'mutation', label: 'Mutation activity' },
];

/** Read a dotted path from an object. */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
/** Write a dotted path into an object. */
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

export class UI {
  /**
   * @param {object} deps - { config, getSim, setSim, renderer, onRebuild,
   *                          onReset, onExport, onTogglePause, isPaused }
   */
  constructor(deps) {
    this.deps = deps;
    this.config = deps.config;
    this._sliderEls = {};
    this._eventCount = 0;
    this.build();
  }

  build() {
    this.buildControls();
    this.buildOverlays();
    this.buildReadout();
    this.buildTraitReadout();
    this.wireToolbar();
  }

  // ---- Controls -----------------------------------------------------------
  buildControls() {
    const container = document.getElementById('controls');
    container.innerHTML = '';
    for (const spec of CONTROL_SPEC) {
      if (spec.group) {
        const g = document.createElement('div');
        g.className = 'control-group-title';
        g.textContent = spec.group;
        container.appendChild(g);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'control-row';
      const value = getPath(this.config, spec.path);
      const fmt = spec.fmt || ((v) => (Number.isInteger(spec.step) ? v : v.toFixed(2)));
      row.innerHTML = `
        <label>
          <span>${spec.label}</span>
          <span class="val" id="val-${spec.path}">${fmt(value)}</span>
        </label>
        <input type="range" id="ctl-${spec.path}"
               min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}" />
      `;
      container.appendChild(row);
      const input = row.querySelector('input');
      const valEl = row.querySelector('.val');
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        setPath(this.config, spec.path, v);
        valEl.textContent = fmt(v);
        if (spec.rebuild) {
          this.deps.onRebuild();
        }
      });
      this._sliderEls[spec.path] = { input, valEl, fmt };
    }
  }

  // ---- Overlays -----------------------------------------------------------
  buildOverlays() {
    const container = document.getElementById('overlays');
    container.innerHTML = '';
    for (const spec of OVERLAY_SPEC) {
      const row = document.createElement('label');
      row.className = 'overlay-row';
      const checked = this.deps.renderer.overlays[spec.key];
      row.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}/> ${spec.label}`;
      const cb = row.querySelector('input');
      cb.addEventListener('change', () => {
        this.deps.renderer.overlays[spec.key] = cb.checked;
      });
      container.appendChild(row);
    }
  }

  // ---- Live readout -------------------------------------------------------
  buildReadout() {
    const container = document.getElementById('readout');
    const rows = [
      ['generation', 'Generation'],
      ['population', 'Population'],
      ['avgFitness', 'Avg Fitness'],
      ['diversity', 'Diversity'],
      ['avgLifespan', 'Avg Lifespan'],
      ['avgOffspring', 'Avg Offspring'],
      ['avgEfficiency', 'Avg Efficiency'],
      ['tick', 'Ticks'],
    ];
    container.innerHTML = rows
      .map(([k, label]) => `<div class="stat"><span class="k">${label}</span><span class="v" id="stat-${k}">—</span></div>`)
      .join('') +
      `<div class="stat wide"><span class="k">Dominant Phenotype</span><span class="v" id="stat-phenotype">—</span></div>` +
      `<div class="stat wide"><span class="k">Mutation Rate</span><span class="v" id="stat-mutrate">—</span></div>` +
      `<div class="stat wide"><span class="k">Sim Speed</span><span class="v" id="stat-speed">—</span></div>`;
  }

  buildTraitReadout() {
    const container = document.getElementById('trait-readout');
    container.innerHTML = GENE_KEYS.map((key) => `
      <div class="trait-bar-row">
        <div class="tlabel"><span>${GENES[key].label}</span><span class="tv" id="trait-${key}">—</span></div>
        <div class="trait-bar-track"><div class="trait-bar-fill" id="traitbar-${key}" style="width:0%"></div></div>
      </div>
    `).join('');
  }

  // ---- Toolbar ------------------------------------------------------------
  wireToolbar() {
    const playBtn = document.getElementById('btn-playpause');
    playBtn.addEventListener('click', () => {
      const paused = this.deps.onTogglePause();
      playBtn.textContent = paused ? '▶ Play' : '⏸ Pause';
      playBtn.classList.toggle('primary', paused);
    });

    document.getElementById('btn-step').addEventListener('click', () => this.deps.onStep());
    document.getElementById('btn-reset').addEventListener('click', () => this.deps.onReset());
    document.getElementById('btn-export').addEventListener('click', () => this.deps.onExport());

    const speed = document.getElementById('speed');
    const speedVal = document.getElementById('speed-value');
    speed.addEventListener('input', () => {
      this.config.sim.speed = parseInt(speed.value, 10);
      speedVal.textContent = `${speed.value}×`;
    });

    const seed = document.getElementById('seed-input');
    seed.value = this.config.seed;
    seed.addEventListener('change', () => {
      this.config.seed = parseInt(seed.value, 10) || 1;
      this.deps.onReset();
    });
  }

  // ---- Per-frame updates --------------------------------------------------
  /** Refresh the numeric readouts + trait bars from the latest stats summary. */
  updateReadout(stats) {
    const s = stats.current;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set('stat-generation', s.generation);
    set('stat-population', s.population);
    set('stat-avgFitness', s.avgFitness.toFixed(2));
    set('stat-diversity', s.diversity.toFixed(3));
    set('stat-avgLifespan', Math.round(s.avgLifespan));
    set('stat-avgOffspring', s.avgOffspring.toFixed(2));
    set('stat-avgEfficiency', s.avgEfficiency.toFixed(2));
    set('stat-tick', s.tick);
    set('stat-phenotype', s.dominantPhenotype);
    set('stat-mutrate', this.config.mutation.rate.toFixed(2));
    set('stat-speed', `${this.config.sim.speed}× ${this.deps.isPaused() ? '(paused)' : ''}`);

    for (const key of GENE_KEYS) {
      const g = GENES[key];
      const v = s.genes[key];
      set(`trait-${key}`, v.toFixed(key === 'vision' || key === 'lifespan' || key === 'maxEnergy' ? 0 : 2));
      const bar = document.getElementById(`traitbar-${key}`);
      if (bar) bar.style.width = `${Math.round(norm(v, g.min, g.max) * 100)}%`;
    }
  }

  /** Append any new events from the stats event log to the on-screen list. */
  updateEventLog(stats) {
    const list = document.getElementById('event-log');
    while (this._eventCount < stats.events.length) {
      const e = stats.events[this._eventCount++];
      const li = document.createElement('li');
      li.className = e.type;
      li.innerHTML = `<span class="etype">[${e.type}]</span> t${e.tick}: ${e.detail}`;
      list.insertBefore(li, list.firstChild);
      // Keep the log from growing without bound in the DOM.
      while (list.children.length > 40) list.removeChild(list.lastChild);
    }
  }

  /** Reset the DOM event-log cursor (called on full reset). */
  resetEventLog() {
    this._eventCount = 0;
    document.getElementById('event-log').innerHTML = '';
  }

  /** Sync toolbar play/pause button to a known paused state. */
  syncPauseButton(paused) {
    const playBtn = document.getElementById('btn-playpause');
    playBtn.textContent = paused ? '▶ Play' : '⏸ Pause';
    playBtn.classList.toggle('primary', paused);
  }
}
