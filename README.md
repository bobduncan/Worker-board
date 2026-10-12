# Worker board

One page on this PC that shows the Lava Tactics chats: who is working, waiting for you or free, which task each
is on and for how long, what is queued, what waits for you, the game's working folders, today's timeline, the
advisor's advice, and the main chat. `DESIGN.md` is the agreed design; `BRIEF.md` describes the sources.

## Start
```
node server.mjs                      real data, at http://127.0.0.1:4310/
node server.mjs --demo --port 4311   made-up data, to judge the page without the real files
node --test                          the tests
```
In the Claude app it is the launch entry "worker-board". Paths and the port are in `config.json`.

## What it reads (never changes)
- the Claude app's list of chats, and the last part of each game chat's transcript;
- each chat's own plan line, the backlog and `advice.md` in the project's `.claude` folder;
- the game's working folders, through git commands that only read.

## What it writes
Only `data/` in this folder, which git ignores: `history.jsonl` (when a chat's state or task changed),
`outbox.jsonl` (what you typed in the chat box) and `alive.json` (when the board last ran). Nothing delivers what
you type yet: that is the bridge in the `folder-branches` mod, the next step.

## Safety
The server listens on 127.0.0.1 only. The page gets a random token at each start; reading the state needs it, and
sending also needs the page's own origin and a JSON body, so another website in your browser can do neither.
What a chat said is shown on the page and kept in `data/`; it is never printed or logged.
