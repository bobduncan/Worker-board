# Worker board

> **For any project (B191).** Every change to the worker board works for any project. No game, chat, folder
> or PC names in the code, the page, the job texts (`roles/`) or the examples: names, paths and words come from the
> settings (`config.json`) or the project's own files. `test/anyProject.test.mjs` fails on a new tie; the ties known
> today are listed there, each with the part of `ANY-PROJECT-PLAN.md` that removes it, and that list only shrinks.
> The user, 2026-10-14: "first ensure that its clear to all future work that this is the constraint if i develop
> something the worker board."

One page on your PC for a project in which several Claude chats work together: one main chat hands out the tasks,
worker chats do them. The Overview shows a lane per chat (working, waiting for you, free; its task, step and time
left; its queue), what waits for you with a form to answer it, and the day's timeline. Your answer is typed into the
chat it is for. Further tabs: Advisor (the way to the next milestone, the game plan, suggestions and a chat with an advisor, optional), Backlog (the whole backlog, with the steps finished last at its top), Design (an
idea becomes a picture made by Codex, optional). `DESIGN.md` is the agreed design.

What the board does and how it looks, part by part with screenshots: `BOARD.md`.

## What you need

| What | What for |
|---|---|
| Windows, the Claude desktop app, signed in | The board reads the app's list of chats and their transcripts on this PC. Not tried on a Mac. |
| Node 24 or newer, and git | Node runs the board (no `npm install`, no dependencies; `package.json` names the Node it needs and the scripts `start`, `demo`, `test` and `setup`); git gets it and lists the working folders. |
| The Workers mod `folder-branches` (optional; the board carries it and `npm run setup` installs it, `MODS.md`) | Keeps each chat's card (a chat without it can write its card itself, see `roles/worker.md`), types your answers from the board into the chats (without it the board copies them for you to paste, B212, and says under the lanes what it cannot tell, B213), and keeps the board running. |
| A project folder | Holds the code's repository and the board as folders of their own. Every chat of the project is opened in the project folder itself, not in a folder inside it: the app keeps the transcripts per folder. |
| One main chat, titled `<prefix>Main` | It hands out the work, and the board types its words (restart, resume, start a chat) into it. |
| `<project>\.claude\chats\list.json` | Names the prefix of the chats' titles and the main chat. |
| `<project>\.claude\work` | The work store (B301): the steps, the queues and what waits for you come from it, and from nothing else. The board writes `backlog.md` from it as a view. Without it the board shows no work and says on top what to run. |
| A launch entry | `<project>\.claude\launch.json`, from which the mod starts the board. |

