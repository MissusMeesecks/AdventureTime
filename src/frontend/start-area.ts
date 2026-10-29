/**
 * The starting area after Multihog's onboarding (Phase 83, the maintainer's
 * ask of 2026-10-28; 69 made it one fold, 70 put the narrator's
 * configuration in it). Multihog draws, for a chat with no sheet, a hero
 * button for the Character Creator, the Instant Action box, a drawer of the
 * other ways in, the Narrator Configuration drawer, then three dividers —
 * *How It Works*, *Need Help*, *Setup Guide* — and a shortcut to the
 * character creation connection. This is that page in AdventureTime's words:
 * the four ways in are the folds the tracker panel builds (handed in, not
 * drawn again), the texts are Multihog's facts under AdventureTime's names
 * and Lumiverse's terms, and the narrator card's row is 72b's op in the
 * place Multihog keeps it. The whole area is still one fold, *Starting the
 * Adventure*, open for a chat with no memo and folded under way (69).
 */
import type { NarratorCardResult } from '../protocol.js'

export interface StartAreaHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    /** The four ways in and the narrator's block, built by the tracker panel. */
    creator: HTMLElement
    instant: HTMLElement
    ways: HTMLElement
    importCard: HTMLElement
    narrator: HTMLElement
    /** 72b's op: an empty card under the name, or the one so named. */
    createNarratorCard(name: string): Promise<NarratorCardResult>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
}

export interface StartArea {
    root: HTMLDetailsElement
    applyPrefs(prefs: Record<string, unknown>): void
}

/** Multihog's walkthrough, as its onboarding carries it at the pin. */
export const MULTIHOG_WALKTHROUGH_URL = 'https://www.youtube.com/watch?v=82Lt9pRYFS0'
/** The Lumiverse port of Summaryception (84, the maintainer's ask): the links go there, not to the SillyTavern original. */
export const SUMMARYCEPTION_URL = 'https://github.com/Ryah/Lumi-Summaryception'

