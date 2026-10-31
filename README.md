# Worker board

One page on your PC for a project that several Claude chats work on at once: a main chat hands out the tasks, worker
chats do them, and the board shows who works on what, what waits for you, and takes your answers to the chats. For
Windows and the Claude desktop app.

## Install

You need Windows and the Claude desktop app, signed in and opened once. The board is on GitHub for anyone: paste
this line into PowerShell.

```powershell
irm https://raw.githubusercontent.com/bobduncan/Worker-board/main/tools/install.ps1 | iex
```

It checks Windows, the Claude desktop app, Node 24 or newer and git, one line each, and offers to install Node and git
with winget (without the Claude app it says where to get it and stops). It gets the board into a folder of your choice
(press Enter at "Where should the board go?" for the one it offers), installs the Workers mod, and asks your first
project's name, folder and chats' prefix, and whether the board may start, wake and restart its chats and set their
model by itself (it adds 8 tool permissions to the project's own settings, listed under By hand, step 3; the board's ⚙
later shows what it does by itself and allows the rest with one click): the project, its own board and its icon on the desktop are made, and its
board opens with one button that sets up the project's chats. Run the line again at any time: it checks what is there
and redoes nothing; with a project on the PC it offers to make another. `$env:WORKER_BOARD_CHECK = 1` before it only
checks.

