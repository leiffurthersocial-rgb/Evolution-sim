/**
 * ui.ts
 * -----------------------------------------------------------------------------
 * All DOM wiring: evolution controls (reproduction mode, fair mode, terrain),
 * population tools (spawn/cull), the slider controls, overlay toggles, live
 * readouts, trait bars, the view controls, and the interactive entity INSPECTOR
 * (editable per-individual genes + actions + mate preferences).
 *
 * It is intentionally the only module that touches the document (beyond the
 * canvases), so simulation and rendering stay UI-agnostic. Controls are declared
 * as data (CONTROL_SPEC) where they are plain sliders; richer widgets (selects,
 * toggles, buttons, editable gene rows) are built explicitly.
 * -----------------------------------------------------------------------------
 */

import { GENE_KEYS, GENES, GeneKey, SimConfig } from './config.js';
import { PREFERENCE_KEYS } from './selection.js';
import { clamp, norm } from './utils.js';
import type { Renderer, Overlays } from './renderer.js';
import type { Camera } from './camera.js';
import type { Statistics } from './statistics.js';
import type { Organism } from './organism.js';

interface ControlSpec {
  group?: string;
  path?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  rebuild?: boolean;
  fmt?: (v: number) => string;
}

const CONTROL_SPEC: ControlSpec[] = [
  { group: 'Population' },
  { path: 'population.cap', label: 'Population Cap', min: 50, max: 2000, step: 10, rebuild: false },
  { path: 'population.initial', label: 'Initial Population', min: 5, max: 400, step: 5, rebuild: true },

  { group: 'Resources' },
  { path: 'food.density', label: 'Food Density', min: 0.00002, max: 0.0008, step: 0.00001, rebuild: false, fmt: (v) => v.toExponential(1) },
  { path: 'food.regenPerTick', label: 'Food Regen / tick', min: 0, max: 6, step: 0.1, rebuild: false },
  { path: 'food.energyPerItem', label: 'Energy / Food', min: 5, max: 100, step: 1, rebuild: false },

  { group: 'Sexual Selection' },
  { path: 'sexual.choosiness', label: 'Choosiness', min: 0, max: 4, step: 0.05, rebuild: false },
  { path: 'reproduction.willingness', label: 'Mate Willingness', min: 0.1, max: 0.95, step: 0.01, rebuild: false },
  { path: 'reproduction.mateSearchFactor', label: 'Mate Search ×Vision', min: 0.5, max: 3, step: 0.1, rebuild: false },
  { path: 'sexual.preferenceMutationRate', label: 'Pref. Mut. Rate', min: 0, max: 1, step: 0.01, rebuild: false },
  { path: 'sexual.preferenceMutationMag', label: 'Pref. Mut. Size', min: 0.01, max: 0.3, step: 0.01, rebuild: false },

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
  { path: 'world.width', label: 'World Width', min: 480, max: 2400, step: 20, rebuild: true },
  { path: 'world.height', label: 'World Height', min: 360, max: 1800, step: 20, rebuild: true },
  { path: 'world.obstacleCount', label: 'Obstacles', min: 0, max: 30, step: 1, rebuild: true },
  { path: 'world.safeZoneCount', label: 'Safe Zones', min: 0, max: 8, step: 1, rebuild: true },
];

const OVERLAY_SPEC: { key: keyof Overlays; label: string }[] = [
  { key: 'terrain', label: 'Terrain fertility' },
  { key: 'safeZones', label: 'Safe zones' },
  { key: 'vision', label: 'Vision radius' },
  { key: 'energy', label: 'Energy rings' },
  { key: 'age', label: 'Age %' },
  { key: 'fitness', label: 'Fitness estimate' },
  { key: 'generation', label: 'Generation' },
  { key: 'mutation', label: 'Mutation activity' },
];

const DERIVED_ROWS: { label: string; get: (o: Organism) => string }[] = [
  { label: 'Max speed', get: (o) => o.maxSpeed.toFixed(2) + ' px/t' },
  { label: 'Metabolism', get: (o) => o.metabolicRate.toFixed(3) + ' e/t' },
  { label: 'Vision', get: (o) => o.visionRadius.toFixed(0) + ' px' },
  { label: 'Combat power', get: (o) => o.combatPower.toFixed(2) },
  { label: 'Matures at', get: (o) => Math.round(o.maturityAge) + ' t' },
  { label: 'Eff. lifespan', get: (o) => Math.round(o.effectiveLifespan) + ' t' },
];

