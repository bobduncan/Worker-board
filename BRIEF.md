# Worker board: a crude first version

A brief for Codex. Build what is described here, in this folder, and nothing outside it.

## What this is for

One person builds a game with several Claude chats working at once in the Claude desktop app: one main chat that
hands out tasks, and four worker chats that do them. He loses track of who is doing what. He wants one page on
localhost that shows:

- which workers there are, and whether each is working, waiting for him, or free;
- which task each one picked up, which step it is on, how long it has taken and how long it still expects;
- which tasks are queued, and which decisions wait for him;
- a chat box to the main chat, on the same page.

This version is a crude design. It exists so he can look at it with his real data and say what to change. Plain
and working beats pretty and half done. It will be rebuilt once he has reacted to it.

## Hard rules

1. Write only inside `C:\Web\lava-tactics-project\worker-board`. Everything else on the machine is read-only for
   this tool. Never edit, move or delete a file outside this folder.
2. Git: only these read-only commands, and only as listed under "Sources": `git worktree list --porcelain`,
   `git status --porcelain`, `git rev-list --count`, `git log -1`. Never commit, switch, merge, fetch or push in
   the game's folders.
3. The server listens on `127.0.0.1` only, port `4310`. Never `0.0.0.0`.
4. No dependencies and no build step: Node 24 is installed; use `node:http`, `node:fs`, `node:path`,
   `node:child_process`, `node:test`. The page is plain HTML, CSS and JavaScript in `public/`.
5. The files this tool reads belong to other programs and can change shape. A missing file or field shows as
   "unknown" on the page; it never crashes the server and never empties the page.
6. Never print the text of a chat to the console or write it to a file, apart from the two files named under
   "Own data". The transcripts are private.
7. Do not call any AI service. This tool only reads files.

## How it starts

```
node server.mjs          # real data, prints http://127.0.0.1:4310
node server.mjs --demo   # canned data from fixtures/, for judging the design without the real files
node --test              # the tests
```

Paths that differ per machine come from `config.json` in this folder (write it with these values):

```json
{
  "project": "C:\\Web\\lava-tactics-project",
  "gameRepo": "C:\\Web\\lava-tactics-project\\lava-tactics",
  "appSessions": "%APPDATA%\\Claude\\claude-code-sessions",
  "transcripts": "%USERPROFILE%\\.claude\\projects\\C--Web-lava-tactics-project",
  "port": 4310,
  "refreshSeconds": 30
}
```

## Sources (all read-only)

### 1. The desktop app's list of chats

Files: `<appSessions>\*\*\local_*.json` (two folder levels of ids, then one file per chat; about 50 files).
The fields to use, all others ignored:

```
title            "Game - Units"
cliSessionId     "171b174a-7987-4161-9249-b377224caef3"   the name of its transcript file
cwd              "C:\\Web\\lava-tactics-project"
isArchived       false
createdAt        1791118811832        milliseconds
lastActivityAt   1791792192613        milliseconds
completedTurns   139
postTurnSummary  {
  "status_category": "blocked",       seen so far: "blocked", "completed"; show any other word as it is
  "status_detail":   "archer walk merged; shadow beast and knight await your picks",
  "needs_action":    "Decision 1: whether to merge the Shadow Beast sheet (74 of 75). Decision 2: ..."
}
```

Which chats belong on the board: `isArchived` is false, `cwd` is the project folder or inside it, and `title`
starts with the prefix in `<project>\.claude\chats\list.json` (`{"prefix":"Game - ","main":"Main"}`). The shown
name is the title without the prefix. The chat whose name equals `main` is the main chat; the others are workers.
Today that gives: Main, Units, Features, Cleanup, Levels / Environment. A title with a suffix such as
"Game - Main (fork)" is a worker-less leftover: show it greyed at the end, not as the main chat.

### 2. A worker's own plan line

File: `<project>\.claude\chats\<cliSessionId>.json`. A worker writes it itself when it knows its plan:

```json
{
  "name": "Units",
  "role": "worker",
  "state": "working",
  "task": { "text": "Shadow Beast 4x unit", "step": 1, "steps": 6, "left": 2357972, "isReported": false },
  "at": 1791791904653
}
```

`task` is null when it has none. `left` is the working time still expected, in milliseconds, as the worker last
estimated it; `at` is when the file was last written, in milliseconds. `state` is `working`, `asking` or `waiting`.

