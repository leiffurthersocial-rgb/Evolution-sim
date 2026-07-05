/**
 * organism.js
 * -----------------------------------------------------------------------------
 * The Organism: a single living agent with a Genome, a position, energy, an
 * age, and behaviour.
 *
 * This file is where the spec's central promise — "every beneficial trait must
 * incur a meaningful biological cost" — is actually enforced. It does so in two
 * complementary ways:
 *
 *   1. METABOLIC DRAIN. Nearly every gene contributes to energy consumed per
 *      tick (see `metabolicRate`). Bigger, stronger, faster, smarter, better-
 *      seeing, better-camouflaged organisms all burn more energy. If they can't
 *      earn it back from food, they starve. This alone prevents "max everything".
 *
 *   2. ANTAGONISTIC COUPLINGS. Certain genes directly trade off against others
 *      in the derived-attribute getters below, e.g.:
 *        - size & strength reduce top speed (bulk is slow),
 *        - efficiency reduces burst speed (endurance vs. sprint),
 *        - size delays maturation and slows reproduction,
 *        - fertility shortens effective lifespan and lowers per-offspring
 *          investment (r/K selection tension).
 *
 * Together these make the fitness landscape genuinely multi-peaked: a speedster,
 * a tank, a frugal forager, and a raider can all be viable in different niches,
 * and none dominates everywhere.
 *
 * Behaviour is deliberately simple and legible (seek food, flee threats, wander)
 * with decision QUALITY scaling on the `intelligence` gene. It is isolated in
 * `decide()` so a future neural / learning controller can replace it wholesale.
 * -----------------------------------------------------------------------------
 */

import { GENES } from './config.js';
import { clamp, dist, dist2, hslToCss } from './utils.js';

let NEXT_ID = 1;

export class Organism {
  /**
   * @param {Genome} genome
   * @param {number} x
   * @param {number} y
   * @param {object} config - live config
   * @param {number} generation - 0 for founders, parent.generation+1 otherwise
   * @param {number} hue - lineage colour hue (degrees)
   */
  constructor(genome, x, y, config, generation = 0, hue = 0) {
    this.id = NEXT_ID++;
    this.genome = genome;
    this.config = config;
    this.x = x;
    this.y = y;
    this.generation = generation;
    this.hue = hue;

    // Facing / heading (radians) and current speed magnitude.
    this.dir = 0;
    this.vx = 0;
    this.vy = 0;

    // Life state.
    this.age = 0;
    this.alive = true;
    this.offspringCount = 0;
    this.reproCooldown = 0;
    this.causeOfDeath = null; // 'starvation' | 'oldAge' | 'combat'

    // Start with a healthy energy reserve (half of max) so founders don't
    // instantly starve. Offspring energy is set explicitly by the parent.
    this.energy = this.maxEnergyValue * 0.6;

    // Scratch array reused for spatial queries (avoids per-tick allocation).
    this._scratch = [];
  }

  // ===========================================================================
  //  Derived attributes — the tradeoff engine.
  //  All read from EXPRESSED gene values so temporary duplication/suppression
  //  modifiers actually change behaviour.
  // ===========================================================================

  get g() {
    // Shorthand accessor; caches nothing so expression modifiers stay live.
    return (key) => this.genome.expressed(key);
  }

  /** Body radius in pixels — larger `size` gene = visibly bigger organism. */
  get radius() {
    return 3 + this.genome.expressed('size') * 4.2;
  }

  /** Max energy this organism can store. */
  get maxEnergyValue() {
    return this.genome.expressed('maxEnergy');
  }

  /** Energy threshold (absolute) required to attempt reproduction. */
  get reproductionThresholdEnergy() {
    return this.genome.expressed('reproductionThreshold') * this.maxEnergyValue;
  }

  /**
   * Effective top speed (px/tick). COUPLINGS:
   *   - divided down by size (bigger = slower to move its mass),
   *   - reduced by strength (muscle bulk trades against nimbleness),
   *   - reduced by high efficiency (energy-saving metabolism = less burst).
   * This is why a pure "fast + strong + big" organism can't exist — the very
   * genes that make it a good fighter sap the speed it paid for.
   */
  get maxSpeed() {
    const speed = this.genome.expressed('speed');
    const size = this.genome.expressed('size');
    const strength = this.genome.expressed('strength');
    const eff = this.genome.expressed('energyEfficiency');
    const base = this.config.physics.baseSpeedPx * speed;
    const sizePenalty = 0.55 + 0.45 / (0.55 + 0.45 * size); // ~1.0 small → ~0.75 large
    const strengthPenalty = 1.15 - 0.15 * strength;
    const effPenalty = 1.18 - 0.18 * (eff / GENES.energyEfficiency.max); // efficient = sluggish
    return base * sizePenalty * strengthPenalty * effPenalty;
  }

  /** Perception radius — what the organism can sense (food, others). */
  get visionRadius() {
    return this.genome.expressed('vision');
  }

