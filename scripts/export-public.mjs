#!/usr/bin/env node
/**
 * The public tree (Phase 79, the maintainer's ask of 2026-10-27): what the
 * public repository carries, built from this one.
 *
 * The private repository keeps everything — the working rules, the plan and
 * the phase docs, the golden cartridge and its gate, the oracle, the
 * prototypes. The public one carries the extension: what Lumiverse clones and
 * builds, the unit tests that need nothing private, the licence and the
 * README. This script writes that tree from the files git tracks here, so a
 * release is a run of it into the public clone, a commit and a push — the
 * history stays here, and nothing private is ever in the public history.
 *
 *   node scripts/export-public.mjs <out-dir> [--url https://github.com/Owner/Repo] [--force]
 *
 * `--url` rewrites the two repository addresses in `spindle.json`, which is
 * where Lumiverse's Update button looks. `--force` empties a non-empty out-dir
 * first and keeps its `.git`, which is how the second and every later release
 * goes into the public clone.
 *
 * What is left out is `scripts/public-exclude.txt` (read, not remembered) and
 * every unit test that reads the golden cartridge. After writing, the tree is
 * checked for leaks: a path a rule names, the fixture by name, a test that
 * still reads it, a word of the maintainer's own from
 * `scripts/private-terms.txt` (88) — any of them fails the run, the last
 * naming the file and line of every hit.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXCLUDE_FILE = 'scripts/public-exclude.txt'
export const FIXTURE_NAME = 'golden-cartridge-v1.json'
/** The maintainer's own words (88), which no written file may hold; see the file's head. */
export const PRIVATE_TERMS_FILE = 'scripts/private-terms.txt'
/** The public tree's own workflow: the checks a contributor runs, without the fixture's hash. */
export const PUBLIC_WORKFLOW_PATH = '.github/workflows/test.yml'

/**
 * @typedef {{ raw: string, dir: boolean, path: string }} ExcludeRule
 */

/**
 * Read the rule list: comments and blank lines dropped, a trailing slash marking a folder.
 * @param {string} text
 */
export function parseExcludes(text) {
    /** @type {ExcludeRule[]} */
    const rules = []
    for (const line of text.split('\n')) {
        const raw = line.trim()
        if (!raw || raw.startsWith('#')) continue
        const dir = raw.endsWith('/')
        rules.push({ raw, dir, path: dir ? raw.slice(0, -1) : raw })
    }
    return rules
}

/**
 * The rule a path falls under, or null. Paths are repository-relative with forward slashes.
 * @param {string} path
 * @param {ExcludeRule[]} rules
 */
export function isExcluded(path, rules) {
    for (const rule of rules) {
        if (rule.dir ? (path === rule.path || path.startsWith(`${rule.path}/`)) : path === rule.path) return rule
    }
    return null
}

/**
 * @typedef {{ term: string, allowed: string[] }} PrivateTerm
 */

/**
 * Read the private terms (88): comments and blank lines dropped, `term @ path, path`
 * naming the files the term is allowed in.
 * @param {string} text
 */
export function parsePrivateTerms(text) {
    /** @type {PrivateTerm[]} */
    const terms = []
    for (const line of text.split('\n')) {
        const raw = line.trim()
        if (!raw || raw.startsWith('#')) continue
        const at = raw.indexOf(' @ ')
        const term = at >= 0 ? raw.slice(0, at).trim() : raw
        const allowed = at >= 0 ? raw.slice(at + 3).split(',').map((path) => path.trim()).filter(Boolean) : []
        if (term) terms.push({ term, allowed })
    }
    return terms
}

const WORD = /[A-Za-z0-9]/

/**
 * Every line of a file that holds a private term, whole: a letter or a digit
 * on either side of the match is not a hit, so a term `Ash` meets `Ash_NPC`
 * and not `Ashvale`, which needs its own line. Case matters.
 * @param {string} path
 * @param {string} content
 * @param {PrivateTerm[]} terms
 * @returns {Array<{ line: number, term: string }>}
 */
