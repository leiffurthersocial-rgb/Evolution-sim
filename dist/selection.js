/**
 * selection.ts
 * -----------------------------------------------------------------------------
 * Sexual-selection interfaces — PREPARED, NOT ACTIVE.
 *
 * Sexual selection is the headline planned future feature. Per the spec we do
 * NOT implement it yet, but we DO define the interfaces now so that when it is
 * switched on, mating preferences can drive evolution (including runaway
 * feedback loops like the peacock's tail) without reworking the architecture.
 *
 * Key idea captured here:
 *   - Each organism will carry a heritable, mutable `preferences` vector.
 *   - Because preferences co-evolve with the traits they select for, costly-but-
 *     sexy traits can spread even while hurting survival (runaway selection).
 *   - A MateSelector scores candidates by preference match.
 *
 * All inert until a SexualReproduction strategy (reproduction.ts) is wired in.
 * -----------------------------------------------------------------------------
 */
/** Mate-preference dimensions the design anticipates (data => easy to extend). */
export const PREFERENCE_KEYS = [
    'strength', 'speed', 'coloration', 'size', 'symmetry', 'rarity',
    'display', 'intelligence', 'territoryQuality', 'age', 'health', 'geneticDiversity',
];
/**
 * A heritable, mutable vector of mate-preference weights in roughly [-1, 1].
 * Positive = attracted to more of that quality; negative = repelled. Defaults
 * to neutral so enabling sexual selection does not instantly bias the population.
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
    clone() {
        return new PreferenceGenome({ ...this.weights });
    }
}
/**
 * MateSelector — scores and chooses mates by preference match.
 *
 * FUTURE/INERT: methods throw today. The intended attractiveness model is a
 * dot-product of the chooser's preference weights with the candidate's
 * observable qualities — where a costly ornament can win matings, producing the
 * runaway-selection feedback loop.
 */
export class MateSelector {
    constructor(rng) {
        this.rng = rng;
    }
    scoreCandidate(_chooserPrefs, _candidateQualities) {
        // Reference (kept commented to avoid implying it is live):
        //   let score = 0;
        //   for (const key of PREFERENCE_KEYS)
        //     score += _chooserPrefs[key] * (_candidateQualities[key] ?? 0);
        //   return score;
        throw new Error('MateSelector.scoreCandidate: reserved for future sexual selection.');
    }
    choose(_chooser, _candidates, _ctx) {
        throw new Error('MateSelector.choose: reserved for future sexual selection.');
    }
}
//# sourceMappingURL=selection.js.map