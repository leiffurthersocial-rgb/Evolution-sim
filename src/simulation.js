/**
 * simulation.js
 * -----------------------------------------------------------------------------
 * The Simulation orchestrates every system without knowing how any of them are
 * drawn. It owns:
 *   - the RNG (deterministic entry point),
 *   - the Environment,
 *   - the population of Organisms,
 *   - the MutationEngine and the ReproductionStrategy,
 *   - the Statistics collector.
 *
 * A single `step()` advances the world by one tick; the render loop decides how
 * many steps to run per frame (simulation speed) and when to pause. Nothing here
 * touches the DOM or canvas — that separation is what lets the same simulation
 * run headless (e.g. for tests or batch experiments) as well as on screen.
 * -----------------------------------------------------------------------------
 */

import { RNG } from './rng.js';
import { Environment } from './environment.js';
import { Organism } from './organism.js';
import { Genome } from './genome.js';
import { MutationEngine } from './mutation.js';
import { AsexualReproduction } from './reproduction.js';
import { Statistics } from './statistics.js';
import { SpatialGrid } from './utils.js';

export class Simulation {
  /** @param {object} config - the live (mutable) config object. */
  constructor(config) {
    this.config = config;
    this.build();
  }

  /** (Re)construct the whole world from the current config + seed. */
  build() {
    this.rng = new RNG(this.config.seed);
    this.env = new Environment(this.config, this.rng);
    this.mutation = new MutationEngine(this.rng, this.config);
    this.reproduction = new AsexualReproduction();
    this.stats = new Statistics(this.config);

    /** @type {Array<Organism>} */
    this.organisms = [];
    this.organismGrid = new SpatialGrid(this.env.width, this.env.height, 48);

    this.tick = 0;
    this.generation = 0;         // highest generation reached
    this._nextHue = 0;           // rotates so founders get distinct lineage hues

    this.spawnFounders();
    this.stats.sample(this.tick, this.organisms, this.generation);
  }

  /** Seed the initial founder population at random open locations. */
  spawnFounders() {
    const n = this.config.population.initial;
    for (let i = 0; i < n; i++) {
      const genome = Genome.founder(this.rng);
      const x = this.rng.range(0, this.env.width);
      const y = this.rng.range(0, this.env.height);
      if (this.env.isBlocked(x, y)) {
        i--; // retry this index at another spot
        continue;
      }
      // Founders get evenly-spaced hues so lineages are visually distinguishable.
      const hue = (i / n) * 360;
      this.organisms.push(new Organism(genome, x, y, this.config, 0, hue));
    }
  }

  /** True while the population is below the configured cap. */
  canGrowPopulation() {
    return this.organisms.length < this.config.population.cap;
  }

  /**
   * Advance the simulation by exactly one tick. This is the deterministic unit
   * of time; call it N times per frame for N× speed.
   */
  step() {
    const env = this.env;

    // 1. Environment upkeep: regenerate food and rebuild spatial indices.
    env.regenerate();
    env.rebuildIndex();

    this.organismGrid = this.rebuildOrganismGrid();

    // 2. Collect newborns separately so they don't act in the tick they're born
    //    (prevents order-dependent chain reproduction within a single step).
    const newborns = [];

    // Shared per-tick context handed to each organism.
    const ctx = {
      env,
      rng: this.rng,
      config: this.config,
      mutation: this.mutation,
      reproduction: this.reproduction,
      organismGrid: this.organismGrid,
      canGrowPopulation: () => this.organisms.length + newborns.length < this.config.population.cap,
      spawnChild: (genome, x, y, gen, hue) => {
        const child = new Organism(genome, x, y, this.config, gen, hue);
        newborns.push(child);
        if (gen > this.generation) this.generation = gen;
        return child;
      },
      recordMutation: (tally) => this.stats.recordMutation(tally),
    };

    // 3. Update every currently-living organism.
    for (let i = 0; i < this.organisms.length; i++) {
      this.organisms[i].update(ctx);
    }

    // 4. Remove the dead (recording their completed lives) and add newborns.
    const survivors = [];
    for (const o of this.organisms) {
      if (o.alive) {
        survivors.push(o);
      } else {
        this.stats.recordDeath(o);
      }
    }
    this.organisms = survivors.concat(newborns);

    // 5. Clean up eaten food.
    env.cullEaten();

    this.tick++;

    // 6. Periodic statistics sampling.
    if (this.tick % this.config.sim.statsInterval === 0) {
      this.stats.sample(this.tick, this.organisms, this.generation);
      this._detectEmergentEvents();
    }
  }

  /** Rebuild the organism spatial grid for this tick's neighbour queries. */
  rebuildOrganismGrid() {
    // Recreate if the world was resized; otherwise reuse and clear.
    if (this.organismGrid.cols * this.organismGrid.cellSize < this.env.width ||
        this.organismGrid.rows * this.organismGrid.cellSize < this.env.height) {
      this.organismGrid = new SpatialGrid(this.env.width, this.env.height, 48);
    }
    this.organismGrid.clear();
    for (const o of this.organisms) this.organismGrid.insert(o);
    return this.organismGrid;
  }

  /**
   * Detect and log a few emergent macro-events for the event log: extinction is
   * handled inside stats.sample; here we flag sudden population booms/crashes.
   */
  _detectEmergentEvents() {
    const pops = this.stats.history.population;
    if (pops.length < 4) return;
    const now = pops[pops.length - 1];
    const prev = pops[pops.length - 4];
    if (prev > 10 && now > prev * 1.6) {
      this.stats.logEvent(this.tick, 'boom', `Population surged to ${now}`);
    } else if (prev > 20 && now < prev * 0.45) {
      this.stats.logEvent(this.tick, 'crash', `Population crashed to ${now}`);
    }
  }

  /** Is the population extinct? */
  get extinct() {
    return this.organisms.length === 0;
  }

  /**
   * Full reset: rebuild everything from the current config and seed. Organism id
   * counter is intentionally NOT reset so ids stay globally unique across runs
   * within a session (harmless, and simplifies debugging).
   */
  reset() {
    this.build();
  }
}
