/**
 * selection.js
 * -----------------------------------------------------------------------------
 * Sexual-selection interfaces — PREPARED, NOT ACTIVE.
 *
 * Sexual selection is the headline planned future feature. Per the spec we do
 * NOT implement it yet, but we DO define the interfaces now so that when it is
 * switched on, mating preferences can drive evolution (including runaway
 * feedback loops like the peacock's tail) without reworking the architecture.
 *
 * The core idea captured here:
 *   - Each organism will carry a `preferences` vector (one weight per
 *     evaluable trait) describing what it finds attractive in a mate.
 *   - Those preference weights are themselves HERITABLE and MUTABLE, so the
 *     preferences co-evolve with the traits they select for — the ingredient
 *     that produces runaway sexual selection.
 *   - A MateSelector scores candidates by how well they match the chooser's
 *     preferences and returns the most attractive viable mate.
 *
 * All of this is inert until a SexualReproduction strategy (see reproduction.js)
 * is wired in. `PreferenceGenome` is written so it could simply become part of
 * the Genome later.
 * -----------------------------------------------------------------------------
 */

/**
 * The set of mate-preference dimensions the design anticipates. These map to
 * observable qualities of a candidate mate. Kept as data so new preferences are
 * a one-line addition — exactly as with GENES.
 */
export const PREFERENCE_KEYS = [
  'strength',
  'speed',
  'coloration',
  'size',
  'symmetry',
  'rarity',
  'display',
  'intelligence',
  'territoryQuality',
  'age',
  'health',
  'geneticDiversity',
];

/**
 * A heritable, mutable vector of mate-preference weights in roughly [-1, 1].
 * Positive = attracted to more of that quality; negative = repelled. Neutral
 * (0) preferences are the default so that turning sexual selection on does not
 * instantly bias the population.
 */
export class PreferenceGenome {
  constructor(weights = {}) {
    this.weights = {};
    for (const key of PREFERENCE_KEYS) this.weights[key] = weights[key] ?? 0;
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
 * FUTURE/INERT: `choose()` throws today because sexual selection is not yet
 * enabled. `scoreCandidate()` is fully specified as documentation of the
 * intended attractiveness model, so the runaway-selection feedback loop is
 * unambiguous when the feature is switched on.
 */
export class MateSelector {
  constructor(rng) {
    this.rng = rng;
  }

  /**
   * Intended attractiveness scoring: dot-product of the chooser's preference
   * weights with the candidate's observable qualities. A higher score means a
   * more attractive mate. This is where a costly-but-sexy trait (e.g. a large
   * ornament) can win matings even while hurting survival.
   *
   * @param {object} _chooserPrefs - PreferenceGenome weights
   * @param {object} _candidateQualities - normalised observable trait values
   * @returns {number} attractiveness score
   */
  scoreCandidate(_chooserPrefs, _candidateQualities) {
    // Reference implementation (kept commented to avoid implying it is live):
    //   let score = 0;
    //   for (const key of PREFERENCE_KEYS)
    //     score += _chooserPrefs[key] * (_candidateQualities[key] ?? 0);
    //   return score;
    throw new Error('MateSelector.scoreCandidate: reserved for future sexual selection.');
  }

  /** Future: return the most attractive viable mate from `candidates`. */
  choose(_chooser, _candidates, _ctx) {
    throw new Error('MateSelector.choose: reserved for future sexual selection.');
  }
}