function getPath(obj: unknown, path: string): number {
  return path.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj: unknown, path: string, value: number): void {
  const keys = path.split('.');
  const last = keys.pop() as string;
  const target = keys.reduce<any>((o, k) => o[k], obj);
  target[last] = value;
}

export interface UIDeps {
  config: SimConfig;
  renderer: Renderer;
  camera: Camera;
  isPaused(): boolean;
  onTogglePause(): boolean;
  onStep(): void;
  onReset(): void;
  onRebuild(): void;
  onExport(): void;
  onFit(): void;
  onZoom(factor: number): void;
  onDeselect(): void;
  // Evolution & population tools
  onSetMode(mode: 'asexual' | 'sexual'): void;
  onFairMode(on: boolean): void;
  onTerrain(on: boolean): void;
  onAddIndividual(count: number): void;
  onCull(fraction: number): void;
  // Selected-individual actions
  onCloneSelected(): void;
  onKillSelected(): void;
  onBoostSelected(): void;
}

export class UI {
  private config: SimConfig;
  private _eventCount = 0;
  /** The organism whose inspector DOM is currently built (structure cached). */
  private _inspected: Organism | null = null;
  private _inspectedId: number | null = null;

  constructor(private deps: UIDeps) {
    this.config = deps.config;
    this.buildEvolutionControls();
    this.buildPopulationTools();
    this.buildControls();
    this.buildOverlays();
    this.buildReadout();
    this.buildTraitReadout();
    this.buildInspector();
    this.wireToolbar();
    this.wireViewControls();
  }

  // ---- Evolution controls (selects + toggles) -----------------------------
  private buildEvolutionControls(): void {
    const c = document.getElementById('controls-evolution')!;
    c.innerHTML = '';

    // Reproduction mode select.
    const modeRow = document.createElement('div');
    modeRow.className = 'control-row';
    modeRow.innerHTML = `
      <label><span>Reproduction</span></label>
      <select id="ctl-mode">
        <option value="asexual">Asexual (clone + mutate)</option>
        <option value="sexual">Sexual (mate choice)</option>
      </select>`;
    c.appendChild(modeRow);
    const modeSel = modeRow.querySelector('select') as HTMLSelectElement;
    modeSel.value = this.config.reproduction.mode;
    modeSel.addEventListener('change', () => {
      const mode = modeSel.value as 'asexual' | 'sexual';
      this.deps.onSetMode(mode);
    });

    // Fair evolution toggle.
    c.appendChild(this.makeToggle('Fair evolution (trait budget)', this.config.mutation.fairMode, (on) => this.deps.onFairMode(on)));
    // Fertile terrain toggle.
    c.appendChild(this.makeToggle('Fertile terrain (soil variation)', this.config.world.terrainEnabled, (on) => this.deps.onTerrain(on)));
  }

