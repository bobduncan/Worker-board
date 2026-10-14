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
chat it is for. Further tabs: Advice & Chat (an advisor chat, optional), Backlog (the whole backlog, with the steps finished last at its top), Design (an
idea becomes a picture made by Codex, optional). `DESIGN.md` is the agreed design.

## What you need

| What | What for |
|---|---|
| Windows, the Claude desktop app, signed in | The board reads the app's list of chats and their transcripts on this PC. Not tried on a Mac. |
| Node 24 or newer, and git | Node runs the board (no `npm install`, no dependencies; `package.json` names the Node it needs and the scripts `start`, `demo` and `test`); git gets it and lists the working folders. |
| The Workers mod `folder-branches` | Keeps each chat's card (a chat without it can write its card itself, see `roles/worker.md`), types your answers from the board into the chats, and keeps the board running. |
| A project folder | Holds the code's repository and the board as folders of their own. Every chat of the project is opened in the project folder itself, not in a folder inside it: the app keeps the transcripts per folder. |
| One main chat, titled `<prefix>Main` | It hands out the work, and the board types its words (restart, resume, start a chat) into it. |
| `<project>\.claude\chats\list.json` | Names the prefix of the chats' titles and the main chat. |
| `<project>\.claude\backlog.md` | The steps: the queue and what is yours come from it. |
| A launch entry | `<project>\.claude\launch.json`, from which the mod starts the board. |

