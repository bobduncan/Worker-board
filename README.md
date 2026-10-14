# Worker board

One page on your PC for a project in which several Claude chats work together: one main chat hands out the tasks,
worker chats do them. The Overview shows a lane per chat (working, waiting for you, free; its task, step and time
left; its queue), what waits for you with a form to answer it, and the day's timeline. Your answer is typed into the
chat it is for. Further tabs: Advice & Chat (an advisor chat, optional), Coordinate (the whole backlog), Design (an
idea becomes a picture made by Codex, optional). `DESIGN.md` is the agreed design.

## What you need

| What | What for |
|---|---|
| Windows, the Claude desktop app, signed in | The board reads the app's list of chats and their transcripts on this PC. Not tried on a Mac. |
| Node 24 or newer, and git | Node runs the board (no `npm install`, no dependencies); git gets it and lists the working folders. |
| The Workers mod `folder-branches` | Keeps each chat's card, types your answers from the board into the chats, and keeps the board running. |
| A project folder | Holds the code's repository and the board as folders of their own. Every chat of the project is opened in the project folder itself, not in a folder inside it: the app keeps the transcripts per folder. |
| One main chat, titled `<prefix>Main` | It hands out the work, and the board types its words (restart, resume, start a chat) into it. |
| `<project>\.claude\chats\list.json` | Names the prefix of the chats' titles and the main chat. |
| `<project>\.claude\backlog.md` | The steps: the queue and what is yours come from it. |
| A launch entry | `<project>\.claude\launch.json`, from which the mod starts the board. |

Not needed, but used when there: the mods `backlog` (a Backlog pane) and `start-app` (a Run pane), Codex (pictures
on the Design tab), an advisor chat. `examples\` holds a starting `config.json`, `list.json` and `backlog.md`, and
the briefings for the main chat and the workers.

## From nothing to a running board

`<project>` is your project's folder, `<prefix>` the start of every chat title of the project, for example
"My Project - ". Each step ends with what you see when it worked.

1. **Node.** Install Node 24 or newer. → `node --version` prints `v24` or higher.
2. **The Workers mod.** It is on one PC only for now (see "Not yet portable"): copy the folder
   `C:\Users\<you>\.claude\mods` from that PC to the same place, with its `.claude-plugin\marketplace.json` and the
   folder `folder-branches`. The command `claude` comes with the app but is not on the PATH: it is
   `%APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe`. Then:
   ```
   claude plugin marketplace add C:\Users\<you>\.claude\mods
   claude plugin install folder-branches@my-mods --scope user
   ```
   → `claude plugin list` shows `folder-branches@my-mods`, version 0.8.0 or later, enabled.
3. **Start the app anew.** Quit it fully and open it again: a chat gets the mod only when its process starts, and
   `/reload-plugins` does not do it. → a new chat has the command `/workers`.
4. **The project's files.** Make `<project>\.claude\` and copy into it from `examples\`: `list.json` into
   `.claude\chats\` with your prefix, `backlog.md`, `main-briefing.md` and `worker-briefing.md`; in the two briefings
   replace `<project>`, `<prefix>` and `<repository>`. → `<project>\.claude\chats\list.json` names your prefix.
5. **The main chat.** Open a new chat in `<project>`, rename it to `<prefix>Main`, and send it: "Read
   .claude\main-briefing.md and join the list of chats as the main chat." → `/workers` shows "Main" as the main
   chat, and `%USERPROFILE%\.claude\projects\` has a folder for the project: its path with `:` and `\` as `-`
   (`C:\Work\my-project` becomes `C--Work-my-project`).
6. **The board.** In `<project>`:
   ```
   git clone https://github.com/bobduncan/Worker-board.git worker-board
   cd worker-board
   node --test
   ```
   → the tests end with `fail 0`. `node server.mjs --demo --port 4311` shows the page with made-up data, if you
   want to look first (Ctrl+C ends it).
7. **Its settings.** Write `config.json` in the board's folder after `examples\config.json`: `project` is
   `<project>`, `transcripts` the folder of step 5, `gameRepo` the folder of your code's git repository (empty until
   there is one), `port` a free port. Write `\\` for every `\` in a path, or use `/`. →
   `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8'))"` prints nothing (an error means a fault
   in the file, and the board would silently take its defaults), and `node server.mjs` prints
   `Worker board: http://127.0.0.1:<your port>/`. Ctrl+C ends it.
8. **The launch entry.** `node server.mjs --launch-entry` → it prints `Launch entry "worker-board" in
   <project>\.claude\launch.json`. With `"boards": ["worker-board"]` in `list.json`, every chat in the list starts
   the board when it does not answer, within 15 seconds: no need to start it yourself, also after a restart.
9. **Open it.** Open `http://127.0.0.1:<your port>/` in a browser. → the lane "Main" comes first; "For you" holds B1
   and B2 under "From the backlog"; Main's queue holds B4, waiting for B2.
10. **The way back.** Answer B2 on the board (a few lines, then send). → the card says "typed into its chat", and the
    main chat has your words with "(answered on the worker board, HH:MM)".
