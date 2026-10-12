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

## What it reads (never changes)
- the Claude app's list of chats, and the last part of each game chat's transcript;
- each chat's own plan line, its asks (`.claude\asks`), the backlog and `advice.md` in the project's `.claude` folder;
- pictures in the project's `art-inbox`, and the game's working folders through git commands that only read.

## What it writes
Only `data/` in this folder, which git ignores: `history.jsonl` (when a chat's state or task changed),
`outbox.jsonl` (your answers and what you typed to the advisor) and `alive.json` (when the board last ran).
Nothing delivers what you send yet: that is the bridge in the `folder-branches` mod.

## Safety
The server listens on 127.0.0.1 only. The page gets a random token at each start; reading needs it, and sending
also needs the page's own origin and a JSON body, so another website in your browser can do neither. An answer is
accepted only for a request that is open and only to the chat that asked. What a chat said is shown on the page
and kept in `data/`; it is never printed or logged.