Not needed: the Backlog mod `backlog` (B209: the board reads and ticks the backlog itself and has its own Backlog
tab; the job texts in `roles\` tell the chats how to keep it). Used when there: the Run mod `start-app` (a Run pane
in the app), Codex (pictures on the Design tab), an advisor chat. `examples\` holds a starting `config.json`, `list.json` and `backlog.md`, and
the briefings for the main chat and the workers.

## From nothing to a running board

`<project>` is your project's folder, `<prefix>` the start of every chat title of the project, for example
"My Project - ". Each step ends with what you see when it worked.

1. **Node.** Install Node 24 or newer. → `node --version` prints `v24` or higher.
2. **The Workers mod.** It is on one PC only for now (see "Not yet portable"): copy the folder
   `C:\Users\<you>\.claude\mods` from that PC to the same place, with its `.claude-plugin\marketplace.json` and the
   folder `folder-branches`. The command `claude` comes with the app but is not on the PATH. In your own PowerShell,
   with the app from the Microsoft Store, it is
   `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\<version>\<hash>\claude.exe`
   (only the app's own shells see it as `%APPDATA%\Claude\claude-code\...`); with the app from claude.ai's own
   installer the folder may differ. A `claude` installed apart, on the PATH, does the same. Then:
   ```
   claude plugin marketplace add C:\Users\<you>\.claude\mods
   claude plugin install folder-branches@my-mods --scope user
   ```
   → `claude plugin list` shows `folder-branches@my-mods`, version 0.8.0 or later, enabled.
3. **Start the app anew.** Quit it fully and open it again: a chat gets the mod only when its process starts, and
   `/reload-plugins` does not do it. → a new chat has the command `/workers`.
4. **The project's files.** Make `<project>\.claude\` and copy into it from `examples\`: `list.json` into
   `.claude\chats\` with your prefix, `backlog.md`, `main-briefing.md` and `worker-briefing.md`; in the two briefings
   replace `<project>`, `<prefix>` and `<repository>`. The two briefings hold only the project's own facts: the
   general jobs are `roles\main.md` and `roles\worker.md`, the words the board reads are in `roles\protocol.md`. → `<project>\.claude\chats\list.json` names your prefix.
5. **The main chat.** In the Claude app, start a new chat in the folder `<project>`, name it `<prefix>Main` (the
   prefix and the main chat's name from `list.json`), and send it: "Read .claude\main-briefing.md and join the list
   of chats as the main chat." → `/workers` shows "Main" as the main chat, and `%USERPROFILE%\.claude\projects\`
   has a folder for the project: its path with `:` and `\` as `-` (`C:\Work\my-project` becomes
   `C--Work-my-project`).
6. **The board.** In `<project>`:
   ```
   git clone https://github.com/bobduncan/Worker-board.git worker-board
   cd worker-board
   npm test
   ```
   → the tests end with `fail 0`. `npm run demo -- --port 4311` shows the page with made-up data, if you
   want to look first (Ctrl+C ends it).
7. **Its settings.** Start the board once with `npm start`: it makes `config.json` in its folder from
   `examples\config.json`, says which paths to fill in, and stops. The file stays on your PC: it is not in git. In it,
   `name` is the project's name, the board's title (left out, it is the project folder's name), `project` is
   `<project>`, `transcripts` the folder of step 5, `gameRepo` the folder of your code's git repository (empty until
   there is one), `port` a free port. Write `\\` for every `\` in a path, or use `/`. With the app from the
   Microsoft Store, `%APPDATA%\Claude` holds the app's files only for programs the app starts (the mod, the Run
   pane); a board you start from your own PowerShell finds them only under the package folder: set `appSessions` to
   `%LOCALAPPDATA%\\Packages\\Claude_pzs8sxrjxfjjc\\LocalCache\\Roaming\\Claude\\claude-code-sessions` and
   `usageHistory` to `plan-usage-history.json` in that same `Claude` folder. →
   `npm start` prints `Worker board: http://127.0.0.1:<your port>/`. Ctrl+C ends it. A file that is not valid JSON,
   or holds a setting of the wrong kind, stops the board with one line that names the file, what is wrong and
   where (for example "not valid JSON at line 3, column 14", or `"port" must be a number above 0`).
8. **The launch entry.** `node server.mjs --launch-entry` → it prints `Launch entry "worker-board" in
   <project>\.claude\launch.json`. With `"boards": ["worker-board"]` in `list.json`, every chat in the list starts
   the board when it does not answer, within 15 seconds: no need to start it yourself, also after a restart.
   **Without the Workers mod** (B211): `node start-board.mjs` starts the board in the background when it does not run
   yet and prints where it runs (its own words go to `data\board.log`); a second call says it runs already. To have
   it start with every chat of the project, copy `examples\settings.json` to `<project>\.claude\settings.json` (or add
   its hook to the one there) and put the board's folder for `<board>`: a chat that opens then starts the board,
   quietly, when it does not answer.
9. **Open it.** Open `http://127.0.0.1:<your port>/` in a browser. → the lane "Main" comes first, under it "No
   workers yet" (step 11); "For you" holds B1 and B2 under "From the backlog"; Main's queue holds B4, waiting for B2.
   Without a main chat the page says "No main chat yet" and how to make one, as step 5 does.
10. **The way back.** Answer B2 on the board (a few lines, then send). → the card says "typed into its chat", and the
    main chat has your words with "(answered on the worker board, HH:MM)".
11. **Workers.** With a main chat and no worker, the board asks the main chat for three workers by itself, once,
    while the main chat's chat is open (it types "spawn workers" into it); "Ask for three workers" does the same.
    The main chat starts them, or puts a chip "<prefix>Worker N" into its chat for each: click each chip, one chip
    starts one worker. → each worker shows as a lane. "+ One more worker" under the last lane asks for one more.

## Daily use

- Tell the main chat what you want; it writes the steps and hands them out. A worker asks you in its own chat or
  as a card under "For you", which you answer on the board.
- A lane shows what a worker does now and the time it expects to need; a step that waits says why ("Not started:
  ...").
- The head shows the plan's limits; a worker that paused for the limit shows as "Suspended" until it goes on.
- Before you quit the app: "Prepare restart" on the board, and "Resume all" after it is open again.
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
idea, and its reference pictures; `examples\design.json` shows one.

`<project>\.claude\chats\list.json`: `prefix` and `main` (the main chat's title is the two together), `boards` (the
launch entries the mod keeps running) and `compactAbove` (a worker larger than this many tokens is compacted after
it reports; 250000 unless set, 0 for never). An empty `boards` list switches the automatic start off.

The backlog's form, which the board reads: an activity is a `## ` heading (`#focus` after it marks your main
focus); a step is `- [ ] B<number> ...`, ticked `- [x]`; `@you` at its end is a step for you, starting with
`Verify:`, `Decide:`, `Provide:` or `Do:`; the queue is the open steps under a heading that starts with "Next to
hand out", each ending in `(for <worker>; now | after B<number>; about <time>)`; indented lines under a step
describe it. A step that names a folder in one of the picture folders shows its pictures.

## A copy beside it

A copy in another working folder of this repository (a branch being worked on) runs beside the board: started
without `--port`, it takes a port of its own from 4320 up, the same one every time (it writes it to its
`data/port.json`), and says which; the board in the main folder keeps the port of `config.json`. A copy only
shows: answers are given on the board in the main folder.

## What it reads (never changes)

- the app's list of chats, and the last part of each project chat's transcript;
- each chat's card and requests (`.claude\chats`, `.claude\asks`) and the backlog in `<project>\.claude`, and the game
  plan in the game's repository (`gamePlan` in `config.json`, `docs/game-plan.md`) for the Advice & Chat tab;
- the app's usage file for the limits, pictures in the picture folders of `<project>`, and the working folders through git
  commands that only read.

## What it writes

`data\` in its folder, which git ignores: the history, what you sent (`outbox.jsonl`), when the board last ran
and the Design tab's ideas. Outside it: `<project>\.claude\board.json` while it runs (where the mod finds it), the
pictures Codex makes in the Design tab's ideas folder (`ideas` in the project's picture folder), and in the backlog one thing only: the tick of a step you
approved or marked done on the board, with a line under it.

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
following the steps above in an empty, made-up project with another prefix (Node v24.19.0). Steps 2, 3, 5, 10 and
11 need the app and real chats: the trial stood in for them with made-up chat files. Each point is a step on that
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
9. Windows only as written: `%NAME%` in paths, the app's folders under `%APPDATA%\Claude` (for the Store app
   only as the app's own programs see it; the real folder is in its package folder, step 7), backslashes in
   `src/appChats.mjs` (`folderKey`), `codex.exe` under `%LOCALAPPDATA%\OpenAI\Codex` (`src/codex.mjs`). B135
10. Done (B136): `package.json` names Node 24 or newer, and the scripts `start`, `demo` and `test`.
11. Done (B137): an empty board says under its lanes what it looks for and where: the list of chats, a chat of the
    project, the backlog. Still open: a `transcripts` setting that names the wrong folder is not pointed out.
12. `BRIEF.md` and `DESIGN.md` name that project's folders and chats throughout. B138
13. The Workers mod is on one PC only, in no repository: step 2 copies its folder by hand. B125 works on it.
