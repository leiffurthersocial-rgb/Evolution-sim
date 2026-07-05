/**
 * genome.js
 * -----------------------------------------------------------------------------
 * The Genome: an organism's heritable blueprint.
 *
 * A genome is fundamentally a bag of continuous gene values bounded by the
 * limits declared in config.GENES, plus a small set of *temporary expression
 * modifiers* (the mechanism behind gene duplication / suppression). The base
 * values are what gets inherited; the modifiers decay over time and are not
 * passed to offspring — they model transient regulatory changes.
 *
 * The Genome deliberately knows nothing about the environment, rendering, or
 * even mutation. Mutation is applied *to* a genome by mutation.js. This keeps
 * genetics a pure data structure and makes future genetic mechanics (sexual
 * recombination, chromosomes, gene deletion) additive rather than invasive.
 * -----------------------------------------------------------------------------
 */

import { GENES, GENE_KEYS } from './config.js';
import { clamp } from './utils.js';

export class Genome {
  /**
   * @param {Object<string,number>} genes - base gene values (already clamped).
   */
  constructor(genes) {
    /** Base heritable values, keyed by gene name. */
    this.genes = genes;

    /**
     * Temporary multiplicative expression modifiers, keyed by gene name.
     * Each entry: { factor:number, ticksLeft:number }.
     * Duplication => factor > 1 (amplified). Suppression => factor < 1.
     * These affect the *expressed* value (see expressed()) but never the base
     * genes, so they are transient and non-heritable.
     */
    this.modifiers = {};
  }

  /**
   * Build a founder genome from the configured `init` values, with a small
   * random jitter so the initial population is not perfectly clonal.
   * @param {RNG} rng
   */
  static founder(rng) {
    const genes = {};
    for (const key of GENE_KEYS) {
      const g = GENES[key];
      const jitter = rng.gaussian(0, 0.05) * (g.max - g.min);
      genes[key] = clamp(g.init + jitter, g.min, g.max);
    }
    return new Genome(genes);
  }

  /** Deep copy of just the heritable base genes (modifiers are NOT inherited). */
  cloneGenes() {
    return { ...this.genes };
  }

  /**
   * Expressed value of a gene = base value × any active temporary modifier,
   * re-clamped to the gene's legal range. This is what the organism's derived
   * attributes should read, so that duplications/suppressions actually matter.
   */
  expressed(key) {
    const base = this.genes[key];
    const mod = this.modifiers[key];
    const value = mod ? base * mod.factor : base;
    const g = GENES[key];
    return clamp(value, g.min, g.max);
  }

  /** Apply (or replace) a temporary expression modifier on a gene. */
  setModifier(key, factor, ticks) {
    this.modifiers[key] = { factor, ticksLeft: ticks };
  }

  /**
   * Advance temporary modifiers by one tick, removing any that have expired.
   * Called once per organism update.
   */
  tickModifiers() {
    for (const key in this.modifiers) {
      const m = this.modifiers[key];
      if (--m.ticksLeft <= 0) delete this.modifiers[key];
    }
  }

  /** True while any temporary modifier is active (used for the UI overlay). */
  hasActiveModifiers() {
    for (const _ in this.modifiers) return true;
    return false;
  }
}
