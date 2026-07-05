/**
 * scripts/build-public.mjs
 * -----------------------------------------------------------------------------
 * Assembles the deployable static site into `public/` — the directory Vercel
 * serves by default. Run automatically after `tsc` by `npm run build`.
 *
 * The app is a static site whose entry (index.html) references `dist/main.js`
 * and `styles/main.css` with relative paths. We copy that tree, structure
 * preserved, into `public/` so those relative paths keep resolving:
 *
 *   public/index.html      -> loads dist/main.js  -> public/dist/main.js   ✓
 *                          -> loads styles/...    -> public/styles/...     ✓
 *
 * Local development is unaffected: you can still serve the repo root directly.
 * `public/` is purely a build artifact (git-ignored) for deployment.
 * -----------------------------------------------------------------------------
 */

import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public');

// Items that make up the static site (must all exist before this runs).
const ITEMS = ['index.html', 'dist', 'styles'];

// Start from a clean output directory each build.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const item of ITEMS) {
  const src = join(root, item);
  if (!existsSync(src)) {
    console.error(`build-public: missing "${item}" — did tsc run? Aborting.`);
    process.exit(1);
  }
  cpSync(src, join(out, item), { recursive: true });
}

console.log(`build-public: wrote ${ITEMS.join(', ')} -> public/`);
