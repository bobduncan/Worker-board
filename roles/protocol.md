# The protocol: the words the board and the chats share

The board reads what the chats write and types into their chats, and the chats read what it types. These are the
words both sides keep to. A chat that writes them otherwise is read wrongly by the board, so the job texts in this
folder point here. `<main>` is the main chat's title from the list of chats, `<name>` a chat's title, `HH:MM` a
time. Every name, path and word of a project comes from its settings or its own files, never from here.

## What a chat writes, and the board reads

B301: the board reads no task, no end of a task and no question from a chat's words. A step comes from the work store
and ends with `work report`; what the person must answer is an ask of the store (`work ask`). The few words below are
read only for what the store does not hold.

| The words | Who writes them, where | What the board makes of them | Read in |
|---|---|---|---|
| `Note from <name>: paused for the limit until HH:MM` (exactly this first line) | a worker that stops for the plan's limit | the worker shows as "Suspended" until that time (the store holds no pause) | `src/limits.mjs` (`PAUSED`, `pauseNote`) |
| A closing block whose last line is `+ Done:   yes` (or `- Done:   no, ...`, `- Done:   partly, ...`) at the very end of an answer | every chat, at the end of an answer to the person | "yes": the chat is done and free, whatever its card says (a card is the chat's own, not the store's); a step the store still holds for it then is flagged on its lane, "<chat> ended its turn with Done: yes but B<id> is still <state>: run work report" | `src/transcript.mjs` (`saysDone`), `src/state.mjs` |
| `**Task:** ...` and `**What I did:** ...` as the answer's first two lines | a worker that finished with something for the person | shown in its answer's window, as its words | `src/handover.mjs` |
| A quote block titled `> **For you**`, items numbered, each starting `**Answer:**` or `**Do:**` | every chat, above its closing block; `work ask` answers it for the chat's answer | no question: when a chat's last answer ends with one and it filed no ask in that turn (and holds none open), Needs your attention shows the warning "<chat> wrote questions in its chat but filed no ask", with a button to its chat | `src/handover.mjs` (`asksAtEnd`), `src/state.mjs` (`unfiledAsk`) |
| `[See the picture: ...](http://127.0.0.1:<port>/#picture=<picture folder>/<file>)`, `[Play it: ...](http://127.0.0.1:<port>/#play=<branch>&<settings>)` | in a For you item (`work ask` writes them from its `pictures` and `play`) | the board opens at that picture, or starts that branch's game, when the link is opened | `public/board.js` |
| `Note from <name>: ...`, `Question from <name>: ...` | a worker, a message to the main chat | the Workers mod notes that the worker waits for the main chat; it ends nothing | the Workers mod (`sentKind`) |
| The AskUserQuestion or ExitPlanMode tool | any chat | the chat waits for the person; the Workers mod files each question as an ask | `src/transcript.mjs` (`ASKING_TOOLS`), the Workers mod |

## The files the chats keep

