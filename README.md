# Worker board

One page on this PC for working with the Lava Tactics chats. Overview: a lane per worker (state, task, the time it
expects to be done, its queue), what waits for you with a form to answer it, and today's timeline. Advice & Chat:
the advisor's advice and a conversation with the advisor. `DESIGN.md` is the agreed design.

## Start
```
node server.mjs                      real data, at http://127.0.0.1:4310/
node server.mjs --demo --port 4311   made-up data, to judge the page without the real files
node --test                          the tests
```
In the Claude app it is the launch entry "worker-board". Paths, the port and the advisor's name are in `config.json`.

A copy in another working folder of this repository (a branch being worked on) runs beside it: started without
`--port`, it takes a port of its own from 4320 up, the same one every time (it writes it to its `data/port.json`),
and says which; the board in the main folder keeps the port of `config.json`. `node server.mjs --launch-entry`, run
once in a new folder, writes that folder's launch entry with its port into the project's `.claude/launch.json`.

## What it reads (never changes)
- the Claude app's list of chats, and the last part of each game chat's transcript;
- each chat's own plan line, its asks (`.claude\asks`), the backlog and `advice.md` in the project's `.claude` folder;
- pictures in the project's `art-inbox`, and the game's working folders through git commands that only read.

## What it writes
Only `data/` in this folder, which git ignores: `history.jsonl` (when a chat's state or task changed),
`outbox.jsonl` (your answers and what you typed to the advisor), `alive.json` (when the board last ran) and
`ideas.json` (the ideas of the Design tab). And one folder outside it: the pictures Codex makes for those ideas go
to `art-inboxideas` in the project, with the words each was made with beside it.
The Workers mod (`folder-branches`) takes what you send and types it into the chat it is for.

## Safety
The server listens on 127.0.0.1 only. The page gets a random token at each start; reading needs it, and sending
also needs the page's own origin and a JSON body, so another website in your browser can do neither. An answer is
accepted only for a request that is open and only to the chat that asked. What a chat said is shown on the page
and kept in `data/`; it is never printed or logged.

## Git
The repository has a remote since 2026-10-12: `origin`, https://github.com/bobduncan/Worker-board.git. The rule,
from the person, for every chat that works here:
- Push a branch when you make it and as you commit to it (`git push -u origin <branch>`).
- After a merge into main: push main, delete the merged branch on the remote too
  (`git push origin --delete <branch>`), and prune (`git fetch --prune`), so the remote shows the same branches as
  this folder.
- Never force-push main.
- Nothing that holds words from a chat goes into the repository: `data/` stays ignored, and the tests keep made-up
  samples. Look at what a commit adds before you push it: a push shows it to whoever can see that repository.

## Not yet portable

DRAFT of B123, paused on 2026-10-14 in the middle of the trial; the rest of this README is still the old one.
Found by starting a fresh clone for an empty, made-up project (prefix "Orchard - ", port 4332, Node v24.19.0; the
407 tests pass in the clone). B126 starts from this list, so each point names the file.

Tied to Lava Tactics:
1. `config.json` in the repository holds this project's paths. A clone started unchanged uses them, and on a PC
   without that folder the board would make it, to write `.claude\board.json` (`server.mjs`, where it listens;
   read from the code, not tried).
2. The page's title is "Lava Tactics" (`public/index.html` line 26), also in the demo.
3. "Game - Main" stands in fixed words: `public/index.html` line 18, `public/board.js` line 561,
   `src/design.mjs` line 111.
4. Without `<project>\.claude\chats\list.json` the board looks for chats titled "Game - " and a main chat "Main"
   (`src/appChats.mjs` line 55). Nothing makes that file: it is written by hand.
5. The game: the key `gameRepo`, the "Run game" button that is always there, and `run-game.mjs`, which only runs a
   folder with its own Vite. With `gameRepo` empty, git answers for the folder the board was started from: the
   trial showed the board's own commit as the game's. The branch name `main` is fixed (`src/folders.mjs` line 49).
6. `design.json`: the opening words and the reference pictures of all four kinds are Lava Tactics', and one path
   takes the board's folder to be `<project>\worker-board`.
7. The backlog's form is fixed in the code: the queue's heading starts with "Next to hand out", an id is
   "B<number>" (`src/backlog.mjs`).
8. `BRIEF.md` and `DESIGN.md` name this project's paths and chats throughout.

Tied to this PC or to Windows:
9. A `config.json` that is not valid JSON makes the board take its defaults without a word: port 4310 and no
   project. It happened in the trial, through single backslashes in a path (`src/config.mjs`, `parseConfig`).
10. `transcripts` is a folder the app names after the project's path ("C--Web-lava-tactics-project"). A newcomer
    has to look it up once a first chat exists; the board could work it out from `project`.
11. Windows only as written: `%NAME%` in paths, the app's folders under `%APPDATA%\Claude`, backslashes in
    `src/appChats.mjs` (`folderKey`), `codex.exe` under `%LOCALAPPDATA%\OpenAI\Codex` (`src/codex.mjs`). Not tried
    on a Mac.
12. No file says which Node is needed (there is no `package.json`). Tried with v24.19.0 only.
13. The Workers mod (`folder-branches`, 0.8.0) is in no repository: it lives in `%USERPROFILE%\.claude\mods` on
    one PC. Without it the board shows, but no answer reaches a chat (B125 works on this).

What a newcomer is not told:
14. For an empty project the page shows 0 working, 0 waiting, 0 free and nothing else: not which titles it looks
    for, nor in which folder, nor that the backlog is missing.

Still to try: `list.json` and a starting backlog with another prefix, with made-up chat files; forward slashes in
`config.json`; a press on "Run game"; `--launch-entry` in the made-up project; the advisor's part.