To read the script before it runs, with git on the PC: get the board first and run the script from it (at "Where
should the board go?", press Enter when it offers the folder you cloned into, or type that folder):

```powershell
git clone https://github.com/bobduncan/Worker-board.git "$HOME\worker-board"
Get-Content -Raw "$HOME\worker-board\tools\install.ps1" | iex
```

## What the board is

The Spending tab shows reported project usage by model, effort, chat, phase and task, with a daily chart and CSV
export. Its dollar ranges estimate equivalent API costs; subscription allowances are shown separately. Unknown
usage and incomplete history are disclosed. The initial model-routing release supports Off and Observe only:
automatic model changes remain disabled until the bridge proves the execution safeguards. See
[`docs/model-routing.md`](docs/model-routing.md) for the policy, limitations and tuning workflow.

The Overview shows a lane per chat (working, waiting for you, free; its task, step and time left; its queue), what
waits for you with a form to answer it, and the day's timeline; your answer is typed into the chat it is for. Further
tabs: Focus (the goal you work towards, its vibe and how, with a partner chat, the Advisor), Backlog (the whole work,
with the steps finished last at its top) and Design (an idea becomes a picture made by Codex, optional). What the
board does and how it looks, part by part with screenshots: `BOARD.md`; the agreed design: `DESIGN.md`. How the chats
answer you and the words the board reads from them: `examples/CLAUDE.md` and `roles/protocol.md`.

## By hand

The same by hand. These steps set up the board inside one project's folder; the install puts it in your home folder
and gives each project its own copy (A new project in one click, below).

### What you need

| What | What for |
|---|---|
| Windows, the Claude desktop app, signed in | The board reads the app's list of chats and their transcripts on this PC. Not tried on a Mac. |
| Node 24 or newer, and git | Node runs the board (no `npm install`, no dependencies; `package.json` names the Node it needs and the scripts `start`, `demo`, `test` and `setup`); git gets it and lists the working folders. |
| The Workers mod `workers` (optional; the board carries it and `npm run setup` installs it, `MODS.md`) | Keeps each chat's card (a chat without it can write its card itself, see `roles/worker.md`), types your answers from the board into the chats (without it the board copies them for you to paste, B212, and says under the lanes what it cannot tell, B213), and keeps the board running. |
| A project folder | Holds the code's repository and the board as folders of their own. Every chat of the project is opened in the project folder itself, not in a folder inside it: the app keeps the transcripts per folder. |
| One main chat, titled `<prefix>Main` | It hands out the work, and the board types its words (resume, start a chat) into it. |
| `<project>\.claude\chats\list.json` | Names the prefix of the chats' titles and the main chat. |
| `<project>\.claude\work` | The work store (B301): the steps, the queues and what waits for you come from it, and from nothing else. The board writes `backlog.md` from it as a view. Without it the board shows no work and says on top what to run. |
| A launch entry | `<project>\.claude\launch.json`, from which the mod starts the board. |

Not needed: the Backlog mod `backlog` (B209: the board keeps the work itself and has its own Backlog tab; the chats
change it with the Workers mod's `work` tool). Used when there: the Run mod `start-app` (a Run pane in the app),
Codex (pictures on the Design tab), an advisor chat. `examples\` holds a starting `config.json` and `list.json`, the
default flow of the work (`work\flow.json`) with a few example items, the form of the backlog view (`backlog.md`),
and the briefings for the main chat and the workers.

### From nothing to a running board

`<project>` is your project's folder, `<prefix>` the start of every chat title of the project, for example
"My Project - ". Each step ends with what you see when it worked.

1. **Node.** Install Node 24 or newer. → `node --version` prints `v24` or higher.
2. **The board.** In `<project>`:
   ```
   git clone https://github.com/bobduncan/Worker-board.git worker-board
   cd worker-board
   npm install
   npm test
   ```
   → the tests end with `fail 0`. They run on at most half the PC's cores (`tools/test.mjs`), so the PC stays
   usable meanwhile. At most two heavy runs at a time happen on the PC (2026-10-31, `HEAVY_RUN_SLOTS`), first come first served: `npm test` waits its turn when two other runs hold
   it (`tools/one-at-a-time.mjs`). `npm run demo -- --port 4311` shows the page with made-up data, if you
   want to look first (Ctrl+C ends it).
3. **The Workers mod (optional).** The board carries it, in `mods\workers` (B251). In the board's folder:
   ```
   npm run setup
   ```
   Setup finds the Claude app's own command-line program (the app keeps it in its own folder, not on the PATH), and
   with it adds the board's `mods` folder to your Claude settings as a source of mods and installs the mod for you.
   → it ends with `The Claude app's program lists it: workers@worker-board, version ..., on.` and asks you to
   quit the Claude app fully (also from the system tray) and open it again: a chat gets the mod only when its process
   starts, and `/reload-plugins` does not do it. → a new chat has the command `/workers`. A copy of the mod that is
   installed already, from anywhere, is recognised and left as it is ("Nothing to do"), so no second copy clashes
   with it, except a copy under the mod's old name `folder-branches` (until 0.26.0), which setup uninstalls before it
   installs `workers`; `npm run setup -- --check` only says what setup would do. The board also works without the mod (B209 to
   B213, `MODS.md`): start it with `node start-board.mjs` (step 7), the chats keep their own cards
   (`roles\worker.md`), and you paste what the board copies for you. With the mod the board types your answers in,
   wakes the chats and keeps the cards by itself.
   **The allow rules (B767, T14).** The mod does the main chat's routine jobs by code, with no model turn, only where
   the app lets a chat's code call their tools with no question: allow rules in `<project>\.claude\settings.local.json`
   (`permissions.allow`). A chat may not add them to its own permissions (the app refuses it): the new-project flow
   asks once and adds them, and the board's ⚙ "What the board does by itself on this PC" names what is missing and
   "Allow them for this project" adds it on your click. The rules and why:
   `mcp__ccd_session_mgmt__send_message` wakes, starts and resumes chats (a chat in Auto mode, as the worker routines
   run, has its code's send put to the app's Auto classifier, which denies it: without this rule only chats in another
   mode send, and the ⚙ row says "needs your OK"); `mcp__ccd_session_mgmt__set_session_model` and
   `mcp__ccd_session_mgmt__set_session_effort` set a worker's model and effort per step;
   `mcp__ccd_session_mgmt__archive_session`, `mcp__ccd_session_mgmt__unarchive_session` and
   `mcp__ccd_session_mgmt__list_sessions` restart an idle worker for a new mod and (B847) archive the older chats of a worker
   that a newer run of its routine replaced; `mcp__scheduled-tasks__update_scheduled_task`
   and `mcp__scheduled-tasks__run_scheduled_task` start a new worker from its stored routine. Reading your usage limits
   needs no rule. A job without its rules stays the main chat's. One row is the workers' own:
   `mcp__Claude_Browser__preview_start`, `mcp__Claude_Browser__preview_stop`, `mcp__Claude_Browser__preview_list` and
   `mcp__Claude_Browser__preview_logs` let a worker start, check and stop the game's preview (the app's built-in browser,
   from the project's own `.claude\launch.json`) with no popup; without them every worker asks you each time it starts
   the game. Other browser actions (opening outside sites) keep asking.
   **Leftovers (B847).** A worker's routine opens a new chat with the worker's title on each run; it does not reopen the
   chat of the run before. The older chat stays in the app's list and the board shows it greyed, as a leftover. Once the
   newer chat has checked in, the board archives the older chats of that worker by itself (a chat's mod, with the three
   archive rules above; the ⚙ row "Restart a worker for a new mod, archive replaced chats" says when none may): only ones quiet for five
   minutes, that the app does not say wait for you, that were last active before the newer chat began, that work in the
   same folder and whose folder has nothing uncommitted. The live chat is never archived. Each archive is one line in
   `board.log` ("B847: archived the replaced chat ...").
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
    id, `[I1]`; the line at the bottom of Needs your attention says "Log: 1 instruction", and in the log it opens,
    "Open instructions" lists I1 until the main chat closes it.
10. **Workers.** With a main chat and no worker, the board asks the main chat for three workers by itself, once,
    while the main chat's chat is open (it types "spawn workers" into it); "Ask for three workers" does the same.
    The main chat starts them, or puts a chip "<prefix>Worker N" into its chat for each: click each chip, one chip
    starts one worker. → each worker shows as a lane. "+ One more worker" under the last lane asks for one more.

## Daily use

- Tell the main chat what you want; it writes the steps and hands them out. What a chat needs from you is an ask,
  a card under "Needs your attention", which you answer on the board; a question it asks with the app's own form you
  answer in its chat. A chat that wrote questions in its chat without filing an ask shows there as a warning, with a
  button to its chat (B301).
- **Find obsolete items** (B775, under Needs your attention, shown while something is open there): one click has the
  partner judge every open item (refine questions, asks, Do items, incidents) against what happened since it was
  made: the board gathers each item's evidence by code (its step's state, the commits that name its step, its chat in
  the list, board restarts), the partner answers once, and the list shows each item as obsolete, unsure or still open
  with a line why and the evidence. Since 2026-10-31 (your word) the obsolete ones close by themselves when the partner
  answers, as you would close them: a refine question closes its step as done (when no chat holds it) and is withdrawn,
  an ask is withdrawn without waking its chat, an incident is closed. Unsure and open ones stay, listed with their why. The button reads "The Advisor
  is checking" meanwhile, and "Try again" when it did not answer in 15 minutes. It needs a partner chat in the list and
  the Workers mod 0.26.6 (the partner's `work obsolete`).
- A lane shows what a worker does now and the time it expects to need; a step that waits says why ("Not started:
  ...").
- The head shows the plan's limits; a worker that paused for the limit shows as "Suspended" until it goes on.
- Before you quit the app: "Pause all" on the board (each chat writes its checkpoint and stops; the board says when
  it is safe), and "Resume all" after it is open again (open the main chat when the board says so).
- When no chat runs (after an app or PC restart, or once every chat went idle) and work waits for one, the board opens
  one chat of the project in the Claude app by itself (Windows; T13 part 4), the main chat first: its Workers mod then
  wakes the rest. At most once in 3 minutes; when two opens bring no chat back, it stops and asks you to open a chat.
  While other chats run, a worker whose chat is asleep and has work waiting for a minute (a step queued for it, or a
  word of the board's) is opened the same way, directly: a message cannot wake a closed chat. One open per minute's
  look, at most once in 3 minutes per worker, and not again after two opens left it asleep.
- "CPU for Claude" in the head (B311, B735, Windows only): two choices you pick, no game detection. Full: everything
  the project started runs at normal priority on all cores. Low: the chats and what they started, the board itself and
  its keeper, the vite servers, codex and a headless browser run at the lowest priority on the last two cores, in
  efficiency mode where Windows has it, so a game or any other program never slows (tests and builds run slower). The
  board keeps applying it at every refresh, also to what starts later, and a restart of the board keeps it limited;
  it remembers the choice in `data\cpu.json`. Never the Claude app itself, your own Edge or another program. Under
  Full the board gives itself normal priority and all cores back at its start. The last two cores count all of the
  PC's cores, not the ones the board may use. A level saved before (Strong) reads as Low, Off and Gentle as Full.
- "✕ Remove" on a worker's lane asks the main chat to close that worker; a worker that is not free gets a warning
  first, which says what would stop.
- The evidence picture (B357), the one picture a check shows you: `node tools/evidence.mjs --step B314 --title "..."
  --reference ref.png --result shot.png --points points.json --score 63 --target 75`. The reference stands left, the
  result right at the same height (the result's own, at most `--height`, 720 unless given, so a result is never
  enlarged); the step's id and title on top; below, the score beside its target (red when under it) and the agreed
  points ticked green (pass), red (fail) or blue with "for you" (ask: a point only you can judge, B369). `--points` is
  a JSON list, or a file of one, of `{ "text", "result": "pass" | "fail" | "ask" }` or of the lines a result check
  keeps (`"pass: <text>"`). Without `--reference` and `--result` it is the ticked list alone. Without `--out` it lands in the project's
  picture folder under the step (`<first pictureRoot>\<step>\evidence.png`), where the board shows it. It is drawn by a
  headless Edge or Chrome (`EVIDENCE_BROWSER` names another), closed again in the same run.
- When a merge changes the board, a yellow note on top of the page says a new version is available; click it and
  the board starts the new version itself, however it was started. Nothing starts anew without your click.

## Settings

`config.json`, next to `server.mjs`: `name` (the board's title), `weekStopAt` (the percent of the week from which all work stops, 98), `fiveHourStopAt` and `fiveHourStopMinutes` (the percent of the 5-hour limit from which all work stops, 95, while its reset is more than this many minutes away, 10), `project`, `gameRepo`, `baseBranch` (the branch the
work is merged into, "main" unless set), `runGame` (the command that starts a working folder's game, a list of
words with `{folder}`, `{port}`, `{idle}`, `{grace}`, `{cache}`, `{node}` and `{board}` filled in; it prints
`ready <port>` once the game is served and ends by itself when nobody looks; `examples\config.json` has the one for
a Vite game, `run-game.mjs`; none unless set), `appSessions` (the app's list of chats), `transcripts`,
`port` (4310 unless set), `refreshSeconds`, `advisor` (the name of the advisor chat, "Advisor" unless set),
`pictureRoots` (the folders of `<project>` whose pictures the board shows, `["pictures"]` unless set; the first is
the project's own picture folder, where the board keeps the pictures pasted into Talk to Main, under `talk`) and the times
in `src/config.mjs`. `unfiledAskHours` (`2` unless set, a number above 0, B301): the warning "<chat> wrote questions in
its chat but filed no ask" goes by itself when the answer it is about is older than this many hours (no card, no count),
so a chat that has had no turn since does not keep it for ever. `designKinds` (`.claude/design.json` unless set): the project's file of what the Design tab tells Codex per kind of
idea, and its reference pictures; `examples\design.json` shows one. `goals` (`.claude/goals.md` unless set): the
project's goal map, which the Advisor tab's Goals part draws and, on the board that delivers, changes; `examples\goals.md` shows its form.
`brainstorms`, `goalAsks` and `goalsHistory` (`.claude/brainstorms`, `.claude/goal-asks`, `.claude/goals.history`
unless set) are the folders for the map's brainstorms (one thread file each, which the Advisor tab's Brainstorm part
shows and answers), the Advisor's long answers to the asks on it (its "More:" lines point there) and its daily copy.
These four may also be a whole path of their own, as `work`: a copy tried beside your board reads its own goal map.
`approveRebuilds` (false unless set, B359): whether a rebuild the goal guard's evaluation calls for goes ahead
without your yes. The guard (B752): when a part of a goal fails twice without real progress, or three times (its steps' result checks, its re-checks and your no to a look, counted from its Go, else from its
first refined step; any goal, the focus or not, B382, B450; the goal's next steps then are lifted to Effort: high while it evaluates, and the steps made from the how that ends it until the next Go, B518, B525; their model stays as given, 2026-10-25), the
board switches the partner to high effort and asks it for a fundamental evaluation of the approach, with what was tried;
it brings you 2 or 3 other ways to pick (with `approveRebuilds` on, it goes ahead with its advised way and gives you a
recap); the Focus page shows the count, the evaluation, and a rebuild that waits for you.
`botherMe` (`"now"` unless set, B360; `"daily"`): where the recaps of finished work and the questions that hold up no
chat reach you: each as a card under Needs your attention as it comes, or gathered under your partner's daily note on
the Focus page, answered there. A question that holds up a chat always comes at once.
Both are also the board's ⚙ panel (B361): "Bother me" (At once, Once a day) and "Approve rebuilds by itself" (Off,
On); B-max adds "Workers at most" (`maxWorkers`, 5 unless set: a "−", the number and a "+", 1 to 10). A click there writes the
setting into config.json, every other setting kept, and the board runs on it at once.
`advisorParts` (`["focus", "goals", "brainstorm"]` unless set): the parts the Focus tab's bar shows, by name; add
`"way"` (Next milestone), `"plan"` (Game plan), `"suggestions"`, `"refine"` or `"chat"` to bring one back.
`work` (`.claude/work` unless set): the work store's folder, a path inside the project or a whole path of its own
(a copy tried beside your board gives it a folder outside the project, and only then writes one). The store is
required: without it the board shows no work and says on top what to run.
`cpuLimit` (`"full"` unless set; `"low"`; the older `"off"`, `"gentle"`, `"strong"` read as full, full, low): the level of "CPU for Claude" until one is clicked on the
board; a copy beside your board starts at Full whatever it says.
`kinds` (none unless set): the project's kinds of work, each `{ "kind": "<name>", "done": "<its definition of done>",
"reference": "<its folder of reference pictures>" }`, paths inside `<project>` written with `/`; `examples\config.json`
shows one. A refined step whose title or text names a kind carries its standard (`Standard: <kind> · <reference
picture> · target <score>`, written by the partner), so every result is checked against something written before it
was built. The board knows no kind of its own; it shows the pictures of each kind's reference folder too.
`models` (none unless set): the app's model id of both model families a step may name, as the app's model picker
lists them: `{ "sonnet": "claude-sonnet-5-5", "opus": "claude-opus-5-5" }` (the ids of your app; `examples\config.json`
has these). Every step runs on the model its refine names (`Model: sonnet` unless it says opus) at its effort: the
main chat sets the worker's chat to both before the step goes to it, and an opus step waits until the app says its
worker runs on Opus. Without both ids, each starting with `claude-`, the board sets the effort alone and says so on
top. `usualModel` and `usualEffort` (`"sonnet"` and `"medium"` unless set): what a worker runs at between steps.
`supervisorModel` (`"sonnet"` or `"opus"`, `"sonnet"` unless set) and `supervisorEffort` (a level of the app's, `"low"` unless
set): what the Supervisor's chat runs at; the board holds it there by code, the way it sets a worker's chat (T7.5).
`providers` (T9.3, the defaults below unless set): who provides each kind of asset, an object from asset kind (`visual`, `music`,
`sound effect`) to a provider's name: `{ "visual": "codex", "music": "person-suno", "sound effect": "sound-library" }`.
`codex` makes pictures by itself, `person-suno` is you making music in Suno, `sound-library` is a folder of sounds in
the project (`.wav`, `.mp3`, `.ogg`, `.flac`) a chat picks from; `"sound effect": { "provider": "sound-library", "folder":
"sound-library" }` names the folder (inside `<project>`, written with `/`). A kind you leave out keeps its default; an
`"sound effect": "elevenlabs"` makes sound effects with ElevenLabs (the board only checks it now: your key is read from the user variable `ELEVENLABS_API_KEY`, never a file or a chat, and goes only to api.elevenlabs.io; free-plan output is for testing only, commercial use needs a paid plan). An unknown kind or provider, or a provider set for a kind it cannot serve, stops the board at its start with one line. The
Design tab's "Asset providers" shows, for each kind, its provider and whether it works (checked at the start and every
10 minutes). Nothing asks a provider for an asset yet.
`supervisor` (the defaults unless set): the thresholds of the board's watch rules, which report what does not look right
(the supervisor, `DESIGN.md`): `{ "unknownMinutes": 10, "suspendedMinutes": 10, "idleMinutes": 10, "notRunningMinutes":
30, "opusWaitMinutes": 15, "undeliveredMinutes": 10, "repairsPerDay": 3, "notClearedMinutes": 10, "oldReadingMinutes": 30, "oldReadingIncidentMinutes": 60, "oldReadingFiveHourPercent": 80, "oldReadingWeekPercent": 90 }`; any of them, each a
number above 0.
`supervisorSweepMinutes` (10 unless set): the soonest the board wakes the supervisor's chat again for a sweep while work
runs (a chat works or a step is taken or in progress; never while you pause all, at a full limit, or while the last sweep
runs); 0 for no sweep by the clock (Check now still sweeps). A sweep by the clock runs only when something odd is new since
the last one: a line the health summary marks "!" that the last sweep did not have (compared without times and minute
counts), or a rule that is tripped and was not then; otherwise the section says "nothing odd since the last sweep".
`supervisorSweepAtLeastHours` (4 unless set; a number above 0): the safety net, a sweep at least this often while work
runs, whatever the board looks like. Check now always sweeps. A sweep costs a few tens of thousands of tokens, mostly
cached (in practice 160,000 to 250,000 with the chat's own context); the supervisor's section shows each sweep's tokens and
the day's sum, so raise the minutes to save tokens.
The supervisor's section counts a rolling 24 hours, nothing to set: its head, folded or open, reads "Supervisor · 22 open ·
1 found in 24 h", and the open section starts its note with "Last 24 h: 1 found (21 the 24 h before), 12 fixed. Open: 0 in
work, 22 with the Advisor." Found is what opened or came back in the last 24 hours, with the same count for the 24 hours
before in brackets. Open is every incident not fixed (in work and with the Advisor together) whatever its age (an open one
never drops out of sight), and the section lists them; only fixed counts the last 24 hours. The older setting `supervisorCountFrom` (a start time) is gone; a config.json that still
has it starts as before and the board ignores it.

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

**The board hands out the work** (B300; redesign Part 2, 2026-10-25): the main chat only writes a step (`work new`);
once it is refined the board keeps it on one ready list (fixes first, then the focus goal's, then by id) and gives the
first suitable one to a worker the moment its chat reports idle (the person may pin a task to a worker). It types one
line into the worker's chat, "work: B286 is yours; run work next", once per step and worker; a worker that does not
take it within two minutes (`takeWithinMinutes`) gets it taken back and shows stuck, and with ready tasks waiting and
no worker free the board asks the main chat for one more, up to `maxWorkers` (5 unless set, B-max; the ⚙ panel's "Workers at most", 1 to 10) (kept in `<work>\delivered.json`, so a restart sends nothing
twice); a worker that ends a turn with nothing in progress asks for it itself (the Workers mod 0.12.0 or newer). A worker that holds a step but does not
run is flagged on its lane after ten minutes with a button "Start <worker>" (the main chat starts it); so are a failed
check and a card that names another step, and a file of the store the board cannot read stands on the top line.

`<project>\.claude\chats\list.json`: `prefix` and `main` (the main chat's title is the two together), `boards` (the
launch entries the mod keeps running) and `compactAbove` (a chat larger than this many tokens is compacted: a worker
after it reports, the main chat and the partners while they rest; 250000 unless set, 0 for never). An empty `boards`
list switches the automatic start off. `helper` names the partner's helper (B424): a chat shown under the Advisor and
never given a queue, whose refines and result checks the work tool takes as the partner's. `afterStep` says what
becomes of a worker after its reported step: `"compact"` (unless set: above `compactAbove`, and not while more of the
same work follows), `"clear"` or `"off"`. `compactAtRest` (`true` unless set) switches the main chat's and the
partners' compaction at rest off with `false`, and leaves the workers' as it is. `supervisor` names the supervisor's
chat (the supervisor, `DESIGN.md`): no lane and no queue; the board wakes it for a sweep (it reads `work health` and
files `work incident`, nothing else; its job is `roles\supervisor.md`), and its Workers mod (0.16.0 or newer) clears it
after every turn, without a log. Without it the code rules run as before, and "Check now" says why no sweep ran.

**Clear after each step** (`"afterStep": "clear"`, the Workers mod 0.14.0): after the turn in which a worker reported
its step, the mod has the board keep the conversation, then runs /clear, also when more work follows, so every step
starts with an empty history (re-reading long histories was most of the chats' usage). The board writes the log, at
no token cost: `<project>\.claude\chat-logs\<chat>\<YYYY-MM-DD HHmm> <step>.txt`, each message with its time and
speaker and every tool call and result in full, with an exact copy of the transcript beside it (`.jsonl`); a log not
finished when the board stops is finished at its next start (`data\chat-logs.json`). The chat's card moves to its new
session id and the board follows it, so its lane, steps, asks and instructions stay the same chat's; the lane says
"cleared after B482 · log", and "log" opens the text in the board. A worker that may not be cleared then (the person
pauses, a question not filed as an ask, something of it still running, no log) is compacted as before.

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

Without a keyboard, or to skip the questions, give the answers up front (B324):

```powershell
npm run new -- --name "My garden" --folder "D:\Work\My garden" --prefix "Garden - "
```

Without `--folder` the project goes beside this board's own project, or, for a board that has none yet (the one the
install got), into `Projects` in your home folder. The install takes the same answers as settings before its second
line: `$env:WORKER_BOARD_FOLDER` (where the board goes), `$env:WORKER_BOARD_PROJECT`, `$env:WORKER_BOARD_PROJECT_FOLDER`
and `$env:WORKER_BOARD_PREFIX`; what is not given is asked, or, where nobody types, takes its default. A project
folder given that holds a project already is kept as it is. The new board
shows one button, Initialise: it opens the project's main chat in the Claude app with its first words, you press
Enter, and the main chat names itself, joins the list and starts the Advisor and the workers by cards you click.

## What it reads (never changes)

- the app's list of chats, and the last part of each project chat's transcript;
- each chat's card and requests (`.claude\chats`, `.claude\asks`), the work store and the goal map (`goals`,
  `.claude\goals.md`, also the way to the next milestone) in `<project>\.claude`, and the game plan in the game's
  repository (`gamePlan` in `config.json`, `docs/game-plan.md`) for the Advisor tab, and the product plan beside it
  (`productPlan`, `docs/product-plan.md`) for the Vision tab;
- the app's usage file for the limits, pictures in the picture folders of `<project>`, and the working folders through git
  commands that only read.

## What it writes

`data\` in its folder, which git ignores: the history, what you sent (`outbox.jsonl`), when the board last ran,
the Design tab's ideas and the level of "CPU for Claude" (`cpu.json`). Outside it: `<project>\.claude\board.json` while it runs (where the mod finds it), the
pictures Codex makes in the Design tab's ideas folder (`ideas` in the project's picture folder), the evidence pictures of `tools/evidence.mjs` (under the step in the picture folder), and the work store
(`work`, `.claude\work` unless set), on the chats' `work` calls and your clicks, with `backlog.md` written from it as a
view (see "The work store" above).

## Safety

The server listens on 127.0.0.1 only. The page gets a random token at each start; reading needs it, and sending
also needs the page's own origin and a JSON body, so another website in your browser can do neither. An answer is
accepted only for a request that is open and only to the chat that asked. What a chat said is shown on the page
and kept in `data\`; it is never printed or logged. To open a chat when none runs (T13 part 4) the board starts only
the Claude app's own `claude.exe` with `--desktop --resume <session id>`, the id from its own list of chats and
checked as a UUID; nothing a request carries goes into it.

## Working on the board itself

> **For any project (B191).** Every change to the worker board works for any project. No game, chat, folder
> or PC names in the code, the page, the job texts (`roles/`) or the examples: names, paths and words come from the
> settings (`config.json`) or the project's own files. `test/anyProject.test.mjs` fails on a new tie; the ties known
> today are listed there, each with the part of `ANY-PROJECT-PLAN.md` that removes it, and that list only shrinks.
> The user, 2026-10-14: "first ensure that its clear to all future work that this is the constraint if i develop
> something the worker board."

## Git

`origin` is https://github.com/bobduncan/Worker-board.git. For every chat that works on the board:
- Push a branch when you make it and as you commit to it (`git push -u origin <branch>`).
- After a merge into main: push main, delete the merged branch on the remote too
  (`git push origin --delete <branch>`), and prune (`git fetch --prune`).
- Never force-push main.
- Nothing that holds words from a chat goes into the repository: `data\` stays ignored, and the tests keep made-up
  samples. Look at what a commit adds before you push it: the repository is public, anyone can read it.

## Not yet portable

What still tied the board to the project it was built for or to one PC, found on 2026-10-14 by
following the steps above in an empty, made-up project with another prefix (Node v24.19.0). Steps 3, 5, 9 and
10 need the app and real chats: the trial stood in for them with made-up chat files. Each point is a step on that
project's backlog, part of B126 (the board for any project).

1. Done (B127): `config.json` is not in the repository; a new copy makes it from `examples\config.json` at its first
   start and says which paths to fill in.
2. Done (B128): a `config.json` that is not valid JSON, or holds a setting of the wrong kind, stops the board with
   one line saying what is wrong and where; the yellow note does not start a new version on such a file.
3. Done (B129): the page and the tab show the project's own name, the setting `name` (by default the project folder's
   name).
4. Done (B130): no chat's name stands in fixed words; the main chat's title comes from the list of chats
   (`test/anyProject.test.mjs` keeps it so).
5. Done (B131): without a right `list.json` the board guesses no prefix and no main chat; it shows no chats and
   says which file it looks for.
6. Done: with `gameRepo` empty there is no game (B132): no "Run game", no "Open the game" and no play links, and the
   board never takes its own folder for the game. The base branch is the setting `baseBranch` (B194), and how a game
   starts the setting `runGame` (B197), with `run-game.mjs` (Vite) as the example.
7. Done (B133): the Design tab's kinds of idea and reference pictures are the project's own file (`designKinds`);
   without one the tab says what it needs. Its ideas live in `ideas` in the project's picture folder (B198).
8. Done (B134): `transcripts` is worked out from `project` (the app keeps a project's transcripts in the person's
   `.claude\projects`, in a folder named after the project's path); set it only to read another folder.
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
14. Done (B319): two projects' boards run side by side on one PC, each on a port and with game ports of its own.
15. Done (B320): a new project in one click (`npm run new`, or New project under the gear): its folder, its own copy
    of the board, its work store, its CLAUDE.md and an icon that starts its board.
16. Done (B321): one command installs the board on a Windows PC (Install, at the top).
17. Done (B322): a new project's main chat and Advisor open from its board in one click each, then Enter: the Claude
    app opens a new chat in a folder with its first words from a link, but nothing from outside sends them.
18. Still open: a Mac (B215, not tried); a real installer (.exe) with signing, a goal of its own later; a
    `transcripts` setting that names the wrong folder is not pointed out (11).
19. Tried on 2026-10-18 (B324): a helper that had only this README installed the board on the PC of the first
    project, beside that project's running board, and made a project "Trial". Its board ran at once on a port of its
    own, the first board kept its port and answered as before, and setup left the PC's Workers mod as it was
    ("Nothing to do"). The person clicked Initialise on the Trial board and pressed Enter: the main chat named itself,
    joined the list, read its job and, asked by the board, put up cards for three workers. Found and fixed: the install
    could not be given the project's name without a keyboard (the settings above); `npm run new`'s options and where a
    project goes without `--folder` were not in this README; the main chat's first words named a chip tool the app
    did not give it (it starts the Advisor by the tool it has now). Not tried: another PC.
