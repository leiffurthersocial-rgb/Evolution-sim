/**
 * renderer.ts
 * -----------------------------------------------------------------------------
 * All world drawing lives here and NOWHERE else. The renderer reads simulation
 * state and paints it through a Camera transform; it never mutates simulation
 * state. This strict separation means the simulation can run headless, and the
 * renderer could be swapped (WebGL) without touching game logic.
 *
 * The canvas fills its container responsively; the Camera maps world→screen so
 * the whole map can be fit into view, zoomed, and panned. Entities outside the
 * visible region are culled for performance at high zoom.
 *
 * Organisms visually reflect their genes: size→radius, strength→outline,
 * speed→heading-whisker length, camouflage→desaturation, lineage→hue. The
 * selected and hovered organisms get highlight rings.
 * -----------------------------------------------------------------------------
 */
import { hslToCss, clamp, norm } from './utils.js';
import { GENES } from './config.js';
export class Renderer {
    constructor(canvas, sim, camera) {
        this.canvas = canvas;
        this.sim = sim;
        this.camera = camera;
        /** Viewport size in CSS pixels (the container's size). */
        this.viewW = 0;
        this.viewH = 0;
        this.dpr = 1;
        /** Ids of the selected / hovered organisms (or null). */
        this.selectedId = null;
        this.hoveredId = null;
        /** Body colouring mode (lineage hue, or a trait/vital heatmap). */
        this.colorMode = 'lineage';
        this.overlays = {
            vision: false,
            energy: false,
            age: false,
            fitness: false,
            mutation: false,
            generation: false,
            terrain: false, // fertile-soil heatmap off by default
            safeZones: true,
        };
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error('2D canvas context unavailable');
        this.ctx = ctx;
    }
    /**
     * Resize the backing canvas to fill its container (CSS pixels × DPR). Returns
     * the new viewport size so the caller can re-fit the camera if desired.
     */
    resize() {
        const parent = this.canvas.parentElement;
        const rect = parent
            ? parent.getBoundingClientRect()
            : { width: this.sim.env.width, height: this.sim.env.height };
        this.viewW = Math.max(1, Math.floor(rect.width));
        this.viewH = Math.max(1, Math.floor(rect.height));
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.viewW * this.dpr;
        this.canvas.height = this.viewH * this.dpr;
        this.canvas.style.width = this.viewW + 'px';
        this.canvas.style.height = this.viewH + 'px';
        return { w: this.viewW, h: this.viewH };
    }
    /** Paint one frame. */
    render() {
        const ctx = this.ctx;
        const cam = this.camera;
        // Clear the whole backing store in device space.
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.viewW, this.viewH);
        ctx.fillStyle = '#05070a';
        ctx.fillRect(0, 0, this.viewW, this.viewH);
        // Apply the camera: device-pixel-ratio × world scale, plus offset.
        ctx.setTransform(this.dpr * cam.scale, 0, 0, this.dpr * cam.scale, this.dpr * cam.offsetX, this.dpr * cam.offsetY);
        const env = this.sim.env;
        // World background (inside bounds).
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, env.width, env.height);
        if (this.overlays.terrain)
            this.drawTerrain();
        if (this.overlays.safeZones)
            this.drawSafeZones();
        this.drawObstacles();
        this.drawWorldBorder();
        this.drawFood();
        this.drawOrganisms();
    }
    /** Visible world rectangle (for culling), in world coordinates. */
    visibleBounds() {
        const tl = this.camera.screenToWorld(0, 0);
        const br = this.camera.screenToWorld(this.viewW, this.viewH);
        return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
    }
    drawWorldBorder() {
        const ctx = this.ctx;
        const env = this.sim.env;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1 / this.camera.scale;
        ctx.strokeRect(0, 0, env.width, env.height);
    }
    drawTerrain() {
        const ctx = this.ctx;
        const env = this.sim.env;
        const res = env.terrainRes;
        const cw = env.width / res;
        const ch = env.height / res;
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                const f = env.terrain[y * res + x];
                ctx.fillStyle = hslToCss(130, 0.35, 0.06 + f * 0.1);
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
            ctx.lineWidth = 1 / this.camera.scale;
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
            ctx.lineWidth = 2 / this.camera.scale;
            ctx.stroke();
        }
    }
    drawFood() {
        const ctx = this.ctx;
        const b = this.visibleBounds();
        const per = this.sim.config.food.energyPerItem;
        ctx.fillStyle = '#5fd97a';
        for (const f of this.sim.env.food) {
            if (f.eaten)
                continue;
            if (f.x < b.x0 || f.x > b.x1 || f.y < b.y0 || f.y > b.y1)
                continue;
            const r = 1.6 + (f.energy / per) * 1.6;
            ctx.beginPath();
            ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    drawOrganisms() {
        const b = this.visibleBounds();
        const margin = 20;
        const showText = this.overlays.age || this.overlays.fitness || this.overlays.generation;
        for (const o of this.sim.organisms) {
            if (o.x < b.x0 - margin || o.x > b.x1 + margin || o.y < b.y0 - margin || o.y > b.y1 + margin) {
                continue;
            }
            this.drawOrganism(o);
            if (showText)
                this.drawOrganismOverlay(o);
        }
        // Highlights drawn last so they sit above everything.
        if (this.hoveredId !== null && this.hoveredId !== this.selectedId) {
            const o = this.sim.findById(this.hoveredId);
            if (o)
                this.drawHighlight(o, 'rgba(255,255,255,0.5)', 2);
        }
        if (this.selectedId !== null) {
            const o = this.sim.findById(this.selectedId);
            if (o)
                this.drawSelection(o);
        }
    }
    drawOrganism(o) {
        const ctx = this.ctx;
        const r = o.radius;
        // Ornament plume: a bright, translucent halo whose size scales with the
        // (costly) ornament gene. Under sexual selection this visibly inflates.
        const ornament = o.genome.expressed('ornament');
        if (ornament > 0.02) {
            const plume = r + ornament * 12;
            ctx.beginPath();
            ctx.arc(o.x, o.y, plume, 0, Math.PI * 2);
            ctx.fillStyle = hslToCss(o.hue + 40, 0.9, 0.6).replace('hsl', 'hsla').replace(')', `, ${0.10 + ornament * 0.25})`);
            ctx.fill();
        }
        if (this.overlays.vision) {
            ctx.beginPath();
            ctx.arc(o.x, o.y, o.visionRadius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1 / this.camera.scale;
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
        ctx.fillStyle = this.bodyColorFor(o);
        ctx.fill();
        ctx.lineWidth = (0.5 + o.genome.expressed('strength') * 2.5) / this.camera.scale;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.stroke();
        const wl = r + o.genome.expressed('speed') * 10;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x + Math.cos(o.dir) * wl, o.y + Math.sin(o.dir) * wl);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1 / this.camera.scale;
        ctx.stroke();
        if (this.overlays.mutation && o.genome.hasActiveModifiers()) {
            ctx.beginPath();
            ctx.arc(o.x, o.y, r + 3, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 210, 90, 0.85)';
            ctx.lineWidth = 1.5 / this.camera.scale;
            ctx.stroke();
        }
        if (this.overlays.energy) {
            const frac = o.energyFraction();
            ctx.beginPath();
            ctx.arc(o.x, o.y, r + 2, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
            ctx.strokeStyle = frac > 0.3 ? 'rgba(90,220,120,0.9)' : 'rgba(230,90,90,0.9)';
            ctx.lineWidth = 2 / this.camera.scale;
            ctx.stroke();
        }
    }
    /** Blue→red heatmap for a normalised value (0 = cool, 1 = hot). */
    heat(t) {
        return hslToCss((1 - clamp(t, 0, 1)) * 220, 0.85, 0.55);
    }
    /** Resolve an organism's body colour under the current colour mode. */
    bodyColorFor(o) {
        const m = this.colorMode;
        if (m === 'lineage')
            return o.bodyColor();
        if (m === 'energy')
            return this.heat(o.energyFraction());
        if (m === 'age')
            return this.heat(o.ageFraction());
        const g = GENES[m];
        if (g)
            return this.heat(norm(o.genome.expressed(m), g.min, g.max));
        return o.bodyColor();
    }
    drawHighlight(o, color, width) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = width / this.camera.scale;
        ctx.stroke();
    }
    /** Pulsing selection ring plus a vision circle for the tracked organism. */
    drawSelection(o) {
        const ctx = this.ctx;
        const pulse = 2 + Math.sin(performance.now() / 200) * 1.5;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.radius + 5 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd24d';
        ctx.lineWidth = 2.5 / this.camera.scale;
        ctx.stroke();
        // Show its perception range so its behaviour is legible.
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.visionRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,210,77,0.22)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1 / this.camera.scale;
        ctx.stroke();
        ctx.setLineDash([]);
    }
    drawOrganismOverlay(o) {
        const ctx = this.ctx;
        const px = 8 / this.camera.scale;
        ctx.font = `${px}px monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.textAlign = 'center';
        let label = null;
        if (this.overlays.age)
            label = `${Math.round(o.ageFraction() * 100)}%`;
        else if (this.overlays.fitness)
            label = o.fitnessEstimate().toFixed(1);
        else if (this.overlays.generation)
            label = `g${o.generation}`;
        if (label !== null)
            ctx.fillText(label, o.x, o.y - o.radius - 3 / this.camera.scale);
    }
    /**
     * Hit-test: return the organism nearest to a world point within its body
     * radius (+ a small screen-space tolerance so tiny organisms are clickable).
     */
    pick(worldX, worldY) {
        const tolerance = 6 / this.camera.scale;
        let best = null;
        let bestD = Infinity;
        for (const o of this.sim.organisms) {
            const dx = o.x - worldX;
            const dy = o.y - worldY;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d <= o.radius + tolerance && d < bestD) {
                bestD = d;
                best = o;
            }
        }
        return best;
    }
}
//# sourceMappingURL=renderer.js.map