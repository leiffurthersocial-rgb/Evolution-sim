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

import type { RNG } from './rng.js';

/** Mate-preference dimensions the design anticipates (data => easy to extend). */
export const PREFERENCE_KEYS = [
  'strength', 'speed', 'coloration', 'size', 'symmetry', 'rarity',
  'display', 'intelligence', 'territoryQuality', 'age', 'health', 'geneticDiversity',
] as const;

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];
export type PreferenceWeights = Record<PreferenceKey, number>;

/**
 * A heritable, mutable vector of mate-preference weights in roughly [-1, 1].
 * Positive = attracted to more of that quality; negative = repelled. Defaults
 * to neutral so enabling sexual selection does not instantly bias the population.
 */
export class PreferenceGenome {
  weights: PreferenceWeights;

  constructor(weights: Partial<PreferenceWeights> = {}) {
    this.weights = {} as PreferenceWeights;
    for (const key of PREFERENCE_KEYS) this.weights[key] = weights[key] ?? 0;
  }

  static neutral(): PreferenceGenome {
    return new PreferenceGenome();
  }

  clone(): PreferenceGenome {
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
  constructor(private rng: RNG) {}

  scoreCandidate(_chooserPrefs: PreferenceWeights, _candidateQualities: Partial<PreferenceWeights>): number {
    // Reference (kept commented to avoid implying it is live):
    //   let score = 0;
    //   for (const key of PREFERENCE_KEYS)
    //     score += _chooserPrefs[key] * (_candidateQualities[key] ?? 0);
    //   return score;
    throw new Error('MateSelector.scoreCandidate: reserved for future sexual selection.');
  }

  choose(_chooser: unknown, _candidates: unknown[], _ctx: unknown): never {
    throw new Error('MateSelector.choose: reserved for future sexual selection.');
  }
}
