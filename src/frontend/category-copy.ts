/**
 * The categories' copy (Phase 63d, roadmap row 63): the intro box each
 * category opens with, and its **Quick Start Guide** — Multihog's settings
 * window has one, under World Progression, and the maintainer asked for
 * the section; here every category gets one in the same shape (a lead, the
 * numbered steps, a *Miscellaneous* list), in AdventureTime's words and with
 * AdventureTime's button names. The World Progression and Persistent Maps intros
 * are Multihog's own sentences (`settings.html` at the pin), which hold here
 * word for word; the rest name the host and are ours.
 */

import { setCardIcon } from './icons.js'
import type { SettingsCategoryId } from '../settings/schema.js'

export interface QuickStartGuide {
    lead: string
    steps: Array<{ title: string; text: string }>
    /** Headed parts after the steps (96): the maps guide's, folded into the category's one guide card. */
    parts?: Array<{ title: string; paragraphs: string[] }>
    misc: string[]
}

export interface CategoryCopy {
    intro: string
    guide: QuickStartGuide
}

/**
 * The maps guide's headed parts (71a; 96): Multihog's help page in AdventureTime's
 * words. Since 96 they are parts of the *Persistent maps* category's one guide
 * card (audit D3: one guide card per category), and the Lore widget's **Maps
 * guide** button opens the same parts in Lumiverse's modal, so the text is
 * written once.
 */
export const MAPS_GUIDE: Array<{ title: string; paragraphs: string[] }> = [
    {
        title: 'Why maps matter',
        paragraphs: [
            'Maps make skill checks honest. Without a map, a roll can create what it finds: a success spawns the trap or the enemy, and a failure means there was none. With a map, the roll is checked against what was already there.',
            'Maps keep space consistent. If a ceiling collapses on a passage, Map Updater marks the passage closed and the enemies under it destroyed. The narrator cannot invent a way around it. The rubble is still there when the party returns.',
            'Map Evolution can change the site while the party is away. A rival band might clear the passage. The reason is recorded with the map, so the narrator knows why the way is open.',
        ],
    },
    {
        title: 'How maps are made',
        paragraphs: [
            'The narrator asks for one of three map types. A settlement map covers a town or city district by district. A dungeon map covers a dangerous complex room by room. An interior map covers a large low-risk site room by room. Ordinary shops, inns and homes are buildings on their district, not maps of their own. Wilderness and minor places are not mapped.',
            'A new settlement map can absorb existing dungeon and interior maps. The narrator can also attach a new dungeon or interior map to one cell of an existing map, from anywhere. Maps can nest three levels deep. Only Map Architect creates the links between maps.',
            'The party’s place is read from the Location footer of the reply. Sites with similar names stay separate. Leaving a nested map puts the party back in its parent map.',
            'You can also make a map yourself in the Campaign Records tab of the Lore widget. “+ Add Mapped Location” on the Locations folder creates a new location and its map. “+ MAP” on an existing location maps it. The narrator is not involved.',
        ],
    },
    {
        title: 'Editing a map',
        paragraphs: [
            'You can edit a map directly as JSON. In the Visuals/Map tab of the Lore widget, turn on “Reveal all” and open “Map Details”. Open “Raw JSON”, change the document and press “Save JSON”.',
        ],
    },
]

