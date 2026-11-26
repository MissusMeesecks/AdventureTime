/**
 * *Starting the adventure*, streamlined (Phase 98, the maintainer's ask of
 * 2026-11-17; departure 162). 83 laid the area out after Multihog's
 * onboarding page — a hero button, a box, two drawers, three dividers — and
 * what had to be done first stood last. This is the same area in setup
 * order:
 *
 *   1. Before you start — three live checks through the Lumiverse
 *      checklist's own `checklistItems()`, folding to *Ready to play*;
 *   2. Make your character — the three ways in as option cards in one
 *      style, one open at a time, Instant Action the recommended one;
 *   3. Narrator — the Narrator block, closed, optional;
 *   Learn more — one closed fold of four short parts.
 *
 * The ways in and the Narrator block are the folds the tracker panel builds
 * (handed in, not drawn again); nothing here changes what one does. The
 * whole area is still one fold, open for a chat with no memo (69).
 */
import manifest from '../../spindle.json'
import type { NarratorCardResult, StatusResult } from '../protocol.js'
import { SUMMARISER_CHECK, SUMMARYCEPTION_URL, checklistItems, type ChecklistItem } from './core-card.js'
import { createHelpTip } from './help-tip.js'

export interface StartAreaHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    /** The four ways in and the narrator's block, built by the tracker panel. */
    creator: HTMLDetailsElement
    instant: HTMLDetailsElement
    ways: HTMLElement
    importCard: HTMLElement
    narrator: HTMLDetailsElement
    /** 72b's op: an empty card under the name, or the one so named. */
    createNarratorCard(name: string): Promise<NarratorCardResult>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** Asked after a card was made or the name changed: the checks read the status again. */
    refreshStatus(): void
    fail(error: unknown): void
}

export interface StartArea {
    root: HTMLDetailsElement
    applyPrefs(prefs: Record<string, unknown>): void
    /** The panel's status, as the Lumiverse checklist is fed it: the three rows' marks and the Ready fold. */
    applyStatus(status: StatusResult | null): void
}

/** Multihog's walkthrough, as its onboarding carries it at the pin. */
export const MULTIHOG_WALKTHROUGH_URL = 'https://www.youtube.com/watch?v=82Lt9pRYFS0'
/** The Lumiverse port of Summaryception (84, the maintainer's ask): the links go there, not to the SillyTavern original. */
export { SUMMARYCEPTION_URL } from './core-card.js'
/** The guide's path in the repository; the drift check in `scripts/guide.test.ts` reads the same file. */
export const GUIDE_FILE = 'guide/AdventureTime-guide.md'
/**
 * The player's guide, the first line of *Learn more*: in the repository the
 * manifest names, so the public tree links to the public repository's copy
 * (the export writes its address into the manifest) and a fork to its own.
 */
export const GUIDE_URL = `${String(manifest.github).replace(/\/+$/, '')}/blob/main/${GUIDE_FILE}`

/**
 * Said on the document when a narrator card was made from either place that makes one (this area, the Setup & help
 * card): the backend announces nothing for it, and both places' narrator check must read again.
 */
export const NARRATOR_CARD_EVENT = 'adventuretime:narrator-card'

/** The checklist's marks (core-card.ts draws the same four). */
export const START_MARKS: Record<ChecklistItem['state'], string> = { ok: '✅', warn: '⚠️', unknown: '❔', bad: '❌' }

/** The four rows of *Before you start* (the summariser's since 1.1.2, moved out of the checklist): which checklist item, the row's name, its `[?]`, whether it counts toward Ready. */
export const START_CHECKS: ReadonlyArray<{ id: ChecklistItem['id']; title: string; help: string; counts: boolean }> = [
    { id: 'narrator', title: 'Narrator card', counts: true, help: 'AdventureTime is narrator-led play, written like a book, so several characters can share a scene. The rulebook is the whole prompt, so the card can be empty.' },
    { id: 'passes', title: 'Passes have a connection', counts: true, help: 'Every pass needs a connection. A blank row uses the narrator’s connection. A light, fast model is enough for everything but the narrator.' },
    { id: 'tools', title: 'Function calling (optional)', counts: false, help: 'The dice tool and the Map Architect need function calling on the narrator’s connection. Without it, choose "Pre-seeded queue only" for Dice (RNG) and "Text block" for How the narrator asks for a map, both on the Narrator card.' },
    { id: 'summariser', title: SUMMARISER_CHECK.title, counts: false, help: SUMMARISER_CHECK.why },
]