  private makeToggle(label: string, checked: boolean, onChange: (on: boolean) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'overlay-row';
    row.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}/> ${label}`;
    const cb = row.querySelector('input') as HTMLInputElement;
    cb.addEventListener('change', () => onChange(cb.checked));
    return row;
  }

  // ---- Population tools (buttons) ------------------------------------------
  private buildPopulationTools(): void {
    const c = document.getElementById('controls-population')!;
    c.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'btn-row';
    bar.innerHTML = `
      <button id="btn-add-1" title="Spawn one organism at the centre">＋ Add 1</button>
      <button id="btn-add-10" title="Spawn 10 random organisms">＋ Add 10</button>
      <button id="btn-cull" title="Remove ~10% of the population">✂ Cull 10%</button>`;
    c.appendChild(bar);
    bar.querySelector('#btn-add-1')!.addEventListener('click', () => this.deps.onAddIndividual(1));
    bar.querySelector('#btn-add-10')!.addEventListener('click', () => this.deps.onAddIndividual(10));
    bar.querySelector('#btn-cull')!.addEventListener('click', () => this.deps.onCull(0.1));
  }

  // ---- Controls (sliders) -------------------------------------------------
  private buildControls(): void {
    const container = document.getElementById('controls')!;
    container.innerHTML = '';
    for (const spec of CONTROL_SPEC) {
      if (spec.group) {
        const g = document.createElement('div');
        g.className = 'control-group-title';
        g.textContent = spec.group;
        container.appendChild(g);
        continue;
      }
      const path = spec.path!;
      const row = document.createElement('div');
      row.className = 'control-row';
      const value = getPath(this.config, path);
      const fmt = spec.fmt || ((v: number) => (Number.isInteger(spec.step) ? String(v) : v.toFixed(2)));
      row.innerHTML = `
        <label>
          <span>${spec.label}</span>
          <span class="val" id="val-${path}">${fmt(value)}</span>
        </label>
        <input type="range" id="ctl-${path}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}" />
      `;
      container.appendChild(row);
      const input = row.querySelector('input') as HTMLInputElement;
      const valEl = row.querySelector('.val') as HTMLElement;
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        setPath(this.config, path, v);
        valEl.textContent = fmt(v);
        if (spec.rebuild) this.deps.onRebuild();
      });
    }
  }

  // ---- Overlays -----------------------------------------------------------
  private buildOverlays(): void {
    const container = document.getElementById('overlays')!;
    container.innerHTML = '';
    for (const spec of OVERLAY_SPEC) {
      container.appendChild(
        this.makeToggle(spec.label, this.deps.renderer.overlays[spec.key], (on) => {
          this.deps.renderer.overlays[spec.key] = on;
        })
      );
    }
  }

  // ---- Live readout -------------------------------------------------------
  private buildReadout(): void {
    const container = document.getElementById('readout')!;
    const rows: [string, string][] = [
      ['generation', 'Generation'],
      ['population', 'Population'],
      ['avgFitness', 'Avg Fitness'],
      ['diversity', 'Diversity'],
      ['avgLifespan', 'Avg Lifespan'],
      ['avgOffspring', 'Avg Offspring'],
      ['avgEfficiency', 'Avg Efficiency'],
      ['tick', 'Ticks'],
    ];
    container.innerHTML =
      rows.map(([k, label]) => `<div class="stat"><span class="k">${label}</span><span class="v" id="stat-${k}">—</span></div>`).join('') +
      `<div class="stat wide"><span class="k">Dominant Phenotype</span><span class="v" id="stat-phenotype">—</span></div>` +
      `<div class="stat wide"><span class="k">Reproduction</span><span class="v" id="stat-mode">—</span></div>` +
      `<div class="stat wide"><span class="k">Ornament Preference</span><span class="v" id="stat-ornpref">—</span></div>` +
      `<div class="stat wide"><span class="k">Mutation Rate</span><span class="v" id="stat-mutrate">—</span></div>` +
      `<div class="stat wide"><span class="k">Sim Speed</span><span class="v" id="stat-speed">—</span></div>`;
  }

  private buildTraitReadout(): void {
    const container = document.getElementById('trait-readout')!;
    container.innerHTML = GENE_KEYS.map((key) => `
      <div class="trait-bar-row">
        <div class="tlabel"><span>${GENES[key].label}</span><span class="tv" id="trait-${key}">—</span></div>
        <div class="trait-bar-track"><div class="trait-bar-fill" id="traitbar-${key}" style="width:0%"></div></div>
      </div>
    `).join('');
  }

  // ---- Inspector ----------------------------------------------------------
  private buildInspector(): void {
    document.getElementById('inspector-close')?.addEventListener('click', () => this.deps.onDeselect());
  }

  private isInt(key: GeneKey): boolean {
    return key === 'vision' || key === 'lifespan' || key === 'maxEnergy';
  }

  /**
   * Show/refresh the inspector for an organism (or hide when null). The editable
   * DOM (gene sliders, actions, preferences) is rebuilt only when the SELECTED
   * organism changes, so dragging a gene slider isn't interrupted each frame;
   * the live values (energy/age/derived/expressed) refresh every frame.
   */
  updateInspector(o: Organism | null): void {
    const el = document.getElementById('inspector')!;
    if (!o) {
      el.classList.add('hidden');
      this._inspected = null;
      this._inspectedId = null;
      return;
    }
    el.classList.remove('hidden');

    if (o.id !== this._inspectedId) {
      this._inspected = o;
      this._inspectedId = o.id;
      this.rebuildInspectorStructure(o);
    }
    this.refreshInspectorValues(o);
  }

  private rebuildInspectorStructure(o: Organism): void {
    const el = document.getElementById('inspector')!;
    (el.querySelector('#inspector-title') as HTMLElement).textContent = `Organism #${o.id}`;

