# 🧬 Evolution Simulator

A real-time, visual evolution simulator in which populations of organisms evolve
across many generations through **mutation** and **natural selection**. Selection
is *emergent* — there is no global fitness function. Organisms that gather food
efficiently, avoid starvation, and reproduce simply leave more descendants. Every
beneficial trait carries a real biological cost, so there is **no universally
optimal organism**: speedsters, tanks, frugal foragers, and raiders can all be
viable in different niches, and the "best" strategy shifts as the world changes.

Pure client-side and framework-free. Written in **TypeScript**, compiled to
committed ES modules — so it still runs by just serving the folder (no install,
no build step to *run*). Open it in a browser and watch evolution happen.

---

## Running it

The app is written in **TypeScript** (`src/*.ts`) and compiled to plain ES
modules in `dist/`. The compiled output is committed, so **running it needs no
install and no build** — just serve the folder over HTTP (browsers block
`import` from `file://`):

```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000
```

### Developing (rebuilding from TypeScript)

Editing the `.ts` sources requires a compile. TypeScript is the only dependency:

```bash
npm install        # installs typescript
npm run build      # tsc: src/*.ts -> dist/*.js
npm run dev        # tsc --watch: rebuild on save
npm run typecheck  # type-check only, no emit
npm start          # build, then serve on :8000
```

The design intentionally keeps a **single, dependency-light toolchain** (`tsc`
only — no bundler) so the "just serve it" property survives.

### Headless / batch mode

The entire simulation core is DOM-free and runs under Node against the compiled
output for experiments, tests, or data generation:

```js
import { DEFAULT_CONFIG, cloneConfig } from './dist/config.js';
import { Simulation } from './dist/simulation.js';

const sim = new Simulation(cloneConfig(DEFAULT_CONFIG));
for (let i = 0; i < 10000; i++) sim.step();
console.log(sim.stats.current);      // live summary
console.log(sim.stats.toCSV());      // full time-series
```

## Interacting with the world

- **See the whole map at once:** the view auto-fits on load; hit **Fit** (or
  press `f`) any time to frame the entire world regardless of its size.
- **Zoom & pan:** scroll to zoom (anchored under the cursor), drag to pan, or
  use the `+` / `−` buttons. The zoom percentage is shown in the view bar.
- **Inspect & edit a single organism:** click any organism to open a live
  inspector showing its id, lineage colour, generation, offspring, energy/age
  bars, derived attributes, and mate preferences. Every gene has an **editable
  slider** — drag it to rewrite that individual's genotype in place and watch the
  change propagate. Action buttons let you **Clone** (spawn a mutated copy),
  **Energy** (refill), or **Kill** it. The panel tracks the organism as it moves
  and closes if it dies. Press `Esc` or ✕ to deselect.
- **Population tools:** spawn individuals (**Add 1** / **Add 10**) or **Cull 10%**
  from the left panel, to seed or perturb the population on demand.
- **Keyboard:** `space` pause/resume, `n` single-step, `f` fit, `+`/`−` zoom,
  `Esc` deselect.

### Sexual selection & reproduction modes

Switch **Reproduction** between *Asexual* (clone + mutate) and *Sexual* (two
parents, recombination, and **mate choice**) live from the Evolution panel — no
restart needed.

In sexual mode every organism carries a **heritable, mutable preference vector**
(what it finds attractive in a mate) and a costly **`ornament`** gene — a
peacock's-tail display that drains energy and gives *no* survival benefit.
Ready, well-fed adults actively seek the most attractive willing mate nearby; the
`MateSelector` scores candidates by how well they match the chooser's
preferences. Because preferences are inherited and co-evolve with the traits they
select for, a costly ornament can spread even while it hurts survival — **runaway
sexual selection**. Watch the *Ornament* trait average and *Ornament Preference*
readout: under natural selection alone the ornament decays toward zero; under
sexual selection it inflates. Tune **Choosiness**, **Mate Willingness**, **Mate
Search ×Vision**, and the preference-mutation sliders to make selection stronger
or weaker.

### "Fair" evolution (conserved trait budget)

Toggle **Fair evolution** to make every mutation a strict, direct tradeoff: the
mutation engine conserves a normalised **trait budget**, so any points a child
gains in one trait are taken from others. No individual can be maxed in
everything — a hard, explicit constraint layered on top of the (always-on)
metabolic tradeoffs. (Fair mode is deliberately harder to survive under; combined
with sexual reproduction it is "hard mode" — raise food density if a population
struggles.)

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
index.html            Static layout; loads dist/main.js as a module
styles/main.css       Dark, information-dense three-column UI + inspector
tsconfig.json         tsc config: src/*.ts -> dist/*.js (ESNext, strict)
package.json          Scripts (build/dev/typecheck/serve); typescript devDep

src/                  TypeScript sources
  config.ts           Single source of truth: gene table + tunables + types
  rng.ts              Seedable PRNG (mulberry32) — the deterministic entry point
  utils.ts            Geometry, clamping, generic SpatialGrid<T> (fast queries)
  genome.ts           Heritable gene container + temporary expression modifiers
  mutation.ts         Modular mutation engine (minor/major/dup/suppress/macro)
  reproduction.ts     Reproduction strategies (asexual now; sexual interface ready)
  selection.ts        Sexual-selection interfaces (PREPARED, inert)
  environment.ts      Terrain, food, obstacles, safe zones; spatial food index
  organism.ts         The agent: derived attributes (tradeoffs), behaviour, life
  simulation.ts       Orchestrates all systems; one deterministic step() per tick
  statistics.ts       Data collection, phenotype classification, CSV export
  camera.ts           Pan/zoom camera: world<->screen mapping, fit-to-view
  input.ts            Canvas interaction: pick / pan / zoom / hover intents
  renderer.ts         All world drawing (canvas) via the camera; never writes state
  charts.ts           Minimal time-series charts for the stats panel
  ui.ts               All DOM wiring: controls, inspector, view bar (only DOM module)
  main.ts             Bootstrap + animation loop (frames -> N sim steps)

dist/                 Compiled JS + source maps (committed so it runs w/o a build)
```

### Why TypeScript

The project moved from plain JS to TypeScript for the type safety that a
system with many interacting modules benefits from: the gene set is a single
`GeneKey` union derived from the config table (so a typo in a trait name is a
compile error everywhere), the per-tick `TickContext`, mutation results,
statistics summaries, and reproduction strategies are all typed contracts, and
`strict` mode is on. `tsc` compiles to committed `dist/` output, so end users
still just serve the folder — types are a *development* aid, not a runtime cost.

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

Each organism carries a **genome** of thirteen continuous, bounded genes
(strength, speed, size, vision, energy efficiency, max energy, reproduction
threshold, lifespan, fertility, camouflage, aggression, intelligence, and the
costly display gene **ornament**). Offspring inherit the parent's base genes;
each gene then mutates **independently**. Mutation magnitude is drawn from a
Gaussian, so **small mutations are common and large ones rare**, and all values
stay within configurable limits. In **fair mode** the engine additionally
conserves the trait budget across inheritance (see above).

Mutation categories (all live, all modular in `mutation.ts`):

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
remaining planned systems, so they can be added without a rewrite:

- **Sexual reproduction & sexual selection** — now *implemented* (see above):
  a live-switchable `SexualReproduction` strategy with recombination, a
  heritable co-evolving `PreferenceGenome`, and a `MateSelector` that drives mate
  choice and runaway ornament evolution. Further sexual-selection depth
  (two sexes, dominant/recessive alleles, sex-linkage, inbreeding penalties)
  slots into these same interfaces.
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