export const MAKE_CHARACTER_HELP = 'Each way writes a character sheet into the Tracker widget. Instant Action and the Character creator can also write a Player Card and a matching persona.'

/**
 * Ready to play: every row that counts is ✅. A narrator check that cannot
 * be read (❔, an older backend) does not hold the fold open; anything else
 * short of ✅ does. Function calling never counts.
 */
export function startReady(items: ChecklistItem[]): boolean {
    const state = (id: ChecklistItem['id']): ChecklistItem['state'] => items.find((item) => item.id === id)?.state ?? 'unknown'
    const narrator = state('narrator')
    return state('passes') === 'ok' && (narrator === 'ok' || narrator === 'unknown')
}

export const START_AREA_CSS = `
.adventuretime-panel .lh-start { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: var(--lumiverse-radius, 8px); padding: 6px 8px; margin: 6px 0; }
.adventuretime-panel .lh-start > summary { cursor: pointer; font-size: 0.95em; font-weight: 600; }
.adventuretime-panel .lh-start-body { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
/* The section names: Before you start, Make your character. */
.adventuretime-panel .lh-start-step { display: flex; align-items: center; gap: 4px; font-size: 0.72em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.8; margin-top: 4px; }
/* 1. Before you start: the check rows, folding to one line. */
.adventuretime-panel .lh-start-before > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; min-height: 28px; }
.adventuretime-panel .lh-start-before > summary::-webkit-details-marker { display: none; }
.adventuretime-panel .lh-start-before > summary .lh-start-step { margin-top: 0; }
.adventuretime-panel .lh-start-step[hidden] { display: none; }
.adventuretime-panel .lh-start-before > summary .lh-chevron { margin-left: auto; }
.adventuretime-panel .lh-start-before[open] > summary .lh-chevron { transform: rotate(45deg); }
.adventuretime-panel .lh-start-ready { font-size: 0.85em; font-weight: 600; color: var(--lumiverse-success, #8fe3c0); }
.adventuretime-panel .lh-start-ready[hidden] { display: none; }
.adventuretime-panel .lh-start-checks { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.adventuretime-panel .lh-start-check { display: grid; grid-template-columns: 1.6em minmax(0, 1fr); column-gap: 6px; row-gap: 2px; align-items: start; }
.adventuretime-panel .lh-start-check > * { grid-column: 2; min-width: 0; }
.adventuretime-panel .lh-start-check-mark { grid-column: 1; grid-row: 1; text-align: center; line-height: 1.5; }
.adventuretime-panel .lh-start-check-head { display: flex; align-items: center; gap: 4px; font-size: 0.88em; font-weight: 600; }
.adventuretime-panel .lh-start-check-evidence { font-size: 0.8em; line-height: 1.4; opacity: 0.8; }
.adventuretime-panel .lh-start-check-link { font-size: 0.8em; }
.adventuretime-panel .lh-start-check-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 2px; }
.adventuretime-panel .lh-start-check-actions .lh-input { flex: 1 1 140px; min-width: 120px; }
.adventuretime-panel .lh-start-more { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.8em; opacity: 0.9; }
.adventuretime-panel .lh-start-gm-result { font-size: 0.8em; opacity: 0.85; }
.adventuretime-panel .lh-start-gm-result:empty { display: none; }
.adventuretime-panel .lh-start-gm-result--problem { color: var(--lumiverse-danger, #ff6b6b); opacity: 1; }
/* 2 and 3. An option card: the three ways in and the Narrator block, one style. */
.adventuretime-panel .lh-start-option { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.3))); border-radius: var(--lumiverse-radius, 8px); background: var(--lh-accent-bg, rgba(127,127,127,0.05)); margin: 0; padding: 0; }
.adventuretime-panel .lh-start-option > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 10px; min-height: 28px; }
.adventuretime-panel .lh-start-option > summary::-webkit-details-marker { display: none; }
.adventuretime-panel .lh-start-option-icon { font-size: 1.1em; flex: 0 0 auto; }
.adventuretime-panel .lh-start-option-label { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.adventuretime-panel .lh-start-option-title { font-size: 0.9em; font-weight: 700; }
.adventuretime-panel .lh-start-option-sub { font-size: 0.76em; opacity: 0.7; line-height: 1.35; }
.adventuretime-panel .lh-start-option > summary .lh-chevron { flex: 0 0 auto; }
.adventuretime-panel .lh-start-option[open] > summary .lh-chevron { transform: rotate(45deg); }
.adventuretime-panel .lh-start-option > :not(summary) { margin-left: 10px; margin-right: 10px; }
.adventuretime-panel .lh-start-option > :last-child:not(summary) { margin-bottom: 10px; }
.adventuretime-panel .lh-start-option-body { display: flex; flex-direction: column; gap: 6px; }
.adventuretime-panel .lh-start-option-body > details > summary { cursor: pointer; font-size: 0.85em; font-weight: 600; line-height: 28px; }
/* 3. The Narrator block is not one of the ways in: a wider gap sets it apart. */
.adventuretime-panel .lh-start-body > .lh-narrator { margin-top: 8px; }
/* The recommended one: the accent border and the glow, which stops once the card is open. */
.adventuretime-panel .lh-start-option--recommended { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); box-shadow: 0 0 12px var(--lh-accent-bg, rgba(212, 169, 64, 0.25)); animation: lh-start-option-glow 2.8s ease-in-out infinite; }
.adventuretime-panel .lh-start-option--recommended[open] { animation: none; box-shadow: none; }
@keyframes lh-start-option-glow { 0%, 100% { box-shadow: 0 0 10px var(--lh-accent-bg, rgba(212, 169, 64, 0.22)); } 50% { box-shadow: 0 0 20px var(--lh-accent-bg, rgba(212, 169, 64, 0.4)); } }
@media (prefers-reduced-motion: reduce) { .adventuretime-panel .lh-start-option--recommended { animation: none; } }
/* Learn more. */
.adventuretime-panel .lh-start-learn > summary { cursor: pointer; font-size: 0.85em; font-weight: 600; min-height: 28px; display: flex; align-items: center; gap: 8px; list-style: none; }
.adventuretime-panel .lh-start-learn > summary::-webkit-details-marker { display: none; }
.adventuretime-panel .lh-start-learn > summary .lh-chevron { margin-left: auto; }
.adventuretime-panel .lh-start-learn[open] > summary .lh-chevron { transform: rotate(45deg); }
.adventuretime-panel .lh-start-learn-body { font-size: 0.82em; line-height: 1.45; display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.adventuretime-panel .lh-start-learn-title { font-weight: 700; margin-top: 6px; color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.adventuretime-panel .lh-start-learn-guide a { font-weight: 600; }
.adventuretime-panel .lh-start-learn-body ul { margin: 0; padding-left: 1.4em; }
.adventuretime-panel .lh-start a { color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
`