    // Action buttons.
    const actions = el.querySelector('#inspector-actions') as HTMLElement;
    actions.innerHTML = `
      <button id="insp-clone" title="Spawn a mutated copy nearby">⎘ Clone</button>
      <button id="insp-boost" title="Refill energy">⚡ Energy</button>
      <button id="insp-kill" title="Remove this organism">☠ Kill</button>`;
    actions.querySelector('#insp-clone')!.addEventListener('click', () => this.deps.onCloneSelected());
    actions.querySelector('#insp-boost')!.addEventListener('click', () => this.deps.onBoostSelected());
    actions.querySelector('#insp-kill')!.addEventListener('click', () => this.deps.onKillSelected());

    // Editable gene rows (bound to THIS organism's base genes).
    const genesEl = el.querySelector('#inspector-genes') as HTMLElement;
    genesEl.innerHTML = GENE_KEYS.map((key) => {
      const g = GENES[key];
      const step = this.isInt(key) ? 1 : (g.max - g.min) / 100;
      return `
        <div class="gene-row editable">
          <span class="gname">${g.label}</span>
          <input type="range" class="gedit" data-key="${key}" min="${g.min}" max="${g.max}" step="${step}" value="${o.genome.genes[key]}" />
          <span class="gval" id="gval-${key}"></span>
        </div>`;
    }).join('');
    genesEl.querySelectorAll<HTMLInputElement>('.gedit').forEach((input) => {
      input.addEventListener('input', () => {
        if (!this._inspected) return;
        const key = input.dataset.key as GeneKey;
        this._inspected.genome.genes[key] = clamp(parseFloat(input.value), GENES[key].min, GENES[key].max);
      });
    });