Not needed: the Backlog mod `backlog` (B209: the board keeps the work itself and has its own Backlog tab; the chats
change it with the Workers mod's `work` tool). Used when there: the Run mod `start-app` (a Run pane in the app),
Codex (pictures on the Design tab), an advisor chat. `examples\` holds a starting `config.json` and `list.json`, the
default flow of the work (`work\flow.json`) with a few example items, the form of the backlog view (`backlog.md`),
and the briefings for the main chat and the workers.

## Install with one command (Windows)

Paste this into PowerShell (B321):

```powershell
irm https://raw.githubusercontent.com/bobduncan/Worker-board/main/tools/install.ps1 | iex
```

It checks Windows, the Claude desktop app, Node 24 or newer and git, one line each, and offers to install Node and
git with winget (without the Claude app it says where to get it and stops). Then it gets the board into a folder you
choose (`worker-board` in your home folder unless you say otherwise), installs the Workers mod (step 3 below), and
asks your first project's name, folder and chats' prefix: the project, its own board and its icon on the desktop are
made, and its board opens (see "A new project in one click"). Run it again at any time: it checks what is there and
redoes nothing; with a project on the PC it offers to make another. `$env:WORKER_BOARD_CHECK = 1` before the command
only checks. The steps below do the same by hand.

## From nothing to a running board

`<project>` is your project's folder, `<prefix>` the start of every chat title of the project, for example
"My Project - ". Each step ends with what you see when it worked.

1. **Node.** Install Node 24 or newer. → `node --version` prints `v24` or higher.
2. **The board.** In `<project>`:
   ```
   git clone https://github.com/bobduncan/Worker-board.git worker-board
   cd worker-board
   npm test
   ```
   → the tests end with `fail 0`. `npm run demo -- --port 4311` shows the page with made-up data, if you
   want to look first (Ctrl+C ends it).
3. **The Workers mod (optional).** The board carries it, in `mods\folder-branches` (B251). In the board's folder:
   ```
   npm run setup
   ```
   Setup finds the Claude app's own command-line program (the app keeps it in its own folder, not on the PATH), and
   with it adds the board's `mods` folder to your Claude settings as a source of mods and installs the mod for you.
   → it ends with `The Claude app's program lists it: folder-branches@worker-board, version ..., on.` and asks you to
   quit the Claude app fully (also from the system tray) and open it again: a chat gets the mod only when its process
   starts, and `/reload-plugins` does not do it. → a new chat has the command `/workers`. A copy of the mod that is
   installed already, from anywhere, is recognised and left as it is ("Nothing to do"), so no second copy clashes
   with it; `npm run setup -- --check` only says what setup would do. The board also works without the mod (B209 to
   B213, `MODS.md`): start it with `node start-board.mjs` (step 7), the chats keep their own cards
   (`roles\worker.md`), and you paste what the board copies for you. With the mod the board types your answers in,
   wakes the chats and keeps the cards by itself.
4. **The project's files.** Make `<project>\.claude\` and copy into it from `examples\`: `list.json` into
   `.claude\chats\` with your prefix, `main-briefing.md` and `worker-briefing.md`; in the two briefings
   replace `<project>`, `<prefix>` and `<repository>`. For the Design tab, also `design.json` into `.claude\`, with
   the project's own kinds of idea. The two briefings hold only the project's own facts: the
   general jobs are `roles\main.md` and `roles\worker.md`, the words the board reads are in `roles\protocol.md`.
   Then make the work store (B301), in the board's folder:
   ```
   node tools/migrate-backlog.mjs --work <project>\.claude\work --init
   ```
   (`--activity "<name>"` names its first activity, "First steps" unless given). A project that already keeps a
   backlog in the form of `examples\backlog.md` makes its store from it instead, with `--backlog
   <project>\.claude\backlog.md --work <project>\.claude\work --make-store` (first with `--dry-run`).
   → `<project>\.claude\chats\list.json` names your prefix, and the command prints `An empty work store in
   <project>\.claude\work`.
5. **The main chat.** In the Claude app, start a new chat in the folder `<project>`, name it `<prefix>Main` (the
   prefix and the main chat's name from `list.json`), and send it: "Read .claude\main-briefing.md and join the list
   of chats as the main chat." → `/workers` shows "Main" as the main chat, and `%USERPROFILE%\.claude\projects\`
   has a folder for the project: its path with every character that is no letter or digit as `-`
   (`C:\Work\my-project` becomes `C--Work-my-project`). The board finds that folder by itself (B134); set
   `transcripts` only when it lies elsewhere.
6. **Its settings.** Start the board once with `npm start`: it makes `config.json` in its folder from
   `examples\config.json`, says which paths to fill in, and stops. The file stays on your PC: it is not in git. In it,
   `name` is the project's name, the board's title (left out, it is the project folder's name), `project` is
   `<project>`, `transcripts` the folder of step 5, `gameRepo` the folder of your code's git repository (empty until
   there is one), `port` a free port. Write `\\` for every `\` in a path, or use `/`. The Claude app's own folder
   (its list of chats and its usage file) the board finds by itself (B135): `%APPDATA%\Claude` on Windows, else the
   Microsoft Store app's package folder (`%LOCALAPPDATA%\Packages\Claude_...\LocalCache\Roaming\Claude`, which a board
   started from your own PowerShell needs), `~/Library/Application Support/Claude` on a Mac; set `appSessions` and
   `usageHistory` only when they lie elsewhere. When the app moves its folder (B273: the Store app moved it to
   `%LOCALAPPDATA%\Claude-Data\<id>` and left a marker `.user-data-left.<id>` behind), the board follows it, also
   while it runs and when a setting names a folder that is gone, and says on top of the page where it found it.
   → `npm start` prints `Worker board: http://127.0.0.1:<your port>/` and, under it, which folder of the app's chats it reads. Ctrl+C ends it. A file that is not valid JSON,
   or holds a setting of the wrong kind, stops the board with one line that names the file, what is wrong and
   where (for example "not valid JSON at line 3, column 14", or `"port" must be a number above 0`).
7. **The launch entry.** `node server.mjs --launch-entry` → it prints `Launch entry "worker-board" in
   <project>\.claude\launch.json`. With `"boards": ["worker-board"]` in `list.json`, every chat in the list starts
   the board when it does not answer, within 15 seconds: no need to start it yourself, also after a restart.
   **Without the Workers mod** (B211): `node start-board.mjs` starts the board in the background when it does not run
   yet and prints where it runs (its own words go to `data\board.log`); a second call says it runs already. To have
   it start with every chat of the project, copy `examples\settings.json` to `<project>\.claude\settings.json` (or add
   its hook to the one there) and put the board's folder for `<board>`: a chat that opens then starts the board,
   quietly, when it does not answer.
8. **Open it.** Open `http://127.0.0.1:<your port>/` in a browser. → the lane "Main" comes first, under it "No
   workers yet" (step 10); nothing waits for you yet, and the Backlog tab says "Store · 0 items · backlog.md is its
   view". Without a main chat the page says "No main chat yet" and how to make one, as step 5 does; without a work
   store a line on top names the folder and the command of step 4.
9. **The way back.** In Talk to Main, tell the main chat what the project is (a few lines, then send). → the line
    says "typed into its chat", and the main chat has your words with "(typed on the worker board, HH:MM)" and their
    id, `[I1]`; under Needs your attention, "Open instructions" lists I1 until the main chat closes it.
10. **Workers.** With a main chat and no worker, the board asks the main chat for three workers by itself, once,
    while the main chat's chat is open (it types "spawn workers" into it); "Ask for three workers" does the same.
    The main chat starts them, or puts a chip "<prefix>Worker N" into its chat for each: click each chip, one chip
    starts one worker. → each worker shows as a lane. "+ One more worker" under the last lane asks for one more.

## Daily use

- Tell the main chat what you want; it writes the steps and hands them out. What a chat needs from you is an ask,
  a card under "Needs your attention", which you answer on the board; a question it asks with the app's own form you
  answer in its chat. A chat that wrote questions in its chat without filing an ask shows there as a warning, with a
  button to its chat (B301).
- A lane shows what a worker does now and the time it expects to need; a step that waits says why ("Not started:
  ...").
- The head shows the plan's limits; a worker that paused for the limit shows as "Suspended" until it goes on.
- Before you quit the app: "Prepare restart" on the board, and "Resume all" after it is open again.
- "CPU for the chats" in the head (B311, Windows only): when the PC lags while you play or work, click Gentle (the
  project's chats and everything they started run below normal priority) or Strong (idle priority, on the higher
  half of the cores); Off gives them normal priority and all cores back. The board keeps applying it at every refresh,
  also to what the chats start later, and remembers it in `data\cpu.json`. Only the project's chats: never the Claude
  app itself or another program.
- "✕ Remove" on a worker's lane asks the main chat to close that worker; a worker that is not free gets a warning
  first, which says what would stop.
- When a merge changes the board, a yellow note on top of the page says a new version is available; click it and
  the board starts the new version itself, however it was started. Nothing starts anew without your click.

## Settings

`config.json`, next to `server.mjs`: `name` (the board's title), `project`, `gameRepo`, `baseBranch` (the branch the
work is merged into, "main" unless set), `runGame` (the command that starts a working folder's game, a list of
words with `{folder}`, `{port}`, `{idle}`, `{grace}`, `{cache}`, `{node}` and `{board}` filled in; it prints
`ready <port>` once the game is served and ends by itself when nobody looks; `examples\config.json` has the one for
a Vite game, `run-game.mjs`; none unless set), `appSessions` (the app's list of chats), `transcripts`,
`port` (4310 unless set), `refreshSeconds`, `advisor` (the name of the advisor chat, "Advisor" unless set),
`pictureRoots` (the folders of `<project>` whose pictures the board shows, `["pictures"]` unless set; the first is
the project's own picture folder, where the board keeps the pictures pasted into Talk to Main, under `talk`) and the times
in `src/config.mjs`. `designKinds` (`.claude/design.json` unless set): the project's file of what the Design tab tells Codex per kind of
idea, and its reference pictures; `examples\design.json` shows one. `goals` (`.claude/goals.md` unless set): the
project's goal map, which the Advisor tab's Goals part draws and, on the board that delivers, changes; `examples\goals.md` shows its form.
`brainstorms`, `goalAsks` and `goalsHistory` (`.claude/brainstorms`, `.claude/goal-asks`, `.claude/goals.history`
unless set) are the folders for the map's brainstorms (one thread file each, which the Advisor tab's Brainstorm part
shows and answers), the Advisor's long answers to the asks on it (its "More:" lines point there) and its daily copy.
These four may also be a whole path of their own, as `work`: a copy tried beside your board reads its own goal map.
`advisorParts` (`["focus", "goals", "brainstorm"]` unless set): the parts the Focus tab's bar shows, by name; add
`"way"` (Next milestone), `"plan"` (Game plan), `"suggestions"`, `"refine"` or `"chat"` to bring one back.
`work` (`.claude/work` unless set): the work store's folder, a path inside the project or a whole path of its own
(a copy tried beside your board gives it a folder outside the project, and only then writes one). The store is
required: without it the board shows no work and says on top what to run.
`cpuLimit` (`"off"` unless set; `"gentle"` or `"strong"`): the level of "CPU for the chats" until one is clicked on the
board; a copy beside your board starts at Off whatever it says.

## The work store

One file per item in the `work` folder (a step, an ask for you, an instruction of yours, a note), with its state,
its owner, what it waits for and its history, and `flow.json` for the order of states (the default is
`examples\work\flow.json`; `examples\work` shows a few items). It is the one source of the work (B301): the chats
work it with the Workers mod's `work` tool (`roles\protocol.md`, "The work store"), the board checks every change
against `flow.json`, and it writes `backlog.md` from the store as a view after every change; nobody edits it, and the
board never reads it. The Backlog tab says in one line how many items the store holds; a step's window shows where
the step stands in the flow. A hand edit of `backlog.md` is kept beside it as `backlog.edited-<date>-<time>.md`, and
the board says so on its top line. The Workers mod needs version 0.13.1 or newer: run `npm run setup` and start the
chats anew.

**Making the store.** `node tools/migrate-backlog.mjs --work <folder> --init` makes an empty one (step 4).
`node tools/migrate-backlog.mjs --backlog <file> --work <folder> --make-store` makes it from a backlog in the form below,
into an empty folder: it first proves that the store reads back as the backlog and its view as the same items,
prints the steps in flight and each chat's card beside the store's state of its step, keeps the old file as
`backlog.before-store.md` and writes `backlog.md` as the view (first with `--dry-run`). Without `--make-store` it
only prints what the store would hold.

**What fails, and how it shows.** No store folder, or one the board cannot read: one line on top of the board names
the folder and what to run, the board shows no work (nothing from `backlog.md` instead), and the work API answers 503
with the same line. A file of the store the board cannot read (a broken head, an id twice, a state the flow does not
know): one line on top names it; the item is shown as it is and not moved.

**The board delivers the work** (B300): the main chat only queues a step (`work queue`), and at every
refresh the board types one line into the worker's chat once the step may be taken and the worker is free, "work:
B286 is yours; run work next", once per step and worker (kept in `<work>\delivered.json`, so a restart sends nothing
twice); a worker that ends a turn with nothing in progress asks for it itself (the Workers mod 0.12.0 or newer). A worker that holds a step but does not
run is flagged on its lane after ten minutes with a button "Start <worker>" (the main chat starts it); so are a failed
check and a card that names another step, and a file of the store the board cannot read stands on the top line.

`<project>\.claude\chats\list.json`: `prefix` and `main` (the main chat's title is the two together), `boards` (the
launch entries the mod keeps running) and `compactAbove` (a worker larger than this many tokens is compacted after
it reports; 250000 unless set, 0 for never). An empty `boards` list switches the automatic start off.

The backlog's form, as the board writes its view and as `--make-store` reads it: an activity is a `## ` heading (`#focus` after it marks your main
focus); a step is `- [ ] B<number> ...`, ticked `- [x]`; `@you` at its end is a step for you, starting with
`Verify:`, `Decide:`, `Provide:` or `Do:`; the queue is the open steps under a heading that starts with "Next to
hand out", each ending in `(for <worker>; now | after B<number>; about <time>)`; indented lines under a step
describe it. A step that names a folder in one of the picture folders shows its pictures.

## A copy beside it

A copy in another working folder of this repository (a branch being worked on) runs beside the board: started
without `--port`, it takes a port of its own from 4320 up, the same one every time (it writes it to its
`data/port.json`), and says which; the board in the main folder keeps the port of `config.json`. A copy only
shows: answers are given on the board in the main folder.

## Two projects on one PC

Each project has its own copy of the board (its own folder, its own `config.json`); both can run at once (B319). Make
the second copy with `git clone` (or as a plain copy of the folder), not with `git worktree add`: a working folder of
the same repository is a copy beside the first board, which only shows. The
first board that runs on a port keeps it for its project, in a list of the PC's boards (`~/.worker-board/boards.json`).
A board whose port another project's board holds takes the next free one and says so; `node server.mjs
--launch-entry` writes that port into the project's launch entry. Each project's games get their own range of 100
ports. The Workers mod is installed once for the PC: run `npm run setup` in one board's folder; a board that carries
another version says so on top of its page.

## A new project in one click

`npm run new` in the board's folder, or **New project…** under ⚙ on a running board (B320, Windows), asks the
project's name, its folder (new or empty: anything else is refused) and how its chats' titles start ("<name> - "
unless you say otherwise). It then makes the folder with git, a README, the project's own copy of the board (a clone
at this board's version, in `worker-board`), its `config.json`, the list of chats, an empty work store with the
default flow, the launch entry on a port of its own, the project's `CLAUDE.md` (how the chats answer you, from
`examples/CLAUDE.md`) and its briefings, and an icon "<name> board" on your desktop and in the Start menu that starts
its board and opens its page. The new board starts at once. A new project has no game; add one in its `config.json`
(`gameRepo`) when there is one.

## What it reads (never changes)

- the app's list of chats, and the last part of each project chat's transcript;
- each chat's card and requests (`.claude\chats`, `.claude\asks`), the work store and the goal map (`goals`,
  `.claude\goals.md`, also the way to the next milestone) in `<project>\.claude`, and the game plan in the game's
  repository (`gamePlan` in `config.json`, `docs/game-plan.md`) for the Advisor tab;
- the app's usage file for the limits, pictures in the picture folders of `<project>`, and the working folders through git
  commands that only read.

## What it writes

`data\` in its folder, which git ignores: the history, what you sent (`outbox.jsonl`), when the board last ran,
the Design tab's ideas and the level of "CPU for the chats" (`cpu.json`). Outside it: `<project>\.claude\board.json` while it runs (where the mod finds it), the
pictures Codex makes in the Design tab's ideas folder (`ideas` in the project's picture folder), and the work store
(`work`, `.claude\work` unless set), on the chats' `work` calls and your clicks, with `backlog.md` written from it as a
view (see "The work store" above).

## Safety

The server listens on 127.0.0.1 only. The page gets a random token at each start; reading needs it, and sending
also needs the page's own origin and a JSON body, so another website in your browser can do neither. An answer is
accepted only for a request that is open and only to the chat that asked. What a chat said is shown on the page
and kept in `data\`; it is never printed or logged.

## Git

`origin` is https://github.com/bobduncan/Worker-board.git. For every chat that works on the board:
- Push a branch when you make it and as you commit to it (`git push -u origin <branch>`).
- After a merge into main: push main, delete the merged branch on the remote too
  (`git push origin --delete <branch>`), and prune (`git fetch --prune`).
- Never force-push main.
- Nothing that holds words from a chat goes into the repository: `data\` stays ignored, and the tests keep made-up
  samples. Look at what a commit adds before you push it: the repository is public.

## Not yet portable

What still ties the board to the project it was built for (Lava Tactics) or to one PC, found on 2026-10-14 by
following the steps above in an empty, made-up project with another prefix (Node v24.19.0). Steps 3, 5, 9 and
10 need the app and real chats: the trial stood in for them with made-up chat files. Each point is a step on that
project's backlog, part of B126 (the board for any project).

1. Done (B127): `config.json` is not in the repository; a new copy makes it from `examples\config.json` at its first
   start and says which paths to fill in.
2. Done (B128): a `config.json` that is not valid JSON, or holds a setting of the wrong kind, stops the board with
   one line saying what is wrong and where; the yellow note does not start a new version on such a file.
3. Done (B129): the page and the tab show the project's own name, the setting `name` (by default the project folder's
   name).
4. "Game - Main" stands in fixed words: `public/index.html` line 18, `public/board.js` line 561, `src/design.mjs`
   line 111. B130
5. Done (B131): without a right `list.json` the board guesses no prefix and no main chat; it shows no chats and
   says which file it looks for.
6. Done: with `gameRepo` empty there is no game (B132): no "Run game", no "Open the game" and no play links, and the
   board never takes its own folder for the game. The base branch is the setting `baseBranch` (B194), and how a game
   starts the setting `runGame` (B197), with `run-game.mjs` (Vite) as the example.
7. Done (B133): the Design tab's kinds of idea and reference pictures are the project's own file (`designKinds`);
   without one the tab says what it needs. Its ideas live in `ideas` in the project's picture folder (B198).
8. `transcripts` has to be looked up by hand (step 5); the board could work it out from `project`. B134
9. Done (B135, B214), not yet tried on a real Mac (B215): the app's folders are found per system (Windows, the
   Store app, a Mac, Linux); folders are compared with "/" and their own letters on a Mac; Codex is found on the
   PATH as well as under `%LOCALAPPDATA%\OpenAI\Codex`. On a Mac, use `/` in paths, `HOME` for the home folder and
   `claude` from your shell for the mods; the steps above are written for Windows.
10. Done (B136): `package.json` names Node 24 or newer, and the scripts `start`, `demo` and `test`.
11. Done (B137): an empty board says under its lanes what it looks for and where: the list of chats, a chat of the
    project; B301: a missing work store on top of the page, with the command that makes it. Still open: a `transcripts` setting that names the wrong folder is not pointed out.
12. Done (B138): `BRIEF.md` and `DESIGN.md` are marked as the history of the first project and point to the general
    documents (this README, `roles/`, `ANY-PROJECT-PLAN.md`, `MODS.md`).
13. Done (B251): the board carries the Workers mod in `mods\`, and `npm run setup` installs it with the app's own
    program (step 3). A project folder cannot bring it by itself: the app loads a project's mods only after a trust
    question it never asks (`MODS.md`).
