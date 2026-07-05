/**
 * environment.ts
 * -----------------------------------------------------------------------------
 * The physical world: a procedural terrain fertility map (drives where food
 * clusters), static obstacles, safe zones (refuges where combat is suppressed),
 * and regenerating, limited food.
 *
 * Because resources are finite and regeneration is capped, competition emerges
 * naturally as the population grows. Cheap spatial queries over food are served
 * by a SpatialGrid so the simulation never scans everything.
 * -----------------------------------------------------------------------------
 */
import { SpatialGrid, dist2, clamp } from './utils.js';
function makeFood(x, y, energy) {
    return { x, y, energy, eaten: false };
}
export class Environment {
    constructor(config, rng) {
        this.config = config;
        this.rng = rng;
        this.food = [];
        this.obstacles = [];
        this.safeZones = [];
        this.terrain = [];
        this._foodDebt = 0;
        this.width = config.world.width;
        this.height = config.world.height;
        this.terrainRes = config.world.terrainCells;
        this.foodGrid = new SpatialGrid(this.width, this.height, 40);
        this.generateTerrain();
        this.generateObstacles();
        this.generateSafeZones();
        this.seedInitialFood();
    }
    // ---- Generation ---------------------------------------------------------
    generateTerrain() {
        const res = this.terrainRes;
        // Fertile-soil variation disabled: a uniform field (no clustering, no heatmap).
        if (!this.config.world.terrainEnabled) {
            this.terrain = new Array(res * res).fill(1);
            return;
        }
        this.terrain = new Array(res * res).fill(0.5);
        const blobs = 6;
        for (let b = 0; b < blobs; b++) {
            const cx = this.rng.range(0, res);
            const cy = this.rng.range(0, res);
            const amp = this.rng.range(-0.4, 0.6);
            const spread = this.rng.range(res * 0.1, res * 0.35);
            for (let y = 0; y < res; y++) {
                for (let x = 0; x < res; x++) {
                    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
                    this.terrain[y * res + x] += amp * Math.exp(-d2 / (2 * spread * spread));
                }
            }
        }
        for (let i = 0; i < this.terrain.length; i++) {
            this.terrain[i] = clamp(this.terrain[i], 0, 1);
        }
    }
    /** Fertility in [0,1] at a world position. */
    fertilityAt(x, y) {
        const res = this.terrainRes;
        const gx = clamp(Math.floor((x / this.width) * res), 0, res - 1);
        const gy = clamp(Math.floor((y / this.height) * res), 0, res - 1);
        return this.terrain[gy * res + gx];
    }
    generateObstacles() {
        this.obstacles = [];
        for (let i = 0; i < this.config.world.obstacleCount; i++) {
            this.obstacles.push({
                x: this.rng.range(0, this.width),
                y: this.rng.range(0, this.height),
                r: this.rng.range(18, 46),
            });
        }
    }
    generateSafeZones() {
        this.safeZones = [];
        for (let i = 0; i < this.config.world.safeZoneCount; i++) {
            this.safeZones.push({
                x: this.rng.range(0, this.width),
                y: this.rng.range(0, this.height),
                r: this.rng.range(60, 110),
            });
        }
    }
    targetFoodCount() {
        const area = this.width * this.height;
        return Math.min(this.config.food.maxItemsHardCap, Math.floor(area * this.config.food.density));
    }
    seedInitialFood() {
        this.food = [];
        const target = this.targetFoodCount();
        for (let i = 0; i < target; i++)
            this.spawnFood();
    }
    // ---- Runtime ------------------------------------------------------------
    isBlocked(x, y, bodyRadius = 0) {
        for (const o of this.obstacles) {
            const rr = o.r + bodyRadius;
            if (dist2(x, y, o.x, o.y) < rr * rr)
                return true;
        }
        return false;
    }
    inSafeZone(x, y) {
        for (const z of this.safeZones) {
            if (dist2(x, y, z.x, z.y) < z.r * z.r)
                return true;
        }
        return false;
    }
    nearbyOpenPoint(x, y, bodyRadius = 4) {
        for (let attempt = 0; attempt < 12; attempt++) {
            const a = this.rng.range(0, Math.PI * 2);
            const d = this.rng.range(6, 26);
            const nx = clamp(x + Math.cos(a) * d, 0, this.width);
            const ny = clamp(y + Math.sin(a) * d, 0, this.height);
            if (!this.isBlocked(nx, ny, bodyRadius))
                return { x: nx, y: ny };
        }
        return { x: clamp(x, 0, this.width), y: clamp(y, 0, this.height) };
    }
    spawnFood() {
        if (this.food.length >= this.config.food.maxItemsHardCap)
            return;
        let x = 0;
        let y = 0;
        if (this.config.food.clusterOnFertile) {
            let placed = false;
            for (let attempt = 0; attempt < 8 && !placed; attempt++) {
                x = this.rng.range(0, this.width);
                y = this.rng.range(0, this.height);
                if (this.rng.next() <= this.fertilityAt(x, y))
                    placed = true;
            }
        }
        else {
            x = this.rng.range(0, this.width);
            y = this.rng.range(0, this.height);
        }
        if (this.isBlocked(x, y))
            return;
        this.food.push(makeFood(x, y, this.config.food.energyPerItem));
    }
    /** Regenerate food up to the (finite) target, capped per tick. */
    regenerate() {
        const target = this.targetFoodCount();
        if (this.food.length >= target)
            return;
        this._foodDebt += this.config.food.regenPerTick;
        let toSpawn = Math.floor(this._foodDebt);
        this._foodDebt -= toSpawn;
        while (toSpawn-- > 0 && this.food.length < target)
            this.spawnFood();
    }
    rebuildIndex() {
        this.foodGrid.clear();
        for (const f of this.food)
            if (!f.eaten)
                this.foodGrid.insert(f);
    }
    cullEaten() {
        if (this.food.some((f) => f.eaten)) {
            this.food = this.food.filter((f) => !f.eaten);
        }
    }
    nearestFood(x, y, radius, scratch = []) {
        const candidates = this.foodGrid.query(x, y, radius, scratch);
        let best = null;
        let bestD2 = radius * radius;
        for (let i = 0; i < candidates.length; i++) {
            const f = candidates[i];
            if (f.eaten)
                continue;
            const d2 = dist2(x, y, f.x, f.y);
            if (d2 < bestD2) {
                bestD2 = d2;
                best = f;
            }
        }
        return best;
    }
    reset() {
        this.width = this.config.world.width;
        this.height = this.config.world.height;
        this.terrainRes = this.config.world.terrainCells;
        this.foodGrid = new SpatialGrid(this.width, this.height, 40);
        this._foodDebt = 0;
        this.generateTerrain();
        this.generateObstacles();
        this.generateSafeZones();
        this.seedInitialFood();
    }
}
//# sourceMappingURL=environment.js.map