export const CATEGORY_COPY: Record<SettingsCategoryId, CategoryCopy> = {
    general: {
        intro: 'These settings control how the widgets look. They also hold cartridges, the CYOA choice buttons, and the prompts for portraits and location images.',
        guide: {
            lead: 'A cartridge saves your prompts, modules, rulebook and game systems as one file. Export one before you change anything. Import it again if a change goes wrong.',
            steps: [
                { title: 'Arrange the widgets', text: 'AdventureTime shows two floating widgets, the Tracker widget and the Lore widget. Drag, resize or fold them. Turn on One window under Appearance to combine them into one box.' },
                { title: 'Keep a cartridge', text: 'Export cartridge under Cartridges saves your prompts, modules, rulebook and game systems to a file. Import cartridge loads a file and replaces them. Every setting on this tab then shows the loaded values.' },
                { title: 'Set up choices', text: 'CYOA mode ends every reply with choices drawn as buttons. Turn it on with the CYOA mode switch on the Narrator card, under Game systems & rulebook. The CYOA mode card here holds the choice slots and presets.' },
                { title: 'Set the art', text: 'Under Portraits & location images, press Load on an art style to fill in its three prompts and word target. You can also edit the prompts and save them under a name with Save setup.' },
            ],
            misc: [
                'The version line at the top of this tab shows the installed version. If it still shows the old version after an update, press Update in Lumiverse’s extension panel again.',
                'Reset to factory on a section restores only that section’s settings. It asks before it does so.',
            ],
        },
    },
    connections: {
        intro: 'Choose which connection each AdventureTime feature runs on, and the output length for its calls. These settings apply to every chat.\n\nSome connections also appear next to the feature they drive. Both places change the same setting.\n\nLeave a row blank to use the fallback named in its list. The State Tracker and Lorebook Agent rows fall back to the narrator connection, which AdventureTime picks as the first of these that exists:\n1. The chat’s own connection.\n2. The connection that wrote the last reply.\n3. Lumiverse’s default connection.\n4. The first connection Lumiverse lists.',
        guide: {
            lead: 'Each kind of pass can run on its own text connection. Pictures are drawn on image connections.',
            steps: [
                { title: 'Set one connection for everything', text: 'Pick a connection under “Apply to all text connections” and press “Apply to all”. All eight text connections change. The two image connections do not.' },
                { title: 'Use a fast model for frequent work', text: 'The State Tracker runs after every reply, and one Map Evolution pass can cover several sites. Use a careful model for the Lorebook Agent, because it records the lore.' },
                { title: 'Choose the image connections', text: 'Location images and portraits are drawn on Lumiverse image connections.' },
            ],
            misc: [
                'If a chosen connection is removed from Lumiverse, the row keeps it and shows it as missing. It is never reset silently. Choose another connection to fix it.',
                'Tool calls (the dice and the Map Architect) need “Enable Function Calling” on the narrator’s connection. That is a Lumiverse setting.',
            ],
        },
    },
    systems: {
        intro: 'Game systems, custom fields and the wizard that drafts them. Also the narrator rulebook: its sections and your own world rules.',
        guide: {
            lead: 'A game system has two halves. One is a rule the narrator is told. The other is a block the tracker keeps in the memo. The wizard writes both from a short description.',
            steps: [
                { title: 'Describe it', text: 'In the game system wizard, type what the system does, or press an example chip. Press Draft system. The preview shows both halves.' },
                { title: 'Save it on', text: 'When you save a system on, a tracker pass runs and creates its block. The tracker report lists the block as added.' },
                { title: 'Watch it move', text: 'A block changes with in-world time, when the narrator annotates a change, or from a number in the story. Its module text says which. To test the tracker itself, type “increase X by N” in the Tracker widget’s prompt bar.' },
                { title: 'Shape the rulebook', text: 'Turn sections off in the Narrator rulebook card. World rules holds your own sections.' },
                { title: 'Choose how characters start', text: 'The starting level, gear, Player Card, persona and Instant Action settings are in “Character creation & starting modes” at the bottom of this category.' },
            ],
            misc: [
                'The wizard’s context settings are under the wizard itself. They set how many messages it reads and whether it sees the tracker state.',
                'Dice (RNG) on the Narrator card sets how the narrator rolls dice: from a pre-seeded queue or through a tool call. The dice line at the top of the settings tab shows what the last reply did.',
                'If a system does not change, check three things in order.\n1. The rulebook message in Lumiverse’s Prompt Breakdown contains the system’s section.\n2. The narrator’s replies contain the annotations.\n3. The module’s own text tells the tracker what to do.',
            ],
        },
    },
    tracker: {
        intro: 'The State Tracker reads each reply and updates the tracker cards. This category sets its prompt, its modules, the order of the cards and how much story it reads.',
        guide: {
            lead: 'After every reply, one tracker pass reads the new story and updates the memo. The memo is the set of blocks the tracker cards draw. The module texts tell the tracker what to keep. “Advanced tracker” sets how much it reads and how often it runs.',
            steps: [
                { title: 'Read the report first', text: 'The last tracker pass’s report is in the Lore widget, in the Terminal drawer, on the State Tracker tab. It says whether the pass updated the memo, changed nothing, was skipped or failed, and gives the reason.' },
                { title: 'Edit a module’s text', text: 'Each row under Tracker modules has an Edit text button, with Save and Reset to stock inside. An “edited” badge shows when the text differs from the stock text. The party size limit is a sentence in the Party module’s text, and no code enforces it.' },
                { title: 'Order the cards', text: 'Use the arrows on the Tracker modules rows. The cards redraw at once, in the Tracker widget and under each message.' },
            ],
            misc: [
                'Run tracker now, at the top of the Tracker widget, runs a tracker pass without sending a message.',
            ],
        },
    },
    agent: {
        intro: 'Prompts, character sheet sections and timing for the Lorebook Agent. The agent reads the story and files what it learns into the campaign’s lorebooks.',
        guide: {
            lead: 'After every few replies the Lorebook Agent reads the story. It files what it learned into the campaign’s lorebooks, one lorebook per module. Each pass leaves a report of what it wrote and what it refused.',
            steps: [
                { title: 'Name the campaign', text: 'The Campaign name box in the Lore widget names the campaign’s lorebooks. A campaign with no name is named after the character card and the current time when it is first shown.' },
                { title: 'Choose the modules', text: 'Agent modules in the Lore widget lists each category with an on/off switch and its instruction. Custom tags adds your own categories. Each custom tag writes to its own lorebook.' },
                { title: 'Set the timing', text: 'Use Agent passes to set how often the agent runs, how many messages it reads and how many model calls one pass may make.' },
                { title: 'Check that the narrator sees the lorebooks', text: 'The Lorebooks list in the Lore widget shows a dot per lorebook. Green means attached. Red means made but not attached, so the narrator does not see it. Keep “Attach new lorebooks automatically” on to keep them green.' },
            ],
            misc: [
                'The relationship system switch is under Character sheets. When on, the narrator sees every NPC’s standing, and the tracker or the narrator changes the values.',
            ],
        },
    },
    maps: {
        intro: 'Persistent maps cover dungeons and large interiors room by room, and settlements district by district. Map Architect draws a map, Map Updater keeps it current during play, and Map Evolution changes it as in-world time passes.',
        guide: {
            lead: 'A site’s map is a hidden document stored in the site’s location entry. Map Architect draws it when the party arrives. Map Updater keeps it current during play. Map Evolution changes it as in-world time passes. The Visuals/Map tab of the Lore widget shows the map as the party knows it.',
            steps: [
                { title: 'Let the narrator ask', text: 'Turn on the “Persistent maps” section of the narrator rulebook. The narrator then asks for a map when the party reaches an unmapped site. It asks with a tool call, or with a text block if its connection cannot call tools. Choose which under Map Architect.' },
                { title: 'Keep it current', text: 'With “Update maps during play” on, one pass runs after every N replies inside a mapped site. Swiping a reply undoes the update that followed it.' },
                { title: 'Let sites change over time', text: 'With “Evolve sites over in-world time” on, every mapped site has a clock that follows the tracker’s in-world time. “Evolve now” in the Map Evolution drawer of the Lore widget runs a pass without waiting.' },
                { title: 'Look at it', text: 'The Visuals/Map tab of the Lore widget draws the site the party is in. “Reveal all” also draws what the party has not learned. The “Site” box draws any mapped site.' },
            ],
            parts: MAPS_GUIDE,
            misc: [
                'Map Evolution reads World Progression’s reports. If a report says goblins are invading a mapped site, Map Evolution may put goblins on that map. The narrator sees the report too, so it knows what is happening even while the party is elsewhere.',
                'The Lorebook Agent never removes a map. If it tries to delete or merge an entry that holds a map, the action is refused and the agent’s report says so.',
            ],
        },
    },
    world: {
        intro: 'World Progression writes reports about what happens in the world away from the party, at a fixed in-world interval. Each report is one model pass and is stored in the campaign’s World lorebook. AdventureTime decides when a report is due by reading the [TIME] block after each tracker pass.',
        guide: {
            lead: 'A World Skeleton is optional but recommended. It adds places and wider-world premises beyond the party’s surroundings. World Progression reads the lore for each chosen location, but never its hidden map.',
            steps: [
                { title: 'Write the skeleton source', text: 'In “World Skeleton & atmosphere”, describe the world in anything from one sentence to a page. “Write from this chat” writes a general description from the recent messages and names nobody. You can also have existing lorebooks read as canon.' },
                { title: 'Generate the skeleton', text: 'Press “Generate skeleton”. Locations become possible report subjects. Factions and conflicts give wider context.' },
                { title: 'Set the location rotation', text: 'Choose how many locations each report covers. The locations reported on longest ago are picked first, and only equally old ones are picked at random. List places to skip under “Excluded places”.' },
                { title: 'Write the first report', text: 'Press “Write a report now” in the World Progression drawer of the Lore widget, or wait for the in-world clock. The narrator sees the report at once. Mapped sites react later, on their next Map Evolution pass.' },
            ],
            misc: [
                'World Progression can read named people, buildings and sub-locations as background for a location. It does not advance them.',
                'The skeleton never holds named people. They belong in NPC lore once play establishes them.',
                '24 in-world hours is a good starting interval. Try shorter or longer.',
                'Every report is dated at the current in-world time. Pressing “Write a report now” again before the clock moves writes nothing.',
            ],
        },
    },
}

