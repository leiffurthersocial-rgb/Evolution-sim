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
import { DEFAULT_CONFIG, cloneConfig, SPEED_PRESETS } from './config.js';
import { Simulation } from './simulation.js';
import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { InputController } from './input.js';
import { Charts } from './charts.js';
import { UI } from './ui.js';
class App {
    constructor() {
        this.selectedId = null;
        this.followSelected = false;
        this._lastStatsPaint = 0;
        // Fractional-speed accumulator + live ticks-per-second meter.
        this._stepAcc = 0;
        this._stepsThisSec = 0;
        this._tpsWindowStart = 0;
        this._tps = 0;
        this.config = cloneConfig(DEFAULT_CONFIG);
        this.canvas = document.getElementById('world');
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
            onToggleFollow: () => this.toggleFollow(),
            onColorMode: (mode) => { this.renderer.colorMode = mode; },
            onSpeedIndex: (i) => { this.config.sim.speed = SPEED_PRESETS[i]; },
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
    collectChartCanvases() {
        const byId = (id) => document.getElementById(id);
        return {
            population: byId('chart-population'),
            traits: byId('chart-traits'),
            diversity: byId('chart-diversity'),
            mutations: byId('chart-mutations'),
            lifehistory: byId('chart-lifehistory'),
        };
    }
    // ---- View ---------------------------------------------------------------
    fitView() {
        const { w, h } = this.renderer.resize();
        this.camera.fit(this.sim.env.width, this.sim.env.height, w, h);
        this.ui?.updateViewReadout();
    }
    zoomCentre(factor) {
        this.camera.zoomAt(this.renderer.viewW / 2, this.renderer.viewH / 2, factor);
        this.ui.updateViewReadout();
    }
    onResize() {
        const wasFitted = this.camera.fitted;
        const { w, h } = this.renderer.resize();
        // If the user hadn't manually panned/zoomed, keep the whole map in view.
        if (wasFitted)
            this.camera.fit(this.sim.env.width, this.sim.env.height, w, h);
        this.ui.updateViewReadout();
    }
    // ---- Evolution & population tools ---------------------------------------
    setTerrain(on) {
        this.config.world.terrainEnabled = on;
        this.sim.env.generateTerrain(); // regenerate the fertility field live
        this.renderer.overlays.terrain = on; // show the heatmap when enabled
    }
    addIndividuals(count) {
        const env = this.sim.env;
        for (let i = 0; i < count; i++) {
            // A single add lands at the world centre; batches scatter randomly.
            if (count === 1) {
                this.sim.addOrganism({});
            }
            else {
                this.sim.addOrganism({ x: this.sim.rng.range(0, env.width), y: this.sim.rng.range(0, env.height) });
            }
        }
    }
    cloneSelected() {
        if (this.selectedId === null)
            return;
        const o = this.sim.findById(this.selectedId);
        if (o)
            this.sim.cloneOrganism(o);
    }
    killSelected() {
        if (this.selectedId === null)
            return;
        const o = this.sim.findById(this.selectedId);
        if (o)
            o.die('culled');
        this.select(null);
    }
    boostSelected() {
        if (this.selectedId === null)
            return;
        const o = this.sim.findById(this.selectedId);
        if (o)
            o.energy = o.maxEnergyValue;
    }
    toggleFollow() {
        this.followSelected = !this.followSelected;
        return this.followSelected;
    }
    /** Step the simulation speed up/down through the presets (keyboard [ ]). */
    stepSpeed(dir) {
        let i = SPEED_PRESETS.indexOf(this.config.sim.speed);
        if (i < 0)
            i = SPEED_PRESETS.findIndex((v) => v >= this.config.sim.speed);
        i = Math.max(0, Math.min(SPEED_PRESETS.length - 1, i + dir));
        this.config.sim.speed = SPEED_PRESETS[i];
        this.ui.syncSpeed(i);
    }
    // ---- Selection ----------------------------------------------------------
    pickAt(world) {
        const o = this.renderer.pick(world.x, world.y);
        this.select(o ? o.id : null);
    }
    hoverAt(world) {
        const o = this.renderer.pick(world.x, world.y);
        this.renderer.hoveredId = o ? o.id : null;
        this.canvas.style.cursor = o ? 'pointer' : 'grab';
    }
    select(id) {
        this.selectedId = id;
        this.renderer.selectedId = id;
        if (id === null)
            this.followSelected = false; // stop following when deselected
        this.ui.updateInspector(id !== null ? this.sim.findById(id) : null, this.followSelected);
    }
    // ---- Controls -----------------------------------------------------------
    togglePause() {
        this.paused = !this.paused;
        return this.paused;
    }
    singleStep() {
        if (!this.sim.extinct)
            this.sim.step();
        this.renderFrame(performance.now(), true);
    }
    rebuild() {
        this.sim.build();
        this.renderer.sim = this.sim;
        this.charts.stats = this.sim.stats;
        this.select(null);
        this.ui.resetEventLog();
        this.fitView();
    }
    reset() {
        this.sim.reset();
        this.renderer.sim = this.sim;
        this.charts.stats = this.sim.stats;
        this.select(null);
        this.ui.resetEventLog();
        this.fitView();
        this.ui.syncPauseButton(this.paused);
    }
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
    wireKeyboard() {
        window.addEventListener('keydown', (e) => {
            // Ignore when typing in an input (e.g. the seed field).
            if (e.target instanceof HTMLInputElement)
                return;
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
                case '[':
                    this.stepSpeed(-1);
                    break;
                case ']':
                    this.stepSpeed(+1);
                    break;
                case 'Escape':
                    this.select(null);
                    break;
            }
        });
    }
    // ---- Loop ---------------------------------------------------------------
    renderFrame(timestamp, forceStats = false) {
        // Follow-cam: keep the tracked organism centred (before rendering).
        if (this.followSelected && this.selectedId !== null) {
            const o = this.sim.findById(this.selectedId);
            if (o)
                this.camera.centerOn(o.x, o.y, this.renderer.viewW, this.renderer.viewH);
        }
        this.renderer.render();
        // Keep the inspector tracking a live organism (clear it if it died).
        if (this.selectedId !== null) {
            const o = this.sim.findById(this.selectedId);
            if (!o)
                this.select(null);
            else
                this.ui.updateInspector(o, this.followSelected);
        }
        if (forceStats || timestamp - this._lastStatsPaint > 160) {
            this._lastStatsPaint = timestamp;
            this.ui.updateReadout(this.sim.stats);
            this.ui.setTps(this._tps);
            this.charts.render();
            this.ui.updateEventLog(this.sim.stats);
            this.updateExtinctionBanner();
        }
    }
    updateExtinctionBanner() {
        const banner = document.getElementById('extinction-banner');
        if (banner)
            banner.classList.toggle('hidden', !this.sim.extinct);
    }
    loop(timestamp) {
        if (this._tpsWindowStart === 0)
            this._tpsWindowStart = timestamp;
        if (!this.paused && !this.sim.extinct) {
            // Accumulate fractional ticks so speeds below 1 run in slow motion and
            // high speeds fast-forward — capped so extreme speeds can't freeze the tab.
            this._stepAcc += this.config.sim.speed;
            let steps = Math.floor(this._stepAcc);
            this._stepAcc -= steps;
            const cap = this.config.sim.maxStepsPerFrame;
            if (steps > cap) {
                steps = cap;
                this._stepAcc = 0; // drop backlog rather than spiral
            }
            for (let i = 0; i < steps; i++)
                this.sim.step();
            this._stepsThisSec += steps;
        }
        // Update the ticks-per-second meter once per second.
        const elapsed = timestamp - this._tpsWindowStart;
        if (elapsed >= 1000) {
            this._tps = (this._stepsThisSec * 1000) / elapsed;
            this._stepsThisSec = 0;
            this._tpsWindowStart = timestamp;
        }
        this.renderFrame(timestamp);
        requestAnimationFrame(this.loop);
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new App());
}
else {
    new App();
}
//# sourceMappingURL=main.js.map