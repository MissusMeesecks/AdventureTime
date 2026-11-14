import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * What Lumiverse refuses to load in a backend (94b-bis).
 *
 * Since its staging build of 2026-11-12 the host scans an extension's backend
 * bundle before loading it and refuses the whole extension on a hit:
 * `Extension "adventure_time" uses blocked backend capabilities: direct fetch
 * API usage` was the maintainer's install of 1.0.0-beta.23, whose backdrop
 * fetch (94b) called the runtime's own `fetch`. None of these forms has an
 * opt-in; the host's way to reach an address is `spindle.cors`, and the
 * filesystem, subprocesses, sockets, workers, SQLite, Bun's system calls and
 * `process.env` are not for an extension at all.
 *
 * The forms below are the host's own rules as its source writes them
 * (`src/spindle/manager.service.ts`, `detectDangerousBackendCapabilities`),
 * held against the bundle as `npm run build` makes it. They are stricter than
 * the host's, which skips string literals and comments: a prompt text that
 * happens to read `fetch(` fails here, which is the cheaper surprise.
 */
const BLOCKED: [label: string, pattern: RegExp][] = [
    ['a bare fetch call', /(?<![.\w$])fetch\s*(?:\?\.\s*)?\(/],
    ['fetch kept in a variable', /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*fetch\b/],
    ['fetch called through call, apply or bind', /(?<![.\w$])fetch\s*\.\s*(?:call|apply|bind)\s*\(/],
    ['fetch read off the global object', /\b(?:globalThis|global|self)\s*(?:\.\s*fetch\b|\[\s*["'`]fetch["'`]\s*\])/],
    ['fetch destructured off the global object', /\b(?:const|let|var)\s*\{[^}]*\bfetch\b[^}]*\}\s*=\s*(?:globalThis|global|self)\b/],
    ['a fetch library', /["'`](?:node-fetch|undici|cross-fetch)["'`]/],
    ['a Node or Bun system module', /(?:from\s*|require\s*\(\s*|import\s*\(\s*)["'`](?:node:)?(?:fs|fs\/promises|child_process|net|tls|dgram|http|https|worker_threads|cluster|sqlite|bun:sqlite|bun)["'`]/],
    ['a Bun system call', /\bBun\s*\.\s*(?:file|write|spawn|spawnSync|serve|connect|listen|fetch)\b/],
    ['a process call', /\bprocess\s*\.\s*(?:env|exit|kill|chdir|dlopen)\b/],
]

async function backendBundle(): Promise<string> {
    // As build.mjs builds it, in memory.
    const result = await build({
        entryPoints: ['src/backend.ts'],
        bundle: true,
        format: 'esm',
        target: 'es2022',
        platform: 'neutral',
        write: false,
        logLevel: 'silent',
    })
    return result.outputFiles[0]!.text
}

describe('the backend bundle, as the host scans it (94b-bis)', () => {
    it('holds none of the forms Lumiverse refuses to load', async () => {
        const bundle = await backendBundle()
        const hits = BLOCKED.flatMap(([label, pattern]) => {
            const match = pattern.exec(bundle)
            return match ? [`${label}: …${bundle.slice(Math.max(0, match.index - 60), match.index + 40)}…`] : []
        })
        expect(hits).toEqual([])
    }, 60_000)

    it('catches the form beta.23 shipped, so the check above is not idle', () => {
        const beta23 = "var fetchAddress = typeof globalThis.fetch === 'function' ? async (url) => { const response = await globalThis.fetch(url, { redirect: 'follow' }) } : void 0"
        expect(BLOCKED.filter(([, pattern]) => pattern.test(beta23)).map(([label]) => label)).toEqual(['fetch read off the global object'])
        // What replaced it reads no fetch at all.
        expect(BLOCKED.some(([, pattern]) => pattern.test('readCorsImage(await spindle.cors(url, { responseType: "arraybuffer" })); deps.fetch(url)'))).toBe(false)
    })
})