export const START_AREA_CSS = `
.adventuretime-panel .lh-start { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: var(--lumiverse-radius, 8px); padding: 6px 8px; margin: 6px 0; }
.adventuretime-panel .lh-start > summary { cursor: pointer; font-size: 0.95em; font-weight: 600; }
.adventuretime-panel .lh-start-body { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
/* The hero (Multihog's Character Creator button): the creator's fold, its summary the glowing button and the sub-line under it. */
.adventuretime-panel .lh-start-creator > summary { list-style: none; cursor: pointer; display: flex; flex-direction: column; gap: 4px; margin: 6px 0 2px; }
.adventuretime-panel .lh-start-creator > summary::-webkit-details-marker { display: none; }
.adventuretime-panel .lh-start-hero-btn { display: block; width: 100%; box-sizing: border-box; padding: 12px 16px; border-radius: 10px; text-align: center; font-size: 1.05em; font-weight: 700; letter-spacing: 0.02em; border: 1px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); background: linear-gradient(135deg, var(--lh-accent-bg, rgba(212, 169, 64, 0.22)), rgba(127, 127, 127, 0.08)); color: var(--lh-text, inherit); box-shadow: 0 0 14px var(--lh-accent-bg, rgba(212, 169, 64, 0.25)); animation: lh-start-hero-glow 2.8s ease-in-out infinite; }
.adventuretime-panel .lh-start-creator[open] > summary .lh-start-hero-btn { animation: none; }
.adventuretime-panel .lh-start-creator > summary:hover .lh-start-hero-btn { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); box-shadow: 0 0 20px var(--lh-accent-bg, rgba(212, 169, 64, 0.35)); }
@keyframes lh-start-hero-glow { 0%, 100% { box-shadow: 0 0 12px var(--lh-accent-bg, rgba(212, 169, 64, 0.22)); } 50% { box-shadow: 0 0 22px var(--lh-accent-bg, rgba(212, 169, 64, 0.4)); } }
.adventuretime-panel .lh-start-hero-sub { text-align: center; font-size: 0.78em; opacity: 0.7; font-style: italic; }
/* A drawer (Multihog's Other Ways to Begin and Narrator Configuration): the ✦, the label with its small line, the chevron. */
.adventuretime-panel .lh-start-drawer { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.3))); border-radius: var(--lumiverse-radius, 8px); background: var(--lh-accent-bg, rgba(127,127,127,0.05)); }
.adventuretime-panel .lh-start-drawer > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
.adventuretime-panel .lh-start-drawer > summary::-webkit-details-marker { display: none; }
.adventuretime-panel .lh-start-drawer-icon { color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); font-size: 1.1em; }
.adventuretime-panel .lh-start-drawer-label { flex: 1; display: flex; flex-direction: column; gap: 1px; }
.adventuretime-panel .lh-start-drawer-title { font-size: 0.82em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.adventuretime-panel .lh-start-drawer-sub, .adventuretime-panel .lh-narrator-sub { font-size: 0.75em; opacity: 0.65; }
.adventuretime-panel .lh-start-drawer-chevron { opacity: 0.6; transition: transform 0.15s ease; }
.adventuretime-panel .lh-start-drawer[open] > summary .lh-start-drawer-chevron { transform: rotate(90deg); }
/* The creator's hero and the Instant Action box fold too (84): the same right-facing chevron at the summary's right edge, turning as it opens. */
.adventuretime-panel .lh-start-fold-chevron { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); opacity: 0.6; transition: transform 0.15s ease; }
.adventuretime-panel .lh-start-hero-btn { position: relative; }
.adventuretime-panel .lh-creator[open] > summary .lh-start-fold-chevron, .adventuretime-panel .lh-instant[open] > summary .lh-start-fold-chevron { transform: translateY(-50%) rotate(90deg); }
.adventuretime-panel .lh-start-drawer-body, .adventuretime-panel .lh-narrator-body { padding: 2px 10px 8px; display: flex; flex-direction: column; gap: 4px; }
.adventuretime-panel .lh-start-drawer-body > details > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
/* The dividers and the three texts. */
.adventuretime-panel .lh-start-divider { display: flex; align-items: center; gap: 10px; margin: 10px 0 0; opacity: 0.8; }
.adventuretime-panel .lh-start-divider::before, .adventuretime-panel .lh-start-divider::after { content: ''; flex: 1; height: 1px; background: var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.3))); }
.adventuretime-panel .lh-start-divider > span { font-size: 0.7em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.75; white-space: nowrap; }
.adventuretime-panel .lh-start-note { font-size: 0.8em; line-height: 1.4; padding: 8px 10px; border-left: 3px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); background: var(--lh-accent-bg, rgba(127,127,127,0.08)); border-radius: 4px; }
.adventuretime-panel .lh-start-note > div + div { margin-top: 8px; }
.adventuretime-panel .lh-start-how { font-size: 0.82em; line-height: 1.4; display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-start-how b, .adventuretime-panel .lh-start-guide-title { color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.adventuretime-panel .lh-start-tip { padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(80, 200, 160, 0.55); background: linear-gradient(135deg, rgba(40, 160, 120, 0.2), rgba(60, 120, 200, 0.12)); font-size: 0.82em; line-height: 1.4; }
.adventuretime-panel .lh-start-tip-title { font-weight: 700; color: var(--lumiverse-success, #8fe3c0); margin-bottom: 4px; }
.adventuretime-panel .lh-start-tip ol, .adventuretime-panel .lh-start-guide ol { margin: 6px 0 0; padding-left: 1.4em; display: flex; flex-direction: column; gap: 6px; }
.adventuretime-panel .lh-start-guide { font-size: 0.82em; line-height: 1.4; display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-start-guide ul { margin: 4px 0 0; padding-left: 1.4em; }
.adventuretime-panel .lh-start-gm { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
.adventuretime-panel .lh-start-gm-label { font-weight: 700; opacity: 0.85; }
.adventuretime-panel .lh-start-gm .lh-input { flex: 1 1 140px; min-width: 120px; }
.adventuretime-panel .lh-start-gm-note { margin-top: 6px; opacity: 0.8; }
.adventuretime-panel .lh-start-gm-result { font-size: 0.95em; opacity: 0.85; }
.adventuretime-panel .lh-start-gm-result:empty { display: none; }
.adventuretime-panel .lh-start-gm-result--problem { color: var(--lumiverse-danger, #ff6b6b); opacity: 1; }
.adventuretime-panel .lh-start-companion { opacity: 0.6; cursor: not-allowed; }
.adventuretime-panel .lh-start-conn { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.3))); border-radius: var(--lumiverse-radius, 6px); padding: 8px 10px; text-align: center; }
.adventuretime-panel .lh-start-conn-title { font-weight: 600; }
.adventuretime-panel .lh-start-conn-sub { font-size: 0.78em; opacity: 0.65; margin-top: 2px; }
.adventuretime-panel .lh-start a { color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
`

