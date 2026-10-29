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

import type { SettingsCategoryId } from '../settings/schema.js'

export interface QuickStartGuide {
    lead: string
    steps: Array<{ title: string; text: string }>
    misc: string[]
}

export interface CategoryCopy {
    intro: string
    guide: QuickStartGuide
}

export const CATEGORY_COPY: Record<SettingsCategoryId, CategoryCopy> = {
    general: {
        intro: 'What the panel looks like and what it carries: the layout, the cartridges that hold a whole configuration, CYOA mode’s choices, and the prompts and art styles behind every portrait and scene picture.',
        guide: {
            lead: 'A cartridge is the whole game as a file — every prompt, module, switch and game system — so the first thing worth doing is exporting one before changing anything, and the last is importing it back if a change went wrong.',
            steps: [
                { title: 'Pick a layout', text: 'Two floating widgets is the default: the tracker in one box, the map, the scene and the relationships in another, and this tab for the rest. Two tabs or the classic one tab are a select away, and the panel redraws at once.' },
                { title: 'Keep a cartridge', text: 'Export cartridge… under Cartridges writes the configuration to a file. Import cartridge… loads one, and every editor on this tab re-seeds from it.' },
                { title: 'Choose the choices', text: 'CYOA mode draws the narrator’s choices as buttons under each reply. The rulebook row CYOA mode under The rulebook is its switch; the CYOA Mode section here holds the slots and presets.' },
                { title: 'Set the art', text: 'Under Portraits and location images, press Load on an art style to put its three prompts and word target in place, or edit the prompts and Save setup to library under a name. The drawing switches at the section’s foot are the same ones the Portraits in play and Scene folds hold.' },
            ],
            misc: [
                'The version line at the top of this category is the update check’s twin: an older version there means Update did not take.',
                'Reset to factory on a section puts that section’s cartridge keys back, after a confirmation; the rest are untouched.',
            ],
        },
    },
    connections: {
        intro: 'The model connection each AdventureTime feature runs on, and the output length its own calls get. These are global settings: blank is the fallback each row names, and the tracker’s and the agent’s fallback is the narrator’s connection — the chat’s own, else the one seen writing the story, else Lumiverse’s default-ticked one.',
        guide: {
            lead: 'Every pass AdventureTime makes — the tracker, the agent, the creator, Map Evolution, the portrait prompts — can run on its own text connection, and the pictures on their own image connections. Each row here is also beside the thing it drives.',
            steps: [
                { title: 'Set one for everything', text: 'Pick a connection under Apply one text connection to all and press Apply to all: the five text rows take it; the two image rows are left alone.' },
                { title: 'Give the fast work a fast model', text: 'The tracker runs after every reply and Map Evolution may take several sites in one pass; a small, quick model suits both. The agent records lore and deserves a careful one.' },
                { title: 'Point the pictures', text: 'The scene picture and the portraits draw on Lumiverse’s image connections. Blank for the portraits is the scene picture’s; blank for the scene is the host’s default.' },
                { title: 'Choose how characters start', text: 'The starting level, gear, the Player Card and the persona, and Instant Action’s switches are under Character creation and starting modes at the foot, as Multihog keeps them.' },
            ],
            misc: [
                'A connection chosen here that the host no longer lists stays chosen and is named as missing, never silently reset.',
                'A tool call — the dice, the Map Architect — needs Enable Function Calling on the narrator’s connection, which is Lumiverse’s setting, not one here.',
            ],
        },
    },
    systems: {
        intro: 'The game systems and custom fields the tracker keeps, the wizard that drafts a new one from a description, and the narrator’s rulebook: its switches, its section order and your own world rules.',
        guide: {
            lead: 'A game system is two halves: what the narrator is told (a rulebook section) and what the tracker keeps (a block in the memo). The wizard writes both from a sentence or two.',
            steps: [
                { title: 'Describe it', text: 'Under the game system wizard, type what the system does — or press an example chip — and Draft it. The preview shows both halves.' },
                { title: 'Save it switched on', text: 'Saving a system switched on ends with a tracker pass on your instruction that creates its block; the Tracker report names it as added.' },
                { title: 'Watch it move', text: 'A block moves with in-world time, when the narrator annotates a change, or from a number stated in the story — whichever its module says. The send bar’s increase X by N proves the tracker itself is fine.' },
                { title: 'Shape the rulebook', text: 'The rulebook’s switches turn sections off; Section order moves them; Your world rules holds your own sections, sent where Multihog sends them.' },
            ],
            misc: [
                'The wizard’s context — how many messages it reads and whether it sees the tracker state — is at the foot here and under the wizard itself.',
                'A system that will not move is read in this order: the rulebook message in the Prompt Breakdown, the narrator’s annotations, the module’s own text.',
            ],
        },
    },
    tracker: {
        intro: 'The State Tracker: the extractor prompt it answers, the pacing and the dice, the time formats, the modules it keeps and the order the cards are drawn in.',
        guide: {
            lead: 'After every reply one model call reads the story since the last pass and rewrites the memo — the blocks the cards draw. What it is told is the module texts; how much it reads and how often is set here and under Tracker settings, instruction and the last report.',
            steps: [
                { title: 'Read the report first', text: 'The last pass’s report — updated, no change, skipped or failed, with the reason — is in the fold under the tracker’s head. It has named the cause of every tracker complaint so far.' },
                { title: 'Choose the window and the cadence', text: 'The current exchange is the recommended window. Every reply is the recommended cadence; fewer passes mean fewer model calls, a memo that lags, and cards only under the turns a pass ran on.' },
                { title: 'Edit a module’s text', text: 'Tracker modules lists each block with Edit the text, Save and Reset to stock, and an edited badge when it differs from the factory’s. The party cap is a sentence in the party module, which no code enforces.' },
                { title: 'Order the cards', text: 'Section order moves the blocks; a move redraws the cards at once, in the panel and under each message.' },
            ],
            misc: [
                'RNG mode decides whether the narrator rolls through a tool, a pre-seeded queue, or not at all; the dice line under the diagnostics says what the last reply did.',
                'Run tracker now in the head runs a pass without spending a turn.',
            ],
        },
    },
    agent: {
        intro: 'The Lorebook Agent: the prompts it reads, the modules and custom tags that decide what it records, the character sheets’ settings, and how often and how far back it runs.',
        guide: {
            lead: 'After every N replies the agent reads the story and files what it learned into the campaign’s books — one per module, named after the campaign’s prefix — with a report of what it did and refused.',
            steps: [
                { title: 'Name the campaign', text: 'The Campaign name box in the Lorebook agent fold names the books; an unnamed campaign names itself after the card and the clock the first time the panel shows it.' },
                { title: 'Choose the modules', text: 'Agent modules lists each category with its switch and instruction; Custom tags adds your own, each writing to its own book.' },
                { title: 'Set the cadence and the window', text: 'Replies between automatic passes; 0 runs it only when you press Run. Messages to read; 0 reads the whole chat. Research turns is the model calls one pass may make.' },
                { title: 'Make sure the narrator sees the books', text: 'The Lorebooks sub-fold shows a dot per book: green attached, red made but not attached. Attach new books as they are made keeps them green.' },
            ],
            misc: [
                'The relationship system lives under Character Sheets: on, the narrator sees every NPC’s standing and the tracker or the narrator moves the values.',
                'A swipe puts back what the replaced reply’s pass filed, through Undo.',
            ],
        },
    },
    maps: {
        intro: 'Persistent maps for dungeons and significant interiors (room-scale) and settlements (district-scale). Ordinary settlement buildings stay on their district until CreateAreaMap explicitly promotes one. Map Architect, Map Updater, and Map Evolution each have their own pass, and Evolution its own connection.',
        guide: {
            lead: 'A site’s map is a hidden document inside its own Location entry. The Architect draws it as the party arrives, the Updater keeps it current with play, Evolution moves it while the party is away, and the Maps fold draws it on screen as the party knows it.',
            steps: [
                { title: 'Let the narrator ask', text: 'The mapping section of the rulebook is the switch. With it on, the narrator calls CreateAreaMap as the party reaches an unmapped site — or, for a connection that cannot call tools, writes a [CREATE_AREA_MAP] block, the text opener chosen under Map Architect.' },
                { title: 'Keep it current', text: 'Update the map with play runs one pass after every N replies inside a mapped site; a swipe puts an update back.' },
                { title: 'Let sites change while away', text: 'Let sites change while the party is away gives every mapped site a clock on the tracker’s [TIME]; Evolve now in the Maps fold runs a pass without waiting.' },
                { title: 'Look at it', text: 'The Maps fold draws the party’s site; Reveal all draws what they have not learned too, and the Site box draws any mapped site.' },
            ],
            misc: [
                'A map inside a map: the call may name attachTo, the parent map and the exact cell; a settlement may absorb existing dungeon and interior maps as peers through include.',
                'The agent never removes a map: a delete or a consolidate aimed at an entry holding [MAP] is refused and the report says so.',
            ],
        },
    },
    world: {
        intro: 'World Progression automatically generates off-screen world simulation reports at a fixed in-world time interval. Reports are written by a standalone model pass and stored in the campaign’s _World lorebook. The trigger is deterministic — the backend checks the [TIME] block after every State Tracker update; the model only writes the report, never decides whether to generate one.',
        guide: {
            lead: 'Creating a World Skeleton is optional but recommended. It seeds places and wider-world premises beyond the player’s immediate surroundings. World Progression later reads the full lore dossier for each selected location, but never receives its hidden map.',
            steps: [
                { title: 'Create the skeleton source', text: 'Under World skeleton in the World progression fold, write anything from a short thematic seed to a granular world description. Write it from this chat safely extracts only a generalised world backdrop from the recent messages, naming nobody. You can also read existing lorebooks as canon.' },
                { title: 'Generate the skeleton', text: 'Press Generate the skeleton. Locations become potential report subjects; factions and conflicts provide wider-world context. Named people may inform a location’s dossier but are never advanced on their own.' },
                { title: 'Set up the location rotation', text: 'Choose how many locations a report covers. The ones advanced longest ago are picked first, with the random pick only among equally old candidates. Places never reported on is the exclusion list.' },
                { title: 'Write the first report', text: 'Press Write a report now in the fold, or let the clock fire it. Its prose reaches the narrator at once; the relevant maps feel it later, when their own Evolution pass runs.' },
            ],
            misc: [
                'World Progression may read named people, buildings and sublocations as constraints inside a location’s dossier, but does not advance them.',
                '24 in-world hours is a decent interval, but shorter or longer is worth trying.',
                'Every report, pressed or automatic, is dated at the clock; a second press with the clock unmoved is already filed.',
                'Reports shown to the narrator is the rolling window; the rest stay in the _World book as history, which Consolidate old reports folds into digests.',
            ],
        },
    },
}

