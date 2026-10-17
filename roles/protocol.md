# The protocol: the words the board and the chats share

The board reads what the chats write and types into their chats, and the chats read what it types. These are the
words both sides keep to. A chat that writes them otherwise is read wrongly by the board, so the job texts in this
folder point here. `<main>` is the main chat's title from the list of chats, `<name>` a chat's title, `HH:MM` a
time. Every name, path and word of a project comes from its settings or its own files, never from here.

## What a chat writes, and the board reads

| The words | Who writes them, where | What the board makes of them | Read in |
|---|---|---|---|
| `Task from <main>: B<id> ...` (first line; "Next task", "Two tasks" too) | the main chat, a message to a worker | the worker's task starts; the step ids and "about <time>" of the first line are its step and estimate | `src/transcript.mjs` (`HANDS_OVER`, `handOvers`) |
| `Report from <name>: B<id> ...` (first line) | a worker, a message to the main chat, by any address or tool | the task is finished once the turn ends after it; the first B-id is the finished step | `src/transcript.mjs` (`isReportTo`), `src/finished.mjs` (`reportsOf`) |
| `Note from <name>: ...`, `Question from <name>: ...` | a worker, to the main chat | a message mid-task; a note or question sent and followed by the turn's end also ends the task | `src/transcript.mjs` |
| `Note from <name>: paused for the limit until HH:MM` (exactly this first line) | a worker that stops for the plan's limit | the worker shows as "Suspended" until that time | `src/limits.mjs` (`PAUSED`, `pauseNote`) |
| A closing block whose last line is `+ Done:   yes` (or `- Done:   no, ...`, `- Done:   partly, ...`) at the very end of an answer | every chat, at the end of an answer to the person | "yes": the chat is done and free, whatever its card says | `src/transcript.mjs` (`saysDone`), `src/state.mjs` |
| `**Task:** ...` and `**What I did:** ...` as the answer's first two lines | a worker that finished with something for the person | the task and the result in the worker's window | `src/handover.mjs` |
| A quote block titled `> **For you**`, items numbered, each starting `**Answer:**` or `**Do:**` | every chat, above its closing block | the person's items in the worker's window and under For you; the Advisor's last answer with one stands there too, answered straight in its chat (B275) | `src/handover.mjs`, `src/state.mjs` (`advisorWaiting`) |
| `[See the picture: ...](http://127.0.0.1:<port>/#picture=<picture folder>/<file>)` | in a For you item | a button that opens the picture on the board | `src/handover.mjs`, `public/board.js` |
| `[Play it: ...](http://127.0.0.1:<port>/#play=<branch>&<settings>)` | in a For you item | a button that starts that branch's game (only a project with a game) | `src/handover.mjs`, `public/board.js` |
| The AskUserQuestion or ExitPlanMode tool | any chat | the chat waits for the person | `src/transcript.mjs` (`ASKING_TOOLS`) |

## The files the chats keep

