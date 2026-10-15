# The worker board, described

B184, 2026-10-14. Everything the board does and how it looks, in general words, good enough to build it again
roughly the same from this page alone. `DESIGN.md` keeps the history of why; this page says what. The words the board
shares with the chats are in `roles/protocol.md` and are not repeated here. The screenshots are from the demo
(`npm run demo`), in the project's picture folder under `worker-board/b184/`.

## What it is

One page on the person's own PC for a project in which several Claude chats work together: one main chat hands out
the tasks, worker chats do them, an Advisor chat advises. The page shows who works on what, what waits for the
person, and lets the person answer, talk to the main chat, and plan. Every answer is typed into the chat it is for
(by the Workers mod) or copied for the person to paste (without it).

## How it is built

- **The server** (`server.mjs`, Node 24, no dependencies) reads files on this PC and serves one page on
  `127.0.0.1` only. It reads: the project's list of chats, each chat's card, the app's list of chats and their
  transcripts, the backlog, the asks, the game's working folders through git, the app's usage file, the game plan
  (see the README, "What it reads"). It writes only its own `data/` and, on the person's click, a tick in the backlog.
- **Its routes:** `GET /` (the page), `GET /api/state` (everything the page shows, read anew every `refreshSeconds`),
  `GET /api/picture` (a picture of the project's picture folders), `POST /api/say` (an answer or a line for a chat),
  `POST /api/game` (start or stop a game), `POST /api/design` and `/api/design/reference` (the Design tab),
  `POST /api/talk/picture` (a pasted picture), `POST /api/restart` (a new version), and for the Workers mod
  `POST /api/bridge/take` and `/api/bridge/typed`. Every POST needs the page's token and its own origin.
- **The page** is `public/index.html`, `public/board.css` and `public/board.js` (no framework). It draws the state
  it is given and redraws only what changed, so typing is never lost.
- **A keeper** starts the server and starts it anew when the person clicks the yellow "new version" note.

## The look

A dark dashboard: dark blue panels with thin borders on an almost black page, white text, colour only for state.

| Token | Colour | Used for |
|---|---|---|
| `--bg` | `#0a0f18` | the page |
| `--panel` | `#101826` | panels, windows, the side |
| `--inset` | `#152032` | fields, bars, sunken boxes |
| `--line` | `#202d40` | every border and rule |
| `--text` / `--muted` | `#e8eef7` / `#8d9aae` | text / quieter text |
| `--working` | `#3fd27f` green | working, good, done |
| `--waiting` | `#f6b93b` yellow | waiting for the person, warnings, the new-version note |
| `--free` | `#3b82f6` blue | free, the main buttons, the chosen tab |
| `--suspended` | `#a78bfa` purple | paused for the limit |
| `--unknown` | `#5b6779` grey | not seen, cannot tell |
| `--warn` | `#ff7a59` red-orange | problems, cut off, over the estimate |

- **Type:** 15 px "Segoe UI", system-ui, sans-serif, line height 1.4; headings 17 to 30 px bold; small notes 12.5 to
  13.5 px muted; code and branches in a monospace font.
- **Shapes:** panels with a 1 px `--line` border and 10 px corners; pills (a state word on its colour, 999 px
  round); count pills (a coloured dot and a number in an outlined box); buttons 7 px round, the main one filled
  `--free`, the others outlined; windows as centred dialogs over a dimmed page, with a × at the top right.
- **Spacing:** 14 to 18 px inside panels, 8 to 12 px between items; lanes as table rows with a 1 px rule.
- **Layouts:** two columns on a wide screen (the work on the left, a resizable side on the right). Below about
  1250, 1100, 900 and 820 px the columns stack and less important columns of a table drop out; at phone width
  (about 375 to 400 px) the tabs shorten ("Today" for Overview), lanes become cards, and the side comes under the
  work (`08-phone.png`). Motion is switched off for people who ask their system for less.

## The top bar

The tabs **Overview**, **Advisor**, **Backlog**, **Design**; on the right **Prepare restart** (asks the main chat to
bring every worker to a safe point before the app is quit; after it the board offers **Resume**), the board's
version and since when, "Last updated", and a refresh button. When the board's folder holds a newer version, a
yellow note on top says so; a click starts the new version. Without the Workers mod a bar on top says that what the
person sent was copied, and into which chat to paste it.

## Overview (`01-overview.png`)

- **The head:** the project's name (the setting `name`) with a refresh button; **Run game** (only for a project
  with a game: starts the base branch's game and opens it, with its commit and last change under it); the plan's
  limits (the 5-hour and the weekly bar, green, yellow from the warning percentage, red when full, with when they
  reset and how old the reading is).
- **Count pills:** how many workers are working, waiting for the person, free, suspended, cut off or unknown.
- **The Workers panel:** one row per chat of the list, the main chat first. Columns: **Worker** (its icon, name and
  state pill: Working, Waiting for you, Free, Suspended, Interrupted, Unknown, and "not running" when the mod says
  so), **Current task** (its topic, "Now:" what it does, or "Last task: ..., finished", a red line when it is over
  its first estimate), **Progress** (a bar with "step n of m" and the time left of the step), **Est. time** (ETA and
  the clock time, "Goes on at ..." when suspended, "Blocked" when it waits), **Queue** (the next step for it, how
  many more, and why it has not started). A ⋯ menu per row holds **Remove**, which asks the main chat to close that
  worker (with a warning when it is not free). Under the rows: what is missing (no list of chats, no chat, no
  backlog), "No main chat yet" with the steps to make one, "No workers yet" with **Ask for three workers**, the line
  about the missing mod, and **+ Add worker**.
- **The timeline:** from a few hours back to some hours ahead, one row per chat: what it did (green working,
  yellow waiting, blue free, purple suspended, grey not seen), what it expects (hatched) and its queue (striped),
  task changes as marks, and "Now" as a line.
- **The side, "Needs your attention":** every request of a chat and every step of the backlog that is the person's,
  newest first (or by kind), each a card with who asks, the kind (Input needed, Verification needed, Do, Decide),
  the words, pictures to look at, choices with the recommended one marked, how to play the change, and the answer:
  a text field and **Send**, or **Approve** / **Reject** with a reason, or **Done**. A card shows where its answer is
  (waiting for its chat, handed over, typed in, copied to paste). **Show closed** shows answered ones; the steps
  from the backlog fold under "From the backlog".
- **The side, "Talk to Main"** (`02-talk-to-main.png`): the person's talk with the main chat: what they typed (also
  in the chat itself) and its answers with times, the main chat's "For you" block and closing block drawn as such;
  lines on their way marked so. A box with **Send to Main**; Ctrl+V adds a picture, shown small until it is sent.