type El = (tag: string, attrs?: Record<string, string>) => HTMLElement

function appendGuideParts(el: El, body: HTMLElement, parts: ReadonlyArray<{ title: string; paragraphs: string[] }>): void {
    for (const section of parts) {
        const heading = el('div', { class: 'lh-quickstart-misc-label' })
        heading.textContent = section.title
        body.append(heading)
        for (const text of section.paragraphs) {
            const p = el('p', { class: 'lh-quickstart-lead' })
            p.textContent = text
            body.append(p)
        }
    }
}

/** The maps guide as the Lore widget's button opens it (71a; 96): the same parts as the category's guide card, in a block of its own for Lumiverse's modal. */
export function createMapsGuide(el: El): HTMLElement {
    const body = el('div', { class: 'lh-quickstart-body lh-maps-guide', 'data-lh-field': 'maps-guide' })
    const lead = el('p', { class: 'lh-quickstart-lead' })
    lead.textContent = CATEGORY_COPY.maps.guide.lead
    body.append(lead)
    appendGuideParts(el, body, MAPS_GUIDE)
    return body
}

/** The Quick Start Guide card: closed by default, the whole card one search item. */
export function createQuickStart(el: El, guide: QuickStartGuide): HTMLDetailsElement {
    const card = el('details', { class: 'lh-card lh-quickstart lh-search-item', 'data-lh-field': 'quick-start' }) as HTMLDetailsElement
    const summary = el('summary')
    const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
    setCardIcon(icon, 'Quick Start Guide', 'ℹ️')
    const title = el('span', { class: 'lh-card-title' })
    title.textContent = 'Quick Start Guide'
    summary.append(icon, title, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
    const body = el('div', { class: 'lh-quickstart-body' })
    const lead = el('p', { class: 'lh-quickstart-lead' })
    lead.textContent = guide.lead
    const steps = el('ol', { class: 'lh-quickstart-steps' })
    for (const step of guide.steps) {
        const item = el('li')
        const strong = el('b')
        strong.textContent = step.title
        item.append(strong, document.createTextNode(`: ${step.text}`))
        steps.append(item)
    }
    body.append(lead, steps)
    if (guide.parts?.length) appendGuideParts(el, body, guide.parts)
    if (guide.misc.length) {
        const misc = el('div', { class: 'lh-quickstart-misc' })
        const label = el('div', { class: 'lh-quickstart-misc-label' })
        label.textContent = 'Miscellaneous'
        const list = el('ul')
        for (const text of guide.misc) {
            const item = el('li')
            item.textContent = text
            list.append(item)
        }
        misc.append(label, list)
        body.append(misc)
    }
    card.append(summary, body)
    return card
}

/** The shared card look (63d; 96): a bordered fold with an icon, the title on the left, its [?], and at the right a chevron that points right when closed and down when open, as Lumiverse's own folds do. */
export const CARDS_CSS = `
.adventuretime-panel .lh-card {
    border: var(--lh-card-border, 1px solid var(--lumiverse-border, rgba(127,127,127,0.3)));
    border-radius: var(--lumiverse-radius, 6px);
    padding: 0;
    background: var(--lh-card-bg, rgba(127,127,127,0.04));
}
.adventuretime-panel .lh-card > summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    font-weight: 600;
    list-style: none;
    background: var(--lh-card-header, rgba(127,127,127,0.08));
    border-radius: var(--lumiverse-radius, 6px);
}
.adventuretime-panel .lh-card[open] > summary { border-radius: var(--lumiverse-radius, 6px) var(--lumiverse-radius, 6px) 0 0; }
.adventuretime-panel .lh-card > summary::-webkit-details-marker { display: none; }
.adventuretime-panel .lh-card > :not(summary) { margin-left: 10px; margin-right: 10px; }
.adventuretime-panel .lh-card > :last-child:not(summary) { margin-bottom: 8px; }
.adventuretime-panel .lh-card-icon { opacity: 0.75; width: 1.4em; text-align: center; }
.adventuretime-panel .lh-card-title { flex: 0 1 auto; min-width: 0; text-align: left; }
.adventuretime-panel .lh-chevron {
    width: 0.55em; height: 0.55em; flex: none;
    border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
    transform: rotate(-45deg); transition: transform 0.15s; opacity: 0.7; margin-right: 4px; margin-left: auto;
}
.adventuretime-panel .lh-card[open] > summary .lh-chevron { transform: rotate(45deg); }
.adventuretime-panel .lh-card > .lh-help-note { margin-top: 8px; }
.adventuretime-panel .lh-card-foot { display: flex; justify-content: flex-end; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.3))); }
.adventuretime-panel .lh-quickstart > summary { background: rgba(0,180,216,0.08); border-color: rgba(0,180,216,0.2); }
.adventuretime-panel .lh-quickstart .lh-card-icon { opacity: 1; }
.adventuretime-panel .lh-quickstart-body { font-size: 0.8em; line-height: 1.45; padding-top: 8px; }
.adventuretime-panel .lh-quickstart-lead { margin: 0 0 10px; opacity: 0.85; }
.adventuretime-panel .lh-quickstart-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-quickstart-misc { margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(127,127,127,0.3); }
.adventuretime-panel .lh-quickstart-body > .lh-quickstart-misc-label { margin-top: 12px; }
.adventuretime-panel .lh-quickstart-misc-label { font-size: 0.8em; font-weight: bold; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.adventuretime-panel .lh-quickstart-misc ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; opacity: 0.9; }
.adventuretime-panel .lh-quickstart-misc li { white-space: pre-line; }
`
