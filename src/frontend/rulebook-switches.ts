/**
 * The rulebook switches.
 *
 * One row per stock section of the narrator's prompt, in the order it is
 * sent, with a switch on each. The user's own sections are marked where they
 * sit in that order — one line per run of them, not one row each. The first
 * render put all forty-four of the golden cartridge's sections in as rows, and
 * the twenty-two stock rows this editor exists for vanished between them
 * (lesson 27). Their switches live in the world-rules editor one section down;
 * a second switch here would be lesson 29. Sub-switches hang off the two
 * sections that carry them: quest deadlines and questgiver mood under
 * `<quests>`, benching under `<[PARTY]_mechanics>`.
 *
 * Two rows have no switch and say why: `relationship_tracking` follows the NPC
 * relationship bars setting, and `CYOA_mode` is an engine limit. Both are the
 * same rule as Phase 24's `engine off` row — a control that reads on and does
 * nothing is worse than none.
 *
 * The cost is stated in tokens, per row and in total. The whole rulebook is
 * roughly six thousand tokens on a factory install, and it goes with every
 * reply; a person switching sections on and off should see what each costs.
 */

import { buildRulebookView, type RulebookSettings, type RulebookViewRow } from '../tracker/rulebook.js'

export interface RulebookSwitchesHost {
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
}

export interface RulebookSwitchesEditor {
    setSettings(settings: RulebookSettings): void
    destroy(): void
}

/** A change writes the flag table and nothing else. */
export interface RulebookSwitchesChange {
    syspromptModules: Record<string, boolean>
}

const LABELS: Record<string, string> = {
    role: 'Role',
    rng_system: 'Dice and rolls',
    combat: 'Combat',
    end_of_output_footer: 'Status footer',
    quests: 'Quests',
    weapon_proficiencies: 'Weapon proficiencies',
    attacks_per_round: 'Attacks per round',
    saving_throws: 'Saving throws',
    loot: 'Loot',
    random_events: 'Random events',
    xp_system: 'XP and levelling',
    relationship_tracking: 'Relationship tracking',
    level_up_protocol: 'Level-up protocol',
    narrative: 'Narrative pacing',
    world_progression: 'World progression',
    '[PARTY]_mechanics': 'Party mechanics',
    resting: 'Resting',
    homebrew_and_custom_classes: 'Homebrew and custom classes',
    state_memo: 'Reading the state memo',
    CYOA_mode: 'CYOA mode',
    constraints: 'Constraints',
    dungeon_reality_and_hidden_mapping: 'Persistent maps',
}

