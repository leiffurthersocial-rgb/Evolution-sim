/**
 * organism.ts
 * -----------------------------------------------------------------------------
 * The Organism: a single living agent with a Genome, a position, energy, an
 * age, and behaviour. This is where "every beneficial trait must incur a
 * meaningful biological cost" is enforced, via:
 *
 *   1. METABOLIC DRAIN  — nearly every gene adds to energy consumed per tick,
 *      so bigger/stronger/faster/smarter organisms starve faster unless they
 *      out-forage the cost (see `metabolicRate`).
 *   2. ANTAGONISTIC COUPLINGS — genes trade off directly in the derived-attribute
 *      getters (size & strength reduce speed; efficiency reduces burst; size &
 *      lifespan delay maturation; fertility shortens lifespan and lowers
 *      per-offspring investment).
 *
 * Behaviour is deliberately simple and legible (seek food, flee threats, wander)
 * with decision QUALITY scaling on `intelligence`, isolated in `decide()` so a
 * future neural / learning controller can replace it wholesale.
 * -----------------------------------------------------------------------------
 */
import { GENES } from './config.js';
import { clamp, dist, dist2, hslToCss } from './utils.js';
import { PreferenceGenome } from './selection.js';
let NEXT_ID = 1;
export class Organism {
    constructor(genome, x, y, config, generation = 0, hue = 0) {
        /** Heritable, mutable mate preferences (used by sexual selection). */
        this.preferences = PreferenceGenome.neutral();
        this.dir = 0;
        this.vx = 0;
        this.vy = 0;
        this.age = 0;
        this.alive = true;
        this.offspringCount = 0;
        this.reproCooldown = 0;
        this.causeOfDeath = null;
        this._scratch = [];
        this.id = NEXT_ID++;
        this.genome = genome;
        this.config = config;
        this.x = x;
        this.y = y;
        this.generation = generation;
        this.hue = hue;
        this.energy = this.maxEnergyValue * config.physics.startEnergyFraction;
    }
    // ===========================================================================
    //  Derived attributes — the tradeoff engine. All read EXPRESSED gene values.
    // ===========================================================================
    /** Body radius (px) — larger `size` gene = visibly bigger organism. */
    get radius() {
        return 3 + this.genome.expressed('size') * 4.2;
    }
    get maxEnergyValue() {
        return this.genome.expressed('maxEnergy');
    }
    get reproductionThresholdEnergy() {
        return this.genome.expressed('reproductionThreshold') * this.maxEnergyValue;
    }
    /**
     * Effective top speed (px/tick). COUPLINGS: divided down by size, reduced by
     * strength (muscle bulk), and reduced by high efficiency (energy-saving
     * metabolism trades away burst). A pure fast+strong+big organism can't exist.
     */
    get maxSpeed() {
        const speed = this.genome.expressed('speed');
        const size = this.genome.expressed('size');
        const strength = this.genome.expressed('strength');
        const eff = this.genome.expressed('energyEfficiency');
        const base = this.config.physics.baseSpeedPx * speed;
        const sizePenalty = 0.55 + 0.45 / (0.55 + 0.45 * size);
        const strengthPenalty = 1.15 - 0.15 * strength;
        const effPenalty = 1.18 - 0.18 * (eff / GENES.energyEfficiency.max);
        return base * sizePenalty * strengthPenalty * effPenalty;
    }
    get visionRadius() {
        return this.genome.expressed('vision');
    }
    /** Energy drained per tick to stay alive (before movement), / efficiency. */
    get metabolicRate() {
        const c = this.config.physics.metabolismCoeffs;
        const eff = this.genome.expressed('energyEfficiency');
        let m = this.config.physics.baseMetabolism;
        m += this.genome.expressed('size') * c.size;
        m += this.genome.expressed('strength') * c.strength;
        m += this.genome.expressed('speed') * c.speed;
        m += this.genome.expressed('vision') * c.vision;
        m += this.genome.expressed('intelligence') * c.intelligence;
        m += this.genome.expressed('camouflage') * c.camouflage;
        m += this.genome.expressed('maxEnergy') * c.maxEnergy;
        m += this.genome.expressed('aggression') * c.aggression;
        m += this.genome.expressed('ornament') * c.ornament;
        return m / eff;
    }
    /** Age (ticks) at which reproduction becomes possible. Bigger/longer-lived
     *  organisms mature more slowly. */
    get maturityAge() {
        const size = this.genome.expressed('size');
        return this.effectiveLifespan * (0.10 + 0.06 * size);
    }
    /** Effective lifespan (ticks). High fertility burns the candle faster. */
    get effectiveLifespan() {
        const lifespan = this.genome.expressed('lifespan');
        const fertility = this.genome.expressed('fertility');
        return lifespan * (1.15 - 0.30 * fertility);
    }
    /** Combat power for aggression encounters: mass × muscle, nudged by intel. */
    get combatPower() {
        const size = this.genome.expressed('size');
        const strength = this.genome.expressed('strength');
        const intel = this.genome.expressed('intelligence');
        return size * (0.5 + strength) * (0.9 + 0.2 * intel);
    }
    // ===========================================================================
    //  Lifecycle
    // ===========================================================================
    /** Set reproduction cooldown. Fertile organisms recover faster. */
    setReproCooldown() {
        const fertility = this.genome.expressed('fertility');
        this.reproCooldown = 260 * (1.6 - fertility);
    }
    /** True if this organism can act as a mate right now (sexual reproduction). */
    isWillingMate() {
        return (this.alive &&
            this.age >= this.maturityAge &&
            this.reproCooldown <= 0 &&
            this.energy >= this.config.reproduction.willingness * this.maxEnergyValue);
    }
    update(ctx) {
        if (!this.alive)
            return;
        const { env } = ctx;
        this.age++;
        this.genome.tickModifiers();
        if (this.reproCooldown > 0)
            this.reproCooldown--;
        const decision = this.decide(ctx);
        this.move(decision, ctx);
        this.tryEat(ctx);
        if (this.genome.expressed('aggression') > 0.001)
            this.tryFight(ctx);
        this.energy -= this.metabolicRate;
        if (ctx.reproduction.canReproduce(this) && ctx.canGrowPopulation()) {
            const result = ctx.reproduction.reproduce(this, {
                rng: ctx.rng,
                mutation: ctx.mutation,
                config: this.config,
                organismGrid: ctx.organismGrid,
                mateSelector: ctx.mateSelector,
            });
            if (result) {
                const spot = env.nearbyOpenPoint(this.x, this.y, this.radius);
                // Lineage hue: for sexual reproduction, blend toward the mate's hue.
                const baseHue = result.mateHue !== undefined ? (this.hue + result.mateHue) / 2 : this.hue;
                const childHue = baseHue + ctx.rng.gaussian(0, 4);
                const child = ctx.spawnChild(result.genome, spot.x, spot.y, this.generation + 1, childHue);
                child.energy = result.energyGiven;
                child.preferences = result.preferences;
                ctx.recordMutation(result.tally);
            }
        }
        if (this.energy <= 0)
            this.die('starvation');
        else if (this.age >= this.effectiveLifespan)
            this.die('oldAge');
        if (this.energy > this.maxEnergyValue)
            this.energy = this.maxEnergyValue;
    }
    /**
     * Decide a movement intent (or null to wander). Decision QUALITY scales with
     * intelligence; vision gates what is perceivable at all.
     */
    decide(ctx) {
        const { env, rng } = ctx;
        const intel = this.genome.expressed('intelligence');
        const vision = this.visionRadius;
        // Threat avoidance: smart organisms flee nearby stronger, aggressive ones.
        if (intel > 0.15 && !env.inSafeZone(this.x, this.y)) {
            const neighbours = ctx.organismGrid.query(this.x, this.y, vision, this._scratch);
            let threat = null;
            let threatD2 = vision * vision;
            for (let i = 0; i < neighbours.length; i++) {
                const o = neighbours[i];
                if (o === this || !o.alive)
                    continue;
                if (o.genome.expressed('aggression') < 0.3)
                    continue;
                if (o.combatPower <= this.combatPower * 1.05)
                    continue;
                const d2 = dist2(this.x, this.y, o.x, o.y);
                if (d2 < threatD2) {
                    threatD2 = d2;
                    threat = o;
                }
            }
            if (threat && rng.next() < 0.4 + 0.6 * intel) {
                const ang = Math.atan2(this.y - threat.y, this.x - threat.x);
                return { tx: this.x + Math.cos(ang) * 40, ty: this.y + Math.sin(ang) * 40, fleeing: true };
            }
        }
        // Mate seeking (sexual mode only): a well-fed, ready adult moves toward the
        // nearest willing mate. Without this, a spread-out population can never pair
        // up and sexual reproduction collapses. Hunger still takes priority (below),
        // so organisms don't starve chasing mates.
        if (ctx.reproduction.kind === 'sexual' &&
            this.energyFraction() >= 0.45 &&
            this.isWillingMate()) {
            const mate = this._nearestWillingMate(ctx, vision * this.config.reproduction.mateSearchFactor);
            if (mate)
                return { tx: mate.x, ty: mate.y, fleeing: false };
        }
        // Food seeking.
        const food = env.nearestFood(this.x, this.y, vision);
        if (food && rng.next() < 0.35 + 0.65 * intel) {
            return { tx: food.x, ty: food.y, fleeing: false };
        }
        // Wander.
        if (rng.next() < 0.05 + 0.15 * (1 - intel)) {
            this.dir += rng.gaussian(0, 0.6);
        }
        return null;
    }
    /** Nearest willing mate within `radius`, or null. */
    _nearestWillingMate(ctx, radius) {
        const neighbours = ctx.organismGrid.query(this.x, this.y, radius, this._scratch);
        let best = null;
        let bestD2 = radius * radius;
        for (let i = 0; i < neighbours.length; i++) {
            const o = neighbours[i];
            if (o === this || !o.isWillingMate())
                continue;
            const d2 = dist2(this.x, this.y, o.x, o.y);
            if (d2 < bestD2) {
                bestD2 = d2;
                best = o;
            }
        }
        return best;
    }
    move(decision, ctx) {
        const { env } = ctx;
        const speed = this.maxSpeed;
        if (decision) {
            this.dir = Math.atan2(decision.ty - this.y, decision.tx - this.x);
        }
        let nx = this.x + Math.cos(this.dir) * speed;
        let ny = this.y + Math.sin(this.dir) * speed;
        if (nx < 0 || nx > env.width) {
            this.dir = Math.PI - this.dir;
            nx = clamp(nx, 0, env.width);
        }
        if (ny < 0 || ny > env.height) {
            this.dir = -this.dir;
            ny = clamp(ny, 0, env.height);
        }
        if (env.isBlocked(nx, ny, this.radius)) {
            this.dir += Math.PI * (0.5 + ctx.rng.next() * 0.5);
            nx = this.x;
            ny = this.y;
        }
        const moved = dist(this.x, this.y, nx, ny);
        this.x = nx;
        this.y = ny;
        // Movement energy cost: distance × body size × 1/efficiency.
        const eff = this.genome.expressed('energyEfficiency');
        const size = this.genome.expressed('size');
        this.energy -= (moved * this.config.physics.moveCostCoeff * (0.5 + 0.5 * size)) / eff;
    }
    tryEat(ctx) {
        const { env } = ctx;
        const reach = this.radius + 4;
        const food = env.nearestFood(this.x, this.y, reach);
        if (!food)
            return;
        if (dist(this.x, this.y, food.x, food.y) <= reach) {
            const strength = this.genome.expressed('strength');
            const size = this.genome.expressed('size');
            const rate = this.config.physics.eatRateBase * (0.6 + 0.6 * strength) * (0.7 + 0.3 * size);
            const take = Math.min(food.energy, rate);
            food.energy -= take;
            this.energy += take;
            if (food.energy <= 0.001)
                food.eaten = true;
        }
    }
    /**
     * Aggression: attempt to rob a weaker neighbour of energy. Disabled inside
     * safe zones. The constant metabolic tax on aggression means peaceful
     * foragers can out-persist raiders when food is plentiful; aggression pays
     * only when contested.
     */
    tryFight(ctx) {
        const { env } = ctx;
        if (env.inSafeZone(this.x, this.y))
            return;
        const aggression = this.genome.expressed('aggression');
        const reach = this.radius + 6;
        const neighbours = ctx.organismGrid.query(this.x, this.y, reach + 8, this._scratch);
        for (let i = 0; i < neighbours.length; i++) {
            const o = neighbours[i];
            if (o === this || !o.alive)
                continue;
            if (dist(this.x, this.y, o.x, o.y) > reach + o.radius)
                continue;
            if (env.inSafeZone(o.x, o.y))
                continue;
            if (this.combatPower > o.combatPower * 1.1 && ctx.rng.next() < aggression) {
                const stolen = o.energy * this.config.physics.combatEnergyTransfer;
                o.energy -= stolen;
                this.energy += stolen * 0.8;
                if (o.energy <= 0)
                    o.die('combat');
                return;
            }
        }
    }
    die(cause) {
        this.alive = false;
        this.causeOfDeath = cause;
    }
    // ===========================================================================
    //  Presentation helpers (read by the renderer / inspector; no game logic).
    // ===========================================================================
    /** Base body colour from lineage hue; camouflage desaturates it. */
    bodyColor() {
        const camo = this.genome.expressed('camouflage');
        return hslToCss(this.hue, 0.75 - 0.5 * camo, 0.55 - 0.1 * camo);
    }
    energyFraction() {
        return clamp(this.energy / this.maxEnergyValue, 0, 1);
    }
    ageFraction() {
        return clamp(this.age / this.effectiveLifespan, 0, 1);
    }
    /**
     * A cheap emergent "fitness estimate" for display/overlays only — NOT used by
     * selection. Offspring produced plus bonuses for longevity and energy reserve.
     */
    fitnessEstimate() {
        return this.offspringCount * 2 + this.ageFraction() + this.energyFraction();
    }
    /** Expressed value of a gene (convenience for the inspector UI). */
    expressed(key) {
        return this.genome.expressed(key);
    }
}
//# sourceMappingURL=organism.js.map