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