export function createStartArea(host: StartAreaHost): StartArea {
    const { el } = host
    const text = (tag: string, cls: string, content: string): HTMLElement => { const node = el(tag, cls ? { class: cls } : {}); node.textContent = content; return node }
    const link = (href: string, label: string): HTMLElement => { const a = el('a', { href, target: '_blank', rel: 'noopener noreferrer' }); a.textContent = label; return a }
    const bold = (content: string): HTMLElement => text('b', '', content)
    const para = (...parts: Array<string | HTMLElement>): HTMLElement => { const p = el('div'); p.append(...parts); return p }
    const chevron = (): HTMLElement => el('span', { class: 'lh-chevron', 'aria-hidden': 'true' })

    const root = el('details', { class: 'lh-start', 'data-lh-field': 'start-group' }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = 'Starting the adventure'
    const body = el('div', { class: 'lh-start-body' })

    // ── 1. Before you start ──────────────────────────────────────────────
    const before = el('details', { class: 'lh-start-before', 'data-lh-field': 'start-before', open: 'open' }) as HTMLDetailsElement
    const beforeSummary = el('summary')
    const beforeTitle = text('span', 'lh-start-step', 'Before you start')
    const readyLine = text('span', 'lh-start-ready', '✅ Ready to play')
    readyLine.setAttribute('data-lh-field', 'start-ready')
    readyLine.hidden = true
    beforeSummary.append(beforeTitle, readyLine, chevron())
    const checks = el('div', { class: 'lh-start-checks' })
    const rows = new Map<ChecklistItem['id'], { row: HTMLElement; mark: HTMLElement; evidence: HTMLElement }>()
    for (const check of START_CHECKS) {
        const row = el('div', { class: 'lh-start-check', 'data-lh-field': `start-check-${check.id}`, 'data-lh-state': 'unknown' })
        const mark = el('span', { class: 'lh-start-check-mark', 'aria-hidden': 'true' })
        const head = el('div', { class: 'lh-start-check-head' })
        const tip = createHelpTip(el, check.title, check.help)
        head.append(text('span', '', check.title), tip.button)
        const evidence = el('div', { class: 'lh-start-check-evidence' })
        row.append(mark, head, tip.note, evidence)
        rows.set(check.id, { row, mark, evidence })
        checks.append(row)
    }

    // The narrator row's controls: the name and 72b's op, moved here from the old Setup Guide's third step.
    const gm = el('div', { class: 'lh-start-check-actions' })
    const gmName = el('input', { type: 'text', class: 'lh-input', maxlength: '120', placeholder: 'Game Master', 'aria-label': 'Narrator card name', 'data-lh-field': 'start-narrator-name' }) as HTMLInputElement
    gmName.value = 'Game Master'
    gmName.addEventListener('change', () => {
        host.savePrefs({ narratorCardName: gmName.value.trim() || 'Game Master' }).then(() => { host.refreshStatus() }).catch(host.fail)
    })
    const gmButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'start-narrator-create' }) as HTMLButtonElement
    gmButton.textContent = 'Create narrator card'
    const gmResult = el('div', { class: 'lh-start-gm-result', 'data-lh-field': 'start-narrator-note' })
    gmButton.addEventListener('click', () => {
        gmButton.disabled = true
        gmResult.classList.remove('lh-start-gm-result--problem')
        gmResult.textContent = 'Creating the card…'
        host.createNarratorCard(gmName.value.trim() || 'Game Master')
            .then((made) => {
                gmResult.textContent = made.created
                    ? `Created the card “${made.name}”. Open a new chat from it in Lumiverse. You may need to refresh the Characters tab to see it.`
                    : `A card named “${made.name}” already exists, so nothing was created. Open a chat from it in Lumiverse.`
                host.refreshStatus()
            })
            .catch((error: unknown) => {
                gmResult.textContent = `The card could not be created: ${error instanceof Error ? error.message : String(error)}`
                gmResult.classList.add('lh-start-gm-result--problem')
                host.fail(error)
            })
            .finally(() => { gmButton.disabled = false })
    })
    gm.append(gmName, gmButton)
    rows.get('narrator')?.row.append(gm, gmResult)

    // The connection row's button: the category in the same tab, opened and scrolled to.
    const connActions = el('div', { class: 'lh-start-check-actions' })
    const connButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'start-open-connections' }) as HTMLButtonElement
    connButton.textContent = 'Open Connections & models'
    connButton.addEventListener('click', () => {
        const category = root.ownerDocument.querySelector<HTMLDetailsElement>('.lh-category[data-lh-category="connections"]')
        if (!category) return
        category.open = true
        category.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    })
    connActions.append(connButton)
    rows.get('passes')?.row.append(connActions)

    // The summariser row's link: its own page, in a new tab.
    if (SUMMARISER_CHECK.link) {
        const anchor = el('a', { class: 'lh-start-check-link', href: SUMMARISER_CHECK.link.url, target: '_blank', rel: 'noopener noreferrer', 'data-lh-field': 'start-summariser-link' })
        anchor.textContent = SUMMARISER_CHECK.link.label
        rows.get('summariser')?.row.append(anchor)
    }

    // The other checks stay in the checklist: its own button, pressed for the user.
    const more = el('div', { class: 'lh-start-more' })
    const moreButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'start-open-checklist' }) as HTMLButtonElement
    moreButton.textContent = 'Open Lumiverse checklist'
    moreButton.addEventListener('click', () => {
        root.ownerDocument.querySelector<HTMLButtonElement>('[data-lh-field="lumiverse-checklist"] button.lh-button')?.click()
    })
    more.append(text('span', '', 'More checks:'), moreButton)
    before.append(beforeSummary, checks, more)

    // ── 2. Make your character ───────────────────────────────────────────
    const makeHead = el('div', { class: 'lh-start-step', 'data-lh-field': 'start-make' })
    const makeTip = createHelpTip(el, 'Make your character', MAKE_CHARACTER_HELP)
    makeHead.append(text('span', '', 'Make your character'), makeTip.button)

    // The third option: the persona and description ways with the card import, as the old drawer held them.
    const other = el('details', { class: 'lh-start-option', 'data-lh-field': 'start-other', 'data-lh-option': 'other' }) as HTMLDetailsElement
    const otherSummary = el('summary')
    const otherIcon = text('span', 'lh-start-option-icon', '✍️')
    otherIcon.setAttribute('aria-hidden', 'true')
    const otherLabel = el('span', { class: 'lh-start-option-label' })
    otherLabel.append(text('span', 'lh-start-option-title', 'From a persona, description or card'), text('small', 'lh-start-option-sub', 'Start from your active persona, a written description, or a character card.'))
    otherSummary.append(otherIcon, otherLabel, chevron())
    const otherBody = el('div', { class: 'lh-start-option-body' })
    otherBody.append(host.ways, host.importCard)
    other.append(otherSummary, otherBody)

    // One open at a time: opening an option closes the other two, whoever opened it.
    const options = [host.instant, host.creator, other]
    for (const option of options) {
        option.addEventListener('toggle', () => {
            if (!option.open) return
            for (const sibling of options) if (sibling !== option && sibling.open) sibling.open = false
        })
    }

    // ── Learn more ───────────────────────────────────────────────────────
    const learn = el('details', { class: 'lh-start-learn', 'data-lh-field': 'start-learn' }) as HTMLDetailsElement
    const learnSummary = el('summary')
    learnSummary.append(text('span', '', 'Learn more'), chevron())
    const learnBody = el('div', { class: 'lh-start-learn-body' })
    const part = (title: string): HTMLElement => text('div', 'lh-start-learn-title', title)
    const models = el('ul')
    for (const name of ['MiMo 2.5 Pro', 'DeepSeek V4 Pro and the latest Flash', 'GPT-5.6 Luna, for its cost-efficiency; a decent model overall']) models.append(text('li', '', name))
    const guideLine = el('div', { class: 'lh-start-learn-guide', 'data-lh-field': 'start-guide-link' })
    guideLine.append(link(GUIDE_URL, 'Read the AdventureTime guide'), ': what each part does and how a turn runs.')
    learnBody.append(
        guideLine,
        part('How it works'),
        para(bold('State Tracker:'), ' reads each reply and updates the cards: HP, items, combat, time.'),
        para(bold('Lorebook Agent:'), ' writes the campaign’s people, places and events into lorebooks as the story goes. It lives in the Lore widget.'),
        para(bold('World Progression:'), ' moves the wider world on at in-world intervals. Off until you turn it on.'),
        para(bold('Map Evolution:'), ' changes mapped places while you are away.'),
        para('AdventureTime adds its rulebook to every reply. Your narrator card’s own prompt is never changed.'),
        part('Save tokens'),
        para('A summariser keeps long chats affordable. It hides older messages so the narrator sees only the last ten or so. The Lorebook Agent keeps what matters in lorebooks. Recommended: ', link(SUMMARYCEPTION_URL, 'Summaryception'), '.'),
        part('Which models'),
        para('Multihog’s author recommends trying at least these for the narrator:'),
        models,
        para('For the State Tracker and the Lorebook Agent they recommend the Gemini Flash-Lite and Flash models, with DeepSeek V4 Flash and GPT-5.6 Luna as inexpensive alternatives. These are recommendations, not rules: different models suit different styles of play.'),
        part('Video walkthrough'),
        para(link(MULTIHOG_WALKTHROUGH_URL, 'Watch the basic walkthrough'), '. It shows Multihog in SillyTavern. The pieces are the same here.'),
    )
    learn.append(learnSummary, learnBody)

    body.append(before, makeHead, makeTip.note, host.instant, host.creator, other, host.narrator, learn)
    root.append(summary, body)

    /** Whether the last status read was ready: the fold moves only when this changes, so a hand's toggle stands. */
    let ready: boolean | null = null
    const applyStatus = (status: StatusResult | null): void => {
        const items = [...checklistItems(status), SUMMARISER_CHECK]
        for (const item of items) {
            const drawn = rows.get(item.id)
            if (!drawn) continue
            drawn.mark.textContent = START_MARKS[item.state]
            drawn.evidence.textContent = item.evidence
            drawn.row.dataset.lhState = item.state
        }
        const now = startReady(items)
        if (now === ready) return
        ready = now
        readyLine.hidden = !now
        beforeTitle.hidden = now
        before.open = !now
    }
    applyStatus(null)

    return {
        root,
        applyPrefs(prefs) {
            if (typeof prefs.narratorCardName === 'string' && prefs.narratorCardName !== gmName.value) gmName.value = prefs.narratorCardName
        },
        applyStatus,
    }
}