| File (in the project) | Who writes it | What it holds | Read in |
|---|---|---|---|
| `.claude/chats/list.json` | the person or the main chat | `prefix` (how the project's chat titles start), `main` (the main chat's name), `boards` (boards a chat starts) | `src/appChats.mjs` (`parseList`) |
| `.claude/chats/<session>.json` | each chat, its card (by the Workers mod's tool) | `task: { text, step, steps, names, left, stepLeft, since, isReported }`; `left: true` when it left the list | `src/planLines.mjs` |
| `.claude/chats/own/<name>.json` (B210) | a chat without the Workers mod, its card itself; `<name>` in small letters, other characters "-" | the same fields, with `minutes` and `stepMinutes` for the times; the file's time when it has no `at`. Read only when the mod's card is not there | `src/planLines.mjs` (`ownCard`), `src/sources.mjs` |
| `.claude/asks/<id>.json` | a chat that needs the person in a fixed form | `id, from, kind (input, verify, intervene), title, text, at, state, options, pictures, run, checks, tried` | `src/asks.mjs` |
| the work store (setting `work`, `.claude/work` unless set) | the board alone, on the chats' `work` calls and the person's clicks | one file per item, `flow.json`, `activities.json`, `last-ids.json`, `truth.json`: see "The work store" below | `src/work/` |
| the backlog (setting `backlog`) | the board, as the store's view; nobody edits it | see below | `src/backlog.mjs`, `src/work/view.mjs` |
| `.claude/restart.md` | the main chat on "prepare restart" | who was on what; the board only looks whether it is there | `src/sources.mjs` |
| `.claude/board.json` | the board | where the board is and its key, for the Workers mod | `server.mjs` |
| `.claude/launch.json` | the board (`--launch-entry`) | the board's start entry for the app's preview | `server.mjs`, `src/ports.mjs` |

## The work store

The work stands in one record per item, written only by the board. A chat works it with the Workers mod's `work`
tool; the board checks every call against the flow file and refuses, in one line, what the flow does not allow. The
tool answers with the record: work from it, not from a message.

- **An item** is `<work>/<id>.md`: a head of `Key: value` lines up to the first blank line (`Id`, `Kind`, `Title`,
  `State`, `Owner`, `Activity`, `Goal`, `Blocked by`, `Waits for`, `Since`, `Estimate`, `Branch`, ...), then `## `
  sections (`Summary`, `What we build`, `Context`, `History`, ...). Steps are `B<n>`, asks for the person `Q<n>`,
  instructions `I<n>`, notes `N<n>`; the board gives the ids, and an id never comes back.
- **The flow file** (`<work>/flow.json`, the default `examples/work/flow.json`) holds the states of a step and who moves
  it from one to the next, and when. It, not a job text, says who moves an item and when; the person may change it.
- **History**: every change writes one line, `- <date time> <who>: <what>`.

| The call | Who, by the default flow | What it does |
|---|---|---|
| `work next` | any chat | your open instructions, then your steps by state, each in one line; the first in full |
| `work take B<id>` (`branch`) | a worker | a step queued for you: taken, then in progress, on that branch; names your card after it |
| `work step B<id>` (`step`, `names`, `minutes`, `stepMinutes`) | a worker | the step of your plan you are on: one History line, and your card |
| `work ask` (`of`, `kind` decide, look, provide or do, `blocking`, `text`, `options`, `pictures`, `play`) | any chat | something only the person can do, `Q<n>` under the step; blocking moves the step to waiting on you. It answers the "For you" block for your answer |
| `work note` (`to` you or main, `text`, `of`) | any chat | information, never a question: `N<n>` |
| `work report B<id>` (`result`, `merged`) | a worker | in progress to review; the board checks the base branch against its remote and that the branch is gone, writes it in History, and tells the main chat |
| `work block` / `unblock B<id>` (`on`) | the main chat, a worker | what the step waits on (`Blocked by`) |
| `work new` (`title`, `activity`, `goal`, `text`) | the main chat, a worker, the Advisor | a new step `B<n>`, state new |
| `work queue B<id>` (`for`, `after`, `about`) | the main chat | a refined step into a worker's queue |
| `work close I<id>` (`as`) | any chat | an instruction is done, and what came of it |
| `work drop B<id>` (`why`) | the main chat | the step is dropped |
| `work refine B<id>` (`summary`, `picture`, `goal`, `size`, `questions`), `work refined B<id>` (`what`) | the Advisor | the refine block, and its ready form; refined moves a new step to refined |
| `work list` | any chat | every item in one line |

## The backlog

After the cutover (`node tools/migrate-backlog.mjs --cutover`) the board writes this file from the work store after
every change, its first line `<!-- generated by the worker board from <work folder>; edit nothing here -->`, and
nobody edits it. It keeps the form below, so whatever reads it reads what the store says; a line `[store] <Key>:
<value> · ...` under a step holds what the step's line cannot say. Before the cutover the chats edit it as below.


| The words | Meaning | Read in |
|---|---|---|
| `## <activity>`, `#focus` after it | an activity; the person's main focus | `src/backlog.mjs` |
| `- [ ] B<n> <title>` / `- [x]` | an open or ticked step; its id never changes or comes back | `src/backlog.mjs` |
| `@you` at the end | a step only the person can do; it shows under For you | `src/backlog.mjs` (`forYou`) |
| `Verify:`, `Decide:`, `Provide:`, `Do:` after the id | what a step of the person's asks | `src/backlog.mjs` |
| `(for <worker>; after <condition>; about <time>)` at the end | the step waits in that worker's queue | `src/backlog.mjs` (`queue`) |
| `later`, `not handed out`, `not queued` in brackets | held back: in no queue | `src/backlog.mjs` (`isHeldBack`) |
| `(branch <name>)` at the very end | the step is in progress on that branch | `src/backlog.mjs` |
| Indented lines under a step; `Requirements:`, `Context:` ... as sections | the step's details | `src/backlog.mjs` (`noteSections`) |
| `Refined (round <n>, by <name>, <date time>; accepted <date time>):` under a step, then `Problem:`, `Goal:`, `Questions:` (a point per question, ` Answer: ...` behind it once answered), `Feedback:` (`- Round <n>: ...`) | B233: a step's refine block; the Advisor writes it, the board adds the person's answers, feedback and "accepted"; any other named line or a line in brackets ends it, but `Summary:`, `Picture:`, `Part of:`, `Size:` and `What we build:` stay in it (B285) | `src/backlog.mjs` (`refinedOf`), `src/tick.mjs` (`answerRefine`, `acceptRefine`) |
| `Refined (<date time>; ready):`, then `Summary:`, `Picture:`, `Part of:`, `Size:`, `What we build:` (while refining `Questions:` instead of `What we build:`) | B285: the approved form of a refine block (roles/advisor.md); only a head with `; ready` makes the step refined, so it may go into a queue; until then the board refines it first, and once more to fold answers in | `src/backlog.mjs` (`isRefined`, `refineStateOf`), `src/refineGate.mjs` |
| The group named by the setting `advisorSuggestions` | the Advisor's open suggestions on its tab | `src/state.mjs` |

## What the board types into a chat

Typed by the Workers mod as the person's own words; each line below is the board's, marked so.

| The words | When | Written in |
|---|---|---|
| `<words>` then `(typed on the worker board, HH:MM)` | the person typed to a chat on the board | `src/bridge.mjs` (`messageText`) |
| `Picture: <full path>` under the words | a picture pasted into the talk with the main chat | `src/talkPicture.mjs` |
| `(answered on the worker board, HH:MM) B<id> "<title>": approved.` / `: done.` / `: rejected. Reason: ...` / `: <answer>` | the person answered a step or a request | `src/bridge.mjs` |
| `prepare restart`, `resume` (with the chats cut off or not running) | the person's buttons for a restart of the app | `src/say.mjs` |
| `start "<name>"` and its session id | a message waits for a chat that is not running | `src/say.mjs` (`wakeFor`) |
| `spawn workers` / `Count:` / `Why:` | the main chat is asked for workers | `src/say.mjs` (`spawnWords`) |
| `remove worker` / `Name:` / `State:` / `Why:` | the person removes a worker | `src/say.mjs` (`removeWords`) |
| `backlog step from the Design tab`, `queue step from the Design tab` | an idea of the Design tab goes on the backlog | `src/design.mjs` (`stepWord`) |
| `queue step from the backlog` / `Step: B<id> <title>` | the person puts a step in a queue; for a step not refined yet the board holds it until the step is (B285) | `src/say.mjs`, `src/refineGate.mjs` |
| `step refined` / `Step: B<id> <title>` / `For: <worker>` (to the main chat) | B285: a step the main chat queued before it was refined is refined now: hand it out | `src/say.mjs` (`refinedWords`), `src/refineGate.mjs` |
| `stop task` / `Name:` / `Task:` / `Why:` | the person stops a worker's task (it reaches a safe point) | `src/say.mjs` (`stopWords`) |
| `move step` / `Step: B<id> <title>` / `From:` / `To:` | the person moves a queued step to another worker | `src/say.mjs` (`moveWords`) |
| `unqueue step` / `Step: B<id> <title>` / `From:` | the person takes a step out of a worker's queue | `src/say.mjs` (`unqueueWords`) |
| `advisor recommendation: yes` (to the main chat) or `: no` with `Reason:` (to the Advisor) / `Recommended:` / `Step:` / `Why:` | the person answers the Advisor's recommendation on the way to the next milestone | `src/say.mjs` (`recommendWords`) |
| `refine step` / `Step: B<id> <title>` / `Round: <n>` (to the Advisor) | the person asks the Advisor to refine a step (round 1), or again after their answers and feedback, which stand in the step's refine block already; the board sends it by itself too, one at a time: for a new step once, for a step about to be queued, and once more to fold answers in (B285) | `src/say.mjs` (`refineWords`), `src/refineGate.mjs` |
| `Round from the board's clock: morning` (or `weekly`), with the job and the project's settings under it | the Advisor's rounds; never the person's word | `src/rounds.mjs` |

The board leaves its own lines out of the talk it shows (`src/state.mjs`, `BOARD_WORDS`, `isClockLine`).
