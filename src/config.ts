/**
 * config.ts
 * -----------------------------------------------------------------------------
 * Central, single-source-of-truth configuration for the entire simulator, now
 * fully typed.
 *
 * Everything a user (or future developer) might reasonably want to tune lives
 * here as plain data. Systems import `DEFAULT_CONFIG`/types and never hard-code
 * magic numbers of their own. The UI mutates a *live copy* of this object at
 * runtime, so changing a value here changes the starting state of the world.
 * -----------------------------------------------------------------------------
 */

/** Specification for a single continuous, bounded gene. */
export interface GeneSpec {
  min: number;
  max: number;
  init: number;
  label: string;
  /** When false, the gene is locked and never mutates. Defaults to true. */
  mutable?: boolean;
}

/**
 * Gene definitions. Each gene is CONTINUOUS and bounded by [min, max]. `init` is
 * the founder value. Adding a brand-new trait is intentionally a single entry
 * here — genome, mutation, statistics and CSV export all iterate these keys.
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
} satisfies Record<string, GeneSpec>;

/** Union of all gene names, derived from the table above (stays in sync). */
export type GeneKey = keyof typeof GENES;

/** A full set of gene values, one number per gene. */
export type Genes = Record<GeneKey, number>;

/** Ordered list of gene keys — stable iteration / CSV columns. */
export const GENE_KEYS = Object.keys(GENES) as GeneKey[];

/**
 * The default runtime configuration. `SimConfig` is derived from this literal
 * so the type always matches the data. `main.ts` deep-clones it into a live,
 * mutable config that the UI edits without corrupting the defaults.
 */
export const DEFAULT_CONFIG = {
  // ---- Determinism -------------------------------------------------------
  seed: 1337,

  // ---- World -------------------------------------------------------------
  world: {
    width: 960,
    height: 640,
    obstacleCount: 7,
    safeZoneCount: 2,
    terrainCells: 24,
  },

  // ---- Population --------------------------------------------------------
  population: {
    initial: 60,
    cap: 600,
    minViable: 0,
  },

  // ---- Food / resources --------------------------------------------------
  food: {
    density: 0.00018,
    energyPerItem: 34,
    regenPerTick: 0.9,
    clusterOnFertile: true,
    maxItemsHardCap: 4000,
  },

  // ---- Mutation ----------------------------------------------------------
  mutation: {
    rate: 0.65,
    magnitude: 0.12,
    pBeneficial: 0.20,
    pHarmful: 0.20,
    pNeutral: 0.60,
    pMajor: 0.10,
    pDuplication: 0.04,
    pSuppression: 0.04,
    pMacro: 0.01,
    duplicationTicks: 600,
  },

  // ---- Simulation loop ---------------------------------------------------
  sim: {
    speed: 1,
    maxSpeed: 20,
    paused: false,
    statsInterval: 30,
  },

  // ---- Derived-attribute tuning coefficients -----------------------------
  // These couple genes together so every trait has a cost — the heart of the
  // "no universally optimal organism" guarantee. See organism.ts.
  physics: {
    baseSpeedPx: 3.2,
    baseMetabolism: 0.05,
    metabolismCoeffs: {
      size: 0.055,
      strength: 0.050,
      speed: 0.010,
      vision: 0.00050,
      intelligence: 0.045,
      camouflage: 0.030,
      maxEnergy: 0.00060,
      aggression: 0.020,
    },
    moveCostCoeff: 0.020,
    eatRateBase: 6,
    reproOverhead: 0.08,
    combatEnergyTransfer: 0.25,
  },
};

/** The shape of the live configuration object, derived from the defaults. */
export type SimConfig = typeof DEFAULT_CONFIG;

/**
 * Phenotype archetypes. The classifier labels each organism by whichever
 * normalised trait most exceeds the neutral midpoint. Purely descriptive (for
 * the "dominant phenotype" readout); never feeds back into selection.
 */
export const PHENOTYPES: Record<string, string> = {
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
export function cloneConfig(cfg: SimConfig = DEFAULT_CONFIG): SimConfig {
  return JSON.parse(JSON.stringify(cfg)) as SimConfig;
}