Important: some chats do not write this file at all (their line stays "waiting" with no task while they work).
So this file gives the task's name, step and estimate when present, and never decides whether a chat is busy.
The transcript decides that.

### 3. A chat's transcript

File: `<transcripts>\<cliSessionId>.jsonl`. One JSON object per line. The files are large (up to 200 MB): read
only the last 1 MB, and drop the first line of that piece because it is cut. Lines that fail to parse are skipped.

The entries that matter have `type` `"user"` or `"assistant"`, a `timestamp` (ISO, UTC) and a `message`:

```
type "assistant"   message.stop_reason "tool_use" | "end_turn"
                   message.content: array of blocks
                     { "type": "text", "text": "..." }
                     { "type": "tool_use", "name": "Bash", "input": { "description": "Run the tests", ... } }
type "user"        message.content: a string (something typed, or a message from another chat),
                   or an array holding { "type": "tool_result", ... } blocks (a tool's answer, not a person)
```

Every other `type` (`system`, `last-prompt`, `custom-title`, `mode`, and so on) is ignored.

From the tail, work out:

- **Is a turn running?** Take the last entry of type user or assistant. If it is an assistant entry with
  `stop_reason` `"end_turn"`, the turn has ended. Anything else means a turn is running.
- **Quiet for how long?** Now minus the file's modification time. A running turn that has been quiet for more
  than 10 minutes is shown as "working, quiet for 14 min" in a warning colour: it may be a long build, or the
  app was closed mid-turn.
- **What is it doing right now?** The last `tool_use` block: its `input.description` when it has one, else its
  `name`.
- **When did the current task start?** The newest user entry whose text contains `<cross-session-message`. That
  is a task handed over by another chat; its time is the task's start, and the first line of text inside the tag
  is the task's title when the plan line (source 2) has none. If none is found in the tail, the start is unknown.

The state shown for a chat:

| Transcript | App's `status_category` | Shown as |
|---|---|---|
| turn running | any | working |
| turn ended | `blocked`, or `needs_action` has text | waiting for you |
| turn ended | anything else | free |
| file missing | | unknown |

### 4. The backlog

File: `<project>\.claude\backlog.md`. The format:

```
## Architecture #focus                      an activity; "#focus" marks the person's main focus
- [x] Step 3: collision damage              a finished step
- [ ] Step 4: a battle in one page          an open step
  (a line indented under a step belongs to that step)
- [ ] Say whether the run does what you intended @you      "@you" at the end: only the person can do it
```

Steps often carry notes in brackets, such as `(branch feature/shadow-beast)` or `(Game - Units)`. Keep them in
the text; additionally pick out a branch name and a worker name when present.

From it:

- **Queue**: the open steps under the activity `## Next to hand out (Game - Main)`.
- **For you**: every open step that ends in `@you`, with its activity's name.
- **Open work**: the open steps of the `#focus` activities, without the `@you` ones.

### 5. The working folders

`git -C <gameRepo> worktree list --porcelain` gives blocks of `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<name>`.
For each folder:

- uncommitted files: the number of lines of `git -C <folder> status --porcelain`;
- commits ahead of main: `git -C <gameRepo> rev-list --count main..<branch>`;
- last commit time: `git -C <folder> log -1 --format=%ct` (seconds).

Give each command 5 seconds, and keep the answers for 60 seconds so the page's refresh does not start git again
each time.

## Own data (inside this folder)

- `data/history.jsonl`: once a minute the server compares each chat with its last recorded line and appends one
  line when its state, task text or step changed: `{ "at": ms, "chat": "Units", "state": "working",
  "task": "Shadow Beast 4x unit", "step": 1, "steps": 6, "leftMs": 2357972 }`. From this come: when the current
  task was first seen, the first estimate it had, the time spent working against waiting, and the timeline.
- `data/outbox.jsonl`: what the person typed in the chat box (see "The chat box").

Add `data/` to a `.gitignore` in this folder.

## The page

One page, no routing, dark, dense, readable from a metre away. It asks `GET /api/state` every `refreshSeconds`
and redraws. The top bar says when the data was read and counts the states: "3 working, 1 waiting for you, 1 free".

Layout, top to bottom, with the chat docked on the right over the full height:

1. **Workers.** One card per chat, the main chat first. On a card:
   - the name and a state pill (working, waiting for you, free, unknown);
   - the task's text, and "step 4 of 5" with a thin bar;
   - the time line: "started 08:34, 1 h 50 so far, first estimate 2 h, now says about 40 min left (said 3 min
     ago)". When the time so far is past the first estimate, show the overrun in a warning colour. When the
     estimate is older than 15 minutes, show "estimate 22 min old" in a muted warning;
   - "now: Run the tests" (what it is doing) while working;
   - "needs you: ..." (the app's `needs_action`) while waiting for the person;
   - "quiet for 14 min" when that applies.
2. **For you** (left), **Queue** (middle), **Working folders** (right). For you lists the `@you` steps and each
   waiting chat's `needs_action`. Queue lists the steps to hand out. Working folders lists folder, branch, commits
   ahead of main, uncommitted files, time of the last commit.
3. **Today.** One lane per chat from 06:00 to now, coloured by state from the history file: working, waiting for
   you, free. A task's change of name draws a tick with the task's text on hover.
4. **Advice.** Shows the text of `<project>\.claude\advice.md` when that file exists, as plain text with
   headings and lists; otherwise "No advice yet." (A separate advisor will write that file later.)

### The chat box (right dock)

- Shows the last 30 messages of the main chat, read from its transcript: for a user entry the typed text, for an
  assistant entry its `text` blocks joined. Tool calls and tool results are left out. Text that starts with
  `<cross-session-message` is shown as a one-line note, "report from Units", with the full text on a click.
- An input and a Send button. `POST /api/say` with `{ "text": "..." }` appends
  `{ "id": "<random>", "at": ms, "text": "...", "state": "waiting" }` to `data/outbox.jsonl`, and the message
  appears in the dock greyed, marked "not delivered yet".
- Nothing delivers the message in this version. A bridge in the main chat will pick the outbox up in the next
  step; that is why the file's shape matters. Say so in one muted line under the input.
- Protect the endpoint, because whatever arrives there will later be typed into a chat that can change files:
  the server makes a random token at start and puts it into the page it serves; `POST /api/say` is refused
  unless the header `X-Board-Token` carries it, the `Origin` header is `http://127.0.0.1:4310`, and the content
  type is `application/json`. No CORS headers at all.

## The API

`GET /api/state` answers one object:

```
{
  readAt: ms,
  chats: [ { name, isMain, state, quietMs, doingNow, needsYou, statusDetail,
             task: { text, step, steps, leftMs, estimateAt, startedAt, firstEstimateMs } | null,
             lastActivityAt } ],
  forYou: [ { text, activity } ],
  queue:  [ { text, worker, branch } ],
  openWork: [ { text, activity, worker, branch } ],
  folders: [ { path, name, branch, ahead, uncommitted, lastCommitAt } ],
  today:  [ { chat, spans: [ { from, to, state, task } ] } ],
  mainChat: [ { at, from: "you" | "main" | "report", text } ],
  outbox: [ { id, at, text, state } ],
  advice: string | null
}
```

`POST /api/say` as described above. Nothing else.

## Code layout

Keep each reader a pure function over text, so it can be tested without the real files:

```
server.mjs              starts the server, serves public/ and the two endpoints
src/config.mjs          reads config.json, expands %APPDATA% and %USERPROFILE%
src/appChats.mjs        source 1
src/planLines.mjs       source 2
src/transcript.mjs      source 3: readTail(path), turnState(entries), doingNow(entries), taskStart(entries), mainChat(entries)
src/backlog.mjs         source 4
src/folders.mjs         source 5
src/history.mjs         own data: record(changes), today(lines)
src/state.mjs           puts the sources together into the /api/state object
public/index.html, public/board.css, public/board.js
fixtures/               small made-up samples of every source, used by the tests and by --demo
```

## Tests (`node --test`)

With made-up fixture text, never the real files:

- the backlog reader: activities, focus, open and finished steps, `@you`, an indented line, the queue activity;
- the transcript reader: a turn that ended, a turn running after a tool result, a cut first line, a broken line,
  a task handed over by another chat, the last tool's description;
- the state table above, one test per row;
- the plan line reader: with a task, with `task: null`, with a file that is not JSON;
- the worktree reader: three folders from `--porcelain` text;
- `POST /api/say`: refused without the token, refused with another origin, accepted with both.

## Done means

- `node server.mjs` shows the five chats with the right state, task and times from the real files;
- `node server.mjs --demo` shows the same page from the fixtures;
- `node --test` passes;
- a `README.md` of at most 30 lines: what it is, how to start it, what it reads, what it writes;
- a short list at the end of your answer of what you guessed, and of every field you found to differ from this
  brief on the real files.
