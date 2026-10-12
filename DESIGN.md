# Worker board: design

Approved by the person on 2026-10-12 ("agreed for the worker board design and plan"). Game - Support (named Game - Cleanup until that day) builds it.

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

## The queue

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
