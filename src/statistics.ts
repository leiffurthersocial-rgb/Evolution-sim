/**
 * statistics.ts
 * -----------------------------------------------------------------------------
 * Data collection and analysis, separate from both simulation and rendering.
 * The Simulation feeds a snapshot of the living population at a fixed interval;
 * Statistics turns that into time-series history, a current summary, a
 * dominant-phenotype classification, and CSV export.
 *
 * "Fitness" here is emergent and descriptive only — nothing selects on it.
 * -----------------------------------------------------------------------------
 */

import { GENE_KEYS, GENES, PHENOTYPES, GeneKey, Genes, SimConfig } from './config.js';
import { mean, stddev, norm } from './utils.js';
import type { Organism } from './organism.js';
import type { MutationTally } from './mutation.js';

const MAX_HISTORY = 4000;

type MutationType = keyof MutationTally;
const MUTATION_TYPES: MutationType[] = ['minor', 'major', 'duplication', 'suppression', 'macro'];

/** A single sampled summary of the population at one point in time. */
export interface Summary {
  tick: number;
  generation: number;
  population: number;
  avgFitness: number;
  avgLifespan: number;
  avgOffspring: number;
  diversity: number;
  avgEfficiency: number;
  /** Mean heritable preference-weight for the ornament trait (sexual selection). */
  avgOrnamentPref: number;
  dominantPhenotype: string;
  phenotypeCounts: Record<string, number>;
  genes: Genes;
}

/** A discrete named event (extinction, boom, crash). */
export interface SimEvent {
  tick: number;
  type: string;
  detail: string;
}

interface History {
  tick: number[];
  generation: number[];
  population: number[];
  avgFitness: number[];
  avgLifespan: number[];
  avgOffspring: number[];
  diversity: number[];
  avgEfficiency: number[];
  genes: Record<GeneKey, number[]>;
  mutations: Record<MutationType, number[]>;
}

export class Statistics {
  history!: History;
  current!: Summary;
  events!: SimEvent[];

  private _mutationAccum!: MutationTally;
  private _deaths!: { lifespan: number; offspring: number }[];
  private _deathWindow = 200;
  private _lastPopulation = 0;

  constructor(private config: SimConfig) {
    this.reset();
  }

  reset(): void {
    this.history = {
      tick: [], generation: [], population: [], avgFitness: [],
      avgLifespan: [], avgOffspring: [], diversity: [], avgEfficiency: [],
      genes: Object.fromEntries(GENE_KEYS.map((k) => [k, []])) as unknown as Record<GeneKey, number[]>,
      mutations: Object.fromEntries(MUTATION_TYPES.map((k) => [k, []])) as unknown as Record<MutationType, number[]>,
    };
    this.current = this.emptySummary();
    this.events = [];
    this._mutationAccum = { minor: 0, major: 0, duplication: 0, suppression: 0, macro: 0 };
    this._deaths = [];
    this._lastPopulation = 0;
  }

  emptySummary(): Summary {
    return {
      tick: 0,
      generation: 0,
      population: 0,
      avgFitness: 0,
      avgLifespan: 0,
      avgOffspring: 0,
      diversity: 0,
      avgEfficiency: 0,
      avgOrnamentPref: 0,
      dominantPhenotype: '—',
      phenotypeCounts: {},
      genes: Object.fromEntries(GENE_KEYS.map((k) => [k, GENES[k].init])) as Genes,
    };
  }

  recordDeath(organism: Organism): void {
    this._deaths.push({ lifespan: organism.age, offspring: organism.offspringCount });
    if (this._deaths.length > this._deathWindow) this._deaths.shift();
  }

  recordMutation(tally: MutationTally): void {
    for (const k of MUTATION_TYPES) this._mutationAccum[k] += tally[k] || 0;
  }

  logEvent(tick: number, type: string, detail = ''): void {
    this.events.push({ tick, type, detail });
  }

