# Worker board: design

Approved by the person on 2026-10-12 ("agreed for the worker board design and plan"). Game - Support (named Game - Cleanup until that day) builds it.

## The second design (2026-10-12)

After a first look at the board the person changed its shape: from a dashboard that shows everything to a tool for
three things, awareness, intervention and coordination. The picture is `design/2026-10-12-codex-design-2.webp`,
their notes are `design/2026-10-12-notes-2.md`. Where this section and the older ones below differ, this one wins.
It is built in the branch `redesign/two-tabs` and is merged into main when all of it works, sending included.

**Two tabs.** Overview: one lane per worker (name and state, task with its progress, what it does now, the time it
expects to be done, its own queue), the inbox "For you", and today's timeline, which also shows what is expected
and queued after now. Advice & Chat: the advisor's advice and a conversation with the advisor. The shared queue,
the folders table and the main chat's dock are gone; a folder's details are under its worker's lane.

**Any number of workers.** The board names no worker anywhere. Every open chat of the project whose title starts
with the prefix is a lane, the chat named `advisor` in `config.json` is the one talked with, and the main chat is
a lane like the others. Queues, requests, answers and folders are all keyed by the chat's name. Adding a worker
is opening a chat titled "Game - <name>".

**The fixed form for what a chat needs from the person** (an "ask"): one JSON file per ask in
`<project>\.claude\asks\`, written and closed by the chat that asks, read by the board. The fields are in
`src/asks.mjs`. Three kinds:

| Kind | The card shows | The answer |
|---|---|---|
| `input` | the question, options with pictures, pictures | words, required |
| `verify` | what was done, pictures, a button that opens the branch's game, what to check | Approve, with words if wanted, or Reject with the reason |
| `intervene` | what blocks, what was tried | words, required |

A chat that waits without having filed an ask shows as an `input` card with the app's own summary of what it
needs. A turn that runs without a sign of life is raised as an `intervene` card.

The steps in the backlog that end in `@you` are cards too, under the others and folded until opened. The main chat
writes in front of each what it asks of the person, and the board follows that: `Verify:` gets Approve and Reject,
`Decide:` and `Provide:` need words, `Do:` gets a Done button. A step shows the pictures of the folder it points
to. Its answer goes to the worker the step names, else to the main chat, which keeps the backlog.

**Closed is hidden.** What the person answered on the board, and the steps for them that are ticked in the
backlog, are closed and not shown, unless they tick "Show closed" above the inbox. An answer that did not arrive in
time opens its request again.

**Details on a click.** The head of a card, and a step in a lane's queue, open a window with everything known
about it (`design/2026-10-12-codex-design-3-details.webp`): what it is and whose, a description, the pictures it
points to, where it stands in the queue, its branch and folder, and for a request the answer form of its kind. A
step of the backlog is one line, so what describes it further are the indented lines under it: a line
"Requirements:" (or any other name with a colon) starts a part of that name, a line "- ..." is a point of it,
"Context:" goes to the side, and a folder of pictures named in any of these lines is shown.

**The timeline looks ahead.** It runs from two hours before now to at least six hours after it, and further when
more is planned (`hoursBack` and `hoursAhead` in `config.json`). What was is of little use to the person; what is
expected and queued is what they plan with.

**The right side is as wide as it is dragged**, on both tabs, and the lanes follow the room that is left.

**Where an answer goes.** The person talks with the advisor on the second tab, and the board answers the workers:
an answer is addressed to the chat that asked and to no other. The server checks each answer against the request
it is for (`src/say.mjs`) and keeps it in `data/outbox.jsonl`. Delivery is the bridge in the mod, as described
below, with one change the person confirmed on 2026-10-12 ("yes i want this to be picked up and queue if needed
or just removed from the backlog if accepted"): every chat of the project picks up what is addressed to it, where
the first design let only the main chat receive.

**The bridge as built** (`src/bridge.mjs`, and `hooks/board.ts` in the Workers mod, version 0.4.0). While it runs,
the board keeps `<project>\.claude\board.json` with its address and a key. Every chat in the Workers list asks
`POST /api/bridge/take` with that key, its own name and its session's id every few seconds. The board serves only
the session it shows under that name, marks what waits for that chat taken, writes that down, then hands it out;
the mod types it into its chat as the person's own words and tells the board what was typed and what was not
(`POST /api/bridge/typed`), so the card says "handed to its chat", then "typed into its chat", or that it did not
arrive. The engine runs it once the chat is idle, so a busy chat gets it after what it is doing. The key only
takes: sending still needs the board's own page. A second board that starts while another one's file is there
and that board answers leaves the file alone. What remains, as with sending: a chat that wrote a `board.json` of
its own could have its own text typed into the other chats; that takes a deliberate act, and the mod's note
forbids touching the file. What is typed:

| The person | Typed into the chat |
|---|---|
| approves | `(answered on the worker board, 16:02) B14 "<title>": approved. Tick this step in the backlog.` |
| rejects | `... rejected. Reason: <their words>` and `Pick this up: now if it belongs to what you are doing, else as a step in the queue.` |
| marks done | `... done. Tick this step in the backlog.` |
| decides or provides | `... B67 "<title>": <their words>` |
| answers a chat that waits | `(answered on the worker board, 16:02) <their words>` |
| types to the advisor | `<their words>` and `(typed on the worker board, 16:02)` |

An answered card stays in sight until its answer was typed into its chat and two minutes more, and says where the
answer is; it is no longer counted as waiting for the person. What is sent to a chat that is not running makes
the board ask the main chat to start it (`start <name>`, with the id the app knows the chat by, at most every two
minutes per chat; `wakeFor` in `src/say.mjs`); the card and the advisor's tab say that it was asked, or offer the
button when it was not.

A request a chat filed itself says "Close this request." where a step says "Tick this step in the backlog.". An
answer waits for its chat for `answerKeepHours` (48): the chat may be busy or not open. A line typed to the
advisor is dropped after `messageKeepMinutes` (10), so nothing typed long ago turns up in a chat. A delivered
answer keeps its request closed. A step that changed since it was answered (its words, or the lines under it)
asks again and shows the earlier answer: that is how a rejected step comes back after the rework.

**From advice to work** (the person, 2026-10-12): what the person agrees with the advisor, the advisor passes on
to the main chat, which hands out as before. The advisor still hands out nothing itself.

**A restart of the app** (the person, 2026-10-12: "I want to be able to restart claude, the worker board to
restart and reload. and then let the workers continue with what they were doing before the restart"; their
choices: the mod starts the board, the workers carry on on their click, no compaction on the way).

- *The board comes back by itself.* The boards run as children of the app and end with it. The project's list
  of chats names the launch entries to keep running (`.claude\chats\list.json`, "boards"); every chat in the list
  looks every 15 seconds whether each answers and starts the one that does not, as a child of its own process
  (the Workers mod, `keepBoards`). So the first game chat that opens after a restart brings the boards back, and
  a chat that closes hands its board on to the next one within seconds. Nothing is set up in Windows.
- *The page keeps asking.* While the board is away the page asks every 5 seconds and says since when; a board
  that is back has a new token, and the page loads itself anew. The board says for an hour that it was off, and
  from when to when.
- *Interrupted.* A chat whose transcript shows an open turn while its own file says otherwise was cut off
  (`isCutOff` in `src/state.mjs`): the file says waiting since after the turn began and the transcript has not
  moved on, or it says working and is no longer renewed. A chat whose process keeps no such file is never called
  interrupted. It is a state of its own, with the task the chat was on.
- *Switched off for now.* On 2026-10-12 at 19:42 the person had every board stopped ("stop all worker boards. i
  will start 1 manually from main myself"), and the list under "boards" is empty since. As long as it is, no chat
  starts a board: the person starts the one on main themselves, from the Run pane. Putting "worker-board" back
  into that list switches the automatic start on again; that is theirs to say.
- *Not running.* The two restarts of 2026-10-12 showed that after a restart no worker's chat runs until something
  starts it, and that a message addressed by a chat's name does not reach a chat that is not running. A running
  chat's mod asks the board every few seconds what waits for it, so the board knows who runs: a chat it has not
  heard from for half a minute is "not running" (`runningOf` in `src/state.mjs`). The lane says so, the advisor's
  tab says so, and `resume` names these chats for the main chat, which starts them through the app by their
  session's id. Nothing is said in the board's first half minute, or about a chat that asks from another session
  than the one the board shows.
- *One board delivers.* Of two boards on one project the one that records is the one that delivers; a board
  started with `--history-from` only shows, refuses an answer and says where to give it. A board that starts
  takes the delivery over when the file names a board that no longer takes its key.
- *Two words, and the main chat does the work.* "Prepare restart" and "Resume all" type `prepare restart` and
  `resume` into the main chat, in the board's own wording; `resume` names the chats the board read as cut off.
  The main chat asks every working chat to stop at a safe point and writes who was on what into
  `<project>\.claude\restart.md`, and after the restart it brings them back from that file, then removes it. The
  board says how the preparing stands: who still works, and "Ready" when every chat is at rest and the file is
  written. A message from the main chat reaches a chat in the middle of its turn; what the board types waits
  until a chat is idle, which is why the main chat does the messaging.

**Pictures.** Pictures come only from the folders named in `config.json` (`pictureRoots`, the project's
`art-inbox`), and the path is checked on the real file.

**The game of a branch** (the person, 2026-10-12: "i want the link to open a game with the branch that contains
the code ... spin up a new game with new port ... find a way so it doesnt run indefinately if i close the tab").
Work to verify has one button, "Open the game on <branch>": the branch an ask names in `run.branch` or a step
names in its words, else `main`. The board starts the game from the working folder that holds that branch
(`run-game.mjs`, one process per folder, the folder's own vite and configuration) on a port of its own, from
`gamePort` (5300) plus the folder's place in git's list, and opens it in a new tab. The game ends by itself
`gameIdleSeconds` (30) after its last tab was closed, or when nobody opened it within `gameOpenSeconds` (120); the
board also ends its games when it is closed, and the card has a Stop button. The page names the request only: the
branch and the folder come from the board's own state, and starting needs what sending needs (the token, the
board's own origin, JSON). The board switches no folder to another branch: a branch that is in no working folder
cannot be started, and the card says so. Vite's cache for these games is kept in the board's `data/game-cache`,
so nothing is written into a folder's `node_modules` while a worker runs the game from it too. The Overview has
a "Run game" button that is always there (the person, 2026-10-12: "lets add the run game button in the worker
board"): it opens the game as it is on main the same way, and says which commit main is on and since when.

**Still to build in the branch:** a tool in the mod for a chat to file and close an ask; the plan line names the
chat's branch and when its task was named; and the line in the working agreement that tells every chat to file an
ask where it would write an `@you` step. Delivery is built and tested in parts, and not yet tried with a real chat:
that needs `/reload-plugins` in the chat that is to receive.

## What it is for

The person runs one main chat and four worker chats on Lava Tactics and loses track of who does what. Their words:
"improve managing the workers. by improving the visualization to show which workers we have, which tasks they pick
up, how longs tasks are taking, expectedly ... which tasks are queued", and "i can type to it which is the same as
this chat".

Decided on 2026-10-12:

- What is typed on the board goes into the existing "Game - Main" chat (the bridge below). The tool runs no Claude
  of its own.
- The advisor is a chat of its own, "Game - Advisor". It writes `.claude/advice.md`; the board only shows that file.
- The look follows the newest picture in `design/`. The first one is `design/2026-10-12-codex-design-1.webp`.

## The parts

| Part | What it does | Depends on |
|---|---|---|
| Readers | Turn each source into plain data: the app's chats, the workers' plan lines, the transcripts' tails, the backlog, the working folders. The formats are in `BRIEF.md` under "Sources" | the files only |
| State | Decides per chat: working, waiting for you, free, unknown (the table in `BRIEF.md`). The transcript decides whether a chat is busy; a worker's own line never does | readers |
| History | Once a minute, records what changed per chat in `data/history.jsonl`. Gives the start of a task, its first estimate, time worked against time waiting, and the timeline | state |
| Server | `127.0.0.1:4310`, serves the page, `GET /api/state`, and the chat box's endpoints. Node, no dependencies | all above |
| Page | Workers, For you, Queue, Working folders, Today, Advice, and the chat dock. Asks for the state every 30 seconds | server |
| Bridge | Delivers what is typed on the board into the main chat. Lives in the existing `folder-branches` mod | server, the mod |

The board works without the workers' help. A worker's plan line adds the step and the estimate when it is there.

## Time and estimates

- A task starts when it is handed over (the message from the main chat in the worker's transcript), or when its
  plan line first names it.
- The first estimate a worker gives is kept. The card shows time so far, the first estimate, and what the worker
  says now. Past the first estimate, the overrun shows in a warning colour.
- An estimate older than 15 minutes of work is marked as old. In step 4 the mod reminds a working chat to renew it.
- A lane's main figure is the time left ("24 min left"); the clock time it ends at is the small one (B95). A time
  that has run out says by how much ("12 min over").
- A working worker always has a time: its own, else the "about <time>" of its backlog step, else the one in its
  hand-over; the last two count from the task's start and say where they are from. A worker that works with none
  of the three is a fault, shown in the warning colour ("No time"). The main chat has no task to time.
- One turn can hold several tasks. A task a chat names starts no earlier than its last message to the main chat,
  and when the board still showed another task the chat had named, it starts when it was named (B94).
- A hand-over that arrives while a chat works is not a user entry in the transcript: the app keeps it with the
  turn as a queued command. The board reads it as a hand-over just the same.

## The queue

A step a worker is on is in progress, not queued, also when the step names no branch (a check, a comparison, a
merge): the step that names its branch, else the open step of its own that its task record names by id, else the
one its hand-over names (B94).


The queue stays in the backlog, under "Next to hand out (Game - Main)", so there is one list. The main chat writes
each queued step so the board can read it: `- [ ] <task> (for Units; after <condition>; about 40 min)`. The board
picks out the worker and the time; a step without them is shown as it is.

## The bridge

1. The person types on the board. The page sends it to the server, which keeps it as "waiting".
2. The mod, running in the main chat, asks for waiting messages every few seconds and marks each one delivered
   before it does anything else, so a message is never typed twice.
3. The mod submits the text to its own chat as the person's own words (`$.prompt.submit` with `asUser`). The engine
   runs it as a turn once the chat is idle.
4. The dock shows the chat's transcript, so the answer appears there like any other.

Step 1 of the build tested both on 2026-10-12: the mod can submit a line as the person's own words (the chat's
record marks it as coming from the mod), and it can reach the board's server on `127.0.0.1` over HTTP. So the mod
asks the server for waiting messages; no shared file is needed.

Safety, because what arrives is typed into a chat that can change files:

- The server listens on this machine only. Sending needs a token the server puts into its own page, the page's own
  origin, and a JSON body. Other websites in a browser cannot send.
- Every delivered message is visible in the dock and in the chat itself, with the time it was typed.
- The mod's note tells every chat never to send through the board. A worker's message to the main chat stays a
  teammate's report and never counts as the person's word.
- What remains: any program running as the person on this PC could type through it. Such a program can already
  change the files the chats read.

## What it does not do

- It does not start, stop or restart chats, and it does not hand out tasks by itself.
- It does not call an AI service. Only typing through the bridge and the advisor use the plan's usage.
- It does not change the backlog, the game's folders or git.

## Build order

Each step ends with something the person can look at.

1. **Bridge test** (throwaway, about half an hour): a line placed in a file is typed into the main chat by the
   mod. Answers whether the bridge is possible at all, before anything is built around it.
2. **The board with real data**: readers, state, history, server, page after the newest design, without sending.
   A launch entry "worker-board" so the Run pane starts it.
3. **The bridge for real**: typing on the board reaches the main chat; delivered and waiting are shown.
4. **Later, after use**: answering a worker from the board (the buttons in the first design; the same bridge,
   picked up in that worker's chat), the reminder to renew an estimate, and what the person misses by then.

If step 1 fails, the board is still built; its chat dock then only shows the main chat, with a button that copies
what was typed so it can be pasted into the app.

## Tests

- Every reader is a pure function over text and is tested with made-up samples: the backlog, the transcript's
  tail, the plan line, the worktree list, the state table one test per row.
- The sending endpoint: refused without the token, refused from another origin, accepted with both.
- The mod's part with `claude plugin test`: a waiting message is submitted once; a delivered one never again.

## The person's feedback on the first board (2026-10-12, during step 2)

Their words, kept as given. Not built yet: they asked to first work out what they are trying to accomplish and how
to structure it, "instead of taking my feedback literally".

> I want clearer: 'for you'.
>
> I want to clearly have visual what each items wants from me. If they want input/design of verifying.
>
> For verifying i need either clear pictures or a link to the branch to start it. with enough details. I also need
> a button yes or no with input why. Input questions always require text input.
>
> I still feel there is too much information on the board. I want 1 tab to just get an overview of what is
> currently happening for the works, in the queue. how many for you items. the today planning timeline. The
> working folders maybe too much details?
>
> But i need a 2nd tab for the advice. i need to be able to chat with it.

## Settled with the person on 2026-10-12

1. Answering a worker from the board stays in step 4.
2. "Game - Support" (was "Game - Cleanup") builds it, because it built the Workers list in the same mod.
3. The folder `worker-board` becomes a small git repository of its own, kept on this PC only.