type El = (tag: string, attrs?: Record<string, string>) => HTMLElement

/** The intro box a category opens with, in Multihog's tinted border. */
export function createCategoryIntro(el: El, text: string): HTMLElement {
    const box = el('div', { class: 'lh-category-intro lh-search-item' })
    box.textContent = text
    return box
}

/**
 * The Maps Guide (71a): Multihog's read-only help page, opened from the
 * Locations folder's button; here a closed card under *Persistent maps*,
 * after the Quick Start Guide, in AdventureTime's words and with AdventureTime's button
 * names. The argument is Multihog's own — the roll compared to a reality
 * rather than spawning one — kept whole, since it is the reason the maps
 * exist.
 */
export const MAPS_GUIDE: Array<{ title: string; paragraphs: string[] }> = [
    {
        title: 'What are maps?',
        paragraphs: [
            'A map is a persistent physical place, a document of rooms and the things in them, drawn by the Map Architect and kept current by the Map Updater on every reply the party spends inside it. Left on, Map Evolution moves it while the party is away, on an in-world interval, which is what makes a place feel alive.',
        ],
    },
    {
        title: 'Why do they matter?',
        paragraphs: [
            'Because of the way they meet skill checks. Without a mapped reality the narrator may offer “Look for traps, DC 12” or “See if you can spot enemies, DC 8”: roll a success and there are enemies; roll a failure and there are none. The trap or the enemy is spawned by the roll. With a map underneath, the check is compared to a reality that was there before the roll.',
            'It also keeps everything spatially coherent. Collapse a ceiling on a pack of enemies and the Updater marks the passage closed and the pack destroyed: the way is actually closed, and the narrator cannot hallucinate a route around it. Go away and come back, and the rubble is still there to be cleared.',
            'Better still, while the party is away Evolution may bring a rival band to that passage, who begin to clear it, or blow it open. The reason is recorded with the map, so the narrator knows why the way is open, and the band is likely still inside.',
        ],
    },
    {
        title: 'How are they made and sent?',
        paragraphs: [
            'The narrator makes a district-scale SETTLEMENT map for a town or city, a room-scale DUNGEON map for a significant dangerous complex, or a room-scale INTERIOR map for a significant low-risk site with several rooms. Ordinary shops, inns, chapels and homes are BUILDING assets on their district; props are OBJECT assets. Wilderness and insignificant places are not mapped.',
            'A settlement may absorb existing DUNGEON or INTERIOR maps when it is first made. The narrator may also attach a new DUNGEON or INTERIOR from anywhere by naming an exact existing parent map and one of its cells; no building and no movement is needed. Maps may host child maps three levels deep; the architect alone makes those gateways, and the Updater and Evolution never guess at them.',
            'The deepest complete Location footer path is the party’s place. Similar names stay distinct — “Cellar Crypt” does not match “Cellar Crypt Dungeon” — and leaving a child map puts the party back in its parent.',
            'Maps can also be made from the panel: + Add Mapped Location on the Locations folder of Campaign records, under the Lorebook agent, makes a new root and its map; + MAP on any location root there maps that root. The narrator is not involved in either.',
        ],
    },
    {
        title: 'Editing a map',
        paragraphs: [
            'A map can be edited directly as its JSON: in the Maps fold, turn on Reveal all, open Raw JSON under the picture, change the document and press Save JSON. Multihog has no graphical editor yet either; this is the way for now.',
        ],
    },
    {
        title: 'World Progression and Map Evolution together',
        paragraphs: [
            'Evolution reads World Progression’s reports. If the party is at Moonbrook and a report says there is a goblin invasion on Moonbrook, Evolution takes it as an input and may put goblins into the map, wreaking havoc. The narrator sees the report too, so it knows what is going on even while the party is elsewhere. The systems work together.',
        ],
    },
]

