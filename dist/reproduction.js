/**
 * reproduction.ts
 * -----------------------------------------------------------------------------
 * Reproduction strategies behind a common interface, swappable at runtime:
 *   - AsexualReproduction : clone the parent's genes, then mutate.
 *   - SexualReproduction  : find the most attractive willing mate (mate choice /
 *                           sexual selection), recombine both genomes, then
 *                           mutate.
 *
 * Both inherit and mutate the mate-preference vector, so preferences evolve in
 * either mode — but only sexual reproduction lets them actually drive who breeds,
 * which is what produces sexual selection (and runaway ornament evolution).
 * -----------------------------------------------------------------------------
 */
import { Genome } from './genome.js';
import { GENE_KEYS } from './config.js';
import { PreferenceGenome, PREFERENCE_KEYS } from './selection.js';
/** Base class documenting the contract; subclasses override both methods. */
export class ReproductionStrategy {
}
/** Shared readiness test: mature, off cooldown, and holding enough energy. */
function isReady(o) {
    return o.age >= o.maturityAge && o.reproCooldown <= 0 && o.energy >= o.reproductionThresholdEnergy;
}
/**
 * ASEXUAL reproduction. The child inherits the parent's base genes and
 * preferences, then mutation perturbs both. Higher fertility => shorter cooldown
 * but LESS energy per offspring (quantity-vs-quality tradeoff).
 */
export class AsexualReproduction extends ReproductionStrategy {
    constructor() {
        super(...arguments);
        this.kind = 'asexual';
    }
    canReproduce(o) {
        return isReady(o);
    }
    reproduce(o, ctx) {
        const { mutation, config } = ctx;
        const fertility = o.genome.expressed('fertility');
        const investFraction = 0.30 * (1.35 - 0.7 * fertility);
        const energyGiven = o.maxEnergyValue * investFraction;
        const overhead = o.maxEnergyValue * config.physics.reproOverhead;
        if (o.energy < energyGiven + overhead)
            return null;
        const { genes, modifiers, tally } = mutation.mutate(o.genome.cloneGenes());
        const childGenome = new Genome(genes);
        for (const mod of modifiers)
            childGenome.setModifier(mod.key, mod.factor, mod.ticks);
        const preferences = mutation.mutatePreferences(o.preferences);
        o.energy -= energyGiven + overhead;
        o.setReproCooldown();
        o.offspringCount++;
        return { genome: childGenome, preferences, energyGiven, tally };
    }
}
/**
 * SEXUAL reproduction. The initiator searches nearby for willing mates, the
 * MateSelector scores them by the initiator's preferences, and the most
 * attractive is chosen. Offspring genes and preferences are recombined from both
 * parents (independent assortment: each locus is inherited 50/50), then mutated.
 *
 * Both parents pay: the initiator funds the offspring's energy and takes the
 * full cooldown; the mate also takes a cooldown (shared reproductive cost).
 */
export class SexualReproduction extends ReproductionStrategy {
    constructor() {
        super(...arguments);
        this.kind = 'sexual';
        this._scratch = [];
    }
    /**
     * Sexual reproduction uses a LOWER readiness bar than asexual. Every birth
     * needs two suitable adults to coincide, which is far rarer than one adult
     * being ready; a lower threshold (and cheaper cost, below) keeps the birth
     * rate high enough to sustain a population.
     */
    canReproduce(o) {
        return o.age >= o.maturityAge && o.reproCooldown <= 0 && o.energyFraction() >= 0.5;
    }
    reproduce(o, ctx) {
        const { mutation, config, rng } = ctx;
        // Search for willing mates within an extended vision radius.
        const radius = o.visionRadius * config.reproduction.mateSearchFactor;
        const nearby = ctx.organismGrid.query(o.x, o.y, radius, this._scratch);
        const candidates = [];
        for (const c of nearby)
            if (c !== o && c.isWillingMate())
                candidates.push(c);
        if (candidates.length === 0)
            return null;
        const mate = ctx.mateSelector.choose(o, candidates);
        if (!mate)
            return null;
        // Cheaper per-birth cost than asexual (only the initiator pays, and the bar
        // to breed is lower), so sexual reproduction sustains a population.
        const fertility = o.genome.expressed('fertility');
        const investFraction = 0.22 * (1.35 - 0.7 * fertility);
        const energyGiven = o.maxEnergyValue * investFraction;
        const overhead = o.maxEnergyValue * (config.physics.reproOverhead * 0.6);
        if (o.energy < energyGiven + overhead)
            return null;
        // Recombine genes: each locus independently from one parent (Mendelian-ish).
        const childGenes = {};
        for (const key of GENE_KEYS) {
            childGenes[key] = rng.next() < 0.5 ? o.genome.genes[key] : mate.genome.genes[key];
        }
        // Recombine preferences the same way.
        const childPrefWeights = {};
        for (const key of PREFERENCE_KEYS) {
            childPrefWeights[key] = rng.next() < 0.5 ? o.preferences.weights[key] : mate.preferences.weights[key];
        }
        // Mutate the recombined genome and preferences.
        const { genes, modifiers, tally } = mutation.mutate(childGenes);
        const childGenome = new Genome(genes);
        for (const mod of modifiers)
            childGenome.setModifier(mod.key, mod.factor, mod.ticks);
        const preferences = mutation.mutatePreferences(new PreferenceGenome(childPrefWeights));
        // The initiator funds the offspring and takes the cooldown. The mate only
        // contributes genes (credited an offspring, but not put on cooldown) — this
        // keeps the effective breeding pool large enough for sexual reproduction to
        // sustain a population, rather than consuming two adults per birth.
        o.energy -= energyGiven + overhead;
        o.setReproCooldown();
        o.offspringCount++;
        mate.offspringCount++;
        return { genome: childGenome, preferences, energyGiven, tally, mateHue: mate.hue };
    }
}
//# sourceMappingURL=reproduction.js.map