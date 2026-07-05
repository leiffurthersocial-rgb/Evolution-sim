/**
 * statistics.js
 * -----------------------------------------------------------------------------
 * Data collection and analysis, kept entirely separate from both the simulation
 * and the rendering. The Simulation feeds it a snapshot of the living population
 * at a fixed interval; Statistics turns that into time-series history, current
 * summary values, a dominant-phenotype classification, and CSV export.
 *
 * "Fitness" here is emergent and descriptive only: we report the mean of each
 * organism's own fitness *estimate* (offspring + longevity + reserve). Nothing
 * in the simulator selects on this number — it exists for the readout and graphs.
 * -----------------------------------------------------------------------------
 */

import { GENE_KEYS, GENES, PHENOTYPES } from './config.js';
import { mean, stddev, norm } from './utils.js';

/** Cap on retained history samples so long runs stay memory-bounded. */
const MAX_HISTORY = 4000;

export class Statistics {
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    /** Time-series samples, one push per sample interval. */
    this.history = {
      tick: [],
      generation: [],
      population: [],
      avgFitness: [],
      avgLifespan: [],
      avgOffspring: [],
      diversity: [],
      avgEfficiency: [],
      // per-gene mean series, keyed by gene name
      genes: Object.fromEntries(GENE_KEYS.map((k) => [k, []])),
      // mutation counts observed within each interval, keyed by type
      mutations: { minor: [], major: [], duplication: [], suppression: [], macro: [] },
    };

    /** Latest computed summary (what the live readout panel shows). */
    this.current = this.emptySummary();

    /** Discrete events (extinctions, booms) for annotation/logging. */
    this.events = [];

    /** Mutation counts accumulated since the last sample. */
    this._mutationAccum = { minor: 0, major: 0, duplication: 0, suppression: 0, macro: 0 };

    /** Rolling records of completed lives, for lifespan/offspring averages. */
    this._deaths = []; // { lifespan, offspring }
    this._deathWindow = 200;