| File (in the project) | Who writes it | What it holds | Read in |
|---|---|---|---|
| `.claude/chats/list.json` | the person or the main chat | `prefix` (how the project's chat titles start), `main` (the main chat's name), `boards` (boards a chat starts) | `src/appChats.mjs` (`parseList`) |
| `.claude/chats/<session>.json` | each chat, its card (by the Workers mod's tool) | `task: { text, step, steps, names, left, stepLeft, since, isReported }`; `left: true` when it left the list | `src/planLines.mjs` |
| `.claude/chats/own/<name>.json` (B210) | a chat without the Workers mod, its card itself; `<name>` in small letters, other characters "-" | the same fields, with `minutes` and `stepMinutes` for the times; the file's time when it has no `at`. Read only when the mod's card is not there | `src/planLines.mjs` (`ownCard`), `src/sources.mjs` |
| `.claude/asks/<id>.json` | a chat that needs the person in a fixed form | `id, from, kind (input, verify, intervene), title, text, at, state, options, pictures, run, checks, tried` | `src/asks.mjs` |
| the work store (setting `work`, `.claude/work` unless set) | the board alone, on the chats' `work` calls and the person's clicks | one file per item, `flow.json`, `activities.json`, `last-ids.json`: see "The work store" below | `src/work/` |
| the backlog (setting `backlog`) | the board, as the store's view; nobody edits it | see below | `src/backlog.mjs`, `src/work/view.mjs` |
| a brainstorm's thread, `<yyyy-mm-dd>-<title's words>.md` in the setting `brainstorms` (`.claude/brainstorms` unless set) | B259: the board its head (`# Brainstorm:`, `Goal:`, `Started: … · State: …`, `Opening:`), the person's `Answer (HH:MM): …` lines, the state and `Created (HH:MM): …`; the Advisor its context head, its questions (`## Q<n> (HH:MM)`, the question, `Why:`, `- A: … (advised)`, `Picture:`) and its proposal (`## Proposal (HH:MM)`, `Decided:`, `Goals:`, `Steps:`, `Note:`), as roles/advisor.md, "A brainstorm", shows | the Brainstorm part's list and card; a line under Needs your attention for a question and a proposal waiting | `src/brainstorm.mjs` (`parseThread`), `src/sources.mjs` (`readThreads`) |
| `.claude/restart.md` | the main chat on "prepare restart" | who was on what; the board only looks whether it is there | `src/sources.mjs` |
| `.claude/board.json` | the board | where the board is and its key, for the Workers mod | `server.mjs` |
| `.claude/launch.json` | the board (`--launch-entry`) | the board's start entry for the app's preview | `server.mjs`, `src/ports.mjs` |

## The work store

The work stands in one record per item, written only by the board. A chat works it with the Workers mod's `work`
tool; the board checks every call against the flow file and refuses, in one line, what the flow does not allow. The
tool answers with the record: work from it, not from a message.

- **An item** is `<work>/<id>.md`: a head of `Key: value` lines up to the first blank line (`Id`, `Kind`, `Title`,
  `State`, `Owner`, `Activity`, `Goal`, `Blocked by`, `Waits for`, `Since`, `Estimate`, `Branch`, `Queue when refined`,
  ...), then `## ` sections (`Summary`, `What we build`, `Context`, `History`, ...). Steps are `B<n>`, asks for the
  person `Q<n>`, instructions `I<n>`, notes `N<n>`; the board gives the ids, and an id never comes back.
- **The flow file** (`<work>/flow.json`, the default `examples/work/flow.json`) holds the states of a step and who moves
  it from one to the next, and when. It, not a job text, says who moves an item and when; the person may change it.
- **History**: every change writes one line, `- <date time> <who>: <what>`.

| The call | Who, by the default flow | What it does |
|---|---|---|
| `work next` | any chat | your open instructions, then your steps by state, each in one line; the first in full |
| `work take B<id>` (`branch`) | a worker | a step queued for you: taken, then in progress, on that branch; names your card after it. A step in progress that names nobody is claimed by the worker on it |
| `work step B<id>` (`step`, `names`, `minutes`, `stepMinutes`) | a worker | the step of your plan you are on: one History line, and your card |
| `work ask` (`of`, `kind` decide, look, provide or do, `blocking`, `text`, `options`, `pictures`, `play`) | any chat | something only the person can do, `Q<n>` under the step; blocking moves the step to waiting on you. It answers the "For you" block for your answer |
| `work withdraw Q<id>` (`why`) | the chat that asked; for an ask with no asking chat (carried over from the old backlog), the main chat, with a why | the ask is withdrawn; a step that waited only on it goes on. A step waiting on you is reported only after its asks are answered or withdrawn |
| `work answered-in-chat Q<id>` (`text`) | the chat that asked; for an ask with no asking chat (carried over from the old backlog), the main chat or the Advisor, with the person's words and the date | the person answered it in your chat: the ask is answered with their words (History: "<chat>: answered in its chat by the person: <words>"); a step that waited only on it goes on. A worker never closes an ask that is not its own |
| `work note` (`to` you or main, `text`, `of`) | any chat | information, never a question: `N<n>` |
| `work report B<id>` (`result`, `merged`) | a worker | in progress to review; the board checks the repository the step's work is in (the one holding the `merged` commit, else the one that has or had the branch; none to tell is a failed check): its base branch against its remote and that the branch is gone, writes it in History, and tells the main chat. A report from review (the owner, worker or main chat, after a fix) runs the check again (B304; the flow's move review → review). The only way a step ends: the worker's card clears when its turn ends |
| `recheck B<id>` (the page's "Check again") | the person | a step in review whose check failed: the board runs its check again with what the last report said (B304) |
| `work block` / `unblock B<id>` (`on`) | the main chat, a worker | what the step waits on (`Blocked by`) |
| `work new` (`title`, `activity`, `goal`, `text`) | the main chat, a worker, the Advisor | a new step `B<n>`, state new |
| `work queue B<id>` (`for`, `after`, `about`) | the main chat | a refined step into a worker's queue; a step not refined yet keeps the wish (`Queue when refined:`), and the board queues it by itself once it is refined |
| `work requeue B<id>` (`for`) | the main chat, the person ("Move to") | a queued step to another worker's queue; the board delivers it anew |
| `work unqueue B<id>` | the main chat, the person ("Take out of the queue") | a queued step out of its queue: refined (or new), without a worker |
| `work close I<id>` (`as`) | any chat | an instruction is done, and what came of it |
| `work drop B<id>` (`why`) | the main chat | the step is dropped |
| `work refine B<id>` (`summary`, `picture`, `goal`, `size`, `questions`), `work refined B<id>` (`what`) | the Advisor | the refine block, and its ready form; refined moves a new step to refined |
| `work list` | any chat | every item in one line |

## The backlog

The board writes this file from the work store after every change, its first line `<!-- generated by the worker
board from <work folder>; edit nothing here -->`, and nobody edits it; the board never reads it. It keeps the form
below; a line `[store] <Key>: <value> · ...` under a step holds what the step's line cannot say. A project gets its
store once: from a backlog in this form with `node tools/migrate-backlog.mjs --backlog <file> --work <folder>
--make-store`, or an empty one with `--work <folder> --init`. Without a store the board shows no work and says on top
what to run.


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
| `Refined (round <n>, by <name>, <date time>; accepted <date time>):` under a step, then `Problem:`, `Goal:`, `Questions:` (a point per question, ` Answer: ...` behind it once answered), `Feedback:` (`- Round <n>: ...`) | B233: a step's refine block; the Advisor writes it, the board adds the person's answers, feedback and "accepted"; any other named line or a line in brackets ends it, but `Summary:`, `Picture:`, `Part of:`, `Size:` and `What we build:` stay in it (B285) | `src/backlog.mjs` (`refinedOf`), `src/work/refineText.mjs` (`answerRefine`, `acceptRefine`), through the work API |
| `Refined (<date time>; ready):`, then `Summary:`, `Picture:`, `Part of:`, `Size:`, `What we build:` (while refining `Questions:` instead of `What we build:`) | B285: the approved form of a refine block (roles/advisor.md); only a head with `; ready` makes the step refined, so it may go into a queue; until then the board refines it first, and once more to fold answers in | `src/backlog.mjs` (`isRefined`, `refineStateOf`), `src/refineGate.mjs` |
| In the same block: `Summary:`, `Picture: <path> (<what it shows>)` or `Picture: none (<why>)`, `Part of:`, `Size:`, questions as `- <question> Advised: yes|no, <why>`; once answered `Refined (<date time>; ready):` with `What we build:` (points, `- Not in it: ...`) and no questions | B293: a refined step as one compact description: while refining, one-line questions with Yes / No and "Take the advice"; once ready, the step's description with a Ready chip | `src/backlog.mjs` (`refinedOf`), `public/board.js` (`refinePart`, `refinedChips`) |
| The group named by the setting `advisorSuggestions` | the Advisor's open suggestions on its tab | `src/state.mjs` |

## What the board types into a chat

Typed by the Workers mod as the person's own words; each line below is the board's, marked so.

| The words | When | Written in |
|---|---|---|
| `<words>` then `(typed on the worker board, HH:MM)` | the person typed to a chat on the board | `src/bridge.mjs` (`messageText`) |
| `Picture: <full path>` under the words | a picture pasted into the talk with the main chat | `src/talkPicture.mjs` |
| `(answered on the worker board, HH:MM) B<id> "<title>": approved.` / `: done.` / `: rejected. Reason: ...` / `: <answer>` | the person answered a step or a request | `src/bridge.mjs` |
| `prepare restart`, `resume` (with the chats cut off or not running) | the person's buttons for a restart of the app | `src/say.mjs` |
| `start "<name>"` and its session id | a message waits for a chat that is not running, or the person pressed "Start <name>" on a lane the board flagged | `src/say.mjs` (`wakeFor`) |
| `work: B<id> is yours; run work next` (no mark: the board's word) | a step queued for a free worker may be taken now: the board's reconciler, or the worker's own pull at the end of a turn; once per step and worker | `src/say.mjs` (`workWords`), `src/work/deliver.mjs` |
| `work: the board's check of B<id> failed (...); see work next` | the board's check after a report failed; once | `src/work/reconcile.mjs`, `src/work/deliver.mjs` |
| `spawn workers` / `Count:` / `Why:` | the main chat is asked for workers | `src/say.mjs` (`spawnWords`) |
| `remove worker` / `Name:` / `State:` / `Why:` | the person removes a worker | `src/say.mjs` (`removeWords`) |
| `backlog step from the Design tab`, `queue step from the Design tab` | an idea of the Design tab goes on the backlog | `src/design.mjs` (`stepWord`) |
| `queue step from the backlog` / `Step: B<id> <title>` | the person puts a step in a queue; for a step not refined yet the board holds it until the step is (B285) | `src/say.mjs`, `src/refineGate.mjs` |
| `step refined` / `Step: B<id> <title>` / `For: <worker>` (to the main chat) | B285: a step the main chat queued before it was refined is refined now: hand it out | `src/say.mjs` (`refinedWords`), `src/refineGate.mjs` |
| `stop task` / `Name:` / `Task:` / `Why:` | the person stops a worker's task (it reaches a safe point) | `src/say.mjs` (`stopWords`) |
| `advisor recommendation: yes` (to the main chat) or `: no` with `Reason:` (to the Advisor) / `Recommended:` / `Step:` / `Why:` | the person answers the Advisor's recommendation on the way to the next milestone | `src/say.mjs` (`recommendWords`) |
| `refine step` / `Step: B<id> <title>` / `Round: <n>` (to the Advisor) | the person asks the Advisor to refine a step (round 1), or again after their answers and feedback, which stand in the step's refine block already; the board sends it by itself too, one at a time: for a new step once, for a step about to be queued, and once more to fold answers in (B285) | `src/say.mjs` (`refineWords`), `src/refineGate.mjs` |
| `ask from the goal map` / `Goal: G<id> <title>` / `Ask (A<n>): <question>` / `Pictures: <paths in the project>` (to the Advisor) | B258: the person asks the Advisor about a goal of the map; the board wrote `Ask (A<n>, <date time>): <question>` under the goal first, and the Advisor writes `Answer (<date time>, <title>): ...` and `More: <page>` under it; the board writes `Read: <date time>` when the person marks the answer read (roles/advisor.md, "Asks from the goal map") | `src/say.mjs` (`goalAskCheck`), `src/goalsWrite.mjs` (`addGoalAsk`, `markAskRead`) |
| `brainstorm` / `Thread: <path>` / `Goal: G<id> <title>` (or `Goal: new`) / `Opening: <words>` (to the Advisor) | B259: the person started a brainstorm; the board wrote the thread's head; once per thread | `src/say.mjs` (`brainstormCheck`), `src/brainstorm.mjs` (`newThread`) |
| `brainstorm answer` / `Thread: <path>` / `Q<n>: <K> — <words>` (or `Q<n>: skipped`, `Q<n>: back to Q<m>`) (to the Advisor) | B259: the board wrote the person's answer under the question; the Advisor writes the next question or the proposal | `src/say.mjs`, `src/brainstorm.mjs` (`answerQuestion`) |
| `brainstorm wrap up` / `Thread: <path>` (to the Advisor) | B259: the person pressed "Enough, wrap up"; the thread's state is "wrapping up": the Advisor writes the proposal now | `src/say.mjs` |
| `brainstorm change` / `Thread: <path>` / `Change: <words>` (to the Advisor) | B259: the person wants the proposal changed; the Advisor writes it anew under a new `## Proposal` heading | `src/say.mjs` |
| `backlog step from the goal map` / `Title:` / `Goal: G<id>` / `Description:` / `Time:` / `Worker:` (to the main chat) | B259: the person created a brainstorm's proposal: one message per ticked step; the main chat writes the step and adds its id to the goal's `Steps:` line in the map (roles/main.md, "A step from the goal map") | `src/say.mjs` (`goalStepCheck`) |
| `re-check the goals`, with the job and the project's settings under it (to the Advisor) | B288: the person asks for a round now, with the Advisor tab's button; off while a round runs | `src/rounds.mjs` (`recheckText`), `src/say.mjs` |
| `Round from the board's clock: morning` (or `weekly`), with the job and the project's settings under it | the Advisor's rounds; never the person's word | `src/rounds.mjs` |

The board leaves its own lines out of the talk it shows (`src/state.mjs`, `BOARD_WORDS`, `isClockLine`).
