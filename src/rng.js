/**
 * rng.js
 * -----------------------------------------------------------------------------
 * Deterministic pseudo-random number generation.
 *
 * The whole simulation draws randomness from a single seeded generator so that
 * a given seed + a given sequence of user inputs reproduces a run *exactly*.
 * Never call Math.random() anywhere else in the codebase — always go through an
 * instance of RNG. That discipline is what makes the "deterministic mode"
 * requirement actually hold.
 *
 * Algorithm: mulberry32 — a tiny, fast, well-distributed 32-bit generator.
 * Good enough for a simulation; not for cryptography.
 * -----------------------------------------------------------------------------
 */

export class RNG {
  /** @param {number} seed - integer seed. */
  constructor(seed = 1) {
    this.seed(seed);
  }

  /** (Re)seed the generator, resetting its internal state. */
  seed(seed) {
    // Force to a 32-bit unsigned integer.
    this._state = (seed >>> 0) || 1;
    this._initialSeed = this._state;
    return this;
  }

  /** Uniform float in [0, 1). */
  next() {
    let t = (this._state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** Returns true with probability p. */
  chance(p) {
    return this.next() < p;
  }

  /** Random element of an array (undefined if empty). */
  pick(arr) {
    return arr.length ? arr[this.int(0, arr.length - 1)] : undefined;
  }

  /**
   * Standard normal (mean 0, std 1) via the Box–Muller transform.
   * Used heavily by the mutation system so that small mutations are common and
   * large ones rare (a Gaussian tail).
   */
  gaussian(mean = 0, std = 1) {
    // Guard against log(0).
    let u1 = 0;
    while (u1 === 0) u1 = this.next();
    const u2 = this.next();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    return mean + std * mag * Math.cos(2.0 * Math.PI * u2);
  }
}
