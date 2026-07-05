/**
 * mutation.js
 * -----------------------------------------------------------------------------
 * The mutation engine.
 *
 * Given a parent genome, `mutate()` produces a NEW set of base genes for the
 * child by independently considering each gene for mutation and, occasionally,
 * applying genome-wide events. Every mutation that actually fires is tallied by
 * type so statistics.js can chart mutation frequency.
 *
 * Mutation categories implemented (all live, all modular):
 *   - minor        : small Gaussian nudge (common)
 *   - major        : large Gaussian nudge (uncommon)
 *   - duplication  : temporary amplification of a gene's expression
 *   - suppression  : temporary reduction of a gene's expression
 *   - macro        : rare, reshuffles many genes at once ("hopeful monster")
 *
 * Directional bias: each numeric mutation is nudged toward "beneficial",
 * "harmful", or "neutral" per the configured probabilities. Because the sim has
 * no global fitness function, "beneficial" here simply means *toward the value
 * that is cheaper/higher-yield in isolation*; natural selection still decides
 * whether that actually helps in context. This keeps mutation honest — it can
 * propose, but only survival disposes.
 *
 * Future-mutation placeholders (new-gene creation, gene deletion, chromosomal
 * rearrangement) are stubbed at the bottom with clear extension points.
 * -----------------------------------------------------------------------------
 */

import { GENES, GENE_KEYS } from './config.js';
import { clamp } from './utils.js';

/**
 * For directional bias we need to know, for each gene, which direction is
 * "cheaper/more productive" in a vacuum. +1 means higher is naively beneficial,
 * -1 means lower is. Selection frequently overrides this — that is the point.
 */
const NAIVE_BENEFIT_DIRECTION = {
  strength: +1,
  speed: +1,
  size: -1,               // smaller is cheaper to run
  vision: +1,
  energyEfficiency: +1,   // higher efficiency = less drain
  maxEnergy: +1,
  reproductionThreshold: -1, // reproduce sooner
  lifespan: +1,
  fertility: +1,
  camouflage: +1,
  aggression: +1,
  intelligence: +1,
};

/** Tally object shape used to report which mutation types fired this event. */
export function emptyMutationTally() {
  return { minor: 0, major: 0, duplication: 0, suppression: 0, macro: 0 };
}

export class MutationEngine {
  /**
   * @param {RNG} rng
   * @param {object} config - the live config object; `config.mutation` is read
   *   fresh on every call so runtime slider changes take effect immediately.
   */
  constructor(rng, config) {
    this.rng = rng;
    this.config = config;
  }

  /**
   * Produce a mutated copy of `parentGenes` plus a list of temporary modifiers
   * to install on the child's genome.
   *
   * @param {Object<string,number>} parentGenes
   * @returns {{ genes:Object<string,number>,
   *             modifiers:Array<{key:string,factor:number,ticks:number}>,
   *             tally:object }}
   */
  mutate(parentGenes) {
    const m = this.config.mutation;
    const genes = { ...parentGenes };
    const modifiers = [];
    const tally = emptyMutationTally();

    // ---- Rare macro mutation: reshuffle a large fraction of the genome. ----
    if (this.rng.chance(m.pMacro)) {
      tally.macro++;
      for (const key of GENE_KEYS) {
        // Half the genes take a big jump toward a random point in their range.
        if (this.rng.chance(0.5)) {
          const g = GENES[key];
          const target = this.rng.range(g.min, g.max);
          genes[key] = clamp(target, g.min, g.max);
        }
      }
      // A macro event still returns here-after through the per-gene loop below
      // so it can also pick up minor tweaks; that is fine and adds variety.
    }

    // ---- Per-gene independent mutation. -----------------------------------
    for (const key of GENE_KEYS) {
      const g = GENES[key];
      if (g.mutable === false) continue;
      if (!this.rng.chance(m.rate)) continue; // this gene stays put this time

      // Decide whether this is a temporary expression event or a heritable one.
      const roll = this.rng.next();
      if (roll < m.pDuplication) {
        // Gene duplication: amplify expression temporarily (factor 1.3–2.0).
        modifiers.push({ key, factor: this.rng.range(1.3, 2.0), ticks: m.duplicationTicks });
        tally.duplication++;
        continue;
      }
      if (roll < m.pDuplication + m.pSuppression) {
        // Gene suppression: dampen expression temporarily (factor 0.3–0.7).
        modifiers.push({ key, factor: this.rng.range(0.3, 0.7), ticks: m.duplicationTicks });
        tally.suppression++;
        continue;
      }

      // Heritable numeric mutation: minor (common) or major (rarer).
      const isMajor = this.rng.chance(m.pMajor);
      const span = g.max - g.min;
      // Std-dev scales with the gene's range; major mutations are ~4× wider.
      const std = m.magnitude * span * (isMajor ? 4 : 1);
      let delta = this.rng.gaussian(0, std);

      // Apply directional bias: skew the sign of the delta.
      delta = this._applyDirectionalBias(key, delta);

      genes[key] = clamp(genes[key] + delta, g.min, g.max);
      if (isMajor) tally.major++;
      else tally.minor++;
    }

    return { genes, modifiers, tally };
  }

  /**
   * Bias the *direction* of a mutation delta according to the configured
   * beneficial/harmful/neutral probabilities. Neutral leaves the delta as-is;
   * beneficial forces it toward the naive-benefit direction; harmful forces it
   * away. Magnitude is preserved — only the sign is conditioned.
   */
  _applyDirectionalBias(key, delta) {
    const m = this.config.mutation;
    const total = m.pBeneficial + m.pHarmful + m.pNeutral || 1;
    const r = this.rng.next() * total;
    const dir = NAIVE_BENEFIT_DIRECTION[key] || 1;
    const mag = Math.abs(delta);

    if (r < m.pBeneficial) return mag * dir;              // push the "good" way
    if (r < m.pBeneficial + m.pHarmful) return mag * -dir; // push the "bad" way
    return delta;                                          // neutral: as rolled
  }

  // ===========================================================================
  //  FUTURE EXTENSION POINTS (intentionally not wired into the live pipeline).
  //  These stubs document how new-gene creation, gene deletion, and chromosomal
  //  mutation would slot in without touching the code above.
  // ===========================================================================

  /** Future: introduce an entirely new gene locus into a genome. */
  // eslint-disable-next-line no-unused-vars
  createNewGene(_genes, _spec) {
    throw new Error('createNewGene: not implemented — reserved for future work.');
  }

  /** Future: delete a gene locus entirely (loss-of-function). */
  // eslint-disable-next-line no-unused-vars
  deleteGene(_genes, _key) {
    throw new Error('deleteGene: not implemented — reserved for future work.');
  }

  /** Future: chromosomal-scale rearrangement (inversion/translocation). */
  // eslint-disable-next-line no-unused-vars
  chromosomalMutation(_genes) {
    throw new Error('chromosomalMutation: not implemented — reserved for future work.');
  }
}
