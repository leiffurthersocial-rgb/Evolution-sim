/**
 * mutation.ts
 * -----------------------------------------------------------------------------
 * The mutation engine. Given a parent's base genes, `mutate()` produces a NEW
 * set of genes for the child plus any temporary expression modifiers, tallying
 * which mutation types fired (for the frequency chart).
 *
 * Categories (all live, all modular):
 *   minor / major : small / large heritable Gaussian nudge
 *   duplication   : temporary amplification of a gene's expression
 *   suppression   : temporary reduction of a gene's expression
 *   macro         : rare genome-wide reshuffle ("hopeful monster")
 *
 * Directional bias skews only the SIGN of a numeric mutation toward the naive
 * benefit direction; selection still decides whether it actually helps.
 * -----------------------------------------------------------------------------
 */
import { GENES, GENE_KEYS } from './config.js';
import { clamp } from './utils.js';
/**
 * For each gene, which direction is "cheaper/more productive" in a vacuum.
 * Selection frequently overrides this — that is the point.
 */
const NAIVE_BENEFIT_DIRECTION = {
    strength: +1,
    speed: +1,
    size: -1,
    vision: +1,
    energyEfficiency: +1,
    maxEnergy: +1,
    reproductionThreshold: -1,
    lifespan: +1,
    fertility: +1,
    camouflage: +1,
    aggression: +1,
    intelligence: +1,
};
export function emptyMutationTally() {
    return { minor: 0, major: 0, duplication: 0, suppression: 0, macro: 0 };
}
export class MutationEngine {
    constructor(rng, config) {
        this.rng = rng;
        this.config = config;
    }
    /** Produce a mutated copy of `parentGenes` plus temporary modifiers. */
    mutate(parentGenes) {
        const m = this.config.mutation;
        const genes = { ...parentGenes };
        const modifiers = [];
        const tally = emptyMutationTally();
        // ---- Rare macro mutation: reshuffle a large fraction of the genome. ----
        if (this.rng.chance(m.pMacro)) {
            tally.macro++;
            for (const key of GENE_KEYS) {
                if (this.rng.chance(0.5)) {
                    const g = GENES[key];
                    genes[key] = clamp(this.rng.range(g.min, g.max), g.min, g.max);
                }
            }
        }
        // ---- Per-gene independent mutation. -----------------------------------
        for (const key of GENE_KEYS) {
            const g = GENES[key];
            if (g.mutable === false)
                continue;
            if (!this.rng.chance(m.rate))
                continue;
            const roll = this.rng.next();
            if (roll < m.pDuplication) {
                modifiers.push({ key, factor: this.rng.range(1.3, 2.0), ticks: m.duplicationTicks });
                tally.duplication++;
                continue;
            }
            if (roll < m.pDuplication + m.pSuppression) {
                modifiers.push({ key, factor: this.rng.range(0.3, 0.7), ticks: m.duplicationTicks });
                tally.suppression++;
                continue;
            }
            const isMajor = this.rng.chance(m.pMajor);
            const span = g.max - g.min;
            const std = m.magnitude * span * (isMajor ? 4 : 1);
            let delta = this.rng.gaussian(0, std);
            delta = this._applyDirectionalBias(key, delta);
            genes[key] = clamp(genes[key] + delta, g.min, g.max);
            if (isMajor)
                tally.major++;
            else
                tally.minor++;
        }
        return { genes, modifiers, tally };
    }
    /** Bias only the SIGN of a delta per beneficial/harmful/neutral probabilities. */
    _applyDirectionalBias(key, delta) {
        const m = this.config.mutation;
        const total = m.pBeneficial + m.pHarmful + m.pNeutral || 1;
        const r = this.rng.next() * total;
        const dir = NAIVE_BENEFIT_DIRECTION[key] || 1;
        const mag = Math.abs(delta);
        if (r < m.pBeneficial)
            return mag * dir;
        if (r < m.pBeneficial + m.pHarmful)
            return mag * -dir;
        return delta;
    }
    // ===========================================================================
    //  FUTURE EXTENSION POINTS (intentionally not wired into the live pipeline).
    //  Documented stubs for new-gene creation, gene deletion, and chromosomal
    //  mutation — they slot in without touching the code above.
    // ===========================================================================
    createNewGene(_genes, _spec) {
        throw new Error('createNewGene: not implemented — reserved for future work.');
    }
    deleteGene(_genes, _key) {
        throw new Error('deleteGene: not implemented — reserved for future work.');
    }
    chromosomalMutation(_genes) {
        throw new Error('chromosomalMutation: not implemented — reserved for future work.');
    }
}
//# sourceMappingURL=mutation.js.map