export function createStartArea(host: StartAreaHost): StartArea {
    const { el } = host
    const text = (tag: string, cls: string, content: string): HTMLElement => { const node = el(tag, { class: cls }); node.textContent = content; return node }
    const link = (href: string, label: string): HTMLElement => { const a = el('a', { href, target: '_blank', rel: 'noopener noreferrer' }); a.textContent = label; return a }
    const bold = (content: string): HTMLElement => text('b', '', content)
    const para = (...parts: Array<string | HTMLElement>): HTMLElement => { const p = el('div'); p.append(...parts); return p }
    const divider = (label: string): HTMLElement => { const d = el('div', { class: 'lh-start-divider', 'data-lh-field': 'start-divider' }); d.append(text('span', '', label)); return d }

    const root = el('details', { class: 'lh-start', 'data-lh-field': 'start-group' }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = 'Starting the Adventure'
    const body = el('div', { class: 'lh-start-body' })

    // The hero: the creator's fold wears Multihog's button as its summary (creator-fold.ts draws it).
    host.creator.classList.add('lh-start-creator')

    // Other Ways to Begin: Multihog's drawer, the two folds inside it.
    const other = el('details', { class: 'lh-start-drawer', 'data-lh-field': 'start-other' }) as HTMLDetailsElement
    const otherSummary = el('summary')
    const otherIcon = text('span', 'lh-start-drawer-icon', '✦')
    otherIcon.setAttribute('aria-hidden', 'true')
    const otherLabel = el('span', { class: 'lh-start-drawer-label' })
    otherLabel.append(text('span', 'lh-start-drawer-title', 'Other Ways to Begin'), text('small', 'lh-start-drawer-sub', 'Fine-tune your start, create a Player Card, or import a character'))
    otherSummary.append(otherIcon, otherLabel, text('span', 'lh-start-drawer-chevron', '▸'))
    const otherBody = el('div', { class: 'lh-start-drawer-body' })
    otherBody.append(host.ways, host.importCard)
    other.append(otherSummary, otherBody)

    // Narrator Configuration: the tracker panel's fold (70), in the drawer's clothes.
    host.narrator.classList.add('lh-start-drawer')

    // How It Works.
    const note = el('div', { class: 'lh-start-note', 'data-lh-field': 'start-note' })
    note.append(
        para(bold('Note:'), ' AdventureTime sends its rulebook with every reply through Lumiverse’s prompt injection, so your narrator card’s own prompt stays as it is: nothing is written over, and there is nothing to restore.'),
        para('A summariser is ', bold('strongly recommended'), ' to compress the context: the narrator only needs the last ten messages or so verbatim, and the rest can be hidden away, since the Lorebook Agent (part of AdventureTime) keeps the memory in lore. Multihog’s author recommends ', link(SUMMARYCEPTION_URL, 'Summaryception'), ', linked here in its Lumiverse port.'),
    )
    const how = el('div', { class: 'lh-start-how', 'data-lh-field': 'start-how' })
    how.append(
        para(bold('Auto-Tracking:'), ' As you play, the State Tracker reads every reply in natural language — losses of HP, new loot, a fight beginning — and runs a background pass to update the state in the cards.'),
        para(bold('Prompt Injection:'), ' The memo and the dice queue are put into every outgoing prompt as the source of truth, so the narrator sees HP, inventory and mechanical outcomes as they are. Buffs and debuffs tick down with the in-story time passed. It just works.'),
        para(bold('Lorebook Agent 🤖:'), ' The Lorebook Agent tab of the second box. It manages your lorebooks on its own — creating, updating, activating, deactivating and deleting entries as the story goes; its drawers hold its settings, the campaign’s books and the terminal.'),
        para(bold('World Progression 🌍:'), ' Simulates location-scale conditions and wider currents at regular in-world intervals. It reads the complete location dossiers without the hidden maps, rotates through the least recently covered places, and writes directional prose for the narrator and the later Map Evolution passes. A World Skeleton can seed undiscovered locations and regional context; backlog consolidation compresses older reports. Its dials are the World progression category of the settings.'),
        para(bold('Map Evolution 🗺️:'), ' Makes maps and locations dynamic. Dungeons and towns evolve and spin story threads in the background, or even while you are there. Cleared half a dungeon, left, and came back? The opposition may have reinforcements or an ambush set. How often it runs is set under Persistent maps.'),
    )

    // Need Help.
    const tip = el('div', { class: 'lh-start-tip', 'data-lh-field': 'start-help' })
    tip.append(text('div', 'lh-start-tip-title', 'Need help? Try these:'))
    const tipList = el('ol')
    const tip1 = el('li'); tip1.append('Watch ', link(MULTIHOG_WALKTHROUGH_URL, 'Multihog’s basic video walkthrough'), ' to get started: it shows Multihog inside SillyTavern, and the pieces are the same here under AdventureTime’s names.')
    const tip2 = el('li')
    const companion = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-start-companion', 'data-lh-field': 'start-companion', disabled: 'true', title: 'Multihog’s help bot, with the documentation at hand. A phase to come, after the public repository is up.' }) as HTMLButtonElement
    companion.textContent = 'Adventure Companion'
    tip2.append('Talk to the ', companion, ' bot — Multihog’s, with a large document about the extension at hand. It is a phase to come here, after the public repository is up.')
    tipList.append(tip1, tip2)
    tip.append(tipList)

    // Setup Guide, with the narrator card's row (72b's op) where Multihog keeps it.
    const guide = el('div', { class: 'lh-start-guide', 'data-lh-field': 'start-guide' })
    const guideTitle = text('b', 'lh-start-guide-title', 'Initial Setup:')
    const steps = el('ol')
    const step1 = el('li'); step1.append('Pick the narrator’s connection in Lumiverse and switch ', bold('Function Calling'), ' on for it if you want the dice tool (Pre-Seeded + Tool Calls) and the default Persistent Maps opener (', bold('CreateAreaMap'), '). You can do without function calling: set the Map Architect opener to ', bold('Text command'), ' under Narrator configuration (when Persistent Maps is on), and use Pre-Seeded RNG. Persistent Maps can be turned off there too.')
    const step2 = el('li'); step2.append('Set up the connections under ', bold('Connections & models'), ' in the settings. A light, fast and cheap model does for everything but the narrator. More on that below.')
    const step3 = el('li'); step3.append('Create a narrator character card. Leave the card empty: the rulebook carries the whole prompt.')
    const gm = el('div', { class: 'lh-start-gm' })
    const gmLabel = el('label', { class: 'lh-start-gm-label', for: 'lh-start-gm-name' })
    gmLabel.textContent = 'Narrator card name'
    const gmName = el('input', { id: 'lh-start-gm-name', type: 'text', class: 'lh-input', maxlength: '120', placeholder: 'Game Master', 'data-lh-field': 'start-narrator-name' }) as HTMLInputElement
    gmName.value = 'Game Master'
    gmName.addEventListener('change', () => { host.savePrefs({ narratorCardName: gmName.value.trim() || 'Game Master' }).catch(host.fail) })
    const gmButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'start-narrator-create' }) as HTMLButtonElement
    gmButton.textContent = 'Create narrator card'
    const gmResult = el('div', { class: 'lh-start-gm-result', 'data-lh-field': 'start-narrator-note' })
    gmButton.addEventListener('click', () => {
        gmButton.disabled = true
        gmResult.classList.remove('lh-start-gm-result--problem')
        gmResult.textContent = 'Making the card…'
        host.createNarratorCard(gmName.value.trim() || 'Game Master')
            .then((made) => {
                gmResult.textContent = made.created
                    ? `Made the card “${made.name}”. Open a new chat from it in Lumiverse; the Characters tab may need a refresh to list it.`
                    : `A card named “${made.name}” already exists; nothing was made. Open a chat from it in Lumiverse.`
            })
            .catch((error: unknown) => {
                gmResult.textContent = `The card could not be made: ${error instanceof Error ? error.message : String(error)}`
                gmResult.classList.add('lh-start-gm-result--problem')
                host.fail(error)
            })
            .finally(() => { gmButton.disabled = false })
    })
    gm.append(gmLabel, gmName, gmButton)
    step3.append(gm, gmResult, text('div', 'lh-start-gm-note', 'AdventureTime, like Multihog, does not use a one-on-one chat format but one written like a book, which lets several characters share the scene. The messages come from a narrator, not a single character.'))
    const step4 = el('li'); step4.append('Use one of the ways above to roll a new character: the ', bold('Character Creator'), ' to specify it clearly, ', bold('Other Ways to Begin'), ' for a rougher description, or ', bold('Instant Action'), ' to get started quickest.')
    steps.append(step1, step2, step3, step4)
    const tokens = para('🪙 ', bold('Token Optimization:'), ' A summariser that ', bold('hides verbatim messages'), ' is essential — without one, tool use and long chats balloon the token cost. Something like ', link(SUMMARYCEPTION_URL, 'Summaryception'), ', which hides older messages so the narrator only sees the last ten turns or so verbatim, combined with the ', bold('Lorebook Agent'), ', keeps the memory in lore and summaries instead of raw chat, which keeps the model on track and the cost down.')
    const models = el('div')
    models.append('🤖 ', bold('What model to use?'), el('br'), 'Multihog’s author recommends trying at least these for the narrator:')
    const modelList = el('ul')
    for (const name of ['MiMo 2.5 Pro', 'DeepSeek V4 Pro and the latest Flash', 'GPT-5.6 Luna, for its cost-efficiency; a decent model overall']) modelList.append(text('li', '', name))
    models.append(modelList)
    const modelsNote = el('i')
    modelsNote.textContent = 'For the State Tracker and the Lorebook Agent they have recommended the Gemini Flash-Lite and Flash models, with DeepSeek V4 Flash and GPT-5.6 Luna as promising, inexpensive alternatives. Multihog’s Combat API Override — a faster model while [COMBAT] is active — has no counterpart here: the narrator’s connection is the chat’s own in Lumiverse, not AdventureTime’s to switch.'
    models.append(modelsNote, el('br'), el('br'), 'These are recommendations, not rules — experiment. Different models shine for different styles of play.')
    guide.append(guideTitle, steps, tokens, models)

    // The connection shortcut: the creator's connection is one preference, chosen under Connections & models.
    const conn = el('div', { class: 'lh-start-conn', 'data-lh-field': 'start-connection' })
    conn.append(text('div', 'lh-start-conn-title', '🔌 Character Creation Connection'), text('div', 'lh-start-conn-sub', 'Shared by the Character Creator, Instant Action and Other Ways to Begin. Pick it under Connections & models in the settings; the creator’s own row shows the same choice.'))

    body.append(host.creator, host.instant, other, host.narrator, divider('How It Works'), note, how, divider('Need Help'), tip, divider('Setup Guide'), guide, conn)
    root.append(summary, body)

    return {
        root,
        applyPrefs(prefs) {
            if (typeof prefs.narratorCardName === 'string' && prefs.narratorCardName !== gmName.value) gmName.value = prefs.narratorCardName
        },
    }
}
