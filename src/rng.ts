/**
 * rng.ts
 * -----------------------------------------------------------------------------
 * Deterministic pseudo-random number generation.
 *
 * The whole simulation draws randomness from a single seeded generator so that
 * a given seed + a given sequence of user inputs reproduces a run *exactly*.
 * Never call Math.random() anywhere else — always go through an RNG instance.
 *
 * Algorithm: mulberry32 — a tiny, fast, well-distributed 32-bit generator.
 * -----------------------------------------------------------------------------
 */

export class RNG {
  private _state = 1;
  private _initialSeed = 1;

  constructor(seed = 1) {
    this.seed(seed);
  }

  /** (Re)seed the generator, resetting its internal state. */
  seed(seed: number): this {
    this._state = (seed >>> 0) || 1;
    this._initialSeed = this._state;
    return this;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this._state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Random element of an array (undefined if empty). */
  pick<T>(arr: T[]): T | undefined {
    return arr.length ? arr[this.int(0, arr.length - 1)] : undefined;
  }

  /**
   * Standard normal via Box–Muller. Used by the mutation system so small
   * mutations are common and large ones rare (a Gaussian tail).
   */
  gaussian(mean = 0, std = 1): number {
    let u1 = 0;
    while (u1 === 0) u1 = this.next();
    const u2 = this.next();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    return mean + std * mag * Math.cos(2.0 * Math.PI * u2);
  }
}