    this._lastPopulation = 0;
  }

  emptySummary() {
    return {
      tick: 0,
      generation: 0,
      population: 0,
      avgFitness: 0,
      avgLifespan: 0,
      avgOffspring: 0,
      diversity: 0,
      avgEfficiency: 0,
      dominantPhenotype: '—',
      phenotypeCounts: {},
      genes: Object.fromEntries(GENE_KEYS.map((k) => [k, GENES[k].init])),
    };
  }

  /** Called by the simulation whenever an organism dies. */
  recordDeath(organism) {
    this._deaths.push({ lifespan: organism.age, offspring: organism.offspringCount });
    if (this._deaths.length > this._deathWindow) this._deaths.shift();
  }

  /** Called whenever a reproduction event yields a mutation tally. */
  recordMutation(tally) {
    for (const k in this._mutationAccum) this._mutationAccum[k] += tally[k] || 0;
  }

  /** Log a discrete named event at the current tick. */
  logEvent(tick, type, detail = '') {
    this.events.push({ tick, type, detail });
  }

  /**
   * Classify a single organism into a phenotype archetype: whichever "signature"
   * trait most exceeds its neutral midpoint (normalised). Returns a key from
   * PHENOTYPES, or '_generalist' if nothing stands out.
   */
  classify(organism) {
    const signatureTraits = [
      'speed', 'strength', 'size', 'vision',
      'fertility', 'intelligence', 'energyEfficiency', 'aggression', 'camouflage',
    ];
    let bestKey = '_generalist';
    let bestExcess = 0.22; // must exceed the midpoint by this margin to "count"
    for (const key of signatureTraits) {
      const g = GENES[key];
      const n = norm(organism.genome.expressed(key), g.min, g.max); // 0..1
      const excess = n - 0.5;
      if (excess > bestExcess) {
        bestExcess = excess;
        bestKey = key;
      }
    }
    return bestKey;
  }

  /**
   * Take a full sample from the living population and append to history.
   * @param {number} tick
   * @param {Array<Organism>} organisms - living organisms
   * @param {number} generation - current max/representative generation
   */
  sample(tick, organisms, generation) {
    const pop = organisms.length;
    const s = this.emptySummary();
    s.tick = tick;
    s.generation = generation;
    s.population = pop;

    if (pop > 0) {
      // Per-gene means and the material for diversity + phenotype counts.
      const geneValues = Object.fromEntries(GENE_KEYS.map((k) => [k, []]));
      const normDiversityAccum = [];
      const phenotypeCounts = {};
      let fitnessSum = 0;

      for (const o of organisms) {
        for (const k of GENE_KEYS) geneValues[k].push(o.genome.expressed(k));
        fitnessSum += o.fitnessEstimate();
        const p = this.classify(o);
        phenotypeCounts[p] = (phenotypeCounts[p] || 0) + 1;
      }

      for (const k of GENE_KEYS) {
        s.genes[k] = mean(geneValues[k]);
      }
      s.avgFitness = fitnessSum / pop;
      s.avgEfficiency = s.genes.energyEfficiency;

      // Genetic diversity = mean of per-gene normalised standard deviations.
      // 0 = clonal, higher = more spread. This is the signal that reveals
      // bottlenecks (diversity collapses) and adaptive radiations (it rises).
      let divSum = 0;
      for (const k of GENE_KEYS) {
        const g = GENES[k];
        const sd = stddev(geneValues[k]);
        divSum += sd / (g.max - g.min);
      }
      s.diversity = divSum / GENE_KEYS.length;

      // Dominant phenotype = most common archetype.
      s.phenotypeCounts = phenotypeCounts;
      let bestP = '_generalist';
      let bestN = -1;
      for (const key in phenotypeCounts) {
        if (phenotypeCounts[key] > bestN) {
          bestN = phenotypeCounts[key];
          bestP = key;
        }
      }
      s.dominantPhenotype = PHENOTYPES[bestP] || 'Generalist';
    } else {
      s.dominantPhenotype = 'Extinct';
    }

    // Averages over recently completed lives.
    if (this._deaths.length > 0) {
      s.avgLifespan = mean(this._deaths.map((d) => d.lifespan));
      s.avgOffspring = mean(this._deaths.map((d) => d.offspring));
    }

    this.current = s;
    this._pushHistory(s);

    // Detect extinction as a discrete event (population reached zero).
    if (pop === 0 && this._lastPopulation > 0) {
      this.logEvent(tick, 'extinction', 'Population reached zero');
    }
    this._lastPopulation = pop;
  }

  _pushHistory(s) {
    const h = this.history;
    h.tick.push(s.tick);
    h.generation.push(s.generation);
    h.population.push(s.population);
    h.avgFitness.push(s.avgFitness);
    h.avgLifespan.push(s.avgLifespan);
    h.avgOffspring.push(s.avgOffspring);
    h.diversity.push(s.diversity);
    h.avgEfficiency.push(s.avgEfficiency);
    for (const k of GENE_KEYS) h.genes[k].push(s.genes[k]);
    for (const k in this._mutationAccum) {
      h.mutations[k].push(this._mutationAccum[k]);
      this._mutationAccum[k] = 0; // reset the per-interval accumulator
    }

    // Trim oldest samples if we exceed the retention cap.
    if (h.tick.length > MAX_HISTORY) {
      h.tick.shift();
      h.generation.shift();
      h.population.shift();
      h.avgFitness.shift();
      h.avgLifespan.shift();
      h.avgOffspring.shift();
      h.diversity.shift();
      h.avgEfficiency.shift();
      for (const k of GENE_KEYS) h.genes[k].shift();
      for (const k in h.mutations) h.mutations[k].shift();
    }
  }

  /**
   * Build a CSV string of the full time-series history. One row per sample.
   * Columns: tick, generation, population, fitness, diversity, lifespan,
   * offspring, efficiency, every gene mean, and every mutation-type count.
   */
  toCSV() {
    const h = this.history;
    const n = h.tick.length;
    const geneCols = GENE_KEYS.map((k) => `gene_${k}`);
    const mutCols = Object.keys(h.mutations).map((k) => `mut_${k}`);
    const header = [
      'tick', 'generation', 'population', 'avgFitness', 'diversity',
      'avgLifespan', 'avgOffspring', 'avgEfficiency',
      ...geneCols, ...mutCols,
    ];
    const rows = [header.join(',')];
    for (let i = 0; i < n; i++) {
      const row = [
        h.tick[i], h.generation[i], h.population[i],
        fmt(h.avgFitness[i]), fmt(h.diversity[i]),
        fmt(h.avgLifespan[i]), fmt(h.avgOffspring[i]), fmt(h.avgEfficiency[i]),
        ...GENE_KEYS.map((k) => fmt(h.genes[k][i])),
        ...Object.keys(h.mutations).map((k) => h.mutations[k][i]),
      ];
      rows.push(row.join(','));
    }
    return rows.join('\n');
  }
}

/** Format a number to 4 significant-ish decimals for CSV, guarding NaN. */
function fmt(v) {
  if (v === undefined || v === null || Number.isNaN(v)) return '';
  return Math.round(v * 10000) / 10000;
}
