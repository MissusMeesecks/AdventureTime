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

/** The stock sections' names on screen, in the order they are sent. The guide lists them all, and its test holds the list to this. */
export const RULEBOOK_SECTION_LABELS: Record<string, string> = {
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
    world_progression: 'World Progression',
    '[PARTY]_mechanics': 'Party mechanics',
    resting: 'Resting',
    homebrew_and_custom_classes: 'Homebrew and custom classes',
    state_memo: 'State memo reading',
    CYOA_mode: 'CYOA mode',
    constraints: 'Constraints',
    dungeon_reality_and_hidden_mapping: 'Persistent maps',
}

/** A unique id for a switch, so its name can be its label (91): the words are the hit area a thumb needs. */
let switches = 0
const switchId = (): string => `lh-rb-switch-${++switches}`

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

        // The name is the switch's label (91): the words are the hit area, as on the sub-switches below.
        const name = el(row.gate === 'flag' ? 'label' : 'span', { class: 'lh-rb-name' })
        if (row.gate === 'flag') {
            const toggle = el('input', { type: 'checkbox', id: switchId() })
            toggle.checked = row.flag
            // The row's name is the switch's label and its code tag tells the rows apart.
            toggle.title = 'Send this section to the narrator'
            toggle.addEventListener('change', () => { setFlag(row.tag, toggle.checked) })
            head.append(toggle)
            name.setAttribute('for', toggle.id)
        } else {
            head.append(el('span', { class: 'lh-rb-nocheck' }))
        }

        name.textContent = row.kind === 'custom' ? row.tag : (RULEBOOK_SECTION_LABELS[row.tag] ?? row.tag)
        head.append(name)

        // No engine limit is left, so no row says one (96); an engine-gated row would draw with no badge.
        if (row.gate !== 'flag' && row.gate !== 'engine') {
            const badge = el('span', { class: `lh-rb-badge lh-rb-badge--${row.gate.split(':')[0]}` })
            badge.textContent = row.gate === 'library' ? 'yours' : 'Follows the relationship system switch'
            head.append(badge)
        } else if (row.kind === 'unlocked') {
            const badge = el('span', { class: 'lh-rb-badge lh-rb-badge--library' })
            badge.textContent = 'Your override'
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

        // What the list is stands behind the heading's [?] (96); the summary is the count and the cost.
        const stock = view.rows.filter((r) => r.kind !== 'custom')
        const counts = el('div', { class: 'lh-rb-counts' })
        counts.textContent =
            `${stock.length} stock sections · ${stock.filter((r) => r.sent).length} on · ` +
            `about ${view.tokens.toLocaleString()} tokens sent with every reply`
        summary.append(counts)

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
                `↳ ${run.length} of your sections are sent here (${shown}). ` +
                (sentCount ? `${sentCount} on, about ${sentTokens.toLocaleString()} tokens.` : 'None on.')
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
