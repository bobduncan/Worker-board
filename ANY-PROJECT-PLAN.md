# The worker board for any project: the plan

B189, 2026-10-14, checked against the board's main at 0871961. Approved by the user on 2026-10-14 (B190). The wish: "i want the worker board to also be reusable for non-lavatactics
projects. so we need to reevaluate the current that for that and maybe refactor that too."

## What still ties the board here

| Tie | Where today | Kind |
|---|---|---|
| This PC's paths in the repository | `config.json` (project, game, app folders) is in git; a clone uses them (B127) | this PC |
| A broken or missing settings file is taken quietly | `src/config.mjs` takes the defaults; `src/appChats.mjs` falls back to "Game - " and "Main" (B128, B131) | start-up |
| An empty board says nothing | 0 working, 0 waiting, 0 free (B137); no `package.json` names the Node it needs (B136) | start-up |
| The project's and the main chat's names in fixed words | the title "Lava Tactics" in `public/index.html` (B129); "Game - Main" in `public/board.js`, `src/design.mjs` (B130) | names |
| Fixed folders and branch | `art-inbox/talk` (B167), `art-inbox/ideas/_references`; the base branch `main` in `src/games.mjs`, `src/folders.mjs`, `src/tick.mjs` | names (new) |
| The game is built in | Run game always there; `run-game.mjs` runs Vite only (B132); `design.json` holds this game's idea kinds and pictures (B133) | the game |
| The words the board reads are written down only in this project | "Task from", "Report from", "Note from ...: paused for the limit until", "+ Done: yes", the "For you" block, the step notes "(for X; ...)", "@you", "Verify:/Decide:": in the project's `CLAUDE.md` and `.claude/*-briefing.md`. The board's `examples/*-briefing.md` are general but 100 lines behind them | the protocol (new) |
| The mods | the bridge, the cards and the panes come from the Workers mod, which is on this PC only (B145, B177: about 8 to 10 h to make it optional, B146) | the mods |
| Windows and this app's install | `%APPDATA%`, the Store app's folder, `codex.exe`, Edge for pictures, backslashes (B135); the transcripts folder looked up by hand (B134) | this PC |
| The notes read as this project's | `BRIEF.md`, `DESIGN.md`, the README's "Not yet portable" (B138) | documents |
| Done already | the Advisor: its job is general (`roles/advisor.md`), its pages live in the game (B173); its settings in `config.json` | — |

**Where it stands (B323, 2026-10-18).** Every tie in the table is removed: settings and start-up (B127, B128, B131,
B136, B137), the names (B129, B130), the folders and branch (B167, B194, B198), the game (B132, B133, B197), the
protocol (`examples/CLAUDE.md`, made the project's own by B320 and brought up to date by B323, with the briefings and
`roles/` pointing to it; `roles/protocol.md` lists every word), the mods (carried by the board, B251; installed by
`npm run setup` or the install command, B321), this PC (B134, B135; no path of it in any file of the repository,
kept so by `test/anyProject.test.mjs` since B323) and the notes (B138). Two projects run side by side (B319), a new
one is made in one click (B320) and opens its first chats (B322, one Initialise button since B335). Still open: a
Mac, not tried (B215); a real installer, a goal of its own later.

**The proof (B324, 2026-10-18).** A helper with only the README installed the board on this PC beside the first
project's running board, made a project and ran its board at once on its own port; the first board, its port and the
PC's mod stayed as they were; the new project's main chat, opened with Initialise, set itself up and asked for
workers. What it stumbled on is fixed (the README's "Not yet portable", point 19).

## The order

The work goes in small increments, one at a time, each merged on its own; a part may take several. The user, on
approving it: "do it in small increments that can be merged back. first ensure that its clear to all future work
that this is the constraint if i develop something the worker board. Then we can do small refactors as a time."
The first increment is the rule itself (B191): at the top of the README and DESIGN.md, in `roles/README.md`, and
the guard `test/anyProject.test.mjs`, whose list of known ties each increment shortens. Sizes are a worker's time.

1. **Settings and start-up (about 2 h).** `config.json` leaves git and is made from `examples/config.json` at the first
   start. A settings file that is broken, or a missing list of chats, stops the board with a line saying what is
   wrong and where; an empty board says what it looks for. A `package.json` names Node and the scripts start, demo,
   test. Merges **B127, B128, B131, B136, B137**: they touch the same start-up code.
2. **Names from the settings (about 1 h 30 min).** The project's name as the title, the main chat's title from the
   list of chats wherever the page names it, the picture folders under the first `pictureRoots`, and the base branch
   as a setting. Merges **B129, B130**, and the fixed folders and branch found now.
3. **The game parts become optional (about 2 h).** Run game only when the settings name a game and how to run it (a
   command, Vite as the example); the Design tab's idea kinds in the project's own file, the tab hidden without them.
   Merges **B132, B133**.
4. **The protocol shipped with the board (about 2 h, new).** The words the board reads, written down once in the
   board's repository (`roles/protocol.md`), and general jobs for the main chat and a worker (`roles/main.md`,
   `roles/worker.md`), as `roles/advisor.md` already is. The project keeps only its own facts in its briefings and
   `CLAUDE.md`. Replaces `examples/*-briefing.md`; it is also **B177**'s first part (the CLAUDE.md section).
5. **Without the mods (about 6 to 8 h).** **B177**'s other parts: the chats write their card files themselves, the
   board copies and opens a chat where today the bridge types, a start script, the process check dropped. The
   Workers mod stays as an option that adds the bridge and the panes; publishing it is **B145**.
6. **Other PCs (about 2 h).** The transcripts folder worked out from the project's path; Mac paths and the app's
   folders, Codex and the picture browser found per system. **B134, B135**. After part 5, which removes Windows-only
   parts.
7. **Documents (about 1 h).** `BRIEF.md` and `DESIGN.md` marked as the history of the first project; the README
   general, its "Not yet portable" list emptied. **B138**. Then **B184** (describe the board so it can be rebuilt,
   about 3 to 4 h), so it describes the general board.
8. **The proof (about 1 h, new).** B123's trial again: a made-up empty project from the README alone, in a second
   folder, the board showing what it looks for, a chat joining. Closes **B126**, the umbrella.
   Done (B216, 2026-10-14): a made-up project in a throwaway folder outside the first project, a fresh clone of the
   board, the README and `roles/` only, no mod. The first start made the settings; with `name`, `project` and a port
   filled in, `start-board.mjs` started it; the page showed the project's name, its main chat and a worker from
   their own cards (topic, step, time), the queues from the backlog, the line about the missing mod, no game, and no
   word of the first project. What it needed beyond the README was fixed there: the Workers mod optional in step 2,
   the first start no longer asking for the folders the board finds itself, the template without them, and the
   Design tab's kinds file in step 4. Left: a trial on a real Mac (B215) and the full description (B184).

**In all:** about 18 to 20 h, and B184's 3 to 4 h. Without part 5 (the mods stay required): about 12 h.
**Dropped:** none. **Replaced:** `examples/*-briefing.md` by part 4. **B126** stays the umbrella and closes with
part 8.

## Why this order

Everything reads the settings, so they come first; names next, so later parts use them. The protocol comes before
the mods, because a board without the mod relies on the chats following the written words. Other PCs after the mods,
because part 5 removes Windows-only parts. The documents describe the result, and the trial proves it.