11. **Workers.** Ask the main chat for a worker: it puts up a chip "<prefix>Worker 1" that you click, and the new
    chat reads its briefing. → a lane "Worker 1" appears. (B124, being built: the board asks the main chat for three
    workers when it has none, and for one more on a button.)

## Daily use

- Tell the main chat what you want; it writes the steps and hands them out. A worker asks you in its own chat or
  as a card under "For you", which you answer on the board.
- A lane shows what a worker does now and the time it expects to need; a step that waits says why ("Not started:
  ...").
- The head shows the plan's limits; a worker that paused for the limit shows as "Suspended" until it goes on.
- Before you quit the app: "Prepare restart" on the board, and "Resume all" after it is open again.

## Settings

`config.json`, next to `server.mjs`: `project`, `gameRepo`, `appSessions` (the app's list of chats), `transcripts`,
`port` (4310 unless set), `refreshSeconds`, `advisor` (the name of the advisor chat, "Advisor" unless set),
`pictureRoots` (the folders of `<project>` whose pictures the board shows, `["art-inbox"]` unless set) and the times
in `src/config.mjs`. `design.json`: what the Design tab tells Codex per kind of idea.

`<project>\.claude\chats\list.json`: `prefix` and `main` (the main chat's title is the two together), `boards` (the
launch entries the mod keeps running) and `compactAbove` (a worker larger than this many tokens is compacted after
it reports; 250000 unless set, 0 for never). An empty `boards` list switches the automatic start off.

The backlog's form, which the board reads: an activity is a `## ` heading (`#focus` after it marks your main
focus); a step is `- [ ] B<number> ...`, ticked `- [x]`; `@you` at its end is a step for you, starting with
`Verify:`, `Decide:`, `Provide:` or `Do:`; the queue is the open steps under a heading that starts with "Next to
hand out", each ending in `(for <worker>; now | after B<number>; about <time>)`; indented lines under a step
describe it. A step that names a folder of `art-inbox` shows its pictures.

## A copy beside it

A copy in another working folder of this repository (a branch being worked on) runs beside the board: started
without `--port`, it takes a port of its own from 4320 up, the same one every time (it writes it to its
`data/port.json`), and says which; the board in the main folder keeps the port of `config.json`. A copy only
shows: answers are given on the board in the main folder.

## What it reads (never changes)

- the app's list of chats, and the last part of each project chat's transcript;
- each chat's card and requests (`.claude\chats`, `.claude\asks`), the backlog and `advice.md` in `<project>\.claude`;
- the app's usage file for the limits, pictures in `<project>\art-inbox`, and the working folders through git
  commands that only read.

## What it writes

`data\` in its folder, which git ignores: the history, what you sent (`outbox.jsonl`), when the board last ran
and the Design tab's ideas. Outside it: `<project>\.claude\board.json` while it runs (where the mod finds it), the
pictures Codex makes in `<project>\art-inbox\ideas`, and in the backlog one thing only: the tick of a step you
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

1. `config.json` is in the repository with that project's paths. A clone started unchanged uses them, and on a PC
   without that folder the board makes it, to write `.claude\board.json` there (`server.mjs`). B127
2. A `config.json` that is not valid JSON makes the board take its defaults without a word: port 4310 and no
   project (`src/config.mjs`, `parseConfig`). It happened in the trial, through single backslashes. B128
3. The page's title is "Lava Tactics" (`public/index.html`, line 26), also in the demo. B129
4. "Game - Main" stands in fixed words: `public/index.html` line 18, `public/board.js` line 561, `src/design.mjs`
   line 111. B130
5. Without `list.json` the board looks for chats titled "Game - " and a main chat "Main" (`src/appChats.mjs`,
   line 55), and says nothing. B131
6. The game is built in: the key `gameRepo`, a "Run game" button that is always there, `run-game.mjs`, which runs
   only a folder with its own Vite, and the branch name `main` (`src/folders.mjs`, line 49). With `gameRepo` empty,
   git answers for the folder the board was started from: in the trial the head showed the board's own commit as
   the game's, and "Run game" failed on `worker-board\node_modules\vite`. B132
7. `design.json` holds Lava Tactics' words and reference pictures for all four kinds of idea, and a path that takes
   the board to be in `<project>\worker-board`. B133
8. `transcripts` has to be looked up by hand (step 5); the board could work it out from `project`. B134
9. Windows only as written: `%NAME%` in paths, the app's folders under `%APPDATA%\Claude`, backslashes in
   `src/appChats.mjs` (`folderKey`), `codex.exe` under `%LOCALAPPDATA%\OpenAI\Codex` (`src/codex.mjs`). B135
10. No file says which Node is needed: there is no `package.json`. Tried with Node 24 only. B136
11. For a project without chats, `list.json` or backlog the page shows 0 working, 0 waiting, 0 free and nothing
    else: not which titles it looks for, nor where. B124 adds the word for a missing main chat. B137
12. `BRIEF.md` and `DESIGN.md` name that project's folders and chats throughout. B138
13. The Workers mod is on one PC only, in no repository: step 2 copies its folder by hand. B125 works on it.
