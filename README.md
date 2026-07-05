# 🧬 Evolution Simulator

A real-time, visual evolution simulator in which populations of organisms evolve
across many generations through **mutation** and **natural selection**. Selection
is *emergent* — there is no global fitness function. Organisms that gather food
efficiently, avoid starvation, and reproduce simply leave more descendants. Every
beneficial trait carries a real biological cost, so there is **no universally
optimal organism**: speedsters, tanks, frugal foragers, and raiders can all be
viable in different niches, and the "best" strategy shifts as the world changes.

Pure client-side, zero dependencies, zero build step. Open it in a browser and
watch evolution happen.

![traits evolve, tradeoffs bind](https://img.shields.io) <!-- placeholder -->

---

## Running it

Because the app uses native ES modules, it must be served over HTTP (browsers
block `import` from `file://`). Any static server works:

```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000
```

or

```bash
npx serve .
```

No installation, bundler, or dependencies are required.

### Headless / batch mode

The entire simulation core is DOM-free and runs under Node for experiments,
tests, or data generation:

```js
import { DEFAULT_CONFIG, cloneConfig } from './src/config.js';
import { Simulation } from './src/simulation.js';

const sim = new Simulation(cloneConfig(DEFAULT_CONFIG));
for (let i = 0; i < 10000; i++) sim.step();
console.log(sim.stats.current);      // live summary
console.log(sim.stats.toCSV());      // full time-series
```

---

## What you can watch and do

**Live readouts:** population size, average fitness, every trait's average,
generation number, mutation rate, simulation speed, elapsed ticks, genetic
diversity, average lifespan, average offspring, and the current **dominant
phenotype**.

**Graphs:** population over time, all trait means (normalised), genetic
diversity, mutation frequency by type, and life-history (lifespan & offspring).
Export the entire history to **CSV** with one click.

**Controls (all live):** pause / resume / single-step, simulation speed, random
seed, population cap & initial size, food density / regen / energy, the full
mutation-parameter set, and world dimensions / obstacles / safe zones.

**Overlays:** terrain fertility, safe zones, vision radius, energy rings, age %,
fitness estimate, generation, and mutation activity.

**Organisms reflect their genes visually:** body radius = size, outline
thickness = strength, heading-whisker length = speed, desaturated colour =
camouflage, and body hue = genetic lineage (hues drift across generations so you
can literally *see* clades diverge).

---

## The tradeoff model (why nothing maxes out)

Two mechanisms guarantee a genuinely multi-peaked fitness landscape:

1. **Metabolic drain.** Nearly every gene adds to the energy an organism burns
   each tick (`Organism.metabolicRate`). Bigger, stronger, faster, smarter,
   sharper-eyed, better-camouflaged organisms all cost more to run. If they
   can't earn it back from food, they starve.

2. **Antagonistic couplings** in the derived-attribute getters:
   - `size` & `strength` reduce top **speed** (bulk is slow to move),
   - `energyEfficiency` reduces **burst speed** (endurance vs. sprint),
   - `size` & `lifespan` delay **maturation**,
   - `fertility` shortens effective **lifespan** and lowers **per-offspring
     investment** (the classic r/K quantity-vs-quality tension),
   - `aggression` is taxed every tick and only pays off when food is contested.

A headless 8,000-tick run from the default seed illustrates the point: `speed`,
`vision`, `intelligence`, and `energyEfficiency` rose under selection while
`aggression` and `maxEnergy` *fell* — the population found a fast-forager niche,
not an "everything maximised" superorganism.

---

## Architecture

The project is organised into independent systems with a strict separation
between **simulation** (state + rules) and **presentation** (rendering + DOM).
The simulation never imports the renderer, canvas, or `document`; the renderer
never mutates simulation state. This is what lets the same core run on screen or
headless.

```
index.html            Static layout; loads src/main.js as a module
styles/main.css       Dark, information-dense three-column UI

src/
  config.js           Single source of truth: gene table + all tunables (data)
  rng.js              Seedable PRNG (mulberry32) — the deterministic entry point
  utils.js            Vector math, clamping, SpatialGrid (O(neighbours) queries)
  genome.js           Heritable gene container + temporary expression modifiers
  mutation.js         Modular mutation engine (minor/major/dup/suppress/macro)
  reproduction.js     Reproduction strategies (asexual now; sexual interface ready)
  selection.js        Sexual-selection interfaces (PREPARED, inert)
  environment.js      Terrain, food, obstacles, safe zones; spatial food index
  organism.js         The agent: derived attributes (tradeoffs), behaviour, life
  simulation.js       Orchestrates all systems; one deterministic step() per tick
  statistics.js       Data collection, phenotype classification, CSV export
  renderer.js         All world drawing (canvas); reads state, never writes it
  charts.js           Minimal time-series charts for the stats panel
  ui.js               All DOM wiring; the only module that touches the document
  main.js             Bootstrap + animation loop (frames -> N sim steps)
```

### Why OOP (not ECS)?

The spec allows either, with justification. This simulator uses a **classical
object-oriented** design (an `Organism` owning a `Genome`, with systems as
separate modules) rather than an Entity-Component-System.

- **The domain has one dominant, richly-behaved entity type.** Organisms are the
  star of the show; food/obstacles are passive data. ECS shines when you have
  many entity archetypes composed from orthogonal components and systems iterating
  over component sets. Here that flexibility would be overhead without payoff.
- **Cohesion and readability.** An organism's genes, derived tradeoffs, and
  behaviour belong together conceptually; keeping them in one well-commented class
  makes the *tradeoff model* — the heart of the project — easy to read and reason
  about. That legibility matters more than raw entity throughput for a teaching /
  research tool.
- **Extension is still clean**, because behaviour that *would* benefit from
  swappability is already isolated behind interfaces: reproduction is a strategy
  object, mutation is a standalone engine, and organism decision-making lives in a
  single `decide()` method a future neural controller can replace wholesale.
- **Performance is handled where it actually matters** — spatial partitioning
  (`SpatialGrid`) for neighbour/food queries — which is orthogonal to OOP-vs-ECS
  and already gives roughly O(neighbours) instead of O(n²) scaling.

If a future version needs thousands of *interacting* entities of many kinds
(predators, prey, plants, parasites…), migrating the hot path to ECS or
struct-of-arrays would be a reasonable evolution — and the current system
boundaries are drawn so that such a change stays contained.

### Determinism

Every random draw in the simulation goes through a single seeded `RNG`
(`Math.random()` is never called in `src/`). Same seed + same sequence of user
inputs ⇒ byte-identical evolution. The headless test verifies this: two runs of
the same seed match exactly, and different seeds diverge.

---

## Genetics & mutation

Each organism carries a **genome** of twelve continuous, bounded genes
(strength, speed, size, vision, energy efficiency, max energy, reproduction
threshold, lifespan, fertility, camouflage, aggression, intelligence). Offspring
inherit the parent's base genes; each gene then mutates **independently**.
Mutation magnitude is drawn from a Gaussian, so **small mutations are common and
large ones rare**, and all values stay within configurable limits.

Mutation categories (all live, all modular in `mutation.js`):

| Type | Effect |
|------|--------|
| **Minor** | small heritable nudge (common) |
| **Major** | large heritable nudge (uncommon) |
| **Duplication** | *temporary* amplification of a gene's expression |
| **Suppression** | *temporary* reduction of a gene's expression |
| **Macro** | rare genome-wide reshuffle ("hopeful monster") |

Duplication/suppression act on a non-heritable *expression modifier* layer, so
they model transient regulatory change rather than a change to the inherited
sequence. Directional bias (beneficial / harmful / neutral probabilities) skews
only the *sign* of a mutation — mutation proposes, selection disposes.

Reserved extension points are stubbed and documented: **new-gene creation, gene
deletion, chromosomal rearrangement**.

---

## Emergent behaviour to look for

Population booms and crashes, evolutionary arms dynamics, founder effects,
genetic drift, bottlenecks (watch the diversity graph collapse then recover),
adaptive radiation, and stable polymorphisms. Crank the mutation rate for chaos;
starve the food supply to force fierce competition; enlarge the world for
allopatric drift between distant lineages.

---

## Designed for future expansion (not yet implemented)

The architecture deliberately prepares — but does not implement — the spec's
planned systems, so they can be added without a rewrite:

- **Sexual reproduction & sexual selection** (the headline future feature).
  `reproduction.js` already programs the simulation against a
  `ReproductionStrategy` interface, and `selection.js` defines a heritable,
  co-evolving `PreferenceGenome` plus a `MateSelector` scoring model — the exact
  ingredients for runaway selection (peacock tails). Both are present as
  interfaces/stubs and inert.
- **Predator/prey, speciation, ecosystem (weather/seasons/disease), and neural
  behaviour** each map onto an existing seam (environment, statistics, the
  organism's isolated `decide()` method).

See inline comments in each module for the specific extension points.

---

## Project status

All core requirements from the specification are implemented and verified:
visual real-time simulation, continuous genetics with independent mutation, the
full mutation-type set, tradeoff-driven organisms, a resource-limited
environment, emergent fitness, asexual reproduction, comprehensive statistics
with graphs and CSV export, full runtime controls, trait-reflecting
visualisation, deterministic seeded mode, and a modular architecture ready for
the planned future systems.
