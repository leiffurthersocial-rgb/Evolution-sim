/**
 * simulation.ts
 * -----------------------------------------------------------------------------
 * The Simulation orchestrates every system without knowing how any of them are
 * drawn. It owns the RNG (deterministic entry point), Environment, the
 * population, the MutationEngine and ReproductionStrategy, and Statistics.
 *
 * A single `step()` advances the world by one tick; the render loop decides how
 * many steps to run per frame. Nothing here touches the DOM or canvas — that
 * separation lets the same simulation run headless as well as on screen.
 * -----------------------------------------------------------------------------
 */

import { RNG } from './rng.js';
import { Environment } from './environment.js';
import { Organism, TickContext } from './organism.js';
import { Genome } from './genome.js';
import { MutationEngine, MutationTally } from './mutation.js';
import { AsexualReproduction, ReproductionStrategy } from './reproduction.js';
import { Statistics } from './statistics.js';
import { SpatialGrid } from './utils.js';
import type { SimConfig } from './config.js';

export class Simulation {
  rng!: RNG;
  env!: Environment;
  mutation!: MutationEngine;
  reproduction!: ReproductionStrategy;
  stats!: Statistics;
  organisms!: Organism[];
  organismGrid!: SpatialGrid<Organism>;
  tick!: number;
  generation!: number;
  private _nextHue = 0;

  constructor(public config: SimConfig) {
    this.build();
  }

  /** (Re)construct the whole world from the current config + seed. */
  build(): void {
    this.rng = new RNG(this.config.seed);
    this.env = new Environment(this.config, this.rng);
    this.mutation = new MutationEngine(this.rng, this.config);
    this.reproduction = new AsexualReproduction();
    this.stats = new Statistics(this.config);

    this.organisms = [];
    this.organismGrid = new SpatialGrid<Organism>(this.env.width, this.env.height, 48);

    this.tick = 0;
    this.generation = 0;
    this._nextHue = 0;

    this.spawnFounders();
    this.stats.sample(this.tick, this.organisms, this.generation);
  }

  spawnFounders(): void {
    const n = this.config.population.initial;
    for (let i = 0; i < n; i++) {
      const genome = Genome.founder(this.rng);
      const x = this.rng.range(0, this.env.width);
      const y = this.rng.range(0, this.env.height);
      if (this.env.isBlocked(x, y)) {
        i--;
        continue;
      }
      const hue = (i / n) * 360;
      this.organisms.push(new Organism(genome, x, y, this.config, 0, hue));
    }
  }

  canGrowPopulation(): boolean {
    return this.organisms.length < this.config.population.cap;
  }

  /** Advance the simulation by exactly one deterministic tick. */
  step(): void {
    const env = this.env;

    env.regenerate();
    env.rebuildIndex();
    this.rebuildOrganismGrid();

    const newborns: Organism[] = [];

    const ctx: TickContext = {
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
      recordMutation: (tally: MutationTally) => this.stats.recordMutation(tally),
    };

    for (let i = 0; i < this.organisms.length; i++) this.organisms[i].update(ctx);

    const survivors: Organism[] = [];
    for (const o of this.organisms) {
      if (o.alive) survivors.push(o);
      else this.stats.recordDeath(o);
    }
    this.organisms = survivors.concat(newborns);

    env.cullEaten();
    this.tick++;

    if (this.tick % this.config.sim.statsInterval === 0) {
      this.stats.sample(this.tick, this.organisms, this.generation);
      this._detectEmergentEvents();
    }
  }

  private rebuildOrganismGrid(): void {
    if (
      this.organismGrid.cols * this.organismGrid.cellSize < this.env.width ||
      this.organismGrid.rows * this.organismGrid.cellSize < this.env.height
    ) {
      this.organismGrid = new SpatialGrid<Organism>(this.env.width, this.env.height, 48);
    }
    this.organismGrid.clear();
    for (const o of this.organisms) this.organismGrid.insert(o);
  }

  /** Flag sudden population booms/crashes for the event log. */
  private _detectEmergentEvents(): void {
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

  get extinct(): boolean {
    return this.organisms.length === 0;
  }

  /** Find a living organism by id (used by the inspector). */
  findById(id: number): Organism | null {
    for (const o of this.organisms) if (o.id === id) return o;
    return null;
  }

  reset(): void {
    this.build();
  }
}
