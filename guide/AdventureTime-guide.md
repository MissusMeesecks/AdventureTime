# The AdventureTime guide

AdventureTime runs a tabletop-style adventure inside a Lumiverse chat. This
guide explains what it is, how a turn runs, and how to use each part.

It follows the outline of the guide to the
[Multihog D&D Framework](https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework)
by MultihogAurelius, which AdventureTime reimplements for Lumiverse, and
uses its wording where the facts are the same. Both are under the GNU General
Public License, version 3 or later.

*How to read it.* A name in bold is a name on screen, written exactly as it
appears. A path to a setting is written with arrows, such as
*Settings → State Tracker → Advanced tracker → **Full Review Mode***.
*Settings* in a path means the AdventureTime tab in Lumiverse's drawer
(chapter 2).

## Contents

1. [What AdventureTime is, and what it is not](#1-what-adventuretime-is-and-what-it-is-not)
2. [The parts at a glance](#2-the-parts-at-a-glance)
3. [Connections and models](#3-connections-and-models)
4. [First-time setup](#4-first-time-setup)
5. [How a turn works](#5-how-a-turn-works)
6. [The narrator and the rulebook](#6-the-narrator-and-the-rulebook)
7. [Dice](#7-dice)
8. [CYOA](#8-cyoa)
9. [Quests](#9-quests)
10. [The State Tracker](#10-the-state-tracker)
11. [Display markers](#11-display-markers)
12. [The Lorebook Agent](#12-the-lorebook-agent)
13. [Campaign Records](#13-campaign-records)
14. [Persistent maps](#14-persistent-maps)
15. [World Progression and the World Skeleton](#15-world-progression-and-the-world-skeleton)
16. [Game systems and cartridges](#16-game-systems-and-cartridges)
17. [Pictures](#17-pictures)
18. [Appearance](#18-appearance)
19. [Playing without D&D](#19-playing-without-dd)
20. [On a phone](#20-on-a-phone)
21. [Troubleshooting](#21-troubleshooting)
22. [The Adventure Companion](#22-the-adventure-companion)
23. [The whole thing in one paragraph](#23-the-whole-thing-in-one-paragraph)

## 1. What AdventureTime is, and what it is not

AdventureTime is a simulation-focused role-playing system. A narrator model
writes the story. Around it, AdventureTime keeps the facts straight, so that
choices matter, consequences last and failure is possible.

It has five core parts:

1. *The narrator's rulebook.* The rules the narrator plays by. It is sent
   with every reply, and the game's logic lives in it.
2. *The State Tracker.* The accountant. After each reply it reads what
   happened and updates the character sheet: HP, inventory, combat, quests
   and the in-world time.
3. *The dice.* Real random rolls, either sent to the narrator ahead of time
   or rolled by a tool the narrator calls. The narrator does not get to
   decide that you succeed.
4. *The Lorebook Agent.* The librarian. It writes the people, places,
   factions and events of the story into lorebooks, which become the
   campaign's long-term memory.
5. *World Progression.* Reports on what the wider world does while the
   party is elsewhere, on an in-world schedule. It is off until you turn it
   on.

Persistent maps, quests, action choices under each reply (CYOA), relationships
with NPCs, portraits and location images build on those five. Each has a
chapter of its own.

*What it is not.* It is not a faithful copy of any edition of D&D. The stock
rules are a hybrid of D&D editions, simplified where that keeps a model
reliable. D&D is the default because every model knows it well, not because
the system depends on it. You can replace the stock rulebook and the tracker's
modules and track anything: modern, science fiction, slice of life or your
own system (chapter 19 covers this).

It is also not a one-on-one character chat. The story is written like a book,
by a narrator, with as many characters as the scene needs.

*If you know Multihog.* AdventureTime does what Multihog does, on Lumiverse,
and loads Multihog's game cartridges as they are. The screens are arranged
differently, and a few behaviours differ where Lumiverse works differently
from SillyTavern. Each chapter says so in a sentence where it matters.

*A summariser is strongly recommended.* Without one, a long chat grows until
it no longer fits the model. A summariser hides older messages and keeps a
short summary of them, while the Lorebook Agent keeps the details in
lorebooks. [Lumi-Summaryception](https://github.com/Ryah/Lumi-Summaryception)
is a Lumiverse port of the one Multihog's author recommends.

## 2. The parts at a glance

AdventureTime puts three things on screen.

*The Tracker widget* is a floating box titled **AdventureTime — Tracker**.
It shows the character sheet as cards. At its top are five small lights, one
each for the State Tracker, the Lorebook Agent, World Progression, the maps
and pictures. A light is grey when idle, amber while that part is working,
green when it finished and red when it failed. Hover over a light to read
what it is doing. Beside them, **Run tracker now** runs the State Tracker
without sending a message, and **Refresh** reads the sheet again. The footer
steps back through earlier states of the sheet and shows the in-world time
and the party's location.

*The Lore widget* is a second floating box titled **AdventureTime — Lore**.
It has four tabs:

- **Lorebook Agent**: run the agent, give it an instruction, and see what it
  did.
- **Campaign Records**: the Player Card, every NPC as a card, and the
  locations.
- **Visuals/Map**: the location image, the map of the site the party is in,
  and who is present.
- **Companion**: a helper to ask how AdventureTime works, or to talk over
  the story with (chapter 22).

Drag a widget by its title. The **–** button folds it to its title, and
**×** hides it. Drag the bottom-right corner to resize it. To bring back a
hidden widget, use **Toggle Tracker** or **Toggle Lore** under
*Settings → General & visuals → **Appearance***. **Reset widgets** in the
same place puts both back where a new install shows them.

*The settings tab* is the tab with the d20 icon in Lumiverse's drawer. From
the top, it has:

- The version line, which names the installed version and says whether
  Lumiverse granted every permission.
- **AdventureTime is on in this chat**: turn it off to play one chat without
  AdventureTime. The floating widgets hide while it is off, and turning it
  on again brings back every widget, even one you had closed. Other chats
  are not affected.
- **Starting the adventure**: where you set up and make a character
  (chapter 4).
- A search box, then the settings in seven categories: **General & visuals**,
  **Connections & models**, **Game systems & rulebook**, **State Tracker**,
  **Lorebook Agent**, **Persistent maps** and **World Progression**.

Each category opens with a **Quick Start Guide** card. A **?** after a label
explains that one control. The search box finds a setting by its name or by
its help text.

*One window.* *Settings → General & visuals → Appearance → **One window***
joins the two widgets into one box with five tabs: the tracker and the Lore
widget's four. On a phone it is the default (chapter 20).

*Different from Multihog:* Multihog is one panel with a settings window.
AdventureTime uses floating widgets and a settings tab, because that is how
Lumiverse lays out extensions.

## 3. Connections and models

AdventureTime makes model calls of its own, called *passes*. The narrator
writes the story on the connection you chat with. The State Tracker, the
Lorebook Agent, the map passes and the others each run a pass in the
background.

### Which connection a pass uses

Each pass has a row under *Settings → **Connections & models***: **State
Tracker**, **Lorebook Agent**, **Character creator**, **Adventure Companion**,
**Map Architect**, **Map Updater**, **Map Evolution** and **Portrait
prompts**. Two more rows
choose the image connections for pictures. Pick a connection on a row, or
leave it blank. **Apply to all** sets every text row at once.

A blank **State Tracker** or **Lorebook Agent** row reads **Use the narrator
connection**. AdventureTime finds the narrator's connection in this order:

1. The connection pinned to the chat.
2. The connection that wrote the last reply.
3. Lumiverse's default connection.
4. The first connection in Lumiverse's list.

The other rows fall back to the State Tracker's or the Lorebook Agent's
connection when blank, as each row says.

To see which connection a blank row will use right now, press
*Settings → General & visuals → Setup & help → **Open Lumiverse checklist***. The
item **Passes have a connection** names it.

### Pass output length

**Pass output length**, on the same card, is the maximum length of a pass's
answer, in tokens. A preset's settings reach the narrator only, so this is
the one number the passes get. Leave it blank to use each provider's default.
Set it if a pass reports that its answer was cut off: several passes answer
in JSON, and a cut-off answer cannot be read. Keep it at or below the model's
own limit.

*Different from Multihog:* do not copy Multihog's 100,000 tokens. Some
providers refuse a number above the model's limit.

### Which models

These are the recommendations of Multihog's author, MultihogAurelius. They
are recommendations, not rules.

| Role | Suggestion | Notes |
|---|---|---|
| Narrator | MiMo 2.5 Pro, DeepSeek V4 Pro or the latest Flash, GPT-5.6 Luna | A strong model. It needs function calling if the narrator is to roll dice with a tool or ask for maps with a tool. |
| State Tracker and Lorebook Agent | Gemini Flash-Lite or Flash, DeepSeek V4 Flash, GPT-5.6 Luna | Light, fast and inexpensive. These run often. |
| State Tracker on a local or small model | Gemma, Mistral Small, Qwen, Llama, Phi and similar | Usable. Turn on **Full Review Mode** (below). |

A light, fast model is enough for everything except the narrator.

*Small and local models.* By default the State Tracker answers with only
the parts of the sheet that changed. Weaker models often mishandle this and
drop parts that did not change. *Settings → State Tracker → Advanced tracker →
**Full Review Mode*** makes every pass write the whole sheet. It costs more
tokens per pass and is much more reliable on a small model.

### Function calling

Two features use tools that the narrator calls: the dice tool and the Map
Architect. Both need **Enable Function Calling** turned on for the
narrator's connection in Lumiverse, and a model that can call tools.

If your connection cannot call tools, both have a text alternative. Under
*Settings → Game systems & rulebook → **Narrator***, set **Dice (RNG)** to
*Pre-seeded queue only* and **How the narrator asks for a map** to *Text
block*. Nothing is lost except the tool call itself.

## 4. First-time setup

After installing or updating, check the version line at the top of the
settings tab. It should name the version you expect and say that all
permissions are granted. If a permission is missing, the line turns into a
warning that names it.

Then open a chat and open **Starting the adventure**, at the top of the
settings tab. It is open already in a chat with no character sheet. It walks
through setup in order.

### Before you start

Three checks, each with a mark: ✅ ready, ⚠️ needs attention, ❔ cannot be
read, ❌ not working.

1. **Narrator card**. AdventureTime needs a character card to act as the
   narrator. Type a name, or keep *Game Master*, and press **Create narrator
   card**. Then open a new chat from that card in Lumiverse. The card can
   stay empty: the rulebook supplies the whole prompt.
2. **Passes have a connection**. This is ✅ as soon as AdventureTime knows
   which connection a blank row will use. **Open Connections & models** takes
   you to the rows (chapter 3).
3. **Function calling (optional)**. ✅ once the narrator has called the dice
   tool in a reply. It never blocks you: see *Function calling* in chapter 3
   for playing without it.

**Open Lumiverse checklist** shows two more checks, on output length and
context size. When the first two rows are ✅, the section folds to **Ready to
play**.

*Why a narrator card?* An adventure has many characters, so the story is
not credited to any one of them. It works like a book: one narrator, under
whom everything happens.

### Make your character

Three ways to make a character. Each writes a character sheet into the
Tracker widget. Open one at a time.

**Instant Action** is the fastest. Pick a genre. A name and an **Initial
setup (optional)** line are up to you; anything you leave out is rolled.
Details in the setup line win over the rolled ones, so "a level 7 ranger"
gives you a level 7 ranger. Then press **Begin Instant Action**. It:

1. rolls a character type from the genre, at level 1 unless you ticked the
   random level option;
2. writes the character sheet;
3. writes a *Player Card*, a short description of your character that the
   narrator sees on every reply, and makes a Lumiverse persona with the
   character's name;
4. sends the opening message, so the narrator starts the story. Turn that
   option off if you would rather type your own first action.

If the chat already has a character sheet, Instant Action asks before
replacing it.

**Character creator** lets you choose: name, class, level, background,
starting gear and more. Fill in as much or as little as you like and press
**Generate the character**. Ticks in the form add a Player Card and a
matching persona.

**From a persona, description or card** holds three more ways:

- **From the active persona** writes a sheet for the persona you have active
  in Lumiverse, using its name and description.
- **From the instructions** writes a sheet from a description you type. It
  needs a name, rolled or typed.
- **From a character card** turns one of your character cards into the
  player. **Fit into story** rewrites the character to suit the campaign.
  **Add as is** keeps the card's own writing.

Whichever way you choose, the sheet appears as cards in the Tracker widget
within a minute or so. If nothing appears, the note under the button says
why.

### After the character

**Narrator**, below the three ways, holds the main choices about how the
game is run (chapter 6). It is closed because the defaults work. **Learn
more** has a short explanation of the parts, model suggestions and a link to
Multihog's video walkthrough.

Then type what your character does and send it. Chapter 5 explains what
happens on each turn.

*Different from Multihog:* every chat is its own campaign here, always.
There is no Chat-Linked Mode to turn off, and no per-chat lock on modules: a
cartridge is how you carry a setup from one chat to another.

## 5. How a turn works

Understanding this loop helps more than knowing every setting.

### Before the narrator replies

When you send a message, AdventureTime adds its own messages to what the
narrator is sent. Lumiverse's **Prompt Breakdown** on a reply lists them by
name, in this order:

1. **AdventureTime — the rulebook**: the rules of the game.
2. **AdventureTime — the player**: your Player Card, if the chat has one.
3. **AdventureTime — the relations**: where each NPC stands with you, if the
   relationship system is on.
4. **AdventureTime — the choices**: the instruction to end the reply with
   action choices, if CYOA mode is on.
5. **AdventureTime — the dice**: this turn's pre-rolled dice, if the dice
   mode uses them.
6. **AdventureTime — tracker state**: the character sheet as the State
   Tracker last wrote it.
7. **AdventureTime — the world**: the newest World Progression reports, if
   that is on.
8. **AdventureTime — the map**: the list of mapped sites, and the full map
   of the site the party is in.

So the narrator always sees the last known facts before it writes the next
scene. These messages are added after your preset's own prompt. Nothing of
the preset is replaced.

A row that is missing is a part that is off or has nothing to send yet. If no
row starting with *AdventureTime —* is there at all, AdventureTime is off for this chat
or for every chat (chapter 2).

### After the narrator replies

When the reply is complete, the background passes run, one after another, in
this order:

1. *The State Tracker* reads the reply and updates the sheet. By default
   it runs after every reply.
2. *The Map Updater* runs if the party is inside a mapped site, and
   records what changed there.
3. *The Lorebook Agent* runs when its turn comes: by default after every
   third reply.
4. *World Progression* checks the in-world time and writes a report if one
   is due, when it is on.
5. *Map Evolution* checks whether enough in-world time has passed for any
   mapped site to change on its own.
6. Pictures are drawn, if you turned automatic drawing on.

The lights at the top of the Tracker widget show each one working.

Two things follow from this order:

- *The State Tracker runs after the reply.* The sheet the narrator sees on
  a turn is the one written after the previous reply.
- *A swipe or a regenerate is a new reply.* The State Tracker reads the new
  reply in place of the old one, and by default what the Lorebook Agent and the map
  passes wrote for the replaced reply is undone. The Lorebook Agent does not
  run again on a swipe, so swiping several times does not write lore for
  replies you discarded.

Nothing runs after a reply that failed, or while AdventureTime is off for
the chat. **Run tracker now** still works in both cases.

When something seems wrong, start with the lights. Chapter 21 has the rest.

## 6. The narrator and the rulebook

The narrator is the model that writes the story. What makes it a game master
is the *rulebook*: a set of instructions AdventureTime sends with every
reply. If the rulebook is not sent, the narrator no longer knows how to run
the game.

### The Narrator card

*Settings → Game systems & rulebook → **Narrator*** holds the main choices.
The same block is in **Starting the adventure**; a change in one place shows
in the other. Nothing needs to be applied: the next reply uses it.

- **Pacing & reply length**: **Normal**, **Shorter replies**, **High
  agency** (the narrator leaves more of the driving to you) or **Downtime /
  slice of life**.
- **Dice (RNG)**: where the dice come from (chapter 7).
- **Quests**: the quest log and its optional rules (chapter 9).
- **Optional components**: parts of the rulebook you can turn off.
  **Loot rolls**, **Random events**, **Rest limits** (at least nine in-world
  hours between rests), **Benched party** (companions who leave for a while
  are kept and return), **Persistent maps**, **CYOA mode** (chapter 8) and
  the **Relationship system**. Each is on as it ships.

### The rulebook's sections

*Settings → Game systems & rulebook → **Narrator rulebook*** lists every
section in the order it is sent, each with a switch and its cost in tokens.
The whole stock rulebook is roughly 6,000 to 7,000 tokens, sent with every
reply.

**Stock sections** are the rules that ship. There are 22, and this is the
whole list: **Role**, **Dice and rolls**, **Combat**, **Status footer**,
**Quests**, **Weapon proficiencies**, **Attacks per round**, **Saving
throws**, **Loot**, **Random events**, **XP and levelling**, **Relationship
tracking**, **Level-up protocol**, **Narrative pacing**, **World
Progression**, **Party mechanics**, **Resting**, **Homebrew and custom
classes**, **State memo reading**, **CYOA mode**, **Constraints** and
**Persistent maps**. No section is about spellcasting alone; spell slots
are kept by the tracker's spells module (chapter 10). A press on a section's
name turns it off or on. Turn a section off when you do not want that rule, or when your own
rule replaces it. A section marked **Your override** is a stock section
that your cartridge replaced with its own text.

**World rules** are your own sections, sent among the stock ones. A game
system made with the wizard adds one, and a cartridge can carry more
(chapter 16 covers both). Open a row to read exactly what the narrator is
sent. **Delete section** removes one for good, after a second press.

Two sections matter to the rest of AdventureTime, so leave them on unless
you know why you are turning them off:

- *State memo reading* tells the narrator to trust the character sheet it
  is sent.
- *Status footer* makes the narrator end each reply with a short line
  giving the time and the party's location. The Lore widget, the maps and
  the location images all read the location from that line.

### Your preset and the rulebook

The rulebook is sent after your Lumiverse preset's own prompt, and
replaces nothing. A lean preset works best: no role-play prompt and no
reply-format rules of its own, since two sets of rules pull against each
other.

### Turning AdventureTime off

- **AdventureTime is on in this chat**, at the top of the settings tab,
  turns it off for the open chat only, and hides the floating widgets
  while that chat is open.
- *Settings → State Tracker → Advanced tracker → **AdventureTime is on in
  every chat*** turns it off everywhere.

While it is off, nothing is added to the narrator's prompt and nothing runs
after a reply. The buttons still work.

*Different from Multihog:* there is no Custom Sysprompt Mode. The rulebook
is always its own message beside your preset, so there is nothing to
overwrite.

## 7. Dice

A model asked to "roll a d20" does not roll anything. It picks a number, and
it tends to pick one that lets the player succeed. AdventureTime gives the
narrator real random numbers in one of two ways.

### The queue

A list of fresh rolls is made by code and sent with the reply as
**AdventureTime — the dice**. The narrator takes the numbers from the list
in order and uses them.

*For:* any number of rolls in one reply, no pauses, and it costs nothing
extra. *Against:* the narrator can see the next number before it sets the
difficulty, so in free narration it could, in theory, set a difficulty you
will pass.

### The dice tool

The narrator calls a tool named `RollTheDice`. It must state who is
rolling, the dice and the difficulty (DC) *before* it sees the result. Then
the tool rolls and the narrator continues with the number.

*For:* the narrator cannot know the result in advance. *Against:* every
call pauses the reply and sends the whole story to the model again, which
costs tokens and time. It needs function calling (chapter 3).

### The three modes

Choose under *Settings → Game systems & rulebook → Narrator → **Dice
(RNG)***:

| Mode | What it does | Best when |
|---|---|---|
| **Pre-seeded queue only** | The queue with every reply. No tool. This is the default. | CYOA mode is on. |
| **Pre-seeded queue + tool calls** | The tool outside combat, the queue during combat. | CYOA mode is off. |
| **No dice rolls** | Neither. The narrator makes the numbers up. | Not recommended. |

*Why the queue suits CYOA mode.* Each choice button carries its difficulty,
such as *Pick the lock (DC 18)*, written at the end of the previous reply.
The narrator committed to the DC before the next queue existed, so it
cannot fit the DC to the roll.

*Why the queue suits combat.* Combat runs on a fixed turn order with
attack and defence numbers already on the sheet, which leaves nothing to
adjust. Combat counts as active while the character sheet holds a combat
card. In the second mode the tool goes away when combat starts and comes
back when it ends.

### Advanced dice

**Advanced dice**, under the modes, has switches for percentage rule
systems: **d100 mode** changes the rulebook's dice wording, the queue and
the tool to d100. The stock rules are written for a d20, so a d100 game
usually needs its own dice section as a world rule.

**Plain dice tool (no DC first)** is for a model that refuses the normal
tool. It gives up the protection of committing the DC first.

### Did the narrator really roll?

A roll in the story looks the same whether it was real or invented. The
line under the version line at the top of the settings tab tells you, for
the latest reply. It lists each tool call with its dice, DC and result.
Compare it with the numbers in the story: a roll in the story that is not
on the line was made up.

- *this reply: no calls*, with rolls in the story, means the narrator is
  inventing them. Check **Enable Function Calling** on the connection.
- *off* means the mode does not use the tool, which is normal with the
  queue.
- *away during combat* is the hand-over to the queue.

A quick test is to ask the narrator, out of character, to list its tools.

## 8. CYOA

With CYOA mode on, the narrator ends every reply with a few suggested
actions, and AdventureTime draws them as buttons under the reply. Press one
to send it as your message. You can always type your own action instead.

It is on as it ships. The switch is **CYOA mode** under *Settings → Game
systems & rulebook → Narrator → **Optional components***.

### Setting up the choices

*Settings → General & visuals → **CYOA mode*** sets how many choices there
are and what kind each is. Each row of **Choices, in order** is one choice:

- **Decided by the narrator**: whatever fits the scene.
- **Plain action**: an action with no roll.
- **Prefixed**: starts with a word you set, such as a mood or a style.
- **Trait or ability**: uses one of your character's traits or abilities.
  Name one, or leave it to the narrator.

**Add choice** adds a row. **Save as preset** keeps the list under a name,
and **Load** brings a saved list back. **Write the instruction myself**
replaces the built instruction with your own text.

The other switches are best left on:

- **Wrap choices in a <choices> block** is how AdventureTime finds the
  choices. Without it no buttons can be drawn.
- **Trim old choices from the prompt** sends only the four newest choice
  lists to the narrator. Older lists are left out, which saves tokens.

Old choices are also kept away from the State Tracker and the Lorebook
Agent: a choice is something that might happen, not something that did.

The best dice mode with CYOA is **Pre-seeded queue only** (chapter 7). The
tool also works, but the narrator then calls it after nearly every choice,
which costs tokens and time for no gain.

## 9. Quests

With **Track quests** on (*Settings → Game systems & rulebook → Narrator →
**Quests***), the narrator keeps a quest log and the State Tracker draws it
as quest cards in the Tracker widget.

A quest is logged when your character accepts a task, not when one is
merely offered. The narrator marks the moment in the story with a line such
as *(Quest Accepted: The Missing Ledger)*. A goal you set for yourself can
become a quest too; the narrator marks it *(Emergent Quest Active: …)*.

A quest card shows who gave the quest, the reward, the objectives done and
still open, and its state: **Active**, **Completed**, **Failed** or **Past
Deadline**.

### Optional rules

These appear under **Track quests**, and all are on as they ship:

- **Deadlines**: a quest can have a time limit, counted on the in-world
  clock. The card shows the time left.
- **Questgiver frustration (experimental)**: for a quest an NPC gave you,
  running late sours the quest giver's mood step by step, where otherwise
  the quest would simply fail at the deadline. Some quest givers are
  patient and some are not. It needs **Deadlines**.
- **Show closed quests**: completed and failed quests stay on the cards
  after they close.

Difficulty is the story's business. Nothing stops a level 2 character
from accepting a dragon hunt, and nothing softens it afterwards.

### If a quest is wrong

The quest log is part of the character sheet, so the State Tracker fixes
it. Open the instruction bar with **💬** in the Tracker widget's footer and
say what is wrong, such as "mark The Missing Ledger as completed". Chapter
10 covers the instruction bar.

## 10. The State Tracker

The State Tracker is the accountant. It does not write story and it does not
own the rules. After each reply it reads what happened and updates the
character sheet, and on the next turn the narrator is sent that sheet. This
is what keeps your HP, your inventory and the clock right long after the
messages that set them have been summarised away.

The tracker reads plain language. The story does not need exact wording: if
the information is there and clear, the tracker can record it.

### Modules

The sheet is made of *modules*. Each module is one card in the Tracker
widget, one instruction telling the tracker what to record, and one block of
the sheet. There are ten stock modules, and this is the whole list:

- *Character*: your own sheet. HP, attack and defence numbers, attributes,
  saves, skills, traits and status.
- *Party*: your companions, each with a sheet like yours. Up to five by the
  stock text.
- *Benched party*: companions who are away for a while but expected back.
  You can send a companion off on a task; when their return time comes the
  narrator rolls for how it went, so choosing the right person matters.
- *Combat*: the enemies in the current fight, with their HP and numbers. It
  empties when the fight ends.
- *Inventory*: what you carry, with each item's rarity and worth, and which
  items are equipped.
- *Abilities* and *Spells*: class features, and spells with their slots
  drawn as dots.
- *Time*: the in-world clock and date, and the last long rest. World
  Progression and Map Evolution both run on this clock.
- *XP*: experience and level.
- *Quests*: the quest log (chapter 9).

*Settings → State Tracker → State Tracker → **Tracker modules*** lists them.
Each row has a switch, **Edit text** to change what the tracker is told
(**Reset to stock** undoes it), and **▲** **▼** to move its card up or down.
Your own modules are *custom fields*; chapter 16 covers them.

### The Tracker widget

- A click on a card's header folds it. A click on any bar opens its colour
  settings. A click on a portrait opens it large, with buttons to change it.
- **Compact** on the Party card hides the companions' sheets and leaves
  portrait, name and HP.
- **Run tracker now** runs a pass without sending a message. **Stop**
  appears while a pass runs and leaves the sheet as it was.

The footer, from the left:

- **←** and **→** step back and forward through earlier states of the
  sheet. **LIVE** means you are looking at the current one. While you are
  on an earlier state, **Restore this state** makes it the current sheet.
- The in-world time and the party's location.
- An estimate of the sheet's size in tokens, which is what it costs to send
  on each turn.
- **δ** opens the **Change Log**: the lines the last pass removed and
  added.
- **CLEAR** empties the sheet, after asking. The earlier states are kept,
  so you can step back and restore one.
- **💬** opens the instruction bar.

### Telling the tracker what to do

The instruction bar is how you correct the sheet. Type what you want in
plain words, such as "add a healing potion to the inventory" or "the
innkeeper's nephew left the party", and send it. The tracker makes that
change and nothing else. **Lookback:** is how many recent messages it reads
along with your instruction.

To edit the sheet by hand, open **Raw tracker memo** in the settings tab,
change the text and press **Save memo**. **Revert** discards your edit.

### Useful settings

Under *Settings → State Tracker → **Advanced tracker***:

- **Replies between tracker passes**: 1 runs a pass after every reply,
  which is recommended.
- **Full Review Mode**: every pass writes the whole sheet. Use it with a
  small or local model (chapter 3), and raise **Pass output length** with
  it.
- **Send lorebooks to the tracker**: every pass starts with the world's
  lore, so the tracker knows the names and places. It reads the lorebooks
  linked to the chat unless you tick others under **Lorebooks the tracker
  reads**. It costs tokens on every pass, so it is off as it ships.
- **Roll back the memo on a swipe**: a swipe starts from the sheet as it
  was before the replaced reply, so nothing is counted twice.

Under *Settings → General & visuals → **Appearance***:

- **Tracker layout**: **Stacked** shows every card, one under another.
  **Tab Mode** keeps the Character and Combat cards at the top with the
  party's portraits under them, and shows the other cards one at a time
  behind a row of tabs. It suits a small screen.
- **Tracker card under each message** draws the sheet, as it stood after
  that message, under each reply in the chat.

*Settings → State Tracker → **Display groups*** lets several cards share
one header. Turn on **Enable display groups**, press **+ Create display
group**, name it and tick its modules. The Combat, Quests and Benched party
cards cannot be grouped.

If the sheet is wrong, chapter 21 lists what to check.

*Different from Multihog:* there are no slash commands. **Run tracker now**
and the instruction bar do the same jobs.

## 11. Display markers

A *display marker* is a short code in double brackets that tells a card how
to draw a line. The tracker writes the line; the marker turns it into a bar,
a row of pills, a badge and so on. For example:

```
Attunement: ((BAR)) 640/1000
Mood: ((PILL)) Steady
Trust: ((BARREL)) -38/150
```

The first draws a bar filled to 640 of 1000, the second a coloured pill, the
third a bar that grows left or right from the middle, for a value that can
be negative.

You meet markers when you write your own module, or when the game system
wizard writes one for you (chapter 16 covers both). The stock modules
do not need them.

*Settings → State Tracker → **Display marker library*** shows every marker
with a live example, and a **?** on each explains it. The main families:

- pills and badges, for states and tags;
- bars, for anything with a current and a maximum value, and the signed bar
  for values around zero;
- progress, gauges, charges, slots, orbs and stars, for counters;
- currency, weight and capacity;
- clocks, phases and steps, for things that advance in stages;
- alert styles, for warnings and good news;
- a card for an NPC inside a module, which shows that NPC's portrait when
  the Lorebook Agent has recorded them.

*Colour.* Add a colour name to the marker, as in `((BARCYAN))`, or after a
dash, as in `((PILL - rebeccapurple))` or `((BAR - #ff6699))`. Two colours
make a gradient. A click on a bar in the Tracker widget changes its colour
without touching the module.

A marker spelled wrong is drawn as plain text. If a line shows its brackets,
check the name against the library.

## 12. The Lorebook Agent

If the State Tracker is the accountant, the Lorebook Agent is the librarian.
It reads the recent story and writes what should be remembered into
lorebooks: the people you met, the places you went, the factions, the
events. Lumiverse then brings an entry back into the narrator's view when
the story mentions it. Paired with a summariser (chapter 1), this is the
campaign's long-term memory.

### When it runs

By default it runs by itself after every third reply, and reads every
message since it last ran. It works in several steps: it looks at what the
lorebooks already hold, decides what is new, and writes. The second light
at the top of the Tracker widget shows it working.

Everything else is on the Lore widget's **Lorebook Agent** tab:

- **Run the agent now** runs a pass at once.
- The bar under it takes an instruction, such as "record the harbour
  master as an NPC" or "the old mill burned down; update its entry".
- **← Undo the last pass** takes back what the last pass wrote. **Redo →**
  writes it again.
- **⏸ Pause the agent** stops the automatic passes until you resume. The
  buttons still work.

*Automatic passes are careful on purpose.* An automatic pass sees only a
few messages, so it may add to an NPC but may not rewrite who they are:
their species, personality and background are protected. To change those,
give the agent an instruction, or edit the entry yourself (chapter 13).

### The campaign and its lorebooks

Each chat is one campaign. **Campaign**, on the same tab, shows the
**Campaign name**. A new chat names itself after the narrator card and the
time; you can type your own. The campaign's lorebooks start with that name:
one for NPCs, one for locations, and so on.

The agent only ever writes to its own campaign's lorebooks. It cannot touch
any other lorebook you have.

Under the name is the list of lorebooks, each with a dot:

- grey: not made yet. The agent makes it when it first needs it.
- green: attached, so the narrator sees it.
- red: made but not attached, so the narrator does not see it. Press
  **Attach**, or **Attach all to this chat**.
- amber: a lorebook with the right name that this campaign did not make.
  **Adopt** takes it over.

**Attach new lorebooks automatically** is on as it ships, so red is rare.
**Check again** reads the list afresh. Lumiverse's own lorebook panel may
need a page refresh before it shows a lorebook attached from here.

### What it records

**Modular Repertoire (Prompt Rules)** lists the categories the agent
records, each with a switch and **Edit the instruction**. There are six
stock categories, and this is the whole list: *NPC* (people), *LOC*
(places), *FAC* (factions), *QUEST*, *EVENT* and *WORLD*. *WORLD* is World
Progression's lorebook: the agent never writes to it, whatever its switch
says. Under the list, **Add a tag** makes a category of your own, which
gets its own lorebook.

The sections every NPC is recorded under (species, body, worn equipment,
personality and so on) are set under *Settings → Lorebook Agent →
**Character sheets***.

### The terminal

**Terminal / direct prompt** has a tab for each background part: **State
Tracker**, **Lorebook Agent**, **Map Updater**, **Map Evolution** and **Map
Architect**. Each tab shows its last pass step by step as it runs, and has
a bar for sending that part an instruction. When something did not happen,
this is where to read why.

### Keeping the lorebooks tidy

- **🧹 Cleanup** asks the agent to shorten entries that have grown long.
  An NPC's core description and any map are kept whatever it writes.
- **📕 Full audit** runs the whole chat through the agent in pieces, to
  build the lorebooks for a chat that was played without it. It makes many
  model calls, asks first, and can be stopped with **Stop the audit**. Do
  not send messages while it runs.
- **⧉ Clone the books** copies the campaign's lorebooks under a new name.

A branch made with Lumiverse's own branch button keeps its campaign: the
sheet, the lorebooks' ownership and the rest are copied into the new chat.

### Settings worth knowing

Under *Settings → Lorebook Agent → **Agent passes***: **Replies between
automatic passes** (0 means only when you press the button), **Research
turns** (how many steps one pass may take; lower is faster) and **Roll back
the agent pass on a swipe**.

*Different from Multihog:* the agent has one way of working, the step-by-step
one Multihog calls Advanced. Lumiverse decides which entries are active in
the prompt, so there is no pool of active entries to manage here; **Active
Lore Keys** shows what Lumiverse has active.

## 13. Campaign Records

The Lore widget's **Campaign Records** tab is the campaign's memory laid
out to read and edit.

### The Player Card

At the top is your own character's card: a description the narrator is
sent with every reply, as **AdventureTime — the player**. Instant Action
writes one; the other ways to make a character offer it as a tick.

**Full PC Card** opens it. There you can **Edit the text**, ask for changes
with **✨ Edit with AI**, or have it written again from the sheet. The agent
keeps your body and worn equipment up to date from the story and leaves the
rest alone.

### NPCs

Every NPC the agent has recorded is a card: portrait, name, a short
summary, whether the entry is active, and two relationship bars. On a card:

- **Full NPC Card** opens the whole entry, with the relationship values and
  their history.
- **✨ Edit with AI** rewrites the entry from a request you type. You see the
  result and can change it before you press **✅ Apply**.
- The small buttons save the NPC to the library, pin the entry so it is
  always in the prompt, edit its text, clean it up, or delete it.

The **⚙️** on the NPCs header has the settings for these cards, including
**Show NPC portraits**.

### Relationships

Each NPC has two values toward your character, **Friendship** and
**Affection**, each drawn as a bar from the middle. The labels under the
bars put the value in words, and the narrator is sent every NPC's standing
with each reply as **AdventureTime — the relations**.

The values move as the story goes: by default the State Tracker reads each
reply and applies the changes, and a small note floats up over the Tracker
widget when one lands. The agent sets a starting value when it first
records an NPC. You can set a value yourself in the Full NPC Card, with the
slider or the number box. **Clear Log** empties the history and keeps the
values; **Forget the standing** resets both.

**Values move by** and **Scale ±**, under the **⚙️**, choose who moves the
values and how far they can go. The **Relationship system** switch is there
too, and on the Narrator card.

### The NPC library

The library belongs to your install, not to one campaign. It keeps
characters you want to use again. **👥 NPC/PC Manager**, on the NPCs
header, opens it.

- **📌 Save from this campaign** lists the campaign's NPCs and your Player
  Card to save. **📥 Import a package** loads a shared character file.
- On a library card: **+ Add to Party** seats them as a companion, **🌍 Add
  to world** records them as an NPC of this campaign, and **▶ Play as PC**
  makes them your character.
- **🗂 Full card** opens the text and the photo. **🎨 Draw the photo** has
  an image model draw one.
- **Export** writes one file with the portrait inside, to share.

The same window has the **NPC creator**, which writes a new NPC straight
into the campaign: from one of your character cards (**🎴 From a card**),
from a role (**🎭 Archetype**), or from your own description (**✍️
Freeform**). You see the draft before **✅ Add NPC** saves it.

Lumiverse's character editor also has an AdventureTime tab, which sends
the card you are editing to the library or to the open chat.

### Locations and the other lorebooks

Under the NPCs are the locations and the campaign's other lorebooks, each
entry with the same edit, pin, clean and delete buttons. A location that
holds a map says so; the map itself is on the **Visuals/Map** tab (chapter
14 covers maps). **Refresh** reads everything again.

## 14. Persistent maps

A persistent map is a hidden floor plan of a place: its rooms, how they
connect, and who and what is in each. The narrator is given it as fixed
fact, so a room does not move between visits and a dead guard stays dead.
You see only what your party has seen.

Maps are on as they ship. The switch is **🗺️ Persistent maps** on the
Narrator card. With it off, no map is drawn, sent or changed.

### What gets a map

Three kinds of place get one:

- a *dungeon*: a dangerous site, room by room;
- an *interior*: a large safe building, such as a guild hall or a palace,
  room by room;
- a *settlement*: a town or city, district by district.

An ordinary shop, inn or house inside a settlement does not get a map of
its own. It is a building on the settlement's map, and it is filled in the
first time the party walks in.

### How a map is made

When the party reaches a place that deserves a map, the narrator asks for
one and the **Map Architect** draws it in two model calls: the layout, then
the contents. The reply does not wait. The narrator holds the scene at the
entrance, and the finished map reaches it from the next turn.

**How the narrator asks for a map**, on the Narrator card, has two
settings:

- **Tool call (CreateAreaMap)** needs function calling on the narrator's
  connection.
- **Text block** works on any connection. The narrator ends its reply with a
  short request, which is taken out of the reply once it is read.

You can also make a map yourself in **Campaign Records**. **+ MAP** on a
location draws a map for it. **Auto** works out the details from the
location's lore and the recent story; **Manual** lets you fill them in.
**+ Add Mapped Location** makes a new location and its map in one step.
The **×** beside a **MAP** badge removes the map and keeps the location.

### Maps inside maps

A map can sit inside another: a cellar under a manor, a manor in a town.
The chain can be three maps deep. A settlement is always the outermost.
When you add a settlement by hand, you can tick existing dungeons and
interiors to place inside it.

### The map on screen

The Lore widget's **Visuals/Map** tab draws the site the party is in, under
**Site map**. Rooms the party has visited are named. A room they know of
but have not entered is dim, and an unexplored neighbour is a dashed
**?**. Your room has a bright outline. Small symbols show who and what is in
a room; hover one to read it. Something killed stays on the map, crossed
out.

Drag to move around. Click a room to read its entry. The **Site** box draws
any other mapped site. **Reveal all** shows every room and everything in
them, so leave it off unless you want to see behind the curtain.

**Map Details** opens the map's entries and **Evolution history**. With
**Reveal all** on, it also has **Raw JSON**, where you can edit the map
directly and press **Save JSON**.

The narrator is sent the map of a site only while the party is inside it.
Where the party is comes from the location line at the end of each reply.

### The Map Updater

After each reply inside a mapped site, the **Map Updater** records what
changed there: who moved, what was killed, opened or taken. A swipe undoes
the update with the reply. **Update the map now**, behind the **💬** beside
**Site map**, runs one without a reply, and does what you type in the box
if you type something.

### Map Evolution

**Map Evolution** changes mapped sites as in-world time passes, mainly
while the party is away: patrols move, a camp is abandoned, something new
moves in. It follows the clock on your character sheet, so it needs the
tracker to keep the time. A site the party is away from changes about every
8 in-world hours; the site the party is in, every hour, and never in the
room they are standing in.

The **🗺️ Map Evolution** drawer in the Lore widget's **Lorebook Agent** tab
has the switch, the hours, **Evolve now**, and **Reset timeline**, which
restarts every site's clock. **Named sites and their hours** gives one site
its own interval; 0 means that site never changes by itself.

**🧪 Testing ground**, in the same drawer, is a sandbox for one site. You
can **Set time** or **Advance hours**, **Create entity**, **Kill / change
entity**, run **✨ Evolve this map now** or **⏩ Simulate ticks**, and take
the last pass back with **↶ Undo last pass**. It changes the real map and
the real clock, so use it to learn how a site behaves, or to fix one.

### Map settings

*Settings → **Persistent maps*** has a card for each of the three passes,
the prompts they use, and **Map themes**, which sets the colours of the map
picture. **📂 Load preset** takes a built-in theme (**Ember**,
**Blueprint**, **Verdant**, **Parchment**, **Blue & White**), and **💾
Save preset as** keeps your own.

Each pass has a row under *Settings → **Connections & models***. A blank
row uses the Lorebook Agent's connection.

*Different from Multihog:* the narrator's reply does not pause while a map
is drawn; the map arrives on the next turn.

## 15. World Progression and the World Skeleton

World Progression makes the world move while your party is busy elsewhere.
Every in-world day it writes a short *world report*: what changed at a few
of the campaign's locations, and a paragraph on wider events. The narrator
reads the newest report with every reply, so a rumour can reach the party
and a town can be different when they come back.

It is off as it ships, since each report is one more model call. Turn on
**Write reports** in the **🌍 World Progression** drawer of the Lore
widget's **Lorebook Agent** tab, or under *Settings → **World
Progression***.

### How reports are timed

AdventureTime decides when a report is due, not a model. It reads the clock on
your character sheet after each tracker pass. When **In-world hours between
reports** have passed (24 as it ships), one report is written. The clock
starts on the first tracker pass after you turn the switch on, so the first
report comes one interval later.

In the drawer:

- **Write a report now** writes one without waiting.
- **Next report at** sets the in-world time of the next one.
- **Reset the timeline** starts the count again from the current time.
- **Consolidate** merges the oldest reports into one summary.
- **Purge history** deletes every report and the skeleton. It cannot be
  undone.

### What a report covers

Each report covers a few locations (**Locations per report**, 3 as it
ships), taking the ones reported on longest ago first. It writes about
places and factions, never about a named person's private life. The
locations come from what the Lorebook Agent has recorded, so a new campaign
has little to report on until the agent has written some places down, or
until you make a skeleton.

Reports are kept in the campaign's World lorebook. The narrator is sent the
newest as **AdventureTime — the world**. Map Evolution reads them too, and
turns a report about a place into concrete changes on that place's map.

### The World Skeleton

The skeleton is a starting sketch of the world: factions, locations and
conflicts as they stand on day one. It gives the reports something to work
from in a new campaign.

Under *Settings → World Progression → **World Skeleton & atmosphere***:

1. Write a few sentences in **World description**, or press **Write from
   this chat** to have one written from the story so far.
2. Press **Generate skeleton**.

**Add to skeleton** writes more and keeps what is there; **Generate
skeleton** replaces it. **Read lorebooks as canon** has the skeleton follow
lorebooks you already have. When the agent later records real lore for a
skeleton location, the real lore takes over.

*Different from Multihog:* a report is dated at the in-world clock when it
is written, so a time skip does not produce reports dated in the past.

## 16. Game systems and cartridges

### The game system wizard

A *game system* is a mechanic of your own: hunger, reputation, fuel,
sanity. It has two halves that must agree: a rule the narrator follows, and
a tracker module that keeps the numbers. The wizard writes both from a
plain description, so you do not need to know how either works.

Under *Settings → Game systems & rulebook → **Game systems & custom
fields***, in the **Game system wizard**:

1. Describe the mechanic and press **Draft system**. A strong model gives
   the best result.
2. Read the two halves. **Card preview** shows how the card will look on
   the Tracker widget.
3. To change something, say what and press **Revise draft**, or rewrite one
   half with **Rewrite narrator rule** or **Rewrite tracker module**.
4. Press **Save and turn on**.

**How the value moves** is the choice that matters most:

- **With in-world time**: the tracker moves it as the clock moves. Good for
  hunger or fuel.
- **When the narrator annotates a change**: the narrator writes a short
  note in its reply each time the value changes, and the tracker reads it.
- **From a number in the story**: the tracker reads plain numbers the story
  states.

A saved system shows as a card on the Tracker widget after the next tracker
pass. Its narrator rule is listed under **World rules** (chapter 6) and its
module under **Custom fields**. **Edit in wizard** opens a saved system
again. **Export system** and **Import system** share one as a file.
**Copy as text** shows a system as text in Multihog's format, and **Paste
system text** reads text like that, copied from here or from Multihog's own
Game Systems export. A pasted system opens in the wizard's preview, where you
read it and change it, and nothing is saved until you press **Save and turn
on** or **Save, leave off** there.

### Custom fields

A *custom field* is a tracker module you write yourself, with no narrator
rule. **Add field** asks for:

- **Tag**: the block's name on the sheet, such as `QUIVER`.
- **Name** and **Icon**: what the card shows.
- **Instruction**: what the tracker should keep there and when to change
  it, with an example of the block. Chapter 11's display markers go in the
  example.

Each field has a switch, and that switch is also how you turn a game
system off. **Delete field** removes one, and asks first.

### Cartridges

A *cartridge* is your whole setup in one file. *Settings → General &
visuals → **Cartridges*** has **Export cartridge** and **Import
cartridge**.

A cartridge carries the rules and the prompts:

- the narrator's settings, the rulebook's switches and your world rules;
- the tracker's prompt, its modules and their order;
- game systems and custom fields;
- the CYOA setup;
- the character sheet sections;
- the Lorebook Agent's prompts, modules and custom tags;
- the map and world report prompts;
- the portrait prompts and saved setups.

It does not carry your connections, the Appearance settings, the timing and
size settings of the passes, or anything of a campaign: no character sheet,
no lorebooks, no maps.

Importing replaces every one of those rules and prompts with the file's, so
export your own first if you may want it back. *Settings → General &
visuals → Debug & factory reset* puts the stock setup back.

*Different from Multihog:* a game system applies to every chat; there is no
choice between a chat-bound and a global one. AdventureTime loads
Multihog's cartridges as they are.

## 17. Pictures

AdventureTime can show portraits on cards and a picture of the place the
party is in. You can set any picture from a file. To have pictures drawn,
Lumiverse needs an image connection; choose it under *Settings →
**Connections & models***. A text model writes the image prompt first, on
the connection of the **Portrait prompts** row.

Everything else is under *Settings → General & visuals → **Portraits &
location images***.

### Portraits

**Show portraits on cards** is on as it ships. Click any portrait, or the
empty box where one would be, to open it large. Under it are **🖼 From a
file**, **🎨 Draw** and **🗑 Remove**.

**Draw automatically for** has four ticks, all off as they ship: **Player
character**, **Party members**, **Combat enemies** and **Lorebook NPCs**.
With a tick on, whoever it covers and has no portrait is drawn after a
tracker or agent pass, one at a time. Ticking a box draws everyone it
covers now.

### The prompt editor

When you press a draw button, the image prompt is written and shown to you
first. Change it if you like, then press **🎨 Draw**. **📋 Copy the prompt**
copies it. **Cancel** draws nothing. **Skip the prompt editor** draws at
once. Automatic draws never ask.

**Image prompt prefix** is text put in front of every image prompt, exactly
as you type it. Use it for a trigger word or a tag your image model needs.

**Use the story in the prompt** gives the prompt writer the recent
messages, so a portrait can show the character as they are now.

### Location images

**Show location images** is off as it ships. With it on, the Lore widget's
**Visuals/Map** tab shows the picture of the party's place at the top, and
each location in **Campaign Records** has a small one. The buttons under
the picture set one from a file or an address, draw one, or remove it.

**Draw location images automatically** draws after a reply, by its
**Trigger**:

- **On arrival at a location with no picture**;
- **When the location changes**, the default, which also redraws a place
  you return to;
- **Every N replies and when the location changes**.

If an automatic draw fails, the switch turns itself off and a note says
why. Tick it again when the cause is fixed.

**Include present NPCs in the picture** adds the people in the scene.
**Use location image as chat background** puts the picture behind the chat.

### Art styles

**Art styles** has seven built-in looks: **Fantasy (Default)**, **Anime**,
**Photorealistic**, **Oil Painting**, **Comic Book**, **Watercolor** and
**Dark Fantasy**. **Load** on a style replaces the three prompt texts under
**Portrait prompt templates**. Edit those texts for your own look, and
**Save setup** keeps them under a name. Saved setups travel in a cartridge.

*Different from Multihog:* pictures are drawn through Lumiverse's own image
connections; there is no separate picture service to set up.

## 18. Appearance

*Settings → General & visuals → **Appearance*** sets how AdventureTime
looks. Nothing here changes how the game plays, and none of it travels in a
cartridge.

### The widgets

Chapter 2 covers moving, folding and hiding the widgets, the buttons that
bring one back, and **One window**. Chapter 10 covers **Tracker layout**
and **Tracker card under each message**.

### Themes

**Visual theme** sets the colours and fonts of the widgets, the settings
and the cards under messages:

- **Match Lumiverse**, the default, follows your Lumiverse theme.
- **Hacker**, **Fantasy**, **Hologram**, **Pacific Cove** and **Cherry
  Blossom** are built in.
- **✨ Custom (AI wizard)** opens the **AI theme wizard**. Describe a look
  and press **Generate**. **Refine** changes the current theme by what you
  type, **↶ Undo** steps back, and **🔖 Save to library** keeps it under a
  name.

**Choice buttons** sets how the CYOA buttons under a reply are drawn:
**Tinted** by the theme, **Solid backing**, or **Solid on hover**. A solid
backing is easier to read over a busy chat background.

**Day/night cycle** tints everything by the in-world time of day, from dawn
to late night, and shows a sun or a moon at the top of the Tracker widget.
It follows the clock on your character sheet. It is off as it ships.

### Bars

**XP bar at the bottom of the Tracker widget** pins your experience as a
bar at the foot of the widget instead of a card. It is on as it ships.

**Animate custom bar changes** makes a bar show what it gained or lost when
a tracker pass changes it.

Click any bar on a card to open **Bar Settings**: one colour, a gradient,
or colours that change with the value, and whether the bar reads as a
percentage.

### Sizes and backdrops

**Font sizes** has three sliders: **Tracker widget font size**, **Lore
widget font size** and **Settings font size**. Each follows Lumiverse's own
size until you move it.

**Tracker widget backdrop** and **Lore widget & settings backdrop** put a
picture behind a widget. Each takes a day image and an optional night
image, uploaded or from an address, and **Tint strength** sets how much the
picture is dimmed so the text stays readable. The night image shows during
the in-world night.

Map colours are separate: see **Map themes** in chapter 14.

## 19. Playing without D&D

The D&D rules are the setup AdventureTime ships with, not something it
depends on. The parts that do the work are a clock, a character sheet and
the optional lore, map and world layers. What goes on the sheet, and what
rules the narrator follows, is yours to change.

There are three levels, from least effort to most.

### Reskin: keep the rules, change the world

Nothing needs changing in the settings. The stock rules are d20 rules, and
they run a modern or science-fiction story as well as a fantasy one.

- In the **Character creator**, **Genre** offers classes for several
  settings, and **Instant Action** has the same genres.
- Write your setting into **World description** (chapter 15) and into your
  first message.

### Adjust: turn parts off and add your own

- *Settings → Game systems & rulebook → **Narrator rulebook*** lists the
  stock rules. Turn off the sections you do not want, such as **XP and
  levelling** or **Resting**. Add your own as **World rules**.
- *Settings → State Tracker → State Tracker → **Tracker modules***: turn
  off the cards you do not need, such as the spells module.
- Add what your game needs with the **Game system wizard** or a custom
  field (chapter 16): stress, heat, reputation, ammunition, ship fuel.
- In the **Character creator**, **No levels (custom system)** makes a
  character without a level.

### Replace: your own system

Turn off every stock rulebook section your system replaces and write your
own rules as **World rules**. Rewrite the tracker modules with **Edit
text** so the sheet holds your system's numbers, or turn them off and
build the sheet from custom fields.

Three things to keep, whatever you change:

- *The time module.* World Progression, Map Evolution, quest deadlines, the
  day/night cycle and any game system that moves with time all read the
  clock on the sheet. Without it they stop.
- *The status footer.* Maps, location images and the Tracker widget read
  the party's location from it (chapter 6).
- *The dice.* The dice do not care what they are rolled for. Leave **Dice
  (RNG)** as it is, and tell the narrator in your rules how your system reads a
  roll.

When it works, **Export cartridge** (chapter 16) saves the whole setup as
one file, to keep or to share.

## 20. On a phone

AdventureTime works on a phone, with a few differences from a desktop.

- *The widgets start hidden*, so the chat is clear when you open it. A
  round d20 button floats over the chat, at the bottom right. Tap it to
  open AdventureTime; drag it to move it.
- *A widget opens full-screen.* Its **×** closes it, and the d20 button
  comes back. There is no folding or resizing.
- *One window is the default.* The Tracker widget and the Lore widget are
  one box with five tabs, drawn as icons with a short word under each: the
  Tracker, the Lorebook Agent, Campaign Records, Visuals/Map and the
  Companion. The lights sit on their own line under the title.
- *Hover notes are not available*, since nothing hovers on a touch screen.
  The small icon buttons carry a word beside the icon instead.
- *A long press on a widget* opens Lumiverse's own widget menu. That is
  Lumiverse's, not AdventureTime's.

The AdventureTime tab in Lumiverse's drawer starts with **Show
AdventureTime**, which opens the box if you turned the d20 button off, and
the **Mobile widget** tick, which is that button's switch.

To use the two separate widgets on a phone, turn **One window** off under
*Settings → General & visuals → **Appearance***. That choice then applies
on every device you use.

**Tab Mode** (chapter 10) suits a small screen.

## 21. Troubleshooting

Start with three checks. Between them they explain most problems.

1. *The version line*, at the top of the settings tab. After an update
   the version should have changed; if it has not, update the extension
   again in Lumiverse and reload the page. A missing permission is named
   there in a bordered warning.
2. *The lights* at the top of the Tracker widget. A red light means the
   last pass of that kind failed; hover it to read why.
3. *The terminal* in the Lore widget's **Lorebook Agent** tab. Each of its
   tabs shows what the last pass of that kind did, and its earlier passes.
   Read the time on a report before its text, so you are not reading an
   old one.

Then find the symptom below. Each entry gives the likely causes in the
order to check them.

### Nothing happens after a reply

- **AdventureTime is on in this chat**, the first row of the settings tab,
  is off. The Server Logs say `framework: off for chat`.
- **AdventureTime is on in every chat** is off (*Settings → State Tracker →
  **Advanced tracker***). The Server Logs say `framework: off;` with no
  chat named.
- The passes have no connection to run on. **Open Lumiverse checklist**, in
  the starting area, names the connection a blank row uses, or says there
  is none.

### The sheet is wrong or does not change

- Read the tracker's report: the terminal's **State Tracker** tab. It says
  what the pass changed, or why it changed nothing. **Earlier passes**
  lists the ones before it.
- The reply was cut off partway. Raise **Pass output length** (chapter 3).
- Parts of the sheet go missing on a small or local model. Turn on **Full
  Review Mode** (chapter 10).
- One number is wrong. Tell the tracker with the **💬** bar at the foot of
  the Tracker widget: "set my gold to 40".
- No XP card: **XP bar at the bottom of the Tracker widget** is on, and the
  XP is the bar at the foot. Party members show only a name and HP: the
  Party card's **Compact** button is on.

### The narrator ignores the sheet, the rules or the lore

- Open Lumiverse's **Prompt Breakdown** on the reply. The AdventureTime
  messages (chapter 5) should be listed. If none is, AdventureTime is off
  for the chat; if one is missing, its part is off or has nothing to send.
- A rule is ignored: its rulebook section is off, or your preset tells the
  narrator something that conflicts. A plain preset works best.
- An NPC or a place is forgotten: the lorebook's dot in the **Campaign**
  drawer should be green. If it is red, press **Attach all to this chat**
  (chapter 12).

### Dice

- Rolls in the story that are not on the dice line (chapter 7): the
  narrator is making them up. Check **Enable Function Calling** on the
  narrator's connection, or set **Dice (RNG)** to **Pre-seeded queue
  only**, which needs no tools.
- The player always wins: the same cause, and the same fix.

### Choices

- No buttons under a reply: the reply has no choices in it. The narrator
  forgot, or CYOA is off on the Narrator card. Swipe, or continue without
  them.
- The choices show as plain text above the buttons: turn on *Settings →
  General & visuals → CYOA mode → **Hide with a Lumiverse regex script***.
  It installs a script in Lumiverse that hides the raw block.
- The buttons are hard to read over a background: *Settings → General &
  visuals → Appearance → **Choice buttons*** gives them a solid backing.

### The Lorebook Agent

- It never runs by itself: it is paused (**▶ Resume the agent**), or
  **Automatic agent passes** is off, or fewer replies have passed than
  **Replies between automatic passes**.
- It ran and wrote nothing: read its report in the terminal. Often nothing
  new happened that was worth recording.
- An entry is wrong: edit it in **Campaign Records**, or tell the agent
  with its instruction bar.
- It wrote something you did not want: **Undo the last pass**.
- No card for someone you met: the agent has not run since, or did not
  think them worth recording. Tell it to.
- A relationship did not move: the Full NPC Card's history shows every
  change. If there is none, the reply gave no reason, or the name in the
  story does not match the entry's name.

### Maps

- No map is drawn: **🗺️ Persistent maps** is off; or the narrator's
  connection cannot call tools, in which case set **How the narrator asks
  for a map** to **Text block**; or the place does not deserve one (an
  ordinary shop or house never gets its own). **+ MAP** in **Campaign
  Records** draws one whenever you want it.
- The map is drawn but the tab shows nothing: the last reply's location
  line does not put the party inside the site. Choose the site in the
  **Site** box, and check that the narrator still ends replies with the
  location line.
- The map does not change with play: **Update maps during play** is off,
  or the party is not inside the site.
- Sites never change while the party is away: **Evolve sites over in-world
  time** is off, or the clock on the sheet is not moving.

### World Progression

- No report ever comes: **Write reports** is off (it ships off); or the
  clock on the sheet has not moved a full interval since you turned it on.
  **Write a report now** makes one at once.
- A report has only the wider paragraph and no places: the campaign has no
  recorded locations yet. Play on so the agent records some, or make a
  skeleton (chapter 15).

### Pictures

- Nothing is drawn: Lumiverse has no image connection, or none is chosen
  under *Settings → **Connections & models***. The fifth light is red after
  a failed draw; hover it for the reason.
- **Draw location images automatically** turned itself off: an automatic
  draw failed. Fix the cause and tick it again.
- A portrait tick is on but old party members have no portrait: untick it
  and tick it again, which draws everyone it covers.
- The chat background does not show the picture: this depends on how
  Lumiverse builds its page, and a Lumiverse update can change it. Report
  it with the `[AdventureTime] location background` line from the browser
  console.

### A game system does not move

- Its custom field is off, or its rule under **World rules** is off.
- It moves *when the narrator annotates a change*, and the narrator is not
  writing the notes. Open it with **Edit in wizard** and either revise the
  narrator rule or change **How the value moves** to **With in-world
  time**.

### The widgets

- A widget is gone: **Toggle Tracker** or **Toggle Lore** brings it back
  (*Settings → General & visuals → **Appearance***).
- A widget is off the screen or will not drag: **Reset widgets**.

### After loading a cartridge

- The rules changed and the look did not, or the other way round: a
  cartridge carries rules and prompts, not connections or Appearance
  (chapter 16).
- You want the stock setup back: **Reset all prompts to stock** puts the
  stock prompts back and keeps your world rules, custom fields and game
  systems. **Factory reset** puts everything back and keeps your
  campaigns. Both are under *Settings → General & visuals → Debug & factory
  reset*.

### The Companion

- It is wrong about a setting: **Attach the guide** is off. Turn it on.
- It does not know your character, an NPC or the place you are in: tick
  **Character sheet**, **Active lore** or **Site map** under **The
  Companion sees**.
- It says it could not answer: the red line names the reason. Check the
  **Adventure Companion** row under *Settings → **Connections & models***.
- It says it changed something and nothing changed: read the list under
  its reply. A ✗ names what failed, and no list means no action ran.
- It did not take your turn: the message is waiting above the typing box.
  Press **Send as my turn**.
- The Lore widget has no **Companion** tab: **Show the Companion in** is set
  to **The settings tab**, and the chat is in the settings tab, above **Raw
  tracker memo**.

### Seeing exactly what a model was sent

The narrator's prompt is in Lumiverse's **Prompt Breakdown**. The passes'
prompts are not. Turn on **Debug logging** (*Settings → General & visuals →
Debug & factory reset*) and every call AdventureTime makes is written to
Lumiverse's **Server Logs**, each line starting with
`[Spindle:adventure_time]`. Each pass also logs which connection it ran on
and why, in a line that starts `connection:`. The panel keeps 150 lines
unless you raise that, so read it soon after the pass.

### Reporting a problem

Include the version line, your Lumiverse version, what you did, what you
expected and what happened, and the tracker's or the agent's last report
if it is about one of them.

## 22. The Adventure Companion

The Adventure Companion is a second chat, beside the story. You talk to a
helper, not to the narrator. Ask it how AdventureTime works, and it answers
from this guide, with the path to the setting. Or talk over the story with
it: what happened, what to try next, a theory. It can also update the
campaign for you when you ask.

It is the **Companion** tab of the Lore widget. Type a question and press
**Send**, or press Enter. Shift+Enter starts a new line.

- *Each chat has its own conversation.* It is saved with the chat, so it
  follows you to another device. The Companion remembers its last 20
  messages.
- **Clear** removes the conversation of the open chat, after it asks.
  Nothing else is touched.
- *It cannot change a setting.* Ask for one and it tells you which control
  makes it.
- *Nothing it says reaches the narrator.* The conversation is not part of
  the story's prompt.

### What it can do

Ask in plain words and the Companion acts. There are four things it can do,
and no others:

- *Update the character sheet.* "Add a torch to my inventory." It sends your
  request to the State Tracker.
- *Record lore.* "Remember Old Pell as an ally." It sends your request to
  the Lorebook Agent.
- *Correct the map.* "The cart is gone from the yard." It sends your request
  to the Map Updater, for the site the party is in.
- *Take your turn.* "Choose for me." It writes your next message, or picks
  one of the choices under the last reply.

The first three happen at once. Each one is the same pass the matching
prompt bar runs, so the lights turn and the reports appear as usual. Under
its reply, the Companion lists what each one did: a ✓ for a pass that
finished, a ✗ for one that failed, and the pass's own words. Trust that
list over the Companion's summary. The agent's change can be undone with
**Undo the last pass**.

A turn is different, because it moves the story. The Companion shows you the
message first. **Send as my turn** sends it as your message and the narrator
replies. **Don’t send** drops it. Untick **Ask before it takes my turn** and
the Companion sends a turn at once. That setting applies to every chat.

One message can run up to four actions. Talking over an idea changes
nothing: the Companion acts only when you ask for a change.

### What it sees

**The Companion sees** sets what it is shown of your campaign with every
message. These settings apply to every chat.

- **Recent story**: how many of the latest chat messages it reads. It is 5
  when you install, and 0 shows it none. **Whole story** sends every
  message, which costs the most.
- **Character sheet**: the sheet the tracker keeps.
- **Active lore**: the lorebook entries Lumiverse has active for the chat.
- **Site map**: the map of the site the party is in, as the party knows it.
  It never includes what is still hidden, whatever **Reveal all** says.

The last three are off when you install. Each one adds tokens to every
message. If the Companion does not know something about your game, look
here first.

### The guide, and what it costs

**Attach the guide** sends this whole guide with every message to the
Companion, and the line under it says about how many tokens that adds. It
is on when you install. With it off, the Companion answers from what the
model already knows, which is often wrong about AdventureTime. Off stays
off in every chat until you turn it on again.

A small, cheap model suits the Companion. Choose one on the **Adventure
Companion** row under *Settings → **Connections & models***. A blank row
uses the narrator's connection.

### Where the chat appears

**Show the Companion in** has two choices. **The Lore widget** is the tab
described above. **The settings tab** moves the chat into the settings tab,
between **Starting the adventure** and **Raw tracker memo**, as a card
titled **Adventure Companion**. Use it to keep the chat open beside both
widgets.

*Different from Multihog:* Multihog's Companion sends a turn without
asking. AdventureTime's asks first, unless you turn that off.

## 23. The whole thing in one paragraph

The *rulebook* teaches the narrator how to run the game. The *dice* give it
results it cannot bend. The *State Tracker* reads each reply and keeps the
character sheet, which is sent back with the next turn. The *Lorebook
Agent* writes down people, places and events so that they outlast the chat
window. *Persistent maps* fix a place's layout and contents, and let it
change while the party is away. *World Progression* moves the wider world
on the in-world clock. Everything else is optional depth on that spine:
quests, choices, relationships, pictures, game systems, cartridges and
themes.

Every recommendation in this guide is a starting point. Different models
suit different styles of play, so experiment.

## Note to the Adventure Companion

This section is for an assistant that answers players' questions from this
guide.

- Answer from this guide. It describes AdventureTime as it is; do not
  answer from what you know of Multihog or SillyTavern where they differ.
- When you point to a setting, give its path as the guide writes it, with
  arrows, and its name exactly as the guide writes it in bold.
- Never invent a setting, a button, a tab or a command. If the guide does
  not name it, it is not there to name.
- If the guide does not cover the question, say so plainly. Then suggest
  the **?** beside the setting, the troubleshooting chapter, or reporting
  it where the player got AdventureTime.
- For a problem, ask for the version line and the relevant report first
  (chapter 21), before suggesting a cause.
- If the player runs the State Tracker on a small or local model, suggest
  **Full Review Mode** and a higher **Pass output length**.
- You see only what the player shared under **The Companion sees**. If an
  answer needs a part you were not shown, say which one.
- You can change the campaign only through your four actions (chapter 22).
  You cannot change a setting: name the control that makes the change.
- You explain; you do not narrate. Do not write story outcomes, and do not
  say that something was changed unless an action's result says so.