  /**
   * Energy drained per tick just to stay alive (before movement).
   * Sum of per-gene metabolic costs, then divided by efficiency so that the
   * efficiency gene genuinely reduces upkeep (its cost is the speed penalty
   * above — endurance vs. sprint).
   */
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
    return m / eff;
  }

  /** Age (ticks) at which the organism becomes able to reproduce.
   *  COUPLING: bigger bodies and longer lifespans mature more slowly. */
  get maturityAge() {
    const size = this.genome.expressed('size');
    const lifespan = this.effectiveLifespan;
    return lifespan * (0.10 + 0.06 * size);
  }

  /** Effective lifespan (ticks). COUPLING: high fertility burns the candle
   *  faster — live fast, die young. */
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

  /** Set reproduction cooldown. COUPLING: fertile organisms recover faster. */
  setReproCooldown() {
    const fertility = this.genome.expressed('fertility');
    const base = 260;
    this.reproCooldown = base * (1.6 - fertility); // ~0.6×–1.5× base
  }

  /**
   * Advance one simulation tick.
   * @param {object} ctx - shared per-tick context:
   *   { env, organismGrid, rng, config, spawnChild(genome, x, y, gen, hue),
   *     mutationTallyReducer, reproduction }
   */
  update(ctx) {
    if (!this.alive) return;
    const { env } = ctx;

    this.age++;
    this.genome.tickModifiers();
    if (this.reproCooldown > 0) this.reproCooldown--;

    // Decide where to go, then move (movement charges extra energy).
    const decision = this.decide(ctx);
    this.move(decision, ctx);

    // Feed if standing on food.
    this.tryEat(ctx);

    // Aggression: possibly fight a neighbour for their energy.
    if (this.genome.expressed('aggression') > 0.001) this.tryFight(ctx);

    // Baseline metabolic drain.
    this.energy -= this.metabolicRate;

    // Reproduction (asexual strategy supplied via ctx.reproduction).
    if (ctx.reproduction.canReproduce(this) && ctx.canGrowPopulation()) {
      const result = ctx.reproduction.reproduce(this, {
        rng: ctx.rng,
        mutation: ctx.mutation,
        config: this.config,
      });
      if (result) {
        const spot = env.nearbyOpenPoint(this.x, this.y, this.radius);
        // Lineage colour drifts slightly each generation so clades are visible.
        const childHue = this.hue + ctx.rng.gaussian(0, 4);
        const child = ctx.spawnChild(result.genome, spot.x, spot.y, this.generation + 1, childHue);
        child.energy = result.energyGiven;
        ctx.recordMutation(result.tally);
      }
    }

    // Death checks.
    if (this.energy <= 0) {
      this.die('starvation');
    } else if (this.age >= this.effectiveLifespan) {
      this.die('oldAge');
    }

    // Cap energy at storage maximum.
    if (this.energy > this.maxEnergyValue) this.energy = this.maxEnergyValue;
  }

  /**
   * Decide a movement intent. Returns { tx, ty } target point (or null to
   * wander). Decision QUALITY scales with intelligence: smart organisms reliably
   * pick the nearest food and flee real threats; dim ones act on stale or random
   * targets. Vision gates what is perceivable at all.
   */
  decide(ctx) {
    const { env, rng } = ctx;
    const intel = this.genome.expressed('intelligence');
    const vision = this.visionRadius;

    // --- Threat avoidance (only matters once aggression exists in the world).
    // Smart organisms flee nearby stronger, aggressive neighbours.
    if (intel > 0.15 && !env.inSafeZone(this.x, this.y)) {
      const neighbours = ctx.organismGrid.query(this.x, this.y, vision, this._scratch);
      let threat = null;
      let threatD2 = vision * vision;
      for (let i = 0; i < neighbours.length; i++) {
        const o = neighbours[i];
        if (o === this || !o.alive) continue;
        if (o.genome.expressed('aggression') < 0.3) continue;
        if (o.combatPower <= this.combatPower * 1.05) continue; // only real threats
        const d2 = dist2(this.x, this.y, o.x, o.y);
        if (d2 < threatD2) {
          threatD2 = d2;
          threat = o;
        }
      }
      if (threat && rng.next() < 0.4 + 0.6 * intel) {
        // Flee: target a point directly away from the threat.
        const ang = Math.atan2(this.y - threat.y, this.x - threat.x);
        return { tx: this.x + Math.cos(ang) * 40, ty: this.y + Math.sin(ang) * 40, fleeing: true };
      }
    }

    // --- Food seeking.
    const food = env.nearestFood(this.x, this.y, vision, this._scratch);
    if (food) {
      // Low intelligence sometimes fails to act on the best target.
      if (rng.next() < 0.35 + 0.65 * intel) {
        return { tx: food.x, ty: food.y, fleeing: false };
      }
    }

    // --- Wander: keep some momentum, occasionally change heading.
    if (rng.next() < 0.05 + 0.15 * (1 - intel)) {
      this.dir += rng.gaussian(0, 0.6);
    }
    return null;
  }

  /** Move toward a decision target (or wander along current heading). */
  move(decision, ctx) {
    const { env } = ctx;
    const speed = this.maxSpeed;

    if (decision) {
      this.dir = Math.atan2(decision.ty - this.y, decision.tx - this.x);
    }

    let nx = this.x + Math.cos(this.dir) * speed;
    let ny = this.y + Math.sin(this.dir) * speed;

    // World bounds: reflect off walls.
    if (nx < 0 || nx > env.width) {
      this.dir = Math.PI - this.dir;
      nx = clamp(nx, 0, env.width);
    }
    if (ny < 0 || ny > env.height) {
      this.dir = -this.dir;
      ny = clamp(ny, 0, env.height);
    }

    // Obstacle avoidance: if the step lands in a rock, bounce back and turn.
    if (env.isBlocked(nx, ny, this.radius)) {
      this.dir += Math.PI * (0.5 + ctx.rng.next() * 0.5);
      nx = this.x;
      ny = this.y;
    }

    const moved = dist(this.x, this.y, nx, ny);
    this.x = nx;
    this.y = ny;

    // Movement energy cost: scales with distance, body size, and inverse
    // efficiency. This is what makes *actually running around* expensive, on
    // top of idle metabolism — so speed only pays off if it finds enough food.
    const eff = this.genome.expressed('energyEfficiency');
    const size = this.genome.expressed('size');
    this.energy -= moved * this.config.physics.moveCostCoeff * (0.5 + 0.5 * size) / eff;
  }

  /** Eat any food item the body is currently overlapping. */
  tryEat(ctx) {
    const { env } = ctx;
    const reach = this.radius + 4;
    const food = env.nearestFood(this.x, this.y, reach, this._scratch);
    if (!food) return;
    if (dist(this.x, this.y, food.x, food.y) <= reach) {
      // Feeding rate scales with strength (bite force) and size (mouth); this
      // gives big/strong organisms a foraging edge to partly offset their cost.
      const strength = this.genome.expressed('strength');
      const size = this.genome.expressed('size');
      const rate = this.config.physics.eatRateBase * (0.6 + 0.6 * strength) * (0.7 + 0.3 * size);
      const take = Math.min(food.energy, rate);
      food.energy -= take;
      this.energy += take;
      if (food.energy <= 0.001) food.eaten = true;
    }
  }

  /**
   * Aggression: attempt to rob a weaker neighbour of energy. Disabled inside
   * safe zones. The attacker risks nothing but the energy it spent getting
   * there and the metabolic cost of the aggression gene — but a raider that
   * mis-targets a *stronger* organism simply fails, and the constant metabolic
   * tax on aggression means non-aggressive foragers can out-persist raiders when
   * food is plentiful. Aggression pays only when contested.
   */
  tryFight(ctx) {
    const { env } = ctx;
    if (env.inSafeZone(this.x, this.y)) return;
    const aggression = this.genome.expressed('aggression');
    const reach = this.radius + 6;
    const neighbours = ctx.organismGrid.query(this.x, this.y, reach + 8, this._scratch);
    for (let i = 0; i < neighbours.length; i++) {
      const o = neighbours[i];
      if (o === this || !o.alive) continue;
      if (dist(this.x, this.y, o.x, o.y) > reach + o.radius) continue;
      if (env.inSafeZone(o.x, o.y)) continue;
      // Only initiate if meaningfully stronger and willing (aggression roll).
      if (this.combatPower > o.combatPower * 1.1 && ctx.rng.next() < aggression) {
        const stolen = o.energy * this.config.physics.combatEnergyTransfer;
        o.energy -= stolen;
        this.energy += stolen * 0.8; // some energy lost in the scuffle
        if (o.energy <= 0) o.die('combat');
        return; // one fight per tick
      }
    }
  }

  die(cause) {
    this.alive = false;
    this.causeOfDeath = cause;
  }

  // ===========================================================================
  //  Presentation helpers (read by the renderer; no game logic here).
  // ===========================================================================

  /** Base body colour derived from lineage hue; camouflage desaturates it. */
  bodyColor() {
    const camo = this.genome.expressed('camouflage');
    const sat = 0.75 - 0.5 * camo;      // camouflaged = greyer
    const light = 0.55 - 0.1 * camo;
    return hslToCss(this.hue, sat, light);
  }

  /** Fraction of energy remaining, for overlays. */
  energyFraction() {
    return clamp(this.energy / this.maxEnergyValue, 0, 1);
  }

  /** Fraction of life elapsed, for overlays. */
  ageFraction() {
    return clamp(this.age / this.effectiveLifespan, 0, 1);
  }

  /**
   * A cheap emergent "fitness estimate" for display/overlays only. It is NOT
   * used by selection — survival and reproduction do the selecting. It simply
   * summarises how well this individual is doing: offspring produced plus a
   * bonus for longevity and current energy reserve.
   */
  fitnessEstimate() {
    return this.offspringCount * 2 + this.ageFraction() + this.energyFraction();
  }
}
