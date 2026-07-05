/**
 * genome.ts
 * -----------------------------------------------------------------------------
 * The Genome: an organism's heritable blueprint — a bag of continuous gene
 * values bounded by config.GENES, plus temporary, non-heritable expression
 * modifiers (the mechanism behind gene duplication / suppression).
 *
 * The Genome knows nothing about environment, rendering, or mutation. Mutation
 * is applied *to* a genome by mutation.ts, keeping genetics a pure data
 * structure so future mechanics (recombination, chromosomes) are additive.
 * -----------------------------------------------------------------------------
 */
import { GENES, GENE_KEYS } from './config.js';
import { clamp } from './utils.js';
export class Genome {
    constructor(genes) {
        /**
         * Temporary multiplicative expression modifiers. Duplication => factor > 1;
         * suppression => factor < 1. They affect the *expressed* value but never the
         * base genes, so they are transient and non-heritable.
         */
        this.modifiers = {};
        this.genes = genes;
    }
    /** Build a founder genome from configured `init` values, with slight jitter. */
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
     * Expressed value = base × any active temporary modifier, re-clamped to the
     * gene's legal range. Organism derived attributes read this so that
     * duplications/suppressions actually change behaviour.
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
    /** Advance temporary modifiers by one tick, removing any that expired. */
    tickModifiers() {
        for (const key in this.modifiers) {
            const m = this.modifiers[key];
            if (--m.ticksLeft <= 0)
                delete this.modifiers[key];
        }
    }
    /** True while any temporary modifier is active (for the UI overlay). */
    hasActiveModifiers() {
        for (const _ in this.modifiers)
            return true;
        return false;
    }
}
//# sourceMappingURL=genome.js.map