export function findPrivateTerms(path, content, terms) {
    /** @type {Array<{ line: number, term: string }>} */
    const hits = []
    const lines = content.split('\n')
    for (const { term, allowed } of terms) {
        if (allowed.includes(path)) continue
        for (const [i, line] of lines.entries()) {
            let from = 0
            for (;;) {
                const at = line.indexOf(term, from)
                if (at < 0) break
                from = at + 1
                const before = at > 0 ? line[at - 1] : ''
                const after = line[at + term.length] ?? ''
                if ((WORD.test(term[0]) && WORD.test(before)) || (WORD.test(term[term.length - 1]) && WORD.test(after))) continue
                hits.push({ line: i + 1, term })
                break
            }
        }
    }
    return hits
}

/**
 * A file the scan reads: text, not a picture or an archive.
 * @param {Buffer} buffer
 */
function isText(buffer) {
    return !buffer.subarray(0, 8000).includes(0)
}

/**
 * A unit test that reads the golden cartridge cannot run where the cartridge is not.
 * @param {string} path
 * @param {string} content
 */
export function readsTheFixture(path, content) {
    return /\.test\.[cm]?[jt]s$/.test(path) && content.includes(FIXTURE_NAME)
}

/** The public tree's CI: install, test, typecheck, build. */
export function publicWorkflow() {
    return [
        '# The public tree\'s checks: what a contributor runs locally, run on every push',
        '# to main and on every pull request. The suite here is the unit tests that need',
        '# nothing but the source; the differential tests against the legacy build skip',
        '# without a checkout of it (see the README).',
        '',
        'name: tests',
        '',
        'on:',
        '  push:',
        '    branches: [main]',
        '  pull_request:',
        '    branches: [main]',
        '  workflow_dispatch:',
        '',
        'jobs:',
        '  checks:',
        '    name: tests, types and both bundles',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: actions/setup-node@v4',
        '        with:',
        '          node-version: 22',
        '          cache: npm',
        '      - run: npm ci',
        '      - run: npm test',
        '      - run: npm run typecheck',
        '      - run: npm run build',
        '',
    ].join('\n')
}

/**
 * `package.json` for the public tree: the gate script goes with the gate.
 * @param {string} text
 */
export function publicPackageJson(text) {
    const pkg = JSON.parse(text)
    if (pkg.scripts && 'gate' in pkg.scripts) delete pkg.scripts.gate
    return `${JSON.stringify(pkg, null, 2)}\n`
}

/**
 * `spindle.json` for the public tree: the repository's address, when one is given.
 * @param {string} text
 * @param {string | undefined} url
 */
export function publicSpindleJson(text, url) {
    if (!url) return text
    const manifest = JSON.parse(text)
    manifest.github = url
    manifest.homepage = url
    return `${JSON.stringify(manifest, null, 4)}\n`
}

/**
 * Every file under a folder, repository-relative, `.git` and `node_modules` skipped.
 * @param {string} dir
 * @param {string} [base]
 * @param {string[]} [out]
 * @returns {string[]}
 */
function walk(dir, base = dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === '.git' || name === 'node_modules') continue
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full, base, out)
        else out.push(relative(base, full).split('\\').join('/'))
    }
    return out
}

/**
 * Write the public tree.
 *
 * @param {{ root: string, out: string, url?: string, force?: boolean }} options
 * @returns {{ written: string[], excluded: Array<[string, string]>, fixtureTests: string[], privateHits: 0 }}
 */
