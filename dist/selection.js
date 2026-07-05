/**
 * selection.ts
 * -----------------------------------------------------------------------------
 * Sexual selection — now ACTIVE.
 *
 * Each organism carries a heritable, mutable PreferenceGenome: a vector of
 * weights describing what it finds attractive in a mate. Because preferences are
 * inherited and co-evolve with the traits they select for, a costly-but-sexy
 * trait (the `ornament` gene — a peacock's tail) can spread through the
 * population even while it hurts survival. That feedback loop is runaway sexual
 * selection, and it is what the MateSelector below makes possible.
 *
 * The `SexualReproduction` strategy in reproduction.ts consults a MateSelector
 * to pick the most attractive willing partner; this file defines the preference
 * vector, how a candidate's observable qualities are computed, and the scoring.
 * -----------------------------------------------------------------------------
 */
import { GENE_KEYS, GENES } from './config.js';
import { clamp, norm } from './utils.js';
/**
 * Mate-preference dimensions. Each maps to an observable quality of a candidate
 * (see `candidateQualities`). Data-driven, so adding a preference is one entry
 * plus its quality computation.
 */
export const PREFERENCE_KEYS = [
    'ornament', // the costly display trait
    'size',
    'speed',
    'strength',
    'intelligence',
    'coloration', // brightness (inverse of camouflage)
    'health', // current energy reserve
    'age', // proven survivor
    'diversity', // genetic dissimilarity to the chooser (outbreeding)
];
/**
 * A heritable, mutable vector of mate-preference weights in [-1, 1]. Positive =
 * attracted to more of that quality; negative = repelled; 0 = indifferent.
 */
export class PreferenceGenome {
    constructor(weights = {}) {
        this.weights = {};
        for (const key of PREFERENCE_KEYS)
            this.weights[key] = weights[key] ?? 0;
    }
    static neutral() {
        return new PreferenceGenome();
    }
    /** Founders start with small random preferences so selection has variation. */
    static random(rng) {
        const w = {};
        for (const key of PREFERENCE_KEYS)
            w[key] = clamp(rng.gaussian(0, 0.15), -1, 1);
        return new PreferenceGenome(w);
    }
    clone() {
        return new PreferenceGenome({ ...this.weights });
    }
}
/**
 * Compute a candidate's observable qualities in [0,1], as seen by `chooser`.
 * (The `diversity` quality is relative — genetic distance from the chooser.)
 */
export function candidateQualities(candidate, chooser) {
    const g = (k) => norm(candidate.genome.expressed(k), GENES[k].min, GENES[k].max);
    let geneticDistance = 0;
    for (const k of GENE_KEYS) {
        const spec = GENES[k];
        const a = norm(candidate.genome.expressed(k), spec.min, spec.max);
        const b = norm(chooser.genome.expressed(k), spec.min, spec.max);
        geneticDistance += Math.abs(a - b);
    }
    geneticDistance /= GENE_KEYS.length;
    return {
        ornament: g('ornament'),
        size: g('size'),
        speed: g('speed'),
        strength: g('strength'),
        intelligence: g('intelligence'),
        coloration: 1 - g('camouflage'),
        health: candidate.energyFraction(),
        age: candidate.ageFraction(),
        diversity: clamp(geneticDistance * 2, 0, 1), // scale so typical distances span the range
    };
}
/**
 * MateSelector — scores candidates by how well they match the chooser's
 * preferences and returns the most attractive willing partner.
 */
export class MateSelector {
    constructor(rng, choosiness = 1) {
        this.rng = rng;
        this.choosiness = choosiness;
    }
    setChoosiness(c) {
        this.choosiness = c;
    }
    /**
     * Attractiveness = Σ preferenceWeight × (quality centred to [-1,1]), scaled by
     * choosiness. A strong preference for a high-quality trait yields a high score;
     * this is the channel through which a costly ornament can win matings.
     */
    scoreCandidate(prefs, qualities) {
        let score = 0;
        for (const key of PREFERENCE_KEYS) {
            score += prefs[key] * (qualities[key] - 0.5) * 2;
        }
        return score * this.choosiness;
    }
    /**
     * Choose the most attractive willing mate from `candidates` (excluding the
     * chooser). A little noise keeps mate choice from being perfectly greedy.
     * Returns null if there is no suitable partner.
     */
    choose(chooser, candidates) {
        let best = null;
        let bestScore = -Infinity;
        for (const c of candidates) {
            if (c === chooser || !c.alive)
                continue;
            const score = this.scoreCandidate(chooser.preferences.weights, candidateQualities(c, chooser)) +
                this.rng.gaussian(0, 0.15);
            if (score > bestScore) {
                bestScore = score;
                best = c;
            }
        }
        return best;
    }
}
//# sourceMappingURL=selection.js.map