export function mountRulebookSwitches(
    root: HTMLElement,
    host: RulebookSwitchesHost,
    initial: RulebookSettings,
    onChange: (change: RulebookSwitchesChange) => void,
): RulebookSwitchesEditor {
    const el = host.createElement
    let settings: RulebookSettings = { ...initial }

    const summary = el('div', { class: 'lh-rb-summary' })
    const list = el('div', { class: 'lh-rb-list' })
    root.replaceChildren(summary, list)

    function setFlag(flag: string, value: boolean): void {
        const next = { ...(settings.syspromptModules ?? {}), [flag]: value }
        settings = { ...settings, syspromptModules: next }
        onChange({ syspromptModules: next })
        render()
    }

    function renderRow(row: RulebookViewRow): HTMLElement {
        const item = el('div', {
            class: `lh-rb-row lh-rb-row--${row.kind}${row.sent ? ' lh-rb-row--sent' : ''}`,
        })
        const head = el('div', { class: 'lh-rb-head' })

        if (row.gate === 'flag') {
            const toggle = el('input', { type: 'checkbox' })
            toggle.checked = row.flag
            toggle.title = `Send <${row.tag}> to the narrator`
            toggle.addEventListener('change', () => { setFlag(row.tag, toggle.checked) })
            head.append(toggle)
        } else {
            head.append(el('span', { class: 'lh-rb-nocheck' }))
        }

        const name = el('span', { class: 'lh-rb-name' })
        name.textContent = row.kind === 'custom' ? row.tag : (LABELS[row.tag] ?? row.tag)
        head.append(name)

        if (row.gate !== 'flag') {
            const badge = el('span', { class: `lh-rb-badge lh-rb-badge--${row.gate.split(':')[0]}` })
            badge.textContent =
                row.gate === 'library' ? 'yours'
                : row.gate === 'engine' ? 'engine off'
                : 'follows NPC relationship bars'
            head.append(badge)
        } else if (row.kind === 'unlocked') {
            const badge = el('span', { class: 'lh-rb-badge lh-rb-badge--library' })
            badge.textContent = 'your override'
            head.append(badge)
        }

        const tag = el('code', { class: 'lh-rb-tag' })
        tag.textContent = `<${row.tag}>`
        tag.title = `<${row.tag}>`
        head.append(tag)

        const size = el('span', { class: 'lh-rb-size' })
        size.textContent = row.sent ? `~${row.tokens.toLocaleString()} tokens` : '—'
        head.append(size)

        item.append(head)

        if (row.children.length) {
            const subs = el('div', { class: 'lh-rb-children' })
            for (const child of row.children) {
                const label = el('label', { class: 'lh-rb-child' })
                if (child.engine) {
                    label.append(el('span', { class: 'lh-rb-nocheck' }))
                    const text = el('span')
                    text.textContent = child.label
                    label.append(text)
                    const badge = el('span', { class: 'lh-rb-badge lh-rb-badge--engine' })
                    badge.textContent = 'engine off'
                    label.append(badge)
                } else {
                    const box = el('input', { type: 'checkbox' })
                    box.checked = child.on
                    box.addEventListener('change', () => { setFlag(child.flag, box.checked) })
                    label.append(box)
                    const text = el('span')
                    text.textContent = child.label
                    label.append(text)
                }
                subs.append(label)
            }
            item.append(subs)
        }

        return item
    }

    function render(): void {
        const view = buildRulebookView(settings)
        summary.replaceChildren()

        const lead = el('div', { class: 'lh-rb-lead' })
        lead.textContent =
            'This is the rulebook the storyteller plays by — Multihog’s own rules for combat, ' +
            'resting, loot, levelling and the rest, in the order they are sent. Your own sections ' +
            'sit in their place in the same order.'
        summary.append(lead)

        const counts = el('div', { class: 'lh-rb-counts' })
        counts.textContent = `${view.counts} · About ${view.tokens.toLocaleString()} tokens go to the narrator every turn.`
        summary.append(counts)

        for (const limit of view.limits) {
            const line = el('div', { class: 'lh-rb-limit' })
            line.textContent = limit
            summary.append(line)
        }

        // A run of the user's sections collapses to one marker at its place.
        const nodes: HTMLElement[] = []
        let run: RulebookViewRow[] = []
        const flush = () => {
            if (!run.length) return
            const marker = el('div', { class: 'lh-rb-marker' })
            const names = run.map((r) => r.tag)
            const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? `, +${names.length - 3} more` : '')
            const sentTokens = run.reduce((n, r) => n + (r.sent ? r.tokens : 0), 0)
            const sentCount = run.filter((r) => r.sent).length
            marker.textContent =
                `↳ ${run.length} of your sections go here (${shown}) — ` +
                (sentCount ? `${sentCount} switched on, ~${sentTokens.toLocaleString()} tokens.` : 'none switched on.')
            marker.title = names.join(', ')
            nodes.push(marker)
            run = []
        }
        for (const row of view.rows) {
            if (row.kind === 'custom') { run.push(row); continue }
            flush()
            nodes.push(renderRow(row))
        }
        flush()
        list.replaceChildren(...nodes)
    }

    render()

    return {
        setSettings(next: RulebookSettings): void {
            settings = { ...next }
            render()
        },
        destroy(): void {
            root.replaceChildren()
        },
    }
}
