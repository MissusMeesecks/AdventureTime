/**
 * The drawer tab's guide (Phase 96, stage 2g; the audit's decision D3):
 * Lumiverse's own guide button on the tab opens this short overview — what
 * each settings category is for and where to start. The detail stays in each
 * category's one Quick Start Guide card, so nothing is written twice.
 *
 * Lumiverse renders and sanitises the Markdown.
 */

export const TAB_GUIDE_TITLE = 'AdventureTime: where things are'

export const TAB_GUIDE_MARKDOWN = `AdventureTime runs a tabletop-style adventure in your chat: a narrator, a tracker that keeps the character sheet, an agent that writes the lore, maps, and a world that moves on its own.

## Where to start

1. Open **Starting the adventure** at the top of this tab and make a character. **Instant Action** is the quickest way.
2. Play. The **Tracker** widget shows the sheet, and the **Lore** widget shows the lorebooks, the scene and the map.
3. Change settings only when something does not suit you. Everything ships with working defaults.

If something does not work, open **General & visuals → Setup & help** and press **Lumiverse checklist**. It checks the connection, tool calling and the output length.

## The settings categories

- **General & visuals**: setup help, the look, cartridges (your whole setup as one file), CYOA choices, portraits and pictures, and the resets.
- **Connections & models**: which connection each part runs on. Leave a row blank to use the narrator’s connection.
- **Game systems & rulebook**: the narrator’s rules, your own game systems and custom fields.
- **State Tracker**: what the tracker records after each reply, and how its cards are shown.
- **Lorebook Agent**: how NPCs, places and factions are written into lorebooks.
- **Persistent maps**: how maps are drawn, kept current and changed over time, and their colors.
- **World Progression**: reports about what happens in the world away from the party.

Each category has a **Quick Start Guide** card with the steps for that part. A **?** beside a label explains that one control. The search box finds a setting by its name or its help text.
`
