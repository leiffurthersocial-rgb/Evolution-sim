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
import { PREFERENCE_KEYS } from './selection.js';
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
    ornament: -1, // cheaper to not display (only sexual selection favours it)
};
/**
 * Genes that participate in the "fair" trait BUDGET. These are the offensive/
 * capability traits; regulatory-strategy genes (reproductionThreshold) are left
 * out. When fair mode is on, the sum of these genes' normalised values is
 * conserved across inheritance, so a child that gains in one must lose in others.
 */
const BUDGET_KEYS = [
    'strength', 'speed', 'size', 'vision', 'energyEfficiency', 'maxEnergy',
    'lifespan', 'fertility', 'camouflage', 'aggression', 'intelligence', 'ornament',
];
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
        // "Fair" mode: conserve the trait budget relative to the PARENT, so the
        // child can redistribute traits but never exceed the parent's total. Over
        // generations this keeps every lineage on a fixed "points" budget — no
        // individual is ever maxed in everything.
        if (m.fairMode)
            this._conserveBudget(parentGenes, genes);
        return { genes, modifiers, tally };
    }
    /**
     * Rescale the BUDGET_KEYS genes of `out` so their summed normalised value
     * matches that of `reference`. Uses a few clamped scaling passes, which
     * converge quickly and keep every gene inside its legal range.
     */
    _conserveBudget(reference, out) {
        const sumNorm = (genes) => {
            let s = 0;
            for (const k of BUDGET_KEYS) {
                const g = GENES[k];
                s += (genes[k] - g.min) / (g.max - g.min);
            }
            return s;
        };
        const target = sumNorm(reference);
        for (let pass = 0; pass < 4; pass++) {
            const current = sumNorm(out);
            if (current <= 1e-6 || Math.abs(current - target) < 1e-4)
                break;
            const factor = target / current;
            for (const k of BUDGET_KEYS) {
                const g = GENES[k];
                const n = clamp(((out[k] - g.min) / (g.max - g.min)) * factor, 0, 1);
                out[k] = g.min + n * (g.max - g.min);
            }
        }
    }
    /**
     * Mutate a heritable mate-preference vector (used in both reproduction modes
     * so preferences drift and can co-evolve with the traits they select for).
     */
    mutatePreferences(parent) {
        const s = this.config.sexual;
        const child = parent.clone();
        for (const key of PREFERENCE_KEYS) {
            if (this.rng.chance(s.preferenceMutationRate)) {
                child.weights[key] = clamp(child.weights[key] + this.rng.gaussian(0, s.preferenceMutationMag), -1, 1);
            }
        }
        return child;
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