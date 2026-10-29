# AdventureTime

The **Multihog D&D Framework**, reimplemented for
[Lumiverse](https://docs.lumiverse.chat). A state tracker that keeps the
character sheet, the party, the inventory, the quests and the clock straight
across a long story; a lorebook agent that writes the NPCs, places and
factions the story produces into the chat's world books; persistent maps
that are drawn, kept and changed with play; a narrator's rulebook with dice,
choices and a game-system wizard; a character creator, portraits,
relationships and World Progression. The game cartridges Multihog exports
load here as they are.

> **Public beta.** Everything listed below is in and playable, and what was
> carried over from Multihog is held to Multihog's own source by tests, but
> it has only been played on one setup so far. Reports from people who know
> Multihog are the most useful thing right now: see
> [Reporting problems](#reporting-problems).

AdventureTime is a reimplementation of
[SillyTavern-MultihogDnDFramework](https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework)
by [MultihogAurelius](https://github.com/MultihogAurelius), written to the
same contracts and, wherever the original's logic could be carried whole, to
its code. It is an independent, unofficial extension designed to work with
Lumiverse, and is not affiliated with, endorsed by or supported by
Lumiverse's developers or by Multihog's author. Its bugs are its own, so
please report them here rather than upstream.

## Status

**Public beta**, on the way to 1.0. The focus until then:

- **Parity with Multihog.** Anything Multihog does that this doesn't, or
  does differently, is the most valuable report. Some differences are
  deliberate (see
  [Differences from Multihog](#differences-from-multihog)),
  but report anything that surprises you anyway.
- **The UI:** where it loses you, and what is hard to find.
- **Starting a new adventure:** the character creator, Instant Action and
  the setup around them.

**Not in yet:** the Adventure Companion, Multihog's help bot. It arrives with
the new-adventure work, once the documentation it guides people from is
written.

Feature requests are welcome and get logged, but they wait until the work
above is done. Reports are worked through in batches, not in real time.

## What it does

- **The State Tracker.** After every reply a second model call reads what
  changed and keeps a memo of it: the character, the party, the inventory
  with its worth, the quests, combat, the in-world time and date, spell
  slots, and whatever custom modules you add. The memo is drawn as cards —
  stacked, or in Multihog's Tab Mode — with Multihog's bars, pills, pips
  and markers, animated as values move, recoloured with a click; a card can
  sit under every message too (off as it ships). A history stepper walks
  back through every state the chat has been in; a Change Log shows what
  the last pass moved.
- **The Lorebook Agent.** A tool-calling pass that records NPCs, locations,
  factions and your own categories into the campaign's world books, with
  Multihog's `[CORE]` sheets, its editable sections, a cleanup pass, a full
  audit of a long chat, pause, undo and redo. The Campaign Records tab shows
  every entry as a card with its portrait, standing and relationship bars.
- **The narrator's rulebook.** Multihog's stock prompts, sent whole and
  editable section by section; CYOA choices drawn as buttons under each
  reply; pre-seeded dice, a `RollTheDice` tool, or the queue; pacing and
  the optional components; a game-system wizard that writes a new module's
  tracker half and narrator half from a description, with a live preview.
- **Persistent maps.** The Map Architect draws a site when the party
  arrives (by tool call, or by a text block for a connection that cannot
  call tools), the Map Updater changes it with play, Map Evolution moves it
  while the party is away, and the map is on screen as the party knows it.
  Maps nest, settlements absorb the maps inside them, and the Map Themes
  colour the picture.
- **World Progression.** Reports on the wider world on the in-world clock,
  from a seeded skeleton of factions, places and conflicts.
- **Characters.** A character creator, Instant Action, a sheet from the
  active persona or from instructions, a card import, the Player Card, the
  NPC library and the NPC creator, and a tab in Lumiverse's own character
  editor.
- **Pictures.** Portraits drawn as people appear, a scene picture for the
  place the party is in, Multihog's seven art styles and the prompt editor
  before every draw.
- **Relationships.** Friendship and affection per NPC, moved by the
  tracker or by the narrator's inline awards, with the float feedback.
- **The look.** Multihog's five themes and the AI Theme Wizard, the
  day/night cycle, backdrops, font sizes, Display Groups.
- **Cartridges.** The whole configuration exports as a Multihog game
  cartridge and imports from one: the same 49 keys in the same format, so a
  cartridge authored for Multihog loads here unchanged.

## Settings

The **AdventureTime** tab in the drawer (the d20) holds the settings in
Multihog's seven categories — *General & visuals*, *Connections & models*,
*Game systems & customisation*, *State tracker & modules*, *Lorebook agent*,
*Persistent maps*, *World progression* — with a search box over them. Every
model call can run on a connection of its own; the tracker and the agent
suit a smaller, faster model than the one writing the story.

## Before you install

**It makes extra model calls.** With the defaults, which are Multihog's:

- the State Tracker runs after every reply;
- the Lorebook Agent runs every third reply;
- with Persistent Maps on (the default), the Map Architect draws a site in
  two calls when the party first reaches it, the Map Updater runs after each
  reply inside a mapped site, and Map Evolution moves sites along as
  in-world time passes.

World Progression, the scene picture and automatic portraits stay off until
you switch them on.

**Give those calls a cheap model.** Set the **State tracker** and **Lorebook
agent** connections under *Connections & models*. Left blank, both run on the
narrator's connection — the chat's own when the chat pins one, else the
connection last seen writing the story, else the one ticked *Set as default
connection* in Lumiverse — and the other passes fall back to one of those
two. A light, fast model suits them. The **Lumiverse checklist** under *Core
& Branching* names the connection a blank row will use.

**Output length for AdventureTime's calls**, in the same place, is the one
number its own calls get: a preset's numbers reach a chat reply alone, never
a background pass. Blank leaves each provider's own default (Anthropic's
through Lumiverse is 4,096 tokens); set it if a pass's JSON reply ends
mid-object.

**Function calling** on the narrator's connection lets it roll with the
`RollTheDice` tool and ask for maps with `CreateAreaMap`. Without it, set
**RNG mode** to *Pre-seeded only* and the Map Architect opener to *Text
command*, both under *Narrator configuration*.

**A summariser is strongly recommended**, as it is for Multihog: one that
hides older messages, so the narrator sees only the last ten turns or so
verbatim while the Lorebook Agent keeps the memory in lore. Multihog's
author recommends Summaryception, and
[Lumi-Summaryception](https://github.com/Ryah/Lumi-Summaryception) is a
Lumiverse port of it.

**Presets.** AdventureTime adds its rulebook and the game state after the
preset's own prompt and replaces nothing, so both are sent on every narrator
turn. A lean preset is the safe default: no roleplay prompt or reply-format
rules of its own; **Max Tokens** sized for a reply plus any reasoning, not
Multihog's 100,000 — Lumiverse takes it out of the chat's room before it
fits the history, so a huge one starves the chat; and the context cap below
the model's maximum by AdventureTime's share, which the Prompt Breakdown's
*AdventureTime —* rows show (the rulebook alone is about 6,700 tokens). A cap
at the maximum leaves no room for those rows, and a low one drops old chat.
The preset reaches the narrator alone: the background passes get none of
its text and none of its numbers (see *Output length for AdventureTime's
calls* above). Your own instructions belong in **Your world rules**, under
*Game systems & customisation* → *The narrator's rulebook*.

## Installing

1. In Lumiverse, open the **Extensions** panel, press **Add Extension**,
   and paste this repository's address into **Install from Source**.
   Lumiverse clones it and builds it.
2. **Approve the permissions.** AdventureTime asks for twelve. Lumiverse
   grants four on its own and holds eight for your approval: open the
   extension's **Permissions** and press **Enable All**. Each one is
   something a feature needs:

   | Permission | What it is for |
   |---|---|
   | `generation` | every model call the extension makes |
   | `interceptor` | the rulebook and the memo in the narrator's prompt |
   | `tools` | the dice tool and the map tool |
   | `chat_mutation` | reading the recent story; sending a CYOA choice as your message |
   | `world_books` | the campaign's lorebooks |
   | `images` | storing a picture you upload |
   | `image_gen` | drawing portraits and the scene picture |
   | `regex_scripts` | the script that hides the choices block in replies |
   | `characters` | importing a card; attaching books to the narrator's card |
   | `personas` | making a persona for a new character |
   | `chats` | naming a campaign after its card |
   | `ui_panels` | the two floating boxes |

3. Open a chat. Two floating boxes appear, *AdventureTime — the tracker*
   and *AdventureTime — the Lorebook Agent & maps*, and the d20 tab in the
   drawer holds the settings. The line at the top of that tab reads
   `AdventureTime <version> · Lumiverse <version> · all 12 permissions
   granted`, or names any permission still missing.

**Updating:** press **Update** on AdventureTime in the Extensions panel.
Lumiverse builds at install time, so nothing changes until it is pressed;
the version line says whether it took.

## Your first adventure

On a chat with no character sheet yet, **Starting the Adventure** is open at
the top of the settings tab, and its **Setup Guide** walks through the rest:

1. **A narrator card:** an empty character card, since the rulebook carries
   the whole prompt. **Create narrator card** makes one. AdventureTime, like
   Multihog, writes the story like a book rather than as a one-on-one chat.
2. **The connections**, under *Connections & models*.
3. **A character:** the **Character Creator**, **Instant Action**, or
   **Other Ways to Begin** (from your persona, from instructions, or from an
   imported card).

The **Lumiverse checklist** in *Core & Branching*, the first card of
*General & visuals*, lists the things to check on the narrator's connection
and its preset, and names the connection AdventureTime's own calls will run
on.

## Reporting problems

Open an issue here on GitHub if you can; a reply in the Lumiverse Discord
thread is fine for quick things. Please include:

- **the version line** from the top of the settings tab;
- **your Lumiverse version and branch** (main or staging);
- **what you did, what Multihog does there, and what AdventureTime did
  instead**;
- for a tracker or agent problem, **its last report**: in the second box,
  the *Lorebook Agent* tab → *Terminal / direct prompt* → the *State
  Tracker* or *Lorebook Agent* tab.

To see exactly what a model was sent, switch on **Debug logging** (*General &
visuals* → *Debug & factory reset*): every call AdventureTime makes goes to
Lumiverse's Server Logs. The log keeps 150 lines by default, so raise it
before a long test.

## Differences from Multihog

Each one is either necessary on Lumiverse or a personal preference, not a
judgement on how Multihog does it. The ones a Multihog player is most likely
to notice:

- **Every chat is its own campaign.** There is no Chat-Linked Mode;
  Lumiverse's own *Branch* on a message copies the campaign into the branch.
- **The rulebook goes in from the extension.** Nothing to paste into a
  preset, and no Main prompt to back up or restore.
- **The relationship system is on as it ships.** Multihog ships it off.
- **Instant Action also works on a chat that already has a sheet**, and
  asks before writing over it. Multihog allows it on an empty chat only.
- **Lore is stamped with the message it came from** (`[msg #12]`), where
  Multihog stamps the in-world day.

## Known issues

These come from Lumiverse's side:

- After **Instant Action**, the opening message shows as sent by a blank
  user until Lumiverse's persona list is refreshed. The persona itself is
  made and active.
- Lumiverse's **Lore** tab shows a lorebook AdventureTime attached only
  after a page refresh.

## Related

- [multihog-dnd-lumiverse](https://github.com/syvrien/multihog-dnd-lumiverse)
  by syvrien: another Lumiverse port of Multihog, built independently and
  taking a different approach, a compatibility layer around Multihog's own
  code.

## How this was made

Vibecoded: the maintainer directs and tests in a real campaign, and Claude
writes the code. What was carried over from Multihog is held to Multihog's
own source by tests, so it behaves the way the original does.

## Working on it

```bash
npm install
npm test            # the unit tests
npm run typecheck   # against the real Spindle API types
npm run build       # both bundles, as Lumiverse will build them
```

The files named `*-legacy.js` under `src/` are generated: they are
Multihog's own code, sliced from its source at the pinned release by the
scripts under `scripts/`, and every one is held to that source by a pin test.
Those tests, and the other differential tests against Multihog, need a
checkout of the pinned release and skip without one:

```bash
git clone --filter=blob:none \
  https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
MULTIHOG_CHECKOUT=/tmp/mh npx vitest run
```

Do not edit a generated file by hand; change the extractor and regenerate
it.

Each release lands here as a single commit, so pull requests are not merged
directly. Open an issue instead, with the change described or attached.

## Credits

- **Multihog D&D Framework** by
  [MultihogAurelius](https://github.com/MultihogAurelius): the design, the
  prompts, the cartridge format, and the logic this reimplementation carries
  — a great deal of it verbatim. Release 2026.9.25 (commit `d6aab00`) is the
  pinned source.
- **Lumiverse / Spindle** by [prolix-oc](https://github.com/prolix-oc), the
  platform this runs on.

## License

Copyright (C) 2026 MissusMeesecks.

AdventureTime is a derivative work of the Multihog D&D Framework,
Copyright (c) 2026 MultihogAurelius, released under the GNU General Public
License, version 3 or later. The generated `*-legacy.js` files and the transcribed
prompts, parsers and renderers under `src/` carry Multihog's code and texts.

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option)
any later version.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
more details.

See [LICENSE](LICENSE) for the full text.
