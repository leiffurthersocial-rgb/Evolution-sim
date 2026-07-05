/**
 * reproduction.ts
 * -----------------------------------------------------------------------------
 * Reproduction strategies behind a common interface. Only ASEXUAL reproduction
 * is implemented today, but the interface is shaped so SEXUAL reproduction (two
 * parents, recombination, mate choice / sexual selection) can be added later as
 * a NEW strategy class with zero changes to Organism or Simulation.
 * -----------------------------------------------------------------------------
 */

import { Genome } from './genome.js';
import type { SimConfig } from './config.js';
import type { RNG } from './rng.js';
import type { MutationEngine, MutationTally } from './mutation.js';
import type { Organism } from './organism.js';

/** Context handed to a strategy when it reproduces. */
export interface ReproContext {
  rng: RNG;
  mutation: MutationEngine;
  config: SimConfig;
}

/** Outcome of a successful reproduction. */
export interface ReproResult {
  genome: Genome;
  energyGiven: number;
  tally: MutationTally;
}

/** Base class documenting the contract; subclasses override both methods. */
export abstract class ReproductionStrategy {
  abstract canReproduce(organism: Organism): boolean;
  abstract reproduce(organism: Organism, ctx: ReproContext): ReproResult | null;
}

/**
 * ASEXUAL reproduction (the default, live strategy).
 *
 * An organism reproduces when mature, off cooldown, and holding at least
 * `reproductionThreshold × maxEnergy` energy. The child inherits the parent's
 * base genes, then mutation perturbs them. Higher fertility => shorter cooldown
 * but LESS energy per offspring — a direct quantity-vs-quality tradeoff.
 */
export class AsexualReproduction extends ReproductionStrategy {
  override canReproduce(o: Organism): boolean {
    return (
      o.age >= o.maturityAge &&
      o.reproCooldown <= 0 &&
      o.energy >= o.reproductionThresholdEnergy
    );
  }

  override reproduce(o: Organism, ctx: ReproContext): ReproResult | null {
    const { mutation, config } = ctx;
    const physics = config.physics;

    const fertility = o.genome.expressed('fertility');
    const investFraction = 0.30 * (1.35 - 0.7 * fertility); // ~0.20–0.40 of maxEnergy
    const energyGiven = o.maxEnergyValue * investFraction;
    const overhead = o.maxEnergyValue * physics.reproOverhead;

    if (o.energy < energyGiven + overhead) return null;

    const { genes, modifiers, tally } = mutation.mutate(o.genome.cloneGenes());
    const childGenome = new Genome(genes);
    for (const mod of modifiers) childGenome.setModifier(mod.key, mod.factor, mod.ticks);

    o.energy -= energyGiven + overhead;
    o.setReproCooldown();
    o.offspringCount++;

    return { genome: childGenome, energyGiven, tally };
  }
}

/**
 * FUTURE: SexualReproduction — reserved.
 * -----------------------------------------------------------------------------
 * Intended shape (kept as documentation so the extension path is concrete):
 *
 *   export class SexualReproduction extends ReproductionStrategy {
 *     constructor(private mateSelector: MateSelector) { super(); }
 *     canReproduce(o) { ...ready & has found a compatible mate... }
 *     reproduce(o, ctx) {
 *       const mate = this.mateSelector.choose(o, candidates, ctx);
 *       const childGenes = recombine(o.genome, mate.genome, ctx.rng); // crossover
 *       ...independent assortment, dominance, sex-linkage, inbreeding penalty...
 *       return { genome: mutate(childGenes), energyGiven, tally };
 *     }
 *   }
 *
 * Nothing else would need to change — Simulation programs against
 * ReproductionStrategy and MateSelector (selection.ts) defines the preference
 * interface already.
 */
