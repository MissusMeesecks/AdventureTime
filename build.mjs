/**
 * Local bundler.
 *
 * Lumiverse builds extensions itself: on install it clones the repo and, if
 * there is no dist/, runs `bun build` over src/backend.ts and src/frontend.ts.
 * So dist/ is not committed, and this script is not what ships — it exists so
 * that "does this actually bundle?" is a question CI can answer before an
 * install finds out the hard way.
 *
 *   npm run build
 */

import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })

/** @type {import('esbuild').BuildOptions} */
const common = {
    bundle: true,
    format: 'esm',
    target: 'es2022',
    logLevel: 'info',
}

// The backend runs in an isolated Bun runtime and reaches the host through
// the `spindle` global, which is injected — never imported.
await build({
    ...common,
    entryPoints: ['src/backend.ts'],
    outfile: 'dist/backend.js',
    platform: 'neutral',
})

// The frontend is dynamically imported by the host, which calls its `setup`
// export, so the bundle has to keep that export.
await build({
    ...common,
    entryPoints: ['src/frontend.ts'],
    outfile: 'dist/frontend.js',
    platform: 'browser',
})