## The windows

- **A worker's task** (`03-task-window.png`, a click on a lane or `#task=<name>`): its task as it was handed over,
  its plan with the steps done and to come, and the details.
- **A finished worker's answer:** its "Task" and "What I did" lines, its "For you" items with buttons for their
  pictures and play links, and the rest of its answer.
- **A step of the backlog:** its words, its notes in sections, its branch, its pictures, and **Add to queue**.
- **A picture** (`04-picture-popup.png`, a click on any picture or `#picture=<path>`): the picture large with its
  path; a click closes it.
- **A game** (`#play=<branch>&<settings>`): the branch's game started and this tab turned into it.

## Advisor (`05-advisor.png`)

Five parts, chosen with buttons: **Next milestone** (the way to the next milestone, drawn from the goal map: the first
milestone of the game plan in it that is not done, its sub-goals as the row, the milestone's own Done when as the
last box; "No milestone to go to yet" until there is one, "not mapped yet" while it has no sub-goals), **Goals** (the project's goal map, `goals.md`, one level at
a time: the goals with their counters of goals inside, steps done and missing lines; a click zooms into a goal, ‹, Esc
or the crumb zooms out, ▸ folds one more level open; the focus is in the address, `#advice/goals/G2`; every change
is written to the file at once: the frame's buttons add, rename, set Done when, Why, notes and links, dissolve or
delete; a row's dot changes its state; drag a row, or Alt+↑/↓, Tab and Shift+Tab, to move it; Ctrl-click several and
group them under a new goal; Ctrl+Z undoes; the tree beside the outline shows the same level as boxes under the goal
zoomed into, "Diagram" and "Outline" hide either side, a click on a box zooms in, dragging a box moves it; on a phone
the outline alone and a "…" menu on every row), **Game plan** (the game plan from the game's repository,
with when it was written; being reworked in B218 at the time of this page), **Suggestions** (the Advisor's open
suggestions with their Why, Cost and Unblocks, and when its rounds come) and **Chat** (a chat with the Advisor, as
"Talk to Main").

## Backlog (`06-backlog.png`)

The whole backlog: filters **All**, **In progress**, **Queued**, **Needs your attention**, **Without a worker**, with
counts; a search; **Show finished**; **One list, newest first** (or by activity, the focus first). "Recently
finished" folds open to the last 20 finished steps with when and how the board knows. Each step is a row with its
id, title, worker and state; a click opens its window; a step nobody has gets **Add to queue**, which asks the main
chat to queue it.

## Design (`07-design.png`)

An idea becomes a picture that Codex makes. **New idea:** the words, what it is about (the project's kinds of
idea), reference pictures (picked or pasted), **Make a picture**. **The picture:** the version looked at, every
version to choose from, "What should change?" with **Make it again**, **I agree**. Then the step: title,
requirements, worker and time, **Put on the backlog** or **Put in a queue**, which the main chat writes. "Ideas so
far" along the bottom.

## States without data

A project without a list of chats, without chats or without a backlog says under the lanes what the board looks
for and where (`09-empty-project.png`); without a game there is no Run game; without the Workers mod the board says
what it cannot tell; the demo has made-up data of every state.