/** The Maps Guide card (71a): closed by default, one search item, under Persistent maps after the Quick Start Guide. */
export function createMapsGuide(el: El): HTMLDetailsElement {
    const card = el('details', { class: 'lh-card lh-quickstart lh-maps-guide lh-search-item', 'data-lh-field': 'maps-guide' }) as HTMLDetailsElement
    const summary = el('summary')
    const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
    icon.textContent = '🗺️'
    const title = el('span', { class: 'lh-card-title' })
    title.textContent = 'Maps Guide'
    summary.append(icon, title, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
    const body = el('div', { class: 'lh-quickstart-body' })
    for (const section of MAPS_GUIDE) {
        const heading = el('div', { class: 'lh-quickstart-misc-label' })
        heading.textContent = section.title
        body.append(heading)
        for (const text of section.paragraphs) {
            const p = el('p', { class: 'lh-quickstart-lead' })
            p.textContent = text
            body.append(p)
        }
    }
    card.append(summary, body)
    return card
}

/** The Quick Start Guide card: closed by default, the whole card one search item. */
export function createQuickStart(el: El, guide: QuickStartGuide): HTMLDetailsElement {
    const card = el('details', { class: 'lh-card lh-quickstart lh-search-item', 'data-lh-field': 'quick-start' }) as HTMLDetailsElement
    const summary = el('summary')
    const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
    icon.textContent = 'ℹ️'
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

/** The shared card look (63d): a bordered fold with an icon, a centred title and a chevron that turns when open. */
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
.adventuretime-panel .lh-card-title { flex: 1; text-align: center; }
.adventuretime-panel .lh-chevron {
    width: 0.55em; height: 0.55em; flex: none;
    border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
    transform: rotate(45deg); transition: transform 0.15s; opacity: 0.7; margin-right: 4px;
}
.adventuretime-panel .lh-card[open] > summary .lh-chevron { transform: rotate(-135deg); }
.adventuretime-panel .lh-category-intro {
    font-size: 0.8em; opacity: 0.75; line-height: 1.4;
    border: 1px solid rgba(100,160,255,0.25); border-radius: var(--lumiverse-radius, 6px);
    padding: 8px 10px; background: rgba(100,160,255,0.05);
}
.adventuretime-panel .lh-quickstart > summary { background: rgba(0,180,216,0.08); border-color: rgba(0,180,216,0.2); }
.adventuretime-panel .lh-quickstart .lh-card-icon { opacity: 1; }
.adventuretime-panel .lh-quickstart-body { font-size: 0.82em; line-height: 1.45; padding-top: 8px; }
.adventuretime-panel .lh-quickstart-lead { margin: 0 0 10px; opacity: 0.85; }
.adventuretime-panel .lh-quickstart-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-quickstart-misc { margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(127,127,127,0.3); }
.adventuretime-panel .lh-quickstart-misc-label { font-size: 0.78em; font-weight: bold; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.adventuretime-panel .lh-quickstart-misc ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; opacity: 0.9; }
`