export function exportPublic({ root, out, url, force = false }) {
    const rootDir = resolve(root)
    const outDir = resolve(out)
    if (outDir === rootDir || rootDir.startsWith(`${outDir}/`)) {
        throw new Error('the out-dir must be outside this repository')
    }
    const rules = parseExcludes(readFileSync(join(rootDir, EXCLUDE_FILE), 'utf8'))
    const termsPath = join(rootDir, PRIVATE_TERMS_FILE)
    const terms = existsSync(termsPath) ? parsePrivateTerms(readFileSync(termsPath, 'utf8')) : []
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: rootDir, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)

    if (existsSync(outDir)) {
        const entries = readdirSync(outDir).filter((name) => name !== '.git')
        if (entries.length && !force) {
            throw new Error(`${outDir} is not empty; pass --force to replace its files (its .git is kept)`)
        }
        for (const name of entries) rmSync(join(outDir, name), { recursive: true, force: true })
    } else {
        mkdirSync(outDir, { recursive: true })
    }

    /** @type {string[]} */
    const written = []
    /** @type {Array<[string, string]>} */
    const excluded = []
    /** @type {string[]} */
    const fixtureTests = []
    for (const path of tracked) {
        const rule = isExcluded(path, rules)
        if (rule) {
            excluded.push([path, rule.raw])
            continue
        }
        const source = readFileSync(join(rootDir, path))
        const text = source.toString('utf8')
        if (readsTheFixture(path, text)) {
            fixtureTests.push(path)
            continue
        }
        let content = source
        if (path === 'package.json') content = Buffer.from(publicPackageJson(text))
        if (path === 'spindle.json') content = Buffer.from(publicSpindleJson(text, url))
        const target = join(outDir, path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content)
        written.push(path)
    }

    const workflow = join(outDir, PUBLIC_WORKFLOW_PATH)
    mkdirSync(dirname(workflow), { recursive: true })
    writeFileSync(workflow, publicWorkflow())
    written.push(PUBLIC_WORKFLOW_PATH)

    // The leak check: nothing a rule names, the fixture nowhere, no test that reads it,
    // and none of the maintainer's own words (88) in anything written.
    /** @type {string[]} */
    const privateHits = []
    for (const path of walk(outDir)) {
        if (path === PUBLIC_WORKFLOW_PATH) continue
        const rule = isExcluded(path, rules)
        if (rule) throw new Error(`leak: ${path} is in the public tree, excluded by "${rule.raw}"`)
        if (path.endsWith(FIXTURE_NAME)) throw new Error(`leak: ${path} is the golden cartridge`)
        const buffer = readFileSync(join(outDir, path))
        if (!isText(buffer)) continue
        const text = buffer.toString('utf8')
        if (readsTheFixture(path, text)) throw new Error(`leak: ${path} reads the golden cartridge`)
        for (const hit of findPrivateTerms(path, text, terms)) privateHits.push(`${path}:${hit.line} holds "${hit.term}"`)
    }
    if (privateHits.length) {
        const shown = privateHits.slice(0, 40)
        const more = privateHits.length > shown.length ? `\n  … and ${privateHits.length - shown.length} more` : ''
        throw new Error(`leak: ${privateHits.length} private term${privateHits.length === 1 ? '' : 's'} (${PRIVATE_TERMS_FILE}) in the public tree:\n  ${shown.join('\n  ')}${more}`)
    }

    return { written, excluded, fixtureTests, privateHits: 0 }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
    const args = process.argv.slice(2)
    const force = args.includes('--force')
    const urlAt = args.indexOf('--url')
    const url = urlAt >= 0 ? args[urlAt + 1] : undefined
    const out = args.find((arg, i) => !arg.startsWith('--') && (urlAt < 0 || i !== urlAt + 1))
    if (!out || (urlAt >= 0 && !url)) {
        console.error('usage: node scripts/export-public.mjs <out-dir> [--url https://github.com/Owner/Repo] [--force]')
        process.exit(2)
    }
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: 'utf8' }).trim()
    try {
        const result = exportPublic({ root, out, url, force })
        const outDir = resolve(out)
        console.log(`Wrote ${result.written.length} files to ${outDir}.`)
        console.log(`Left out by scripts/public-exclude.txt: ${result.excluded.length} files.`)
        console.log(`Left out for reading the golden cartridge: ${result.fixtureTests.length} tests.`)
        console.log(`Private terms (${PRIVATE_TERMS_FILE}) found in the tree: 0.`)
        if (!url) console.log('No --url given, so spindle.json still names the private repository; pass --url before the first push.')
        console.log('')
        console.log('Next, in the public clone:')
        console.log(`  cd ${outDir}`)
        console.log('  git init -b main            # the first time only')
        console.log('  git add -A')
        console.log('  git commit -m "AdventureTime <version>"')
        console.log('  git remote add origin <the public repository address>   # the first time only')
        console.log('  git push -u origin main')
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
    }
}