  /** Classify an organism into a phenotype archetype (signature trait). */
  classify(organism: Organism): string {
    const signatureTraits: GeneKey[] = [
      'speed', 'strength', 'size', 'vision',
      'fertility', 'intelligence', 'energyEfficiency', 'aggression', 'camouflage',
    ];
    let bestKey = '_generalist';
    let bestExcess = 0.22;
    for (const key of signatureTraits) {
      const g = GENES[key];
      const n = norm(organism.genome.expressed(key), g.min, g.max);
      const excess = n - 0.5;
      if (excess > bestExcess) {
        bestExcess = excess;
        bestKey = key;
      }
    }
    return bestKey;
  }

  /** Take a full sample from the living population and append to history. */
  sample(tick: number, organisms: Organism[], generation: number): void {
    const pop = organisms.length;
    const s = this.emptySummary();
    s.tick = tick;
    s.generation = generation;
    s.population = pop;

    if (pop > 0) {
      const geneValues = Object.fromEntries(GENE_KEYS.map((k) => [k, [] as number[]])) as Record<GeneKey, number[]>;
      const phenotypeCounts: Record<string, number> = {};
      let fitnessSum = 0;
      let ornamentPrefSum = 0;

      for (const o of organisms) {
        for (const k of GENE_KEYS) geneValues[k].push(o.genome.expressed(k));
        fitnessSum += o.fitnessEstimate();
        ornamentPrefSum += o.preferences.weights.ornament;
        const p = this.classify(o);
        phenotypeCounts[p] = (phenotypeCounts[p] || 0) + 1;
      }

      for (const k of GENE_KEYS) s.genes[k] = mean(geneValues[k]);
      s.avgFitness = fitnessSum / pop;
      s.avgEfficiency = s.genes.energyEfficiency;
      s.avgOrnamentPref = ornamentPrefSum / pop;

      // Genetic diversity = mean per-gene normalised standard deviation.
      let divSum = 0;
      for (const k of GENE_KEYS) {
        const g = GENES[k];
        divSum += stddev(geneValues[k]) / (g.max - g.min);
      }
      s.diversity = divSum / GENE_KEYS.length;

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

    if (this._deaths.length > 0) {
      s.avgLifespan = mean(this._deaths.map((d) => d.lifespan));
      s.avgOffspring = mean(this._deaths.map((d) => d.offspring));
    }

    this.current = s;
    this._pushHistory(s);

    if (pop === 0 && this._lastPopulation > 0) {
      this.logEvent(tick, 'extinction', 'Population reached zero');
    }
    this._lastPopulation = pop;
  }

  private _pushHistory(s: Summary): void {
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
    for (const k of MUTATION_TYPES) {
      h.mutations[k].push(this._mutationAccum[k]);
      this._mutationAccum[k] = 0;
    }

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
      for (const k of MUTATION_TYPES) h.mutations[k].shift();
    }
  }

  /** Build a CSV string of the full time-series history (one row per sample). */
  toCSV(): string {
    const h = this.history;
    const n = h.tick.length;
    const geneCols = GENE_KEYS.map((k) => `gene_${k}`);
    const mutCols = MUTATION_TYPES.map((k) => `mut_${k}`);
    const header = [
      'tick', 'generation', 'population', 'avgFitness', 'diversity',
      'avgLifespan', 'avgOffspring', 'avgEfficiency', ...geneCols, ...mutCols,
    ];
    const rows = [header.join(',')];
    for (let i = 0; i < n; i++) {
      const row = [
        h.tick[i], h.generation[i], h.population[i],
        fmt(h.avgFitness[i]), fmt(h.diversity[i]),
        fmt(h.avgLifespan[i]), fmt(h.avgOffspring[i]), fmt(h.avgEfficiency[i]),
        ...GENE_KEYS.map((k) => fmt(h.genes[k][i])),
        ...MUTATION_TYPES.map((k) => h.mutations[k][i]),
      ];
      rows.push(row.join(','));
    }
    return rows.join('\n');
  }
}

function fmt(v: number): string | number {
  if (v === undefined || v === null || Number.isNaN(v)) return '';
  return Math.round(v * 10000) / 10000;
}