    // Mate preferences (read-only bars, −1..1).
    const prefWrap = el.querySelector('#inspector-pref-section') as HTMLElement;
    prefWrap.classList.remove('hidden');
    const prefsEl = el.querySelector('#inspector-prefs') as HTMLElement;
    prefsEl.innerHTML = PREFERENCE_KEYS.map((key) => {
      const w = o.preferences.weights[key];
      const pct = Math.round(((w + 1) / 2) * 100);
      const cls = w >= 0 ? 'pos' : 'neg';
      return `
        <div class="pref-row">
          <span class="pname">${key}</span>
          <span class="pbar"><span class="pbar-fill ${cls}" style="width:${Math.abs(w) * 50}%; left:${w >= 0 ? 50 : pct}%"></span></span>
          <span class="pval">${w >= 0 ? '+' : ''}${w.toFixed(2)}</span>
        </div>`;
    }).join('');
  }

  private refreshInspectorValues(o: Organism): void {
    const el = document.getElementById('inspector')!;
    (el.querySelector('#inspector-swatch') as HTMLElement).style.background = o.bodyColor();
    (el.querySelector('#inspector-sub') as HTMLElement).textContent =
      `gen ${o.generation} · ${o.offspringCount} offspring · ${o.causeOfDeath ? 'dead' : 'alive'}`;

    (el.querySelector('#insp-energy-fill') as HTMLElement).style.width = `${Math.round(o.energyFraction() * 100)}%`;
    (el.querySelector('#insp-energy-val') as HTMLElement).textContent = `${o.energy.toFixed(0)} / ${o.maxEnergyValue.toFixed(0)}`;
    (el.querySelector('#insp-age-fill') as HTMLElement).style.width = `${Math.round(o.ageFraction() * 100)}%`;
    (el.querySelector('#insp-age-val') as HTMLElement).textContent = `${o.age} / ${Math.round(o.effectiveLifespan)}`;

    // Expressed values next to each editable gene (flag active modifiers).
    for (const key of GENE_KEYS) {
      const gv = document.getElementById(`gval-${key}`);
      if (!gv) continue;
      const base = o.genome.genes[key];
      const expr = o.genome.expressed(key);
      const shown = this.isInt(key) ? expr.toFixed(0) : expr.toFixed(2);
      gv.textContent = shown;
      gv.classList.toggle('modded', Math.abs(expr - base) > 1e-6);
    }

    const derivedEl = el.querySelector('#inspector-derived') as HTMLElement;
    derivedEl.innerHTML = DERIVED_ROWS.map((r) =>
      `<div class="drow"><span class="k">${r.label}</span><span class="v">${r.get(o)}</span></div>`
    ).join('');
  }

  // ---- Toolbar ------------------------------------------------------------
  private wireToolbar(): void {
    const playBtn = document.getElementById('btn-playpause') as HTMLButtonElement;
    playBtn.addEventListener('click', () => this.syncPauseButton(this.deps.onTogglePause()));
    document.getElementById('btn-step')!.addEventListener('click', () => this.deps.onStep());
    document.getElementById('btn-reset')!.addEventListener('click', () => this.deps.onReset());
    document.getElementById('btn-export')!.addEventListener('click', () => this.deps.onExport());

    const speed = document.getElementById('speed') as HTMLInputElement;
    const speedVal = document.getElementById('speed-value') as HTMLElement;
    speed.addEventListener('input', () => {
      this.config.sim.speed = parseInt(speed.value, 10);
      speedVal.textContent = `${speed.value}×`;
    });

    const seed = document.getElementById('seed-input') as HTMLInputElement;
    seed.value = String(this.config.seed);
    seed.addEventListener('change', () => {
      this.config.seed = parseInt(seed.value, 10) || 1;
      this.deps.onReset();
    });
  }

  private wireViewControls(): void {
    document.getElementById('btn-fit')!.addEventListener('click', () => this.deps.onFit());
    document.getElementById('btn-zoom-in')!.addEventListener('click', () => this.deps.onZoom(1.25));
    document.getElementById('btn-zoom-out')!.addEventListener('click', () => this.deps.onZoom(1 / 1.25));
  }

  // ---- Per-frame updates --------------------------------------------------
  updateReadout(stats: Statistics): void {
    const s = stats.current;
    const set = (id: string, v: string | number) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(v);
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
    set('stat-mode', this.config.reproduction.mode === 'sexual' ? 'Sexual' : 'Asexual');
    set('stat-ornpref', `${s.avgOrnamentPref >= 0 ? '+' : ''}${s.avgOrnamentPref.toFixed(3)}`);
    set('stat-mutrate', this.config.mutation.rate.toFixed(2));
    set('stat-speed', `${this.config.sim.speed}× ${this.deps.isPaused() ? '(paused)' : ''}`);

    for (const key of GENE_KEYS) {
      const g = GENES[key];
      const v = s.genes[key];
      set(`trait-${key}`, this.isInt(key) ? v.toFixed(0) : v.toFixed(2));
      const bar = document.getElementById(`traitbar-${key}`);
      if (bar) bar.style.width = `${Math.round(norm(v, g.min, g.max) * 100)}%`;
    }
  }

  updateViewReadout(): void {
    const el = document.getElementById('zoom-readout');
    if (el) el.textContent = `${this.deps.camera.zoomPercent()}%`;
  }

  updateEventLog(stats: Statistics): void {
    const list = document.getElementById('event-log')!;
    while (this._eventCount < stats.events.length) {
      const e = stats.events[this._eventCount++];
      const li = document.createElement('li');
      li.className = e.type;
      li.innerHTML = `<span class="etype">[${e.type}]</span> t${e.tick}: ${e.detail}`;
      list.insertBefore(li, list.firstChild);
      while (list.children.length > 40) list.removeChild(list.lastChild!);
    }
  }

  resetEventLog(): void {
    this._eventCount = 0;
    document.getElementById('event-log')!.innerHTML = '';
  }

  syncPauseButton(paused: boolean): void {
    const playBtn = document.getElementById('btn-playpause') as HTMLButtonElement;
    playBtn.textContent = paused ? '▶ Play' : '⏸ Pause';
    playBtn.classList.toggle('primary', paused);
  }

  /** Re-sync widgets whose config values may have changed programmatically. */
  syncFromConfig(): void {
    const modeSel = document.getElementById('ctl-mode') as HTMLSelectElement | null;
    if (modeSel) modeSel.value = this.config.reproduction.mode;
  }
}
