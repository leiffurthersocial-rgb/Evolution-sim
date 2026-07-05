/**
 * reproduction.js
 * -----------------------------------------------------------------------------
 * Reproduction strategies, expressed as swappable objects behind a common
 * interface. Today only ASEXUAL reproduction is implemented, but the interface
 * is deliberately shaped so that SEXUAL reproduction (two parents, recombination,
 * mate choice / sexual selection) can be added later as a *new strategy class*
 * with zero changes to the Organism or Simulation code that calls it.
 *
 * The Simulation asks a strategy two questions:
 *   1. canReproduce(organism)         -> boolean
 *   2. reproduce(organism, ctx)       -> Genome for the child (+ side effects)
 *
 * For sexual reproduction, a future SexualReproduction strategy would also
 * implement `findMate(organism, ctx)` and consult a MateSelector (see
 * selection.js) before combining two genomes. Because the Simulation only
 * depends on this interface, swapping strategies is a one-line change.
 * -----------------------------------------------------------------------------
 */

import { Genome } from './genome.js';

/**
 * @typedef {Object} ReproContext
 * @property {import('./rng.js').RNG} rng
 * @property {import('./mutation.js').MutationEngine} mutation
 * @property {object} config
 * @property {(x:number,y:number)=>{x:number,y:number}} nearbyOpenPoint
 *           - returns a valid spawn location near (x, y)
 * @property {(organism:import('./organism.js').Organism)=>Array} findCandidates
 *           - returns nearby organisms (used by future sexual strategies)
 */

/**
 * Base class documenting the contract. Not abstract in a strict sense (JS), but
 * subclasses are expected to override both methods.
 */
export class ReproductionStrategy {
  /** @returns {boolean} whether this organism is currently able to reproduce. */
  canReproduce(_organism) {
    return false;
  }

  /**
   * Perform reproduction, mutating and returning the child's genome. The
   * strategy is responsible for charging the parent's energy cost and setting
   * the parent's cooldown. Returns null if reproduction fails.
   * @returns {{ genome: Genome, energyGiven: number } | null}
   */
  reproduce(_organism, _ctx) {
    return null;
  }
}

/**
 * ASEXUAL reproduction (the default, live strategy).
 *
 * An organism reproduces when it is mature, off cooldown, and holding at least
 * `reproductionThreshold × maxEnergy` energy. The child inherits the parent's
 * base genes, then the mutation engine perturbs them. The parent pays a fixed
 * reproduction overhead plus the energy it invests into the offspring; higher
 * fertility means shorter cooldown but *less* energy per offspring — a direct,
 * intentional tradeoff (quantity vs. quality of offspring).
 */
export class AsexualReproduction extends ReproductionStrategy {
  canReproduce(o) {
    return (
      o.age >= o.maturityAge &&
      o.reproCooldown <= 0 &&
      o.energy >= o.reproductionThresholdEnergy
    );
  }

  reproduce(o, ctx) {
    const { mutation, config } = ctx;
    const physics = config.physics;

    // Fertility trades quality for quantity: fertile parents invest less per
    // child but can breed again sooner (cooldown set by the organism).
    const fertility = o.genome.expressed('fertility');
    const investFraction = 0.30 * (1.35 - 0.7 * fertility); // ~0.20–0.40 of maxEnergy
    const energyGiven = o.maxEnergyValue * investFraction;
    const overhead = o.maxEnergyValue * physics.reproOverhead;

    // Not enough energy to cover both investment and overhead? Abort.
    if (o.energy < energyGiven + overhead) return null;

    // Build the child's genome via mutation of the parent's base genes.
    const { genes, modifiers, tally } = mutation.mutate(o.genome.cloneGenes());
    const childGenome = new Genome(genes);
    for (const mod of modifiers) childGenome.setModifier(mod.key, mod.factor, mod.ticks);

    // Charge the parent and start its cooldown.
    o.energy -= energyGiven + overhead;
    o.setReproCooldown();
    o.offspringCount++;

    return { genome: childGenome, energyGiven, tally };
  }
}

/**
 * FUTURE: SexualReproduction — reserved.
 * -----------------------------------------------------------------------------
 * Sketch of the intended shape (kept as a stub so the extension path is
 * concrete and reviewable, without being active):
 *
 *   export class SexualReproduction extends ReproductionStrategy {
 *     constructor(mateSelector) { super(); this.mateSelector = mateSelector; }
 *     canReproduce(o) { ...ready & has found a compatible mate... }
 *     reproduce(o, ctx) {
 *       const mate = this.mateSelector.choose(o, ctx.findCandidates(o), ctx);
 *       const childGenes = recombine(o.genome, mate.genome, ctx.rng); // crossover
 *       ...independent assortment, dominance, sex-linkage, inbreeding penalty...
 *       return { genome: mutate(childGenes), energyGiven };
 *     }
 *   }
 *
 * Nothing else in the codebase would need to change to adopt it — the
 * Simulation already programs against ReproductionStrategy, and MateSelector
 * (selection.js) already defines the preference interface.
 */
