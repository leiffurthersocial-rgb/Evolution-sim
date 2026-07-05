/**
 * config.js
 * -----------------------------------------------------------------------------
 * Central, single-source-of-truth configuration for the entire simulator.
 *
 * Everything that a user (or a future developer) might reasonably want to tune
 * lives here as plain data. Systems import `DEFAULT_CONFIG` and never hard-code
 * magic numbers of their own. The UI mutates a *live copy* of this object at
 * runtime, so changing a value here changes the starting state of the world.
 *
 * Design intent: keeping tunables declarative (data, not code) is what makes
 * the project easy to extend. Adding a new environmental knob is a one-line
 * change here plus a slider in ui.js — no simulation rewrite required.
 * -----------------------------------------------------------------------------
 */

/**
 * Gene definitions.
 *
 * Each gene is CONTINUOUS and bounded by [min, max]. `init` is the value used
 * when seeding the very first (founder) generation. `mutable` genes participate
 * in mutation; set it false to lock a gene experimentally.
 *
 * Adding a brand-new trait to the whole simulation is intentionally a single
 * entry in this table — genome, mutation, statistics and CSV export all iterate
 * over these keys dynamically, so nothing else needs editing.
 */
export const GENES = {
  strength:              { min: 0.05, max: 1.00, init: 0.30, label: 'Strength' },
  speed:                 { min: 0.05, max: 1.00, init: 0.30, label: 'Speed' },
  size:                  { min: 0.30, max: 2.50, init: 1.00, label: 'Size' },
  vision:                { min: 10,   max: 170,  init: 55,   label: 'Vision' },
  energyEfficiency:      { min: 0.30, max: 1.60, init: 0.80, label: 'Efficiency' },
  maxEnergy:             { min: 60,   max: 420,  init: 160,  label: 'Max Energy' },
  reproductionThreshold: { min: 0.50, max: 0.95, init: 0.70, label: 'Repro Threshold' },
  lifespan:              { min: 300,  max: 4200, init: 1300, label: 'Lifespan' },
  fertility:             { min: 0.10, max: 1.00, init: 0.40, label: 'Fertility' },
  camouflage:            { min: 0.00, max: 1.00, init: 0.10, label: 'Camouflage' },
  aggression:            { min: 0.00, max: 1.00, init: 0.30, label: 'Aggression' },
  intelligence:          { min: 0.00, max: 1.00, init: 0.40, label: 'Intelligence' },
};

/** Ordered list of gene keys — handy for stable iteration / CSV columns. */
export const GENE_KEYS = Object.keys(GENES);

/**
 * The default runtime configuration. `main.js` deep-clones this into a live
 * config object that the UI can mutate without corrupting the defaults (so a
 * "Reset to defaults" always has a clean copy to fall back on).
 */
export const DEFAULT_CONFIG = {
  // ---- Determinism -------------------------------------------------------
  seed: 1337,                 // Any integer. Same seed + same inputs => same run.

  // ---- World -------------------------------------------------------------
  world: {
    width: 960,
    height: 640,
    obstacleCount: 7,         // static impassable rocks
    safeZoneCount: 2,         // zones where aggression is disabled (refuges)
    terrainCells: 24,         // resolution of the procedural terrain fertility map
  },

  // ---- Population --------------------------------------------------------
  population: {
    initial: 60,              // founders spawned on reset
    cap: 600,                 // hard ceiling; reproduction blocked above this
    minViable: 0,             // below this the run logs an extinction event
  },

  // ---- Food / resources --------------------------------------------------
  food: {
    density: 0.00018,         // target food per world pixel (scales with area)
    energyPerItem: 34,        // energy delivered by one food item
    regenPerTick: 0.9,        // expected new food items per tick (Poisson-ish)
    clusterOnFertile: true,   // bias food spawns toward fertile terrain
    maxItemsHardCap: 4000,    // safety ceiling on food entities
  },

  // ---- Mutation ----------------------------------------------------------
  // See mutation.js for how each of these is interpreted.
  mutation: {
    rate: 0.65,               // P(a given gene attempts to mutate on inheritance)
    magnitude: 0.12,          // base fraction-of-range std-dev for a minor mutation
    pBeneficial: 0.20,        // bias applied when a "directional" mutation fires
    pHarmful: 0.20,
    pNeutral: 0.60,           // (the three sum conceptually to 1; normalised at use)
    pMajor: 0.10,             // chance a mutation is "major" instead of "minor"
    pDuplication: 0.04,       // chance of a temporary gene-duplication amplification
    pSuppression: 0.04,       // chance of a temporary gene-suppression
    pMacro: 0.01,             // chance of a rare macro (whole-genome) mutation
    duplicationTicks: 600,    // how long a temporary duplication/suppression lasts
  },

  // ---- Simulation loop ---------------------------------------------------
  sim: {
    speed: 1,                 // simulation steps executed per rendered frame
    maxSpeed: 20,
    paused: false,
    statsInterval: 30,        // ticks between statistics samples
  },

  // ---- Derived-attribute tuning coefficients -----------------------------
  // These couple genes together so that every trait has a *cost*. They are the
  // heart of the "no universally optimal organism" guarantee. See organism.js.
  physics: {
    baseSpeedPx: 3.2,         // px/tick at speed gene = 1, size = 1
    baseMetabolism: 0.05,     // flat energy drain per tick
    metabolismCoeffs: {       // per-unit-of-gene energy drain per tick
      size: 0.055,
      strength: 0.050,
      speed: 0.010,           // idle upkeep; movement is charged separately
      vision: 0.00050,
      intelligence: 0.045,
      camouflage: 0.030,
      maxEnergy: 0.00060,
      aggression: 0.020,
    },
    moveCostCoeff: 0.020,     // energy per px moved, scaled by size & 1/efficiency
    eatRateBase: 6,           // energy absorbed per tick while feeding (× strength/size)
    reproOverhead: 0.08,      // fraction of maxEnergy burned as reproduction overhead
    combatEnergyTransfer: 0.25, // fraction of loser's energy stolen by winner
  },
};

/**
 * Phenotype archetypes. The classifier in statistics.js labels each organism by
 * whichever normalised trait most exceeds the population-neutral midpoint. This
 * is purely descriptive (for the "dominant phenotype" readout) and never feeds
 * back into selection.
 */
export const PHENOTYPES = {
  speed:            'Speedster',
  strength:         'Brawler',
  size:             'Giant',
  vision:           'Watcher',
  fertility:        'Breeder',
  intelligence:     'Thinker',
  energyEfficiency: 'Ascetic',
  aggression:       'Raider',
  camouflage:       'Lurker',
  _generalist:      'Generalist',
};

/** Deep-clone helper so the live config never shares references with defaults. */
export function cloneConfig(cfg = DEFAULT_CONFIG) {
  return JSON.parse(JSON.stringify(cfg));
}
